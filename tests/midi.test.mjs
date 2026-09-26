// Unit tests for the pure MIDI helpers in src/midi.js (parser, BLE codec, note map, tempo).
// These functions are navigator-free by design — that's what makes them testable here.
//
//   node tests/midi.test.mjs        (also runs as part of `pnpm test`)

import {
  parseMidiMessage,
  parseBlePacket,
  trackFromNote,
  velocityScale,
  TempoEstimator,
  BLE_MIDI_SERVICE,
} from '../src/midi.js';

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

// ---- Realtime interleaving (transport must survive mid-message clock pulses) ------------

// USB: clock pulse between the note-on status and its data bytes. The clock dispatches at
// its position, so it lands BEFORE the completed note-on in the event list.
{
  const events = parseMidiMessage([0x90, 0xf8, 60, 100]);
  ok(
    events.length === 2 &&
      events[0].type === 'clock' &&
      events[1].type === 'noteon' &&
      events[1].note === 60 &&
      events[1].velocity === 100,
    'USB: clock inside a note-on does not lose the note',
    JSON.stringify(events),
  );
}
// USB: clock pulse between the note and its velocity
{
  const events = parseMidiMessage([0x90, 60, 0xf8, 100]);
  ok(
    events.length === 2 && events[0].type === 'clock' && events[1].type === 'noteon' &&
      events[1].note === 60 && events[1].velocity === 100,
    'USB: clock between note and velocity keeps both',
    JSON.stringify(events),
  );
}
// USB: transport start/stop parse from any position (same positional dispatch order)
{
  const events = parseMidiMessage([0x90, 0xfa, 60, 0xfc, 100]);
  ok(
    events.length === 3 &&
      events[0].type === 'start' &&
      events[1].type === 'stop' &&
      events[2].type === 'noteon',
    'USB: start/stop interleave inside a note-on without breaking it',
    JSON.stringify(events),
  );
}
// USB: running status survives an interleaved realtime byte (spec: realtime never resets it)
{
  const events = parseMidiMessage([0x91, 36, 120, 0xf8, 38, 90]);
  ok(
    events.length === 3 &&
      events[0].note === 36 &&
      events[1].type === 'clock' &&
      events[2].note === 38 &&
      events[2].velocity === 90 &&
      events[2].channel === 1,
    'USB: running status continues across an interleaved clock',
    JSON.stringify(events),
  );
}
// USB: a non-realtime status byte still interrupts the message (bend adopted, note dropped)
{
  const events = parseMidiMessage([0x90, 60, 0xe0, 0, 64]);
  ok(events.length === 0, 'USB: channel message interrupted by another status drops cleanly', JSON.stringify(events));
}

// ---- BLE realtime interleaving ------------------------------------------------------------

// Realtime where a timestamp was expected, trailing the packet (no timestamp byte of its own)
{
  const events = parseBlePacket(dv([0x80, 0x81, 0x90, 60, 100, 0xf8]));
  ok(
    events.length === 2 &&
      events[0].type === 'noteon' &&
      events[0].note === 60 &&
      events[1].type === 'clock',
    'BLE: realtime after a complete message parses (no timestamp byte)',
    JSON.stringify(events),
  );
}
// Clock interleaved at the next message's start position
{
  const events = parseBlePacket(dv([0x80, 0x81, 0xf8, 0x82, 0x90, 60, 100]));
  ok(
    events.length === 2 && events[0].type === 'clock' && events[1].type === 'noteon' &&
      events[1].note === 60,
    'BLE: clock at the timestamp slot dispatches and resyncs',
    JSON.stringify(events),
  );
}
// Clock inside the note-on data bytes
{
  const events = parseBlePacket(dv([0x80, 0x81, 0x90, 0xf8, 60, 100]));
  ok(
    events.length === 2 && events[0].type === 'clock' && events[1].type === 'noteon' &&
      events[1].note === 60 && events[1].velocity === 100,
    'BLE: clock between note-on status and data keeps both',
    JSON.stringify(events),
  );
}
// Transport with proper timestamped encoding
{
  const start = parseBlePacket(dv([0x80, 0x81, 0xfa]));
  const stop = parseBlePacket(dv([0x80, 0x81, 0xfc]));
  ok(
    start.length === 1 && start[0].type === 'start' && stop.length === 1 && stop[0].type === 'stop',
    'BLE: timestamped start/stop parse',
    JSON.stringify([...start, ...stop]),
  );
}
// Running status across an interleaved clock
{
  const events = parseBlePacket(dv([0x80, 0x81, 0x90, 60, 100, 0xf8, 0x82, 62, 64]));
  ok(
    events.length === 3 &&
      events[0].note === 60 &&
      events[1].type === 'clock' &&
      events[2].note === 62 &&
      events[2].channel === 0,
    'BLE: running status continues across an interleaved clock',
    JSON.stringify(events),
  );
}

