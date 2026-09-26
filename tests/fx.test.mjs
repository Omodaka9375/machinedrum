// Behavioral regression test for the reverb IR debounce in src/fx.js.
//
// Imports the REAL Effects class and drives it against a stub AudioContext that records every
// buffer swap — no browser needed. The stubs implement exactly the AudioContext surface
// Effects touches (createDelay/createGain/createConvolver + sampleRate/state), with
// setTargetAtTime/setValueAtTime as no-op recorders.
//
//   node tests/fx.test.mjs        (also runs as part of `npm test`)

import { Effects, stepFx, defaultFx, migrateFx } from '../src/fx.js';
import { kit, factoryPans } from '../src/model.js';

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SR = 48000;

/** Minimal AudioParam: no-ops that record nothing (gains are not under test). */
function stubParam() {
  return {
    value: 0,
    setTargetAtTime() {},
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
  };
}

/** Convolver stand-in: records every buffer assignment (what clicks if it happens often). */
function stubConvolver() {
  const node = { buffer: null, connect() {} };
  return new Proxy(node, {
    set(target, prop, value) {
      if (prop === 'buffer') target.swaps = (target.swaps ?? 0) + 1;
      target[prop] = value;
      return true;
    },
  });
}

/** The AudioContext surface Effects uses, plus a swap counter fed through to the convolver. */
function stubCtx() {
  const convolver = stubConvolver();
  const ctx = {
    sampleRate: SR,
    state: 'running',
    createGain: () => ({ gain: stubParam(), connect() {} }),
    createDelay: () => ({ delayTime: stubParam(), connect() {} }),
    createConvolver: () => convolver,
    _convolver: convolver,
    createBuffer: (channels, length) => ({
      length,
      getChannelData: () => new Float32Array(length),
    }),
  };
  return ctx;
}

// @typedef for the step shape used across these stubs. Declared so the literal that follows has
// a base to be checked against — fxLocks is a real field stepFx reads, and test 6 writes one.
/**
 * @typedef {{ on: boolean, locks: Record<string, number>, fxLocks?: Record<string, number> }} StubStep
 */
const project = () => {
  /** @type {{ fx: ReturnType<typeof defaultFx>, tracks: { mute: boolean, send: { delay: number, reverb: number } }[], patterns: StubStep[][][] }} */
  const p = {
    fx: { ...defaultFx(), room: 1.5 },
    tracks: Array.from({ length: 16 }, () => ({ mute: false, send: { delay: 0, reverb: 0 } })),
    patterns: [
      Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => ({ on: false, locks: {} }))),
    ],
  };
  migrateFx(p);
  return p;
};

// ---- 1. first update builds the IR synchronously ---------------------------------------
{
  const ctx = stubCtx();
  const fx = new Effects(ctx, { connect() {} });
  fx.update(project());
  ok(
    ctx._convolver.swaps === 1,
    'first update() swaps the buffer exactly once',
    `swaps=${ctx._convolver.swaps}`,
  );
  ok(fx.room === 1.5, 'room recorded after synchronous first build', `room=${fx.room}`);
}

// ---- 2. a knob drag debounces to a single rebuild ---------------------------------------
{
  const ctx = stubCtx();
  const fx = new Effects(ctx, { connect() {} });
  const p = project();
  fx.update(p); // initial build
  const before = ctx._convolver.swaps;
  for (const room of [1.6, 1.7, 1.8, 1.9, 2.0, 2.1, 2.2, 2.3]) {
    p.fx.room = room;
    fx.update(p); // pointermove per event, like the DECAY knob
  }
  ok(ctx._convolver.swaps === before, 'no swap during the drag', `swaps=${ctx._convolver.swaps}`);
  await sleep(200); // > IR_DEBOUNCE_MS
  ok(
    ctx._convolver.swaps === before + 1,
    'exactly one swap after the drag settles',
    `swaps=${ctx._convolver.swaps}`,
  );
  ok(fx.room === 2.3, 'buffer built for the FINAL room value', `room=${fx.room}`);
}

// ---- 3. returning to the current value cancels the rebuild ------------------------------
{
  const ctx = stubCtx();
  const fx = new Effects(ctx, { connect() {} });
  const p = project();
  fx.update(p);
  const before = ctx._convolver.swaps;
  p.fx.room = 2.0;
  fx.update(p);
  p.fx.room = 1.5; // back where the buffer already is
  fx.update(p);
  await sleep(200);
  ok(
    ctx._convolver.swaps === before,
    'rebuild cancelled when the value returns',
    `swaps=${ctx._convolver.swaps}`,
  );
  ok(fx.pendingRoom === undefined, 'pending target cleared on cancel');
}

