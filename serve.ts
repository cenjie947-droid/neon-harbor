// serve.ts — a tiny static server for Neon Harbor (Node standard library only).
//
// Serves the game/ folder on http://localhost:8080 (or --port <n>).
// No build step, no dependencies: plain files, correct MIME types, and a
// no-store cache header so the browser always fetches the latest edit.
//
// Usage:
//   node serve.ts            # http://localhost:8080
//   node serve.ts --port 8901

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, 'game');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function parsePort() {
  const flag = process.argv.indexOf('--port');
  if (flag >= 0 && process.argv[flag + 1]) {
    const port = Number(process.argv[flag + 1]);
    if (Number.isInteger(port) && port > 0 && port < 65536) return port;
  }
  const env = Number(process.env.PORT);
  if (Number.isInteger(env) && env > 0 && env < 65536) return env;
  return 8080;
}

// Resolve a request path inside game/; anything that would escape the
// folder (like /../main.ts) is refused outright.
function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const cleaned = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '');
  const full = resolve(join(root, cleaned));
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

const port = parsePort();

const server = createServer((req, res) => {
  const urlPath = req.url === '/' || !req.url ? '/index.html' : req.url;
  const file = safePath(urlPath);
  if (!file) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Forbidden\n');
    return;
  }
  let target = file;
  try {
    if (existsSync(target) && statSync(target).isDirectory()) {
      target = join(target, 'index.html');
    }
    const body = readFileSync(target);
    const type = TYPES[extname(target).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      'cache-control': 'no-store',
      'content-length': body.length,
    });
    res.end(body);
  } catch (err) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found\n');
  }
});

server.listen(port, () => {
  console.log(`Neon Harbor serving game/ at http://localhost:${port}/`);
});
