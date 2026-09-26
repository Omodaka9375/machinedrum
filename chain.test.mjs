// Behavioural regression tests for the pattern chain in src/app.js.
//
// Shift+clicking a pattern button appends it to a loop the scheduler plays one bar at a time.
// The two DOM-bound regions involved — renderPatterns() and the #patterns click handler — are
// extracted VERBATIM from src/app.js and run against element/audio shims, so the shipped logic
// is what's tested, not a replica. Byte-for-byte drift guards at the end fail loudly if the
// regions move or change.
//
//   node chain.test.mjs        (also runs as part of `pnpm test`)

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

// --- extract the two regions verbatim ----------------------------------------------------------
const R1_START = 'function renderPatterns() {';
const R1_END = '}\nfunction render() {';
const R2_START = "$('#patterns').onclick = (e) => {";
const R2_END = "};\n$('#chainClear').onclick";
const r1Start = src.indexOf(R1_START);
const r1End = src.indexOf(R1_END, r1Start);
const r2Start = src.indexOf(R2_START);
const r2End = src.indexOf(R2_END, r2Start);
if (r1Start === -1 || r1End === -1 || r2Start === -1 || r2End === -1) {
  console.error('pattern chain regions not found in src/app.js — extraction out of date');
  process.exit(1);
}
const renderPatternsRegion = src.slice(r1Start, r1End + 1); // include the closing "}"
const onclickRegion = src.slice(r2Start, r2End + 3); // include "};\n"

// --- element / audio shims ----------------------------------------------------------------------
function makeEl() {
  const set = new Set();
  const mult = { hidden: true, textContent: '' };
  return {
    set,
    attrs: {},
    mult,
    classList: {
      toggle(name, on = true) {
        if (on) set.add(name);
        else set.delete(name);
      },
      remove(name) {
        set.delete(name);
      },
      contains(name) {
        return set.has(name);
      },
    },
    setAttribute(k, v) {
      this.attrs[k] = String(v);
    },
    querySelector() {
      return mult;
    },
  };
}

const pats = Array.from({ length: 4 }, makeEl);
let chips = [];
const currents = [makeEl(), makeEl()];
const chainEl = makeEl();
const documentShim = {
  querySelectorAll(sel) {
    if (sel === '[data-pattern]') return pats;
    if (sel === '.chainslot') return chips;
    if (sel === '.current') return currents;
    return [];
  },
};
const $ = (s) => (s === '#chain' ? chainEl : null);
/** @param {boolean} playing @param {number|null} [pending] */
const audioShim = (playing, pending = null) => ({ playing, pending });

// renderPatterns() runs with the module-scope names it reads declared in the wrapper's scope.
function runRenderPatterns(audio, chain, chainPos, chainPlaying, pattern = 0) {
  new Function(
    'document',
    '$',
    'audio',
    'chain',
    'chainPos',
    'chainPlaying',
    'pattern',
    `${renderPatternsRegion}
     renderPatterns();`,
  )(documentShim, $, audio, chain, chainPos, chainPlaying, pattern);
}

// The #patterns click handler: $('#patterns').onclick is captured through the $ shim's holder.
function buildHandler(audio, chain, pattern, chainPos, chainPlaying) {
  const holder = {};
  const statuses = [];
  const ctx = new Function(
    'document',
    '$',
    'audio',
    'held',
    'render',
    'renderChain',
    'renderPatterns',
    'status',
    'pattern',
    'chain',
    'chainPos',
    'chainPlaying',
    `let gesture = null;
     ${onclickRegion}
     return {
       get pattern() { return pattern; },
       get chain() { return chain; },
       get chainPos() { return chainPos; },
       get chainPlaying() { return chainPlaying; },
     };`,
  )(
    documentShim,
    (s) => (s === '#patterns' ? holder : $(s)),
    audio,
    null,
    () => {},
    () => {},
    () => {},
    (t) => statuses.push(t),
    pattern,
    chain,
    chainPos,
    chainPlaying,
  );
  return { holder, ctx, statuses };
}

const clickPattern = (handler, i, shiftKey) =>
  handler({
    target: { closest: (s) => (s === '[data-pattern]' ? { dataset: { pattern: String(i) } } : null) },
    shiftKey,
  });

// --- 1. membership, multiplicity, strip visibility ----------------------------------------------
runRenderPatterns(audioShim(true), [0, 1, 0], 0, 0);
ok(pats[0].set.has('active'), 'the edited pattern stays marked active');
runRenderPatterns(audioShim(true), [0, 1, 0], 0, 0, 2);
ok(pats[2].set.has('active') && !pats[0].set.has('active'), 'active follows the edited pattern, not the chain');
runRenderPatterns(audioShim(true), [0, 1, 0], 0, 0, 0);
ok(pats[0].set.has('chained'), 'A in chain x2 gets the chained class');
ok(pats[1].set.has('chained'), 'B in chain gets the chained class');
ok(!pats[2].set.has('chained') && !pats[3].set.has('chained'), 'C and D not chained');
ok(pats[0].mult.hidden === false && pats[0].mult.textContent === 'x2', 'A badge shows x2', `x=${pats[0].mult.textContent}`);
ok(pats[1].mult.hidden === true, 'B badge hidden at x1');
ok(chainEl.hidden === false, 'chain strip visible when the chain is non-empty');

