import {
  createDefaultModel, decodePayload, encodePayload, validateModel,
  exportFile, importFile, crc32, setChannelMode, POWER_LEVELS, BUTTON_ACTIONS,
} from './model.js';
import { CpsClient } from './transport.js';
import { History } from './vendor/undo.js';

// The editor follows RadioFoundry's useful table / details / problems workflow.
// This logical CPS transport is specific to the custom unified DM32 firmware.
// Editing a field, opening a file and connecting a cable never write to a radio.
const clone = value => structuredClone(value);
const signature = model => JSON.stringify(model);
const paths = {
  radio: 'M7 7h10v14H7z M10 7V3 M10 3l5-2 M10 11h4 M10 15h4 M10 18h4',
  plug: 'M9 3v5 M15 3v5 M7 8h10v3a5 5 0 0 1-5 5v5 M9 20h6',
  channels: 'M4 5h16 M4 12h16 M4 19h16 M8 3v4 M15 10v4 M11 17v4',
  vfo: 'M3 16a9 9 0 0 1 18 0 M7 16a5 5 0 0 1 10 0 M12 16v3 M5 4l2 2 M19 4l-2 2',
  scan: 'M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5 M8 12h8',
  settings: 'M12 3v18 M3 7h18 M3 17h18 M9 4v6 M15 14v6',
  check: 'M5 12l4 4L19 6',
  alert: 'M12 3L2 21h20L12 3z M12 9v5 M12 17v1',
  folder: 'M3 7V5h7l2 2h9v13H3V7z',
  save: 'M4 3h13l3 3v15H4V3z M8 3v6h8V3 M8 21v-8h8v8',
  search: 'M16 16l5 5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  plus: 'M12 4v16 M4 12h16',
  edit: 'M4 16l-1 5 5-1L20 8l-4-4L4 16z M14 6l4 4',
  undo: 'M8 5L3 10l5 5 M3 10h10a7 7 0 0 1 7 7',
  redo: 'M16 5l5 5-5 5 M21 10H11a7 7 0 0 0-7 7',
  shield: 'M12 2l8 3v6c0 5-4 9-8 11-4-2-8-6-8-11V5l8-3z M8 12l3 3 5-6',
  download: 'M12 3v12 M7 10l5 5 5-5 M4 17v4h16v-4',
  upload: 'M12 16V4 M7 9l5-5 5 5 M4 17v4h16v-4',
  info: 'M12 11v6 M12 7v1 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
};

function icon(name, size = 18) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size,
    fill: 'none', stroke: 'currentColor', 'stroke-width': '1.65', 'stroke-linecap': 'round',
    'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', paths[name] || paths.info);
  svg.append(path);
  return svg;
}

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (key === 'checked' || key === 'disabled' || key === 'value') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
function replace(node, ...children) {
  // Native replaceChildren stringifies null/false, unlike the h() helper.
  node.replaceChildren(...children.flat(Infinity).filter(child => child != null && child !== false));
}

function button(text, action, { kind = '', small = false, disabled = false, title, glyph, ...rest } = {}) {
  return h('button', { type: 'button', class: `${kind} ${small ? 'small' : ''}`.trim(),
    disabled: disabled || S.busy, onclick: action, title, ...rest },
  glyph ? h('span', { style: 'display:inline-flex;align-items:center;gap:7px' }, icon(glyph, 15), text) : text);
}
function badge(text, type = '') { return h('span', { class: `tag ${type}` }, text); }
function field(label, control, help = '', full = false) {
  return h('label', { class: `field${full ? ' full' : ''}` }, h('span', {}, label), control,
    help ? h('small', {}, help) : null);
}
function select(options, value, onChange, attrs = {}) {
  const input = h('select', { disabled: S.busy, onchange: onChange, ...attrs },
    options.map(option => {
      const [key, text] = Array.isArray(option) ? option : [option, option];
      return h('option', { value: key }, text);
    }));
  input.value = String(value);
  return input;
}
function input(value, onChange, attrs = {}) {
  return h('input', { value, disabled: S.busy, onchange: onChange, ...attrs });
}
function check(label, checked, onChange, attrs = {}) {
  return h('label', { class: 'check-label' },
    h('input', { type: 'checkbox', checked, disabled: S.busy, onchange: onChange, ...attrs }), label);
}
const S = {
  model: createDefaultModel(), clean: '', name: 'Untitled codeplug', tab: 'channels',
  selected: new Set(), search: '', mode: 'all', showEmpty: true,
  history: new History(), busy: false, operation: '', progress: 0,
  client: null, baseline: null, notice: null, source: 'new', fileOrigin: null,
};
S.clean = signature(S.model);
const root = document.getElementById('app');
const fileInput = h('input', { type: 'file', accept: '.json,.dm32,.dm32.json',
  style: 'display:none', 'aria-label': 'Open codeplug file', onchange: openSelectedFile });
document.body.append(fileInput);

function connected() { return Boolean(S.client?.connected); }
function dirty() { return signature(S.model) !== S.clean; }
function problems() {
  try { return validateModel(S.model); }
  catch (error) { return [{ path: 'codeplug', message: error.message || String(error) }]; }
}
function encoded() { try { return encodePayload(S.model); } catch { return null; } }
function sameBytes(a, b) { return a?.length === b?.length && Array.from(a).every((value, i) => value === b[i]); }
function radioChanged() { return S.baseline ? !sameBytes(encoded(), S.baseline.payload) : true; }
function occupied() { return S.model.channels.filter(Boolean).length; }
function fmtFrequency(hz) { return hz ? (hz / 1e6).toFixed(6) : '—'; }
function fmtNac(nac) { return Number(nac).toString(16).toUpperCase().padStart(3, '0'); }
function parseFrequency(text) {
  const value = String(text).trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) throw new Error('Enter a frequency in MHz, with up to six decimal places.');
  const number = Number(value);
  return Math.round(number >= 1000000 ? number : number * 1000000);
}
function defaultChannel(name = '') {
  return { name, rxHz: 145700000, txHz: 145700000, mode: 'P25', nac: 0x293,
    talkgroup: 1, filter: 'PROM', rxOnly: false, scanLists: [], squelch: 3, powerLevel: 0,
    txTone: { type: 'none', value: 0 }, rxTone: { type: 'none', value: 0 } };
}
function normalizedMode(channel, mode) {
  setChannelMode(channel, mode);
}
function say(message, error = false) { S.notice = { message, error }; render(); }

// Small full-model history; radio identity and the read baseline are never undone.
function change(label, fn) {
  if (S.busy) return false;
  const before = signature(S.model);
  S.history.record(S.model, label);
  fn();
  if (before === signature(S.model)) { S.history.cancel(); return false; }
  render();
  return true;
}
function undo() {
  if (S.busy || !S.history.canUndo) return;
  S.history.undo(S.model);
  render();
}
function redo() {
  if (S.busy || !S.history.canRedo) return;
  S.history.redo(S.model);
  render();
}
function load(model, name, source, origin = null) {
  S.model = clone(model); S.name = name; S.source = source; S.fileOrigin = origin;
  S.clean = signature(S.model); S.history.reset(); S.selected.clear();
  S.notice = null;
  render();
}

