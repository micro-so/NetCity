// Shared Micro Blocks access for the /api functions (read-only).
//
// Why the city loads the way it does: on Micro today, filtering identities by
// their contacts (email_addresses) scans the identity table (~7s per query), and
// cursor pages get slower the deeper you go. Contacts, filtered by company, are
// fast (~0.2s/page). So the city is sized from contact counts, the walkers are
// the most recently active identities (an unfiltered, sorted query), and a
// building's identities are looked up when you open it, then cached.
const fs = require('fs');
const os = require('os');
const path = require('path');
const MicroSDK = require('@micro-so/sdk');
const Micro = MicroSDK.default || MicroSDK.Micro || MicroSDK;

const DAY = 864e5;
const MAX_PAGES = 60;
const MAX_COMPANIES = Number(process.env.NETCITY_MAX_COMPANIES) || 300;
const CONCURRENCY = 8; // Micro's beta limit is 10 req/s
const WALKER_PAGES = 4;
// Personal email providers show up as "companies"; nobody works there.
const PERSONAL = /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|mac|aol|proton|protonmail|pm|hey|fastmail|gmx|zoho|yandex|qq|163)\./i;
const IDENTITY_SELECTS = [
  ['full_name', 'title', 'about', 'summary', 'relationship_strength', 'last_interaction_date', 'email_addresses', 'linkedin', 'photo_url'],
  ['full_name', 'title', 'relationship_strength', 'last_interaction_date', 'email_addresses'],
];

const client = () => new Micro({
  maxRetries: 0, // retries are handled in request() below
  apiKey: process.env.MICRO_API_KEY,
  teamID: process.env.MICRO_TEAM_ID,
  ...(process.env.MICRO_BASE_URL ? { baseURL: process.env.MICRO_BASE_URL } : {}),
});

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}
// Micro allows 10 requests/second per key. Space every request we make (across
// the city build, per-building lookups and background warming) to stay under
// it, and back off on 429s: Micro doesn't always send Retry-After, so the SDK's
// own quick retries can give up too early.
const RATE = 8;
let nextSlot = 0;
function throttle() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + 1000 / RATE;
  return new Promise((r) => setTimeout(r, at - now));
}
async function request(resource, body) {
  for (let attempt = 0; ; attempt++) {
    await throttle();
    try {
      return await resource.query(body);
    } catch (e) {
      if (e.status !== 429 || attempt >= 6) throw e;
      await new Promise((r) => setTimeout(r, Math.min(8000, 500 * 2 ** attempt) + Math.random() * 250));
    }
  }
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const clip = (s, n) => (s ? String(s).slice(0, n) : s);
const firstId = (v) => { const f = Array.isArray(v) ? v[0] : v; return f && typeof f === 'object' ? f.id : f || null; };
const ids = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => (x && typeof x === 'object' ? x.id : x)).filter(Boolean);

