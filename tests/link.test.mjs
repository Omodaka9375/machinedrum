// LINK: transport + tempo sync over BroadcastChannel — protocol and module behavior.
//
// The module is navigator-free (the BroadcastChannel constructor is resolved inside
// connect()), so these tests run in bare Node with injected fakes. Two instances wired to
// one fake bus model two tabs; a single instance with no peers models a lone machine.
//
//   node tests/link.test.mjs      (also part of `pnpm test` / `pnpm run check`)

import { createLink } from '../src/link.js';

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

/** A fake BroadcastChannel: delivers to every OTHER channel on the same bus. */
const makeBus = () => {
  /** @typedef {{ postMessage: (m: object) => void, close: () => void, onmessage: ((e: { data: any }) => void) | null, _receive: (e: { data: any }) => void }} FakeChannel */
  /** @type {Set<FakeChannel>} */
  const members = new Set();
  return () => {
    /** @type {FakeChannel} */
    const ch = {
      postMessage: (m) => {
        for (const other of members) if (other !== ch) other._receive({ data: m });
      },
      close: () => members.delete(ch),
      onmessage: null,
      _receive: (e) => ch.onmessage?.(e),
    };
    members.add(ch);
    return ch;
  };
};

// ---- 1. connect / disconnect state ------------------------------------------------------
{
  const bus = makeBus();
  const seen = [];
  const observer = createLink({ onEvent: (m) => seen.push(m), Channel: bus });
  observer.connect();
  const statuses = [];
  const link = createLink({ onStatus: (c, e) => statuses.push([c, e]), Channel: bus });
  ok(link.connected === false, 'starts disconnected');
  ok(link.connect() === true, 'connect succeeds with a channel factory');
  ok(link.connected === true, 'connected after connect');
  ok(seen.some((m) => m.type === 'hello'), 'connect posts a hello to the room (observer saw it)');
  link.disconnect();
  ok(link.connected === false, 'disconnect clears the channel');
  ok(statuses[0][0] === true && statuses.at(-1)[0] === false, 'status callbacks fired for both');
}

// ---- 2. unsupported browser --------------------------------------------------------------
{
  const statuses = [];
  const link = createLink({ onStatus: (c, e) => statuses.push([c, e]), Channel: null });
  ok(link.connect() === false, 'connect fails when the factory is null');
  ok(link.connected === false, 'still disconnected');
  ok(statuses[0][0] === false && statuses[0][1] === 'not supported in this browser', 'reports the reason');
  link.post({ type: 'play' }); // must not throw
  ok(true, 'post() after a failed connect is a silent no-op');
}

// ---- 3. two tabs: hello is answered only by a playing tab ---------------------------------
{
  const bus = makeBus();
  /** @type {{ a: { type: string, playing?: boolean, bpm?: number }[], b: { type: string, playing?: boolean, bpm?: number }[] }} */
  const received = { a: [], b: [] };
  const mk = (tag) => createLink({
    onEvent: (m) => received[tag].push(m),
    Channel: bus,
  });
  const a = mk('a'), b = mk('b');
  a.connect();
  b.connect();
  // b's hello reached a; a is idle, so a answered nothing -> b got no state.
  ok(received.b.every((m) => m.type !== 'state'), 'an idle tab does not answer a hello with state');
  // a's hello reached b the same way.
  ok(received.a.every((m) => m.type !== 'state'), 'no state in the other direction either');
}

// ---- 4. a playing tab answers hello with state --------------------------------------------
{
  const bus = makeBus();
  const aSeen = [], joinerSeen = [];
  const a = createLink({ onEvent: (m) => aSeen.push(m), Channel: bus });
  const joiner = createLink({ onEvent: (m) => joinerSeen.push(m), Channel: bus });
  a.connect(); // a's hello; joiner not connected yet -> dropped (a is idle anyway, answers nothing)
  joiner.connect(); // joiner's hello -> a receives it
  ok(aSeen.some((m) => m.type === 'hello'), 'joiner hello reached a');
  // a IS playing, so a answers with state; the joiner adopts it:
  a.post({ type: 'state', bpm: 128, playing: true });
  ok(joinerSeen.some((m) => m.type === 'state' && m.playing && m.bpm === 128), 'a posted state reached the joiner');
}

// ---- 5. full two-tab protocol walk --------------------------------------------------------
{
  const bus = makeBus();
  /** @type {{ bpm: number|null, playing: boolean, tempos: number[] }} */
  const tabA = { bpm: null, playing: false, tempos: [] };
  /** @type {{ bpm: number|null, playing: boolean, tempos: number[] }} */
  const tabB = { bpm: null, playing: false, tempos: [] };
  const apply = (state) => ({
    onEvent: (m) => {
      if (m.type === 'tempo') { state.bpm = m.bpm; state.tempos.push(m.bpm); }
      if (m.type === 'play') { state.playing = true; if (m.bpm) state.bpm = m.bpm; }
      if (m.type === 'stop') state.playing = false;
    },
    Channel: bus,
  });
  const a = createLink(apply(tabA));
  const b = createLink(apply(tabB));
  a.connect();
  b.connect();
  // A starts playing at 124:
  a.post({ type: 'play', bpm: 124 });
  ok(tabB.playing === true && tabB.bpm === 124, 'play event: B follows with the tempo');
  ok(tabA.playing === false, 'A does not hear its own post (broadcast excludes sender)');
  // A changes tempo:
  a.post({ type: 'tempo', bpm: 138 });
  ok(tabB.bpm === 138 && tabB.tempos.at(-1) === 138, 'tempo event: B adopts 138');
  // A stops:
  a.post({ type: 'stop' });
  ok(tabB.playing === false, 'stop event: B stops');
}

// ---- 6. malformed messages never crash the dispatch ---------------------------------------
{
  const bus = makeBus();
  const seen = [];
  const a = createLink({ onEvent: (m) => seen.push(m), Channel: bus });
  const b = createLink({ onEvent: (m) => seen.push(m), Channel: bus });
  a.connect();
  b.connect();
  // Feed garbage straight through the underlying channel:
  b.post(/** @type {any} */ ({}));
  b.post(/** @type {any} */ ({ type: 42 }));
  ok(true, 'non-string / empty message types are dropped by the wire (no throw)');
  ok(seen.every((m) => typeof m.type === 'string'), 'only well-formed messages dispatched');
}

// ---- 7. reconnect is clean ---------------------------------------------------------------
{
  const bus = makeBus();
  const link = createLink({ Channel: bus });
  link.connect();
  link.disconnect();
  ok(link.connect() === true, 'connect after disconnect opens a fresh channel');
  ok(link.connected === true, 'reconnected');
  link.disconnect();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);