function render() {
  const issues = problems();
  const isConnected = connected();
  replace(root,
    h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, h('div', { class: 'brand-mark' }, icon('radio', 26)),
        h('div', {}, h('div', { class: 'brand-title' }, 'DM32 ', h('span', {}, 'Studio')),
          h('div', { class: 'brand-sub' }, 'P25 + DMR + FM · Custom firmware programming'))),
      h('div', { class: 'top-actions' },
        button('New', newFile, { kind: 'quiet' }),
        button('Open', () => { if (!S.busy) fileInput.click(); }, { glyph: 'folder' }),
        button('Save file', saveFile, { glyph: 'save', disabled: Boolean(issues.length) }))),
    h('section', { class: 'connection-strip', 'aria-label': 'Radio connection' },
      h('div', { class: 'connection-main' },
        h('div', { class: `connection-icon ${isConnected ? 'connected' : ''}` }, icon('plug', 21)),
        h('div', {}, h('div', { class: 'connection-title' },
          isConnected ? 'DM32 connected' : S.client ? 'Connection needs resetting' : 'Work on your codeplug',
          badge(isConnected ? 'CONNECTED' : S.client ? 'RECONNECT' : 'OFFLINE', isConnected ? '' : S.client ? 'warn' : 'neutral')),
        h('div', { class: 'connection-detail' },
          isConnected ? S.baseline ? `Radio revision ${S.baseline.revision} · ${radioChanged() ? 'Changes are ready to review' : 'Working copy matches the radio'}` :
            'Read the radio once to enable reviewed uploads.' : S.client ? 'Disconnect to close the uncertain port, then reconnect and read the radio.' :
            'Edit and save locally. Connect your radio when you are ready.'))),
      h('div', { class: 'radio-actions' },
        button(S.client ? 'Disconnect' : 'Connect radio', S.client ? disconnectRadio : connectRadio,
          { kind: S.client ? '' : 'dark', glyph: 'plug' }),
        button('Read radio', readRadio, { glyph: 'download', disabled: !isConnected }),
        button('Review & write', reviewWrite, { kind: 'primary', glyph: 'upload',
          disabled: !isConnected || !S.baseline || Boolean(issues.length) || !radioChanged(),
          title: !S.baseline ? 'Read this connected radio before writing.' : 'Review changes before writing to the radio.' }))),
    S.busy ? h('div', { class: 'progress-box', role: 'status', 'aria-live': 'polite' },
      h('div', { class: 'progress-label', id: 'progress-label' }, S.operation),
      h('div', { class: 'progress-track' }, h('span', { id: 'progress-fill', style: `width:${S.progress || 7}%` }))) : null,
    h('div', { class: 'workspace' },
      h('aside', { class: 'sidebar' }),
      h('main', { class: 'content', id: 'main-view', role: 'tabpanel' })));

  // The nav is constructed separately so a real element, never an HTML string,
  // carries every user supplied name throughout the interface.
  const sidebar = root.querySelector('.sidebar');
  sidebar.replaceChildren(h('div', { class: 'eyebrow sidebar-label' }, 'Codeplug'),
    h('nav', { class: 'tab-list', role: 'tablist', 'aria-label': 'Codeplug sections' },
      [['channels', 'Channels', 'channels', occupied()], ['vfos', 'VFO A / B', 'vfo', 2],
        ['scan', 'Scan lists', 'scan', 4], ['settings', 'Radio settings', 'settings', null],
        ['functions', 'Functions', 'radio', null],
        ['problems', 'Problems', issues.length ? 'alert' : 'check', issues.length]].map(([id, title, glyph, count]) =>
        h('button', { type: 'button', class: `tab-button ${S.tab === id ? 'active' : ''}`, role: 'tab',
          'aria-selected': String(S.tab === id), 'aria-controls': 'main-view', disabled: S.busy,
          onclick: () => { if (!S.busy) { S.tab = id; render(); } } },
        icon(glyph, 17), title, count == null ? null : h('span', { class: 'tab-count' }, count)))),
    h('div', { class: 'sidebar-bottom' },
      h('div', { class: 'local-note' }, icon('shield', 14), 'Local by design'),
      'Your codeplug stays in this browser. No account, cloud service or background radio writes.',
      h('div', { style: 'margin-top:12px' }, 'DM-32UV · P25 Phase 1 / DMR / analog FM')));
  renderContent(issues);
}

function renderContent(issues = problems()) {
  const view = document.getElementById('main-view');
  const labels = {
    channels: ['Channels', 'Build a useful radio, one memory at a time. Frequencies are in MHz.'],
    vfos: ['VFO A / B', 'Two independent profiles, with one active receiver. Choose the starting context in Radio settings.'],
    scan: ['Scan lists', 'Keep up to four overlapping groups of channels. Membership is saved; scanning is started on the radio.'],
    settings: ['Radio settings', 'Digital radio identity, microphone gain and starting contexts.'],
    functions: ['Functions', 'Transmit controls, programmable buttons, FM broadcast and display behavior.'],
    problems: ['Codeplug checks', 'Resolve these settings before saving or writing. Checks never transmit or change the radio.'],
  };
  const [title, subtitle] = labels[S.tab];
  replace(view,
    h('div', { class: 'page-heading' }, h('div', {}, h('h1', {}, title), h('p', {}, subtitle)),
      S.tab === 'channels' ? h('div', { class: 'page-heading-actions' },
        button('Add channel', addChannel, { kind: 'primary', glyph: 'plus', disabled: occupied() === 32 })) :
        S.tab === 'problems' ? badge(issues.length ? `${issues.length} TO RESOLVE` : 'ALL CHECKS PASS', issues.length ? 'red' : '') : null),
    h('div', { class: 'document-state' }, h('span', { class: 'file-name' }, S.name),
      badge(dirty() ? 'UNSAVED EDITS' : S.source === 'radio' ? 'READ FROM RADIO' : S.source === 'file' ? 'FILE LOADED' : S.source === 'demo' ? 'EXAMPLE' : 'NEW', dirty() ? 'warn' : 'neutral'),
      connected() && S.baseline ? h('span', {}, radioChanged() ? 'Not yet written to radio' : 'In sync with radio') :
        h('span', {}, 'No radio write pending'),
      h('div', { class: 'history-actions' },
        button('Undo', undo, { kind: 'quiet', small: true, glyph: 'undo', disabled: !S.history.canUndo, title: S.history.past.at(-1)?.label || 'No edit to undo' }),
        button('Redo', redo, { kind: 'quiet', small: true, glyph: 'redo', disabled: !S.history.canRedo }))),
    S.notice ? h('div', { class: `notice ${S.notice.error ? 'error' : ''}`, role: S.notice.error ? 'alert' : 'status' },
      icon(S.notice.error ? 'alert' : 'check', 17), h('span', {}, S.notice.message),
      button('×', () => { S.notice = null; render(); }, { kind: 'quiet', 'aria-label': 'Dismiss message' })) : null,
    !occupied() && S.tab === 'channels' ? h('div', { class: 'banner' }, icon('info', 19),
      h('div', {}, h('strong', {}, 'Start with your radio or a local example. '),
        'Read an existing configuration, add a channel, or explore the editor. Nothing is written automatically.'),
      h('div', { class: 'banner-actions' }, button('Load example', loadDemo, { small: true }))) : null,
    S.tab === 'channels' ? channelsView() : S.tab === 'vfos' ? vfoView() : S.tab === 'scan' ? scanView() :
      S.tab === 'settings' ? settingsView() : S.tab === 'functions' ? functionsView() : problemsView(issues),
    h('div', { class: 'footer-hint' }, h('span', {}, 'Custom DM32 firmware only · 32 memories · 4 scan lists'),
      h('span', {}, 'Editing is local. Only “Review & write” changes the radio.')));
}

