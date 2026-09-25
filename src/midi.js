// MIDI for MACHINEDRUM: Web MIDI API (USB / OS-paired Bluetooth) and direct Web Bluetooth
// (BLE MIDI GATT pairing from the page). Both feed one event stream into the app.
//
// IN : notes (GM drum map + chromatic), velocity, transport (start/stop/continue),
//      clock -> tempo, program change -> pattern.
// OUT: sequencer notes on the first available output.
// Not mapped (deliberately): CC/knob control, sysex, MIDI file playback.
//
// The pure helpers at the top (parseMidiMessage, parseBlePacket, trackFromNote,
// TempoEstimator) are exercised by midi.test.mjs and must stay navigator-free.

// BLE MIDI service/characteristic UUIDs (BLE-MIDI spec).
export const BLE_MIDI_SERVICE = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
export const BLE_MIDI_CHARACTERISTIC = '7772e5db-3868-4112-a1a9-f2669d106bf9';

// General MIDI percussion -> track index. Kit tracks are BD SD CH OH CP LT HT RS ...; standard
// drum notes map first, anything else falls back to chromatic (C1..D#2 = tracks 0..15).
const GM_DRUM_MAP = new Map([
  [35, 0], // bass drum -> BD
  [36, 0], // acoustic bass drum -> BD
  [38, 1], // acoustic snare -> SD
  [40, 1], // electric snare -> SD
  [42, 2], // closed hi-hat -> CH
  [44, 2], // pedal hi-hat -> CH
  [46, 3], // open hi-hat -> OH
  [39, 4], // hand clap -> CP
  [41, 5], // low floor tom -> LT
  [43, 5], // high floor tom -> LT
  [45, 6], // low tom -> HT
  [47, 6], // low-mid tom -> HT
  [48, 6], // hi-mid tom -> HT
  [50, 6], // high tom -> HT
  [37, 7], // side stick -> RS
  [49, 8], // crash cymbal -> FM1
  [51, 8], // ride cymbal -> FM1
  [52, 9], // Chinese cymbal -> FM2
  [53, 9], // ride bell -> FM2
  [56, 10], // cowbell -> CB
  [70, 11], // maracas -> CY
  [62, 12], // mute hi conga -> NO
  [63, 12], // open hi conga -> NO
]);

/** Map a MIDI note number to a 0-15 track. GM drum notes first, then chromatic from C1 (36). */
export function trackFromNote(note) {
  if (Number.isInteger(note) && GM_DRUM_MAP.has(note)) return GM_DRUM_MAP.get(note);
  if (!Number.isFinite(note)) return null;
  const chromatic = Math.round(note) - 36;
  if (chromatic < 0 || chromatic > 15) return null;
  return chromatic;
}

/** Velocity 1..127 -> 0..1 level scale; velocities outside that range are not playable hits. */
export function velocityScale(velocity) {
  if (!Number.isFinite(velocity) || velocity < 1) return null;
  return Math.min(127, velocity) / 127;
}

/** Count of data bytes following a status byte, by status kind (0xF0 = system). */
const DATA_BYTES = new Map([
  [0x80, 2],
  [0x90, 2],
  [0xa0, 2],
  [0xb0, 2],
  [0xe0, 2],
  [0xc0, 1],
  [0xd0, 1],
]);

/**
 * Parse one Web MIDI message (`data` from onmidimessage) into events. Handles running status.
 * Returns [] for messages that carry nothing we act on (CC, aftertouch, pitch bend) and for
 * truncated fragments.
 * Event shapes: {type:'noteon'|'noteoff', note, velocity, channel}
 *               {type:'clock'|'start'|'continue'|'stop'}
 *               {type:'program', value, channel}
 */
