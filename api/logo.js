// Same-origin logo proxy so company logos can be painted into canvas sprites
// (most logo hosts don't send CORS headers). Same access rules as /api/city;
// https images only, small files only.
const MAX_BYTES = 512 * 1024;
// Missing logos answer with a 1x1 transparent PNG instead of an error, so the
// browser console stays clean; the client treats a 1px image as "no logo".
const BLANK = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
function blank(res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.end(BLANK);
}

function allowed(req) {
  const token = process.env.NETCITY_ACCESS_TOKEN;
  if (token) return req.headers['x-netcity-token'] === token || new URL(req.url, 'http://x').searchParams.get('t') === token;
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(String(req.headers.host || ''));
}

async function fetchImage(url) {
  try {
    const target = new URL(url);
    if (target.protocol !== 'https:') return null;
    const up = await fetch(target, { redirect: 'follow', signal: AbortSignal.timeout(6000) });
    const type = up.headers.get('content-type') || '';
    if (!up.ok || !type.startsWith('image/') || new URL(up.url).protocol !== 'https:') return null;
    const buf = Buffer.from(await up.arrayBuffer());
    return buf.length <= MAX_BYTES ? { type, buf } : null;
  } catch {
    return null;
  }
}

module.exports = async (req, res) => {
  if (!allowed(req)) { res.statusCode = 401; return res.end(); }
  const q = new URL(req.url, 'http://x').searchParams;
  const domain = (q.get('d') || '').toLowerCase();
  // the company's logo_url first, then its favicon by domain
  let img = q.get('u') ? await fetchImage(q.get('u')) : null;
  if (!img && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) img = await fetchImage(`https://www.google.com/s2/favicons?domain=${domain}&sz=64`);
  if (!img) return blank(res);
  res.setHeader('Content-Type', img.type);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.end(img.buf);
};