// ---- 4. a fresh drag reschedules the pending rebuild ------------------------------------
{
  const ctx = stubCtx();
  const fx = new Effects(ctx, { connect() {} });
  const p = project();
  fx.update(p);
  const before = ctx._convolver.swaps;
  p.fx.room = 2.0;
  fx.update(p);
  await sleep(60); // under the debounce window
  p.fx.room = 3.0;
  fx.update(p);
  await sleep(200);
  ok(fx.room === 3.0, 'latest drag wins the rebuild', `room=${fx.room}`);
  ok(ctx._convolver.swaps === before + 1, 'still one swap total', `swaps=${ctx._convolver.swaps}`);
}

// ---- 5. a closed context never rebuilds -------------------------------------------------
{
  const ctx = stubCtx();
  const fx = new Effects(ctx, { connect() {} });
  const p = project();
  fx.update(p);
  ctx.state = 'closed'; // stop() closes the AudioContext
  const before = ctx._convolver.swaps;
  p.fx.room = 3.5;
  fx.update(p);
  await sleep(200);
  ok(ctx._convolver.swaps === before, 'no rebuild after the context closed', `swaps=${ctx._convolver.swaps}`);
}

// ---- 6. stepFx contract untouched (FX page per-step locks) ------------------------------
{
  const p = project();
  p.fx.time = 300;
  p.tracks[4].send = { delay: 40, reverb: 10 };
  p.patterns[0][4][7] = { on: true, locks: {}, fxLocks: { sendDelay: 80, time: 500 } };
  const { fx, tracks } = stepFx(p, 0, 7);
  ok(fx.time === 500, 'stepFx applies fxLocks to master fx', `time=${fx.time}`);
  ok(tracks[4].send.delay === 80, 'stepFx applies per-step sendDelay lock', `send=${tracks[4].send.delay}`);
  const idle = stepFx(p, 0, 8);
  ok(idle.fx.time === 300 && idle.tracks[4].send.delay === 40, 'other steps keep base values');
}

// ---- 7. migrateFx pan adoption (factory stereo field) -------------------------------------
// The kit ships spread (factoryPans); an untouched all-center legacy kit adopts it, a
// kit the user ever panned freezes as-is. All-or-nothing by design.
{
  /** @typedef {{ engine: string, mute: boolean, choke: number, p: object, send: object, pan?: number }} PanTrack */
  /** @type {{ tracks: PanTrack[], savedKit?: PanTrack[] }} */
  let p = { tracks: kit().map((t) => structuredClone(t)) };
  migrateFx(p);
  ok(p.tracks[2].pan === factoryPans[2] && p.tracks[13].pan === 0, 'fresh kit keeps factory pans', `CH=${p.tracks[2].pan}`);
  // absent pan -> factory value
  p = { tracks: kit().map(({ engine, mute, choke, p: prm, send }) => ({ engine, mute, choke, p: prm, send })) };
  migrateFx(p);
  ok(p.tracks[10].pan === factoryPans[10], 'absent pan adopts the factory field', `CB=${p.tracks[10].pan}`);
  // untouched all-zero legacy kit adopts the whole field
  p = { tracks: kit().map((t) => ({ ...structuredClone(t), pan: 0 })) };
  migrateFx(p);
  ok(p.tracks.every((t, i) => t.pan === factoryPans[i]), 'all-center legacy kit adopts the factory spread');
  // user-touched kit frozen exactly as it was
  p = { tracks: kit().map((t, i) => ({ ...structuredClone(t), pan: i === 5 ? -70 : 0 })) };
  migrateFx(p);
  ok(p.tracks[5].pan === -70 && p.tracks[2].pan === 0, 'user-touched pan kit frozen as-is');
  // savedKit mirror adopts too
  p = { tracks: kit().map((t) => structuredClone(t)), savedKit: kit().map((t) => ({ ...structuredClone(t), pan: 0 })) };
  migrateFx(p);
  const saved = p.savedKit ?? [];
  ok(saved.every((t, i) => t.pan === factoryPans[i]), 'savedKit adopts the factory spread');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

