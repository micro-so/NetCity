// NetCity 2000 — city layout, rendering, street life, time of day, input.
(async function () {
  const S = window.Sprites;
  const { HW, HH, TH, mix } = S;
  const DAY = window.NetCityData.DAY;
  const rng = window.NetCityData.rng;

  const data = await window.NetCityData.load().catch((e) => {
    document.getElementById('loading').textContent = e.message;
    throw e;
  });
  const { buildings, walkers: walkerPeople, now } = data;

  // ---------- map ----------
  const MAP_IDS = ['default', 'sf', 'nyc'];
  const MAP_ID = (() => {
    const q = new URLSearchParams(location.search).get('map');
    let saved = null;
    try { saved = localStorage.getItem('netcity.map'); } catch { /* private mode */ }
    return MAP_IDS.includes(q) ? q : MAP_IDS.includes(saved) ? saved : 'default';
  })();
  // Bands of terrain outward from each side of the city grid: [type, width].
  // xmin = top-left edge, ymin = top-right, xmax = bottom-right, ymax = bottom-left.
  const MAPS = {
    default: { name: 'NetCity', aspect: 1, bands: { xmin: [['land', 4]], ymin: [['land', 4]], xmax: [['prom', 2], ['water', 8]], ymax: [['prom', 2], ['water', 8]] } },
    sf: { name: 'San Francisco', aspect: 1.1, bands: { xmin: [['prom', 1], ['water', 7], ['far', 4]], ymin: [['prom', 1], ['water', 7], ['far', 3]], xmax: [['land', 7]], ymax: [['land', 7]] } },
    nyc: { name: 'New York', aspect: 0.42, bands: { xmin: [['prom', 1], ['water', 5], ['far', 4]], xmax: [['prom', 1], ['water', 4], ['far', 5]], ymin: [['land', 3]], ymax: [['prom', 1], ['water', 9]] } },
  };
  const MAP = MAPS[MAP_ID];
  const bandW = (side) => MAP.bands[side].reduce((acc, [, w]) => acc + w, 0);
  const BX = bandW('xmin'), BY = bandW('ymin');

  // ---------- layout ----------
  // City = grid of 3x3-tile blocks (road row/col + 2x2 lot). Some blocks are reserved
  // (City Hall + statue plaza, landmarks, Central Park); industries fill the rest as
  // contiguous districts with their biggest buildings toward the middle.
  const groups = new Map();
  for (const b of buildings) {
    if (!groups.has(b.industry)) groups.set(b.industry, []);
    groups.get(b.industry).push(b);
  }
  const districts = [...groups.entries()]
    .map(([name, list]) => { list.sort((a, b) => b.people.length - a.people.length); return { name, list }; })
    .sort((a, b) => b.list.length - a.list.length);

  function reserve(BW, BH) {
    const res = new Map();
    let park = null;
    if (MAP_ID === 'nyc') {
      const i0 = BW >= 5 ? 1 : 0, i1 = BW >= 5 ? BW - 2 : BW - 1;
      park = { i0, i1, j0: 1, j1: Math.min(BH - 3, Math.max(2, Math.round(BH * 0.24))) };
      for (let j = park.j0; j <= park.j1; j++) for (let i = i0; i <= i1; i++) res.set(i + ',' + j, 'park');
    }
    const hi = Math.max(0, Math.min(BW - 2, Math.floor(BW / 2) - 1));
    let hj = Math.floor((BH - 1) / 2);
    if (park && hj <= park.j1 + 1) hj = Math.min(BH - 1, park.j1 + 2);
    res.set(hi + ',' + hj, 'hall'); res.set(hi + 1 + ',' + hj, 'plaza');
    const marks = [];
    const put = (tag, i, j) => {
      for (let k = 0; k < BW * BH; k++) {
        const ii = ((i + k) % BW + BW) % BW, jj = Math.min(BH - 1, j + Math.floor((i + k) / BW));
        if (!res.has(ii + ',' + jj)) { res.set(ii + ',' + jj, tag); marks.push({ tag, i: ii, j: jj }); return; }
      }
    };
    if (MAP_ID === 'sf') put('transamerica', BW - 2, 0);
    if (MAP_ID === 'nyc') { put('empire', Math.floor(BW / 2), Math.min(BH - 2, hj + 3)); put('wtc', 0, BH - 1); }
    return { res, park, hall: [hi, hj], plaza: [hi + 1, hj], marks };
  }

  const nB = buildings.length;
  const cityBW = Math.max(4, Math.round(Math.sqrt(nB * 1.08 * MAP.aspect)));
  let cityBH = Math.max(4, Math.ceil(nB / cityBW)), plan;
  for (;; cityBH++) { plan = reserve(cityBW, cityBH); if (cityBW * cityBH - plan.res.size >= Math.ceil(nB * 1.06)) break; }
  const cityW = cityBW * 3 + 1, cityH = cityBH * 3 + 1;

  // snake through strips of three block-rows so districts come out compact
  const order = [];
  for (let st = 0; st * 3 < cityBH; st++) {
    const cols = [...Array(cityBW).keys()];
    if (st % 2) cols.reverse();
    for (const i of cols) for (let j = st * 3; j < Math.min(cityBH, st * 3 + 3); j++) if (!plan.res.has(i + ',' + j)) order.push([i, j]);
  }
  const lotKey = (i, j) => (BX + i * 3 + 1) + ',' + (BY + j * 3 + 1);
  const lotDistrict = new Map(), lotBuilding = new Map();
  const slack = order.length - nB;
  let cursor = 0;
  districts.forEach((d, di) => {
    const take = di === districts.length - 1 ? order.length - cursor : d.list.length + Math.floor((slack * d.list.length) / nB);
    const lots = order.slice(cursor, cursor + take);
    cursor += take;
    const mx = lots.reduce((a, l) => a + l[0], 0) / lots.length, my = lots.reduce((a, l) => a + l[1], 0) / lots.length;
    lots.sort((a, b) => Math.hypot(a[0] - mx, a[1] - my) - Math.hypot(b[0] - mx, b[1] - my));
    lots.forEach(([i, j], k) => {
      const key = lotKey(i, j);
      lotDistrict.set(key, d);
      const b = d.list[k];
      if (b) { b.lx = BX + i * 3 + 1; b.ly = BY + j * 3 + 1; lotBuilding.set(key, b); }
    });
    d.cx = BX + mx * 3 + 1.5;
    d.top = BY + Math.min(...lots.map((l) => l[1])) * 3;
  });

  // ---------- civic center & landmarks ----------
  const hallLot = [BX + plan.hall[0] * 3 + 1, BY + plan.hall[1] * 3 + 1];
  const plazaLot = [BX + plan.plaza[0] * 3 + 1, BY + plan.plaza[1] * 3 + 1];
  const civicKeys = new Set([hallLot.join(','), plazaLot.join(',')]);
  const landmarkLots = plan.marks.map((m) => ({ tag: m.tag, lx: BX + m.i * 3 + 1, ly: BY + m.j * 3 + 1 }));
  const markKeys = new Set(landmarkLots.map((m) => m.lx + ',' + m.ly));
  const park = plan.park && { x0: BX + plan.park.i0 * 3 + 1, x1: BX + plan.park.i1 * 3 + 2, y0: BY + plan.park.j0 * 3 + 1, y1: BY + plan.park.j1 * 3 + 2 };
  const inPark = (x, y) => !!park && x >= park.x0 && x <= park.x1 && y >= park.y0 && y <= park.y1;

  // ---------- terrain ----------
  const MW = BX + cityW + bandW('xmax'), MH = BY + cityH + bandW('ymax');
  const inCity = (x, y) => x >= BX && y >= BY && x < BX + cityW && y < BY + cityH;
  const isRoad = (x, y) => inCity(x, y) && !inPark(x, y) && ((x - BX) % 3 === 0 || (y - BY) % 3 === 0);
  const PRI = { far: 4, water: 3, prom: 2, land: 1 };
  const bandAt = (side, dist) => { let acc = 0; for (const [t, w] of MAP.bands[side]) { if (dist < acc + w) return t; acc += w; } return 'land'; };
  const tKind = new Array(MW * MH), tSide = new Array(MW * MH);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    let best = inCity(x, y) ? 'city' : null, side = null;
    const cand = (sd, dist) => { const t = bandAt(sd, dist); if (!best || PRI[t] > PRI[best]) { best = t; side = sd; } };
    if (best !== 'city') {
      if (x < BX) cand('xmin', BX - 1 - x);
      if (x >= BX + cityW) cand('xmax', x - BX - cityW);
      if (y < BY) cand('ymin', BY - 1 - y);
      if (y >= BY + cityH) cand('ymax', y - BY - cityH);
    }
    tKind[y * MW + x] = best; tSide[y * MW + x] = side;
  }
  const kindAt = (x, y) => (x < 0 || y < 0 || x >= MW || y >= MH ? 'void' : tKind[y * MW + x]);
  const sideAt = (x, y) => tSide[y * MW + x];
  const isWater = (x, y) => kindAt(x, y) === 'water';
  // distance from shore, for water depth
  const wdist = new Array(MW * MH).fill(0);
  {
    const q = [];
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) if (!isWater(x, y)) q.push([x, y]); else wdist[y * MW + x] = 99;
    for (let h = 0; h < q.length; h++) {
      const [x, y] = q[h], dd = wdist[y * MW + x];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue;
        if (wdist[ny * MW + nx] > dd + 1) { wdist[ny * MW + nx] = dd + 1; q.push([nx, ny]); }
      }
    }
  }

  // bridges, islands and hills per map
  const bridgeSpecs = [];
  if (MAP_ID === 'sf') {
    bridgeSpecs.push({ style: 'golden', axis: 'x', x: 2, y: BY + 3, len: BX - 2 });
    bridgeSpecs.push({ style: 'bay', axis: 'y', x: BX + 3 * (cityBW - 2), y: 1, len: BY - 1 });
  }
  if (MAP_ID === 'nyc') bridgeSpecs.push({ style: 'brooklyn', axis: 'x', x: BX + cityW, y: BY + 3 * (cityBH - 2), len: 7 });
  const onBridge = (x, y) => bridgeSpecs.some((b) => (b.axis === 'x' ? y === b.y && x >= b.x && x < b.x + b.len : x === b.x && y >= b.y && y < b.y + b.len));
  const islands = MAP_ID === 'sf' ? [{ kind: 'alcatraz', x: BX + Math.floor(cityW * 0.4), y: BY - 5 }]
    : MAP_ID === 'nyc' ? [{ kind: 'liberty', x: BX + 2, y: BY + cityH + 5 }] : [];
  const hills = MAP_ID === 'sf' ? [
    { x: BX + cityW + 3.5, y: BY + cityH * 0.55, rx: 44, h: 26, sutro: true },
    { x: BX + cityW * 0.4, y: BY + cityH + 3.5, rx: 40, h: 22 },
    { x: BX + cityW + 3.5, y: BY + cityH + 3.5, rx: 36, h: 18 },
    { x: 1.8, y: BY + 8, rx: 34, h: 24, dry: true }, { x: 1.6, y: BY + cityH * 0.6, rx: 38, h: 28, dry: true },
  ] : [];
  const nearHill = (x, y) => hills.some((h) => Math.hypot(x + 0.5 - h.x, y + 0.5 - h.y) < h.rx / 16 + 0.6);

  // ---------- world space ----------
  const TOP = 280, DEPTH = 30;
  const OX = MH * HW, OY = TOP;
  const WW = (MW + MH) * HW, WH = (MW + MH) * HH + TOP + DEPTH + 40;
  const toWorld = (tx, ty) => [OX + (tx - ty) * HW, OY + (tx + ty) * HH];
  // For every pixel of a tile diamond, its position inside the tile (u, v in 0..1).
  function paintTile(g, x, y, fn) {
    const [sx, sy] = toWorld(x, y);
    S.diamondFn(g, sx, sy, (px, py, r, k) => {
      const a = (k + 0.5) / HW, b = (r + 0.5) / HH;
      return fn((a + b) / 2, (b - a) / 2, px, py);
    });
  }
  const noise = (x, y, s = 0) => { let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

  // District paving: each industry has its own ground material.
  const PAVING = {
    'Venture Capital': ['#e6dcc6', '#cbbd9f', 0.34],
    'AI / ML': ['#595d6e', '#474a59', 0.5],
    'Fintech': ['#d7dcdc', '#b9c0c1', 0.5],
    'Developer Tools': ['#9a8f84', '#7d736a', 0.2],
    'Healthcare': ['#eceeea', '#d3d7d3', 0.5],
    'Consumer': ['#dd9f7c', '#c4876a', 0.25],
    'Climate': ['#7fb35a', '#6a9c4a', 1],
    'Enterprise SaaS': ['#bdbab2', '#a5a29a', 0.5],
    'Media': ['#9a5a52', '#7f4842', 0.2],
    'Crypto': ['#3a3a44', '#ff8b2e', 0.5],
  };

  // ---------- ground ----------
  const ground = document.createElement('canvas');
  ground.width = WW; ground.height = WH;
  const gg = ground.getContext('2d');
  const R = rng(7);
  const statics = [];
  const treeCache = {};
  const tree = (kind) => {
    const k = kind + (Math.floor(R() * 3));
    return treeCache[k] || (treeCache[k] = S.makeTree(kind, S.hash(k)));
  };
  const addStatic = (sprite, tx, ty, depthBias = 0) => {
    const [x, y] = toWorld(tx, ty);
    statics.push({ x, y, depth: tx + ty + depthBias, sp: sprite, px: tx, py: ty });
  };
  const fillerCache = {};
  const fillerSprite = (kind) => { const k = kind + Math.floor(R() * 6); return fillerCache[k] || (fillerCache[k] = S.makeFiller(kind, S.hash(k))); };
  const pickTree = () => { const q = R(); return q < 0.34 ? 'oak' : q < 0.58 ? 'lime' : q < 0.84 ? 'cherry' : 'autumn'; };
  const lamp = S.makeLamp(), bench = S.makeBench(), fountain = S.makeFountain();
  const lamps = [];

  // island drop shadow
  {
    const [ax, ay] = toWorld(0, 0), [bx, by] = toWorld(MW, 0), [cx2, cy2] = toWorld(MW, MH), [dx, dy] = toWorld(0, MH);
    gg.save();
    gg.filter = 'blur(18px)';
    gg.fillStyle = 'rgba(30,34,60,.28)';
    gg.beginPath(); gg.moveTo(ax, ay + 40); gg.lineTo(bx + 10, by + 40); gg.lineTo(cx2, cy2 + DEPTH + 30); gg.lineTo(dx - 10, dy + 40); gg.closePath(); gg.fill();
    gg.restore();
  }

  const parkKind = new Map();
  for (let y = 0; y < MH; y++) {
    for (let x = 0; x < MW; x++) {
      const kd = kindAt(x, y);
      if (kd === 'water') {
        const deep = mix('#5aa3c4', '#2d6590', Math.min(1, (wdist[y * MW + x] - 1) / 5));
        const nL = x > 0 && !isWater(x - 1, y), nR = x < MW - 1 && !isWater(x + 1, y), nU = y > 0 && !isWater(x, y - 1), nD = y < MH - 1 && !isWater(x, y + 1);
        paintTile(gg, x, y, (u, v, px, py) => {
          const n = noise(px, py, 3);
          if (((nL && u < 0.12) || (nR && u > 0.88) || (nU && v < 0.12) || (nD && v > 0.88)) && n < 0.6) return '#dff1f7';
          if (n > 0.985) return mix(deep, '#ffffff', 0.35);
          if ((Math.floor(px / 3) + py) % 9 === 0 && n > 0.7) return mix(deep, '#ffffff', 0.12);
          return deep;
        });
        continue;
      }
      if (kd === 'prom') {
        const wL = isWater(x - 1, y), wR = isWater(x + 1, y), wU = isWater(x, y - 1), wD = isWater(x, y + 1);
        paintTile(gg, x, y, (u, v, px, py) => {
          if ((wL && u < 0.14) || (wR && u > 0.86) || (wU && v < 0.14) || (wD && v > 0.86)) return '#8d8475';
          const gu = (u * 4) % 1, gv = (v * 4) % 1;
          if (gu < 0.08 || gv < 0.08) return '#c4b9a4';
          return noise(px, py) < 0.1 ? '#e6dcc8' : '#dbd0bb';
        });
        if (onBridge(x, y)) continue;
        const front = wL || wR || wU || wD;
        const ex = wR ? 0.78 : wL ? 0.22 : 0.5, ey = wD ? 0.78 : wU ? 0.22 : 0.5;
        if (front && (x + y) % 2 === 0) { addStatic(lamp, x + ex, y + ey); lamps.push([x + ex, y + ey]); }
        else if (front && (x + y) % 4 === 1) addStatic(bench, x + 0.3, y + 0.3);
        else if (!front && (x + y) % 3 === 0) addStatic(tree('cypress'), x + 0.5, y + 0.5);
        continue;
      }
      if (kd !== 'city') {
        const sd = sideAt(x, y);
        const dry = MAP_ID === 'sf' && kd === 'far' && sd === 'xmin';
        paintTile(gg, x, y, (u, v, px, py) => {
          const n = noise(px, py, 1);
          if (dry) return n < 0.3 ? '#b39f55' : n < 0.36 ? '#6f7a3a' : '#c2ad62';
          if (n > 0.992) return ['#f2e6a0', '#f0b6c8', '#ffffff'][Math.floor(n * 1000) % 3];
          return n < 0.3 ? '#528f36' : n < 0.36 ? '#6aa84a' : '#5c9a3d';
        });
        if (onBridge(x, y) || nearHill(x, y)) continue;
        const filler = MAP_ID === 'sf' ? (kd === 'land' ? 'house' : sd === 'ymin' ? (R() < 0.5 ? 'warehouse' : 'house') : null)
          : MAP_ID === 'nyc' ? (kd === 'far' && sd === 'xmin' ? (R() < 0.35 ? 'tower' : 'warehouse') : 'brownstone') : null;
        if (filler && R() < (dry ? 0 : 0.62)) addStatic(fillerSprite(filler), x, y, 1);
        else if (R() < (dry ? 0.12 : 0.5)) addStatic(tree(dry ? 'cypress' : R() < 0.5 ? 'pine' : R() < 0.5 ? 'oak' : 'cypress'), x + 0.25 + R() * 0.5, y + 0.25 + R() * 0.5);
        continue;
      }
      if (inPark(x, y)) {
        const pcx = (park.x0 + park.x1 + 1) / 2, pcy = (park.y0 + park.y1 + 1) / 2;
        const prx = (park.x1 - park.x0 + 1) * 0.22, pry = (park.y1 - park.y0 + 1) * 0.16;
        let lake = false;
        paintTile(gg, x, y, (u, v, px, py) => {
          const X = x + u, Y = y + v, n = noise(px, py, 12);
          const e = ((X - pcx) / prx) ** 2 + ((Y - pcy) / pry) ** 2;
          if (e < 1) { lake = true; return e > 0.82 ? '#d9cfa8' : n > 0.985 ? '#bfe3f0' : '#5da6c6'; }
          if (Math.abs(Math.sin(X * 0.9) * 1.6 + pcy - Y) < 0.1 || Math.abs(Math.sin(Y * 0.7) * 1.4 + pcx - 2 - X) < 0.1) return '#d9ccab';
          if (n > 0.995) return '#9a948a';
          return n < 0.25 ? '#63a444' : '#6aad4a';
        });
        if (!lake && R() < 0.42) addStatic(tree(R() < 0.25 ? 'autumn' : R() < 0.5 ? 'oak' : 'lime'), x + 0.2 + R() * 0.6, y + 0.2 + R() * 0.6);
        continue;
      }
      if (isRoad(x, y)) {
        const ax = (x - BX) % 3 === 0, ay = (y - BY) % 3 === 0;
        paintTile(gg, x, y, (u, v, px, py) => {
          const n = noise(px, py, 2);
          const side = '#cfc6b4', curb = '#9a9282';
          const asphalt = n < 0.08 ? '#4f5157' : n > 0.96 ? '#686a70' : '#5a5c62';
          if (ax && ay) {
            if ((u < 0.14 || u > 0.86) && (v < 0.14 || v > 0.86)) return side;
            const inU = u > 0.14 && u < 0.86, inV = v > 0.14 && v < 0.86;
            if (inV && (u < 0.26 || u > 0.74) && Math.floor(v * 12) % 2 === 0) return '#ecebe4';
            if (inU && (v < 0.26 || v > 0.74) && Math.floor(u * 12) % 2 === 0) return '#ecebe4';
            return asphalt;
          }
          const across = ay ? v : u, along = ay ? u : v;
          if (across < 0.14 || across > 0.86) return (across > 0.12 && across < 0.14) || (across > 0.86 && across < 0.88) ? curb : side;
          if (Math.abs(across - 0.5) < 0.035 && (along * 3) % 1 < 0.55) return '#e8cf5a';
          return asphalt;
        });
        if (ax && ay && (x + y) % 2 === 0) { addStatic(lamp, x + 0.9, y + 0.9); lamps.push([x + 0.9, y + 0.9]); }
        continue;
      }
      // lot tile
      const lx = BX + Math.floor((x - BX) / 3) * 3 + 1, ly = BY + Math.floor((y - BY) / 3) * 3 + 1;
      const key = lx + ',' + ly;
      const d = lotDistrict.get(key), b = lotBuilding.get(key);
      if (civicKeys.has(key) || markKeys.has(key)) {
        const isHall = key !== plazaLot.join(',');
        paintTile(gg, x, y, (u, v, px, py) => {
          const U = x - lx + u, V = y - ly + v;
          if (U < 0.06 || V < 0.06 || U > 1.94 || V > 1.94) return '#a79f90';
          if (!isHall) {
            const rr = Math.hypot(U - 1, V - 1);
            if (rr > 0.55 && rr < 0.62) return '#c8b99a';
            if (rr <= 0.55) return Math.floor(Math.atan2(V - 1, U - 1) * 4) % 2 ? '#efe7d6' : '#e2d7c1';
          }
          const g1 = (U * 5) % 1, g2 = (V * 5) % 1;
          if (g1 < 0.06 || g2 < 0.06) return '#d3c7af';
          return noise(px, py, 6) < 0.08 ? '#f3ecdc' : '#e9e0cc';
        });
        if (!isHall && x === lx && y === ly) {
          for (const [a, c] of [[0.2, 0.2], [1.8, 0.2], [0.2, 1.8], [1.8, 1.8]]) addStatic(tree('cypress'), lx + a, ly + c);
          addStatic(bench, lx + 0.25, ly + 1.1); addStatic(bench, lx + 1.2, ly + 0.2);
          addStatic(lamp, lx + 0.5, ly + 1.55); lamps.push([lx + 0.5, ly + 1.55]);
          addStatic(lamp, lx + 1.55, ly + 0.5); lamps.push([lx + 1.55, ly + 0.5]);
        }
        continue;
      }
      if (b) {
        const [c1, c2, grid] = PAVING[d.name] || ['#c9c4b8', '#aaa598', 0.5];
        paintTile(gg, x, y, (u, v, px, py) => {
          const U = x - lx + u, V = y - ly + v;
          if (U < 0.06 || V < 0.06 || U > 1.94 || V > 1.94) return '#a79f90';
          const g1 = (U / grid) % 1, g2 = (V / grid) % 1;
          if (grid < 1 && (g1 < 0.07 || g2 < 0.07)) return c2;
          return noise(px, py, 4) < 0.08 ? mix(c1, '#ffffff', 0.15) : c1;
        });
        continue;
      }
      // park
      if (!parkKind.has(key)) { const q = noise(lx, ly, 9); parkKind.set(key, q < 0.36 ? 0 : q < 0.58 ? 1 : q < 0.78 ? 2 : q < 0.92 ? 3 : 4); }
      const kind = parkKind.get(key);
      paintTile(gg, x, y, (u, v, px, py) => {
        const U = x - lx + u, V = y - ly + v, n = noise(px, py, 5);
        if (U < 0.06 || V < 0.06 || U > 1.94 || V > 1.94) return '#a79f90';
        if (kind === 1) { const g1 = (U * 3) % 1, g2 = (V * 3) % 1; return g1 < 0.06 || g2 < 0.06 ? '#cfc4ad' : '#e4dac4'; }
        if (kind === 2 && (Math.abs(U - V) < 0.14 || Math.abs(U + V - 2) < 0.14)) return n < 0.3 ? '#cbbd98' : '#d9ccab';
        if (kind === 3) { const r2 = (U - 1) ** 2 + (V - 1) ** 2; if (r2 < 0.32) return r2 > 0.26 ? '#d9cfa8' : n > 0.97 ? '#bfe3f0' : '#5da6c6'; }
        if (kind === 4 && U > 0.3 && U < 1.7 && V > 0.2 && V < 1.8) {
          if (Math.abs(U - 0.3) < 0.04 || Math.abs(U - 1.7) < 0.04 || Math.abs(V - 0.2) < 0.04 || Math.abs(V - 1.8) < 0.04 || Math.abs(V - 1) < 0.03 || Math.abs(U - 1) < 0.02) return '#f2f2ec';
          return V < 1 ? '#4f8f5a' : '#48845a';
        }
        return n < 0.25 ? '#63a444' : n > 0.985 ? '#f3e7a8' : '#6aad4a';
      });
      if (x === lx && y === ly) {
        if (kind === 0) { const nT = 3 + Math.floor(R() * 3); for (let i = 0; i < nT; i++) addStatic(tree(pickTree()), lx + 0.3 + R() * 1.4, ly + 0.3 + R() * 1.4); addStatic(bench, lx + 0.8, ly + 1.5); }
        if (kind === 1) { addStatic(fountain, lx + 0.5, ly + 0.5, 0.5); addStatic(tree(pickTree()), lx + 0.25, ly + 0.25); addStatic(tree(pickTree()), lx + 1.75, ly + 1.75); addStatic(bench, lx + 1.4, ly + 0.2); }
        if (kind === 2) { addStatic(tree(pickTree()), lx + 1.6, ly + 0.4); addStatic(tree(pickTree()), lx + 0.4, ly + 1.6); addStatic(lamp, lx + 1, ly + 1); lamps.push([lx + 1, ly + 1]); }
        if (kind === 3) { addStatic(tree('lime'), lx + 0.3, ly + 0.3); addStatic(tree('cherry'), lx + 1.7, ly + 0.4); addStatic(bench, lx + 1.3, ly + 1.65); }
        if (kind === 4) { addStatic(tree('oak'), lx + 1.85, ly + 0.15); }
      }
    }
  }

  // ---------- buildings ----------
  await S.loadLogos(buildings);
  for (const b of buildings) {
    b.sprite = S.makeBuilding(b);
    const [x, y] = toWorld(b.lx, b.ly);
    b.wx = x; b.wy = y;
    b.depth = b.lx + b.ly + 2;
    b.foot = [b.lx, b.ly, b.lx + 2, b.ly + 2];
  }

  const hall = { civic: 'hall', sp: S.makeCityHall() };
  [hall.x, hall.y] = toWorld(hallLot[0], hallLot[1]);
  hall.depth = hallLot[0] + hallLot[1] + 2;
  hall.foot = [hallLot[0], hallLot[1], hallLot[0] + 2, hallLot[1] + 2];
  const statue = { civic: 'statue', sp: null };
  [statue.x, statue.y] = toWorld(plazaLot[0] + 0.5, plazaLot[1] + 0.5);
  statue.depth = plazaLot[0] + plazaLot[1] + 2;
  statue.px = plazaLot[0] + 1; statue.py = plazaLot[1] + 1;
  const setStatue = (bust) => { statue.sp = S.makeStatue(bust || S.bronzeBust(null)); };
  setStatue(window.Civic && window.Civic.savedBust());
  const LANDMARK_NAMES = { transamerica: 'Transamerica Pyramid', empire: 'Empire State Building', wtc: 'One World Trade Center' };
  const landmarks = landmarkLots.map((m) => {
    const o = { civic: 'landmark', name: LANDMARK_NAMES[m.tag], sp: S.makeLandmark(m.tag), lx: m.lx, ly: m.ly };
    [o.x, o.y] = toWorld(m.lx, m.ly);
    o.depth = m.lx + m.ly + 2;
    o.foot = [m.lx, m.ly, m.lx + 2, m.ly + 2];
    return o;
  });
  const civics = [hall, statue, ...landmarks];
  // bridges are sliced per tile so they depth-sort with boats and trees
  for (const b of bridgeSpecs) {
    const sp = S.makeBridge(b.len, b.axis, b.style);
    const [wx, wy] = toWorld(b.x, b.y);
    for (let k = 0; k < b.len; k++) {
      const cxr = b.axis === 'x' ? k * HW : -k * HW;
      let p0 = Math.round(sp.ox + cxr - HW / 2), p1 = Math.round(sp.ox + cxr + HW / 2);
      const first = k === 0, last = k === b.len - 1;
      if (b.axis === 'x') { if (first) p0 = 0; if (last) p1 = sp.w; } else { if (first) p1 = sp.w; if (last) p0 = 0; }
      p0 = Math.max(0, p0); p1 = Math.min(sp.w, p1);
      if (p1 <= p0) continue;
      const cut = (src) => { const c = document.createElement('canvas'); c.width = p1 - p0; c.height = sp.h; c.getContext('2d').drawImage(src, -p0, 0); return c; };
      const piece = { day: cut(sp.day), night: cut(sp.night), ox: sp.ox - p0, oy: sp.oy, w: p1 - p0, h: sp.h };
      statics.push({ x: wx, y: wy, sp: piece, depth: (b.axis === 'x' ? b.x + k + b.y : b.x + b.y + k) + 1.1 });
    }
  }
  for (const isl of islands) addStatic(S.makeIsland(isl.kind), isl.x + 0.5, isl.y + 0.5, 0.5);
  for (const h of hills) addStatic(S.makeHill(h.rx, h.h, S.hash(h.x + ',' + h.y), h.sutro, h.dry), h.x, h.y, 1.5);

  // ---------- cast shadows (cool, crisp) ----------
  {
    const sh = document.createElement('canvas');
    sh.width = WW; sh.height = WH;
    const sg = sh.getContext('2d');
    sg.fillStyle = '#000';
    const hull = (pts) => {
      pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const lo = [], hi = [];
      for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
      for (const p of pts.slice().reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
      return lo.slice(0, -1).concat(hi.slice(0, -1));
    };
    const shadowOf = (x0, y0, x1, y1, h) => {
      const L = h * 0.62, vx = L * 0.894, vy = -L * 0.447;
      const corners = [toWorld(x0, y0), toWorld(x1, y0), toWorld(x1, y1), toWorld(x0, y1)];
      const pts = hull(corners.concat(corners.map(([a, b]) => [a + vx, b + vy])));
      sg.beginPath(); pts.forEach(([a, b], i) => (i ? sg.lineTo(a, b) : sg.moveTo(a, b))); sg.closePath(); sg.fill();
    };
    for (const b of buildings) {
      const f = b.sprite.foot;
      shadowOf(b.lx + f.tx0, b.ly + f.ty0, b.lx + f.tx1, b.ly + f.ty1, f.top);
    }
    for (const m of landmarks) { const f = m.sp.foot; shadowOf(m.lx + f.tx0, m.ly + f.ty0, m.lx + f.tx1, m.ly + f.ty1, f.top); }
    { const f = hall.sp.foot; shadowOf(hallLot[0] + f.tx0, hallLot[1] + f.ty0, hallLot[0] + f.tx1, hallLot[1] + f.ty1, 60); }
    shadowOf(plazaLot[0] + 0.7, plazaLot[1] + 0.7, plazaLot[0] + 1.3, plazaLot[1] + 1.3, 36);
    for (const s of statics) if (s.sp.day.height > 20 && s.sp.day.width < 30) {
      sg.beginPath(); sg.ellipse(s.x + 6, s.y - 2, 7, 3, 0, 0, Math.PI * 2); sg.fill();
    }
    const img = sg.getImageData(0, 0, WW, WH), d = img.data;
    for (let i = 3; i < d.length; i += 4) {
      const on = d[i] > 110;
      d[i - 3] = 30; d[i - 2] = 42; d[i - 1] = 88; d[i] = on ? 255 : 0;
    }
    sg.putImageData(img, 0, 0);
    // don't shade water too much, and never the void
    gg.save();
    gg.globalCompositeOperation = 'source-atop';
    gg.globalAlpha = 0.26;
    gg.drawImage(sh, 0, 0);
    gg.restore();
  }

  // ---------- diorama cut-away sides ----------
  {
    const strata = (g, x, top, lit, waterCol) => {
      let y = top;
      const band = (h, c) => { g.fillStyle = lit ? c : mix(c, '#1b2140', 0.35); g.fillRect(x, y, 1, h); y += h; };
      if (waterCol) { band(4, waterCol); band(2, '#2a5b80'); }
      else band(3, '#4f8a33');
      band(5, '#8a6440'); band(7, '#6f4f33');
      band(DEPTH - (y - top), '#4d3a2c');
      if (noise(x, top, 8) > 0.8) { g.fillStyle = lit ? '#9a8a78' : '#5a5260'; g.fillRect(x, top + 14 + Math.floor(noise(x, 1) * 10), 2, 1); }
    };
    // front-left face (along y = MH)
    for (let tx = 0; tx < MW; tx++) {
      const [x0, y0] = toWorld(tx, MH), [x1] = toWorld(tx + 1, MH);
      const water = isWater(tx, MH - 1) ? '#3f86ad' : null;
      for (let x = x0; x < x1; x++) strata(gg, x, Math.round(y0 + (x - x0) / 2), true, water);
    }
    // front-right face (along x = MW)
    for (let ty = 0; ty < MH; ty++) {
      const [x0, y0] = toWorld(MW, ty + 1), [x1] = toWorld(MW, ty);
      const water = isWater(MW - 1, ty) ? '#3f86ad' : null;
      for (let x = x0; x < x1; x++) strata(gg, x, Math.round(y0 - (x - x0) / 2), false, water);
    }
  }

  // night ground: tinted + lamp light pools
  const groundNight = S.nightify(ground, null);
  {
    const ng = groundNight.getContext('2d');
    ng.globalCompositeOperation = 'lighter';
    for (const [tx, ty] of lamps) {
      const [x, y] = toWorld(tx, ty);
      const grad = ng.createRadialGradient(x, y, 0, x, y, 22);
      grad.addColorStop(0, 'rgba(255,196,110,.42)'); grad.addColorStop(1, 'rgba(255,196,110,0)');
      ng.fillStyle = grad;
      ng.save(); ng.translate(x, y); ng.scale(1, 0.5); ng.translate(-x, -y);
      ng.beginPath(); ng.arc(x, y, 22, 0, Math.PI * 2); ng.fill(); ng.restore();
    }
    // window light spill around buildings
    for (const b of buildings) {
      const [x, y] = toWorld(b.lx + 1, b.ly + 1);
      const grad = ng.createRadialGradient(x, y + 10, 0, x, y + 10, 30);
      grad.addColorStop(0, 'rgba(255,190,120,.16)'); grad.addColorStop(1, 'rgba(255,190,120,0)');
      ng.fillStyle = grad; ng.fillRect(x - 32, y - 20, 64, 60);
    }
  }

  // ---------- street life ----------
  const roadTiles = [];
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) if (isRoad(x, y)) roadTiles.push([x, y]);
  const wr = rng(42);
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function mover(o) {
    const t = roadTiles[Math.floor(wr() * roadTiles.length)];
    return Object.assign({ tx: t[0], ty: t[1], nx: t[0], ny: t[1], prog: 1, dir: [0, 0], target: null, fx: t[0] + 0.5, fy: t[1] + 0.5 }, o);
  }
  function step(w, dt, pickTarget, laneFn) {
    w.prog += dt * w.speed;
    while (w.prog >= 1) {
      w.prog -= 1;
      w.tx = w.nx; w.ty = w.ny;
      if (!w.target || Math.abs(w.tx - w.target[0]) + Math.abs(w.ty - w.target[1]) <= 1) w.target = pickTarget(w);
      const opts = DIRS.filter(([dx, dy]) => isRoad(w.tx + dx, w.ty + dy) && !(dx === -w.dir[0] && dy === -w.dir[1]));
      const choices = opts.length ? opts : DIRS.filter(([dx, dy]) => isRoad(w.tx + dx, w.ty + dy));
      let dir;
      if (wr() < 0.75) {
        dir = choices.reduce((best, d) => {
          const dist = Math.abs(w.tx + d[0] - w.target[0]) + Math.abs(w.ty + d[1] - w.target[1]);
          return !best || dist < best.dist ? { d, dist } : best;
        }, null).d;
      } else dir = choices[Math.floor(wr() * choices.length)];
      w.dir = dir; w.nx = w.tx + dir[0]; w.ny = w.ty + dir[1];
    }
    const fx = w.tx + (w.nx - w.tx) * w.prog, fy = w.ty + (w.ny - w.ty) * w.prog;
    const [ox, oy] = laneFn(w);
    w.fx = fx + 0.5 + ox; w.fy = fy + 0.5 + oy;
  }
  const randomRoad = () => roadTiles[Math.floor(wr() * roadTiles.length)];

  const walkers = walkerPeople.map((p) => mover({
    person: p, frames: S.makeWalker(p), side: wr() < 0.5 ? -1 : 1,
    speed: 0.7 + wr() * 0.6, phase: wr() * 10,
    home: p.company.lx != null ? [p.company.lx - 1, p.company.ly - 1] : null,
  }));
  const walkerTarget = (w) => (w.home && wr() < 0.55 ? [w.home[0] + (wr() < 0.5 ? 0 : 3), w.home[1] + (wr() < 0.5 ? 0 : 3)] : randomRoad());
  const walkerLane = (w) => [w.dir[1] ? w.side * 0.39 : 0, w.dir[0] ? w.side * 0.39 : 0];

  const carSprites = {};
  const carSprite = (c, axis) => { const k = c.color + axis + c.variant; return carSprites[k] || (carSprites[k] = S.makeCar(c.color, axis, c.variant)); };
  const cars = Array.from({ length: Math.min(60, Math.round(roadTiles.length / 14)) }, () => mover({
    color: S.pickR(wr, S.CAR_COLORS), speed: 1.6 + wr() * 1.2,
    variant: MAP_ID === 'nyc' && wr() < 0.55 ? 'taxi' : MAP_ID === 'sf' && wr() < 0.35 ? 'waymo' : null,
  }));
  const carLane = (c) => [c.dir[1] ? (c.dir[1] > 0 ? -0.17 : 0.17) : 0, c.dir[0] ? (c.dir[0] > 0 ? 0.17 : -0.17) : 0];

  // boats sail back and forth along straight runs of open water
  const runs = [];
  for (let y = 0; y < MH; y++) { let st = -1; for (let x = 0; x <= MW; x++) { const ok = x < MW && isWater(x, y) && wdist[y * MW + x] >= 2; if (ok && st < 0) st = x; if (!ok && st >= 0) { if (x - st >= 6) runs.push({ alongX: true, lane: y + 0.5, a: st + 0.5, b: x - 0.5 }); st = -1; } } }
  for (let x = 0; x < MW; x++) { let st = -1; for (let y = 0; y <= MH; y++) { const ok = y < MH && isWater(x, y) && wdist[y * MW + x] >= 2; if (ok && st < 0) st = y; if (!ok && st >= 0) { if (y - st >= 6) runs.push({ alongX: false, lane: x + 0.5, a: st + 0.5, b: y - 0.5 }); st = -1; } } }
  const boats = runs.length ? [0, 1, 2, 3, 4].map((i) => {
    const run = runs[Math.floor(wr() * runs.length)];
    return { sp: S.makeBoat(i + 5), ...run, pos: run.a + wr() * (run.b - run.a), speed: (0.12 + wr() * 0.15) * (wr() < 0.5 ? -1 : 1) };
  }) : [];

  const sparkles = [];
  for (let i = 0; i < 420; i++) {
    const x = wr() * MW, y = wr() * MH;
    if (isWater(Math.floor(x), Math.floor(y))) sparkles.push([...toWorld(x, y), wr() * 20, 1 + wr() * 2]);
  }

  // ---------- whales ----------
  const deepWater = [];
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    if (isWater(x, y) && wdist[y * MW + x] >= 3 && !onBridge(x, y)) deepWater.push([x, y]);
  }
  let whalesOn = true;
  const whales = [0, 1, 2].map((i) => ({ on: false, wait: 1 + i * 4 + wr() * 4 }));
  function spawnWhale(wh) {
    if (!deepWater.length) { wh.wait = 1e9; return; }
    const [x, y] = deepWater[Math.floor(wr() * deepWater.length)];
    Object.assign(wh, { on: true, p: 0, dur: 7 + wr() * 4, fx: x + wr(), fy: y + wr(), dir: wr() < 0.5 ? -1 : 1 });
  }
  function drawWhale(g, x, y, p, dir, night) {
    const body = night ? '#1a2336' : '#2f4257', hi = night ? '#3a4a68' : '#5f7893', belly = night ? '#6a7690' : '#c9d3dc';
    const foam = night ? 'rgba(190,205,235,.8)' : 'rgba(255,255,255,.9)';
    // ripple ring
    const rr = 5 + p * 18, ra = (1 - p) * 0.55;
    g.fillStyle = night ? `rgba(190,205,235,${ra})` : `rgba(255,255,255,${ra})`;
    for (let a = 0; a < 28; a++) { const t = (a / 28) * Math.PI * 2; g.fillRect(x + Math.round(Math.cos(t) * rr), y + Math.round(Math.sin(t) * rr * 0.5), 1, 1); }
    // spout
    if (p > 0.04 && p < 0.34) {
      const s = (p - 0.04) / 0.3, hgt = Math.sin(s * Math.PI) * 14;
      g.fillStyle = foam;
      for (let i = 0; i < 9; i++) {
        const k = i / 8, py = y - 3 - k * hgt, spread = Math.round(k * k * 4);
        g.fillRect(x + dir * 3 - spread + ((i * 7) % 3) - 1, Math.round(py), 1, 1);
        g.fillRect(x + dir * 3 + spread, Math.round(py), 1, 1);
      }
    }
    // back arching through the surface
    if (p > 0.08 && p < 0.7) {
      const q = (p - 0.08) / 0.62, h = Math.sin(q * Math.PI) * 5, xo = Math.round((q - 0.5) * 16 * dir);
      for (let k = 0; k <= h; k++) {
        const w = Math.round(11 * Math.sqrt(Math.max(0, 1 - (k / (h + 0.01)) ** 2)));
        g.fillStyle = k >= h - 1 ? hi : body;
        g.fillRect(x + xo - w, y - k, w * 2, 1);
      }
      if (q > 0.45) { g.fillStyle = body; g.fillRect(x + xo - dir * 4, y - Math.round(h) - 2, 2, 2); g.fillRect(x + xo - dir * 5, y - Math.round(h) - 1, 1, 1); }
      g.fillStyle = foam;
      g.fillRect(x + xo - 12, y, 2, 1); g.fillRect(x + xo + 11, y, 2, 1); g.fillRect(x + xo - 9, y + 1, 18, 1);
    }
    // tail flukes as it dives
    if (p > 0.66 && p < 0.97) {
      const s = (p - 0.66) / 0.31, lift = Math.sin(s * Math.PI) * 10, tx = x + Math.round(8 * dir);
      g.fillStyle = body;
      g.fillRect(tx, y - Math.round(lift * 0.7), 2, Math.round(lift * 0.7) + 1);
      for (let k = 0; k < 6; k++) {
        const yy = y - Math.round(lift) + Math.floor(k / 2);
        g.fillRect(tx - 1 - k, yy, 2, 2); g.fillRect(tx + 1 + k, yy, 2, 2);
      }
      g.fillStyle = belly; g.fillRect(tx - 5, y - Math.round(lift) + 3, 3, 1); g.fillRect(tx + 4, y - Math.round(lift) + 3, 3, 1);
      g.fillStyle = foam;
      if (s > 0.3) for (let k = 0; k < 4; k++) g.fillRect(tx - 5 + k * 4, y - Math.round(lift) + 5 + ((k * 5 + Math.floor(s * 20)) % 6), 1, 1);
      g.fillRect(tx - 3, y + 1, 8, 1);
    }
  }

  // ---------- view ----------
  const canvas = document.getElementById('city');
  const ctx = canvas.getContext('2d');
  const labelsEl = document.getElementById('labels');
  const tip = document.getElementById('tip');
  let zoom = innerWidth > 1500 ? 3 : 2;
  const center = toWorld(BX + cityW / 2 + 2, BY + cityH / 2 + 2);
  const cam = { x: center[0], y: center[1] - 60 };
  let vw = 0, vh = 0;

  function resize() {
    vw = Math.ceil(innerWidth / zoom); vh = Math.ceil(innerHeight / zoom);
    canvas.width = vw; canvas.height = vh;
    canvas.style.width = vw * zoom + 'px'; canvas.style.height = vh * zoom + 'px';
    ctx.imageSmoothingEnabled = false;
  }
  addEventListener('resize', resize);
  resize();

  const labelEls = districts.map((d) => {
    const el = document.createElement('div');
    el.className = 'dlabel';
    el.innerHTML = `<i style="background:${(PAVING[d.name] || ['#ccc'])[d.name === 'Crypto' ? 1 : 0]}"></i>${d.name}<b>${d.list.length}</b>`;
    labelsEl.appendChild(el);
    return el;
  });

  // time of day: night = 0..1 crossfade to night sprites; warm = golden grade
  const TOD = { day: { night: 0, warm: 0.1 }, dusk: { night: 0.3, warm: 0.42 }, night: { night: 1, warm: 0 } };
  let tod = 'dusk', cycle = false, cyclePhase = 0.3;
  const light = { night: TOD.dusk.night, warm: TOD.dusk.warm };
  document.body.dataset.tod = tod;

  let speed = 1, hover = null, last = performance.now();
  let N = 0;
  function blit(sp, x, y, a = 1) {
    if (N < 1) { ctx.globalAlpha = a; ctx.drawImage(sp.day, x, y); }
    if (N > 0) { ctx.globalAlpha = Math.min(1, N) * a; ctx.drawImage(sp.night, x, y); }
    ctx.globalAlpha = 1;
  }
  // x-ray: towers in front of what the cursor points at fade out
  let xray = new Set(), xrayAll = false;
  const fadeOf = (it, sp) => (xray.has(it) ? 0.22 : xrayAll && sp.h > 90 && hover !== it ? 0.4 : 1);

  // Movers sort by the road tile they're on, not their exact position: lane offsets
  // would otherwise push someone behind a building past that building's depth.
  const tileDepth = (m) => (m.prog < 0.5 ? m.tx + m.ty : m.nx + m.ny) + 0.5 + (m.fx + m.fy) * 0.001;

  function frame(t) {
    const rawDt = Math.min(0.05, (t - last) / 1000);
    const dt = rawDt * speed;
    last = t;
    for (const w of walkers) step(w, dt, walkerTarget, walkerLane);
    for (const c of cars) step(c, dt, randomRoad, carLane);
    for (const b of boats) {
      b.pos += b.speed * dt;
      if (b.pos > b.b) { b.pos = b.b; b.speed = -Math.abs(b.speed); }
      if (b.pos < b.a) { b.pos = b.a; b.speed = Math.abs(b.speed); }
    }

    // time of day easing
    if (cycle) {
      cyclePhase = (cyclePhase + rawDt / 80) % 1;
      const s = (Math.cos(cyclePhase * Math.PI * 2) + 1) / 2; // 1 = noon, 0 = midnight
      light.night = Math.max(0, Math.min(1, (0.62 - s) * 2.4));
      light.warm = Math.max(0, 0.6 - Math.abs(s - 0.42) * 2.2);
      const want = light.night > 0.75 ? 'night' : light.warm > 0.3 ? 'dusk' : 'day';
      if (document.body.dataset.tod !== want) document.body.dataset.tod = want;
    } else {
      const target = TOD[tod];
      light.night += (target.night - light.night) * Math.min(1, rawDt * 3);
      light.warm += (target.warm - light.warm) * Math.min(1, rawDt * 3);
    }
    N = light.night < 0.01 ? 0 : light.night > 0.99 ? 1 : light.night;

    const L = Math.round(cam.x - vw / 2), T = Math.round(cam.y - vh / 2);
    ctx.clearRect(0, 0, vw, vh);
    if (N < 1) ctx.drawImage(ground, -L, -T);
    if (N > 0) { ctx.globalAlpha = N; ctx.drawImage(groundNight, -L, -T); ctx.globalAlpha = 1; }

    // water glints
    for (const [x, y, ph, sp] of sparkles) {
      const s = Math.sin(t / 1000 * sp + ph);
      if (s > 0.8) {
        const sx = Math.round(x - L), sy = Math.round(y - T);
        if (sx < 0 || sy < 0 || sx > vw || sy > vh) continue;
        ctx.fillStyle = N > 0.5 ? 'rgba(200,215,255,.7)' : 'rgba(255,255,255,.9)';
        ctx.fillRect(sx, sy, s > 0.93 ? 3 : 2, 1);
      }
    }

    if (whalesOn) for (const wh of whales) {
      if (!wh.on) { wh.wait -= rawDt; if (wh.wait < 0) spawnWhale(wh); continue; }
      wh.p += rawDt / wh.dur;
      if (wh.p >= 1) { wh.on = false; wh.wait = 5 + wr() * 14; continue; }
      const [x, y] = toWorld(wh.fx, wh.fy);
      drawWhale(ctx, Math.round(x - L), Math.round(y - T), wh.p, wh.dir, N > 0.5);
    }

    const items = [];
    for (const s of statics) {
      const x = s.x - s.sp.ox - L, y = s.y - s.sp.oy - T;
      if (x > vw || y > vh || x + s.sp.w < 0 || y + s.sp.h < 0) continue;
      items.push(s);
    }
    for (const b of buildings) items.push(b);
    for (const c of civics) items.push(c);
    for (const w of walkers) { w.depth = tileDepth(w); items.push(w); }
    for (const c of cars) { c.depth = tileDepth(c); items.push(c); }
    for (const b of boats) {
      const [fx, fy] = b.alongX ? [b.pos, b.lane] : [b.lane, b.pos];
      b.fx = fx; b.fy = fy; b.px = fx; b.py = fy; b.depth = fx + fy; items.push(b);
    }
    items.sort((a, b) => a.depth - b.depth);

    for (const it of items) {
      if (it.civic) {
        const sp = it.sp, x = it.x - sp.ox - L, y = it.y - sp.oy - T;
        blit(sp, x, y, fadeOf(it, sp));
        if (hover === it) {
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.16;
          ctx.drawImage(N > 0.5 ? sp.night : sp.day, x, y);
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        }
      } else if (it.people) {
        const sp = it.sprite, x = it.wx - sp.ox - L, y = it.wy - sp.oy - T;
        if (x > vw || y > vh || x + sp.w < 0 || y + sp.h < 0) continue;
        blit(sp, x, y, fadeOf(it, sp));
        if (hover === it) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.16;
          ctx.drawImage(N > 0.5 ? sp.night : sp.day, x, y);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        }
      } else if (it.person) {
        const [x, y] = toWorld(it.fx, it.fy);
        const moving = speed && (it.nx !== it.tx || it.ny !== it.ty);
        const sp = it.frames[moving ? Math.floor((t / 1000) * 5 * it.speed + it.phase) % 2 : 0];
        blit(sp, Math.round(x - L - sp.ox), Math.round(y - T - sp.oy));
        if (hover === it) { ctx.fillStyle = '#fff6d0'; ctx.fillRect(Math.round(x - L), Math.round(y - T) - 17, 1, 3); }
      } else if (it.color) {
        const sp = carSprite(it, it.dir[0] ? 'x' : 'y');
        const [x, y] = toWorld(it.fx, it.fy);
        blit(sp, Math.round(x - L - sp.ox), Math.round(y - T - sp.oy));
      } else if (it.lane !== undefined) {
        const [x, y] = toWorld(it.fx, it.fy);
        const sp = it.sp;
        blit(sp, Math.round(x - L - sp.ox), Math.round(y - T - sp.oy + Math.sin(t / 700 + it.lane) * 0.6));
      } else {
        blit(it.sp, it.x - it.sp.ox - L, it.y - it.sp.oy - T);
      }
    }

    // fog rolling in through the Golden Gate
    if (MAP_ID === 'sf') {
      for (let i = 0; i < 7; i++) {
        const sp = ((t / 1000) * 0.018 + i / 7) % 1;
        const [fx, fy] = toWorld(BX - 6 + Math.sin(i * 2.3) * 2.5, -3 + sp * (BY + cityH * 0.7));
        const x = fx - L, y = fy - T - 24, rad = 80 + (i % 3) * 26;
        const a = (N > 0.5 ? 0.22 : 0.5) * Math.sin(sp * Math.PI);
        const grad = ctx.createRadialGradient(x, y, 0, x, y, rad);
        const c = N > 0.5 ? '170,180,210' : '250,248,242';
        grad.addColorStop(0, `rgba(${c},${a})`); grad.addColorStop(0.6, `rgba(${c},${a * 0.5})`); grad.addColorStop(1, `rgba(${c},0)`);
        ctx.save(); ctx.translate(x, y); ctx.scale(1, 0.42); ctx.translate(-x, -y);
        ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
    }
    // soft cloud shadows during the day
    if (N < 0.5) {
      ctx.save();
      ctx.globalAlpha = 0.07 * (1 - N * 2);
      ctx.fillStyle = '#1b2140';
      for (let i = 0; i < 3; i++) {
        const cx3 = ((t / 1000) * 6 + i * 420) % (WW + 400) - 200 - L, cy3 = 200 + i * 230 - ((t / 1000) * 3 + i * 100) % 300 - T + 150;
        ctx.beginPath(); ctx.ellipse(cx3, cy3, 110, 42, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx3 + 70, cy3 + 14, 70, 30, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    // color grade
    if (light.warm > 0.01) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgba(255,196,140,${light.warm * 0.55})`;
      ctx.fillRect(0, 0, vw, vh);
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = `rgba(255,150,90,${light.warm * 0.08})`;
      ctx.fillRect(0, 0, vw, vh);
      ctx.globalCompositeOperation = 'source-over';
    }

    if (labelsOn) {
      districts.forEach((d, i) => {
        const [x, y] = toWorld(d.cx, d.top);
        labelEls[i].style.left = (x - L) * zoom + 'px';
        labelEls[i].style.top = (y - T - 64) * zoom + 'px';
      });
    }
    requestAnimationFrame(frame);
  }

  // ---------- picking ----------
  function pick(mx, my) {
    const L = Math.round(cam.x - vw / 2), T = Math.round(cam.y - vh / 2);
    const wx = L + mx / zoom, wy = T + my / zoom;
    let best = null;
    for (const w of walkers) {
      const [x, y] = toWorld(w.fx, w.fy);
      if (wx >= x - 4 && wx <= x + 5 && wy >= y - 14 && wy <= y + 2 && (!best || w.depth > best.depth)) best = w;
    }
    if (best) return best;
    const sorted = [...buildings, ...civics].sort((a, b) => b.depth - a.depth);
    const hits = [];
    for (const b of sorted) {
      const sp = b.civic ? b.sp : b.sprite, ox = b.civic ? b.x : b.wx, oy = b.civic ? b.y : b.wy;
      if (sp.hit(Math.floor(wx - (ox - sp.ox)), Math.floor(wy - (oy - sp.oy)))) hits.push({ b, base: oy + HH * 4 });
      if (hits.length > 3) break;
    }
    // Pointing high up a tower that stands in front of something? Look through it.
    const next = new Set();
    let k = 0;
    while (k < hits.length - 1 && hits[k].base - wy > 36) next.add(hits[k++].b);
    xray = next;
    if (hits[k]) return hits[k].b;
    return null;
  }

  const ago = (ts) => {
    const d = Math.floor((now - ts) / DAY);
    if (d <= 0) return 'today';
    if (d === 1) return 'yesterday';
    if (d < 14) return d + ' days ago';
    if (d < 60) return Math.round(d / 7) + ' weeks ago';
    return Math.round(d / 30) + ' months ago';
  };
  const octx = { ago, now };

  // ---------- input ----------
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 5) { drag.moved = true; canvas.classList.add('dragging'); }
      if (drag.moved) { cam.x = drag.cx - dx / zoom; cam.y = drag.cy - dy / zoom; tip.style.display = 'none'; return; }
    }
    hover = pick(e.clientX, e.clientY);
    canvas.classList.toggle('pointing', !!hover);
    if (hover) {
      tip.style.display = 'block';
      tip.style.left = e.clientX + 14 + 'px';
      tip.style.top = e.clientY + 14 + 'px';
      tip.innerHTML = hover.civic
        ? (hover.civic === 'hall' ? '<b>City Hall</b><span>Settings, map, mayor & statue</span>'
          : hover.civic === 'landmark' ? `<b>${hover.name}</b><span>Landmark · ${MAP.name}</span>`
          : `<b>Statue of ${window.Civic.mayorName()}</b><span>Mayor of ${MAP.name}</span>`)
        : hover.people
        ? `<b>${hover.name}</b><span>${hover.people.length} ${hover.people.length === 1 ? 'person' : 'people'} · ${hover.industry}</span>`
        : `<b>${hover.person.name}</b><span>${hover.person.title} · ${hover.person.company.name}</span>`;
    } else tip.style.display = 'none';
  });
  canvas.addEventListener('pointerup', (e) => {
    const wasDrag = drag && drag.moved;
    drag = null;
    canvas.classList.remove('dragging');
    if (wasDrag) return;
    const hit = pick(e.clientX, e.clientY);
    if (!hit) return;
    tip.style.display = 'none';
    if (hit.civic === 'landmark') return;
    if (hit.civic) window.Civic.open(civicApi);
    else if (hit.people) window.Office.open(hit, octx);
    else window.Office.openPerson(hit.person, octx);
  });
  canvas.addEventListener('pointerleave', () => { tip.style.display = 'none'; hover = null; xray = new Set(); });

  function setZoom(z, mx = innerWidth / 2, my = innerHeight / 2) {
    z = Math.max(1, Math.min(5, z));
    if (z === zoom) return;
    const wx = cam.x - vw / 2 + mx / zoom, wy = cam.y - vh / 2 + my / zoom;
    zoom = z;
    resize();
    cam.x = wx - mx / zoom + vw / 2;
    cam.y = wy - my / zoom + vh / 2;
  }
  let wheelAcc = 0;
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) > 60) { setZoom(zoom + (wheelAcc < 0 ? 1 : -1), e.clientX, e.clientY); wheelAcc = 0; }
  }, { passive: false });

  document.getElementById('zoomIn').onclick = () => setZoom(zoom + 1);
  document.getElementById('zoomOut').onclick = () => setZoom(zoom - 1);
  const xrayBtn = document.getElementById('xray');
  const setXray = (on) => { xrayAll = on; xrayBtn.classList.toggle('on', on); };
  xrayBtn.onclick = () => setXray(!xrayAll);
  addEventListener('keydown', (e) => { if ((e.key === 'x' || e.key === 'X') && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) setXray(!xrayAll); });
  document.getElementById('recenter').onclick = () => { cam.x = center[0]; cam.y = center[1] - 60; };
  let labelsOn = true;
  document.getElementById('toggleLabels').onclick = (e) => {
    labelsOn = !labelsOn;
    e.currentTarget.classList.toggle('on', labelsOn);
    labelsEl.classList.toggle('hidden', !labelsOn);
  };
  const radio = (sel, fn) => document.querySelectorAll(sel).forEach((btn) => {
    btn.onclick = () => { document.querySelectorAll(sel).forEach((b) => b.classList.toggle('on', b === btn)); fn(btn); };
  });
  radio('[data-speed]', (btn) => { speed = +btn.dataset.speed; });
  radio('[data-tod]', (btn) => {
    cycle = btn.dataset.tod === 'cycle';
    if (!cycle) { tod = btn.dataset.tod; document.body.dataset.tod = tod; }
  });

  // ---------- chrome ----------
  document.getElementById('date').textContent = new Date(now).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (MAP_ID !== 'default') document.querySelector('.brand-s').textContent = `Your network, zoned · ${MAP.name}`;
  document.getElementById('modeChip').style.display = data.demo ? '' : 'none';
  const known = buildings.reduce((s, b) => s + b.people.length, 0);
  document.getElementById('stats').innerHTML =
    `<span><b>${buildings.length}</b> companies</span><span><b>${known}</b> people</span><span><b>${walkers.length}</b> out & about</span>`;

  const tickerSpan = document.querySelector('#ticker span');
  tickerSpan.textContent = walkerPeople.slice(0, 25)
    .map((p) => `${p.name} · ${[p.title, p.company.name].filter(Boolean).join(', ')} · ${ago(p.lastInteraction)}`).join('   ◆   ');
  let tickX = 400;
  (function tick() {
    tickX -= 0.6;
    if (tickX < -tickerSpan.offsetWidth) tickX = tickerSpan.parentElement.offsetWidth;
    tickerSpan.style.transform = `translateX(${tickX}px)`;
    requestAnimationFrame(tick);
  })();

  document.getElementById('loading').classList.add('done');
  requestAnimationFrame(frame);

  const hallLabel = document.createElement('div');
  hallLabel.className = 'dlabel civic';
  hallLabel.innerHTML = '<i></i>City Hall';
  labelsEl.appendChild(hallLabel);
  (function placeHall() {
    const Lx = Math.round(cam.x - vw / 2), Ty = Math.round(cam.y - vh / 2);
    const [x, y] = toWorld(hallLot[0] + 1, hallLot[1] + 1);
    hallLabel.style.left = (x - Lx) * zoom + 'px';
    hallLabel.style.top = (y - Ty - 58) * zoom + 'px';
    requestAnimationFrame(placeHall);
  })();
  const civicApi = {
    setStatue,
    setWhales: (on) => { whalesOn = on; },
    whales: () => whalesOn,
    mapId: MAP_ID,
    stats: { companies: buildings.length, people: known, demo: data.demo },
    lookAtHall: () => { const [x, y] = toWorld(hallLot[0] + 2, hallLot[1] + 1); cam.x = x; cam.y = y - 40; },
  };

  const screenOf = (b) => [(b.wx - Math.round(cam.x - vw / 2)) * zoom, (b.wy + HH * 2 - Math.round(cam.y - vh / 2)) * zoom];
  window.NetCity = { focus: (b) => { cam.x = b.wx ?? b.x; cam.y = (b.wy ?? b.y) - 70; }, buildings, walkers, districts, screenOf, pick, light, hall, statue, civicApi, whales };
})();
