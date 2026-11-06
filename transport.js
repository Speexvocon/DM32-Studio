// SPDX-License-Identifier: GPL-3.0-or-later
import { crc32, decodePayload, recordCount, RECORD_BYTES } from './model.js';

const MAX_FRAME = 120;
const encoder = new TextEncoder();
const hex32 = value => (value >>> 0).toString(16).toUpperCase().padStart(8, '0');
const sameOrigin = (a, b) => a && b && a.revision === b.revision && a.crc === b.crc;
const now = () => globalThis.performance?.now() ?? Date.now();

async function boundedCleanup(promise, milliseconds) {
  let timer;
  try {
    await Promise.race([promise, new Promise(resolve => { timer = setTimeout(resolve, milliseconds); })]);
  } catch { /* cleanup must also finish after a physical USB loss */ }
  finally { clearTimeout(timer); }
}

function failure(message, code, options = {}) {
  return Object.assign(new Error(message, options.cause ? { cause: options.cause } : undefined),
    { name: 'CpsError', code, ...options });
}

function snapshotOrigin(origin) {
  if (!origin || !Number.isInteger(origin.revision) || origin.revision < 0 ||
      origin.revision > 0xFFFFFFFF || !Number.isInteger(origin.crc) ||
      origin.crc < 0 || origin.crc > 0xFFFFFFFF) {
    throw failure('Read the radio before uploading this configuration.', 'NEED_READ');
  }
  return { revision: origin.revision, crc: origin.crc };
}

/** Bounded logical CPS V1–V4 transport; schema and geometry are pinned for the connection. */
export class CpsClient {
  constructor({ serial = globalThis.navigator?.serial, timeoutMs = 3000,
    onProgress = () => {} } = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('Invalid CPS timeout');
    this.serial = serial;
    this.timeoutMs = timeoutMs;
    this.onProgress = onProgress;
    this._port = this._reader = this._writer = null;
    this._connected = this._tainted = this._busy = false;
    this._origin = null;
    this._protocol = null;
    this._pending = [];
    this._loss = null;
    this._closing = null;
    this._generation = 0;
    this._onDisconnect = event => {
      if (event.target === this._port || event.port === this._port) {
        this._taint(failure('The radio was disconnected. Reconnect and read it again.', 'DISCONNECTED'));
      }
    };
  }

  get connected() { return this._connected && !this._tainted; }
  get protocolVersion() { return this._protocol; }

  _progress(phase, current, message) {
    // Presentation callbacks must never turn a confirmed radio commit into an error.
    try { this.onProgress({ phase, current, total: recordCount(this._protocol), message }); } catch { /* UI only */ }
  }

  _assertConnected() {
    if (!this.connected) throw failure(this._tainted
      ? 'The serial stream is uncertain. Disconnect, reconnect, then read the radio again.'
      : 'Connect the radio first.', 'NOT_CONNECTED');
  }

  async _run(operation) {
    if (this._busy) throw failure('Another radio operation is still running.', 'IN_USE');
    this._busy = true;
    try { return await operation(); } finally { this._busy = false; }
  }

  _taint(error) {
    this._tainted = true;
    this._connected = false;
    this._origin = null;
    this._loss?.reject(error);
    // A timed-out read must not survive to consume the next command's reply.
    try { Promise.resolve(this._reader?.cancel()).catch(() => {}); } catch { /* unplugged */ }
  }

