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

  // Turn Micro-shaped responses into the game's model.
  function normalize(raw, now) {
    const companies = new Map();
    for (const o of raw.organizations.data) {
      const p = o.properties || {};
      companies.set(o.id, {
        id: o.id,
        name: p.name || p.primary_domain || 'Unknown Co',
        domain: p.primary_domain || null,
        industry: p.industry || 'Other',
        stage: p.stage || null,
        funding: p.funding_raised || null,
        employees: p.employee_count || null,
        logo: p.logo_url || p.logo || null,
        lastInteraction: p.last_interaction_date ? Date.parse(p.last_interaction_date) : 0,
        people: [],
      });
    }
    const people = [];
    for (const c of raw.contacts.data) {
      const p = c.properties || {};
      const companyId = (p.company && p.company.id) || p['company.id'] || (typeof p.company === 'string' ? p.company : null);
      const co = companies.get(companyId);
      if (!co) continue;
      const person = {
        id: c.id,
        name: p.full_name || p.email || 'Someone',
        title: p.title || '',
        email: p.email || null,
        linkedin: p.linkedin || null,
        strength: p.relationship_strength ?? null,
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
      const res = await fetch('/api/city');
      if (!res.ok) throw new Error('Could not load Micro data (' + res.status + ')');
      return { ...normalize(await res.json(), now), now, demo: false };
    }
    return { ...normalize(mockRaw(now), now), now, demo: true };
  }

  window.NetCityData = { load, rng, DAY };
})();
