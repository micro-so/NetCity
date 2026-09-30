// GET /api/org?id=<organization id>: the identities (one per real person) at
// one company, looked up when a building is opened and cached afterwards.
const { peopleForOrg, allowed, configError } = require('../lib/micro.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!allowed(req)) { res.statusCode = 401; return res.end(JSON.stringify({ error: 'unauthorized' })); }
  const err = configError();
  if (err) { res.statusCode = 500; return res.end(JSON.stringify({ error: err })); }
  const id = new URL(req.url, 'http://x').searchParams.get('id');
  if (!id || !/^[\w-]{8,64}$/.test(id)) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'bad id' })); }
  try {
    const people = await peopleForOrg(id);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ identities: { data: people } }));
  } catch (e) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: String(e.message || e).slice(0, 400) }));
  }
};