function channelsView() {
  const search = input(S.search, null, { type: 'search', placeholder: 'Search name, frequency or talkgroup',
    'aria-label': 'Search channels', oninput: event => { S.search = event.target.value; renderChannelRows(); } });
  const panel = h('section', { class: 'panel', 'aria-label': 'Channel memories' },
    h('div', { class: 'filter-toolbar' },
      h('div', { class: 'search-field' }, icon('search', 15), search),
      select([['all', 'All modes'], ['P25', 'P25'], ['DMR', 'DMR'], ['NFM', 'Narrow FM'], ['FM', 'Wide FM']], S.mode,
        event => { S.mode = event.target.value; renderChannelRows(); }, { 'aria-label': 'Filter by mode' }),
      check('Show empty', S.showEmpty, event => { S.showEmpty = event.target.checked; renderChannelRows(); }),
      h('div', { class: 'bulk-toolbar' },
        button('Duplicate', duplicateSelected, { small: true, disabled: S.selected.size !== 1 || occupied() === 32 }),
        button('Clear selected', clearSelected, { small: true, disabled: !S.selected.size }))),
    h('div', { class: 'channel-table-wrap' }, h('table', { class: 'channel-table' },
      h('thead', {}, h('tr', {},
        h('th', {}, h('input', { type: 'checkbox', disabled: S.busy, 'aria-label': 'Select visible configured channels',
          onchange: event => {
            for (const index of visibleIndices().filter(index => S.model.channels[index])) {
              if (event.target.checked) S.selected.add(index); else S.selected.delete(index);
            }
            render();
          } })), ['#', 'Channel name', 'Receive · MHz', 'Mode', 'NAC / CC', 'Destination', 'Scan', ''].map(label => h('th', {}, label)))),
      h('tbody', { id: 'channel-rows' }))),
    h('div', { class: 'table-footer' }, h('span', { id: 'channel-count' }),
      h('span', {}, 'Edit a cell · Open details for TX, tones & filters')));
  queueMicrotask(renderChannelRows);
  return h('div', {}, panel,
    h('div', { class: 'section-footer' }, icon('info', 14),
      'Digital call settings belong to each channel. P25 PROM accepts supported clear calls across NACs. DMR PROM accepts any color code and destination on the selected timeslot; it does not monitor both slots.'));
}
function visibleIndices() {
  const query = S.search.trim().toLowerCase();
  return S.model.channels.map((_, index) => index).filter(index => {
    const channel = S.model.channels[index];
    if (!channel) return S.showEmpty && !query && S.mode === 'all';
    if (S.mode !== 'all' && channel.mode !== S.mode) return false;
    return !query || `${index + 1} ${channel.name} ${fmtFrequency(channel.rxHz)} ${channel.destinationId ?? channel.talkgroup ?? ''} ${channel.mode === 'DMR' ? channel.colorCode : fmtNac(channel.nac)}`.toLowerCase().includes(query);
  });
}
function renderChannelRows() {
  const body = document.getElementById('channel-rows');
  if (!body || S.tab !== 'channels') return;
  const indices = visibleIndices();
  body.replaceChildren(...indices.map(channelRow));
  if (!indices.length) body.append(h('tr', {}, h('td', { colspan: 9, class: 'empty-result' }, 'No channels match this search.')));
  const count = document.getElementById('channel-count');
  if (count) count.textContent = `${occupied()} of 32 memories used${S.selected.size ? ` · ${S.selected.size} selected` : ''}`;
}
function channelRow(index) {
  const channel = S.model.channels[index];
  if (!channel) return h('tr', { class: 'empty-row' }, h('td'), h('td', { class: 'channel-number' }, String(index + 1).padStart(2, '0')),
    h('td', { colspan: 6, class: 'empty-label' }, 'Available memory'),
    h('td', {}, button('+ Add', () => editChannel('channels', index), { kind: 'add-slot', small: true, 'aria-label': `Add memory ${index + 1}` })));
  const update = (key, value) => change(`Edit memory ${index + 1}`, () => {
    const item = S.model.channels[index];
    if (key === 'mode') normalizedMode(item, value);
    else if (key === 'rxHz') { const simplex = item.txHz === item.rxHz; item.rxHz = value; if (simplex) item.txHz = value; }
    else item[key] = value;
  });
  const parse = (key, fn) => event => {
    if (S.busy) return;
    try { update(key, fn(event.target.value)); }
    catch (error) { say(`Memory ${index + 1}: ${error.message}`, true); }
  };
  return h('tr', {},
    h('td', {}, h('input', { type: 'checkbox', checked: S.selected.has(index), disabled: S.busy,
      'aria-label': `Select memory ${index + 1}`, onchange: event => {
        if (S.busy) return;
        if (event.target.checked) S.selected.add(index); else S.selected.delete(index);
        render();
      } })),
    h('td', { class: 'channel-number' }, String(index + 1).padStart(2, '0')),
    h('td', {}, input(channel.name, parse('name', String), { class: 'name-input', maxlength: 12, 'aria-label': `Memory ${index + 1} name` })),
    h('td', {}, input(fmtFrequency(channel.rxHz), parse('rxHz', parseFrequency), { class: 'mono', inputmode: 'decimal', 'aria-label': `Memory ${index + 1} receive frequency MHz` })),
    h('td', {}, select(['P25', 'DMR', 'NFM', 'FM'], channel.mode, parse('mode', String), { 'aria-label': `Memory ${index + 1} mode` })),
    h('td', {}, channel.mode === 'P25' ? input(fmtNac(channel.nac), parse('nac', value => {
      if (!/^[0-9a-f]{1,3}$/i.test(value)) throw new Error('NAC must be one to three hexadecimal digits.');
      return parseInt(value, 16);
    }), { class: 'mono', maxlength: 3, 'aria-label': `Memory ${index + 1} NAC` }) : channel.mode === 'DMR' ?
      input(channel.colorCode, parse('colorCode', Number), { type: 'number', min: 0, max: 15, 'aria-label': `Memory ${index + 1} color code` }) : h('span', { class: 'muted' }, '—')),
    h('td', {}, channel.mode === 'P25' ? input(channel.talkgroup, parse('talkgroup', value => /^\d+$/.test(value) ? Number(value) : NaN),
      { class: 'mono', inputmode: 'numeric', 'aria-label': `Memory ${index + 1} transmit talkgroup` }) : channel.mode === 'DMR' ?
      input(channel.destinationId, parse('destinationId', Number), { type: 'number', min: 1, max: 16777215, 'aria-label': `Memory ${index + 1} destination ID` }) : h('span', { class: 'muted' }, '—')),
    h('td', {}, h('div', { class: 'list-dots', 'aria-label': `Scan lists ${channel.scanLists.map(i => i + 1).join(', ') || 'none'}` },
      [0, 1, 2, 3].map(i => h('span', { class: `list-dot ${channel.scanLists.includes(i) ? 'member' : ''}` }, i + 1)))),
    h('td', {}, button(icon('edit', 15), () => editChannel('channels', index), { kind: 'icon-button quiet',
      title: `Edit memory ${index + 1} details`, 'aria-label': `Edit memory ${index + 1} details` })));
}

