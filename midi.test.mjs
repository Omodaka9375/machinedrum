// Unit tests for the pure MIDI helpers in src/midi.js (parser, BLE codec, note map, tempo).
// These functions are navigator-free by design — that's what makes them testable here.
//
//   node midi.test.mjs        (also runs as part of `pnpm test`)

import {
  parseMidiMessage,
  parseBlePacket,
  trackFromNote,
  velocityScale,
  TempoEstimator,
  BLE_MIDI_SERVICE,
} from './src/midi.js';

let passed = 0;
let failed = 0;
const ok = (cond, label, extra = '') => {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}${extra ? '   ' + extra : ''}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${extra ? '   ' + extra : ''}`);
  }
};

const dv = (bytes) => new DataView(new Uint8Array(bytes).buffer);

// ---- parseMidiMessage ------------------------------------------------------------------

// Note on, channel 0, middle C, velocity 100
ok(
  JSON.stringify(parseMidiMessage([0x90, 60, 100])) ===
    JSON.stringify([{ type: 'noteon', note: 60, velocity: 100, channel: 0 }]),
  'note on parses',
);
// Note on velocity 0 == note off
ok(
  JSON.stringify(parseMidiMessage([0x90, 60, 0])) ===
    JSON.stringify([{ type: 'noteoff', note: 60, velocity: 0, channel: 0 }]),
  'note-on velocity 0 reads as note-off',
);
// Explicit note off
ok(
  JSON.stringify(parseMidiMessage([0x83, 42, 64])) ===
    JSON.stringify([{ type: 'noteoff', note: 42, velocity: 0, channel: 3 }]),
  'note off parses with channel',
);
// Running status: two note-ons sharing one status byte
{
  const events = parseMidiMessage([0x91, 36, 120, 38, 90]);
  ok(
    events.length === 2 && events[0].note === 36 && events[1].note === 38,
    'running status continues data',
    JSON.stringify(events.map((e) => e.note)),
  );
  ok(events[1].channel === 1, 'running status keeps the channel');
}
// Realtime bytes mixed in: clock, start, continue, stop
for (const [byte, type] of [
  [0xf8, 'clock'],
  [0xfa, 'start'],
  [0xfb, 'continue'],
  [0xfc, 'stop'],
]) {
  const events = parseMidiMessage([byte]);
  ok(events.length === 1 && events[0].type === type, `realtime ${type} parses`);
}
// Program change
ok(
  JSON.stringify(parseMidiMessage([0xc0, 3])) === JSON.stringify([{ type: 'program', value: 3, channel: 0 }]),
  'program change parses',
);
// CC is consumed silently
ok(parseMidiMessage([0xb0, 7, 100]).length === 0, 'control change is parsed but unmapped');
// Pitch bend consumed
ok(parseMidiMessage([0xe0, 0, 64]).length === 0, 'pitch bend is parsed but unmapped');
// Truncated note-on (status + 1 byte) drops cleanly
ok(parseMidiMessage([0x90, 60]).length === 0, 'truncated message drops');
// Sysex skims to end without emitting
ok(parseMidiMessage([0xf0, 0x7e, 0x09, 0xf7]).length === 0, 'sysex is skipped');
// Empty / null
ok(parseMidiMessage([]).length === 0 && parseMidiMessage(null).length === 0, 'empty input -> no events');

// ---- parseBlePacket ---------------------------------------------------------------------

// Header + [timestampLow, status, note, velocity]
ok(
  JSON.stringify(parseBlePacket(dv([0x80, 0x81, 0x90, 60, 100]))) ===
    JSON.stringify([{ type: 'noteon', note: 60, velocity: 100, channel: 0 }]),
  'BLE packet: single note-on parses',
);
// Two events in one packet, second with running status (ts + data only)
{
  const events = parseBlePacket(dv([0x80, 0x81, 0x90, 36, 120, 0x82, 38, 64]));
  ok(
    events.length === 2 && events[0].note === 36 && events[1].note === 38,
    'BLE: two events, running status',
    JSON.stringify(events.map((e) => e.note)),
  );
}
// Note-off in BLE form
ok(
  JSON.stringify(parseBlePacket(dv([0x80, 0x81, 0x83, 42, 0]))) ===
    JSON.stringify([{ type: 'noteoff', note: 42, velocity: 0, channel: 3 }]),
  'BLE: note-off parses',
);
// Realtime through BLE
{
  const events = parseBlePacket(dv([0x80, 0x81, 0xf8]));
  ok(events.length === 1 && events[0].type === 'clock', 'BLE: clock byte parses');
}
// Truncated (header only / <3 bytes)
ok(parseBlePacket(dv([0x80])).length === 0 && parseBlePacket(null).length === 0, 'BLE: short packets drop');
// Timestamp high bits in header are ignored, low-bit timestamps validated
ok(parseBlePacket(dv([0xbf, 0x81, 0x90, 60, 100])).length === 1, 'BLE: header timestamp bits ignored');

// ---- trackFromNote ----------------------------------------------------------------------

ok(trackFromNote(36) === 0, 'GM kick (36) -> track 0 (BD)');
ok(trackFromNote(38) === 1, 'GM snare (38) -> track 1 (SD)');
ok(trackFromNote(42) === 2, 'GM closed hat (42) -> track 2 (CH)');
ok(trackFromNote(46) === 3, 'GM open hat (46) -> track 3 (OH)');
ok(trackFromNote(39) === 4, 'GM clap (39) -> track 4 (CP)');
ok(trackFromNote(37) === 7, 'GM side stick (37) -> track 7 (RS)');
ok(trackFromNote(60) === null, 'non-GM note above the chromatic range is null (60-36=24 > 15)');

// chromatic fallback inside range: 37..51 covers GM; pick 52..59 -> >15 -> null. Instead
// verify a low non-GM note: nothing in GM map below 35, and 36-36=0 is GM anyway, so use 32 -> null.
ok(trackFromNote(54) === null, 'chromatic beyond 15 tracks is null');
ok(trackFromNote(30) === null, 'below C1 is null');
ok(trackFromNote(52) === 9, 'GM Chinese cymbal (52) -> track 9 (FM2)');
ok(trackFromNote(55) === null, 'note 55 (out of chromatic + not GM) is null');
ok(trackFromNote('x') === null, 'non-number is null');

// ---- velocityScale ----------------------------------------------------------------------

ok(velocityScale(127) === 1, 'velocity 127 -> 1.0');
// velocityScale returns number|null, so the scaling case needs the null branch settled first.
const v64 = /** @type {number} */ (velocityScale(64));
ok(Math.abs(v64 - 64 / 127) < 1e-12, 'velocity 64 scales');
ok(velocityScale(0) === null, 'velocity 0 is not a playable hit');
ok(velocityScale(-5) === null, 'negative velocity is null');
ok(velocityScale(200) === 1, 'oversized velocity clamps to 1');

// ---- TempoEstimator --------------------------------------------------------------------

{
  // 120 BPM = 24 clocks per beat at 500ms/beat -> 20.833ms per clock.
  const period = 60000 / 120 / 24;
  let t = 0;
  const est = new TempoEstimator(6, () => (t += period));
  let estimate = null;
  for (let i = 0; i < 8; i++) estimate = est.tick();
  ok(estimate === 120, 'clock stream estimates 120.0 BPM', String(estimate));
}
{
  // Jitter: one bad interval must not skew the median-based estimate.
  const period = 60000 / 120 / 24;
  let t = 0;
  const times = [];
  for (let i = 0; i < 10; i++) times.push((t += period));
  times[5] += 50; // one spike
  let k = 0;
  const est = new TempoEstimator(6, () => times[k++]);
  let estimate = null;
  for (let i = 0; i < 10; i++) estimate = est.tick();
  ok(estimate === 120, 'median window absorbs a single jitter spike', String(estimate));
}
{
  // Not enough samples -> null
  const est = new TempoEstimator(6, () => 100);
  ok(est.tick() === null && est.tick() === null, 'estimate withheld until the window fills');
}

// ---- UUID sanity ------------------------------------------------------------------------

ok(BLE_MIDI_SERVICE === '03b80e5a-ede8-4b33-a751-6ce34ec4c700', 'BLE MIDI service UUID is the spec one');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
