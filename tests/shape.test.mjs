// Behavioural regression test for the localStorage shape guard in src/model.js.
//
// model.js is pure (no DOM), so it imports directly — this drives the REAL validShapes, not a
// replica. What is under test is the failure mode it exists to prevent: a save with the right
// `version` but a truncated or mistyped tree used to be accepted wholesale, and because render()
// dereferences `tracks[i].p` and `step.locks` unconditionally the user got a throw on the first
// frame — a blank panel instead of the instrument. validShapes is what makes a malformed payload
// fall back to the factory demo.
//
// Malformed payloads are built by JSON round-tripping the factory project, because that is exactly
// how a save reaches the app (JSON.parse of a string) — and the result is a loose bag the test is
// free to corrupt.
//
//   node tests/shape.test.mjs        (also runs as part of `npm test`)

import { readFile } from 'node:fs/promises';
import { demo, validShapes } from '../src/model.js';

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

/** A factory project as it would arrive from localStorage — and as free to corrupt as that is. */
const saved = () => JSON.parse(JSON.stringify(demo()));

// A fresh factory project must always be accepted — this is the fallback path itself, and it is
// the positive control: if these ever return false, every real user's save gets discarded.
ok(validShapes(demo()) === true, 'factory demo accepted');
ok(validShapes(saved()) === true, 'demo accepted after the JSON round-trip it takes over storage');

// ---- the skeleton is required --------------------------------------------------------------

{
  const p = saved();
  p.tracks.length = 15; // one voice missing
  ok(validShapes(p) === false, 'tracks shorter than 16 rejected');
}
{
  const p = saved();
  delete p.tracks[6].p.level; // a parameter the knobs and the LCD read
  ok(validShapes(p) === false, 'track params missing an entry rejected');
}
{
  const p = saved();
  p.tracks[3].p.decay = '32'; // string where a number is expected
  ok(validShapes(p) === false, 'non-numeric parameter rejected');
}
{
  const p = saved();
  p.tracks[0].p.pitch = NaN;
  ok(validShapes(p) === false, 'NaN parameter rejected');
}
{
  const p = saved();
  p.tracks[9].engine = 'analog'; // not one of the eight engines model.js exports
  ok(validShapes(p) === false, 'unknown engine rejected');
}
{
  const p = saved();
  delete p.patterns[2][5][11].locks; // render()'s Object.keys(s.locks) is the crash this blocks
  ok(validShapes(p) === false, 'step missing locks rejected');
}
{
  const p = saved();
  p.patterns[0][4][7].on = 'true';
  ok(validShapes(p) === false, 'step on-flag of wrong type rejected');
}
{
  const p = saved();
  p.patterns.length = 3; // the UI assumes four pattern slots
  ok(validShapes(p) === false, 'fewer than four patterns rejected');
}
{
  const p = saved();
  p.bpm = '124';
  ok(validShapes(p) === false, 'string tempo rejected');
}
{
  const p = saved();
  p.master = NaN;
  ok(validShapes(p) === false, 'NaN master level rejected');
}

// ---- non-objects -----------------------------------------------------------------------------

for (const [label, value] of [
  ['null', null],
  ['undefined', undefined],
  ['a number', 1],
  ['an array', []],
  ['a string', 'version 1'],
]) {
  ok(validShapes(value) === false, `${label} rejected`);
}

// ---- optional fields stay optional; unknown fields are tolerated -------------------------------

{
  // migrateLfo() backfills lfo and migrateFx() backfills send/fx, so a save written before either
  // existed must still count as well-formed — rejecting it would throw away real user work.
  const p = saved();
  for (const t of p.tracks) {
    delete t.lfo;
    delete t.send;
    delete t.choke;
  }
  delete p.fx;
  ok(validShapes(p) === true, 'save without lfo / send / choke / fx still accepted (migrants backfill)');
}
{
  const p = saved();
  p.patterns[0][0][0].offset = 0.42; // live-record offset: written only by audio.liveHit
  ok(validShapes(p) === true, 'numeric step offset accepted');
  p.patterns[0][0][0].offset = NaN;
  ok(validShapes(p) === false, 'NaN step offset rejected');
}
{
  const p = saved();
  p.patterns[0][0][0].fxLocks = { time: 500 }; // the field stepFx reads
  ok(validShapes(p) === true, 'well-formed fxLocks accepted');
  p.patterns[0][0][0].fxLocks = 'time';
  ok(validShapes(p) === false, 'fxLocks of the wrong type rejected');
}
{
  const p = saved();
  p.somethingNew = { hello: 'from a later build' };
  ok(validShapes(p) === true, 'unrecognised extra field tolerated (forward compatible)');
}

// ---- the app actually consults the guard -------------------------------------------------------

// app.js cannot be imported (top-level DOM side effects), so assert on the call site the way
// save.test.mjs asserts on its region: the restore path must gate on validShapes.
const appSrc = await readFile('src/app.js', 'utf8');
ok(
  appSrc.includes('saved?.version === 1 && validShapes(saved)'),
  'app.js restore path checks version AND shape before adopting a save',
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