function addChannel() {
  if (S.busy) return;
  const index = S.model.channels.findIndex(item => !item);
  if (index >= 0) editChannel('channels', index);
}
function duplicateSelected() {
  if (S.busy || S.selected.size !== 1) return;
  const index = [...S.selected][0];
  const target = S.model.channels.findIndex(item => !item);
  if (target < 0 || !S.model.channels[index]) return;
  change(`Duplicate memory ${index + 1}`, () => { S.model.channels[target] = clone(S.model.channels[index]); S.selected = new Set([target]); });
}
async function clearSelected() {
  if (S.busy || !S.selected.size) return;
  const indices = [...S.selected].filter(index => S.model.channels[index]);
  if (!await confirmDialog('Clear selected memories?', `${indices.length} memor${indices.length === 1 ? 'y' : 'ies'} will be cleared in the working copy. Radio changes still require Review & write.`, 'Clear memories', true)) return;
  change('Clear selected memories', () => {
    for (const index of indices) {
      S.model.channels[index] = null;
      if (S.model.settings.selectionA === index + 1) S.model.settings.selectionA = 0;
      if (S.model.settings.selectionB === index + 1) S.model.settings.selectionB = 0;
    }
    S.selected.clear();
  });
}

function editChannel(table, index) {
  if (S.busy) return;
  const exists = Boolean(S.model[table][index]);
  const candidate = clone(S.model[table][index] || defaultChannel(table === 'channels' ? `CH ${index + 1}` : `VFO ${index ? 'B' : 'A'}`));
  const title = table === 'channels' ? `Memory ${String(index + 1).padStart(2, '0')}` : `VFO ${index ? 'B' : 'A'}`;
  const form = h('form');
  const errors = h('div', { class: 'dialog-error', role: 'alert', hidden: true });
  const name = input(candidate.name, null, { maxlength: 12, required: false, autocomplete: 'off' });
  const mode = select([['P25', 'P25 digital'], ['DMR', 'DMR digital'], ['NFM', 'Narrow FM'], ['FM', 'Wide FM']], candidate.mode, modeChanged);
  const rx = input(fmtFrequency(candidate.rxHz), null, { required: true, inputmode: 'decimal' });
  const tx = input(fmtFrequency(candidate.txHz), null, { required: true, inputmode: 'decimal' });
  const rxOnly = h('input', { type: 'checkbox', checked: candidate.rxOnly });
  const power = select(POWER_LEVELS.map((label, index) => [index, label]), candidate.powerLevel, null,
    { 'aria-label': 'Transmit power level' });
  const nac = input(fmtNac(candidate.nac ?? 0x293), null, { maxlength: 3, pattern: '[0-9a-fA-F]{1,3}', class: 'mono' });
  const tg = input(candidate.talkgroup ?? 1, null, { type: 'number', min: 1, max: 65535, step: 1 });
  const filter = select([['PROM', 'PROM · all supported clear calls'], ['NAC', 'Match NAC · all talkgroups'], ['NAC+TG', 'Match NAC + selected talkgroup']], candidate.filter, null);
  const sql = input(candidate.squelch ?? 5, null, { type: 'number', min: 0, max: 9, step: 1 });
  const destination = input(candidate.destinationId ?? 1, null, { type: 'number', min: 1, max: 16777215, step: 1 });
  const cc = input(candidate.colorCode ?? 1, null, { type: 'number', min: 0, max: 15, step: 1 });
  const slot = select([['1', 'Timeslot 1'], ['2', 'Timeslot 2']], String(candidate.timeslot ?? 1), null);
  const callType = select([['group', 'Group call'], ['private', 'Private call']], candidate.privateCall ? 'private' : 'group', null);
  const framing = select([['direct', 'Direct'], ['repeater', 'Repeater / hotspot']], candidate.repeater ? 'repeater' : 'direct', null);
  const dmrFilter = select([['NAC', 'Match CC · all destinations'], ['PROM', 'PROM · any CC / destination on selected slot'],
    ['NAC+TG', 'Match CC + destination']], candidate.filter ?? 'NAC', null);
  const tones = {};
  const toneField = (key, label) => {
    const value = candidate[key] ?? { type: 'none', value: 0 };
    const type = select([['none', 'None'], ['ctcss', 'CTCSS'], ['dcs', 'DCS'], ['dcs-inv', 'DCS inverted']], value.type, () => updateTone(key, true));
    const code = input(toneText(value), null, { class: 'mono', autocomplete: 'off' });
    const help = h('small');
    tones[key] = { type, code, help };
    return field(label, h('div', { class: 'tone-fields' }, type, code), 'CTCSS in Hz; DCS as an octal code, e.g. 023.');
  };
  const p25Section = h('section', {}, h('h3', {}, 'P25 call settings'),
    h('div', { class: 'field-grid' }, field('NAC · hexadecimal', nac, '000–FFF. Used for transmit and matched receive.'),
      field('Transmit talkgroup', tg, '1–65535. Also the selected group for NAC + TG filtering.'),
      field('Receive filter', filter, 'PROM keeps encrypted and unsupported calls muted.', true)));
  const analogSection = h('section', {}, h('h3', {}, 'Analog FM settings'),
    h('div', { class: 'field-grid' }, field('Squelch', sql, '0 = open; 1–9 = increasing threshold.'),
      h('div'), toneField('txTone', 'Transmit tone'), toneField('rxTone', 'Receive tone')));
  const dmrSection = h('section', {}, h('h3', {}, 'DMR call settings'),
    S.client?.protocolVersion === 1 ? h('p', {class:'section-intro'}, 'The connected radio needs the unified firmware before it can accept DMR channels. These edits can still be saved to a local file.') : null,
    h('div', { class: 'field-grid' }, field('Destination ID', destination, 'Group or private destination, 1–16777215.'),
      field('Call type', callType), field('Color code', cc, '0–15.'), field('Timeslot', slot),
      field('Operation', framing, 'Select framing explicitly; simplex hotspots can use repeater framing.'),
      field('Receive filter', dmrFilter, 'PROM uses the selected timeslot; it does not monitor both slots.')));
  const membership = [0, 1, 2, 3].map(i => h('label', {}, h('input', { type: 'checkbox', checked: candidate.scanLists.includes(i), value: i }), `List ${i + 1}`));
  form.append(h('div', { class: 'dialog-header' }, h('div', {}, h('h2', {}, `${exists ? 'Edit' : 'Add'} ${title}`),
    h('p', {}, 'Changes stay in your working copy until you write to the radio.')),
    button('×', () => dialog.close(), { kind: 'quiet', 'aria-label': 'Close channel editor' })),
  h('div', { class: 'dialog-body' }, errors,
    h('div', { class: 'field-grid' }, field('Channel name', name, 'Up to 12 printable ASCII characters.'), field('Mode', mode),
      field('Receive frequency · MHz', rx), field('Transmit frequency · MHz', tx),
      field('Transmit power', power, 'Calibrated hardware levels. Actual output depends on band, battery and calibration.')),
    h('div', { style: 'display:flex;gap:13px;align-items:center;margin-top:14px' },
      button('Use simplex', () => { tx.value = rx.value; }, { small: true }),
      h('label', { class: 'check-label' }, rxOnly, 'Receive only')),
    p25Section, dmrSection, analogSection,
    h('h3', {}, 'Scan membership'), h('div', { class: 'inline-options' }, membership)),
  h('div', { class: 'dialog-footer' }, h('span', { class: 'dialog-note' }, 'Local edit · no radio write'),
    button('Cancel', () => dialog.close()), h('button', { type: 'submit', class: 'primary' }, 'Apply channel')));
  const dialog = h('dialog', { 'aria-label': `${exists ? 'Edit' : 'Add'} ${title}` }, form);
  function updateTone(key, typeChanged = false) {
    const tone = tones[key];
    tone.code.disabled = tone.type.value === 'none' || ['P25', 'DMR'].includes(mode.value);
    tone.code.placeholder = tone.type.value === 'ctcss' ? '100.0' : '023';
    if (typeChanged) tone.code.value = tone.type.value === 'ctcss' ? '100.0' : tone.type.value === 'none' ? '' : '023';
  }
  function modeChanged() {
    for (const [section, enabled] of [[p25Section, mode.value === 'P25'], [dmrSection, mode.value === 'DMR'],
      [analogSection, ['FM', 'NFM'].includes(mode.value)]]) {
      section.hidden = !enabled;
      for (const control of section.querySelectorAll('input,select')) control.disabled = !enabled;
    }
    for (const key of ['txTone', 'rxTone']) if (tones[key]) updateTone(key);
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (S.busy) return;
    try {
      const channel = { ...candidate, name: name.value,
        rxHz: parseFrequency(rx.value), txHz: parseFrequency(tx.value), rxOnly: rxOnly.checked, powerLevel: Number(power.value),
        scanLists: membership.flatMap((label, i) => label.querySelector('input').checked ? [i] : []) };
      normalizedMode(channel, mode.value);
      if (channel.mode === 'P25') {
        if (!/^[0-9a-f]{1,3}$/i.test(nac.value)) throw new Error('NAC must be one to three hexadecimal digits.');
        channel.nac = parseInt(nac.value, 16); channel.talkgroup = Number(tg.value); channel.filter = filter.value;
        channel.txTone = { type: 'none', value: 0 }; channel.rxTone = { type: 'none', value: 0 };
      } else if (channel.mode === 'DMR') {
        Object.assign(channel, { destinationId: Number(destination.value), colorCode: Number(cc.value), timeslot: Number(slot.value),
          privateCall: callType.value === 'private', repeater: framing.value === 'repeater', filter: dmrFilter.value });
      } else {
        channel.squelch = Number(sql.value);
        for (const key of ['txTone', 'rxTone']) channel[key] = parseTone(tones[key].type.value, tones[key].code.value);
      }
      const test = clone(S.model); test[table][index] = channel;
      const target = `${table}[${index}]`;
      const related = validateModel(test).filter(problem => problem.path?.includes(target) || problem.path?.startsWith(`${table}.${index}`));
      if (related.length) throw new Error(related.map(problem => problem.message).join(' '));
      // Encoding also catches record constraints if a validator uses a different path notation.
      if (!validateModel(S.model).length) encodePayload(test);
      change(`Edit ${title}`, () => { S.model[table][index] = channel; });
      dialog.close();
    } catch (error) { errors.hidden = false; errors.textContent = error.message || String(error); }
  });
  modeChanged();
  document.body.append(dialog); dialog.showModal(); name.focus();
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
}
function toneText(tone) {
  return tone.type === 'none' ? '' : tone.type === 'ctcss' ? (tone.value / 10).toFixed(1) : tone.value.toString(8).padStart(3, '0');
}
function parseTone(type, text) {
  if (type === 'none') return { type, value: 0 };
  if (type === 'ctcss') {
    if (!/^\d+(?:\.\d)?$/.test(text.trim())) throw new Error('Enter CTCSS in Hz, e.g. 100.0.');
    return { type, value: Math.round(Number(text) * 10) };
  }
  if (!/^[0-7]{1,3}$/.test(text.trim())) throw new Error('Enter a DCS octal code, e.g. 023.');
  return { type, value: parseInt(text, 8) };
}

