// Temporary end-to-end test for link-bridge.mjs.
//
// Loads the REAL link.js browser client (no hand-rolled substitute), so the shipped code path is
// what gets tested. Node 22 supplies the global WebSocket.
//
//   node _verify_link.mjs

import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const PORT = 19999;
const ORIGIN = 'http://127.0.0.1:4173';

if (typeof globalThis.WebSocket !== 'function') {
  console.error('needs Node >= 22 for the global WebSocket');
  process.exit(1);
}

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${label}${extra ? '   ' + extra : ''}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${extra ? '   ' + extra : ''}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// link.js hardcodes ws://127.0.0.1:19876 and sends no headers. Repoint at the test port and inject
// a loopback Origin so the shipped client code runs unmodified.
const NativeWebSocket = globalThis.WebSocket;
globalThis.WebSocket = class extends NativeWebSocket {
  constructor(url, options) {
    super(url.replace(':19876', `:${PORT}`), {
      ...options,
      headers: { ...(options?.headers ?? {}), origin: ORIGIN },
    });
  }
};

let bridgeLog = '';
const bridge = spawn(process.execPath, ['link-bridge.mjs', '--port', String(PORT)], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
bridge.stdout.on('data', (d) => (bridgeLog += d));
bridge.stderr.on('data', (d) => (bridgeLog += d));
await sleep(900);

// ---- 1. RFC 6455 §1.3 known-answer test on the bridge's own GUID ----------------------
// Exists because the first draft had a one-character GUID typo that looked entirely plausible
// and only surfaced as a client-side "incorrect Sec-WebSocket-Accept" rejection.
console.log('\nRFC 6455 §1.3 handshake known-answer');
{
  const m = (await readFile('./link-bridge.mjs', 'utf8')).match(/const GUID = '([^']+)'/);
  if (!m) throw new Error('GUID declaration not found in link-bridge.mjs — regex out of date?');
  const accept = createHash('sha1')
    .update('dGhlIHNhbXBsZSBub25jZQ==' + m[1])
    .digest('base64');
  ok(accept === 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=', 'bridge GUID reproduces the RFC example Accept value');
}

// ---- 2. real client against the bridge ------------------------------------------------
const { LinkClock } = await import('./src/link.js');

function makeClient(name) {
  const c = { name, label: '(none)', transport: null, anchorBpm: 0, sawFirstAnchor: false };
  c.inst = new LinkClock(
    (label, bpm, first) => {
      c.label = label;
      if (bpm) c.anchorBpm = bpm;
      if (first) c.sawFirstAnchor = true;
    },
    (playing) => (c.transport = playing),
  );
  return c;
}

console.log('\nreal client (link.js LinkClock) against the bridge');

const a = makeClient('A');
a.inst.connect();
await sleep(700);
ok(a.inst.ready === true, 'A.ready true after first state');
ok(a.label === 'LINK 1', 'label reads "LINK <peers>"', `got "${a.label}"`);
ok(a.anchorBpm === 124 && a.sawFirstAnchor, 'first anchor carries session bpm', `bpm=${a.anchorBpm}`);

const b = makeClient('B');
b.inst.connect();
await sleep(500);
ok(a.label === 'LINK 2' && b.label === 'LINK 2', 'both clients see 2 peers', `A="${a.label}" B="${b.label}"`);

// link.js only sends transport when sync is on, and only reacts to remote transport when sync is
// on — so enable it on both, exactly as the START/STOP switch does in the UI.
a.inst.setSync(true);
b.inst.setSync(true);
await sleep(200);

a.inst.transport(true);
await sleep(400);
ok(b.transport === true, 'A transport(true) -> B onTransport(true)', `B=${b.transport}`);

// Now that the session is running, beat must advance at session tempo.
const t0 = a.inst.beatAt();
await sleep(600);
const advanced = a.inst.beatAt() - t0;
const expected = (0.6 * 124) / 60;
ok(
  Math.abs(advanced - expected) < 0.15,
  'beat advances at session BPM while playing',
  `Δ${advanced.toFixed(4)} vs ${expected.toFixed(4)}`,
);

// Both clients must agree on the shared position (within a frame or two of jitter).
const spread = Math.abs(a.inst.beatAt() - b.inst.beatAt());
ok(spread < 0.05, 'A and B agree on shared beat position', `|Δ|=${spread.toFixed(5)} beats`);

// Tempo must not jump the playhead. Measure over a precisely-timed window straddling the
// change and require the advance to sit within the band implied by the two tempos, so a
// re-anchor bug (a step to beat 0, or a several-beat lurch) fails while local extrapolation
// drift — which link.js does between state updates, like real Link — passes.
const jT0 = performance.now();
const jB0 = a.inst.beatAt();
a.inst.send({ type: 'tempo', bpm: 92.5 });
await sleep(600);
const jElapsed = (performance.now() - jT0) / 1000;
const jDelta = a.inst.beatAt() - jB0;
const lo = Math.min(124, 92.5) / 60;
const hi = Math.max(124, 92.5) / 60;
ok(
  jDelta > jElapsed * lo * 0.6 && jDelta < jElapsed * hi * 1.4,
  'tempo change does not jump the playhead',
  `Δ${jDelta.toFixed(4)} beats in ${jElapsed.toFixed(3)}s (band ${lo.toFixed(3)}-${hi.toFixed(3)} b/s)`,
);

b.inst.send({ type: 'ping', time: performance.now() });
await sleep(300);
ok(Math.abs(b.anchorBpm - 92.5) < 0.01, 'tempo propagates to B', `bpm=${b.anchorBpm}`);

for (const [demand, clamp] of [
  [5000, 500],
  [1, 20],
]) {
  a.inst.send({ type: 'tempo', bpm: demand });
  await sleep(300);
  b.inst.send({ type: 'ping', time: performance.now() });
  await sleep(300);
  ok(b.anchorBpm === clamp, `tempo ${demand} clamps to ${clamp}`, `bpm=${b.anchorBpm}`);
}

a.inst.transport(false);
await sleep(400);
ok(b.transport === false, 'A transport(false) -> B onTransport(false)', `B=${b.transport}`);

// sync off must suppress propagation in both directions
b.inst.setSync(false);
await sleep(200);
const seen = b.transport;
a.inst.transport(true);
await sleep(400);
ok(b.transport === seen, 'B with sync off ignores remote transport', `B stayed ${b.transport}`);
a.inst.transport(false);
await sleep(200);

b.inst.disconnect();
await sleep(700);
ok(a.label === 'LINK 1', 'peer count drops after B disconnects', `A="${a.label}"`);

// ---- 3. handshake rejections ---------------------------------------------------------
console.log('\nhandshake rejections');
ok((await rawUpgrade('')).status === '403', 'no Origin header -> 403');
ok((await rawUpgrade('http://evil.example')).status === '403', 'foreign Origin -> 403');
ok((await rawUpgrade(ORIGIN, '8')).status === '400', 'Sec-WebSocket-Version: 8 -> 400');
ok((await rawUpgrade(ORIGIN)).status === '101', 'loopback Origin + v13 -> 101 Switching Protocols');

// ---- 4. stop/start must preserve position (freeze + re-anchor on the session) ----------
// Observed black-box through the bridge's own log, since the client grid is free-running and
// cannot show a frozen session beat directly.
console.log('\nsession position across stop/start');
const stops = [...bridgeLog.matchAll(/(START|STOP)\s+at beat ([-\d.]+)/g)].map((m) => m[2]);
ok(stops.length >= 2, 'session logged stop and start positions', stops.join(' → '));
ok(
  stops[stops.length - 1] === stops[stops.length - 2] ||
    Math.abs(Number(stops.at(-1)) - Number(stops.at(-2))) < 0.35,
  'restart resumes at the position it stopped at',
  `${stops.at(-2)} → ${stops.at(-1)}`,
);

console.log('\nbridge log');
bridgeLog
  .trim()
  .split('\n')
  .slice(1)
  .forEach((l) => console.log('  ' + l));

console.log(`\n${pass} passed, ${fail} failed`);
bridge.kill();
process.exit(fail ? 1 : 0);

function rawUpgrade(origin, version = '13') {
  return new Promise((resolve) => {
    const s = connect(PORT, '127.0.0.1', () => {
      s.write(
        `GET / HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: ${version}\r\n` +
          (origin ? `Origin: ${origin}\r\n` : '') +
          `\r\n`,
      );
    });
    let buf = '';
    const done = () => {
      s.destroy();
      const m = buf.match(/^HTTP\/1\.1 (\d{3})/);
      resolve({ status: m ? m[1] : '(none)', raw: buf });
    };
    s.on('data', (d) => {
      buf += d.toString();
      if (buf.includes('\r\n\r\n') || buf.length > 400) done();
    });
    s.on('error', done);
    setTimeout(done, 1200);
  });
}
