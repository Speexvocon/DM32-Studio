// SPDX-License-Identifier: GPL-3.0-or-later
// DM32-only transport. The caller owns file validation, backup persistence and
// independent postflash comparison. No running-firmware commands are sent.
import {SerialStream} from './vendor/flasher/link.js';
import {Stub, stubImages, ROM_REPEAT} from './vendor/flasher/stub.js';
import {BfLoader, checkImage} from './vendor/flasher/bfloader.js';
import {sha256} from './vendor/flasher/bytes.js';

export const UPSTREAM_COMMIT = '75c46ea46d5ebf6406f5b4ce0bbe2443b7649f91';
export const MONITOR_SHA256 = 'eae5b98615d67ba465061c84a5fb209a902333dc700671ce4ca69a05eb4aaee9';
export const DM32 = Object.freeze({loaderId: 'BFUV32-V2', programSize: 0x100000,
  dataSize: 0x1000000, appStart: 0xc000, appEnd: 0x100000});
const ASSETS = new URL('./vendor/dm32-loader.json', import.meta.url);
const notify = (fn, value) => {try { fn?.(value); } catch { /* presentation only */ }};
const fail = (message, code) => Object.assign(new Error(message), {name: 'WebFlashError', code});
const aborted = signal => {if (signal?.aborted) throw fail('Operation stopped.', 'ABORTED');};

export class WebFlashDevice {
  constructor({serial = globalThis.navigator?.serial, port = null, log = () => {},
    fetch = globalThis.fetch, assets = null, streamFactory = port => SerialStream.open(port, 115200),
    romTimeoutMs = 120000, factoryTimeoutMs = 120000, slowCable = false} = {}) {
    for (const value of [romTimeoutMs, factoryTimeoutMs]) {
      if (!Number.isFinite(value) || value <= 0 || value > 120000) throw new TypeError('Invalid loader timeout.');
    }
    this._serial = serial; this._port = port; this._log = log;
    this._fetch = fetch; this._assetInput = assets; this._streamFactory = streamFactory;
    this._romTimeout = romTimeoutMs; this._factoryTimeout = factoryTimeoutMs;
    this._slowCable = Boolean(slowCable);
    this._stream = this._stub = this._factory = this._assets = null;
    this._busy = false; this._operation = null;
  }

  get selectedPort() {return this._port;}
  get connected() {return Boolean(this._stream && !this._stream.closed && !this._stream.lost);}
  _note(message) {notify(this._log, message);}
  _requireConnected() {if (!this.connected) throw fail('Connect the programming cable first.', 'NOT_CONNECTED');}

  async _run(signal, operation) {
    if (this._busy) throw fail('Another radio operation is running.', 'IN_USE');
    aborted(signal);
    this._busy = true;
    const control = new AbortController(); this._operation = control;
    const stop = () => control.abort(); signal?.addEventListener('abort', stop, {once: true});
    try {
      aborted(signal);
      const result = await operation(control.signal);
      aborted(control.signal);
      return result;
    } finally {
      signal?.removeEventListener('abort', stop);
      if (this._operation === control) this._operation = null;
      this._busy = false;
    }
  }

  // Call from a user click. A supplied/injected port avoids another chooser.
  async connect({port} = {}) {
    return this._run(null, async signal => {
      if (this.connected) return this;
      let selected = port || this._port;
      if (!selected) {
        if (!this._serial?.requestPort) throw fail('This browser does not provide Web Serial.', 'UNSUPPORTED');
        selected = await this._serial.requestPort();
      }
      aborted(signal);
      this._port = selected;
      await this._openStream(selected, signal);
      this._stub = this._factory = null;
      return this;
    });
  }

  async _openStream(port, signal) {
    const stream = await this._streamFactory(port);
    if (signal.aborted || this._port !== port) {
      await stream.close();
      throw fail('Operation stopped.', 'ABORTED');
    }
    this._stream = stream;
  }

  async _closeStream() {
    const stream = this._stream;
    this._stream = this._stub = this._factory = null;
    if (stream) await stream.close();
  }

  async close() {
    this._operation?.abort();
    try {await this._closeStream();} finally {this._port = null;}
  }