function vfoView() {
  return h('div', { class: 'vfo-grid' }, [0, 1].map(index => {
    const channel = S.model.vfos[index];
    const selected = S.model.settings.activeVfo === index;
    const selection = index ? S.model.settings.selectionB : S.model.settings.selectionA;
    return h('section', { class: 'panel vfo-card' },
      h('div', { class: 'panel-heading' }, h('div', { class: 'vfo-title' }, h('span', { class: 'vfo-letter' }, index ? 'B' : 'A'),
        h('h2', {}, `VFO ${index ? 'B' : 'A'}`)), badge(selected ? 'ACTIVE CONTEXT' : 'STANDBY', selected ? '' : 'neutral')),
      h('div', { class: 'panel-body' }, channel ? [
        h('div', { class: 'frequency-display mono' }, fmtFrequency(channel.rxHz), h('span', {}, 'MHz')),
        h('div', { class: 'vfo-name' }, channel.name || 'Unnamed VFO', ' · ', channel.mode === 'NFM' ? 'Narrow FM' : channel.mode === 'FM' ? 'Wide FM' : channel.mode === 'DMR' ? 'DMR digital' : 'P25 digital'),
        h('dl', {}, [['Transmit', channel.rxOnly ? 'Receive only' : `${fmtFrequency(channel.txHz)} MHz`],
          ...(channel.mode === 'P25' ? [['NAC / talkgroup', `${fmtNac(channel.nac)} / ${channel.talkgroup}`], ['Receive filter', channel.filter]] :
            channel.mode === 'DMR' ? [['Destination', `${channel.destinationId} / ${channel.privateCall ? 'Private' : 'Group'}`],
              ['Color code / slot', `${channel.colorCode} / ${channel.timeslot}`], ['Operation', channel.repeater ? 'Repeater / hotspot' : 'Direct']] :
            [['TX / RX tone', `${toneText(channel.txTone) || 'None'} / ${toneText(channel.rxTone) || 'None'}`], ['Squelch', channel.squelch]]),
          ['Transmit power', POWER_LEVELS[channel.powerLevel]],
          ['Context selection', selection ? `Memory ${selection}` : `VFO ${index ? 'B' : 'A'}`]].map(([key, value]) =>
          h('div', { class: 'definition-row' }, h('dt', {}, key), h('dd', {}, value)))),
      ] : [h('div', { class: 'frequency-display muted' }, 'Not configured'), h('p', { class: 'section-intro' }, 'Give this VFO its own frequency and mode.')],
      h('div', { class: 'card-actions' }, button(channel ? 'Edit VFO' : 'Configure VFO', () => editChannel('vfos', index), { kind: 'primary', glyph: 'edit' }),
        button('Use this VFO', () => change(`Select VFO ${index ? 'B' : 'A'}`, () => {
          S.model.settings.activeVfo = index;
          S.model.settings[index ? 'selectionB' : 'selectionA'] = 0;
        }), { disabled: !channel || (selected && !selection) }))));
  }));
}