// Page through a query. Tries each select list in turn so an unknown slug
// (a 400) degrades to a smaller field set instead of failing.
async function queryAll(resource, selects, filter, sort, maxPages = MAX_PAGES) {
  let lastErr;
  for (const select of selects) {
    try {
      const out = [];
      let cursor;
      for (let page = 0; page < maxPages; page++) {
        const q = { select, filter, limit: 50, ...(sort ? { sort } : {}), ...(cursor ? { cursor } : {}) };
        const res = await request(resource, { query: q });
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

function allowed(req, allowQueryToken) {
  const token = process.env.NETCITY_ACCESS_TOKEN;
  if (token) return req.headers['x-netcity-token'] === token || (allowQueryToken && new URL(req.url, 'http://x').searchParams.get('t') === token);
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(String(req.headers.host || ''));
}
function configError() {
  return !process.env.MICRO_API_KEY || !process.env.MICRO_TEAM_ID ? 'MICRO_API_KEY and MICRO_TEAM_ID are not set on the server.' : null;
}

// Identity -> the game's person record, placed at `orgId`.
function personFrom(idn, contactsById, orgId) {
  const p = idn.properties || {};
  const mine = ids(p.email_addresses).map((cid) => contactsById.get(cid)).filter(Boolean);
  const best = mine.slice().sort((a, b) => String(b.last_interaction_date || '').localeCompare(String(a.last_interaction_date || '')))[0] || {};
  const last = [p.last_interaction_date, ...mine.map((c) => c.last_interaction_date)].filter(Boolean).sort().pop() || null;
  return {
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
      company: orgId || firstId(best.company),
    },
  };
}

// ---------- the city: companies, head counts, walkers (fast) ----------
async function buildCity() {
  const O = client().prism.objects;
  const since = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
  const t0 = Date.now(), lap = (label) => console.log(`[netcity]   ${label} ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  let organizations = (await queryAll(
    O.organizations,
    [
      ['name', 'primary_domain', 'categories', 'about', 'summary', 'stage', 'funding_raised', 'employee_count', 'logo_url', 'last_interaction_date'],
      ['name', 'primary_domain', 'categories', 'stage', 'logo_url', 'last_interaction_date'],
    ],
    [{ last_interaction_date: { '>=': since } }],
    [{ last_interaction_date: 'desc' }],
    Math.ceil((MAX_COMPANIES * 1.25) / 50), // enough to fill MAX_COMPANIES after dropping personal domains
  ))
    .filter((o) => o.properties && !PERSONAL.test(o.properties.primary_domain || '') && !PERSONAL.test((o.properties.name || '') + '.'))
    .slice(0, MAX_COMPANIES);
  organizations = organizations.filter((o) => o.properties);
  for (const o of organizations) { o.properties.about = clip(o.properties.about, 500); o.properties.summary = clip(o.properties.summary, 500); }
  const orgIds = new Set(organizations.map((o) => o.id));
  lap(`companies (${organizations.length})`);

  // Head counts: one request per company for its 50 most recent contacts plus
  // the filtered total. Small companies are counted exactly (one person with
  // several addresses counts once); big ones are estimated from the share of
  // distinct people in that first page. Paging every contact of a 12k-contact
  // company just to count it would take minutes.
  const who = (cp, id) => String(cp.full_name || cp.email || id).trim().toLowerCase();
  const countsP = pool(organizations, CONCURRENCY, async (o) => {
    const res = await request(O.contacts, {
      query: { select: ['company', 'full_name', 'email', 'title', 'last_interaction_date'], filter: [{ company: { in: [o.id] } }], sort: [{ last_interaction_date: 'desc' }], limit: 50 },
      include_total: true,
    });
    const rows = (res.data || []).filter((c) => c.properties);
    const total = Math.max(res.total ?? rows.length, rows.length);
    const unique = new Set(rows.map((c) => who(c.properties, c.id))).size;
    o.properties.people_count = total <= rows.length ? unique : Math.round((total * unique) / Math.max(1, rows.length));
    return rows;
  }).then((r) => { lap('head counts'); return r.flat(); });
  // The most recently active identities walk the streets (unfiltered + sorted = fast).
  const recentP = queryAll(O.identities, IDENTITY_SELECTS, [{ last_interaction_date: { exists: true } }], [{ last_interaction_date: 'desc' }], WALKER_PAGES).then((r) => { lap(`recent identities (${r.length})`); return r; });
  const [contacts, recent] = await Promise.all([countsP, recentP]);
  const contactsById = new Map(contacts.map((c) => [c.id, c.properties || {}]));

  const walkers = [];
  const seenNames = new Set();
  for (const idn of recent) {
    const person = personFrom(idn, contactsById, null);
    const key = (person.properties.full_name || '').trim().toLowerCase();
    if (!key || !orgIds.has(person.properties.company) || seenNames.has(key)) continue;
    seenNames.add(key);
    walkers.push(person);
    if (walkers.length >= 100) break;
  }
  return {
    organizations: { data: organizations.filter((o) => o.properties.people_count > 0) },
    identities: { data: walkers },
  };
}

// ---------- one building's people (slow on Micro today, so cached) ----------
const ORG_TTL = 6 * 60 * 60 * 1000;
const ORG_FILE = path.join(os.tmpdir(), `netcity-${String(process.env.MICRO_TEAM_ID || 'x').slice(0, 8)}-orgs.json`);
let orgCache = new Map();
try { orgCache = new Map(Object.entries(JSON.parse(fs.readFileSync(ORG_FILE, 'utf8')))); } catch { /* none yet */ }
let saveTimer = null;
function saveOrgCache() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(ORG_FILE, JSON.stringify(Object.fromEntries(orgCache)), { mode: 0o600 }); } catch { /* read-only fs */ }
  }, 500);
}
const inflight = new Map();

function peopleForOrg(orgId) {
  const hit = orgCache.get(orgId);
  if (hit && Date.now() - hit.at < ORG_TTL) return Promise.resolve(hit.people);
  if (inflight.has(orgId)) return inflight.get(orgId);
  const p = (async () => {
    const O = client().prism.objects;
    const contacts = await queryAll(O.contacts, [['company', 'full_name', 'email', 'title', 'last_interaction_date']], [{ company: { in: [orgId] } }], null, 400);
    const contactsById = new Map(contacts.map((c) => [c.id, c.properties || {}]));
    // big lists find their matches sooner, so ask in batches of 500 contact ids
    const found = (await pool(chunk([...contactsById.keys()], 500), 3, (c) =>
      queryAll(O.identities, IDENTITY_SELECTS, [{ email_addresses: { in: c } }]))).flat();
    // Micro sometimes has several identities for one person (same name, shared
    // contacts). Show each person once: merge by name, keeping the most recent.
    const byKey = new Map();
    for (const idn of found) {
      const person = personFrom(idn, contactsById, orgId);
      const pp = person.properties;
      const key = (pp.full_name || '').trim().toLowerCase() || (pp.email || '').toLowerCase() || person.id;
      const prev = byKey.get(key);
      if (!prev) { byKey.set(key, person); continue; }
      const a = prev.properties;
      const newer = String(pp.last_interaction_date || '') > String(a.last_interaction_date || '');
      for (const [k, v] of Object.entries(pp)) if (v != null && (a[k] == null || (newer && k !== 'company'))) a[k] = v;
    }
    const people = [...byKey.values()];
    orgCache.set(orgId, { at: Date.now(), people });
    saveOrgCache();
    return people;
  })().finally(() => inflight.delete(orgId));
  inflight.set(orgId, p);
  return p;
}

// Look up buildings in the background, biggest first, so most are ready before
// anyone clicks them. Runs where the process stays alive (dev server).
let warming = false;
async function warmOrgs(organizations) {
  if (warming) return;
  warming = true;
  try {
    const todo = organizations.slice().sort((a, b) => (b.properties.people_count || 0) - (a.properties.people_count || 0));
    await pool(todo, 2, (o) => peopleForOrg(o.id).catch(() => null));
  } finally {
    warming = false;
  }
}
const orgStatus = () => ({ cached: orgCache.size, warming });

module.exports = { buildCity, peopleForOrg, warmOrgs, orgStatus, allowed, configError };
