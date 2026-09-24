// Local Link session bridge for MACHINEDRUM.
//
//   node link-bridge.mjs              → ws://127.0.0.1:19876
//   node link-bridge.mjs --port 19900 --quiet
//
// WHAT THIS IS
//   A session host for this machinedrum build. Several browser tabs/windows connect to it and
//   share one transport, one tempo, and one beat position — turn START/STOP on one instance and
//   the others follow. It implements the JSON protocol link.js already speaks.
//
// WHAT THIS IS NOT
//   Ableton Live interop. Real Ableton Link is a binary protocol (discovery-v1 framing, PTP-style
//   timestamp exchange, 64.32 fixed-point beats) and every correct implementation wraps Ableton's
//   C++ library. This bridge does not speak that, so Live and other Link apps will not see it.
//
// SECURITY
//   Binds 127.0.0.1 only, and checks the Origin header — browsers send it on WebSocket upgrades
//   and do NOT apply CORS to WebSockets, so without this any web page could dial localhost.
//
// No dependencies: the WebSocket server below is a hand-rolled RFC 6455 handshake + frame codec.

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

// RFC 6455 §1.3 magic GUID. Verified: SHA-1 of the spec's own example key + this value yields the
// spec's published accept value, asserted in _verify_link.mjs. Do not "fix" this from memory.
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 64 * 1024;
const TEMPO_MIN = 20;
const TEMPO_MAX = 500;

// --------------------------------------------------------------------------- RFC 6455 framing

// Returns a frame object, null when more bytes are needed, or a string protocol error.
function parseFrame(buf) {
  if (buf.length < 2) return null;

  const b0 = buf[0];
  const b1 = buf[1];
  const fin = (b0 & 0x80) !== 0;
  const rsv = b0 & 0x70;
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f;
  let off = 2;

  if (rsv !== 0) return 'reserved bits set';
  if (!masked) return 'client frame not masked'; // RFC 6455 §5.1: a server MUST close on this.

  if (len === 126) {
    if (buf.length < off + 2) return null;
    len = buf.readUInt16BE(off);
    off += 2;
    if (len < 126) return 'non-minimal length';
  } else if (len === 127) {
    if (buf.length < off + 8) return null;
    if (buf.readUInt32BE(off) !== 0) return 'frame too large';
    len = buf.readUInt32BE(off + 4);
    off += 8;
    if (len < 65536) return 'non-minimal length';
  }

  if (len > MAX_FRAME) return 'frame too large';
  if (buf.length < off + 4) return null;

  const key = buf.subarray(off, off + 4);
  off += 4;
  if (buf.length < off + len) return null;

  const payload = Buffer.from(buf.subarray(off, off + len)); // copy: we unmask in place
  for (let i = 0; i < payload.length; i++) payload[i] ^= key[i & 3];

  if (opcode >= 0x8 && len > 125) return 'control frame too long';
  return { fin, opcode, payload, size: off + len };
}

function encodeFrame(opcode, payload) {
  const len = payload.length;
  const header = len < 126 ? 2 : len < 65536 ? 4 : 10;
  const out = Buffer.allocUnsafe(header + len);
  out[0] = 0x80 | opcode; // FIN + opcode; server frames are never masked
  if (len < 126) {
    out[1] = len;
  } else if (len < 65536) {
    out[1] = 126;
    out.writeUInt16BE(len, 2);
  } else {
    out[1] = 127;
    out.writeUInt32BE(0, 2);
    out.writeUInt32BE(len, 6);
  }
  payload.copy(out, header);
  return out;
}

const text = (s) => encodeFrame(0x1, Buffer.from(s, 'utf8'));
const pong = (s) => encodeFrame(0xa, s);
const closeFrame = () => encodeFrame(0x8, Buffer.alloc(0));

// --------------------------------------------------------------------------- one connection

class Conn {
  constructor(socket, onMessage, onClose) {
    this.socket = socket;
    this.onMessage = onMessage;
    this.onClose = onClose;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.dead = false;
    this.seen = Date.now();
    this.messages = 0;
    /** Liveness sweep, assigned right after the handshake succeeds. @type {ReturnType<typeof setInterval> | null} */
    this.sweep = null;

    socket.on('data', (chunk) => {
      this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
      this.seen = Date.now();
      this.pump();
    });
    socket.on('close', () => this.shutdown('socket closed'));
    socket.on('error', () => this.shutdown('socket error'));
  }

  pump() {
    for (;;) {
      const frame = parseFrame(this.buffer);
      if (frame === null) return; // incomplete — wait for more bytes
      if (typeof frame === 'string') return this.shutdown(frame);

      this.buffer = this.buffer.subarray(frame.size);
      const { fin, opcode, payload } = frame;

      if (opcode === 0x8) return this.shutdown('peer close');
      if (opcode === 0x9) {
        this.socket.write(pong(payload));
        continue;
      }
      if (opcode === 0xa) continue; // pong — liveness already recorded

      if (opcode === 0x0) {
        // continuation
        if (this.fragments.length === 0) return this.shutdown('unexpected continuation');
        this.fragments.push(payload);
        if (!fin) continue;
        const whole = Buffer.concat(this.fragments);
        this.fragments = [];
        this.deliver(whole);
        continue;
      }

      if (opcode !== 0x1 && opcode !== 0x2) return this.shutdown('unknown opcode');
      if (!fin) {
        this.fragments.push(payload);
        continue;
      }
      this.deliver(payload);
    }
  }

  deliver(payload) {
    this.messages++;
    if (this.messages > 20000) return this.shutdown('message flood');
    try {
      this.onMessage(this, JSON.parse(payload.toString('utf8')));
    } catch {
      // Malformed JSON is ignored rather than fatal — a bad frame must not kill the session.
    }
  }

