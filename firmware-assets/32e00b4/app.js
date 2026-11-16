// SPDX-License-Identifier: GPL-3.0-or-later
import { WebFlashDevice } from './device.js';
import { validateBackup, sealBackup, compareSnapshot, prepareRelease, validatePrepared, verifyInstalled } from './package.js';
import { backupCompatibility, buildBackupZip, createFullDump } from './backup-export.js';

const root = document.getElementById('flasher');
const state = { device:null, busy:false, writing:false, backup:null, backupFiles:null, backupSaved:false,
  prepared:null, release:null, packageSaved:false, preflight:false, identified:false, verified:false, controller:null, logs:[],
  dumpFiles:null, dumpEvidence:null, dumpSaved:false };
const ui = {};
const downloads = new Set();
function h(tag, attrs={}, ...children) {
  const node=document.createElement(tag);
  for(const [key,value] of Object.entries(attrs)) {
    if(key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(),value);
    else if(key==='class') node.className=value;
    else node.setAttribute(key,value);
  }
  for(const child of children.flat()) if(child!==null) node.append(child instanceof Node?child:document.createTextNode(String(child)));
  return node;
}
function button(text, action, kind='') { return h('button',{type:'button',class:kind,onclick:action},text); }
function log(text) { state.logs.push(String(text));state.logs=state.logs.slice(-250);ui.log.textContent=state.logs.join('\n');ui.log.scrollTop=ui.log.scrollHeight; }
function notice(text,error=false) { ui.statusText.textContent=text;ui.status.classList.toggle('error',error); }
function resetChecks() { state.preflight=false;state.identified=false;state.verified=false;ui.confirm.checked=false; }
function compatibility() { return backupCompatibility(state.backup||state.dumpEvidence,ui.firmware?.value||''); }
function backupOnly() { return ui.backupOnly.checked||ui.incompatible.checked||compatibility().incompatible; }
function requireInstallation() {
  if(ui.incompatible.checked||compatibility().incompatible)throw new Error('Installation is disabled. RF-B / DM32.NRFB.01.050 is currently incompatible; support planned. Full dump backup and download remain available.');
  if(ui.backupOnly.checked)throw new Error('Backup / full dump only is selected. Installation is disabled; backup and download remain available.');
}
function policyChanged() {
  resetChecks();state.prepared=null;state.release=null;state.packageSaved=false;state.transferComplete=false;
  if(backupOnly())ui.newBackup.open=true;
  refresh();
}
function clearBackup() {
  state.backup=null;state.backupFiles=null;state.backupSaved=false;state.dumpFiles=null;state.dumpEvidence=null;state.dumpSaved=false;
  state.prepared=null;state.release=null;state.packageSaved=false;state.transferComplete=false;resetChecks();
}
function progress(value,total) {
  const current=Number(value?.current??value?.done??value??0),maximum=Number(value?.total??total??1);
  ui.progress.value=Math.min(1,Math.max(0,current/Math.max(1,maximum)));
}
function refresh() {
  const readOnly=backupOnly();
  for(const node of root.querySelectorAll('input,button')) node.disabled=state.busy;
  ui.connect.disabled=state.busy||!!state.device;
  ui.close.disabled=state.busy||!state.device;
  ui.create.disabled=state.busy||!state.device;
  ui.saveBackup.disabled=state.busy||!(state.backupFiles||state.dumpFiles);
  ui.downloadBackup.disabled=state.busy||!(state.dumpFiles||state.backupFiles);
  ui.release.disabled=state.busy||readOnly||!state.backup;
  ui.package.disabled=state.busy||readOnly||!state.backup||!state.release;
  ui.savePackage.disabled=state.busy||readOnly||!state.prepared;
  ui.preflight.disabled=state.busy||readOnly||!state.device||!state.prepared||!state.backupSaved;
  ui.identify.disabled=state.busy||readOnly||!state.preflight;
  ui.flash.disabled=state.busy||readOnly||!state.preflight||!state.identified||!state.backupSaved||!state.packageSaved||!ui.confirm.checked;
  ui.verify.disabled=state.busy||!state.device||!state.prepared||!state.transferComplete;
  ui.cancel.disabled=!state.busy||state.writing;
  ui.connection.textContent=state.device?'Cable selected':'Disconnected';
  ui.modeResult.textContent=readOnly?'Backup / full dump only: installation is disabled.':'Installer mode: only qualified radio and codec profiles are supported.';
  ui.backupResult.textContent=state.backup?`Validated backup: ${state.backup.manifest.radio_label}\n${state.backupSaved?'Saved on disk':'Save the backup folder before continuing'}`:
    state.dumpFiles?`Full dump: ${state.dumpEvidence.manifest.radio_label}\n1 MiB program + 16 MiB data; two matching full reads.\n${state.dumpSaved?'Dump folder saved and read back.':'Download the full dump ZIP or save its folder.'}\nDiagnostic dump only; not a sealed installation backup.`:'No backup selected.';
  ui.packageResult.textContent=state.prepared?`Version ${state.prepared.manifest.version} · build ${state.prepared.manifest.source_commit?.slice(0,7)}\n${state.prepared.raw.length.toLocaleString()} application/codec bytes\n${state.packageSaved?'Recovery package saved on disk':'Save the prepared package before flashing'}`:'No firmware package selected.';
}
async function run(label, action, {writing=false}={}) {
  if(state.busy)return;
  state.busy=true;state.writing=writing;state.controller=new AbortController();ui.progress.value=0;notice(label);refresh();
  try { await action(state.controller.signal); }
  catch(error) {
    resetChecks();
    const recovery=state.writing?'\nTransfer did not complete. Keep your saved package. Re-enter factory update mode and repeat the same installation; do not substitute a bare application.':'';
    const dumpRecovery=state.dumpFiles&&!state.backup?'\nThe matching full dump is available: use Download full dump ZIP to save it for private review.':'';
    notice(String(error?.message||error)+recovery+dumpRecovery,true);log('Error: '+String(error?.message||error));
  } finally { state.busy=false;state.writing=false;state.controller=null;refresh(); }
}
async function readFolder(input) {
  const files=[...(input.files||[])];input.value='';
  if(!files.length)throw new Error('No folder selected.');
  if(files.reduce((n,f)=>n+f.size,0)>64*1024*1024)throw new Error('Select only the backup or release folder, not the entire repository (64 MiB limit).');
  const map=new Map();
  for(const file of files) {
    const relative=(file.webkitRelativePath||file.name).split('/').slice(file.webkitRelativePath?1:0).join('/');
    if(!relative||relative.split('/').some(part=>part==='..'||part==='.')||map.has(relative))throw new Error('Invalid or repeated file path.');
    map.set(relative,new Uint8Array(await file.arrayBuffer()));
  }
  return map;
}
function jsonFile(files,name) {
  const bytes=files.get(name);
  if(!bytes)throw new Error(`Choose the folder containing ${name}.`);
  if(bytes.length>1024*1024)throw new Error(`${name} is too large.`);
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
async function saveFolder(files,prefix) {
  if(!window.showDirectoryPicker)throw new Error('Saving installer folders requires desktop Chrome or Edge over HTTPS or localhost.');
  const parent=await window.showDirectoryPicker({mode:'readwrite'});
  const name=prefix+'-'+new Date().toISOString().replace(/[:.]/g,'-');
  try { await parent.getDirectoryHandle(name);throw new Error('That output folder exists. Choose a new destination.'); }
  catch(error) { if(error.name!=='NotFoundError')throw error; }
  const folder=await parent.getDirectoryHandle(name,{create:true});
  // Immutable validated bytes only; a failed/partial save never passes the save gate.
  for(const [relative,bytes] of files) {
    let directory=folder;const parts=relative.split('/');
    if(parts.some(p=>!p||p==='.'||p==='..'))throw new Error('Invalid output path.');
    for(const part of parts.slice(0,-1))directory=await directory.getDirectoryHandle(part,{create:true});
    const handle=await directory.getFileHandle(parts.at(-1),{create:true}),writer=await handle.createWritable();
    try { await writer.write(bytes);await writer.close(); } catch(error) { await writer.abort().catch(()=>{});throw error; }
    const actual=new Uint8Array(await (await handle.getFile()).arrayBuffer());
    if(actual.length!==bytes.length||!actual.every((b,i)=>b===bytes[i]))throw new Error('Saved file did not read back correctly: '+relative);
  }
  return name;
}
async function connect() {
  if(state.busy)return;
  if(!navigator.serial)return notice('Open this page in desktop Chrome or Edge over HTTPS or localhost. Web Serial is unavailable.',true);
  const device=new WebFlashDevice({serial:navigator.serial,log});
  await run('Choose the programming cable. Close its CPS connection first.',async signal=>{
    try {
      await device.connect();
      if(signal.aborted)throw new Error('Connection cancelled.');
      state.device=device;resetChecks();notice('Cable selected. Keep PTT released. For a cold read, leave the radio OFF until the reader asks you to turn it on.');
    } catch(error) { await device.close().catch(()=>{});throw error; }
  });
}
async function close() { await run('Closing cable…',async()=>{await state.device?.close();state.device=null;resetChecks();notice('Disconnected.');}); }
async function loadBackup(event) {
  await run('Checking the selected backup locally…',async()=>{
    clearBackup();
    const files=await readFolder(event.target),backup=await validateBackup(files);
    state.backup=backup;state.backupFiles=files;state.backupSaved=true;state.prepared=null;state.release=null;state.packageSaved=false;state.transferComplete=false;resetChecks();
    notice(backupOnly()?'Sealed backup validated. This radio is in backup-only mode; download its full dump ZIP to share privately.':'Sealed backup validated. Select a beta release folder or your existing prepared package.');
  });
}
async function createBackup() {
  const label=ui.label.value.trim(),firmware=ui.firmware.value.trim();
  if(!label||!firmware)return notice('Enter a radio label and the installed firmware version before creating a backup.',true);
  await run('Reader starting. Leave the radio OFF; follow the power-on cue in the activity log.',async signal=>{
    clearBackup();
    const first=await state.device.readSnapshot({onProgress:progress,signal,fresh:true});
    notice('First read complete. Leave power and cable unchanged; reading both memories again.');
    const second=await state.device.readSnapshot({onProgress:progress,signal});
    state.dumpFiles=await createFullDump(first,second,label,firmware);
    state.dumpEvidence={manifest:{radio_label:label,installed_firmware:firmware},program:state.dumpFiles.get('program.bin')};
    if(backupOnly()) {
      notice('Two complete reads match. Download the full dump ZIP or save its folder, then disconnect and power-cycle normally. Installation is disabled; send the saved ZIP privately to your maintainer.');
      return;
    }
    const files=await sealBackup(first,second,label,firmware),backup=await validateBackup(files,label);
    state.backup=backup;state.backupFiles=files;state.backupSaved=false;state.prepared=null;state.release=null;state.packageSaved=false;state.transferComplete=false;resetChecks();
    notice('Two complete reads match. Save the backup to disk before continuing. Leave the radio powered on in the RAM reader.');
  });
}
async function loadFirmware(event,prepared=false) {
  await run('Validating firmware and native codec locally…',async()=>{
    requireInstallation();
    if(!state.backup)throw new Error('Validate or create your radio backup first.');
    const files=await readFolder(event.target);let result;
    if(prepared) {
      if(!state.release)throw new Error('Choose the matching beta release folder before opening a prepared package.');
      const descriptor=jsonFile(files,'package.json'),path=descriptor.release_manifest;
      if(typeof path!=='string'||path.startsWith('/')||path.includes('\\')||path.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('Invalid package release path.');
      // The separately selected release is the provenance reference, never a
      // release or application smuggled into an arbitrary prepared package.
      files.set(path,state.release.bytes);
      files.set(path.slice(0,path.lastIndexOf('/')+1)+state.release.manifest.application.file,state.release.application);
      result=await validatePrepared(files,state.backup);
    }
    else {
      const release=jsonFile(files,'release.json');const app=files.get(release.application?.file);
      if(!app)throw new Error('The selected folder is missing the application named in release.json.');
      result=await prepareRelease({bytes:files.get('release.json'),path:`firmware/v${release.version}/release.json`},app,state.backup);
      state.release={manifest:release,bytes:files.get('release.json'),application:app};
    }
    state.prepared=result;state.packageSaved=prepared;state.transferComplete=false;resetChecks();
    notice(prepared?'Private prepared package validated. Run the fresh preservation check.':'Native codec merged locally. Save your private recovery package, then run the fresh preservation check.');
  });
}
async function preflight() {
  resetChecks();
  await run('Starting the preservation read. Follow the activity log; keep PTT released.',async signal=>{
    requireInstallation();
    const snapshot=await state.device.readSnapshot({onProgress:progress,signal});
    compareSnapshot(snapshot,state.backup);state.preflight=true;
    notice('Fresh bootloader and calibration checks passed. Switch OFF, then hold PTT + SK1 while turning ON. Release both when the green LED lights. Then select Identify update mode.');
  });
}
async function identify() {
  await run('Listening for BFUV32-V2 factory update mode. Nothing has been erased.',async signal=>{
    requireInstallation();
    const identity=await state.device.factoryIdentify({signal});
    if(identity?.id!=='BFUV32-V2')throw new Error('The factory loader did not identify as BFUV32-V2.');
    state.identified=true;notice('DM32 factory loader identified. Review the version and backup label, then confirm the installation.');
  });
}
async function reviewFlash() {
  if(state.busy||backupOnly()||!state.preflight||!state.identified||!state.backupSaved||!state.packageSaved||!ui.confirm.checked)return;
  const p=state.prepared;
  const dialog=h('dialog',{class:'small-dialog'},h('div',{class:'dialog-header'},h('h2',{},'Install this firmware?')),
    h('div',{class:'dialog-body flash-review'},`Radio: ${state.backup.manifest.radio_label}\nVersion: ${p.manifest.version}\nSource: ${p.manifest.source_commit}\n\nThe factory loader erases and replaces the application and native-codec area. Keep the cable connected and power steady until transfer completes. Bootloader and data memory are outside this write.`));
  const footer=h('div',{class:'dialog-footer'}),cancel=button('Cancel',()=>dialog.close()),install=button('Install firmware',()=>{dialog.close('install');},'primary');footer.append(cancel,install);dialog.append(footer);document.body.append(dialog);
  dialog.addEventListener('close',async()=>{
    const accepted=dialog.returnValue==='install';dialog.remove();if(!accepted)return;
    await run('Installing firmware. Keep power and cable connected.',async signal=>{
      requireInstallation();
      if(p!==state.prepared||!state.preflight||!state.identified||!ui.confirm.checked)throw new Error('The reviewed package or connection changed. Repeat preservation and identification.');
      state.transferComplete=false;state.verified=false;
      await state.device.write(p.raw,{onProgress:progress,onPhase:phase=>notice(phase==='erase'?'Erasing application/codec area. Keep power and cable connected.':'Writing firmware. Keep power and cable connected.'),signal});
      state.transferComplete=true;state.identified=false;state.preflight=false;
      notice('Transfer completed. Independent verification is still required. Switch OFF, remove/refit the battery, and leave the switch OFF. Then select Verify installed firmware and wait for the normal power-on cue.');
    },{writing:true});
  },{once:true});dialog.showModal();
}
async function verify() {
  await run('Preparing independent readback. Leave the radio OFF until the activity log gives the power-on cue.',async signal=>{
    const snapshot=await state.device.readSnapshot({fresh:true,onProgress:progress,signal});
    const proof=await verifyInstalled(snapshot,state.backup,state.prepared.raw);
    state.verified=true;log('Verification evidence: '+JSON.stringify(proof));
    notice('VERIFIED: the installed application and native codec match, and the bootloader and factory calibration are preserved. Disconnect, then power-cycle normally to return to the radio.');
  });
}
async function downloadBackup() {
  await run('Building your private full dump ZIP locally…',async()=>{
    const files=state.dumpFiles||state.backupFiles;
    if(!files)throw new Error('Create or open a validated backup first.');
    const archive=buildBackupZip(files),url=URL.createObjectURL(new Blob([archive],{type:'application/zip'}));
    downloads.add(url);
    const link=h('a',{href:url,download:'dm32-full-dump-'+new Date().toISOString().replace(/[:.]/g,'-')+'.zip',hidden:''});
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>{URL.revokeObjectURL(url);downloads.delete(url);},60000);
    notice('Full dump ZIP download requested. Confirm it finished in your browser Downloads, then send the ZIP privately to your maintainer using your agreed contact method. It contains firmware, calibration and personal settings; do not post it publicly. No files were uploaded. Disconnect and power-cycle normally when finished.');
  });
}
function picker(id,action) {const input=h('input',{id,type:'file',webkitdirectory:'',directory:'',multiple:'',onchange:action});return input;}
function card(number,title,...children) {return h('section',{class:'flash-card'},h('h2',{},h('span',{class:'flash-number'},number),title),...children);}
function field(label,input) {return [h('label',{for:input.id},label),input];}
ui.connection=h('span',{class:'tag neutral'},'Disconnected');ui.statusText=h('span',{},'No radio is connected. Files stay on this computer.');ui.progress=h('progress',{max:'1',value:'0','aria-label':'Operation progress'});ui.status=h('div',{class:'flash-state',role:'status','aria-live':'polite'},ui.statusText,ui.progress);
ui.connect=button('Connect cable',connect,'primary');ui.close=button('Disconnect',close);ui.cancel=button('Stop waiting / reading',()=>state.controller?.abort());
ui.backupOnly=h('input',{id:'backup-only',type:'checkbox',onchange:policyChanged});ui.backupOnly.checked=new URL(location.href).searchParams.get('backup')==='1';
ui.incompatible=h('input',{id:'incompatible-radio',type:'checkbox',onchange:policyChanged});ui.modeResult=h('p',{class:'flash-mode-result'});
ui.label=h('input',{id:'radio-label',type:'text',maxlength:'80',placeholder:'Your label for this radio'});ui.firmware=h('input',{id:'installed-firmware',type:'text',maxlength:'80',placeholder:'For example, DM32.NRFB.01.050',oninput:policyChanged});
ui.backup=picker('backup-folder',loadBackup);ui.release=picker('release-folder',e=>loadFirmware(e));ui.package=picker('prepared-folder',e=>loadFirmware(e,true));ui.create=button('Create two-read backup',createBackup);
ui.saveBackup=button('Save backup folder',()=>run('Saving private backup…',async()=>{
  const sealed=Boolean(state.backupFiles),name=await saveFolder(state.backupFiles||state.dumpFiles,sealed?'dm32-backup':'dm32-full-dump');
  if(sealed)state.backupSaved=true;else state.dumpSaved=true;
  notice('Backup saved and read back: '+name+(sealed?'':'\nFull diagnostic dump only. Zip this entire folder to send privately, or use Download full dump ZIP. Disconnect and power-cycle normally when finished.'));
}));
ui.downloadBackup=button('Download full dump ZIP',downloadBackup);ui.downloadBackup.id='download-backup';
ui.savePackage=button('Save private package',()=>run('Saving private recovery package…',async()=>{const name=await saveFolder(state.prepared.files,'dm32-package');state.packageSaved=true;notice('Private package saved and read back: '+name);}));
ui.backupResult=h('div',{class:'flash-result'});ui.packageResult=h('div',{class:'flash-result'});ui.preflight=button('Check radio preservation',preflight,'primary');ui.identify=button('Identify update mode',identify);ui.flash=button('Review & install',reviewFlash,'primary');ui.verify=button('Verify installed firmware',verify,'primary');ui.confirm=h('input',{type:'checkbox',id:'same-radio',onchange:refresh});
ui.log=h('pre',{class:'flash-log','aria-label':'Firmware activity log'});
ui.newBackup=h('details',{},h('summary',{},'Create a first-install backup / full dump'),...field('Radio label',ui.label),...field('Installed firmware',ui.firmware),h('p',{},'Start with the radio OFF, cable connected and PTT released. After starting, wait for the power-on cue in the log. A full dump reads both memories twice; no codec recognition is required in backup-only mode.'),ui.create);
ui.newBackup.open=ui.backupOnly.checked;
root.replaceChildren(h('div',{class:'flash-intro'},h('h1',{},'Install or update your DM32'),h('span',{class:'tag warn'},'Experimental browser installer'),h('p',{},'Use your own backup and a release folder from the beta repository. Preparation happens in your browser; native codec, calibration and backup files are never uploaded. Export your codeplug in CPS and disconnect it before starting. The CLI installer remains available.')),
 h('section',{class:'flash-compatibility','aria-label':'Radio compatibility'},h('h2',{},'RF-B / DM32.NRFB.01.050: currently incompatible; support planned'),h('p',{},'Do not install the current multimode firmware on the newer RF-B radio. You can save a full dump here now and send it privately to the maintainer to help upcoming support. Puya flash alone does not identify RF-B.'),h('label',{class:'flash-check',for:'incompatible-radio'},ui.incompatible,'My radio has RF-B hardware, or it shipped with DM32.NRFB.01.050.'),h('label',{class:'flash-check',for:'backup-only'},ui.backupOnly,'Backup / full dump only (no installation)'),ui.modeResult),
 h('div',{},ui.connection,' ',ui.connect,ui.close,ui.cancel),ui.status,
 h('div',{class:'flash-grid'},
  card(1,'Your radio backup / full dump',h('p',{},'Open an existing sealed backup, or create one with two matching reads of the complete 1 MiB program and 16 MiB data memories. Backup-only mode also supports unrecognized stock firmware.'),...field('Existing sealed backup folder',ui.backup),ui.newBackup,ui.saveBackup,ui.downloadBackup,h('p',{},'To forward a dump: confirm the ZIP finished downloading, then send it privately to your maintainer. It includes the complete firmware and data flash, including personal settings and calibration. Nothing is uploaded automatically.'),ui.backupResult),
  card(2,'Firmware & native codec',h('p',{},'Choose the release folder containing release.json and its application. Your radio’s verified native codec is added locally.'),...field('Beta release folder',ui.release),h('details',{},h('summary',{},'Use an existing private prepared package'),h('p',{},'First select the matching release above, then choose the folder containing package.json and both application-codec files.'),ui.package),ui.savePackage,ui.packageResult),
  card(3,'Preservation & update mode',h('p',{},'Read the connected radio and compare its bootloader and factory calibration with your own backup.'),ui.preflight,h('p',{},'After that check passes, enter factory update mode: OFF → hold PTT + SK1 → ON → green LED → release both keys.'),ui.identify),
  card(4,'Install & independently verify',h('label',{class:'flash-check',for:'same-radio'},ui.confirm,'I am using the same labeled radio, and my backup and prepared package are saved on disk.'),ui.flash,h('p',{},'Transfer completion is followed by a new RAM-reader session to verify the entire application/codec and protected regions.'),ui.verify),
  h('section',{class:'flash-card flash-wide'},h('h2',{},'Activity'),ui.log)),
 h('p',{class:'flash-help'},'Desktop Chrome or Edge over HTTPS or localhost. This tool is specific to DM32 / BFUV32-V2. It does not write the bootloader or external data flash. Local hashes detect file damage; they do not authenticate a firmware publisher. Select release files obtained from your trusted beta repository.'));
window.addEventListener('beforeunload',event=>{if(state.busy){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>{state.controller?.abort();state.device?.close().catch(()=>{});for(const url of downloads)URL.revokeObjectURL(url);downloads.clear();});
refresh();
