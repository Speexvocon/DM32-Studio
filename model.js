// SPDX-License-Identifier: GPL-3.0-or-later
// Logical CPS V1–V4. Legacy imports retain their exact bytes until explicitly upgraded.

export const RECORD_BYTES = 32;
export const RECORD_COUNT = 387;
export const MEMORY_COUNT = 256;
export const LEGACY_RECORD_COUNT = 35;
export const ZONE_COUNT = 16;
export const SCAN_COUNT = 16;
export const modelVersion = model => model?.channels?.length === 256 ? 4 : 3;
export const recordCount = version => version === 4 ? RECORD_COUNT : LEGACY_RECORD_COUNT;
export const FILTERS = Object.freeze(["NAC", "PROM", "NAC+TG"]);
export const POWER_LEVELS = Object.freeze(["L−", "L", "L+", "L++", "M", "M+", "M++", "H−", "H"]);
export const BUTTON_ACTIONS = Object.freeze(["Default", "None", "Frequency / Channel", "Switch A / B", "Scan", "Cycle TX power", "FM broadcast", "Radio status", "Keypad lock"]);

const MODES = ["P25", "NFM", "FM", "DMR"];
const TONE_TYPES = ["none", "ctcss", "dcs", "dcs-inv"];
const CHANNEL_KEYS = ["name", "rxHz", "txHz", "mode", "nac", "talkgroup", "filter", "rxOnly", "scanLists", "squelch", "txTone", "rxTone", "powerLevel"];
const DMR_KEYS = ["name", "rxHz", "txHz", "mode", "rxOnly", "scanLists", "filter", "destinationId", "colorCode", "timeslot", "privateCall", "repeater", "powerLevel"];
const SETTINGS_KEYS = ["sourceId", "micGainDb", "screenSeconds", "keypadSeconds", "activeVfo", "selectionA", "selectionB", "scanList", "txInhibit", "totSeconds", "p1Action", "p2Action", "sk1Action", "sk2Action", "broadcastKHz"];
const BANDS = [[136000000, 174000000], [400000000, 480000000]];

function bytes(value) {
    if (!(value instanceof Uint8Array)) throw new TypeError("Expected a Uint8Array");
    return value;
}

