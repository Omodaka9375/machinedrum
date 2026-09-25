// Zero-dependency static file server for the local MACHINEDRUM mirror.
// ES modules are blocked over file://, so the app must be served over http://.
//   node serve.mjs            -> http://127.0.0.1:4173
//   node serve.mjs 8080       -> http://127.0.0.1:8080
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname);
const PORT = Number(process.argv[2] ?? 4173);

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  // A manifest served as application/octet-stream is rejected by Chrome, which silently drops
  // the installable/PWA metadata that dist/index.html links. This server and `npm run preview`
  // are both documented ways to run the app, so both must get the type right.
  '.webmanifest': 'application/manifest+json',
};

const server = createServer(async (req, res) => {
  try {
    const raw = decodeURIComponent(new URL(req.url ?? '/', 'http://internal').pathname);
    let target = join(ROOT, raw === '/' ? 'index.html' : raw);

    // Reject anything that escapes the mirrored folder.
    if (target !== ROOT && !target.startsWith(ROOT + sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    // Containment is not enough: .git lives *inside* the mirrored folder, so the check above
    // happily serves the repository's object database, its config, and any dotfile local to the
    // checkout. The mirror is meant to expose the site, never the VCS metadata or editor/secret
    // files, so every dot-prefixed segment of the path actually being served is refused.
    // Tested against `target` (already normalised by join) rather than the raw URL, so a
    // harmless `/./x` or `/a//b` is not rejected for a segment path.resolve would have dropped.
    if (relative(ROOT, target).split(sep).some((segment) => segment.startsWith('.'))) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const info = await stat(target).catch(() => null);
    if (info?.isDirectory()) {
      target = join(target, 'index.html');
    } else if (!info && !extname(target)) {
      target += '.html';
    }

    const body = await readFile(target);
    res
      .writeHead(200, {
        'content-type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      })
      .end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`MACHINEDRUM: http://127.0.0.1:${PORT}/`);
});
