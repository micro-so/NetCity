// Read-only city data from Micro Blocks, via the official SDK.
//
// Buildings are organizations you've touched in the last 30 days. People are
// identities (one per real person, not one per email/contact record), placed at
// the company of their most recent contact. The API key never leaves the server.
//
// Env: MICRO_API_KEY, MICRO_TEAM_ID, optional MICRO_BASE_URL, NETCITY_ACCESS_TOKEN,
// NETCITY_MAX_COMPANIES. Without NETCITY_ACCESS_TOKEN it only answers on localhost.
const MicroSDK = require('@micro-so/sdk');
const Micro = MicroSDK.default || MicroSDK.Micro || MicroSDK;

const DAY = 864e5;
const MAX_PAGES = 60; // 50 per page
const MAX_COMPANIES = Number(process.env.NETCITY_MAX_COMPANIES) || 300;
const CONCURRENCY = 8; // Micro's beta limit is 10 req/s; each page takes ~1s
const CACHE_MS = 10 * 60 * 1000;
const fs = require('fs');
const path = require('path');
const CACHE_FILE = path.join(require('os').tmpdir(), `netcity-${String(process.env.MICRO_TEAM_ID || 'x').slice(0, 8)}.json`);
// Personal email providers show up as "companies"; nobody works there.
const PERSONAL = /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|mac|aol|proton|protonmail|pm|hey|fastmail|gmx|zoho|yandex|qq|163)\./i;
// Stale-while-revalidate: always answer from the last build if there is one,
// and rebuild in the background once it's older than CACHE_MS.
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
        console.log(`[netcity] city built in ${Math.round((Date.now() - t) / 1000)}s`);
      })
      .finally(() => { building = null; });
  }
  return building;
}

function client() {
  return new Micro({
    apiKey: process.env.MICRO_API_KEY,
    teamID: process.env.MICRO_TEAM_ID,
    ...(process.env.MICRO_BASE_URL ? { baseURL: process.env.MICRO_BASE_URL } : {}),
  });
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// Page through a query. Tries each select list in turn so an unknown slug
// (a 400) degrades to a smaller field set instead of failing the whole city.
async function queryAll(resource, selects, filter, sort) {
  let lastErr;
  for (const select of selects) {
    try {
      const out = [];
      let cursor;
      for (let page = 0; page < MAX_PAGES; page++) {
        const q = { select, filter, limit: 50, ...(sort ? { sort } : {}), ...(cursor ? { cursor } : {}) };
        const res = await resource.query({ query: q });
        out.push(...(res.data || []));
        if (!res.has_more || !res.next_cursor) break;
        cursor = res.next_cursor;
      }
      return out;
    } catch (e) {
      lastErr = e;
      if (e.status !== 400) throw e;
    }
  }
  throw lastErr;
}

function allowed(req) {
  const token = process.env.NETCITY_ACCESS_TOKEN;
  if (token) return req.headers['x-netcity-token'] === token;
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(String(req.headers.host || ''));
}
const firstId = (v) => { const f = Array.isArray(v) ? v[0] : v; return f && typeof f === 'object' ? f.id : f || null; };
const ids = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => (x && typeof x === 'object' ? x.id : x)).filter(Boolean);
const clip = (s, n) => (s ? String(s).slice(0, n) : s);

async function buildCity() {
  const micro = client();
  const O = micro.prism.objects;
  const since = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);

  // 1. Companies you've touched in the last 30 days become buildings.
  const organizations = (await queryAll(
    O.organizations,
    [
      ['name', 'primary_domain', 'categories', 'about', 'summary', 'stage', 'funding_raised', 'employee_count', 'logo_url', 'last_interaction_date'],
      ['name', 'primary_domain', 'categories', 'stage', 'logo_url', 'last_interaction_date'],
    ],
    [{ last_interaction_date: { '>=': since } }],
    [{ last_interaction_date: 'desc' }],
  ))
    .filter((o) => !PERSONAL.test(o.properties.primary_domain || '') && !PERSONAL.test((o.properties.name || '') + '.'))
    .slice(0, MAX_COMPANIES);
  for (const o of organizations) { o.properties.about = clip(o.properties.about, 500); o.properties.summary = clip(o.properties.summary, 500); }

  // 2. Contact records at those companies (only to link people to companies).
  const contacts = (await pool(chunk(organizations.map((o) => o.id), 50), CONCURRENCY, (orgChunk) =>
    queryAll(O.contacts, [['company', 'title', 'email', 'last_interaction_date']], [{ company: { in: orgChunk } }]))).flat();
  const contactById = new Map(contacts.map((c) => [c.id, c.properties]));

  // 3. The identities behind those contacts: one per real person.
  const identitySelects = [
    ['full_name', 'title', 'about', 'summary', 'relationship_strength', 'last_interaction_date', 'email_addresses', 'linkedin', 'photo_url'],
    ['full_name', 'title', 'relationship_strength', 'last_interaction_date', 'email_addresses'],
  ];
  const identities = (await pool(chunk([...contactById.keys()], 500), CONCURRENCY, (cChunk) =>
    queryAll(O.identities, identitySelects, [{ email_addresses: { in: cChunk } }]))).flat();

  // Place each person once, at the company of their most recent contact record.
  const seen = new Set();
  const people = [];
  for (const idn of identities) {
    if (seen.has(idn.id)) continue;
    seen.add(idn.id);
    const p = idn.properties;
    const mine = ids(p.email_addresses).map((cid) => contactById.get(cid)).filter(Boolean);
    if (!mine.length) continue;
    mine.sort((a, b) => String(b.last_interaction_date || '').localeCompare(String(a.last_interaction_date || '')));
    const best = mine[0];
    const last = [p.last_interaction_date, ...mine.map((c) => c.last_interaction_date)].filter(Boolean).sort().pop() || null;
    people.push({
      id: idn.id,
      properties: {
        full_name: p.full_name,
        title: p.title || (mine.find((c) => c.title) || {}).title || null,
        email: best.email || null,
        about: clip(p.about, 500),
        summary: clip(p.summary, 500),
        relationship_strength: p.relationship_strength ?? null,
        last_interaction_date: last,
        linkedin: p.linkedin || null,
        photo_url: p.photo_url || null,
        company: firstId(best.company),
      },
    });
  }
  return { organizations: { data: organizations }, identities: { data: people } };
}

module.exports = async function city(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!allowed(req)) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: 'Set NETCITY_ACCESS_TOKEN on the server and enter it in City Hall.' }));
  }
  if (!process.env.MICRO_API_KEY || !process.env.MICRO_TEAM_ID) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'MICRO_API_KEY and MICRO_TEAM_ID are not set on the server.' }));
  }
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
};

module.exports.warm = () => (cache ? Promise.resolve() : rebuild());
