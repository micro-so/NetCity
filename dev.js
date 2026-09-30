// Local dev server: static files + the /api functions, reading .env.
// Usage: node dev.js [port]   then open http://localhost:8762/?real
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = Number(process.argv[2]) || 8762;
try {
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch { /* no .env: demo mode still works */ }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const api = { '/api/city': require('./api/city.js'), '/api/logo': require('./api/logo.js') };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (api[url.pathname]) return api[url.pathname](req, res);
  const file = path.join(root, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  const rel = path.relative(root, file);
  if (rel.startsWith('..') || path.isAbsolute(rel) || /(^|[\\/])(\.[^\\/]*|node_modules|api|package(-lock)?\.json)([\\/]|$)/.test(rel)) { res.statusCode = 404; return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(buf);
  });
}).listen(port, () => {
  console.log(`NetCity on http://localhost:${port}  (real data: http://localhost:${port}/?real)`);
  // start pulling the real city right away so the first ?real load is quick
  if (process.env.MICRO_API_KEY && process.env.MICRO_TEAM_ID) api['/api/city'].warm().catch((e) => console.error('[netcity] warm-up failed:', e.message));
});