function scanView() {
  return h('div', {},
    h('div', { class: 'banner' }, icon('scan', 19), 'A channel can belong to more than one list. PTT stops scanning and uses the current channel. This editor changes membership, not on-air scan state.'),
    h('div', { class: 'scan-grid' }, [0, 1, 2, 3].map(list => {
      const members = S.model.channels.filter(channel => channel?.scanLists.includes(list)).length;
      return h('section', { class: 'panel' },
        h('div', { class: 'panel-heading' }, h('div', { class: 'scan-card-header' }, h('span', { class: 'scan-number' }, list + 1),
          h('div', {}, h('h2', {}, `Scan list ${list + 1}`), h('p', {}, `${members} channel${members === 1 ? '' : 's'}`))),
        S.model.settings.scanList === list ? badge('SELECTED') : button('Use list', () => change('Select scan list', () => { S.model.settings.scanList = list; }), { small: true })),
        h('div', { class: 'scan-member-list' }, ...S.model.channels.flatMap((channel, index) => channel ? [
          h('label', { class: 'scan-member' }, h('input', { type: 'checkbox', checked: channel.scanLists.includes(list), disabled: S.busy,
            onchange: event => change(`Scan list ${list + 1} membership`, () => {
              if (event.target.checked) channel.scanLists = [...new Set([...channel.scanLists, list])].sort();
              else channel.scanLists = channel.scanLists.filter(item => item !== list);
            }) }), h('span', { class: 'channel-number' }, String(index + 1).padStart(2, '0')),
          h('span', { class: 'member-name' }, channel.name || `Memory ${index + 1}`),
          h('span', { class: 'member-detail mono' }, fmtFrequency(channel.rxHz)))
        ] : []), !occupied() ? h('div', { class: 'empty-result' }, 'Add channels to build this list.') : null));
    })));
}

function settingsView() {
  const settings = S.model.settings;
  const update = key => event => {
    const value = event.target.type === 'checkbox' ? event.target.checked : Number(event.target.value);
    change('Edit radio settings', () => { settings[key] = value; });
  };
  const numeric = (key, min, max, suffix = '') => input(settings[key], update(key), { type: 'number', min, max, step: 1, 'aria-label': suffix || key });
  const choices = index => [[0, `VFO ${index ? 'B' : 'A'}`], ...S.model.channels.flatMap((channel, i) => channel ? [[i + 1, `${String(i + 1).padStart(2, '0')} · ${channel.name || 'Unnamed'}`]] : [])];
  return h('div', { class: 'settings-grid' },
    settingPanel('Radio identity', 'Identity shared by P25 and DMR transmissions.',
      field('Source / radio ID', numeric('sourceId', 1, 16777215, 'Digital source radio ID'), '1–16777215. Confirm the ID appropriate for your network.'),
      field('Digital microphone gain · dB', numeric('micGainDb', 0, 42, 'Digital microphone gain dB'), '0–42 dB, shared by P25 and DMR. Analog FM uses its native microphone gain.')),
    settingPanel('Starting context', 'These selections are saved with the codeplug.',
      field('Active VFO context', select([[0, 'A'], [1, 'B']], settings.activeVfo, update('activeVfo'))),
      field('Context A uses', select(choices(0), settings.selectionA, update('selectionA'))),
      field('Context B uses', select(choices(1), settings.selectionB, update('selectionB'))),
      field('Selected scan list', select([0, 1, 2, 3].map(i => [i, `List ${i + 1}`]), settings.scanList, update('scanList')))));
}
function functionsView() {
  const settings = S.model.settings;
  const update = key => event => change('Edit radio functions', () => {
    settings[key] = event.target.type === 'checkbox' ? event.target.checked : Number(event.target.value);
  });
  const numeric = (key, min, max, label, fallback = 0) => input(settings[key] || fallback, update(key),
    { type: 'number', min, max, step: 1, 'aria-label': label });
  const buttonFields = [['p1Action', 'P1', 'VFO / memory'], ['p2Action', 'P2', 'Radio status'],
    ['sk1Action', 'SK1', 'FM broadcast'], ['sk2Action', 'SK2', 'Switch A / B']];
  return h('div', {},
    S.client && S.client.protocolVersion < 3 ? h('div', { class: 'banner warning' }, icon('info', 19),
      'The connected firmware supports the earlier codeplug format. New power and function settings can be saved locally; writing them requires protocol 3 firmware.') : null,
    h('div', { class: 'settings-grid' },
      h('section', { class: 'panel' }, h('div', { class: 'panel-heading' }, h('div', {},
        h('h2', {}, 'Transmit'), h('p', {}, 'Set the call timeout and optional owner inhibit.'))),
        h('div', { class: 'panel-body' }, h('div', { class: 'field-grid' },
          field('Time-out timer · seconds', numeric('totSeconds', 15, 600, 'Transmit timeout seconds', 30),
            '15–600 seconds. The default is 30 seconds; each new PTT press starts a new timer.', true)),
          check('Inhibit all transmission', settings.txInhibit, update('txInhibit')),
          h('p', { class: 'settings-note' }, 'Power is saved per channel and VFO in its editor. Per-channel receive-only settings and the held-PTT startup guard still apply.'),
          button('Use default timeout', () => change('Restore default timeout', () => { settings.totSeconds = 0; }), { small: true }))),
      settingPanel('Programmable buttons', 'Choose everyday shortcuts independently for each button.',
        buttonFields.map(([key, label, fallback]) => field(label,
          select(BUTTON_ACTIONS.map((action, index) => [index, index === 0 ? `Default · ${fallback}` : action]),
            settings[key], update(key), { 'aria-label': `${label} button action` }))),
        h('p', { class: 'function-help' }, 'SK1 and SK2 are the side keys below PTT. Keypad lock remains available with OK + *; PTT is not locked.')),
      h('section', { class: 'panel' }, h('div', { class: 'panel-heading' }, h('div', {},
        h('h2', {}, 'FM broadcast'), h('p', {}, 'A separate receive-only broadcast tuner.'))),
        h('div', { class: 'panel-body' }, h('div', { class: 'field-grid' },
          field('FM broadcast frequency · MHz', input(((settings.broadcastKHz || 87500) / 1000).toFixed(3), event => {
            change('Edit FM broadcast frequency', () => { settings.broadcastKHz = Number((Number(event.target.value) * 1000).toFixed(6)); });
          }, { type: 'number', min: 65, max: 108, step: 0.05, 'aria-label': 'FM broadcast frequency MHz' }),
          '65–108 MHz in 0.05-MHz steps. Default: 87.500 MHz. Assign FM broadcast to a button to open the tuner.', true)),
          button('Use default frequency', () => change('Restore FM broadcast default', () => { settings.broadcastKHz = 0; }), { small: true }),
          h('p', { class: 'settings-note' }, 'Broadcast reception is separate from two-way FM channels. PTT does not transmit broadcast audio.'))),
      settingPanel('Display & keypad', 'Independent light timers; receiving a call wakes the screen.',
        field('Screen backlight · seconds', numeric('screenSeconds', 0, 600, 'Screen backlight timeout seconds'), '0 = always on. Allowed range: 0–600 seconds.'),
        field('Keypad light · seconds', numeric('keypadSeconds', 0, 600, 'Keypad light timeout seconds'), '0 = always on. The first key press wakes a dark screen.'))));
}
function settingPanel(title, subtitle, ...fields) {
  return h('section', { class: 'panel' }, h('div', { class: 'panel-heading' }, h('div', {}, h('h2', {}, title), h('p', {}, subtitle))),
    h('div', { class: 'panel-body' }, h('div', { class: 'field-grid' }, fields)));
}
function problemsView(issues) {
  return h('section', { class: 'panel' }, issues.length ?
    h('ul', { class: 'problem-list' }, issues.map(problem => h('li', { class: 'problem-item' }, icon('alert', 18),
      h('div', {}, problem.message, h('span', { class: 'problem-path' }, problem.path || 'codeplug'))))) :
    h('div', { class: 'all-valid' }, icon('shield', 38), h('h2', {}, 'Your codeplug checks out'),
      h('p', {}, 'Channel fields, radio settings and memory references are valid.', h('br'),
        'Connect and read the radio to review an upload. No RF test is performed here.')));
}

