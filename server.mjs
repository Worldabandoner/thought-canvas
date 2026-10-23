import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || '127.0.0.1';
const files = new Set(['index.html', 'styles.css', 'app.js', 'model.js', 'assets/favicon.svg', 'assets/landscape.svg']);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
  try {
    const url = new URL(req.url, 'http://localhost');
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    if (!files.has(relative)) { res.writeHead(404); return res.end('Not found'); }
    const file = path.join(root, relative);
    await stat(file);
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Length': data.length });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(400); res.end('Bad request'); }
});
server.on('error', error => { console.error(`无法启动：${error.message}`); process.exitCode = 1; });
server.listen(port, host, () => console.log(`思想画布已启动：http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`));
