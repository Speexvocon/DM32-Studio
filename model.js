// SPDX-License-Identifier: GPL-3.0-or-later
// Logical CPS v3 records. V1/V2 imports retain their exact bytes and CRC.

export const RECORD_BYTES = 32;
export const RECORD_COUNT = 35;
export const MEMORY_COUNT = 32;
export const FILTERS = Object.freeze(["NAC", "PROM", "NAC+TG"]);
export const POWER_LEVELS = Object.freeze(["L−", "L", "L+", "L++", "M", "M+", "M++", "H−", "H"]);
export const BUTTON_ACTIONS = Object.freeze(["Default", "None", "VFO / memory", "Switch A / B", "Scan", "Cycle TX power", "FM broadcast", "Radio status", "Keypad lock"]);

const PAYLOAD_BYTES = RECORD_BYTES * RECORD_COUNT;
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

function checkChannel(channel, path, errors) {
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
    if (!Array.isArray(channel.scanLists) || channel.scanLists.length > 4
        || channel.scanLists.some((item) => !integer(item, 0, 3))
        || new Set(channel.scanLists).size !== channel.scanLists.length
        || Object.keys(channel.scanLists).length !== channel.scanLists.length
        || Object.keys(channel.scanLists).some((key, index) => key !== String(index))) {
        errors.push({ path: `${path}.scanLists`, message: "Use each scan list 0–3 at most once" });
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
    ownKeys(model, ["channels", "vfos", "settings"], "", errors);
    for (const [key, count] of [["channels", MEMORY_COUNT], ["vfos", 2]]) {
        if (!Array.isArray(model[key]) || model[key].length !== count) {
            errors.push({ path: key, message: `Expected exactly ${count} slots` });
            continue;
        }
        for (let index = 0; index < count; index++) checkChannel(model[key][index], `${key}[${index}]`, errors);
        if (Object.keys(model[key]).some((item) => !/^(0|[1-9]\d*)$/.test(item) || Number(item) >= count)) {
            errors.push({ path: key, message: "Unexpected array fields" });
        }
    }
    if (!object(model.settings)) {
        errors.push({ path: "settings", message: "Expected radio settings" });
        return errors;
    }
    ownKeys(model.settings, SETTINGS_KEYS, "settings", errors);
    const ranges = {
        sourceId: [1, 0xffffff], micGainDb: [0, 42], screenSeconds: [0, 600], keypadSeconds: [0, 600],
        activeVfo: [0, 1], selectionA: [0, MEMORY_COUNT], selectionB: [0, MEMORY_COUNT], scanList: [0, 3],
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
        if (integer(selection, 1, MEMORY_COUNT) && Array.isArray(model.channels) && !model.channels[selection - 1]) {
            errors.push({ path: `settings.${key}`, message: "Selected memory is empty; select VFO or an occupied memory" });
        }
    }
    return errors;
}

function requireValid(model) {
    const errors = validateModel(model);
    if (errors.length) throw new Error(errors.map(({ path, message }) => `${path || "configuration"}: ${message}`).join("; "));
}

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

/** Encode the complete canonical 1120-byte database; no metadata or flash addresses. */
export function encodePayload(model) {
    requireValid(model);
    const output = new Uint8Array(PAYLOAD_BYTES);
    model.channels.forEach((channel, index) => writeChannel(output, index, channel));
    model.vfos.forEach((channel, index) => writeChannel(output, MEMORY_COUNT + index, channel));
    const offset = 34 * RECORD_BYTES;
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
    if (flags & 0x80 || (version === 1 && dmr) || (flags >> 2 & 3) > 2 || record[13] > 15 || (version < 3 && record[31] !== 0)) badRecord(index, "unknown flags or reserved bytes");
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
export function decodePayload(value, version = 3) {
    if (![1, 2, 3].includes(version)) throw new Error("Unsupported CPS payload version");
    const input = bytes(value);
    if (input.length !== PAYLOAD_BYTES) throw new Error(`Expected ${PAYLOAD_BYTES} CPS bytes, got ${input.length}`);
    const global = input.subarray(34 * RECORD_BYTES);
    if (global[13] > 1 || global.subarray(version < 3 ? 14 : 24).some((octet) => octet !== 0)) badRecord(34, "invalid inhibit or reserved bytes");
    const data = new DataView(global.buffer, global.byteOffset, global.byteLength);
    const model = {
        channels: Array.from({ length: MEMORY_COUNT }, (_, index) => readChannel(input, index, version)),
        vfos: [readChannel(input, 32, version), readChannel(input, 33, version)],
        settings: {
            sourceId: data.getUint32(0, true), micGainDb: global[4], screenSeconds: data.getUint16(5, true),
            keypadSeconds: data.getUint16(7, true), activeVfo: global[9], selectionA: global[10], selectionB: global[11],
            scanList: global[12], txInhibit: Boolean(global[13]),
            totSeconds: data.getUint16(14, true), p1Action: global[16], p2Action: global[17],
            sk1Action: global[18], sk2Action: global[19], broadcastKHz: data.getUint32(20, true),
        },
    };
    requireValid(model);
    return model;
}

/** An offline draft only. Creating it never changes the radio's transmit policy. */
export function createDefaultModel() {
    const channel = (name) => ({
        name, rxHz: 145700000, txHz: 145700000, mode: "P25", nac: 0x293, talkgroup: 1, filter: "NAC",
        rxOnly: false, scanLists: [], squelch: 5, powerLevel: 0, txTone: { type: "none", value: 0 }, rxTone: { type: "none", value: 0 },
    });
    return {
        channels: Array(MEMORY_COUNT).fill(null), vfos: [channel("VFO A"), channel("VFO B")],
        settings: { sourceId: 1, micGainDb: 11, screenSeconds: 60, keypadSeconds: 15, activeVfo: 0, selectionA: 0, selectionB: 0, scanList: 0, txInhibit: false,
            totSeconds: 0, p1Action: 0, p2Action: 0, sk1Action: 0, sk2Action: 0, broadcastKHz: 0 },
    };
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
        format: "DM32P25-CPS", version: 3, payload: hex(payload),
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
    if (file.format !== "DM32P25-CPS" || ![1, 2, 3].includes(file.version)) throw new Error("Unsupported CPS file format or version");
    if (typeof file.payload !== "string" || file.payload.length !== PAYLOAD_BYTES * 2 || !/^[0-9a-f]+$/i.test(file.payload)) throw new Error("Invalid or truncated CPS payload");
    if (typeof file.crc32 !== "string" || !/^[0-9a-f]{8}$/i.test(file.crc32)) throw new Error("Invalid CPS checksum");
    const payload = Uint8Array.from(file.payload.match(/../g), (pair) => parseInt(pair, 16));
    if (crc32(payload) !== parseInt(file.crc32, 16)) throw new Error("CPS file checksum does not match its payload");
    return { model: decodePayload(payload, file.version), origin: checkedOrigin(file.origin) };
}
