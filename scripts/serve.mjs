/**
 * A tiny static file server for the built site (scripts/start.mjs uses it for `npm start`). It answers GET and HEAD,
 * sends byte ranges (Safari plays audio only with them), and never serves a file outside `site`. No dependencies.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.woff2': 'font/woff2', '.pdf': 'application/pdf',
};

/** An http.Server that serves the files in `site` (an absolute folder). Call `.listen(port, host)` on it. */
export function createStaticServer(site) {
  const root = path.resolve(site);
  return http.createServer((req, res) => {
    const send = (status, text) => { res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }); res.end(text); };
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Only GET and HEAD');
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { return send(400, 'Bad URL'); }
    const file = path.join(root, path.normalize(pathname).replace(/^([/\\])+/, ''));
    if (file !== root && !file.startsWith(root + path.sep)) return send(403, 'Forbidden');
    let target = file;
    let stat;
    try {
      stat = fs.statSync(target);
      if (stat.isDirectory()) { target = path.join(target, 'index.html'); stat = fs.statSync(target); }
    } catch {
      return send(404, 'Not found');
    }
    const headers = {
      'content-type': TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
      'accept-ranges': 'bytes', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'x-pips-notebook': 'site',
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
      if (start > end || start >= stat.size) { res.writeHead(416, { 'content-range': `bytes */${stat.size}` }); return res.end(); }
      res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(target, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'content-length': stat.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(target).pipe(res);
  });
}
