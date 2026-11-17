// SPDX-License-Identifier: GPL-3.0-or-later
// DAPP v1 validation and the firmware's bounded APP protocol. No native PCM TX.
import {crc32} from './model.js?v=aded0a2';

export const APPLET_LIMITS = Object.freeze({slots:8, maxPackage:32768, chunkBytes:32,
  commandBytes:119, lineBytes:512});
export const APPLET_CAPABILITIES = Object.freeze({same:1, serial:2, display:4, key:8});
const states = ['idle','running','waiting','finished','fault'];
const encoder = new TextEncoder();
const error = (message, code, extra={}) => Object.assign(new Error(message), {name:'AppletError',code,...extra});
const uint = value => Number.isInteger(value) && value>=0 && value<=0xffffffff;
const slotNumber = value => {
  if (!Number.isInteger(value) || value<1 || value>8) throw error('Choose applet slot 1–8.', 'SLOT');
  return value;
};
const notify = (callback, value) => {try {callback?.(value);} catch {/* Presentation only. */}};
const printable = value => value>=32 && value<=126;

/** Validate the same header, CRC, operands and declared services as radio_applet_vm.c. */
export function parseAppletPackage(input) {
  if (!(input instanceof Uint8Array)) throw error('Select a compiled .dapp package.', 'PACKAGE');
  const data=input.slice(), size=data.length;
  const bad=message => {throw error(message, 'PACKAGE');};
  if (size<64 || size>APPLET_LIMITS.maxPackage) bad('DAPP packages must be 64–32768 bytes.');
  const view=new DataView(data.buffer), u16=offset=>view.getUint16(offset,true), u32=offset=>view.getUint32(offset,true);
  if (String.fromCharCode(...data.subarray(0,4))!=='DAPP' || u16(4)!==1 || u16(6)!==64)
    bad('Unsupported DAPP package header or version. Compile source with dm32-applet.py first.');
  const bits=u32(12), count=u16(20), entry=u16(22), stringsOffset=u32(24), stringsBytes=u32(28);
  if (u32(8)!==size || u32(16)!==64 || u32(56)!==0 || (bits&~15) || count<1 || entry>=count
      || stringsOffset!==64+count*8 || stringsOffset>size || stringsBytes!==size-stringsOffset)
    bad('Invalid DAPP sections, entry point or capability bits.');
  const nameBytes=data.subarray(32,56), zero=nameBytes.indexOf(0);
  if (zero<1 || !nameBytes.subarray(0,zero).every(printable) || nameBytes.subarray(zero).some(byte=>byte!==0))
    bad('Applet names require 1–23 printable ASCII characters and zero padding.');
  const checksumInput=new Uint8Array(size-4);
  checksumInput.set(data.subarray(0,60));checksumInput.set(data.subarray(64),60);
  const packageCrc=crc32(checksumInput);
  if (packageCrc!==u32(60)) bad('DAPP package CRC32 does not match.');
  if (!data.subarray(stringsOffset).every(printable)) bad('DAPP text must contain printable ASCII only.');
  for (let index=0;index<count;index++) {
    const offset=64+index*8, op=data[offset], a=data[offset+1], b=u16(offset+2), imm=u32(offset+4);
    let valid=true, needed=0;
    switch(op) {
      case 0:case 7:valid=!a&&!b&&!imm;break;
      case 1:case 2:valid=a<8&&!b;break;
      case 3:case 4:valid=a<8&&b<count;break;
      case 5:valid=!a&&b<count&&!imm;break;
      case 6:valid=!a&&!b&&imm>=1&&imm<=60000;break;
      case 8:case 9:
        valid=!a&&b>=1&&b<=95&&imm<=stringsBytes&&b<=stringsBytes-imm;
        needed=op===8?2:4;break;
      case 10:
        valid=!a&&!b&&imm>=162400000&&imm<=162550000&&(imm-162400000)%25000===0;
        needed=1;break;
      case 11:case 12:valid=!a&&!b&&!imm;needed=op===11?3:5;break;
      case 13:valid=a<8&&!b&&!imm;needed=2;break;
      case 14:valid=a<8&&b<=13&&!imm;needed=b===9?0:b===8?8:1;break;
      case 15:valid=a<8&&b>=1&&(b&~15)===0&&imm>=1&&imm<=60000;needed=(b&7?1:0)|(b&8?8:0);break;
      default:valid=false;
    }
    if (!valid) bad(`Invalid DAPP instruction ${index}.`);
    if ((bits&needed)!==needed) bad(`DAPP instruction ${index} uses an undeclared service.`);
  }
  return Object.freeze({data, format:'DAPP', version:1, name:String.fromCharCode(...nameBytes.subarray(0,zero)),
    size, capabilityBits:bits, capabilities:Object.freeze(Object.keys(APPLET_CAPABILITIES).filter(name=>bits&APPLET_CAPABILITIES[name])),
    instructions:count, entry, stringsBytes, crc32:packageCrc, uploadCrc32:crc32(data)});
}

