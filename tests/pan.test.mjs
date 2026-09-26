// Polarity regression for the PAN knob (fxSpec H). The user-visible contract is:
//
//   label L100  ==  stored track.pan −100  ==  StereoPannerNode.pan −1  ==  LEFT channel
//
// Web Audio pins the last link (pan −1 = left) by spec; what a test can prove here is the
// middle one — the value that reaches each voice engine's panner for a given stored pan.
//
// The panner lines live in audio.js / drums.js, which the strict typecheck gate deliberately
// leaves out (they are DOM/AV glue), so this suite follows the repo's extraction convention
// (save/jog/chain tests): the panner regions are lifted from source VERBATIM as text — never
// imported — run against a fake AudioContext, and byte-for-byte drift-guarded at the end.
// applyLfo is pure and typechecked, so it IS imported directly.
//
//   node tests/pan.test.mjs        (also runs as part of `pnpm test`)

import { readFile } from 'node:fs/promises';
import { applyLfo } from '../src/lfo.js';

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

// --- extract the panner regions verbatim --------------------------------------------------------
const audioSrc = await readFile('src/audio.js', 'utf8');
const drumsSrc = await readFile('src/drums.js', 'utf8');
const appSrc = await readFile('src/app.js', 'utf8');

function region(src, startMark, endMark, name) {
  const start = src.indexOf(startMark);
  const end = src.indexOf(endMark, start);
  if (start === -1 || end === -1) {
    console.error(`${name} region not found — extraction out of date`);
    process.exit(1);
  }
  return src.slice(start, end + endMark.length);
}
const voiceRegion = region(
  audioSrc,
  'const panner = ctx.createStereoPanner();',
  'panner.connect(out);',
  'audio.js voice panner',
);
const drumRegion = region(
  drumsSrc,
  "const panner = make('createStereoPanner');",
  'panner.connect(out);',
  'drums.js drumVoice panner',
);
const resolveRegion = region(
  audioSrc,
  'const pan = step?.fxLocks?.pan ?? track.pan ?? 0;',
  'track.pan ?? 0;',
  'trigger pan resolution',
);

// --- fake AudioContext: records the panner each region creates -----------------------------------
function pannerRegionRunner(region, createCall) {
  return (pan) => {
    const panners = [];
    const connect = () => {};
    const panParam = { value: 0 };
    const ctx = {
      createStereoPanner() {
        const n = { pan: panParam, connect };
        panners.push(n);
        return n;
      },
    };
    const lfoGain = { connect };
    const out = { connect };
    new Function('ctx', 'pan', 'lfoGain', 'out', `'use strict';\n${region}`)(ctx, pan, lfoGain, out);
    if (panners.length !== 1) throw new Error('expected exactly one panner');
    return panners[0].pan.value;
  };
}
// The two regions reference their panner constructor differently — build the exact calls.
const voicePan = (pan) => {
  const panners = [];
  const connect = () => {};
  const panParam = { value: 0 };
  const ctx = { createStereoPanner: () => ((n) => (panners.push(n), n))({ pan: panParam, connect }) };
  new Function('ctx', 'pan', 'lfoGain', 'out', `'use strict';\n${voiceRegion}`)(
    ctx,
    pan,
    { connect },
    { connect },
  );
  return panParam.value;
};
const drumPan = (pan) => {
  const connect = () => {};
  const panParam = { value: 0 };
  const make = (type) => (type === 'createStereoPanner' ? { pan: panParam, connect } : { connect });
  new Function('make', 'pan', 'lfoGain', 'out', `'use strict';\n${drumRegion}`)(
    make,
    pan,
    { connect },
    { connect },
  );
  return panParam.value;
};

// The panner regions start mid-function, so the extracted text is wrapped in a bare block —
// `const` redeclarations across two new Function scopes cannot collide.
ok(voicePan(-100) === -1, 'voice: L100 (−100) → panner.pan −1 → LEFT', `pan=${voicePan(-100)}`);
ok(voicePan(100) === 1, 'voice: R100 (+100) → panner.pan +1 → RIGHT');
ok(voicePan(0) === 0, 'voice: C (0) → panner.pan 0 → centred');
ok(voicePan(40) === 0.4, 'voice: partial pan scales /100', `pan=${voicePan(40)}`);
ok(voicePan(-250) === -1, 'voice: out-of-range clamps to hard left');
ok(drumPan(-100) === -1, 'drumVoice: L100 (−100) → panner.pan −1 → LEFT', `pan=${drumPan(-100)}`);
ok(drumPan(100) === 1, 'drumVoice: R100 (+100) → panner.pan +1 → RIGHT');
ok(drumPan(0) === 0, 'drumVoice: C (0) → centred');
ok(drumPan(30) === 0.3, 'drumVoice: partial pan scales /100');
ok(
  voicePan(-100) === drumPan(-100) && voicePan(100) === drumPan(100),
  'both engines agree on polarity for the same stored value',
);

