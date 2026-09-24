// Behavioral regression test for the wheel guards around the step drag (src/app.js).
//
// Two listeners, extracted VERBATIM from src/app.js and run against synthetic wheel events:
//   1. document-level: preventDefault() whenever a step drag (held) is in progress
//   2. #steps grid: over a held step, wheel-up/down writes a pitch parameter lock
// Byte-for-byte drift guards fail loudly if either region moves or changes.
//
//   node wheel.test.mjs        (also runs as part of `pnpm test`)

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

function extract(startMark, endMark) {
  const start = src.indexOf(startMark);
  if (start === -1) throw new Error(`start mark not found: ${startMark}`);
  const end = src.indexOf(endMark, start);
  if (end === -1) throw new Error(`end mark not found: ${endMark}`);
  return src.slice(start, end);
}

const docRegion = extract("document.addEventListener(\n  'wheel',", '// The panel hint promises');
const stepsRegion = extract("$('#steps').addEventListener(\n  'wheel',", 'function releaseHold');

// Build a harness whose closure scope declares every module-scope name the regions reference,
// with setters the test drives between events. `held` must be the same binding the handlers
// read, so it is re-declared per section bake (handlers are cheap; state is external).
const makeHarness = new Function(
  'docRegion',
  'stepsRegion',
  `
    return function create(editPageValue, heldValue) {
      let editPage = editPageValue;
      let held = heldValue;
      const changes = [];
      const prevented = [];
      const handlers = {};
      function change(param, value) { changes.push({ param, value }); }
      function lfoValue() { return 50; }
      function fxValue() { return 50; }
      function increment() { return 1; }
      function isLocked() { return true; }
      function current() { return { p: { pitch: 60 } }; }
      function selected() { return { locks: {} }; }
      function resolved() { return { pitch: 60 }; }
      const document = {
        addEventListener: (type, fn, opts) => {
          if (type !== 'wheel') return;
          if (opts?.passive !== false) throw new Error('document wheel listener must be non-passive');
          handlers.doc = fn;
        },
      };
      const $ = (sel) => ({
        addEventListener: (type, fn, opts) => {
          if (type !== 'wheel' || sel !== '#steps') return;
          if (opts?.passive !== false) throw new Error('steps wheel listener must be non-passive');
          handlers.steps = fn;
        },
      });
      ${docRegion}
      ${stepsRegion}
      return {
        handlers,
        changes,
        prevented,
        set held(v) { held = v; },
        get held() { return held; },
        set editPage(v) { editPage = v; },
        get editPage() { return editPage; },
        event: (deltaY) => ({ deltaY, preventDefault: () => prevented.push(deltaY) }),
      };
    };
  `,
);

const create = makeHarness(docRegion, stepsRegion);

// ---- 1. document guard: preventDefault only while held --------------------------------
{
  const h = create('synth', { pointer: 1, step: 3 });
  h.handlers.doc(h.event(120));
  ok(h.prevented.length === 1, 'document wheel prevented while a step is held');
  h.held = null;
  h.handlers.doc(h.event(120));
  ok(h.prevented.length === 1, 'document wheel NOT prevented when nothing is held');
}

// ---- 2. steps-grid listener: wheel over a held step writes a pitch lock -----------------
{
  const h = create('synth', { pointer: 1 });
  h.handlers.steps(h.event(-100));
  ok(
    h.changes.length === 1 &&
      h.changes[0].param === 'pitch' &&
      h.changes[0].value === 61 &&
      h.prevented.length === 1,
    'wheel-up over held step raises pitch one increment and prevents the scroll',
    JSON.stringify(h.changes[0]),
  );
  h.handlers.steps(h.event(100));
  ok(
    h.changes.length === 2 && h.changes[1].value === 59,
    'wheel-down lowers it back',
    JSON.stringify(h.changes[1]),
  );
}

// ---- 3. nothing held → steps listener is a complete no-op -------------------------------
{
  const h = create('synth', null);
  h.handlers.steps(h.event(-100));
  ok(h.changes.length === 0 && h.prevented.length === 0, 'steps wheel does nothing when no step is held');
}

// ---- 4. FX page: wheel routes through the FX value (send A) ----------------------------
{
  const h = create('fx', { pointer: 1 });
  h.handlers.steps(h.event(-100));
  ok(
    h.changes.length === 1 && h.changes[0].param === 'pitch' && h.changes[0].value === 51,
    'FX page wheel adjusts the FX-side value',
    JSON.stringify(h.changes[0]),
  );
}

// ---- 5. drift guards -------------------------------------------------------------------
{
  const now = await readFile('src/app.js', 'utf8');
  ok(
    now.indexOf(docRegion) !== -1 && now.indexOf(stepsRegion) !== -1,
    'both extracted regions still match src/app.js byte-for-byte',
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
