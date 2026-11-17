// SPDX-License-Identifier: GPL-3.0-or-later
// Private, local-only dump/ZIP helpers. No serial, upload, storage or codec API.
const PROGRAM_BYTES = 0x100000, DATA_BYTES = 0x1000000;
const MAX_ZIP_BYTES = 64 * 1024 * 1024, MAX_ZIP_FILES = 1024;
const README_NAME = 'README-PRIVATE-BACKUP.txt';
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal:true});
const README = `PRIVATE DM32 RADIO BACKUP / DIAGNOSTIC DUMP

Keep this ZIP private. It can contain contacts, radio IDs, frequencies, codeplugs,
factory calibration, and proprietary firmware or native codec bytes.

If the maintainer requests these files, share the ZIP directly with the DM32
firmware maintainer using a trusted private transfer you choose. Do not attach it
to a public GitHub issue, public chat, or public repository. Include the radio's
reported stock version and a description of the problem separately. Public
support reports should contain only the requested diagnostic metadata.

No files are uploaded automatically. Creating this archive does not install
firmware or enable an otherwise incompatible radio.

FILE TYPES
- manifest.json: an original sealed installer backup. Keep every original file,
  relative path and manifest unchanged. An installer must still validate it.
- full-dump.json: a diagnostic raw dump from two identical full-memory reads.
  This is NOT a sealed installer backup. It does not qualify the calibration,
  application, codec, hardware revision or suitability of any firmware. Do not
  rename full-dump.json to manifest.json or treat it as an installation package.

Never restore one radio's program/data/calibration to another radio. Keep another
private copy of the original files before sharing. These instructions do not
replace the installation/recovery instructions for your specific release.
`;

function fail(message) { throw new Error(message); }
function copyBytes(value, name) {
  if (!(value instanceof Uint8Array)) fail(`${name} must contain Uint8Array bytes.`);
  return new Uint8Array(value);
}
function equal(a,b) {
  if(a.length!==b.length)return false;
  for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;
  return true;
}
function snapshotCopy(snapshot, name) {
  if(!(snapshot?.program instanceof Uint8Array)||!(snapshot?.data instanceof Uint8Array)||
    snapshot.program.length!==PROGRAM_BYTES||snapshot.data.length!==DATA_BYTES)
    fail(`${name}: require a complete 1 MiB program and 16 MiB data read.`);
  return {program:copyBytes(snapshot.program,name+' program'),data:copyBytes(snapshot.data,name+' data')};
}
async function record(content) {
  if(!globalThis.crypto?.subtle)fail('SHA-256 requires HTTPS or localhost.');
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',content));
  return {bytes:content.length,sha256:Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('')};
}

// Deliberately does not require nonblank application, known factory-calibration
// layout, codec recognition or a supported RF revision. It is diagnostic only.
export async function createFullDump(first,second,label,firmware) {
  if(typeof label!=='string'||!label.trim()||typeof firmware!=='string'||!firmware.trim())
    fail('Enter a radio label and the reported installed firmware version.');
  if(label.length>200||firmware.length>200)fail('Radio label and firmware version must each be at most 200 characters.');
  const a=snapshotCopy(first,'First read'),b=snapshotCopy(second,'Second read');
  if(!equal(a.program,b.program)||!equal(a.data,b.data))fail('Independent full reads differ; diagnostic dump remains unverified.');
  // Copy both inputs before any asynchronous work; caller changes cannot alter
  // either hash or the exported bytes while SHA-256 runs.
  const [ap,ad,bp,bd]=await Promise.all([record(a.program),record(a.data),record(b.program),record(b.data)]);
  const manifest={schema:'dm32-private-full-dump/1',board:'dm32',radio_label:label,installed_firmware:firmware,
    created_utc:new Date().toISOString(),verification:'two-full-reads-identical',
    reads:{first:{program:ap,data:ad},second:{program:bp,data:bd}},
    files:{'program.bin':ap,'data.bin':ad},
    scope:'Diagnostic raw dump only; not a sealed installer backup. Keep private; no cross-radio restore.'};
  return new Map([['program.bin',a.program],['data.bin',a.data],
    ['full-dump.json',encoder.encode(JSON.stringify(manifest,null,2)+'\n')]]);
}

function pathBytes(name) {
  if(typeof name!=='string'||!name||name.startsWith('/')||/[\\:\x00-\x1f\x7f<>"|?*]/.test(name))
    fail('Backup ZIP contains an unsafe relative file path.');
  const parts=name.split('/');
  if(parts.some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p)))
    fail('Backup ZIP contains an unsafe relative file path.');
  const encoded=encoder.encode(name);
  if(encoded.length>512||parts.some(p=>encoder.encode(p).length>255))fail('Backup ZIP file path is too long.');
  if(decoder.decode(encoded)!==name)fail('Backup ZIP file path contains invalid Unicode.');
  return encoded;
}
const crcTable=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(data) {
  let crc=0xffffffff;
  for(const byte of data)crc=crcTable[(crc^byte)&255]^(crc>>>8);
  return (crc^0xffffffff)>>>0;
}