  async _loadAssets() {
    if (this._assets) return this._assets;
    let json = this._assetInput;
    if (!json) {
      const response = await this._fetch(ASSETS);
      if (!response.ok) throw fail('The pinned RAM reader could not be loaded.', 'ASSET');
      json = await response.json();
    }
    const b = json?.board, p = b?.profile, led = b?.led;
    if (json?.format !== 'dm32-p25-browser-loader/1' || json.sourceCommit !== UPSTREAM_COMMIT ||
        b?.id !== 'dm32' || b.loaderId !== DM32.loaderId || b.programSize !== DM32.programSize ||
        b.dataSize !== DM32.dataSize || b.appStart !== DM32.appStart || b.appEnd !== DM32.appEnd ||
        p?.id !== 1 || p.latch !== 255 || p.key !== 255 || p.nand !== false || led?.red !== 33 || led.green !== 32) {
      throw fail('The loader asset is not the pinned DM32 profile.', 'ASSET');
    }
    const image = stubImages(json.stub);
    if (image.sha !== MONITOR_SHA256 || await sha256(image.image) !== MONITOR_SHA256 ||
        image.load !== 0x10000 || image.run !== 0x30000 || image.end !== 0x37c90) {
      throw fail('The RAM reader image does not match its pinned checksum/layout.', 'ASSET');
    }
    // Fixed project policy, independent of optional metadata in the asset.
    const protect = [
      {mem: 'progmem', start: 0, end: 0xc000, what: 'factory bootloader'},
      {mem: 'data', start: 0x1000, end: 0xc9000, what: 'factory calibration'},
      {mem: 'data', start: 0x710000, end: 0x711000, what: 'fallback calibration'},
    ];
    this._assets = {image, profile: {...p, protect}, led: {...led}, protect};
    return this._assets;
  }

  // The caller must have the radio OFF before a first/fresh read. Only a known
  // monitor from this instance is reused; there is no probe of an active app.
  async readSnapshot({onProgress, onPhase, signal, fresh = false} = {}) {
    return this._run(signal, async activeSignal => {
      this._requireConnected();
      const a = await this._loadAssets(); aborted(activeSignal);
      this._factory = null;
      try {
        if (fresh || !this._stub) {
          this._stub = null;
          const reader = new Stub(this._stream, {log: message => this._note(message)});
          const waiting = reader.waitForRom(this._romTimeout,
            {signal: activeSignal, repeat: this._slowCable ? ROM_REPEAT : 0});
          this._note('RAM reader is listening. Turn the radio on normally now; leave PTT released.');
          notify(onPhase, 'power-on');
          const reply = await waiting;
          aborted(activeSignal);
          await reader.loadThroughRom(a.image.image, a.image.load,
            (current, total) => notify(onProgress, {memory: 'loader', current, total}), reply);
          aborted(activeSignal);
          await reader.configure(a.profile, a.led);
          this._stub = reader;
        }
        const reader = this._stub;
        notify(onPhase, 'read-program');
        const program = await reader.dump('progmem', 0, DM32.programSize, {signal: activeSignal,
          progress: (current, total) => notify(onProgress, {memory: 'program', current, total})});
        aborted(activeSignal);
        const boot = new TextDecoder('latin1').decode(program.subarray(0, DM32.appStart));
        if (!boot.includes(DM32.loaderId)) throw fail('The program read does not identify a DM32 bootloader.', 'WRONG_MODEL');
        notify(onPhase, 'read-data');
        const data = await reader.dump('q128', 0, DM32.dataSize, {signal: activeSignal,
          progress: (current, total) => notify(onProgress, {memory: 'data', current, total})});
        aborted(activeSignal);
        if (program.length !== DM32.programSize || data.length !== DM32.dataSize) throw fail('Incomplete radio snapshot.', 'READBACK');
        notify(onPhase, 'snapshot-ready');
        return {program, data};
      } catch (error) {
        this._stub = null;
        throw error;
      }
    });
  }

  // Reopen only the selected cable, then identify before any erase. The factory
  // loader answers steps1–3 only once, so keep this exact BfLoader for write().
  async factoryIdentify({signal, onPhase} = {}) {
    return this._run(signal, async activeSignal => {
      this._requireConnected();
      const a = await this._loadAssets();
      const port = this._port;
      await this._closeStream(); aborted(activeSignal);
      await this._openStream(port, activeSignal); aborted(activeSignal);
      const loader = new BfLoader(this._stream, {id: DM32.loaderId,
        appStart: DM32.appStart, appMax: DM32.appEnd - DM32.appStart, protect: a.protect,
        log: message => this._note(message)});
      const waiting = loader.listen(this._factoryTimeout, {signal: activeSignal});
      this._note('Updater is listening. Enter factory update mode with PTT + SK1; release both when the green LED lights.');
      notify(onPhase, 'factory-mode');
      const identity = await waiting; aborted(activeSignal);
      this._factory = loader;
      return identity;
    });
  }

  async write(raw, {onProgress, onPhase, signal} = {}) {
    return this._run(signal, async activeSignal => {
      this._requireConnected();
      if (!this._factory?.ready) throw fail('Identify the radio in factory update mode before writing.', 'NEED_IDENTIFY');
      if (!(raw instanceof Uint8Array)) throw new TypeError('The updater requires a raw Uint8Array application.');
      checkImage(raw, DM32.appEnd - DM32.appStart);
      const image = raw.slice(); // immutable transaction snapshot
      const loader = this._factory;
      this._factory = this._stub = null;
      const blocksWritten = await loader.write(image, {name: 'dm32-p25.bin', signal: activeSignal,
        onPhase: phase => notify(onPhase, phase),
        onPage: (current, total) => notify(onProgress, {memory: 'application', current, total})});
      this._note('Transfer finished. Independent program readback is still required.');
      return {blocksWritten, transferred: true, independentlyVerified: false};
    });
  }
}
