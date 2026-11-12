// SPDX-License-Identifier: GPL-3.0-or-later
// Offline DM32 preservation/package engine. No serial, file-system or network APIs.
// Layout/algorithms follow the pinned RadioFoundry MIT tools; see UPSTREAM.md.
export const UPSTREAM_COMMIT = '75c46ea46d5ebf6406f5b4ce0bbe2443b7649f91';
export const PROGRAM_SIZE = 0x100000;
export const DATA_SIZE = 0x1000000;
export const APP_START = 0xc000;
export const SLOT_OFFSET = 0xe8000 - APP_START;
export const RAW_NAME = 'application-codec.bin';
export const VENDOR_NAME = 'application-codec_BFUV32.bin';
const COPY_START = 0x710000, HEADER_LEN = 128, SLOT_MAGIC = 0x43524444;
const ENTRY_NAMES = ['decode','encode','dec_init','dec_set','enc_init','enc_set','fec_init'];
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal:true});
const validatedBackups = new WeakMap();
const COMMON_TABLES = '10684c33e3cc8238376e455fd96b1c15a863a864420dbbaa4589803c4eb0b0e1';
function contract(id,name,code_sha256,extra={}) {
  return {id,name,code_sha256,tables_sha256:COMMON_TABLES,code_bytes:0x14600,tables_bytes:0x2f78,
    run:0x16cdc,tables_ram:0x18000ea8,stock_tag:id.includes('046')?46:49,
    entries:{decode:0,encode:0x260,dec_init:0xb4,dec_set:0x84,enc_init:0x314,enc_set:0x2e4,fec_init:0x1bf8},
    relocations:[0x1ad4,0x1ad8,0x2e8c],slot_bytes:95748,...extra};
}
const CONTRACTS = [
  contract('dm32-046','Standard 046 (01.01 / 01.02)','9720ec0c923ac32bc909d06a0d4c414c6a1e80c3eaa6e9c5b5df0d0bf5ff5665'),
  contract('dm32-049','Standard 049','355ca9061979eceb2991826da9d39c95b4a9d40466245923d541a6556ceeafd1'),
  contract('dm32-nrf-049','NRF / fanti 049','cd0820a18df0b53bf011907a02d5b649bfbccf030c3d0432f4e363077d67a2c0',{tables_ram:0x18000eb0}),
  contract('dm32-046hr','HR Vocoder 046','02743cf4b3d252b8764fe083fb808b00ab42f0f0ab76935e62ca59fd5c5e64fb',{
    tables_sha256:'cd5a4d270f555cdbd586bca8de89e4e845789ed7aa2a2bb7414b6c3a270ef803',code_bytes:0x140dc,
    run:0x1b838,tables_ram:0x18000e48,entries:{decode:0,encode:0x260,dec_init:0xb4,dec_set:0x84,enc_init:0x314,enc_set:0x2e4,fec_init:0x1dcc},
    relocations:[0x1ca8,0x1cac,0x3060],slot_bytes:94432})
];
const REFERENCE_WORDS = { 'dm32-046':[0x19540,0x22754,0x26cac], 'dm32-049':[0x19540,0x22754,0x26cac],
  'dm32-nrf-049':[0x19540,0x22754,0x26cac], 'dm32-046hr':[0x1e270,0x26d8c,0x2b2e4] };
