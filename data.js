// NetCity data layer.
// Mock mode generates responses shaped like Micro Prism queries
// ({ data: [{ id, properties }] }) so real data can drop in later via /api/city.
(function () {
  const DAY = 864e5;

  function rng(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const INDUSTRIES = {
    'AI / ML': ['AI', 'Labs', 'Intelligence', 'Robotics'],
    'Fintech': ['Pay', 'Ledger', 'Finance', 'Bank'],
    'Venture Capital': ['Capital', 'Ventures', 'Partners', 'Fund'],
    'Developer Tools': ['Dev', 'Stack', 'Cloud', 'Systems'],
    'Healthcare': ['Health', 'Care', 'Bio', 'Medical'],
    'Consumer': ['Co', 'Goods', 'Social', 'Studio'],
    'Climate': ['Energy', 'Carbon', 'Solar', 'Grid'],
    'Enterprise SaaS': ['HQ', 'Software', 'Works', 'Suite'],
    'Media': ['Media', 'Press', 'Network', 'Pods'],
    'Crypto': ['Chain', 'Protocol', 'Labs', 'DAO'],
  };
  const PREFIX = ['North', 'Blue', 'Iron', 'Quanta', 'Vela', 'Nimbus', 'Lumen', 'Cobalt', 'Arbor', 'Kestrel',
    'Tidal', 'Ember', 'Orbit', 'Halcyon', 'Juniper', 'Solace', 'Vector', 'Atlas', 'Pioneer', 'Meridian',
    'Cinder', 'Granite', 'Aurora', 'Beacon', 'Harbor', 'Summit', 'Willow', 'Falcon', 'Prism', 'Copper',
    'Maple', 'Signal', 'Saffron', 'Pylon', 'Onyx', 'Lattice', 'Relay', 'Cascade', 'Tandem', 'Parallax',
    'Sierra', 'Nova', 'Bramble', 'Pebble', 'Wander', 'Glacier', 'Fathom', 'Keystone', 'Sparrow', 'Mosaic'];
  const FIRST = ['Maya', 'Leo', 'Priya', 'Sam', 'Ana', 'Jonah', 'Aisha', 'Marcus', 'Elena', 'Kai', 'Zoe', 'Omar',
    'Nina', 'Theo', 'Grace', 'Ravi', 'Lena', 'Diego', 'Ivy', 'Noah', 'Sofia', 'Ethan', 'Mei', 'Lucas', 'Hana',
    'Owen', 'Chloe', 'Arjun', 'Isla', 'Felix', 'Nora', 'Mateo', 'Ruby', 'Sasha', 'Jules', 'Tara', 'Ben', 'Yuki',
    'Amara', 'Caleb', 'Freya', 'Hugo', 'Lila', 'Rohan', 'Esme', 'Tomas', 'Wren', 'Idris', 'Clara', 'Max'];
  const LAST = ['Chen', 'Patel', 'Garcia', 'Kim', 'Nguyen', 'Okafor', 'Rossi', 'Schmidt', 'Silva', 'Cohen',
    'Tanaka', 'Hughes', 'Murphy', 'Singh', 'Lopez', 'Novak', 'Ahmed', 'Berg', 'Duarte', 'Fischer', 'Grant',
    'Ito', 'Jensen', 'Khan', 'Larsen', 'Moreau', 'Osei', 'Park', 'Quinn', 'Reyes', 'Sato', 'Torres', 'Vance',
    'Walsh', 'Young', 'Zhou', 'Abbott', 'Brooks', 'Castillo', 'Dalton'];
  const VC_TITLES = ['Partner', 'General Partner', 'Principal', 'Associate', 'Managing Partner', 'Venture Partner', 'Platform Lead', 'Scout'];
  const TITLES = ['CEO & Co-founder', 'CTO & Co-founder', 'Head of Product', 'VP Engineering', 'Head of Growth',
    'Founding Engineer', 'Chief of Staff', 'Head of Sales', 'Product Designer', 'COO', 'Head of Partnerships',
    'Staff Engineer', 'Head of Marketing', 'Account Executive', 'Recruiter', 'Head of Finance'];
  const STAGES = ['Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C', 'Growth', 'Public'];

  function mockRaw(now) {
    const r = rng(20260930);
    const pick = (a) => a[Math.floor(r() * a.length)];
    const orgs = [];
    const contacts = [];
    const usedNames = new Set();
    let cid = 0;

    for (const [industry, suffixes] of Object.entries(INDUSTRIES)) {
      const count = 18 + Math.floor(r() * 16);
      for (let i = 0; i < count; i++) {
        let name;
        do { name = pick(PREFIX) + ' ' + pick(suffixes); } while (usedNames.has(name));
        usedNames.add(name);
        const slug = name.toLowerCase().replace(/[^a-z]/g, '');
        const id = 'org_' + slug;
        const vc = industry === 'Venture Capital';
        const stage = vc ? null : STAGES[Math.min(STAGES.length - 1, Math.floor(r() * r() * STAGES.length * 1.6))];
        const stageIdx = stage ? STAGES.indexOf(stage) : 3;
        // how warm this company is: about half were touched in the last month
        const warmDays = r() < 0.5 ? r() * 30 : 30 + r() * 320;
        const x = r();
        const people = x < 0.42 ? 1 : x < 0.68 ? 2 + Math.floor(r() * 2) : x < 0.87 ? 4 + Math.floor(r() * 5)
          : x < 0.97 ? 9 + Math.floor(r() * 10) : 20 + Math.floor(r() * 18);

        orgs.push({
          id,
          properties: {
            name,
            primary_domain: slug + (industry === 'AI / ML' ? '.ai' : '.com'),
            industry,
            stage,
            funding_raised: vc ? null : Math.round(Math.pow(4, stageIdx) * (0.4 + r()) * 1.5) * 1e5,
            employee_count: Math.max(people * 3 + Math.round(r() * 12), Math.round(Math.pow(3, stageIdx + 1) * (0.5 + r()))),
          },
        });

        for (let p = 0; p < people; p++) {
          const first = pick(FIRST), last = pick(LAST);
          const days = p === 0 ? warmDays : warmDays + (-Math.log(1 - r()) * 45);
          const last_interaction_date = new Date(now - days * DAY - r() * DAY).toISOString();
          contacts.push({
            id: 'con_' + (++cid),
            properties: {
              full_name: first + ' ' + last,
              email: (first + '.' + last).toLowerCase() + '@' + slug + (industry === 'AI / ML' ? '.ai' : '.com'),
              title: vc ? pick(VC_TITLES) : (p === 0 && r() < 0.5 ? TITLES[0] : pick(TITLES)),
              last_interaction_date,
              relationship_strength: Math.max(5, Math.min(99, Math.round(95 - days * 0.35 + (r() - 0.5) * 30))),
              company: { id, name },
            },
          });
        }
      }
    }
    return { organizations: { data: orgs }, contacts: { data: contacts } };
  }

  // Micro `categories` are free-form sector tags; map them onto the city's districts.
  const SECTORS = [
    ['Venture Capital', /venture|\bvcs?\b|investors?\b|investment firm|capital\b|private equity|\bfunds?\b|angel invest/],
    ['AI / ML', /\bai\b|artificial|machine learning|\bml\b|llm|generative|computer vision|robotic/],
    ['Crypto', /crypto|web3|blockchain|defi|\bnft|bitcoin|ethereum/],
    ['Fintech', /fintech|financ|payment|bank|insur|lending|accounting|trading|wealth/],
    ['Healthcare', /health|medic|\bbio|pharma|clinic|\bcare\b|therap|wellness|hospital/],
    ['Climate', /climate|energy|cleantech|clean energy|sustainab|solar|carbon|batter(y|ies)|\bevs?\b|agri/],
    ['Developer Tools', /developer|devtools|infrastructure|open source|cloud|\bapi|database|security|devops/],
    ['Media', /media|content|news|entertainment|music|publishing|podcast|video|creator|film/],
    ['Consumer', /consumer|retail|e-?commerce|food|fashion|gaming|travel|social|marketplace|beauty/],
    ['Enterprise SaaS', /saas|enterprise|b2b|software|\bhr\b|sales|marketing|productivity|analytics|legal/],
  ];
  const first = (v) => (Array.isArray(v) ? v[0] : v);
  const label = (v) => (v && typeof v === 'object' ? v.name || v.label || v.value || '' : v || '');
  function sectorOf(p) {
    if (p.industry && SECTORS.some(([n]) => n === p.industry)) return p.industry;
    let tags = [].concat(p.categories || [], p.industry || []).map(label).join(' ').toLowerCase();
    if (!SECTORS.some(([, re]) => re.test(tags))) tags += ' ' + String(p.about || '').toLowerCase() + ' ' + String(p.summary || '').toLowerCase();
    if (!tags) return 'Other';
    const hit = SECTORS.find(([, re]) => re.test(tags));
    return hit ? hit[0] : 'Other';
  }
  // The company link may come back as an id, an object, a list, or a flattened slug.
  function companyIdOf(p) {
    const c = first(p.company);
    if (c && typeof c === 'object') return c.id || null;
    if (typeof c === 'string') return c;
    return p['company.id'] || p.company_id || null;
  }

  // Micro stores relationship strength as a label; the card shows a 0-100 bar.
  function strengthOf(v) {
    v = label(first(v));
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    const s = String(v).toLowerCase();
    const n = parseFloat(s);
    if (!isNaN(n)) return n <= 1 ? Math.round(n * 100) : Math.round(n);
    return /hot/.test(s) ? 95 : /warm/.test(s) ? 75 : /average/.test(s) ? 50 : /cool/.test(s) ? 30 : /cold/.test(s) ? 12 : /very strong|strongest/.test(s) ? 95 : /strong/.test(s) ? 80 : /medium|moderate|good/.test(s) ? 55 : /very weak|cold/.test(s) ? 12 : /weak/.test(s) ? 30 : null;
  }

  // Turn Micro-shaped responses into the game's model.
  function normalize(raw, now) {
    const companies = new Map();
    for (const o of raw.organizations.data) {
      const p = o.properties || {};
      companies.set(o.id, {
        id: o.id,
        name: p.name || p.primary_domain || 'Unknown Co',
        domain: p.primary_domain || null,
        industry: sectorOf(p) === 'Other' ? 'Downtown' : sectorOf(p),
        stage: label(first(p.stage)) || null,
        funding: p.funding_raised || null,
        employees: p.employee_count || null,
        logo: p.logo_url || p.logo || null,
        summary: p.summary || null,
        about: p.about || null,
        lastInteraction: p.last_interaction_date ? Date.parse(p.last_interaction_date) : 0,
        people: [],
      });
    }
    const people = [];
    // people are identities (one per real person); demo data still uses contacts
    for (const c of (raw.identities || raw.contacts).data) {
      const p = c.properties || {};
      const companyId = companyIdOf(p);
      const co = companies.get(companyId);
      if (!co) continue;
      const person = {
        id: c.id,
        name: p.full_name || p.email || 'Someone',
        title: p.title || '',
        email: p.email || null,
        linkedin: p.linkedin || null,
        summary: p.summary || null,
        about: p.about || null,
        strength: strengthOf(p.relationship_strength),
        lastInteraction: p.last_interaction_date ? Date.parse(p.last_interaction_date) : 0,
        company: co,
      };
      co.people.push(person);
      co.lastInteraction = Math.max(co.lastInteraction, person.lastInteraction);
      people.push(person);
    }
    const cutoff = now - 30 * DAY;
    const buildings = [...companies.values()].filter((c) => c.people.length && c.lastInteraction >= cutoff);
    for (const b of buildings) b.people.sort((a, b2) => b2.lastInteraction - a.lastInteraction);
    const walkers = people.slice().sort((a, b) => b.lastInteraction - a.lastInteraction).slice(0, 100);
    return { buildings, people, walkers };
  }

  async function load() {
    const now = Date.now();
    const real = new URLSearchParams(location.search).has('real');
    if (real) {
      const el = document.getElementById('loading');
      if (el) el.textContent = 'Pulling your network from Micro… the very first build can take a few minutes';
      let token = null;
      try { token = localStorage.getItem('netcity.token'); } catch { /* private mode */ }
      const res = await fetch('/api/city', { headers: token ? { 'x-netcity-token': token } : {} });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error('Could not load Micro data (' + res.status + '). ' + (body.error || ''));
      }
      const city = normalize(await res.json(), now);
      // route logos through the same-origin proxy so they can be painted into sprites
      for (const b of city.buildings) {
        if (!b.logo && !b.domain) continue;
        const q = new URLSearchParams();
        if (b.logo) q.set('u', b.logo);
        if (b.domain) q.set('d', b.domain);
        if (token) q.set('t', token);
        b.logo = '/api/logo?' + q;
      }
      return { ...city, now, demo: false };
    }
    return { ...normalize(mockRaw(now), now), now, demo: true };
  }

  window.NetCityData = { load, rng, DAY };
})();
