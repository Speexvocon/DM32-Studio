// SPDX-License-Identifier: GPL-3.0-or-later
// Compatibility hints plus API presence; this does not request a serial port.
export function browserSupport({navigator=globalThis.navigator,secureContext=globalThis.isSecureContext}={}) {
  const ua=typeof navigator?.userAgent==='string'?navigator.userAgent:'';
  const data=navigator?.userAgentData,platform=data?.platform||navigator?.platform||'';
  const mobile=data?.mobile===true||/Android|iPhone|iPad|iPod|CriOS|EdgiOS|FxiOS|OPiOS|\bMobile\b/i.test(ua)
    ||/Android|iOS|iPhone|iPad|iPod/i.test(platform)
    ||(/Macintosh/i.test(ua)&&navigator?.maxTouchPoints>1);
  const brands=Array.isArray(data?.brands)?data.brands:[];
  const chromium=brands.some(item=>/^(Chromium|Google Chrome|Microsoft Edge|Opera|Opera GX|Brave|Vivaldi)$/i.test(item?.brand||''))
    ||/\b(?:Chrome|Chromium|Edg|OPR)\/\d/i.test(ua);
  if(mobile||!chromium)return {supported:false,reason:'unsupported-browser',
    message:'Only desktop Chromium-based browsers are supported. Use desktop Chrome or Edge. Firefox, Safari and mobile browsers are not supported.'};
  if(secureContext!==true)return {supported:false,reason:'insecure-context',
    message:'Open the firmware installer over HTTPS or localhost to use the programming cable.'};
  if(typeof navigator?.serial?.requestPort!=='function')return {supported:false,reason:'web-serial-unavailable',
    message:'Web Serial is unavailable in this browser or blocked by its settings. Use desktop Chrome or Edge with Web Serial enabled.'};
  return {supported:true,reason:'',message:''};
}
