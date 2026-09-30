// GET /api/city: companies you've touched in the last 30 days (sized by head
// count) plus the most recently active identities as walkers. Read-only; the
// API key never leaves the server. Localhost-only unless NETCITY_ACCESS_TOKEN
// is set. See lib/micro.js for why people load per building.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildCity, warmOrgs, allowed, configError } = require('../lib/micro.js');

const CACHE_MS = 10 * 60 * 1000;
const CACHE_FILE = path.join(os.tmpdir(), `netcity-${String(process.env.MICRO_TEAM_ID || 'x').slice(0, 8)}-city.json`);

// Stale-while-revalidate: answer from the last build if there is one and
// rebuild in the background once it's older than CACHE_MS.
let cache = null;
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { /* first run */ }
let building = null;
function rebuild() {
  if (!building) {
    const t = Date.now();
    building = buildCity()
      .then((city) => {
        cache = { at: Date.now(), body: JSON.stringify(city) };
        try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), { mode: 0o600 }); } catch { /* read-only fs */ }
        console.log(`[netcity] city built in ${((Date.now() - t) / 1000).toFixed(1)}s`);
        return city;
      })
      .finally(() => { building = null; });
  }
  return building;
}

async function city(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!allowed(req)) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: 'Set NETCITY_ACCESS_TOKEN on the server and enter it in City Hall.' }));
  }
  const err = configError();
  if (err) { res.statusCode = 500; return res.end(JSON.stringify({ error: err })); }
  const fresh = new URL(req.url || '/', 'http://x').searchParams.has('fresh');
  try {
    if (!cache || fresh) await rebuild();
    else if (Date.now() - cache.at > CACHE_MS) rebuild().catch((e) => console.error('[netcity] rebuild failed', e.message));
    res.setHeader('Content-Type', 'application/json');
    res.end(cache.body);
  } catch (e) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: String(e.message || e).slice(0, 400) }));
  }
}

// Dev server: build the city on start, then look up buildings in the background.
city.warm = async () => {
  const c = cache ? JSON.parse(cache.body) : await rebuild();
  warmOrgs(c.organizations.data).catch((e) => console.error('[netcity] warm-up failed', e.message));
};
module.exports = city;