// ---- BLE timestamp vs realtime disambiguation ----------------------------------------------

// A byte 0xF8-0xFF in the timestamp slot is AMBIGUOUS: a spec-compliant timestamp can be any
// 0x80-0xFF byte, and a non-compliant sender can emit bare realtime with no timestamp. The
// streams are genuinely undecidable in the general case, so the parser's POLICY is a cost
// tiebreak: prefer the REALTIME reading unless data follows directly (running status),
// because a misread clock costs one median-absorbed pulse while a misread timestamp costs a
// note. These tests pin that policy.
{
  // [ts=0xF9][data][data] under running status: data follows directly -> timestamp reading.
  const state = { status: null };
  parseBlePacket(dv([0x80, 0x81, 0x90, 60, 100]), state);
  const events = parseBlePacket(dv([0x80, 0xf9, 62, 64]), state);
  ok(
    events.length === 1 && events[0].type === 'noteon' && events[0].note === 62 && events[0].velocity === 64,
    'BLE: timestamp 0xF9 with running-status data is a timestamp, note preserved',
    JSON.stringify(events),
  );
}
{
  // [0xF8][status][data] with NO running status: undecidable pair -> realtime reading wins
  // (the note is re-sent by the sender's next event; a lost clock pulse is median-absorbed).
  const events = parseBlePacket(dv([0x80, 0xf8, 0x90, 60, 100]));
  ok(
    events.length === 1 && events[0].type === 'clock',
    'BLE: 0xF8 before a fresh status reads as realtime (cost tiebreak: clock, not note)',
    JSON.stringify(events),
  );
}
{
  // A bare realtime trailing the packet (no following bytes): dispatched as realtime.
  const events = parseBlePacket(dv([0x80, 0x81, 0x90, 60, 100, 0xf8]));
  ok(
    events.length === 2 && events[0].type === 'noteon' && events[1].type === 'clock',
    'BLE: bare trailing realtime still dispatches',
    JSON.stringify(events),
  );
}
{
  // Bare realtime followed by a timestamped event: realtime, then the note via its own ts.
  const events = parseBlePacket(dv([0x80, 0xf8, 0x81, 0x90, 60, 100]));
  ok(
    events.length === 2 && events[0].type === 'clock' && events[1].type === 'noteon' && events[1].note === 60,
    'BLE: realtime followed by a timestamped note dispatches both',
    JSON.stringify(events),
  );
}

// ---- BLE running status across packets -------------------------------------------------------

{
  const state = { status: null };
  const first = parseBlePacket(dv([0x80, 0x81, 0x90, 36, 120]), state);
  const second = parseBlePacket(dv([0x80, 0x82, 38, 90]), state);
  ok(
    first.length === 1 &&
      first[0].note === 36 &&
      second.length === 1 &&
      second[0].note === 38 &&
      second[0].channel === 0,
    'BLE: running status carries across packets via the state object',
    JSON.stringify(second),
  );
}
{
  // Without state, packets parse standalone (legacy contract).
  const second = parseBlePacket(dv([0x80, 0x82, 38, 90]));
  ok(second.length === 0, 'BLE: without state, running status does not leak across packets');
}

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
{
  // reset() forgets the window: the next estimate is withheld until it refills, and the
  // refilled median describes the new clock stream, not the old one.
  const period = 60000 / 120 / 24;
  let t = 0;
  const est = new TempoEstimator(4, () => (t += period));
  for (let i = 0; i < 6; i++) est.tick();
  est.reset();
  ok(est.tick() === null && est.tick() === null, 'reset withholds estimates until the window refills');
  let estimate = null;
  for (let i = 0; i < 4; i++) estimate = est.tick();
  ok(estimate === 120, 'estimate returns once the window has refilled', String(estimate));
}

// ---- UUID sanity ------------------------------------------------------------------------

ok(BLE_MIDI_SERVICE === '03b80e5a-ede8-4b33-a751-6ce34ec4c700', 'BLE MIDI service UUID is the spec one');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