function refusal(line) {
  if (/^ERR stop Trunk RX first$/.test(line)) return error('Stop trunking on the radio before managing applets.', 'TRUNK_ACTIVE');
  if (/programming session active/i.test(line)) return error('Finish the current programming transaction before managing applets.', 'PROGRAMMING_ACTIVE');
  if (/unknown|unsupported|use APP HELP|syntax: APPS?\b/i.test(line)) return error('This firmware does not support that applet service.', 'UNSUPPORTED');
  return error(line.replace(/^APP (?:ERROR|ERR)\s*/, ''), 'REFUSED', {radioMessage:line});
}

export function parseAppletStatus(line) {
  const match=/^APP STATUS slot=(\d+) running=([01]) operation=(\d+) state=(\d+) instructions=(\d+)$/.exec(line);
  if (!match) throw error('Invalid applet status reply.', 'PROTOCOL');
  const [slot,running,operation,state,instructions]=match.slice(1).map(Number);
  if (!uint(slot)||slot>8||!uint(operation)||operation>5||!uint(state)||state>4||!uint(instructions)
      ||running&&slot===0) throw error('Invalid applet status fields.', 'PROTOCOL');
  return Object.freeze({slot,running:Boolean(running),operation,state,stateName:states[state],instructions});
}

export function parseAppletCatalogue(lines) {
  if (lines[0]!=='APP STORE slots=8 bank_bytes=65536 partition_bytes=1048576 max_package=32768'
      || lines.at(-1)!=='APP OK STORE STATUS') throw error('Unsupported applet storage reply.', 'PROTOCOL');
  let index=1, readOnly=false;
  if (lines[index]==='APP STORE READ_ONLY foreign_data') {readOnly=true;index++;}
  const slots=[];
  for (let slot=1;slot<=8;slot++,index++) {
    const line=lines[index];
    if (line===`APP SLOT ${slot} EMPTY`) {slots.push(Object.freeze({slot,present:false,name:null,size:0,revision:0}));continue;}
    const match=/^APP SLOT ([1-8]) name=([ -~]{1,23}) size=(\d+) seq=(\d+)$/.exec(line??'');
    if (!match || Number(match[1])!==slot || !uint(Number(match[3])) || Number(match[3])<64
        || Number(match[3])>32768 || !uint(Number(match[4])) || !Number(match[4]))
      throw error('Incomplete or malformed applet slot inventory.', 'PROTOCOL');
    slots.push(Object.freeze({slot,present:true,name:match[2],size:Number(match[3]),revision:Number(match[4])}));
  }
  if (index!==lines.length-1) throw error('Unexpected rows in applet inventory.', 'PROTOCOL');
  return Object.freeze({supported:true,readOnly,slotCount:8,bankBytes:65536,partitionBytes:1048576,
    maxPackage:32768,slots:Object.freeze(slots)});
}

/** The supplied runSession must exclusively arbitrate the existing CPS port.
 * Session: {read():Promise<{value,done}>,write(Uint8Array),invalidate(error),release()}.
 * No port chooser, connection, polling or APP command occurs in the constructor.
 */