// --- 2. the playing chip is ringed --------------------------------------------------------------
chips = [makeEl(), makeEl(), makeEl()];
runRenderPatterns(audioShim(true), [0, 1, 0], 0, 1);
ok(
  chips[1].set.has('playing') && !chips[0].set.has('playing') && !chips[2].set.has('playing'),
  'only the playing chip is ringed',
);
runRenderPatterns(audioShim(false), [0, 1, 0], 0, -1);
ok(chips.every((c) => !c.set.has('playing')), 'no ring while stopped');

// --- 3. empty chain resets everything -----------------------------------------------------------
pats.forEach((b) => b.set.add('chained'));
runRenderPatterns(audioShim(true), [], 0, -1);
ok(chainEl.hidden === true, 'chain strip hidden when empty');
ok(pats.every((b) => !b.set.has('chained')), 'chained class cleared for all buttons');
ok(pats.every((b) => b.mult.hidden === true), 'xN badges hidden when empty');

// --- 4. next-bar cue: the chain queues the next pattern like a manual switch --------------------
runRenderPatterns(audioShim(true, null), [2], 0, -1);
ok(pats[2].set.has('pending'), 'with a chain playing, the next pattern shows the dashed pending cue');
ok(
  !pats[0].set.has('pending') && !pats[1].set.has('pending') && !pats[3].set.has('pending'),
  'only the upcoming pattern is pending',
);

runRenderPatterns(audioShim(true, 1), [2], 0, -1);
ok(
  !pats[2].set.has('pending') && pats[1].set.has('pending'),
  'a manually queued switch wins over the chain for the next bar',
);

runRenderPatterns(audioShim(false, null), [2], 0, -1);
ok(!pats[2].set.has('pending'), 'no pending cue while stopped');

// --- 5. shift-click appends; the same pattern may repeat ----------------------------------------
let click = buildHandler(audioShim(true), [0], 0, 0, 0);
clickPattern(click.holder.onclick, 3, true);
ok(click.ctx.chain.length === 2 && click.ctx.chain[1] === 3, 'shift-click D appends D to the chain');
ok(click.ctx.chainPos === 1, 'the next chain slot is the one just added');
ok(click.ctx.pattern === 0, 'shift-click does not change the edited pattern');
ok(click.statuses.some((t) => t.includes('A D')), 'status reads the loop order: A D', click.statuses.at(-1));

click = buildHandler(audioShim(true), [0], 0, 0, 0);
clickPattern(click.holder.onclick, 0, true);
ok(click.ctx.chain.length === 2 && click.ctx.chain[1] === 0, 'shift-clicking the same pattern chains it twice');
ok(click.statuses.some((t) => t.includes('A A')), 'status reads the loop order: A A', click.statuses.at(-1));

// --- 6. shift-click while playing queues the chain without a manual switch ----------------------
{
  const audio = audioShim(true);
  click = buildHandler(audio, [0], 0, 0, 0);
  clickPattern(click.holder.onclick, 2, true);
  ok(audio.pending === null, 'shift-click never queues a manual pattern switch');
  ok(click.statuses.some((t) => t.includes('A C')), 'status reads the loop order: A C', click.statuses.at(-1));
}

// --- 7. plain click still switches patterns -----------------------------------------------------
currents.forEach((c) => c.set.add('current'));
{
  const audio = audioShim(true);
  click = buildHandler(audio, [0], 0, 0, 0);
  clickPattern(click.holder.onclick, 1, false);
  ok(click.ctx.pattern === 1, 'plain click selects the pattern for editing');
  ok(audio.pending === 1, 'plain click queues the switch at the next bar');
  ok(click.ctx.chain.length === 1, 'plain click leaves the chain alone');
  ok(currents.every((c) => !c.set.has('current')), 'plain click clears the playhead markers');
}

// --- 8. regions stay character-identical to what shipped ----------------------------------------
const now = await readFile('src/app.js', 'utf8');
ok(
  now.slice(r1Start, r1Start + renderPatternsRegion.length) === renderPatternsRegion &&
    now.indexOf(renderPatternsRegion) === r1Start,
  'renderPatterns region matches src/app.js byte-for-byte',
);
ok(
  now.slice(r2Start, r2Start + onclickRegion.length) === onclickRegion &&
    now.indexOf(onclickRegion) === r2Start,
  'onclick region matches src/app.js byte-for-byte',
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);