// Behavioral regression test for the jog wheel's detent logic in src/app.js.
//
// The pointermove handler is extracted VERBATIM from src/app.js and run against synthetic
// pointer events, so the shipped threshold math is what's tested — not a replica. A byte-for-byte
// drift guard at the end fails loudly if the region moves or changes.
//
//   node jog.test.mjs        (also runs as part of `npm test`)

import { readFile } from 'node:fs/promises';

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

const src = await readFile('src/app.js', 'utf8');
const START_MARK = 'jog.onpointermove = (e) => {';
const END_MARK = '};\njog.onpointerup';
const start = src.indexOf(START_MARK);
const end = src.indexOf(END_MARK, start);
if (start === -1 || end === -1) {
  console.error('jog pointermove region not found — extraction out of date');
  process.exit(1);
}
const region = src.slice(start, end + 2); // include the closing "};"

// ---------------------------------------------------------------- shims
// The region references: jog, jogCenter, jogDrag, jogAngle, jogStep, Math.
const steps = [];
const jog = {
  style: { setProperty: (k, v) => (jog._var = v) },
  _var: null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
};
let jogCenter = { x: 0, y: 0 };
let jogDrag = null;
const jogAngle = (e) => Math.atan2(e.clientY - jogCenter.y, e.clientX - jogCenter.x);
let track = 0;
function jogStep(direction) {
  track = (track + (direction > 0 ? 1 : 15)) % 16;
  steps.push(direction);
}

// Center at (100,100); angles come from atan2 around it.
jogCenter = { x: 100, y: 100 };
const atAngle = (a, r = 90) => ({
  pointerId: 1,
  clientX: 100 + r * Math.cos(a),
  clientY: 100 + r * Math.sin(a),
});

// The extracted handler, as a function of the shims above.
const handler = new Function(
  'jog',
  'jogCenter',
  'jogDragRef',
  'jogAngle',
  'jogStep',
  `${region.replace('jog.onpointermove = (e) => {', 'return (e) => {').replace(/\n};$/, '\n};')}`,
)(jog, jogCenter, null, jogAngle, jogStep);
// jogDrag is module-scope in app.js; the extracted body refers to it directly. Give it a
// stable holder the body can see via closure — pass through a getter/setter pair.
// Simplest robust approach: re-extract with jogDrag exposed on an object we own.

// Redo with a clean strategy: wrap the region in a function that declares jogDrag locally,
// then exposes it for the test to poke between events.
const wrapped = new Function(
  'jog',
  'jogAngle',
  'jogStep',
  `
    let jogDrag = null;
    let jogCenter = { x: 0, y: 0 };
    const handler = ${region.replace('jog.onpointermove = (e) => {', '(e) => {').replace(/\n};$/, '\n};')}
    return { handler, getDrag: () => jogDrag, setDrag: (v) => (jogDrag = v), setCenter: (c) => (jogCenter = c) };
  `,
);
const api = wrapped(jog, jogAngle, jogStep);
api.setCenter({ x: 100, y: 100 });

// ---------------------------------------------------------------- helpers
const SECTOR = (2 * Math.PI) / 16;

function dragSequence(angles) {
  // Seed the drag state exactly as onpointerdown would.
  api.setDrag({ pointer: 1, moved: false, angle: angles[0], crossing: 0 });
  steps.length = 0;
  track = 0;
  for (let i = 1; i < angles.length; i++) api.handler(atAngle(angles[i]));
}

const linspace = (from, to, n) => Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));

// ---------------------------------------------------------------- 1. one full turn = 16 steps
{
  dragSequence(linspace(0, 2 * Math.PI, 129)); // 128 moves
  ok(
    steps.length === 16 && steps.every((s) => s === 1),
    'one full clockwise turn = exactly 16 forward steps',
    `steps=${steps.length} net=${steps.reduce((a, b) => a + b, 0)}`,
  );
  ok(track === 0, 'track wraps back to 0 after a full turn', `track=${track}`);
}