export function parseMidiMessage(data) {
  if (!data || !data.length) return [];
  const events = [];
  let status = null;
  let i = 0;
  while (i < data.length) {
    const byte = data[i];
    if (byte & 0x80) {
      status = byte;
      i++;
    } else if (status === null) {
      i++; // stray data byte with no running status — skip
      continue;
    }
    if (status === 0xf0 || status === 0xf7) {
      // Sysex: skip data until the next status byte or end.
      while (i < data.length && !(data[i] & 0x80)) i++;
      status = null;
      continue;
    }
    const kind = status & 0xf0;
    const channel = status & 0x0f;
    if (kind === 0xf0) {
      if (status === 0xf8) events.push({ type: 'clock' });
      else if (status === 0xfa) events.push({ type: 'start' });
      else if (status === 0xfb) events.push({ type: 'continue' });
      else if (status === 0xfc) events.push({ type: 'stop' });
      status = null; // system messages reset running status
      continue;
    }
    const need = DATA_BYTES.get(kind) ?? 0;
    if (need === 0 || i + need > data.length) {
      status = null; // unknown status or truncated message — drop
      continue;
    }
    const bytes = data.slice(i, i + need);
    i += need;
    if (kind === 0x90) {
      const [note, velocity] = bytes;
      events.push(
        velocity > 0
          ? { type: 'noteon', note, velocity, channel }
          : { type: 'noteoff', note, velocity: 0, channel },
      );
    } else if (kind === 0x80) {
      events.push({ type: 'noteoff', note: bytes[0], velocity: 0, channel });
    } else if (kind === 0xc0) {
      events.push({ type: 'program', value: bytes[0], channel });
    }
    // 0xa0/0xb0/0xd0/0xe0 (aftertouch/CC/channel pressure/bend): parsed, deliberately unmapped.
  }
  return events;
}

/**
 * Parse a BLE MIDI packet (DataView of a GATT notification) into events. Layout per the
 * BLE-MIDI spec: header byte (bit7 set, timestampHigh in its low 6 bits), then repeated
 * [timestampLow (bit7 set), status (bit7 set), data...] with running status allowed.
 * Timestamps are read and discarded — this app triggers on arrival; scheduling by BLE
 * timestamps would be dishonest without a full timing model.
 * Same event shapes as parseMidiMessage.
 */
export function parseBlePacket(dv) {
  if (!dv || dv.byteLength < 3) return [];
  const events = [];
  const byte = (k) => (k < dv.byteLength ? dv.getUint8(k) : undefined);
  let i = 1; // header consumed
  let status = null;
  while (i < dv.byteLength) {
    const ts = byte(i);
    if (ts === undefined || !(ts & 0x80)) {
      i++; // resync: everything here should start with a timestamp byte
      continue;
    }
    i++;
    const s = byte(i);
    if (s !== undefined && s & 0x80) {
      status = s;
      i++;
    } else if (status === null) {
      continue; // timestamp, no status available (neither fresh nor running)
    }
    const kind = status & 0xf0;
    const channel = status & 0x0f;
    if (status === 0xf0 || status === 0xf7) {
      while (i < dv.byteLength && !(byte(i) & 0x80)) i++;
      status = null;
      continue;
    }
    if (kind === 0xf0) {
      if (status === 0xf8) events.push({ type: 'clock' });
      else if (status === 0xfa) events.push({ type: 'start' });
      else if (status === 0xfb) events.push({ type: 'continue' });
      else if (status === 0xfc) events.push({ type: 'stop' });
      status = null;
      continue;
    }
    const need = DATA_BYTES.get(kind) ?? 0;
    if (need === 0 || i + need > dv.byteLength) {
      status = null;
      continue;
    }
    const bytes = [];
    for (let k = 0; k < need; k++) bytes.push(byte(i + k));
    i += need;
    if (kind === 0x90) {
      const [note, velocity] = bytes;
      events.push(
        velocity > 0
          ? { type: 'noteon', note, velocity, channel }
          : { type: 'noteoff', note, velocity: 0, channel },
      );
    } else if (kind === 0x80) {
      events.push({ type: 'noteoff', note: bytes[0], velocity: 0, channel });
    } else if (kind === 0xc0) {
      events.push({ type: 'program', value: bytes[0], channel });
    }
  }
  return events;
}

/**
 * Tracks MIDI-clock intervals (24 ppqn) and estimates BPM from the median of a rolling
 * window, so one jittery interval cannot yank the tempo. `now` is injectable for tests.
 */