function confirmDialog(title, text, confirm = 'Continue', danger = false, body = null) {
  if (S.busy) return Promise.resolve(false);
  return new Promise(resolve => {
    let result = false;
    const dialog = h('dialog', { class: 'small-dialog', 'aria-label': title },
      h('div', { class: 'dialog-header' }, h('h2', {}, title)),
      h('div', { class: 'dialog-body' }, h('p', {}, text), body),
      h('div', { class: 'dialog-footer' }, button('Cancel', () => dialog.close()),
        button(confirm, () => { result = true; dialog.close(); }, { kind: danger ? 'danger' : 'primary' })));
    dialog.addEventListener('close', () => { dialog.remove(); resolve(result); }, { once: true });
    document.body.append(dialog); dialog.showModal();
  });
}
async function canReplace() {
  if (S.busy) return false;
  return !dirty() || await confirmDialog('Replace unsaved edits?', 'The current working copy has unsaved edits. Save a file first if you want to keep them.', 'Replace working copy');
}
async function newFile() {
  if (!await canReplace()) return;
  load(createDefaultModel(), 'Untitled codeplug', 'new');
}
async function loadDemo() {
  if (!await canReplace()) return;
  const demo = createDefaultModel();
  demo.channels[0] = { ...defaultChannel('P25 SIMPLEX'), rxHz: 145700000, txHz: 145700000, talkgroup: 10, scanLists: [0] };
  demo.channels[1] = { ...defaultChannel('UHF P25'), rxHz: 440075000, txHz: 440075000, filter: 'NAC', scanLists: [0, 1] };
  demo.channels[2] = { ...defaultChannel('VHF CALL'), mode: 'NFM', rxHz: 146520000, txHz: 146520000, scanLists: [1] };
  demo.channels[3] = { ...defaultChannel('LOCAL RPT'), mode: 'NFM', rxHz: 146940000, txHz: 146340000,
    txTone: { type: 'ctcss', value: 1000 }, scanLists: [1] };
  demo.vfos[0] = { ...defaultChannel('VFO A'), talkgroup: 10 };
  demo.vfos[1] = { ...defaultChannel('VFO B'), rxHz: 440075000, txHz: 440075000 };
  load(demo, 'Example codeplug', 'demo');
  say('Example channels are for exploring the editor. Review frequencies, tones and your radio ID before any upload.');
}
async function openSelectedFile(event) {
  const file = event.target.files?.[0]; fileInput.value = '';
  if (!file || S.busy) return;
  try {
    if (file.size > 1024 * 1024) throw new Error('This file is larger than a DM32 codeplug. Choose a DM32 Studio JSON file.');
    const imported = importFile(await file.text());
    if (!await canReplace()) return;
    load(imported.model, file.name.replace(/\.json$/i, ''), 'file', imported.origin);
    say('Codeplug opened locally. File metadata never establishes a radio write baseline.');
  } catch (error) { say(`Could not open file: ${error.message || error}`, true); }
}
function saveFile() {
  if (S.busy) return;
  try {
    const issues = problems();
    if (issues.length) { S.tab = 'problems'; say('Resolve the codeplug checks before saving.', true); return; }
    const origin = S.baseline ? { revision: S.baseline.revision, crc: S.baseline.crc } : S.fileOrigin;
    const blob = new Blob([exportFile(S.model, origin)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: `${S.name.replace(/\.(dm32|json)$/gi, '').replace(/[^a-z0-9 _.-]/gi, '_') || 'DM32'}.dm32.json` });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    S.clean = signature(S.model); say('Complete codeplug saved as a local JSON file. The radio was not changed.');
  } catch (error) { say(`Could not save file: ${error.message || error}`, true); }
}