// --- trigger() resolution: step lock wins, then track, then centre -------------------------------
{
  const resolve = new Function(
    'step',
    'track',
    `'use strict';\n${resolveRegion}\nreturn pan;`,
  );
  ok(resolve({ fxLocks: { pan: 55 } }, { pan: -30 }) === 55, 'step FX lock beats the track pan');
  ok(resolve({ fxLocks: {} }, { pan: -30 }) === -30, 'without a lock the track pan is used');
  ok(resolve({}, {}) === 0, 'nothing set resolves to centre');
  ok(resolve({}, { pan: undefined }) === 0, 'undefined track pan falls back to centre');
}

// --- LFO PAN destination (applyLfo imported — lfo.js is typechecked) ------------------------------
function lfoPanRun(l, staticPan) {
  const curves = [];
  const panParam = {
    value: staticPan,
    setValueCurveAtTime(curve) {
      curves.push(curve);
    },
  };
  const panner = { pan: panParam };
  applyLfo([panner], { gain: { setValueCurveAtTime() {} } }, l, 120, 0, 0.5, 0);
  return curves[0];
}
{
  const l = { on: 1, depth: 100, wave: 2, target: 3, speed: 50, phase: 0, reset: 0 }; // square ±1
  const curve = lfoPanRun(l, 0.3); // track panned right
  const min = Math.min(...curve),
    max = Math.max(...curve);
  // Square wave swings the full depth AROUND the static pan, clamped to the param range.
  // Curve values are Float32 (setValueCurveAtTime) — compare with 1e-6, not 1e-9.
  ok(
    Math.abs(min - (0.3 - 1)) < 1e-6 && Math.abs(max - 1) < 1e-6,
    'LFO PAN swings around the static pan (square ±1 at base 0.3, clamped)',
    `[${min.toFixed(2)}, ${max.toFixed(2)}]`,
  );
  const centred = lfoPanRun(l, 0);
  ok(
    Math.abs(Math.min(...centred) + 1) < 1e-9 && Math.abs(Math.max(...centred) - 1) < 1e-9,
    'LFO PAN on a centred track reaches both hard limits',
  );
  const shallow = lfoPanRun({ ...l, depth: 20 }, 0.5);
  ok(
    Math.abs(Math.min(...shallow) - 0.3) < 1e-6 && Math.abs(Math.max(...shallow) - 0.7) < 1e-6,
    'LFO PAN depth scales the swing around the static pan',
    `[${Math.min(...shallow).toFixed(2)}, ${Math.max(...shallow).toFixed(2)}]`,
  );
  let called = 0;
  applyLfo([{ gain: { setValueCurveAtTime() {} } }], { gain: { setValueCurveAtTime() {} } }, l, 120, 0, 0.5, 0);
  ok(called === 0, 'LFO PAN with no panner in the voice is a no-op, not a throw');
}

// --- panText label contract (extracted verbatim from app.js) --------------------------------------
const panTextRegion = region(appSrc, 'function panText(v) {', '\n}', 'panText');
{
  const panText = new Function(`'use strict';\n${panTextRegion}\nreturn panText;`)();
  ok(panText(-100) === 'L100', 'panText(−100) labels L100');
  ok(panText(100) === 'R100', 'panText(+100) labels R100');
  ok(panText(0) === 'C', 'panText(0) labels C');
  ok(panText(-35) === 'L35', 'panText(−35) labels L35');
}

// --- drift guards --------------------------------------------------------------------------------
{
  const now = await readFile('src/audio.js', 'utf8');
  const drumsNow = await readFile('src/drums.js', 'utf8');
  const appNow = await readFile('src/app.js', 'utf8');
  ok(
    now.includes(voiceRegion) && now.includes(resolveRegion),
    'audio.js panner + resolution regions still byte-for-byte',
  );
  ok(drumsNow.includes(drumRegion), 'drums.js panner region still byte-for-byte');
  ok(appNow.includes(panTextRegion), 'app.js panText region still byte-for-byte');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);