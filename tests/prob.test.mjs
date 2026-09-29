// Behavioral tests for per-step play probability.
//
// The roll lives in audio.js's schedule() (untypechecked DOM glue, extraction-averse), so the
// TESTABLE contracts live in the two pure modules: model.js's validShapes acceptance and
// fx.js's stepFx sounding map. The roll expression itself is pinned by a source-text
// assertion (same style as the shape suite's call-site check).
//
//   node tests/prob.test.mjs        (also runs as part of `pnpm test`)

import { readFile } from 'node:fs/promises';
import { demo, validShapes } from '../src/model.js';
import { stepFx } from '../src/fx.js';

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

// ---- 1. the roll's expression is pinned as it ships -------------------------------------------
{
  const src = await readFile('src/audio.js', 'utf8');
  ok(
    src.includes('s.prob === undefined || s.prob >= 100 || Math.random() * 100 < s.prob'),
    'schedule() rolls Math.random() against s.prob; absent/100 always sounds',
  );
  ok(
    src.includes('!t.mute && (!anySolo || t.solo) && s.on &&'),
    'mute, solo and on are still hard gates around the probability roll',
  );
  ok(
    src.includes('stepFx(p, this.pattern, this.step, sounding)'),
    'the sounding map is passed to stepFx, so skipped steps carry no FX',
  );
  // Live hits follow the sequencer's gates too: a solo elsewhere silences a live tap.
  ok(
    src.includes('!t.mute && (!p.tracks.some((x) => x.solo) || t.solo)'),
    'liveHit respects mute and solo',
  );
  // Manual paths must NOT roll: audition/liveHit/trigger fire voices unconditionally — the
  // only roll in the codebase is the schedule() expression above.
  const app = await readFile('src/app.js', 'utf8');
  ok(!app.includes('Math.random'), 'app.js never rolls dice (manual hits always sound)');
}

// ---- 2. statistical sanity of the roll expression (1000 draws each) ----------------------------
{
  const roll = (prob) => (prob === undefined || prob >= 100 ? true : Math.random() * 100 < prob);
  for (const [prob, expect] of [
    [undefined, 1.0],
    [100, 1.0],
    [0, 0.0],
  ]) {
    let hits = 0;
    for (let i = 0; i < 1000; i++) if (roll(prob)) hits++;
    ok(hits === (expect === 1 ? 1000 : expect === 0 ? 0 : hits), `prob=${prob} behaves as ${expect === 1 ? 'always' : expect === 0 ? 'never' : 'sometimes'}`, `hits=${hits}/1000`);
  }
  let hits = 0;
  for (let i = 0; i < 10000; i++) if (roll(70)) hits++;
  ok(hits > 6500 && hits < 7500, 'prob=70 lands near 70% over 10k rolls', `hits=${hits}`);
}

// ---- 3. stepFx: sounding=false strips the step's FX locks ---------------------------------------
{
  // demo()'s inferred step type has no fxLocks/prob (migrations add them at boot), so this
  // fixture builds the exact shape stepFx dereferences, like the fx suite does.
  /** @type {{ fx: Record<string, number>, tracks: { mute: boolean, send: { delay: number, reverb: number } }[], patterns: { on: boolean, locks: Record<string, number>, fxLocks?: Record<string, number> }[][][] }} */
  const p = {
    fx: { time: 300, feedback: 35, delay: 30, room: 1.5, reverb: 25 },
    tracks: Array.from({ length: 16 }, () => ({ mute: false, send: { delay: 40, reverb: 10 } })),
    patterns: Array.from({ length: 1 }, () =>
      Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => ({ on: false, locks: {} }))),
    ),
  };
  p.tracks[4].send = { delay: 40, reverb: 10 };
  p.patterns[0][4][7] = { on: true, locks: {}, fxLocks: { sendDelay: 80, time: 500 } };
  const withRoll = stepFx(p, 0, 7, p.tracks.map(() => true));
  ok(withRoll.fx.time === 500 && withRoll.tracks[4].send.delay === 80, 'sounding=true applies the FX locks');
  const noRoll = stepFx(p, 0, 7, p.tracks.map(() => false));
  ok(noRoll.fx.time === 300 && noRoll.tracks[4].send.delay === 40, 'sounding=false keeps base values (skipped step, no FX)');
  const idle = stepFx(p, 0, 7, undefined);
  ok(idle.fx.time === 500, 'sounding omitted (legacy call) behaves as before', `time=${idle.fx.time}`);
}

// ---- 4. validShapes accepts/rejects prob (covered in detail by the shape suite; smoke here) ----
{
  const p = demo();
  /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (p.patterns[0][0][0])).prob = 55;
  ok(validShapes(p) === true, 'a valid probability passes the save guard');
  /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (p.patterns[0][0][0])).prob = -1;
  ok(validShapes(p) === false, 'negative probability fails');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);