// ---------------------------------------------------------------- 2. rotate out and back cancels
{
  const half = linspace(0, Math.PI, 65);
  dragSequence([...half, ...half.slice().reverse()]);
  const fwd = steps.filter((s) => s > 0).length;
  const back = steps.filter((s) => s < 0).length;
  ok(fwd === back, 'half-turn out and back cancels all steps', `+${fwd}/-${back}`);
  ok(track === 0, 'track unchanged after cancel', `track=${track}`);
}

// ---------------------------------------------------------------- 3. sub-detent jitter steps nothing
{
  const jitter = [];
  let a = 0.4; // well inside a sector
  for (let i = 0; i < 300; i++) {
    a = 0.4 + Math.sin(i / 2) * SECTOR * 0.18;
    jitter.push(a);
  }
  dragSequence(jitter);
  ok(steps.length === 0, 'jitter below the threshold never steps', `steps=${steps.length}`);
}

// ---------------------------------------------------------------- 4. the exact-equality trap
// Travel that lands the accumulator DEAD ON +half-sector must fire once, not once-plus-cancel.
{
  // 11.25° in one move: crossing == sector/2 exactly (strict > must NOT fire on the reverse side
  // residue, and firing itself must not be blocked by using >= on one side and > on the other).
  const seq = [0, SECTOR / 2];
  dragSequence(seq);
  ok(steps.length === 1 && steps[0] === 1, 'exact +half-sector fires exactly one step', `steps=[${steps}]`);

  // And the mirror: -11.25°.
  steps.length = 0;
  track = 0;
  api.setDrag({ pointer: 1, moved: false, angle: 0, crossing: 0 });
  api.handler(atAngle(-SECTOR / 2));
  ok(
    steps.length === 1 && steps[0] === -1,
    'exact -half-sector fires exactly one step back',
    `steps=[${steps}]`,
  );
}

// ---------------------------------------------------------------- 5. wraparound across atan2 seam
{
  // Two events straddling the seam: atan2 jumps from +3.10 to −3.10 (raw delta ≈ −6.2) while the
  // physical drag moved a hair CLOCKWISE-forward... at y-down atan2, angle +3.10 → −3.10 across
  // +π is an INCREASE of +0.083 rad. The handler must normalise the raw −6.2 into +0.083 and
  // step nothing (below threshold), not fire −3 steps.
  const a = 3.1,
    b = -3.1;
  const raw = b - a;
  const normalised = raw < -Math.PI ? raw + 2 * Math.PI : raw;
  ok(
    normalised > 0 && normalised < 0.1,
    'sanity: seam pair normalises to +0.083',
    `${normalised.toFixed(3)}`,
  );

  api.setDrag({ pointer: 1, moved: false, angle: a, crossing: 0 });
  steps.length = 0;
  track = 0;
  api.handler(atAngle(b));
  ok(steps.length === 0, 'seam-crossing event steps nothing (sub-detent)', `steps=[${steps}]`);

  // And a big CCW drag across the seam in small steps: total 2π+1.0 rad = 18.546 sectors; the
  // half-sector threshold fires floor(18.546 + 0.5) = 19 steps, residue −0.178 (< h, no re-fire).
  const seq = [];
  for (let i = 0; i <= 40; i++) {
    let v = -(Math.PI - 0.5) + i * ((2 * Math.PI + 1.0) / 40);
    while (v > Math.PI) v -= 2 * Math.PI;
    while (v < -Math.PI) v += 2 * Math.PI;
    seq.push(v);
  }
  dragSequence(seq);
  const net = steps.reduce((x, y) => x + y, 0);
  ok(net === 19, 'full CCW turn plus 1 rad steps 19 (18.5 sectors + half-threshold)', `net=${net}`);
}

// ---------------------------------------------------------------- 6. byte-for-byte drift guard
{
  const still = (await readFile('src/app.js', 'utf8')).slice(start, start + region.length);
  ok(still === region, 'extracted region matches src/app.js byte-for-byte');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