// ZIP32 STORE only. Fixed 1980-01-01 timestamps and sorted UTF-8 paths make
// repeated export of identical input bytes deterministic. No dependency/ZIP64.
export function buildBackupZip(files) {
  const map=files instanceof Map?files:files&&typeof files==='object'&&!Array.isArray(files)?new Map(Object.entries(files)):null;
  if(!map||!map.size)fail('No backup files are available to export.');
  const instructions=encoder.encode(README),hasInstructions=map.has(README_NAME);
  if(hasInstructions&&(!(map.get(README_NAME) instanceof Uint8Array)||!equal(map.get(README_NAME),instructions)))
    fail(`Backup already contains a different ${README_NAME}; original files will not be overwritten.`);
  if(map.size+(hasInstructions?0:1)>MAX_ZIP_FILES)fail('Backup ZIP contains too many files (maximum 1024 including instructions).');
  const rows=[],seen=new Set();let total=22;
  for(const [name,value] of hasInstructions?map:[...map,[README_NAME,instructions]]) {
    const path=pathBytes(name),normalized=name.normalize('NFC').toLowerCase();
    if(seen.has(normalized))fail('Backup ZIP contains filenames that collide when extracted.');
    seen.add(normalized);
    if(!(value instanceof Uint8Array))fail(`${name} must contain Uint8Array bytes.`);
    // Account for both headers, both paths and the body before allocating or
    // copying the archive. 64 MiB is safely below ZIP32's 4 GiB boundary.
    total+=30+46+2*path.length+value.length;
    if(!Number.isSafeInteger(total)||total>MAX_ZIP_BYTES)fail('Backup ZIP exceeds the 64 MiB export limit.');
    rows.push({name,path,value});
  }
  rows.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
  const out=new Uint8Array(total),view=new DataView(out.buffer);let offset=0;
  for(const row of rows) {
    const data=copyBytes(row.value,row.name);row.offset=offset;row.size=data.length;row.crc=crc32(data);
    view.setUint32(offset,0x04034b50,true);view.setUint16(offset+4,20,true);view.setUint16(offset+6,0x800,true);
    view.setUint16(offset+8,0,true);view.setUint16(offset+10,0,true);view.setUint16(offset+12,0x21,true);
    view.setUint32(offset+14,row.crc,true);view.setUint32(offset+18,row.size,true);view.setUint32(offset+22,row.size,true);
    view.setUint16(offset+26,row.path.length,true);view.setUint16(offset+28,0,true);
    out.set(row.path,offset+30);out.set(data,offset+30+row.path.length);offset+=30+row.path.length+row.size;
  }
  const directoryStart=offset;
  for(const row of rows) {
    view.setUint32(offset,0x02014b50,true);view.setUint16(offset+4,20,true);view.setUint16(offset+6,20,true);
    view.setUint16(offset+8,0x800,true);view.setUint16(offset+10,0,true);view.setUint16(offset+12,0,true);view.setUint16(offset+14,0x21,true);
    view.setUint32(offset+16,row.crc,true);view.setUint32(offset+20,row.size,true);view.setUint32(offset+24,row.size,true);
    view.setUint16(offset+28,row.path.length,true);view.setUint16(offset+30,0,true);view.setUint16(offset+32,0,true);
    view.setUint16(offset+34,0,true);view.setUint16(offset+36,0,true);view.setUint32(offset+38,0,true);view.setUint32(offset+42,row.offset,true);
    out.set(row.path,offset+46);offset+=46+row.path.length;
  }
  const directoryLength=offset-directoryStart;
  view.setUint32(offset,0x06054b50,true);view.setUint16(offset+4,0,true);view.setUint16(offset+6,0,true);
  view.setUint16(offset+8,rows.length,true);view.setUint16(offset+10,rows.length,true);
  view.setUint32(offset+12,directoryLength,true);view.setUint32(offset+16,directoryStart,true);view.setUint16(offset+20,0,true);
  return out;
}

// A version is a compatibility warning, not an RF-chip detector. In particular,
// neither a data-flash JEDEC id nor an unknown/older version implies RF-A/B.
export function backupCompatibility(backup,reportedVersion='') {
  const sep='[\\x20-\\x2f\\x3a-\\x40\\x5b-\\x60\\x7b-\\x7e\\t\\r\\n]*';
  const version=new RegExp('\\b(?:DM'+sep+'32'+sep+')?NRFB'+sep+'(?:0?1'+sep+')?0?50\\b','i');
  const labels=[reportedVersion,backup?.manifest?.installed_firmware].filter(s=>typeof s==='string');
  let found=labels.some(label=>version.test(label));
  if(!found&&backup?.program instanceof Uint8Array) {
    const ascii=new TextDecoder('latin1').decode(backup.program.subarray(0,PROGRAM_BYTES));
    found=version.test(ascii);
  }
  return found?{incompatible:true,reason:'DM32.NRFB.01.050 is currently incompatible; support planned.',stockVersion:'DM32.NRFB.01.050'}:
    {incompatible:false,reason:'',stockVersion:''};
}
