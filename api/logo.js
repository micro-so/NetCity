// Same-origin logo proxy so company logos can be painted into canvas sprites
// (most logo hosts don't send CORS headers). Same access rules as /api/city;
// https images only, small files only.
const MAX_BYTES = 512 * 1024;

function allowed(req) {
  const token = process.env.NETCITY_ACCESS_TOKEN;
  if (token) return req.headers['x-netcity-token'] === token || new URL(req.url, 'http://x').searchParams.get('t') === token;
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(String(req.headers.host || ''));
}

module.exports = async (req, res) => {
  if (!allowed(req)) { res.statusCode = 401; return res.end(); }
  let target;
  try { target = new URL(new URL(req.url, 'http://x').searchParams.get('u')); } catch { res.statusCode = 400; return res.end(); }
  if (target.protocol !== 'https:') { res.statusCode = 400; return res.end(); }
  try {
    const up = await fetch(target, { redirect: 'follow' });
    const type = up.headers.get('content-type') || '';
    if (!up.ok || !type.startsWith('image/')) { res.statusCode = 404; return res.end(); }
    const buf = Buffer.from(await up.arrayBuffer());
    if (buf.length > MAX_BYTES) { res.statusCode = 413; return res.end(); }
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.end(buf);
  } catch {
    res.statusCode = 502;
    res.end();
  }
};
