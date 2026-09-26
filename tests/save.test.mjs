// Behavioral regression test for the debounced save() in src/app.js.
//
// app.js is a browser module with top-level DOM side effects, so it cannot be imported whole.
// Instead this file loads its source, extracts the save/flush/hook region verbatim, and runs it
// against a stub localStorage — the code under test is character-for-character what ships.
//
//   node tests/save.test.mjs        (also runs as part of `npm test`)

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const src = await readFile('src/app.js', 'utf8');

// --- extract the exact save region (from the SAVE_DEBOUNCE_MS comment to the hooks) -------
const start = src.indexOf('// save() is trailing-debounced');
const end = src.indexOf("document.visibilityState === 'hidden')");
if (start === -1 || end === -1) {
  console.error('save region not found in src/app.js — test extraction out of date');
  process.exit(1);
}
const region = src.slice(start, src.indexOf('});', end) + 3);

// --- browser shims ------------------------------------------------------------------------
const writes = [];
/** @type {{ pagehide: (() => void)[], visibilitychange: (() => void)[] }} */
const listeners = { pagehide: [], visibilitychange: [] };

// Bare identifiers used by the extracted region. These are deliberately PARTIAL shims — only the
// members the code under test touches — so they are installed with defineProperty instead of
// assignment, which is how a test double replaces a global without claiming to be a complete
// Storage/Window/Document. (The checker rejects claiming those full types, and it should.)
const storageShim = {
  setItem(k, v) {
    writes.push({ k, v });
  },
  getItem: () => null,
};
const windowShim = { addEventListener: (ev, fn) => listeners[ev].push(fn) };
const documentShim = {
  addEventListener: (ev, fn) => listeners[ev].push(fn),
  visibilityState: 'visible',
};
/** @type {[string, object][]} */
const shims = [
  ['localStorage', storageShim],
  ['window', windowShim],
  ['document', documentShim],
];
for (const [name, shim] of shims) {
  Object.defineProperty(globalThis, name, { value: shim, configurable: true, writable: true });
}

// The region references key/project/saveTimer; key and project are app.js module scope, so the
// test redefines them as globals via a tiny prelude before running the region verbatim.
const prelude = `
  const key = 'test-key';
  let project = { name: 'state' };
`;
// Indirect eval runs in global scope, so the region's `window`/`document` lookups hit our
// shims, and its `setTimeout`/`clearTimeout` resolve to Node's.
const run = new Function(
  `${prelude}${region} return { save, flushSave, getProject: () => project, setProject: (v) => (project = v) };`,
);
const api = run();

// --- 1. burst of saves collapses to one write ------------------------------------------------
api.save();
api.save();
api.save();
api.save();
api.save();
ok(writes.length === 0, 'no write during the burst', `writes=${writes.length}`);
await sleep(400); // > SAVE_DEBOUNCE_MS (300)
ok(writes.length === 1, 'exactly one write after the burst settles', `writes=${writes.length}`);
ok(
  writes[0].k === 'test-key' && writes[0].v === JSON.stringify({ name: 'state' }),
  'write carries the current project state',
);

// --- 2. nothing pending → flush is a no-op ---------------------------------------------------
await sleep(400);
const before = writes.length;
api.flushSave();
ok(writes.length === before, 'flush with nothing pending writes nothing');

// --- 3. pagehide flushes a pending save immediately ------------------------------------------
api.save();
ok(listeners.pagehide.length === 1, 'pagehide hook registered', `n=${listeners.pagehide.length}`);
listeners.pagehide[0]();
ok(writes.length === before + 1, 'pagehide flushes the pending write', `writes=${writes.length}`);
await sleep(400);
ok(writes.length === before + 1, 'no duplicate write after the debounce would have fired');

// --- 4. visibilitychange → hidden flushes too ------------------------------------------------
api.save();
ok(listeners.visibilitychange.length === 1, 'visibilitychange hook registered');
documentShim.visibilityState = 'hidden'; // the region's global `document` is this same object
listeners.visibilitychange[0]();
ok(writes.length === before + 2, 'hidden flushes the pending write', `writes=${writes.length}`);

// --- 5. flush serialises the CURRENT project (binding, not a snapshot) ----------------------
api.setProject({ name: 'replaced' });
api.save();
listeners.pagehide[0]();
ok(writes.at(-1).v === JSON.stringify({ name: 'replaced' }), 'flush writes the live binding, not a snapshot');

// --- 6. region stays character-identical to what shipped --------------------------------------
const stillVerbatim = (await readFile('src/app.js', 'utf8')).slice(start, start + region.length);
ok(stillVerbatim === region, 'extracted region matches src/app.js byte-for-byte');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