export class TempoEstimator {
  constructor(windowSize = 12, now = () => performance.now()) {
    this.windowSize = windowSize;
    this.now = now;
    this.intervals = [];
    this.last = null;
  }
  /** Feed one clock event; returns a bpm estimate (1 decimal) when stable, else null. */
  tick() {
    const t = this.now();
    let estimate = null;
    if (this.last !== null) {
      const dt = t - this.last;
      if (dt > 0) {
        this.intervals.push(dt);
        if (this.intervals.length > this.windowSize) this.intervals.shift();
        if (this.intervals.length === this.windowSize) {
          const sorted = [...this.intervals].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          if (median > 0) estimate = Math.round((60000 / median / 24) * 10) / 10;
        }
      }
    }
    this.last = t;
    return estimate;
  }
}

/**
 * Web MIDI engine: navigator.requestMIDIAccess, listens to every input, dispatches parsed
 * events, and sends sequencer notes to the first output. No browser access happens at import
 * time — everything runs from connect().
 */
export class MidiEngine {
  /**
   * @param {(type: string, detail?: any) => void} emit  app-side event sink
   * @param {(label: string, connected: boolean, extra?: string) => void} onStatus
   */
  constructor(emit, onStatus) {
    this.emit = emit;
    this.onStatus = onStatus;
    this.access = null;
    this.outputs = [];
  }
  get connected() {
    return !!this.access;
  }
  get inputCount() {
    return this.access ? this.access.inputs.size : 0;
  }
  async connect() {
    if (!('requestMIDIAccess' in navigator)) throw new Error('Web MIDI is not supported here');
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.outputs = [...this.access.outputs.values()];
    const rebind = () => {
      this.outputs = [...this.access.outputs.values()];
      this.onStatus('midi', this.connected, `${this.access.inputs.size} input(s)`);
    };
    this.access.onstatechange = rebind;
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = (msg) => {
        for (const event of parseMidiMessage(msg.data)) this.emit(event.type, event);
      };
    }
    return this.access.inputs.size;
  }
  disconnect() {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) input.onmidimessage = null;
    this.access.onstatechange = null;
    this.access = null;
    this.outputs = [];
  }
  /** Sequencer note out on the first output. velocity 0..1 -> 1..127. Returns false if no out. */
  sendNote(channel, note, velocity = 1) {
    const out = this.outputs[0];
    if (!out) return false;
    const v = Math.max(1, Math.min(127, Math.round(velocity * 127)));
    out.send([0x90 | (channel & 0x0f), note, v]);
    out.send([0x80 | (channel & 0x0f), note, 0], performance.now() + 100);
    return true;
  }
}

/**
 * Web Bluetooth MIDI client. Chrome/Edge only, secure context, must be called from a user
 * gesture (both are browser requirements, not ours). GATT connect -> characteristic notify ->
 * parsed events through the same emit sink as the Web MIDI engine.
 */
export class BleMidi {
  /**
   * @param {(type: string, detail?: any) => void} emit
   * @param {(label: string, connected: boolean, extra?: string) => void} onStatus
   */
  constructor(emit, onStatus) {
    this.emit = emit;
    this.onStatus = onStatus;
    this.device = null;
    this.characteristic = null;
  }
  get connected() {
    return !!this.device?.gatt?.connected;
  }
  get name() {
    return this.device?.name || 'BLE MIDI device';
  }
  async connect() {
    if (!('bluetooth' in navigator)) throw new Error('Web Bluetooth is not supported here');
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [BLE_MIDI_SERVICE] }],
    });
    this.device.addEventListener('gattserverdisconnected', () => {
      this.characteristic = null;
      this.onStatus('ble', false);
    });
    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(BLE_MIDI_SERVICE);
    this.characteristic = await service.getCharacteristic(BLE_MIDI_CHARACTERISTIC);
    await this.characteristic.startNotifications();
    this.characteristic.addEventListener('characteristicvaluechanged', (e) => {
      for (const event of parseBlePacket(e.target.value)) this.emit(event.type, event);
    });
    return this.name;
  }
  disconnect() {
    if (this.connected) this.device.gatt.disconnect();
    this.characteristic = null;
  }
}