function setBusy(value, operation = '') {
  S.busy = value; S.operation = operation; S.progress = 0; render();
}
function onProgress(progress) {
  const total = Number(progress?.total || 0);
  const current = Number(progress?.current ?? progress?.done ?? progress?.completed ?? 0);
  const percent = typeof progress === 'number' ? progress : Number(progress?.percent || (total ? current / total * 100 : 0));
  S.progress = Math.min(100, Math.max(7, percent || 7));
  const stage = typeof progress === 'string' ? progress : progress?.message || progress?.label || progress?.stage;
  if (stage) S.operation = String(stage);
  const fill = document.getElementById('progress-fill'); if (fill) fill.style.width = `${S.progress}%`;
  const label = document.getElementById('progress-label'); if (label) label.textContent = S.operation;
}
async function connectRadio() {
  if (S.busy || S.client) return;
  if (!navigator.serial) {
    say('Web Serial is unavailable in this browser. Open this local page in desktop Chrome or Edge, then connect the programming cable.', true);
    return;
  }
  // requestPort must remain in this explicit user action's call chain.
  const client = new CpsClient({ serial: navigator.serial, timeoutMs: 3000, onProgress });
  S.client = client; S.baseline = null;
  setBusy(true, 'Choose the programming cable…');
  try {
    const identity = await client.connect();
    S.notice = { message: `Connected to custom DM32 firmware${client.protocolVersion === 1 ? ' (P25/FM)' : ' (P25/DMR/FM)'}; revision ${identity.revision}. Read the radio to establish a safe upload baseline.`, error: false };
  } catch (error) {
    try { await client.disconnect(); } catch { /* The original connection error is the useful one. */ }
    S.client = null;
    S.notice = { message: `Connection not established: ${error.message || error}`, error: true };
  } finally { setBusy(false); }
}
async function disconnectRadio() {
  if (S.busy) return;
  const client = S.client;
  S.baseline = null;
  setBusy(true, 'Closing the radio connection…');
  try { if (client) await client.disconnect(); }
  catch (error) { S.notice = { message: `Connection closed with a serial error: ${error.message || error}`, error: true }; }
  finally { S.client = null; setBusy(false); }
}
async function readRadio() {
  if (S.busy || !connected() || !await canReplace()) return;
  S.baseline = null;
  setBusy(true, 'Reading the radio configuration…');
  try {
    const result = await S.client.read();
    const model = decodePayload(result.payload);
    if (problemsFor(model).length) throw new Error('The radio returned an invalid codeplug. No write baseline was accepted.');
    S.baseline = { payload: new Uint8Array(result.payload), revision: result.revision, crc: result.crc };
    load(model, 'DM32 radio codeplug', 'radio');
    S.notice = { message: `Read complete. Revision ${result.revision}; all 35 records checked. You can now edit and review changes.`, error: false };
  } catch (error) {
    S.baseline = null;
    S.notice = { message: `Read failed: ${error.message || error} Your working edits are retained. Read the radio again before writing.`, error: true };
  } finally { setBusy(false); }
}
function problemsFor(model) { try { return validateModel(model); } catch { return [{ path: 'codeplug', message: 'Invalid model' }]; } }
function channelValue(channel, key) {
  const value = channel[key];
  if (value === undefined) return 'Not used';
  if (key === 'rxHz' || key === 'txHz') return `${fmtFrequency(value)} MHz`;
  if (key === 'nac') return fmtNac(value);
  if (key === 'name') return value ? `“${value}”` : '(unnamed)';
  if (key === 'mode') return { P25: 'P25 digital', DMR: 'DMR digital', NFM: 'Narrow FM', FM: 'Wide FM' }[value];
  if (key === 'filter' && channel.mode === 'DMR') return { PROM: 'PROM · any CC / destination on selected slot', NAC: 'Match CC', 'NAC+TG': 'Match CC + destination' }[value];
  if (key === 'filter') return { PROM: 'PROM · any NAC / talkgroup', NAC: 'Match NAC', 'NAC+TG': 'Match NAC + talkgroup' }[value];
  if (key === 'rxOnly') return value ? 'On · receive only' : 'Off · transmit allowed';
  if (key === 'scanLists') return value.length ? value.map(index => `List ${index + 1}`).join(', ') : 'None';
  if (key === 'squelch') return value === 0 ? 'Open (0)' : `Level ${value}`;
  if (key === 'powerLevel') return POWER_LEVELS[value];
  if (key === 'txTone' || key === 'rxTone') return value.type === 'none' ? 'None' : value.type === 'ctcss' ?
    `${toneText(value)} Hz CTCSS` : `${toneText(value)} DCS${value.type === 'dcs-inv' ? ' inverted' : ''}`;
  return String(value);
}
function settingValue(model, key) {
  const value = model.settings[key];
  if (key === 'micGainDb') return `${value} dB`;
  if (key === 'screenSeconds' || key === 'keypadSeconds') return value ? `${value} seconds` : 'Always on';
  if (key === 'activeVfo') return `Context ${value ? 'B' : 'A'}`;
  if (key === 'selectionA' || key === 'selectionB') {
    if (!value) return `VFO ${key === 'selectionA' ? 'A' : 'B'}`;
    const name = model.channels[value - 1]?.name;
    return `Memory ${String(value).padStart(2, '0')}${name ? ` · ${name}` : ''}`;
  }
  if (key === 'scanList') return `List ${value + 1}`;
  if (key === 'txInhibit') return value ? 'Inhibited' : 'PTT enabled';
  if (key === 'totSeconds') return `${value || 30} seconds${value === 0 ? ' (default)' : ''}`;
  if (key === 'broadcastKHz') return `${((value || 87500) / 1000).toFixed(3)} MHz${value === 0 ? ' (default)' : ''}`;
  if (['p1Action', 'p2Action', 'sk1Action', 'sk2Action'].includes(key)) return BUTTON_ACTIONS[value];
  return String(value);
}
function diffItems(original, current) {
  const entries = [];
  for (const table of ['channels', 'vfos']) {
    for (let i = 0; i < current[table].length; i++) {
      const before = original[table][i], after = current[table][i];
      if (signature(before) === signature(after)) continue;
      const label = table === 'channels' ? `Memory ${i + 1}` : `VFO ${i ? 'B' : 'A'}`;
      const kind = !before ? 'Add' : !after ? 'Clear' : 'Update';
      const fieldLabels = { rxHz: 'RX frequency', txHz: 'TX frequency', rxOnly: 'Receive only', scanLists: 'Scan membership',
        txTone: 'TX tone', rxTone: 'RX tone', talkgroup: 'Talkgroup', nac: 'NAC', filter: 'Receive filter', destinationId: 'Destination ID', colorCode: 'Color code', timeslot: 'Timeslot', privateCall: 'Private call', repeater: 'Repeater / hotspot', name: 'Name', mode: 'Mode', squelch: 'Squelch', powerLevel: 'Transmit power' };
      const changed = before && after ? Object.keys(after).filter(key => signature(before[key]) !== signature(after[key]))
        .map(key => `${fieldLabels[key] || key}: ${channelValue(before, key)} → ${channelValue(after, key)}`) :
        [after ? `${after.name || 'Unnamed'} · ${fmtFrequency(after.rxHz)} MHz · ${after.mode}` : before?.name || 'Unnamed'];
      entries.push({ title: `${kind} ${label}${before && after && after.name ? ` · ${after.name}` : ''}`, details: changed });
    }
  }
  const labels = { sourceId: 'Radio ID', micGainDb: 'Digital mic gain (dB)', screenSeconds: 'Screen timeout (seconds)', keypadSeconds: 'Keypad timeout (seconds)',
    activeVfo: 'Active context', selectionA: 'Context A selection', selectionB: 'Context B selection', scanList: 'Selected scan list', txInhibit: 'TX inhibit',
    totSeconds: 'Transmit timeout', p1Action: 'P1 button', p2Action: 'P2 button', sk1Action: 'SK1 button', sk2Action: 'SK2 button', broadcastKHz: 'FM broadcast frequency' };
  for (const key of Object.keys(current.settings)) if (signature(original.settings[key]) !== signature(current.settings[key]))
    entries.push({ title: labels[key] || key, details: [`${settingValue(original, key)} → ${settingValue(current, key)}`] });
  return entries;
}
async function reviewWrite() {
  if (S.busy || !connected() || !S.baseline || problems().length) return;
  const payload = encoded();
  if (!payload) return;
  const baseline = S.baseline;
  const differences = diffItems(decodePayload(baseline.payload), S.model);
  if (!differences.length) { say('The working copy already matches the radio. Nothing was written.'); return; }
  const body = h('div', {}, h('div', { class: 'read-review' },
    `Write ${differences.length} changed section${differences.length === 1 ? '' : 's'} to the connected DM32, based on radio revision ${baseline.revision}. `,
    'Leave PTT released and keep the cable connected until completion.'),
    h('ul', { class: 'diff-list' }, differences.map(item => h('li', {}, h('strong', {}, item.title),
      item.details.map(detail => h('span', { class: 'diff-detail' }, detail))))),
    h('p', { class: 'dialog-subtle' }, 'Only the custom firmware’s logical channel settings are programmed. Calibration, firmware and bootloader are outside this interface.'));
  if (!await confirmDialog('Review radio changes', 'Your edits have not been sent yet.', 'Write to radio', false, body)) return;
  if (S.busy || !connected() || S.baseline !== baseline) { say('The connection changed. Read the radio again before writing.', true); return; }
  setBusy(true, 'Writing and verifying the configuration…');
  try {
    const result = await S.client.write(payload, { revision: baseline.revision, crc: baseline.crc });
    S.baseline = { payload: new Uint8Array(payload), revision: result.revision, crc: result.crc ?? crc32(payload) };
    S.clean = signature(S.model);
    S.notice = { message: result.unchanged ? 'The radio already contained this configuration. No write was needed.' :
      `Write verified. Radio revision ${result.revision}; your configuration is now active.`, error: false };
  } catch (error) {
    S.baseline = null;
    const recovery = error.uncertain ? 'The commit may have completed. Disconnect, reconnect and read the radio before another upload.' :
      'Read the radio again before another upload.';
    S.notice = { message: `Upload stopped: ${error.message || error} Your edits are retained. ${recovery}`, error: true };
  } finally { setBusy(false); }
}

navigator.serial?.addEventListener('disconnect', () => {
  // Let the transport classify its own port first; an unrelated USB-serial
  // device must not discard this radio's valid baseline.
  queueMicrotask(() => {
    if (!S.client || S.client.connected) return;
    S.baseline = null;
    S.notice = { message: 'The radio was disconnected. Working edits are retained. Disconnect, reconnect and read the radio before writing again.', error: true };
    render();
  });
});
window.addEventListener('beforeunload', event => {
  if (dirty() || S.busy) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('keydown', event => {
  if (S.busy || document.querySelector('dialog[open]') || /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveFile(); }
});

render();
