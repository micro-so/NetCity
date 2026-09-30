// Read-only proxy to Micro Blocks. Returns { organizations, contacts } shaped like
// Prism query responses so the browser's normalizer can build the city.
// The API key never leaves the server.
//
// Env: MICRO_API_KEY, MICRO_TEAM_ID, optional MICRO_BASE_URL, optional NETCITY_ACCESS_TOKEN.
// Without NETCITY_ACCESS_TOKEN the endpoint only answers requests to localhost, so a
// public deployment can't leak your network by accident.

const BASE = process.env.MICRO_BASE_URL || 'https://developers.micro.so';
const DAY = 864e5;
const MAX_PAGES = 60; // 50 per page -> up to 3,000 records per object type

async function query(objectType, body) {
  const res = await fetch(`${BASE}/v2/prism/${process.env.MICRO_TEAM_ID}/${objectType}/query`, {
    method: 'POST',
    headers: { 'x-api-key': process.env.MICRO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 429) {
    const wait = Number(res.headers.get('retry-after') || 1) * 1000;
    await new Promise((r) => setTimeout(r, wait));
    return query(objectType, body);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`${objectType} query failed (${res.status}): ${JSON.stringify(json).slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

// Page through a query. Tries each select list in turn so an unknown slug
// (a 400) degrades to a smaller field set instead of failing the whole city.
async function queryAll(objectType, selects, filter, sort) {
  let lastErr;
  for (const select of selects) {
    try {
      const out = [];
      let cursor = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const json = await query(objectType, { query: { select, filter, sort, limit: 50, cursor } });
        out.push(...(json.data || []));
        if (!json.has_more || !json.next_cursor) break;
        cursor = json.next_cursor;
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
  const host = String(req.headers.host || '');
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!allowed(req)) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: 'Set NETCITY_ACCESS_TOKEN on the server and enter it in City Hall.' }));
  }
  if (!process.env.MICRO_API_KEY || !process.env.MICRO_TEAM_ID) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'MICRO_API_KEY and MICRO_TEAM_ID are not set on the server.' }));
  }
  try {
    const since = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
    // Companies you've touched in the last 30 days become buildings.
    const organizations = await queryAll(
      'organization',
      [
        ['name', 'primary_domain', 'categories', 'stage', 'funding_raised', 'employee_count', 'logo_url', 'last_interaction_date'],
        ['name', 'primary_domain', 'categories', 'last_interaction_date'],
      ],
      [{ last_interaction_date: { '>=': since } }],
      [{ last_interaction_date: 'desc' }],
    );
    const orgIds = organizations.map((o) => o.id);

    // Everyone you know at those companies (building height = head count).
    const contactSelects = [
      ['full_name', 'email', 'title', 'linkedin', 'photo_url', 'last_interaction_date', 'company', 'company.name'],
      ['full_name', 'email', 'title', 'last_interaction_date', 'company'],
    ];
    let contacts = [];
    for (let i = 0; i < orgIds.length; i += 50) {
      const chunk = orgIds.slice(i, i + 50);
      try {
        contacts.push(...(await queryAll('contact', contactSelects, [{ company: { in: chunk } }], [{ last_interaction_date: 'desc' }])));
      } catch (e) {
        if (e.status !== 400) throw e;
        // Relation filters unsupported: fall back to recent contacts and filter here.
        contacts = await queryAll('contact', contactSelects, [{ last_interaction_date: { exists: true } }], [{ last_interaction_date: 'desc' }]);
        break;
      }
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ organizations: { data: organizations }, contacts: { data: contacts } }));
  } catch (e) {
    res.statusCode = e.status && e.status < 500 ? 502 : 500;
    res.end(JSON.stringify({ error: e.message }));
  }
};