  async _deadline(promise, deadline) {
    let timer;
    try {
      const result = await Promise.race([promise, this._loss.promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(failure(
            'The radio response timed out. Reconnect and read the radio again.', 'TIMEOUT')),
          Math.max(0, deadline - now()));
        })]);
      if (now() > deadline) throw failure(
        'The radio response arrived after its deadline. Reconnect and read again.', 'TIMEOUT');
      return result;
    } finally { clearTimeout(timer); }
  }

  async _exchange(command) {
    this._assertConnected();
    if (!/^CPS (?:HELLO|GET [0-9]+|BEGIN [0-9A-F]{8} [0-9]+|PUT [0-9A-F]{8} [0-9]+ [0-9A-F]{64}|COMMIT [0-9A-F]{8} [0-9A-F]{8}|ABORT [0-9A-F]{8})$/.test(command)) {
      throw failure('Invalid logical CPS command.', 'COMMAND');
    }
    const request = encoder.encode(command + '\r\n');
    if (request.length > MAX_FRAME) throw failure('CPS command exceeds its framing limit.', 'FRAME');
    const deadline = now() + this.timeoutMs;
    try {
      await this._deadline(this._writer.write(request), deadline);
      const bytes = [];
      while (bytes.length < MAX_FRAME) {
        if (!this._pending.length) {
          const { value, done } = await this._deadline(this._reader.read(), deadline);
          if (done) throw failure('The radio serial stream closed. Reconnect and read again.', 'DISCONNECTED');
          if (!(value instanceof Uint8Array)) throw failure('Invalid serial response bytes.', 'FRAME');
          if (value.length > MAX_FRAME) throw failure('CPS response exceeds its framing limit.', 'FRAME');
          this._pending.push(...value);
          if (!value.length) continue;
        }
        const byte = this._pending.shift();
        bytes.push(byte);
        if (byte === 10) {
          if (bytes.length < 2 || bytes.at(-2) !== 13 || this._pending.length) {
            throw failure('Malformed or unsolicited CPS response. Reconnect and read again.', 'FRAME');
          }
          const response = String.fromCharCode(...bytes.slice(0, -2));
          if (/^CPS ERR [A-Z_]+$/.test(response)) {
            const radioCode = response.slice(8);
            const message = radioCode === 'TRANSACTION'
              ? 'An earlier transfer is still staged. Wait 60 seconds without sending commands, then reconnect and read the radio.'
              : radioCode === 'BUSY'
                ? 'The radio is busy or PTT is held. Release PTT and finish the current operation before programming.'
                : 'Radio refused programming: ' + radioCode;
            throw failure(message, 'REFUSED', { radioCode });
          }
          return response;
        }
        if ((byte < 32 || byte > 126) && byte !== 13 ||
            (bytes.length > 1 && bytes.at(-2) === 13)) {
          throw failure('Non-ASCII or malformed CPS response. Reconnect and read again.', 'FRAME');
        }
      }
      throw failure('CPS response exceeds its 120-byte framing limit.', 'FRAME');
    } catch (error) {
      if (error.code !== 'REFUSED') this._taint(error);
      throw error;
    }
  }

  _unexpected(message) {
    const error = failure(message + ' Reconnect and read the radio again.', 'PROTOCOL');
    this._taint(error);
    return error;
  }

  async _hello() {
    const reply = await this._exchange('CPS HELLO');
    const match = /^CPS HELLO DM32P25 ([1234]) (32|256) 2 ([0-9]+) ([0-9A-F]{8})$/.exec(reply);
    if (!match || Number(match[3]) > 0xFFFFFFFF || Number(match[2]) !== (Number(match[1]) === 4 ? 256 : 32) || (this._protocol !== null && this._protocol !== Number(match[1]))) {
      throw this._unexpected('Wrong firmware identity, geometry or CPS protocol.');
    }
    this._protocol = Number(match[1]);
    return { revision: Number(match[3]), crc: parseInt(match[4], 16) };
  }

  /** Call directly from a user click; this deliberately never discovers or opens ports automatically. */
  async connect() {
    return this._run(async () => {
      if (!this.serial?.requestPort) throw failure('Web Serial is unavailable in this browser.', 'UNSUPPORTED');
      if (this._port || this._closing) throw failure('Disconnect the previous serial connection first.', 'IN_USE');
      this._origin = null;
      this._protocol = null;
      this._tainted = false;
      const generation = ++this._generation;
      try {
        const port = await this.serial.requestPort();
        if (generation !== this._generation) throw failure('Connection cancelled.', 'DISCONNECTED');
        this._port = port;
        await this._port.open({ baudRate: 115200, dataBits: 8, stopBits: 1,
          parity: 'none', flowControl: 'none' });
        if (generation !== this._generation) {
          try { await port.close(); } catch { /* already closed */ }
          throw failure('Connection cancelled.', 'DISCONNECTED');
        }
        this._reader = this._port.readable.getReader();
        this._writer = this._port.writable.getWriter();
        this._pending = [];
        let reject;
        const promise = new Promise((_, rejectPromise) => { reject = rejectPromise; });
        promise.catch(() => {}); // No unhandled rejection between user operations.
        this._loss = { promise, reject };
        this.serial.addEventListener?.('disconnect', this._onDisconnect);
        this._connected = true;
        return await this._hello();
      } catch (error) {
        await this.disconnect();
        throw error;
      }
    });
  }

  async disconnect() {
    if (this._closing) return this._closing;
    ++this._generation;
    this._connected = false;
    this._origin = null;
    this._protocol = null;
    this._loss?.reject(failure('Disconnected. Reconnect and read the radio again.', 'DISCONNECTED'));
    this.serial?.removeEventListener?.('disconnect', this._onDisconnect);
    const reader = this._reader, writer = this._writer, port = this._port;
    this._reader = this._writer = this._port = null;
    this._pending = [];
    this._closing = (async () => {
      // Cancellation clears a pending browser read; abort clears a pending write.
      await boundedCleanup(Promise.allSettled([
        Promise.resolve().then(() => reader?.cancel()),
        Promise.resolve().then(() => writer?.abort()),
      ]), Math.min(this.timeoutMs, 1000));
      try { reader?.releaseLock(); } catch { /* already disconnected */ }
      try { writer?.releaseLock(); } catch { /* already disconnected */ }
      await boundedCleanup(Promise.resolve().then(() => port?.close()), Math.min(this.timeoutMs, 1000));
    })();
    try { await this._closing; } finally { this._closing = null; }
  }

  async read() {
    return this._run(async () => {
      this._assertConnected();
      this._origin = null;
      const origin = await this._hello();
      const count = recordCount(this._protocol);
      const payload = new Uint8Array(count * RECORD_BYTES);
      for (let index = 0; index < count; index++) {
        const reply = await this._exchange(`CPS GET ${index}`);
        const match = new RegExp(`^CPS DATA ${index} ([0-9A-F]{${RECORD_BYTES * 2}})$`).exec(reply);
        if (!match) throw this._unexpected('Wrong or malformed CPS record response.');
        for (let byte = 0; byte < RECORD_BYTES; byte++) {
          payload[index * RECORD_BYTES + byte] = parseInt(match[1].slice(byte * 2, byte * 2 + 2), 16);
        }
        this._progress('read', index + 1, 'Reading radio configuration');
      }
      if (!sameOrigin(origin, await this._hello()) || crc32(payload) !== origin.crc) {
        throw failure('The configuration changed during download or its checksum failed. Read the radio again.', 'CHECKSUM');
      }
      decodePayload(payload, this._protocol);
      this._origin = { ...origin };
      return { payload, ...origin };
    });
  }

  async write(payload, origin) {
    return this._run(async () => {
      this._assertConnected();
      const supplied = snapshotOrigin(origin);
      if (!sameOrigin(supplied, this._origin)) {
        throw failure('A fresh radio read is required before uploading this configuration.', 'NEED_READ');
      }
      const image = new Uint8Array(payload);
      const model = decodePayload(image);
      const count = recordCount(this._protocol);
      if (image.length !== count * RECORD_BYTES) {
        throw failure(this._protocol === 4
          ? 'This is a legacy 32-channel codeplug. Explicitly upgrade it to V4 before writing to this radio. No transfer was started.'
          : 'This radio supports 32 channels. Expanded V4 data cannot be truncated; use V4 firmware or a separate legacy codeplug. No transfer was started.', 'UNSUPPORTED_GEOMETRY');
      }
      if (this._protocol === 1 && [...model.channels, ...model.vfos].some(channel => channel?.mode === 'DMR')) {
        throw failure('This radio uses CPS protocol 1 and cannot store DMR channels. DMR requires the unified firmware.', 'UNSUPPORTED_MODE');
      }
      if (this._protocol < 3 && ([...model.channels, ...model.vfos].some(channel => channel?.powerLevel)
          || ['totSeconds', 'p1Action', 'p2Action', 'sk1Action', 'sk2Action', 'broadcastKHz'].some(key => model.settings[key] !== 0))) {
        throw failure('Programmable power, timeout, buttons and FM broadcast settings require CPS protocol 3 firmware. No transfer was started.', 'UNSUPPORTED_FUNCTIONS');
      }
      decodePayload(image, this._protocol);
      const current = await this._hello();
      if (!sameOrigin(supplied, current)) {
        this._origin = null;
        throw failure('The radio settings changed. Read this radio again before uploading.', 'STALE');
      }
      const crc = crc32(image);
      if (crc === current.crc) {
        this._progress('write', count, 'Configuration unchanged; no write needed');
        return { ...current, unchanged: true };
      }
      if (!globalThis.crypto?.getRandomValues) throw failure('Secure transaction IDs are unavailable.', 'UNSUPPORTED');
      const random = globalThis.crypto.getRandomValues(new Uint32Array(1))[0] || 1;
      const tid = hex32(random);
      let started = false, commitSent = false;
      try {
        if (await this._exchange(`CPS BEGIN ${tid} ${current.revision}`) !== `CPS OK BEGIN ${tid}`) {
          throw this._unexpected('Unexpected CPS BEGIN acknowledgement.');
        }
        started = true;
        for (let index = 0; index < count; index++) {
          const record = Array.from(image.subarray(index * RECORD_BYTES, (index + 1) * RECORD_BYTES),
            byte => byte.toString(16).toUpperCase().padStart(2, '0')).join('');
          if (await this._exchange(`CPS PUT ${tid} ${index} ${record}`) !== `CPS OK PUT ${tid} ${index}`) {
            throw this._unexpected('Unexpected CPS PUT acknowledgement.');
          }
          this._progress('write', index + 1, 'Staging radio configuration');
        }
        // From this point a failed response can mean the bank was already published.
        commitSent = true;
        const reply = await this._exchange(`CPS COMMIT ${tid} ${hex32(crc)}`);
        const expected = { revision: (current.revision + 1) >>> 0, crc };
        if (reply !== `CPS OK COMMIT ${tid} ${expected.revision} ${hex32(crc)}`) {
          throw this._unexpected('Unexpected CPS COMMIT acknowledgement.');
        }
        if (!sameOrigin(expected, await this._hello())) {
          throw this._unexpected('Post-commit configuration verification failed.');
        }
        this._origin = { ...expected };
        return { ...expected, unchanged: false };
      } catch (error) {
        if (commitSent) {
          const uncertain = failure('Upload result is uncertain. Disconnect, reconnect and read the radio before another upload.',
            'UNCERTAIN', { uncertain: true, cause: error });
          this._taint(uncertain);
          throw uncertain;
        }
        if (started && this.connected) {
          try {
            if (await this._exchange(`CPS ABORT ${tid}`) !== `CPS OK ABORT ${tid}`) {
              throw this._unexpected('Unexpected CPS ABORT acknowledgement.');
            }
          } catch (abortError) { this._taint(abortError); }
        }
        throw error;
      }
    });
  }
}