function integer(value, minimum, maximum) {
    return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function object(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function ownKeys(value, expected, path, errors) {
    for (const key of Object.keys(value)) {
        if (!expected.includes(key)) errors.push({ path: path ? `${path}.${key}` : key, message: "Unknown field" });
    }
    for (const key of expected) {
        if (!Object.hasOwn(value, key)) errors.push({ path: path ? `${path}.${key}` : key, message: "Missing field" });
    }
}

function frequency(value) {
    return Number.isInteger(value) && BANDS.some(([low, high]) => value >= low && value <= high);
}

function checkTone(tone, path, errors) {
    if (!object(tone)) {
        errors.push({ path, message: "Choose a tone type and integer wire value" });
        return;
    }
    ownKeys(tone, ["type", "value"], path, errors);
    if (!TONE_TYPES.includes(tone.type)) errors.push({ path: `${path}.type`, message: "Unknown tone type" });
    const range = tone.type === "none" ? [0, 0] : tone.type === "ctcss" ? [600, 2600] : [1, 511];
    if (!integer(tone.value, ...range)) {
        errors.push({ path: `${path}.value`, message: tone.type === "ctcss"
            ? "CTCSS must be 600–2600 in tenths of Hz"
            : tone.type === "none" ? "An unused tone must have value zero" : "DCS must be a 9-bit code, 1–511" });
    }
}

function checkChannel(channel, path, errors, expanded = false) {
    if (channel === null) return;
    if (!object(channel)) {
        errors.push({ path, message: "Expected a channel or null for an empty slot" });
        return;
    }
    const dmr = channel.mode === "DMR";
    ownKeys(channel, dmr ? DMR_KEYS : CHANNEL_KEYS, path, errors);
    if (typeof channel.name !== "string" || channel.name.length > 12 || /[^\x20-\x7e]/.test(channel.name)) {
        errors.push({ path: `${path}.name`, message: "Use at most 12 printable ASCII characters" });
    }
    for (const field of ["rxHz", "txHz"]) {
        if (!frequency(channel[field])) errors.push({ path: `${path}.${field}`, message: "Use an integer frequency in 136–174 or 400–480 MHz" });
    }
    if (!MODES.includes(channel.mode)) errors.push({ path: `${path}.mode`, message: "Choose P25, DMR, NFM or FM" });
    if (typeof channel.rxOnly !== "boolean") errors.push({ path: `${path}.rxOnly`, message: "Receive-only must be true or false" });
    if (!integer(channel.powerLevel, 0, 8)) errors.push({ path: `${path}.powerLevel`, message: "Choose a calibrated power level from L− through H" });
    if (!Array.isArray(channel.scanLists) || channel.scanLists.length > (expanded ? 0 : 4)
        || channel.scanLists.some((item) => !integer(item, 0, 3))
        || new Set(channel.scanLists).size !== channel.scanLists.length
        || Object.keys(channel.scanLists).length !== channel.scanLists.length
        || Object.keys(channel.scanLists).some((key, index) => key !== String(index))) {
        errors.push({ path: `${path}.scanLists`, message: expanded ? "V4 membership belongs to the scan-list editor" : "Use each scan list 0–3 at most once" });
    }
    if (dmr) {
        if (!FILTERS.includes(channel.filter)) errors.push({ path: `${path}.filter`, message: "Choose CC, PROM on selected slot, or CC + destination" });
        if (!integer(channel.destinationId, 1, 0xffffff)) errors.push({ path: `${path}.destinationId`, message: "Destination ID must be 1–16777215" });
        if (!integer(channel.colorCode, 0, 15)) errors.push({ path: `${path}.colorCode`, message: "Color code must be 0–15" });
        if (![1, 2].includes(channel.timeslot)) errors.push({ path: `${path}.timeslot`, message: "Choose timeslot 1 or 2" });
        for (const key of ["privateCall", "repeater"]) if (typeof channel[key] !== "boolean") errors.push({ path: `${path}.${key}`, message: "Choose true or false" });
        return;
    }
    if (!integer(channel.nac, 0, 0xfff)) errors.push({ path: `${path}.nac`, message: "NAC must be 000–FFF hexadecimal" });
    if (!integer(channel.talkgroup, 1, 65535)) errors.push({ path: `${path}.talkgroup`, message: "Talkgroup must be 1–65535" });
    if (!FILTERS.includes(channel.filter)) errors.push({ path: `${path}.filter`, message: "Choose NAC, PROM or NAC+TG" });
    if (!integer(channel.squelch, 0, 9)) errors.push({ path: `${path}.squelch`, message: "Squelch must be 0–9" });
    checkTone(channel.txTone, `${path}.txTone`, errors);
    checkTone(channel.rxTone, `${path}.rxTone`, errors);
    if (channel.mode === "P25") {
        for (const field of ["txTone", "rxTone"]) {
            if (object(channel[field]) && (channel[field].type !== "none" || channel[field].value !== 0)) {
                errors.push({ path: `${path}.${field}`, message: "P25 channels cannot use analog tones" });
            }
        }
    }
}

/** Return all validation problems without changing the supplied model. */
export function validateModel(model) {
    const errors = [];
    if (!object(model)) return [{ path: "", message: "Expected a configuration object" }];
    const expanded = modelVersion(model) === 4, memories = expanded ? 256 : 32;
    ownKeys(model, expanded ? ["channels", "vfos", "settings", "zones", "scanLists"] : ["channels", "vfos", "settings"], "", errors);
    for (const [key, count] of [["channels", memories], ["vfos", 2]]) {
        if (!Array.isArray(model[key]) || model[key].length !== count) {
            errors.push({ path: key, message: `Expected exactly ${count} slots` });
            continue;
        }
        for (let index = 0; index < count; index++) checkChannel(model[key][index], `${key}[${index}]`, errors, expanded);
        if (Object.keys(model[key]).some((item) => !/^(0|[1-9]\d*)$/.test(item) || Number(item) >= count)) {
            errors.push({ path: key, message: "Unexpected array fields" });
        }
    }
    if (!object(model.settings)) {
        errors.push({ path: "settings", message: "Expected radio settings" });
        return errors;
    }
    ownKeys(model.settings, expanded ? [...SETTINGS_KEYS, "zoneA", "zoneB"] : SETTINGS_KEYS, "settings", errors);
    const ranges = {
        sourceId: [1, 0xffffff], micGainDb: [0, 42], screenSeconds: [0, 600], keypadSeconds: [0, 600],
        activeVfo: [0, 1], selectionA: [0, memories], selectionB: [0, memories], scanList: [0, expanded ? 15 : 3],
        ...(expanded ? {zoneA: [0, 16], zoneB: [0, 16]} : {}),
    };
    for (const [key, range] of Object.entries(ranges)) {
        if (!integer(model.settings[key], ...range)) errors.push({ path: `settings.${key}`, message: `Use an integer from ${range[0]} to ${range[1]}` });
    }
    if (typeof model.settings.txInhibit !== "boolean") errors.push({ path: "settings.txInhibit", message: "TX inhibit must be true or false" });
    const settings = model.settings;
    if (settings.totSeconds !== 0 && !integer(settings.totSeconds, 15, 600)) {
        errors.push({ path: "settings.totSeconds", message: "Use 15–600 whole seconds, or 0 for the 30-second default" });
    }
    for (const key of ["p1Action", "p2Action", "sk1Action", "sk2Action"]) {
        if (!integer(settings[key], 0, 8)) errors.push({ path: `settings.${key}`, message: "Choose a supported button action" });
    }
    if (settings.broadcastKHz !== 0 && (!integer(settings.broadcastKHz, 65000, 108000) || settings.broadcastKHz % 50 !== 0)) {
        errors.push({ path: "settings.broadcastKHz", message: "Use 65–108 MHz in 0.05-MHz steps, or 0 for the 87.5-MHz default" });
    }
    for (const key of ["selectionA", "selectionB"]) {
        const selection = model.settings[key];
        if (integer(selection, 1, memories) && Array.isArray(model.channels) && !model.channels[selection - 1]) {
            errors.push({ path: `settings.${key}`, message: "Selected channel memory is empty; choose Frequency mode or an occupied Channel" });
        }
    }
    if (expanded) checkCollections(model, errors);
    return errors;
}

function requireValid(model) {
    const errors = validateModel(model);
    if (errors.length) throw new Error(errors.map(({ path, message }) => `${path || "configuration"}: ${message}`).join("; "));
}

function checkCollections(model, errors) {
    const fail = (path, message) => errors.push({path, message});
    const name = value => typeof value === 'string' && value.length <= 12 && !/[^\x20-\x7e]/.test(value);
    const dense = items => Array.isArray(items) && Object.keys(items).length === items.length && Object.keys(items).every((key, index) => key === String(index));
    const members = (items, path) => {
        if (!dense(items) || items.some(x => !integer(x, 1, 256) || !model.channels[x - 1]) || new Set(items).size !== items.length) {
            fail(path, 'Choose unique occupied channel numbers, 1–256'); return false;
        }
        return true;
    };
    for (const key of ['zones', 'scanLists']) {
        if (!dense(model[key]) || model[key].length !== 16) { fail(key, 'Expected exactly 16 slots'); continue; }
        model[key].forEach((item, index) => {
            if (item === null) return;
            const path = `${key}[${index}]`;
            if (!object(item)) { fail(path, 'Expected a named definition or null'); return; }
            ownKeys(item, key === 'zones' ? ['name', 'channels'] : ['name', 'type', 'reply', 'baseChannel', 'replyChannel', 'dwellMs', 'holdMs', 'channels', 'talkgroups'], path, errors);
            if (!name(item.name) || !item.name.length) fail(`${path}.name`, 'Use 1–12 printable ASCII characters');
            members(item.channels, `${path}.channels`);
            if (key === 'zones') return;
            if (!['channel', 'p25-tg'].includes(item.type)) fail(`${path}.type`, 'Choose Channel scan or P25 talkgroup scan');
            if (!['selected', 'last-heard', 'fixed'].includes(item.reply)) fail(`${path}.reply`, 'Choose a reply policy');
            if (!integer(item.dwellMs, 100, 5000)) fail(`${path}.dwellMs`, 'Dwell must be 100–5000 milliseconds');
            if (!integer(item.holdMs, 0, 10000)) fail(`${path}.holdMs`, 'Hold must be 0–10000 milliseconds');
            if (item.reply === 'fixed' ? !integer(item.replyChannel, 1, 256) || !model.channels[item.replyChannel - 1] : item.replyChannel !== 0) fail(`${path}.replyChannel`, 'Fixed reply requires an occupied channel; other replies use zero');
            if (!dense(item.talkgroups) || item.talkgroups.length > 64 || item.talkgroups.some(x => !integer(x, 1, 65535)) || new Set(item.talkgroups).size !== item.talkgroups.length) fail(`${path}.talkgroups`, 'Use up to 64 unique talkgroups, 1–65535');
            if (item.type === 'channel') {
                if (item.baseChannel !== 0 || item.talkgroups?.length) fail(path, 'Channel scan cannot have a base channel or talkgroup entries');
            } else if (item.type === 'p25-tg') {
                if (!integer(item.baseChannel, 1, 256) || model.channels[item.baseChannel - 1]?.mode !== 'P25') fail(`${path}.baseChannel`, 'Choose an occupied P25 receive channel');
                if (item.channels?.length) fail(`${path}.channels`, 'Talkgroup scan uses its base channel, without channel membership');
            }
        });
    }
    for (const [zoneKey, selectionKey] of [['zoneA', 'selectionA'], ['zoneB', 'selectionB']]) {
        const selected = model.settings[zoneKey], zone = model.zones?.[selected - 1];
        if (selected && !zone) fail(`settings.${zoneKey}`, 'Selected zone is empty');
        if (zone && model.settings[selectionKey] && !zone.channels.includes(model.settings[selectionKey])) fail(`settings.${selectionKey}`, 'Selected memory must belong to the side’s zone');
    }
}

export function createScanList(name = 'Scan list', type = 'channel', baseChannel = 0) {
    return {name, type, reply: 'selected', baseChannel: type === 'p25-tg' ? baseChannel : 0,
        replyChannel: 0, dwellMs: 1000, holdMs: 2000, channels: [], talkgroups: []};
}

function writeName(output, offset, name) { for (let i = 0; i < name.length; i++) output[offset + i] = name.charCodeAt(i); }
function readName(record, index) {
    let text = '', ended = false;
    for (const byte of record.subarray(0, 12)) {
        if (!byte) ended = true;
        else if (ended || byte < 32 || byte > 126) badRecord(index, 'invalid name padding');
        else text += String.fromCharCode(byte);
    }
    return text;
}
function writeMembers(output, offset, members) { for (const selection of members) output[offset + ((selection - 1) >>> 3)] |= 1 << ((selection - 1) & 7); }
function readMembers(record) { return Array.from({length: 256}, (_, i) => i + 1).filter(x => record[(x - 1) >>> 3] & 1 << ((x - 1) & 7)); }

/** CRC-32/IEEE, identical to the firmware and Python zlib.crc32. */
export function crc32(value) {
    let crc = 0xffffffff;
    for (const octet of bytes(value)) {
        crc ^= octet;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function toneWord(tone) {
    return (TONE_TYPES.indexOf(tone.type) << 14) | tone.value;
}

function writeChannel(output, index, channel) {
    if (channel === null) return;
    const offset = index * RECORD_BYTES;
    const data = new DataView(output.buffer, output.byteOffset + offset, RECORD_BYTES);
    data.setUint32(0, channel.rxHz, true);
    data.setUint32(4, channel.txHz, true);
    const dmr = channel.mode === "DMR";
    if (dmr) {
        output[offset + 8] = channel.destinationId & 255;
        output[offset + 9] = channel.destinationId >>> 8 & 255;
        output[offset + 10] = channel.destinationId >>> 16;
        output[offset + 11] = channel.colorCode | (channel.timeslot === 2 ? 16 : 0)
            | (channel.privateCall ? 32 : 0) | (channel.repeater ? 64 : 0);
        output[offset + 12] = 0x41 | (channel.rxOnly ? 16 : 0) | FILTERS.indexOf(channel.filter) << 2;
        output[offset + 30] = 5;
    } else {
        data.setUint16(8, channel.nac, true);
        data.setUint16(10, channel.talkgroup, true);
        output[offset + 12] = 1 | (channel.mode !== "P25" ? 2 : 0)
            | FILTERS.indexOf(channel.filter) << 2 | (channel.rxOnly ? 16 : 0) | (channel.mode === "FM" ? 32 : 0);
        data.setUint16(26, toneWord(channel.txTone), true);
        data.setUint16(28, toneWord(channel.rxTone), true);
        output[offset + 30] = channel.squelch;
    }
    output[offset + 13] = channel.scanLists.reduce((mask, list) => mask | 1 << list, 0);
    for (let i = 0; i < channel.name.length; i++) output[offset + 14 + i] = channel.name.charCodeAt(i);
    output[offset + 31] = channel.powerLevel;
}

/** Encode the complete canonical legacy/V4 database; no metadata or flash addresses. */
export function encodePayload(model) {
    requireValid(model);
    const version = modelVersion(model), memories = version === 4 ? 256 : 32;
    const output = new Uint8Array(recordCount(version) * RECORD_BYTES);
    model.channels.forEach((channel, index) => writeChannel(output, index, channel));
    model.vfos.forEach((channel, index) => writeChannel(output, memories + index, channel));
    const offset = (memories + 2) * RECORD_BYTES;
    const data = new DataView(output.buffer, offset, RECORD_BYTES);
    const settings = model.settings;
    data.setUint32(0, settings.sourceId, true);
    output[offset + 4] = settings.micGainDb;
    data.setUint16(5, settings.screenSeconds, true);
    data.setUint16(7, settings.keypadSeconds, true);
    for (const [i, key] of ["activeVfo", "selectionA", "selectionB", "scanList"].entries()) output[offset + 9 + i] = settings[key];
    output[offset + 13] = settings.txInhibit ? 1 : 0;
    data.setUint16(14, settings.totSeconds, true);
    for (const [index, key] of ["p1Action", "p2Action", "sk1Action", "sk2Action"].entries()) output[offset + 16 + index] = settings[key];
    data.setUint32(20, settings.broadcastKHz, true);
    if (version === 4) {
        output[offset + 24] = settings.selectionA >>> 8;
        output[offset + 25] = settings.selectionB >>> 8;
        output[offset + 26] = settings.zoneA;
        output[offset + 27] = settings.zoneB;
        model.zones.forEach((zone, i) => {
            if (!zone) return;
            writeName(output, (259 + i * 2) * 32, zone.name);
            writeMembers(output, (260 + i * 2) * 32, zone.channels);
        });
        model.scanLists.forEach((list, i) => {
            if (!list) return;
            const offset = (291 + i * 6) * 32, data = new DataView(output.buffer, offset, 192);
            writeName(output, offset, list.name);
            output[offset + 12] = list.type === 'p25-tg' ? 1 : 0;
            output[offset + 13] = ['selected', 'last-heard', 'fixed'].indexOf(list.reply);
            for (const [pos, key] of [[14, 'baseChannel'], [16, 'replyChannel'], [18, 'dwellMs'], [20, 'holdMs']]) data.setUint16(pos, list[key], true);
            output[offset + 22] = list.talkgroups.length;
            writeMembers(output, offset + 32, list.channels);
            list.talkgroups.forEach((tg, n) => data.setUint16(64 + n * 2, tg, true));
        });
    }
    return output;
}

function badRecord(index, message) {
    throw new Error(`CPS record ${index}: ${message}`);
}

function readTone(word, index) {
    const type = TONE_TYPES[word >>> 14], value = word & 0x3fff;
    if (type === "none" && value !== 0) badRecord(index, "unused tone has a nonzero value");
    return { type, value };
}

function readChannel(input, index, version) {
    const record = input.subarray(index * RECORD_BYTES, (index + 1) * RECORD_BYTES);
    const flags = record[12];
    if (!(flags & 1)) {
        if (record.some((value) => value !== 0)) badRecord(index, "empty record contains data");
        return null;
    }
    const dmr = Boolean(flags & 64);
    if (flags & 0x80 || (version === 1 && dmr) || (flags >> 2 & 3) > 2 || record[13] > (version === 4 ? 0 : 15) || (version < 3 && record[31] !== 0)) badRecord(index, "unknown flags or reserved bytes");
    if (!(flags & 2) && flags & 32) badRecord(index, "wide FM flag on a P25 channel");
    const data = new DataView(record.buffer, record.byteOffset, record.byteLength);
    let name = "", ended = false;
    for (const octet of record.subarray(14, 26)) {
        if (octet === 0) ended = true;
        else {
            if (ended || octet < 32 || octet > 126) badRecord(index, "invalid name or nonzero name padding");
            name += String.fromCharCode(octet);
        }
    }
    const common = { name, rxHz: data.getUint32(0, true), txHz: data.getUint32(4, true),
        rxOnly: Boolean(flags & 16), scanLists: [0, 1, 2, 3].filter((list) => record[13] & 1 << list), powerLevel: record[31] };
    if (dmr) {
        if (flags & 0x22 || record[11] & 128 || record.subarray(26, 30).some(x => x) || record[30] !== 5) badRecord(index, "invalid DMR flags or unused fields");
        return { ...common, mode: "DMR", destinationId: record[8] | record[9] << 8 | record[10] << 16,
            colorCode: record[11] & 15, timeslot: record[11] & 16 ? 2 : 1,
            privateCall: Boolean(record[11] & 32), repeater: Boolean(record[11] & 64), filter: FILTERS[flags >> 2 & 3] };
    }
    return {
        name, rxHz: data.getUint32(0, true), txHz: data.getUint32(4, true),
        mode: !(flags & 2) ? "P25" : flags & 32 ? "FM" : "NFM",
        nac: data.getUint16(8, true), talkgroup: data.getUint16(10, true), filter: FILTERS[flags >> 2 & 3],
        rxOnly: Boolean(flags & 16), scanLists: [0, 1, 2, 3].filter((list) => record[13] & 1 << list), squelch: record[30],
        powerLevel: record[31],
        txTone: readTone(data.getUint16(26, true), index), rxTone: readTone(data.getUint16(28, true), index),
    };
}

/** Decode and validate every byte, including padding, unused records and selected references. */
export function decodePayload(value, version = value?.length === RECORD_COUNT * 32 ? 4 : 3) {
    if (![1, 2, 3, 4].includes(version)) throw new Error("Unsupported CPS payload version");
    const input = bytes(value);
    const expected = recordCount(version) * RECORD_BYTES, memories = version === 4 ? 256 : 32;
    if (input.length !== expected) throw new Error(`Expected ${expected} CPS bytes, got ${input.length}`);
    const global = input.subarray((memories + 2) * RECORD_BYTES, (memories + 3) * RECORD_BYTES);
    if (global[13] > 1 || global.subarray(version < 3 ? 14 : version === 4 ? 28 : 24).some((octet) => octet !== 0)) badRecord(memories + 2, "invalid inhibit or reserved bytes");
    const data = new DataView(global.buffer, global.byteOffset, global.byteLength);
    const model = {
        channels: Array.from({ length: memories }, (_, index) => readChannel(input, index, version)),
        vfos: [readChannel(input, memories, version), readChannel(input, memories + 1, version)],
        settings: {
            sourceId: data.getUint32(0, true), micGainDb: global[4], screenSeconds: data.getUint16(5, true),
            keypadSeconds: data.getUint16(7, true), activeVfo: global[9], selectionA: global[10], selectionB: global[11],
            scanList: global[12], txInhibit: Boolean(global[13]),
            totSeconds: data.getUint16(14, true), p1Action: global[16], p2Action: global[17],
            sk1Action: global[18], sk2Action: global[19], broadcastKHz: data.getUint32(20, true),
        },
    };
    if (version === 4) {
        model.settings.selectionA |= global[24] << 8;
        model.settings.selectionB |= global[25] << 8;
        model.settings.zoneA = global[26]; model.settings.zoneB = global[27];
        model.zones = Array.from({length: 16}, (_, i) => {
            const key = 259 + i * 2, record = input.subarray(key * 32, (key + 2) * 32);
            if (!record.some(x => x)) return null;
            if (record.subarray(12, 32).some(x => x)) badRecord(key, 'zone reserved bytes');
            return {name: readName(record, key), channels: readMembers(record.subarray(32))};
        });
        model.scanLists = Array.from({length: 16}, (_, i) => {
            const key = 291 + i * 6, record = input.subarray(key * 32, (key + 6) * 32);
            if (!record.some(x => x)) return null;
            const data = new DataView(record.buffer, record.byteOffset, record.byteLength), count = record[22];
            if (record[12] > 1 || record[13] > 2 || count > 64 || record.subarray(23, 32).some(x => x) || record.subarray(64 + count * 2).some(x => x)) badRecord(key, 'scan reserved bytes or unknown mode');
            return {name: readName(record, key), type: record[12] ? 'p25-tg' : 'channel', reply: ['selected', 'last-heard', 'fixed'][record[13]],
                baseChannel: data.getUint16(14, true), replyChannel: data.getUint16(16, true), dwellMs: data.getUint16(18, true), holdMs: data.getUint16(20, true),
                channels: readMembers(record.subarray(32, 64)), talkgroups: Array.from({length: count}, (_, n) => data.getUint16(64 + n * 2, true))};
        });
    }
    requireValid(model);
    return model;
}

/** An offline draft only. Creating it never changes the radio's transmit policy. */
export function createDefaultModel(version = 4) {
    const channel = (name) => ({
        name, rxHz: 145700000, txHz: 145700000, mode: "P25", nac: 0x293, talkgroup: 1, filter: "NAC",
        rxOnly: false, scanLists: [], squelch: 5, powerLevel: 0, txTone: { type: "none", value: 0 }, rxTone: { type: "none", value: 0 },
    });
    const model = {
        channels: Array(version === 4 ? 256 : 32).fill(null), vfos: [channel("VFO A"), channel("VFO B")],
        settings: { sourceId: 1, micGainDb: 11, screenSeconds: 60, keypadSeconds: 15, activeVfo: 0, selectionA: 0, selectionB: 0, scanList: 0, txInhibit: false,
            totSeconds: 0, p1Action: 0, p2Action: 0, sk1Action: 0, sk2Action: 0, broadcastKHz: 0 },
    };
    if (version === 4) {
        Object.assign(model.settings, {zoneA: 0, zoneB: 0});
        model.zones = Array(16).fill(null); model.scanLists = Array(16).fill(null);
    }
    return model;
}

/** A deliberate mode conversion retains common channel fields only. */
export function setChannelMode(channel, mode) {
    if (!MODES.includes(mode)) throw new Error("Unsupported channel mode");
    const previous = channel.mode;
    if (previous === mode) return;
    channel.mode = mode;
    if (mode === "DMR") {
        for (const key of ["nac", "talkgroup", "squelch", "txTone", "rxTone"]) delete channel[key];
        Object.assign(channel, { destinationId: 1, colorCode: 1, timeslot: 1, privateCall: false, repeater: false, filter: "NAC" });
    } else if (previous === "DMR") {
        for (const key of ["destinationId", "colorCode", "timeslot", "privateCall", "repeater"]) delete channel[key];
        Object.assign(channel, { nac: 0x293, talkgroup: 1, filter: "NAC", squelch: 5,
            txTone: { type: "none", value: 0 }, rxTone: { type: "none", value: 0 } });
    }
    if (mode === "P25") {
        channel.txTone = { type: "none", value: 0 };
        channel.rxTone = { type: "none", value: 0 };
    }
}

function checkedOrigin(origin) {
    if (origin === null) return null;
    if (!object(origin) || Object.keys(origin).length !== 2 || !Object.hasOwn(origin, "revision") || !Object.hasOwn(origin, "crc")
        || !integer(origin.revision, 0, 0xffffffff) || !integer(origin.crc, 0, 0xffffffff)) {
        throw new Error("Origin must be null or a downloaded revision and CRC, both unsigned 32-bit integers");
    }
    return { revision: origin.revision, crc: origin.crc };
}

function hex(payload) {
    return Array.from(payload, (octet) => octet.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Save the complete logical database with an integrity check and optional download provenance. */
export function exportFile(model, origin = null) {
    const payload = encodePayload(model);
    return JSON.stringify({
        format: "DM32P25-CPS", version: modelVersion(model), payload: hex(payload),
        crc32: crc32(payload).toString(16).padStart(8, "0").toUpperCase(), origin: checkedOrigin(origin),
    }, null, 2) + "\n";
}

/** Open a versioned CPS JSON file. It cannot contain a firmware or raw-flash image. */
export function importFile(text) {
    if (typeof text !== "string") throw new TypeError("Expected CPS JSON text");
    let file;
    try { file = JSON.parse(text); } catch { throw new Error("Invalid CPS JSON file"); }
    const keys = ["format", "version", "payload", "crc32", "origin"];
    if (!object(file) || Object.keys(file).length !== keys.length || keys.some((key) => !Object.hasOwn(file, key))) throw new Error("Unrecognized CPS file fields");
    if (file.format !== "DM32P25-CPS" || ![1, 2, 3, 4].includes(file.version)) throw new Error("Unsupported CPS file format or version");
    if (typeof file.payload !== "string" || file.payload.length !== recordCount(file.version) * 64 || !/^[0-9a-f]+$/i.test(file.payload)) throw new Error("Invalid or truncated CPS payload");
    if (typeof file.crc32 !== "string" || !/^[0-9a-f]{8}$/i.test(file.crc32)) throw new Error("Invalid CPS checksum");
    const payload = Uint8Array.from(file.payload.match(/../g), (pair) => parseInt(pair, 16));
    if (crc32(payload) !== parseInt(file.crc32, 16)) throw new Error("CPS file checksum does not match its payload");
    return { model: decodePayload(payload, file.version), origin: checkedOrigin(file.origin) };
}

/** Explicit, lossless migration. Never run implicitly during radio upload. */
export function upgradeModel(legacy) {
    requireValid(legacy);
    if (modelVersion(legacy) === 4) return structuredClone(legacy);
    const model = createDefaultModel(4);
    Object.assign(model.settings, structuredClone(legacy.settings));
    model.vfos = structuredClone(legacy.vfos);
    model.channels.splice(0, 32, ...structuredClone(legacy.channels));
    for (let i = 0; i < 4; i++) {
        model.scanLists[i] = {...createScanList(`Scan ${i + 1}`), reply:'last-heard'};
        model.scanLists[i].channels = legacy.channels.flatMap((channel, n) => channel?.scanLists.includes(i) ? [n + 1] : []);
    }
    for (const channel of [...model.channels, ...model.vfos]) if (channel) channel.scanLists = [];
    requireValid(model);
    return model;
}

/** Remove every saved reference when clearing a channel. No orphaned base/reply. */
export function clearChannels(model, slots) {
    if (!Array.isArray(slots) || slots.some(slot => !integer(slot, 1, model.channels.length))) throw new Error('Invalid channel number');
    for (const slot of slots) {
        model.channels[slot - 1] = null;
        for (const key of ['selectionA', 'selectionB']) if (model.settings[key] === slot) model.settings[key] = 0;
        for (const zone of model.zones ?? []) if (zone) zone.channels = zone.channels.filter(x => x !== slot);
        for (let i = 0; i < (model.scanLists?.length ?? 0); i++) {
            const list = model.scanLists[i];
            if (!list) continue;
            if (list.baseChannel === slot) { model.scanLists[i] = null; continue; }
            list.channels = list.channels.filter(x => x !== slot);
            if (list.replyChannel === slot) { list.replyChannel = 0; list.reply = 'selected'; }
        }
    }
}

/** Stable slot move: shifts intervening records and rewrites all references. */
export function moveChannel(model, from, to) {
    requireValid(model);
    if (![from, to].every(x => integer(x, 1, model.channels.length))) throw new Error('Choose valid channel numbers');
    if (!model.channels[from - 1]) throw new Error('Source channel is empty');
    const map = value => value === from ? to : from < to && value > from && value <= to ? value - 1 : from > to && value >= to && value < from ? value + 1 : value;
    const [item] = model.channels.splice(from - 1, 1); model.channels.splice(to - 1, 0, item);
    for (const key of ['selectionA', 'selectionB']) model.settings[key] = map(model.settings[key]);
    for (const zone of model.zones ?? []) if (zone) zone.channels = zone.channels.map(map).sort((a, b) => a - b);
    for (const list of model.scanLists ?? []) if (list) {
        list.channels = list.channels.map(map).sort((a, b) => a - b);
        list.baseChannel = map(list.baseChannel); list.replyChannel = map(list.replyChannel);
    }
    requireValid(model);
}

export function bulkEditChannels(model, slots, patch) {
    if (!object(patch) || Object.keys(patch).some(key => !['rxOnly', 'powerLevel', 'filter', 'rxHz', 'txHz', 'nac', 'talkgroup', 'colorCode', 'timeslot', 'destinationId', 'squelch'].includes(key))) throw new Error('Unsupported bulk field');
    const candidate = structuredClone(model);
    for (const slot of slots) {
        if (!integer(slot, 1, candidate.channels.length) || !candidate.channels[slot - 1]) throw new Error('Choose occupied channel numbers');
        const channel = candidate.channels[slot - 1];
        for (const [key, value] of Object.entries(patch)) {
            if (!Object.hasOwn(channel, key) || ['nac', 'talkgroup'].includes(key) && channel.mode !== 'P25' || key === 'squelch' && !['NFM', 'FM'].includes(channel.mode) || key === 'filter' && !['P25', 'DMR'].includes(channel.mode)) throw new Error(`${key} is incompatible with channel ${slot} (${channel.mode})`);
            channel[key] = value;
        }
    }
    requireValid(candidate);
    Object.assign(model, candidate);
}

const CSV_FIELDS = ['channel', 'name', 'rxHz', 'txHz', 'mode', 'rxOnly', 'powerLevel', 'filter', 'nac', 'talkgroup', 'squelch', 'txToneType', 'txToneValue', 'rxToneType', 'rxToneValue', 'destinationId', 'colorCode', 'timeslot', 'privateCall', 'repeater', 'scanLists'];
const csvCell = value => /[",\r\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value);
export function exportChannelsCsv(model) {
    requireValid(model);
    const rows = model.channels.flatMap((channel, index) => channel ? [[index + 1, channel.name, channel.rxHz, channel.txHz, channel.mode, channel.rxOnly, channel.powerLevel, channel.filter,
        channel.nac ?? '', channel.talkgroup ?? '', channel.squelch ?? '', channel.txTone?.type ?? '', channel.txTone?.value ?? '', channel.rxTone?.type ?? '', channel.rxTone?.value ?? '',
        channel.destinationId ?? '', channel.colorCode ?? '', channel.timeslot ?? '', channel.privateCall ?? '', channel.repeater ?? '', channel.scanLists.join(';')]] : []);
    return [CSV_FIELDS, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
function parseCsv(text) {
    const rows = [], row = []; let field = '', quoted = false, closed = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) { if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') { quoted = false; closed = true; } else field += c; }
        else if (c === '"') { if (field || closed) throw new Error('Malformed CSV quote'); quoted = true; }
        else if (c === ',' || c === '\r' || c === '\n') {
            row.push(field); field = ''; closed = false;
            if (c !== ',') { if (c === '\r' && text[i + 1] === '\n') i++; rows.push(row.splice(0)); }
        } else { if (closed) throw new Error('Unexpected text after CSV quote'); field += c; }
    }
    if (quoted) throw new Error('Unclosed CSV quote');
    if (field || closed || row.length) { row.push(field); rows.push(row); }
    return rows;
}
/** Import only channel rows into a clone; references and existing absent rows survive. */
export function importChannelsCsv(text, model) {
    const rows = parseCsv(String(text).replace(/^\uFEFF/, ''));
    if (JSON.stringify(rows.shift()) !== JSON.stringify(CSV_FIELDS)) throw new Error('Use the exact DM32 channel CSV header from Export CSV');
    const candidate = structuredClone(model), seen = new Set();
    const number = (text, label) => { if (!/^\d+$/.test(text)) throw new Error(`Invalid integer for ${label}`); return Number(text); };
    const boolean = (text, label) => { if (!['true', 'false'].includes(text)) throw new Error(`Use true or false for ${label}`); return text === 'true'; };
    for (const row of rows) {
        if (row.length !== CSV_FIELDS.length) throw new Error('Wrong CSV column count');
        const item = Object.fromEntries(CSV_FIELDS.map((key, i) => [key, row[i]])), slot = number(item.channel, 'channel');
        if (!integer(slot, 1, candidate.channels.length) || seen.has(slot)) throw new Error('Duplicate or out-of-range CSV channel');
        seen.add(slot);
        const channel = {name: item.name, rxHz: number(item.rxHz, 'rxHz'), txHz: number(item.txHz, 'txHz'), mode: item.mode,
            rxOnly: boolean(item.rxOnly, 'rxOnly'), powerLevel: number(item.powerLevel, 'powerLevel'), filter: item.filter,
            scanLists: item.scanLists ? item.scanLists.split(';').map(x => number(x, 'scanLists')) : []};
        const dmr = item.mode === 'DMR';
        const used = dmr ? ['destinationId', 'colorCode', 'timeslot'] : ['nac', 'talkgroup', 'squelch'];
        for (const key of used) channel[key] = number(item[key], key);
        const unused = dmr ? ['nac', 'talkgroup', 'squelch', 'txToneType', 'txToneValue', 'rxToneType', 'rxToneValue'] : ['destinationId', 'colorCode', 'timeslot', 'privateCall', 'repeater'];
        if (unused.some(key => item[key] !== '')) throw new Error(`Unused ${item.mode} columns must be empty`);
        if (dmr) for (const key of ['privateCall', 'repeater']) channel[key] = boolean(item[key], key);
        else for (const key of ['txTone', 'rxTone']) channel[key] = {type: item[`${key}Type`], value: number(item[`${key}Value`], `${key}Value`)};
        candidate.channels[slot - 1] = channel;
    }
    requireValid(candidate);
    return candidate;
}