export class AppletClient {
  constructor({runSession,timeoutMs=3000,operationTimeoutMs=60000,onOutput=()=>{},onProgress=()=>{}}={}) {
    if (typeof runSession!=='function') throw new TypeError('AppletClient requires an exclusive serial session provider.');
    for (const value of [timeoutMs,operationTimeoutMs]) if (!Number.isFinite(value)||value<=0||value>60000)
      throw new TypeError('Applet timeouts must be finite and no more than60000ms.');
    this._runSession=runSession;this.timeoutMs=timeoutMs;this.operationTimeoutMs=operationTimeoutMs;
    this.onOutput=onOutput;this.onProgress=onProgress;this._pending=[];this._busy=false;
  }
  get busy() {return this._busy;}
  async _run(operation) {
    if (this._busy) throw error('Another applet operation is still running.', 'IN_USE');
    this._busy=true;
    try {return await this._runSession(session=>operation(session));}
    finally {this._busy=false;}
  }
  async _deadline(session,promise,deadline) {
    let timer;
    try {
      if (Date.now()>=deadline) throw error('Applet response timed out. Reconnect before retrying.', 'TIMEOUT');
      const result=await Promise.race([promise,new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(error('Applet response timed out. Reconnect before retrying; the radio outcome may be uncertain.', 'TIMEOUT')),
        Math.max(0,deadline-Date.now()));
      })]);
      if (Date.now()>=deadline) throw error('Applet response arrived after its deadline. Reconnect before retrying.', 'TIMEOUT');
      return result;
    } finally {clearTimeout(timer);}
  }
  _invalidate(session,fault) {
    this._pending=[];
    try {session.invalidate?.(fault);} catch {/* Preserve the original fault. */}
  }
  async _line(session,deadline) {
    const bytes=[];
    while (bytes.length<=APPLET_LIMITS.lineBytes) {
      if (!this._pending.length) {
        const result=await this._deadline(session,session.read(),deadline);
        if (result.done) throw error('The radio connection closed. Reconnect before retrying.', 'NOT_CONNECTED');
        if (!(result.value instanceof Uint8Array)||result.value.length>4096) throw error('Invalid applet serial frame.', 'FRAME');
        this._pending.push(...result.value);
        if (!result.value.length) continue;
      }
      const byte=this._pending.shift();
      if (byte===10) {
        if (bytes.at(-1)!==13) throw error('Applet replies must end with CRLF.', 'FRAME');
        return String.fromCharCode(...bytes.slice(0,-1));
      }
      if ((!printable(byte)&&byte!==13)||bytes.at(-1)===13) throw error('Invalid applet response characters.', 'FRAME');
      bytes.push(byte);
    }
    throw error('Applet reply exceeds512 bytes.', 'FRAME');
  }
  async _exchange(session,command,accept,{timeoutMs=this.timeoutMs,collect,maxLines=256}={}) {
    if (command.length>119 || !/^APP (?:STORE STATUS|STATUS|RUN [1-8]|STOP|REMOVE [1-8]|INSTALL (?:BEGIN [1-8] \d+ \d+|DATA \d+ [0-9A-F]{2,64}|COMMIT|ABORT))$/.test(command))
      throw error('Invalid applet command.', 'COMMAND');
    const deadline=Date.now()+timeoutMs;
    try {
      await this._deadline(session,session.write(encoder.encode(command+'\r\n')),deadline);
      for (let count=0;count<maxLines;count++) {
        if (Date.now()>=deadline) throw error('Applet response timed out. Reconnect before retrying.', 'TIMEOUT');
        const line=await this._line(session,deadline);
        notify(this.onOutput,line);
        // VM failures are asynchronous terminal output, not refusal of a later
        // status/stop request. Keep consuming through that request's own reply.
        if (/^APP ERROR runtime [a-z_]+$/.test(line)) continue;
        if (/^APP (?:ERROR|ERR)\b/.test(line)||/^ERR /.test(line)) throw refusal(line);
        if (accept(line)) return line;
        if (collect && /^(?:APP STORE |APP SLOT )/.test(line)) collect.push(line);
        else if (/^APP OK\b/.test(line)) throw error('Unexpected applet acknowledgment. Reconnect before retrying.', 'PROTOCOL');
      }
      throw error('Too much unsolicited applet output. Stop the applet or reconnect.', 'FRAME');
    } catch (fault) {
      if (!['REFUSED','UNSUPPORTED','TRUNK_ACTIVE','PROGRAMMING_ACTIVE'].includes(fault.code)) this._invalidate(session,fault);
      throw fault;
    }
  }
  async _list(session) {
    const lines=[];
    lines.push(await this._exchange(session,'APP STORE STATUS',line=>line==='APP OK STORE STATUS',
      {timeoutMs:this.operationTimeoutMs,collect:lines}));
    try {return parseAppletCatalogue(lines);} catch (fault) {this._invalidate(session,fault);throw fault;}
  }
  list() {return this._run(session=>this._list(session));}
  status() {return this._run(async session=>{
    const line=await this._exchange(session,'APP STATUS',line=>line.startsWith('APP STATUS '));
    try {return parseAppletStatus(line);} catch (fault) {this._invalidate(session,fault);throw fault;}
  });}
  run(slot) {
    slot=slotNumber(slot);
    return this._run(async session=>{
      await this._exchange(session,`APP RUN ${slot}`,line=>line===`APP OK RUN ${slot}`,{timeoutMs:this.operationTimeoutMs});
      return Object.freeze({slot,started:true});
    });
  }
  stop() {return this._run(async session=>{
    await this._exchange(session,'APP STOP',line=>/^APP STOPPED(?:; normal radio operation restored)?$/.test(line),{maxLines:4096});
    if (this._pending.length) {
      const fault=error('Unexpected bytes after applet stop. Reconnect before programming.', 'FRAME');
      this._invalidate(session,fault);throw fault;
    }
    session.release?.();return Object.freeze({stopped:true});
  });}
  install(slot,input) {
    slot=slotNumber(slot);
    const packageInfo=parseAppletPackage(input), data=packageInfo.data;
    return this._run(async session=>{
      const inventory=await this._list(session), before=inventory.slots[slot-1];
      if (inventory.readOnly) throw error('Foreign data makes applet storage read-only. Nothing was erased.', 'READ_ONLY');
      let begun=false, committed=false;
      try {
        await this._exchange(session,`APP INSTALL BEGIN ${slot} ${data.length} ${packageInfo.uploadCrc32}`,
          line=>line==='APP OK INSTALL BEGIN',{timeoutMs:this.operationTimeoutMs});begun=true;
        for (let offset=0;offset<data.length;offset+=32) {
          const chunk=data.subarray(offset,offset+32), hex=Array.from(chunk,byte=>byte.toString(16).toUpperCase().padStart(2,'0')).join('');
          await this._exchange(session,`APP INSTALL DATA ${offset} ${hex}`,line=>line===`APP OK INSTALL DATA ${offset+chunk.length}`);
          notify(this.onProgress,{phase:'upload',slot,current:offset+chunk.length,total:data.length});
        }
        await this._exchange(session,'APP INSTALL COMMIT',line=>line==='APP OK INSTALL COMMIT',{timeoutMs:this.operationTimeoutMs});
        committed=true;
        const after=(await this._list(session)).slots[slot-1];
        const expectedRevision=((before.revision+1)>>>0)||1;
        if (!after.present||after.name!==packageInfo.name||after.size!==data.length||before.present&&after.revision!==expectedRevision)
          throw error('The committed applet inventory does not match. Reconnect and inspect storage before retrying.', 'PROTOCOL');
        return Object.freeze({slot,verified:true,name:after.name,size:after.size,revision:after.revision,
          packageCrc32:packageInfo.crc32,uploadCrc32:packageInfo.uploadCrc32});
      } catch (fault) {
        if (begun&&!committed&&fault.code==='REFUSED') {
          try {await this._exchange(session,'APP INSTALL ABORT',line=>line==='APP OK INSTALL ABORT');} catch {/* Original refusal remains actionable. */}
        }
        if (committed || !['REFUSED','UNSUPPORTED','TRUNK_ACTIVE','PROGRAMMING_ACTIVE'].includes(fault.code)) {
          this._invalidate(session,fault);
          throw error('Applet installation outcome is uncertain. Reconnect and inspect the slot before retrying.', 'UNCERTAIN',{cause:fault});
        }
        throw fault;
      }
    });
  }
  remove(slot) {
    slot=slotNumber(slot);
    return this._run(async session=>{
      const before=await this._list(session);
      if (before.readOnly) throw error('Foreign data makes applet storage read-only. Nothing was erased.', 'READ_ONLY');
      try {
        await this._exchange(session,`APP REMOVE ${slot}`,line=>line===`APP OK REMOVE ${slot}`,{timeoutMs:this.operationTimeoutMs});
        if ((await this._list(session)).slots[slot-1].present) throw error('The applet slot is still present after removal.', 'PROTOCOL');
      } catch (fault) {
        if (['REFUSED','UNSUPPORTED','TRUNK_ACTIVE','PROGRAMMING_ACTIVE'].includes(fault.code)) throw fault;
        this._invalidate(session,fault);throw error('Removal outcome is uncertain. Reconnect and inspect storage.', 'UNCERTAIN',{cause:fault});
      }
      return Object.freeze({slot,removed:true,verified:true});
    });
  }
}