export function nativeContracts() { return structuredClone(CONTRACTS); }
function fail(message) { throw new Error(message); }
function bytes(value, name='File') {
  if (!(value instanceof Uint8Array)) fail(`${name} must contain bytes.`);
  return new Uint8Array(value);
}
function equal(a,b) {
  if (a.length!==b.length) return false;
  for (let i=0;i<a.length;i++) if(a[i]!==b[i])return false;
  return true;
}
function same(a,b) {
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();
  return equal(ak,bk)&&ak.every(k=>same(a[k],b[k]));
}
function mapOf(files) {
  const map = files instanceof Map ? files : files&&typeof files==='object'?new Map(Object.entries(files)):null;
  if(!map)fail('Select a folder containing the required files.');
  for(const key of map.keys())safePath(key);
  return map;
}
function safePath(name) {
  if(typeof name!=='string'||!name||name.includes('\\')||name.includes(':')||name.startsWith('/')||name.split('/').some(p=>!p||p==='.'||p==='..'))
    fail('Invalid relative file path.');
  return name;
}
function plainName(name) { safePath(name);if(name.includes('/'))fail('Expected a plain application filename.');return name; }
function file(map,name) { if(!map.has(name))fail(`Missing required file: ${name}`);return bytes(map.get(name),name); }
function json(content,name) {
  try { if(content.length>1024*1024)fail('JSON metadata exceeds 1 MiB.');return JSON.parse(decoder.decode(content)); }
  catch(error) { fail(`${name}: ${error.message}`); }
}
function jsonBytes(value) { return encoder.encode(JSON.stringify(value,null,2)+'\n'); }
export async function sha256(content) {
  if(!globalThis.crypto?.subtle)fail('SHA-256 requires a secure browser context (HTTPS or localhost).');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',content)),b=>b.toString(16).padStart(2,'0')).join('');
}
async function record(content) { return {bytes:content.length,sha256:await sha256(content)}; }
function checkSnapshot(snapshot,{application=false}={}) {
  if(!snapshot||snapshot.program?.length!==PROGRAM_SIZE||snapshot.data?.length!==DATA_SIZE)
    fail('Incomplete memory snapshot: require 1 MiB program and 16 MiB data.');
  if(!(snapshot.program instanceof Uint8Array)||!(snapshot.data instanceof Uint8Array))fail('Snapshot memories must contain bytes.');
  if(application) {
    const blank=part=>part.every(x=>x===0)||part.every(x=>x===255);
    if(blank(snapshot.program.subarray(0,16)))fail('Blank bootloader read; backup cannot be sealed.');
    if(blank(snapshot.program.subarray(APP_START,APP_START+16)))fail('Blank application read; not a usable restore image.');
  }
}
function calibration(data) {
  const found=new Map();
  for(let start=0x1000;start<0xc9000;start+=0x1000)if(data[start+0xfff]===2)
    found.set(`calibration/factory-${start.toString(16).padStart(6,'0')}.bin`,data.subarray(start,start+0x1000));
  const copy=data.subarray(COPY_START,COPY_START+0x1000);
  found.set('calibration/copy-710000.bin',copy);
  if(found.size===1&&!equal(copy.subarray(0,8),new Uint8Array([0,0x40,0,0x47,255,255,255,255])))
    fail('No factory-tagged page or recognized calibration copy; installation is blocked.');
  return found;
}
function backupFiles(program,data) {
  return new Map([['program.bin',program],['data.bin',data],['readback/program.bin',program],['readback/data.bin',data],
    ['restore-application.bin',program.subarray(APP_START)],['bootloader-reference.bin',program.subarray(0,APP_START)],...calibration(data)]);
}
function backupHeader(manifest,label) {
  if(!manifest||manifest.schema!==1||manifest.board!=='dm32'||manifest.upstream_commit!==UPSTREAM_COMMIT||
    manifest.verification!=='two-full-reads-identical'||typeof manifest.radio_label!=='string'||!manifest.radio_label.trim()||
    (label!==undefined&&manifest.radio_label!==label))fail('Wrong radio label, board, backup version or verification record.');
}
export async function sealBackup(first,second,label,firmware) {
  if(typeof label!=='string'||!label.trim()||typeof firmware!=='string'||!firmware.trim())fail('Enter the radio label and installed firmware version.');
  checkSnapshot(first,{application:true});checkSnapshot(second,{application:true});
  if(!equal(first.program,second.program)||!equal(first.data,second.data))fail('Independent full reads differ; backup remains unsealed.');
  const program=bytes(first.program),data=bytes(first.data),files=new Map();
  for(const [name,content] of backupFiles(program,data))files.set(name,bytes(content));
  const records={};for(const [name,content] of files)records[name]=await record(content);
  files.set('manifest.json',jsonBytes({schema:1,board:'dm32',radio_label:label,installed_firmware:firmware,
    upstream_commit:UPSTREAM_COMMIT,created_utc:new Date().toISOString(),verification:'two-full-reads-identical',files:records}));
  return files;
}
export async function validateBackup(filesMap,label) {
  const files=mapOf(filesMap),manifest=json(file(files,'manifest.json'),'manifest.json');backupHeader(manifest,label);
  const program=file(files,'program.bin'),data=file(files,'data.bin');checkSnapshot({program,data},{application:true});
  const expected=backupFiles(program,data);
  if(!manifest.files||!same(Object.keys(manifest.files).sort(),[...expected.keys()].sort()))fail('Backup manifest is missing required files or contains unexpected paths.');
  for(const [name,content] of expected)if(!same(manifest.files[name],await record(content))||!equal(file(files,name),content))
    fail(`Backup checksum/content mismatch: ${name}`);
  const backup={manifest,program,data};
  validatedBackups.set(backup,{manifest:structuredClone(manifest),program:bytes(program),data:bytes(data)});
  return backup;
}
async function checkedBackup(backup) {
  if(!backup||!validatedBackups.has(backup))fail('Validate the complete sealed backup before preparing firmware.');
  const sealed=validatedBackups.get(backup);
  if(!same(backup.manifest,sealed.manifest))fail('Validated backup manifest changed in memory. Reload the original backup.');
  backupHeader(backup.manifest);checkSnapshot(backup,{application:true});
  if(!equal(backup.program,sealed.program)||!equal(backup.data,sealed.data))fail('Validated backup changed in memory. Reload the original backup.');
  return sealed;
}
export function compareSnapshot(snapshot,backup,{full=false}={}) {
  checkSnapshot(snapshot);checkSnapshot(backup);
  const sealed=validatedBackups.get(backup);
  if(!sealed||!same(backup.manifest,sealed.manifest))fail('Validate the complete sealed backup before comparing radio memory.');
  if(full) {
    if(!equal(snapshot.program,sealed.program)||!equal(snapshot.data,sealed.data))fail('Full memory comparison differs from the sealed backup.');
  } else {
    const current=calibration(snapshot.data),old=calibration(sealed.data);
    if(!equal(snapshot.program.subarray(0,APP_START),sealed.program.subarray(0,APP_START))||current.size!==old.size||
      [...old].some(([name,content])=>!current.has(name)||!equal(current.get(name),content)))
      fail('Bootloader or factory calibration differs from the sealed backup; installation is blocked.');
  }
  return {bootloader_matches_backup:true,calibration_matches_backup:true,...(full?{full_memory_matches_backup:true}:{})};
}
function releaseContracts(manifest) {
  if(manifest.supported_native_codecs!==undefined) {
    const rows=manifest.supported_native_codecs;
    if(!Array.isArray(rows)||!rows.length)fail('Release must declare supported native-codec contracts.');
    const ids=[];
    for(const row of rows) {
      const expected=CONTRACTS.find(item=>item.id===row?.id);
      if(!expected||!same(row,expected)||ids.includes(row.id))fail('Release native-codec contract differs from the checked tool or is repeated.');
      ids.push(row.id);
    }
    return ids;
  }
  const old=manifest.qualified_native_codec;
  const ids=CONTRACTS.filter(row=>row.code_sha256===old?.code_sha256&&row.tables_sha256===old?.tables_sha256).map(row=>row.id);
  if(!ids.length)fail('Release does not declare a supported native codec.');return ids;
}
function imageCheck(raw) {
  if(!raw.length||raw.length>PROGRAM_SIZE-APP_START)fail('Application is empty or exceeds the DM32 application area.');
  if(raw.subarray(0,16).length===16&&(raw.subarray(0,16).every(x=>!x)||raw.subarray(0,16).every(x=>x===255)))fail('Image starts with 16 blank bytes; not an application.');
}
async function releaseInput(input,application) {
  let content,path,manifest;
  if(input instanceof Uint8Array)content=bytes(input);
  else if(input?.bytes instanceof Uint8Array) {content=bytes(input.bytes);path=input.path;}
  else fail('Select the original release.json bytes together with its application file. A bare application cannot be flashed.');
  manifest=json(content,'release.json');
  if(manifest?.schema!=='dm32-multimode-release/1'||manifest.board!=='dm32'||
    !/^[0-9a-f]{40}$/.test(manifest.source_commit||'')||typeof manifest.version!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(manifest.version))
    fail('Unsupported release manifest, source revision or board.');
  const canonical=`firmware/v${manifest.version}/release.json`;
  path=path??canonical;safePath(path);
  if(path!==canonical)fail('Release manifest path must match its firmware version.');
  if(manifest.application?.load_address!=='0x0300C000'||manifest.application.contains_native_codec!==false||
    manifest.application.directly_flashable!==false||manifest.upstream?.radiofoundry_commit!==UPSTREAM_COMMIT)
    fail('Release must describe the pinned DM32 codec-free application at 0x0300C000.');
  plainName(manifest.application?.file);
  const app=bytes(application,'Release application');
  if(!same({bytes:manifest.application.bytes,sha256:manifest.application.sha256},await record(app)))fail('Release application size or SHA-256 mismatch.');
  if(app.length>SLOT_OFFSET)fail('Release application overlaps the native codec slot.');
  imageCheck(app);return {manifest,content,path,app,allowed:releaseContracts(manifest)};
}
const crcTable = Uint32Array.from({length:256},(_,n)=>{let c=n;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(parts) {let crc=0xffffffff;for(const part of parts)for(const b of part)crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function u32(content,offset) { return new DataView(content.buffer,content.byteOffset,content.byteLength).getUint32(offset,true); }
async function extractNative(program) {
  for(let start=0;start+8<=program.length;start+=4) {
    if(u32(program,start)!==0x152514d8||u32(program,start+4)!==0x74c776cd)continue;
    for(const row of CONTRACTS) {
      if(start+row.code_bytes>program.length)continue;
      const code=program.subarray(start,start+row.code_bytes);
      if(await sha256(code)!==row.code_sha256)continue;
      for(let at=0;at<program.length-64;at+=4) {
        if(crc32([program.subarray(at,at+64)])!==0x11475389||at+row.tables_bytes>program.length)continue;
        const tables=program.subarray(at,at+row.tables_bytes);
        if(await sha256(tables)!==row.tables_sha256)continue;
        const refs=REFERENCE_WORDS[row.id];
        if(row.tables_ram<0x18000e48||row.tables_ram+tables.length>0x18003e28||code.length>0x14600||
          (0x43a00-row.run)%4||Object.values(row.entries).some(off=>off%2||off>=code.length)||
          row.relocations.some((off,i)=>off<8||off%4||off>code.length-4||u32(code,off)!==refs[i]||
            refs[i]<row.run||refs[i]>=row.run+code.length))fail('Native codec entry/relocation contract failed.');
        return {row,code:bytes(code),tables:bytes(tables)};
      }
      fail(`Native codec tables are missing or damaged for ${row.name}. Keep the backup private; do not substitute another radio's backup.`);
    }
  }
  fail("Native codec is not recognized in this sealed backup. Keep it private and ask the maintainer about its stock version; do not force a profile or substitute another radio's backup.");
}
async function merge(app,program,allowed,version) {
  const {row,code,tables}=await extractNative(program);
  if(!allowed.includes(row.id))fail(`Native profile ${row.name} is supported by this tool but is not declared for release ${version}. Select a compatible release.`);
  const tableOff=HEADER_LEN+((code.length+3)&~3),relOff=tableOff+((tables.length+3)&~3),length=relOff+4*row.relocations.length;
  if(length!==row.slot_bytes||length>0x18000)fail('Native codec does not fit its exact slot contract.');
  const slot=new Uint8Array(length).fill(255),view=new DataView(slot.buffer),rels=new Uint8Array(4*row.relocations.length);
  row.relocations.forEach((off,i)=>new DataView(rels.buffer).setUint32(i*4,off,true));
  slot.fill(0,0,HEADER_LEN);slot.set(code,HEADER_LEN);slot.set(tables,tableOff);slot.set(rels,relOff);
  const crc=crc32([code,tables,rels]);
  const fields=[SLOT_MAGIC,2,HEADER_LEN,code.length,row.run,tableOff,tables.length,row.tables_ram,
    ...ENTRY_NAMES.map(name=>row.entries[name]),row.stock_tag,crc,relOff,row.relocations.length];
  fields.forEach((value,i)=>view.setUint32(i*4,value,true));
  const raw=new Uint8Array(SLOT_OFFSET+slot.length).fill(255);raw.set(app);raw.set(slot,SLOT_OFFSET);imageCheck(raw);
  const vendor=new Uint8Array(256+raw.length).fill(255);vendor.set(encoder.encode('BFUV32-V2'));vendor.set(encoder.encode('END'),253);vendor.set(raw,256);
  const parsed={version:2,run:row.run,tables_ram:row.tables_ram,tag:row.stock_tag,crc,length,
    relocations:[...row.relocations],code_sha256:await sha256(code),tables_sha256:await sha256(tables)};
  const hash=await sha256(raw),end=(0x0300c000+raw.length).toString(16).toUpperCase().padStart(8,'0');
  const checks=[`${raw.length} bytes, 0x0300C000..0x${end}, ${Math.ceil(raw.length/1024)} blocks of 1 KB, sha256 ${hash}`,
    'RadioFoundry codec slot at 0x030E8000: present (DMR voice)'];
  return {raw,vendor,parsed,checks};
}
async function prepareValidated(releaseJson,application,backup) {
  const release=await releaseInput(releaseJson,application),out=await merge(release.app,backup.program,release.allowed,release.manifest.version);
  const manifest={schema:'dm32-beta-package/1',board:'dm32',radio_label:backup.manifest.radio_label,
    release_manifest:release.path,release_manifest_sha256:await sha256(release.content),version:release.manifest.version,
    source_commit:release.manifest.source_commit,backup_program_sha256:await sha256(backup.program),backup_data_sha256:await sha256(backup.data),
    upstream_commit:UPSTREAM_COMMIT,native_codec:out.parsed,application:await record(release.app),
    files:{[RAW_NAME]:await record(out.raw),[VENDOR_NAME]:await record(out.vendor)},checks:out.checks,hardware_accessed:false,firmware_written:false};
  return {manifest,raw:out.raw,vendor:out.vendor,files:new Map([[RAW_NAME,bytes(out.raw)],[VENDOR_NAME,bytes(out.vendor)],['package.json',jsonBytes(manifest)]])};
}
export async function prepareRelease(releaseJson,application,backup) {
  return prepareValidated(releaseJson,application,await checkedBackup(backup));
}
export async function validatePrepared(filesMap,backup) {
  const sealed=await checkedBackup(backup),files=mapOf(filesMap),manifest=json(file(files,'package.json'),'package.json');
  if(manifest?.schema!=='dm32-beta-package/1'||manifest.board!=='dm32'||manifest.radio_label!==backup.manifest.radio_label||
    manifest.upstream_commit!==UPSTREAM_COMMIT||manifest.backup_program_sha256!==await sha256(sealed.program)||
    manifest.backup_data_sha256!==await sha256(sealed.data))fail('Package is not bound to this labeled, sealed backup.');
  safePath(manifest.release_manifest);
  const releaseBytes=file(files,manifest.release_manifest),release=json(releaseBytes,'Selected release.json');
  const prefix=manifest.release_manifest.slice(0,manifest.release_manifest.lastIndexOf('/')+1);
  const app=file(files,prefix+plainName(release.application?.file));
  const expected=await prepareValidated({bytes:releaseBytes,path:manifest.release_manifest},app,sealed);
  for(const key of ['release_manifest','release_manifest_sha256','version','source_commit','application','native_codec','files'])
    if(!same(manifest[key],expected.manifest[key]))fail(`Package release provenance or native content differs: ${key}`);
  for(const name of [RAW_NAME,VENDOR_NAME])if(!equal(file(files,name),expected.files.get(name)))fail(`Prepared package checksum/content mismatch: ${name}`);
  // Preserve the input package's exact JSON serialization for CLI interoperability.
  expected.manifest=structuredClone(manifest);expected.files.set('package.json',file(files,'package.json'));return expected;
}
export async function verifyInstalled(snapshot,backup,raw) {
  raw=bytes(raw,'Prepared application');await checkedBackup(backup);compareSnapshot(snapshot,backup);imageCheck(raw);
  if(!equal(snapshot.program.subarray(APP_START,APP_START+raw.length),raw))fail('Installed application differs from the prepared package.');
  return {application_matches:true,bootloader_matches_backup:true,calibration_matches_backup:true,application_sha256:await sha256(raw),
    scope:'Application prefix, bootloader and calibration; ordinary settings may change after normal boot.'};
}