  send(obj) {
    if (this.dead || this.socket.destroyed) return;
    this.socket.write(text(JSON.stringify(obj)));
  }

  shutdown(reason) {
    if (this.dead) return;
    this.dead = true;
    this.socket.write(closeFrame());
    this.socket.end();
    this.onClose(this, reason);
  }
}

// --------------------------------------------------------------------------- session clock

// Beats are quarter notes, matching Link's convention (16 steps = 4 beats).
class Session {
  constructor() {
    /** Shared session tempo, kept within TEMPO_MIN..TEMPO_MAX. @type {number} */
    this.bpm = 124;
    /** Whether the shared transport is running. @type {boolean} */
    this.playing = false;
    /** Beat position (quarter notes; 16 steps = 4 beats) frozen at the `at` timestamp. @type {number} */
    this.beat = 0;
    /** Wall-clock ms corresponding to `beat`. @type {number} */
    this.at = Date.now();
  }

  reanchor(beat) {
    this.beat = beat;
    this.at = Date.now();
  }

  beatNow() {
    if (!this.playing) return this.beat;
    return this.beat + ((Date.now() - this.at) * this.bpm) / 60000;
  }

  // Changing tempo must not jump the playhead, so freeze the current position first.
  setBpm(bpm) {
    if (!Number.isFinite(bpm)) return this.bpm;
    const next = Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, Math.round(bpm * 100) / 100));
    if (next === this.bpm) return this.bpm;
    this.reanchor(this.beatNow());
    this.bpm = next;
    return this.bpm;
  }

  setPlaying(on) {
    const want = Boolean(on);
    if (want === this.playing) return false;
    this.reanchor(this.beatNow());
    this.playing = want;
    return true;
  }
}

// --------------------------------------------------------------------------- wiring

function parseArgs(argv) {
  /** @type {{ port: number; host: string; quiet: boolean; origins: string[] | null }} */
  const opts = { port: 19876, host: '127.0.0.1', quiet: false, origins: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') opts.port = Number.parseInt(argv[++i], 10) || opts.port;
    else if (a === '--host') opts.host = argv[i + 1] === '*' ? '0.0.0.0' : argv[++i];
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '--allow-origin') opts.origins = (opts.origins ?? []).concat(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log(
        'usage: node link-bridge.mjs [--port N] [--host 127.0.0.1|*] [--allow-origin URL ...] [--quiet]',
      );
      process.exit(0);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const log = opts.quiet ? () => {} : (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);

// Loopback-only by default. Same-host origins are allowed; anything else needs --allow-origin.
const originAllowed = (origin) => {
  if (opts.origins?.includes(origin)) return true;
  if (!origin || origin === 'null') return false;
  try {
    const host = new URL(origin).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
  } catch {
    return false;
  }
};

const session = new Session();
const peers = new Set();

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(
    `MACHINEDRUM link bridge — ws endpoint, no HTTP routes. Point the app at ws://${opts.host}:${opts.port}\n`,
  );
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (req.headers['sec-websocket-version'] !== '13' || !key) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }
  if (!originAllowed(req.headers.origin)) {
    log(`REJECT origin ${req.headers.origin ?? '(none)'} — pass --allow-origin to permit it`);
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }

  const accept = createHash('sha1')
    .update(key + GUID)
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  // Node types the 'upgrade' socket as Duplex, but at runtime it is a net.Socket (documented
  // behaviour), and setNoDelay only exists on Socket.
  const netSocket = /** @type {import('node:net').Socket} */ (socket);
  netSocket.setNoDelay(true);

  const id = peers.size + 1;
  const onMessage = (conn, msg) => handle(conn, msg);
  const onClose = (conn, reason) => {
    if (!peers.delete(conn)) return;
    log(`LEAVE  peer ${peers.size} left (${reason}), ${peers.size} in session`);
  };

  const conn = new Conn(socket, onMessage, onClose);
  peers.add(conn);
  log(`JOIN   ${peers.size} in session, transport ${session.playing ? 'PLAYING' : 'stopped'}`);

  // Liveness sweep: drop sockets that stop pinging (the client pings every 100ms).
  conn.sweep = setInterval(() => {
    if (Date.now() - conn.seen > 10000) conn.shutdown('stalled');
  }, 2000);
  conn.sweep.unref?.();
});

function handle(conn, msg) {
  if (!msg || typeof msg !== 'object') return;

  switch (msg.type) {
    // The beat reported here is the beat at the instant this ping arrived. link.js anchors at
    // echo + rtt/2, which — given roughly symmetric latency — is the same instant.
    case 'ping': {
      conn.send({
        type: 'state',
        echo: msg.time,
        beat: Number(session.beatNow().toFixed(6)),
        bpm: session.bpm,
        peers: peers.size,
        playing: session.playing,
      });
      return;
    }
    case 'tempo': {
      const before = session.bpm;
      const bpm = session.setBpm(msg.bpm);
      if (bpm !== before) log(`TEMPO  ${before} → ${bpm} BPM`);
      return;
    }
    case 'transport': {
      if (session.setPlaying(msg.playing)) {
        log(`${msg.playing ? 'START' : 'STOP '} at beat ${session.beat.toFixed(2)} · ${session.bpm} BPM`);
      }
      return;
    }
    case 'sync':
      return; // per-client; this bridge has no transport-negiation policy to enforce
    default:
      return;
  }
}

server.listen(opts.port, opts.host, () => {
  console.log(`MACHINEDRUM link bridge: ws://${opts.host}:${opts.port}`);
  console.log('  local session host — shares transport, tempo and beat across app instances');
  console.log('  not Ableton Live interop: that needs the native ableton-link library');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\nclosing bridge');
    for (const p of peers) clearInterval(p.sweep);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
