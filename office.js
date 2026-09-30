// Office interiors (click a building) and person cards (click a person).
// Each industry has its own floor plan, materials, furniture and wall treatment.
(function () {
  const S = window.Sprites;
  const { mix } = S;
  const WALL = 52;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = (n) => (n >= 1e9 ? '$' + (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? '$' + Math.round(n / 1e6) + 'M' : '$' + Math.round(n / 1e3) + 'K');
  const noise = (x, y, s = 0) => { let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

  const THEMES = {
    'Venture Capital': { name: 'Partners’ floor', floor: 'herringbone', fc: '#9a6a42', wallL: '#314c3d', wallR: '#2a4234', trim: '#c9a45a', deco: 'art', layout: 'boardroom', chair: 'leather', desk: '#5a3a24', wallProps: ['bookshelf', 'bookshelf', 'bookshelf'], floorProps: ['globe', 'plantTall', 'couch'] },
    'AI / ML': { name: 'Research lab', floor: 'darktile', fc: '#2b2e3b', wallL: '#3a3e55', wallR: '#32364b', trim: '#b490ff', deco: 'led', layout: 'rows', chair: 'mesh', desk: '#e6e6ec', monitors: 2, wallProps: ['server', 'server', 'server', 'server'], floorProps: ['whiteboard', 'plantTall', 'beanbag'] },
    'Fintech': { name: 'Trading floor', floor: 'carpet', fc: '#3f5566', wallL: '#e9eef0', wallR: '#dbe2e6', trim: '#2f8f8f', deco: 'ticker', layout: 'cubicles', chair: 'mesh', desk: '#f2f2f2', monitors: 2, wallProps: ['printer', 'cooler'], floorProps: ['plantTall', 'plant', 'couch'] },
    'Developer Tools': { name: 'Warehouse loft', floor: 'concrete', fc: '#a9a59c', wallL: '#a9573f', wallR: '#95503a', trim: '#2a2a2e', deco: 'brick', layout: 'rows', chair: 'mesh', desk: '#c89a64', monitors: 1, wallProps: ['shelf', 'bike'], floorProps: ['pingpong', 'beanbag', 'plantTall'] },
    'Healthcare': { name: 'Clinic & lab', floor: 'tile', fc: '#eef3f3', wallL: '#f4f6f5', wallR: '#e6eceb', trim: '#4fa3a0', deco: 'stripe', layout: 'lab', chair: 'stool', desk: '#dfe6e8', wallProps: ['shelf', 'shelf', 'cooler'], floorProps: ['bed', 'plant', 'bed'] },
    'Consumer': { name: 'Studio & showroom', floor: 'terrazzo', fc: '#f3e6d8', wallL: '#f2b8a8', wallR: '#e8a898', trim: '#2f2f2f', deco: 'posters', layout: 'communal', chair: 'stool', desk: '#e8c79a', wallProps: ['rack', 'rack'], floorProps: ['plantTall', 'couch', 'plant'] },
    'Climate': { name: 'Timber workshop', floor: 'wood', fc: '#c9a174', wallL: '#dcc9a4', wallR: '#cdb892', trim: '#5f9e46', deco: 'slats', layout: 'communal', chair: 'wood', desk: '#9c6b3f', wallProps: ['shelf', 'bike'], floorProps: ['plantTall', 'plantTall', 'plant'] },
    'Enterprise SaaS': { name: 'Open office', floor: 'carpet', fc: '#8c8f96', wallL: '#e6e1d6', wallR: '#d8d2c5', trim: '#6b7a8f', deco: 'whiteboard', layout: 'cubicles', chair: 'mesh', desk: '#d9d4c8', monitors: 1, wallProps: ['printer', 'cooler', 'shelf'], floorProps: ['plant', 'plantTall', 'couch'] },
    'Media': { name: 'Broadcast studio', floor: 'herringbone', fc: '#4a3430', wallL: '#6b2a36', wallR: '#5c2430', trim: '#f2c14e', deco: 'onair', layout: 'rows', chair: 'leather', desk: '#2a2a2e', monitors: 1, wallProps: ['shelf'], floorProps: ['camera', 'softbox', 'couch'] },
    'Crypto': { name: 'The war room', floor: 'darktile', fc: '#1f1f26', wallL: '#26262e', wallR: '#202027', trim: '#ff8b2e', deco: 'neon', layout: 'rows', chair: 'gamer', desk: '#2e2e36', monitors: 3, wallProps: ['server', 'server'], floorProps: ['beanbag', 'beanbag', 'plantTall'] },
  };
  const THEME_DEFAULT = THEMES['Enterprise SaaS'];

  // ---------- windows ----------
  function makeWindow(id, title) {
    let win = document.getElementById(id);
    if (!win) {
      win = document.createElement('div');
      win.id = id;
      win.className = 'win';
      win.innerHTML = '<div class="titlebar"><span class="t"></span><button class="x" aria-label="Close">✕</button></div><div class="body"></div>';
      document.body.appendChild(win);
      win.querySelector('.x').onclick = () => win.remove();
      dragBy(win, win.querySelector('.titlebar'));
    }
    win.querySelector('.t').innerHTML = title;
    return win;
  }
  function dragBy(win, handle) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = win.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      win.style.transform = 'none';
      win.style.left = r.left + 'px'; win.style.top = r.top + 'px';
      const move = (ev) => { win.style.left = ev.clientX - dx + 'px'; win.style.top = Math.max(0, ev.clientY - dy) + 'px'; };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
    });
  }
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const top = document.getElementById('person') || document.getElementById('hall') || document.getElementById('office');
    if (top) top.remove();
  });

  // Pixel portrait of a person, reused on cards.
  function portrait(p, size = 4) {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    const g = c.getContext('2d');
    g.fillStyle = mix(S.looks(p).top, '#f4efe4', 0.78); g.fillRect(0, 0, 16, 16);
    S.drawSitter(g, 8, 25, S.looks(p));
    c.style.width = 16 * size + 'px'; c.style.height = 16 * size + 'px';
    c.className = 'portrait';
    return c;
  }

  function personCard(p, ctx, extra = '') {
    const strength = p.strength != null
      ? `<div class="row"><span class="k">Relationship</span><span class="meter"><i style="width:${p.strength}%"></i></span><span>${p.strength}</span></div>` : '';
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `
      <div class="head"><div class="pv"></div>
        <div><div class="nm">${esc(p.name)}</div><div class="sub">${esc(p.title)}</div><div class="co">${esc(p.company.name)}</div></div></div>
      ${p.email ? `<div class="row"><span class="k">Email</span><a href="mailto:${esc(p.email)}">${esc(p.email)}</a></div>` : ''}
      <div class="row"><span class="k">Last seen</span><span>${esc(ctx.ago(p.lastInteraction))}</span></div>
      ${strength}
      ${p.linkedin ? `<div class="row"><span class="k">LinkedIn</span><a href="${esc(p.linkedin)}" target="_blank" rel="noopener">Profile ↗</a></div>` : ''}
      ${extra}`;
    el.querySelector('.pv').appendChild(portrait(p));
    return el;
  }

  // ---------- floor plans ----------
  function plan(company, th) {
    const n = company.people.length;
    const seats = [], furn = [];
    let RW, RD;
    if (th.layout === 'boardroom' || th.layout === 'communal') {
      const cols = Math.max(2, Math.min(7, Math.ceil(Math.sqrt(n * 0.9))));
      const tables = Math.ceil(n / (cols * 2));
      RW = cols + 4; RD = 3 + tables * 3 + 2;
      for (let t = 0; t < tables; t++) {
        const y0 = 2.6 + t * 3;
        furn.push({ type: 'table', x: 1, y: y0 + 0.5, w: cols, d: 0.95 });
        for (let i = 0; i < cols; i++) seats.push({ x: 1.5 + i, y: y0 + 0.28, back: false });
        for (let i = 0; i < cols; i++) seats.push({ x: 1.5 + i, y: y0 + 1.78, back: true });
      }
    } else {
      const cols = Math.max(2, Math.min(8, Math.ceil(Math.sqrt(n * 1.5))));
      const rows = Math.ceil(n / cols);
      RW = cols + 4; RD = 3 + rows * 2 + 2;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        if (seats.length >= n) break;
        seats.push({ x: 1.5 + i, y: 2.6 + j * 2 + 0.3, back: false, desk: [1 + i, 2.6 + j * 2] });
      }
    }
    return { RW, RD, seats, furn };
  }

  // ---------- room renderer ----------
  function drawRoom(company, selected) {
    const th = THEMES[company.industry] || THEME_DEFAULT;
    const { RW, RD, seats, furn } = plan(company, th);
    const cw = (RW + RD) * S.HW + 12, ch = (RW + RD) * S.HH + WALL + 30;
    const ox = RD * S.HW + 6, oy = WALL + 16;
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const g = c.getContext('2d');
    const P = (x, y, z = 0) => [Math.round(ox + (x - y) * S.HW), Math.round(oy + (x + y) * S.HH - z)];
    const box = (tx, ty, w, d, z, h, color, top) => S.isoBox(g, ox, oy, tx, ty, w, d, z, h, S.mat(color, top));
    const r = window.NetCityData.rng(S.hash(company.id + 'office'));

    // --- floor
    const fc = th.fc;
    for (let ty = 0; ty < RD; ty++) for (let tx = 0; tx < RW; tx++) {
      const [sx, sy] = P(tx, ty);
      S.diamondFn(g, sx, sy, (px, py, row, k) => {
        const a = (k + 0.5) / S.HW, b = (row + 0.5) / S.HH;
        const u = (a + b) / 2, v = (b - a) / 2;
        const n = noise(px, py, 11);
        switch (th.floor) {
          case 'herringbone': {
            const flip = (tx + ty) % 2;
            const q = flip ? u : v, p2 = flip ? v : u;
            const plank = Math.floor(q * 4);
            if ((q * 4) % 1 < 0.1 || (p2 * 2 + plank * 0.5) % 1 < 0.06) return mix(fc, '#000000', 0.28);
            return mix(fc, plank % 2 ? '#000000' : '#ffffff', 0.06 + n * 0.05);
          }
          case 'wood': {
            const plank = Math.floor(v * 3 + ty * 3);
            if ((v * 3) % 1 < 0.08 || ((u + (plank % 3) * 0.33) % 1) < 0.03) return mix(fc, '#000000', 0.22);
            return mix(fc, plank % 2 ? '#000000' : '#ffffff', 0.04 + n * 0.05);
          }
          case 'carpet': return n > 0.9 ? mix(fc, '#ffffff', 0.08) : n < 0.1 ? mix(fc, '#000000', 0.08) : fc;
          case 'concrete': if (u < 0.03 || v < 0.03) return mix(fc, '#000000', 0.12); return n > 0.93 ? mix(fc, '#000000', 0.1) : n < 0.05 ? mix(fc, '#ffffff', 0.12) : fc;
          case 'tile': if (u < 0.05 || v < 0.05) return '#c9d3d3'; return (tx + ty) % 2 ? fc : mix(fc, '#9fc8c8', 0.12);
          case 'terrazzo': return n > 0.94 ? ['#e0643a', '#4fb3bf', '#f2c14e', '#8a7fd4', '#2f2f2f'][Math.floor(n * 100) % 5] : n < 0.2 ? mix(fc, '#000000', 0.04) : fc;
          case 'darktile': if (u < 0.04 || v < 0.04) return mix(fc, th.trim, 0.28); return (tx + ty) % 2 ? fc : mix(fc, '#ffffff', 0.04);
          default: return fc;
        }
      });
    }

    // --- walls (x=0 plane on the left, y=0 plane on the right)
    const A = P(0, 0), B = P(RW, 0), D = P(0, RD);
    const leftBase = (x) => A[1] + (A[0] - x) / 2;
    const rightBase = (x) => A[1] + (x - A[0]) / 2;
    const wallPx = (base, lit) => (x, h) => {
      const n = noise(x, h, 3);
      if (th.deco === 'brick') {
        const row = Math.floor(h / 4);
        if (h % 4 === 0 || (x + (row % 2) * 4) % 8 === 0) return mix(base, '#e8dccb', lit ? 0.35 : 0.25);
        return mix(base, n > 0.5 ? '#000000' : '#ffffff', n * 0.08);
      }
      if (th.deco === 'slats' && x % 3 === 0) return mix(base, '#000000', 0.12);
      return n > 0.97 ? mix(base, '#000000', 0.04) : base;
    };
    const paintWall = (x0, x1, base, px) => {
      for (let x = x0; x < x1; x++) {
        const yb = Math.round(base(x));
        for (let h = 0; h < WALL; h++) { g.fillStyle = px(x, h); g.fillRect(x, yb - h - 1, 1, 1); }
        g.fillStyle = mix(th.trim, '#000000', 0.2); g.fillRect(x, yb - 3, 1, 3);
        g.fillStyle = mix(px(x, WALL), '#000000', 0.3); g.fillRect(x, yb - WALL - 1, 1, 2);
      }
    };
    paintWall(D[0], A[0], leftBase, wallPx(th.wallL, true));
    paintWall(A[0], B[0], rightBase, wallPx(th.wallR, false));
    // wall helpers: rect on the left wall at tile t along y, or right wall at tile t along x
    const onLeft = (t, zz, w, h, color) => { const [x] = P(0, t); S.slopeRect(g, x, leftBase(x) - zz, w, h, -0.5, color); };
    const onRight = (t, zz, w, h, color) => { const [x] = P(t, 0); S.slopeRect(g, x, rightBase(x) - zz, w, h, 0.5, color); };
    const windowAt = (fn, t) => {
      fn(t, 14, 12, 26, mix(th.trim, '#2a2a2a', 0.5));
      fn(t + 0.07, 15, 10, 24, '#a9d6ef');
      fn(t + 0.07, 30, 10, 9, '#cfe9f7');
      fn(t + 0.07, 26, 10, 1, mix(th.trim, '#2a2a2a', 0.5));
      fn(t + 0.3, 15, 1, 24, mix(th.trim, '#2a2a2a', 0.5));
    };
    const art = (fn, t, r2) => {
      fn(t, 20, 12, 12, th.trim);
      fn(t + 0.06, 21, 10, 10, '#f3ecdc');
      const cols = ['#e0643a', '#2c5f8a', '#f2c14e', '#2a2a2e', '#7fae7a'];
      fn(t + 0.08, 22, 5, 5, cols[Math.floor(r2() * 5)]);
      fn(t + 0.3, 24, 4, 6, cols[Math.floor(r2() * 5)]);
    };
    // windows on the left wall, deco on the right wall
    for (let t = 1.5; t < RD - 1; t += 2.2) windowAt((tt, zz, w, h, col) => onLeft(RD - tt, zz, w, h, col), t);
    for (let t = RW - 2.6; t > 3; t -= 2.4) windowAt(onRight, t);
    switch (th.deco) {
      case 'art': for (let t = 1.2; t < RD - 1; t += 2.2) art((tt, zz, w, h, col) => onLeft(RD - tt, zz, w, h, col), t + 1.05, r); break;
      case 'led': for (let x = D[0]; x < B[0]; x++) { g.fillStyle = th.trim; g.fillRect(x, Math.round(x < A[0] ? leftBase(x) : rightBase(x)) - WALL + 4, 1, 1); } break;
      case 'ticker': onRight(0.4, 36, 28, 7, '#15171c'); for (let k = 0; k < 26; k++) onRight(0.45 + k * 0.06, 38 + Math.round(Math.sin(k * 0.9) * 1.5 + k * 0.08), 1, 1, k % 5 === 0 ? '#e0643a' : '#4fd18a'); break;
      case 'stripe': for (let x = D[0]; x < B[0]; x++) { g.fillStyle = th.trim; g.fillRect(x, Math.round(x < A[0] ? leftBase(x) : rightBase(x)) - 12, 1, 3); } break;
      case 'posters': for (let t = 0.6; t < 2.6; t += 0.9) { onRight(t, 18, 10, 14, ['#f2c14e', '#4fb3bf', '#2f2f2f'][Math.floor(t)]); onRight(t + 0.1, 24, 6, 2, '#ffffff'); } break;
      case 'slats': for (let t = 1; t < RD - 1; t += 2.2) { const [x] = P(0, RD - t - 1.05); disk(g, x + 4, Math.round(leftBase(x + 4)) - WALL + 8, 3, '#4f9a3f'); } break;
      case 'whiteboard': onRight(0.5, 16, 30, 16, '#fbfbf8'); onRight(0.6, 26, 12, 1, '#2c5f8a'); onRight(0.7, 22, 16, 1, '#e0643a'); onRight(0.6, 19, 8, 1, '#2a2a2e'); break;
      case 'onair': onRight(0.5, 36, 16, 6, '#d8373a'); onRight(0.6, 38, 10, 2, '#ffe0e0'); art(onRight, 1.8, r); break;
      case 'neon': for (let x = D[0]; x < B[0]; x++) { g.fillStyle = th.trim; g.fillRect(x, Math.round(x < A[0] ? leftBase(x) : rightBase(x)) - 9, 1, 1); } onRight(0.4, 22, 26, 14, '#101014'); for (let k = 0; k < 24; k++) onRight(0.45 + k * 0.065, 25 + Math.round(k * 0.35 + Math.sin(k) * 2), 1, 1, th.trim); break;
    }
    function disk(gg, x, y, rad, col) { S.disk(gg, x, y, rad, col); }

    // --- furniture & people, depth sorted
    const items = [];
    const add = (depth, fn) => items.push({ depth, fn });

    const plant = (x, y, tall) => add(x + y, () => {
      box(x, y, 0.3, 0.3, 0, 6, '#b8683e');
      const [px, py] = P(x + 0.15, y + 0.15, 6);
      if (tall) { g.fillStyle = '#5a3d26'; g.fillRect(px, py - 12, 1, 12); disk(g, px, py - 16, 5, '#2f6f33'); disk(g, px - 1, py - 17, 3, '#4a9443'); disk(g, px + 3, py - 10, 3, '#3f8a3c'); }
      else { disk(g, px, py - 5, 4, '#3f8a3c'); disk(g, px - 1, py - 6, 2, '#63a84e'); }
    });
    const PROPS = {
      bookshelf: (x, y) => add(x + y, () => {
        const b = box(x, y, 0.9, 0.3, 0, 24, '#5a3a24');
        for (let zz = 3; zz < 22; zz += 6) {
          S.faceRect(g, b, 'L', 1, zz - 1, b.lenL - 2, 1, '#3a2616');
          for (let u = 1; u < b.lenL - 2; u += 1) if (noise(u, zz, x) > 0.25) S.faceRect(g, b, 'L', u, zz, 1, 3 + Math.floor(noise(u, zz) * 2), ['#b23a48', '#2c5f8a', '#d9ad4c', '#3f6b4a', '#e9e4d8'][Math.floor(noise(zz, u, 2) * 5)]);
        }
      }),
      server: (x, y) => add(x + y, () => {
        const b = box(x, y, 0.55, 0.4, 0, 28, '#17181f');
        for (let zz = 3; zz < 26; zz += 3) { S.faceRect(g, b, 'L', 1, zz, b.lenL - 2, 1, '#2a2c36'); if (noise(zz, x) > 0.3) S.faceRect(g, b, 'L', 2 + Math.floor(noise(x, zz) * 5), zz + 1, 1, 1, noise(zz, 7) > 0.5 ? '#5dff9a' : '#7ac4ff'); }
      }),
      printer: (x, y) => add(x + y, () => { box(x, y, 0.5, 0.4, 0, 8, '#d9d9d9'); box(x + 0.08, y + 0.08, 0.3, 0.2, 8, 1, '#ffffff'); }),
      cooler: (x, y) => add(x + y, () => { box(x, y, 0.3, 0.3, 0, 10, '#eeeeee'); box(x + 0.05, y + 0.05, 0.2, 0.2, 10, 7, '#8fc8ec', '#b8e0f7'); }),
      shelf: (x, y) => add(x + y, () => {
        const b = box(x, y, 0.9, 0.28, 0, 20, th.floor === 'tile' ? '#f4f4f2' : '#c89a64');
        for (let zz = 4; zz < 20; zz += 7) { S.faceRect(g, b, 'L', 1, zz - 1, b.lenL - 2, 1, mix(th.trim, '#000000', 0.3)); for (let u = 2; u < b.lenL - 3; u += 3) S.faceRect(g, b, 'L', u, zz, 2, 3, ['#8fc8ec', '#e0643a', '#f2c14e', '#7fae7a'][Math.floor(noise(u, zz, 5) * 4)]); }
      }),
      rack: (x, y) => add(x + y, () => {
        const [a1, b1] = P(x, y + 0.3), [a2, b2] = P(x + 1, y + 0.3);
        g.fillStyle = '#2a2a2e'; g.fillRect(a1, b1 - 20, 1, 20); g.fillRect(a2, b2 - 20, 1, 20);
        for (let k = 0; k <= a2 - a1; k++) g.fillRect(a1 + k, Math.round(b1 + k / 2) - 20, 1, 1);
        for (let k = 2; k < a2 - a1 - 1; k += 3) { g.fillStyle = ['#e0643a', '#f2c14e', '#4fb3bf', '#f4efe4', '#2f2f2f', '#9a86c8'][k % 6]; g.fillRect(a1 + k, Math.round(b1 + k / 2) - 19, 2, 9); }
      }),
      bike: (x, y) => add(x + y, () => {
        const [px, py] = P(x + 0.4, y + 0.3);
        g.fillStyle = '#2a2a2e';
        for (const dx of [-5, 5]) for (let a = 0; a < 16; a++) g.fillRect(px + dx + Math.round(Math.cos(a / 16 * Math.PI * 2) * 3.5), py - 4 + Math.round(Math.sin(a / 16 * Math.PI * 2) * 3.5), 1, 1);
        g.fillStyle = th.trim; g.fillRect(px - 5, py - 5, 10, 1); g.fillRect(px - 1, py - 9, 1, 5); g.fillRect(px + 3, py - 8, 1, 4);
        g.fillStyle = '#2a2a2e'; g.fillRect(px - 2, py - 9, 3, 1); g.fillRect(px + 3, py - 9, 2, 1);
      }),
      globe: (x, y) => add(x + y, () => { const [px, py] = P(x + 0.2, y + 0.2); g.fillStyle = '#5a3a24'; g.fillRect(px, py - 10, 1, 10); g.fillRect(px - 2, py - 1, 5, 1); disk(g, px, py - 13, 4, '#3f7fa8'); g.fillStyle = '#6aa84a'; g.fillRect(px - 2, py - 15, 2, 2); g.fillRect(px + 1, py - 12, 2, 2); }),
      whiteboard: (x, y) => add(x + y, () => { box(x, y + 0.2, 0.9, 0.06, 6, 16, '#fbfbf8'); const b = box(x, y + 0.2, 0.9, 0.06, 6, 0, '#fbfbf8'); S.faceRect(g, b, 'L', 3, 6, 8, 1, '#2c5f8a'); S.faceRect(g, b, 'L', 2, 10, 11, 1, '#e0643a'); S.faceRect(g, b, 'L', 3, 13, 5, 1, '#2a2a2e'); const [px, py] = P(x + 0.1, y + 0.26); g.fillStyle = '#6b6f78'; g.fillRect(px, py - 6, 1, 6); }),
      beanbag: (x, y) => add(x + y, () => { const [px, py] = P(x + 0.3, y + 0.3); const col = ['#e0643a', '#4fb3bf', '#f2c14e', '#8a7fd4'][Math.floor(noise(x, y) * 4)]; disk(g, px, py - 3, 5, mix(col, '#1b2140', 0.3)); disk(g, px - 1, py - 4, 4, col); g.fillStyle = mix(col, '#ffffff', 0.3); g.fillRect(px - 3, py - 6, 2, 1); }),
      couch: (x, y) => add(x + y + 0.5, () => { const col = th.chair === 'leather' ? '#6b3a22' : ['#3f6b8a', '#b8683e', '#6f8f6a'][Math.floor(noise(x, y) * 3)]; box(x, y, 1.3, 0.16, 0, 11, col); box(x, y + 0.16, 1.3, 0.42, 0, 5, col); box(x - 0.02, y, 0.14, 0.6, 0, 7, col); box(x + 1.2, y, 0.14, 0.6, 0, 7, col); }),
      pingpong: (x, y) => add(x + y + 0.6, () => { const b = box(x, y, 1.3, 0.75, 6, 1, '#2f7d4f', '#358a58'); void b; const [a1, b1] = P(x + 0.65, y); const [a2, b2] = P(x + 0.65, y + 0.75); g.fillStyle = '#f4f4f0'; for (let k = 0; k <= a1 - a2; k++) g.fillRect(a2 + k, Math.round(b2 - k / 2) - 9, 1, 3); g.fillStyle = '#2a2a2e'; for (const [dx, dy] of [[0.1, 0.1], [1.2, 0.1], [0.1, 0.65], [1.2, 0.65]]) { const [px, py] = P(x + dx, y + dy); g.fillRect(px, py - 6, 1, 6); } void b1; }),
      bed: (x, y) => add(x + y + 0.3, () => { box(x, y, 1, 0.5, 2, 4, '#f4f4f0'); box(x, y, 0.25, 0.5, 6, 2, '#ffffff'); box(x + 0.35, y, 0.65, 0.5, 6, 1, '#7aa6d6'); const [px, py] = P(x, y + 0.5); g.fillStyle = '#9aa3ad'; g.fillRect(px, py - 2, 1, 2); }),
      camera: (x, y) => add(x + y, () => { const [px, py] = P(x + 0.3, y + 0.3); g.fillStyle = '#2a2a2e'; g.fillRect(px - 3, py - 1, 1, 1); g.fillRect(px + 3, py - 1, 1, 1); for (let k = 0; k < 12; k++) { g.fillRect(px - 3 + Math.round(k / 4), py - 1 - k, 1, 1); g.fillRect(px + 3 - Math.round(k / 4), py - 1 - k, 1, 1); } g.fillRect(px - 3, py - 17, 7, 5); g.fillStyle = '#556'; g.fillRect(px + 3, py - 16, 2, 3); g.fillStyle = '#ff4040'; g.fillRect(px - 2, py - 16, 1, 1); }),
      softbox: (x, y) => add(x + y, () => { const [px, py] = P(x + 0.3, y + 0.3); g.fillStyle = '#2a2a2e'; g.fillRect(px, py - 18, 1, 18); g.fillRect(px - 3, py - 1, 7, 1); g.fillStyle = '#fff8e6'; g.fillRect(px - 5, py - 26, 10, 8); g.fillStyle = '#2a2a2e'; g.fillRect(px - 5, py - 27, 10, 1); }),
      plant: (x, y) => plant(x, y, false),
      plantTall: (x, y) => plant(x, y, true),
    };

    // wall props along the back (right) wall, floor props down the right side
    th.wallProps.forEach((p, i) => { const x = 1 + i * 1.1; if (x < RW - 2.2) PROPS[p](x, 0.12); });
    th.floorProps.forEach((p, i) => { const y = 1.6 + i * 1.9; if (y < RD - 0.9) PROPS[p](RW - 1.7, y); });
    plant(0.15, RD - 0.55, true);
    plant(0.12, 0.12, true);

    // chairs
    const chair = (x, y, back) => {
      const col = { mesh: '#2f333d', leather: '#6b3a22', stool: '#b9c2c6', wood: '#8a5a36', gamer: '#1c1c22' }[th.chair] || '#333';
      if (th.chair === 'stool') return add(x + y - 0.2, () => box(x - 0.15, y - 0.15, 0.3, 0.3, 0, 7, col));
      if (back) add(x + y + 0.25, () => box(x - 0.22, y + 0.1, 0.44, 0.1, 0, th.chair === 'leather' ? 13 : 11, col));
      else add(x + y - 0.3, () => { box(x - 0.22, y - 0.28, 0.44, 0.1, 0, th.chair === 'leather' ? 17 : 15, col); if (th.chair === 'gamer') { const b = box(x - 0.22, y - 0.28, 0.44, 0.1, 0, 0, col); S.faceRect(g, b, 'L', 2, 8, 2, 6, th.trim); } });
    };

    // desks
    const hits = [];
    const recentCut = Date.now() - 7 * 864e5;
    seats.forEach((s, i) => {
      const p = company.people[i];
      if (s.desk) {
        const [dx, dy] = s.desk;
        add(dx + dy + 1.2, () => {
          if (th.layout === 'cubicles') { box(dx, dy + 0.1, 0.05, 0.9, 0, 10, '#9aa3ad'); }
          box(dx + 0.06, dy + 0.58, 0.88, 0.4, 0, 7, th.desk);
          const mons = th.monitors || 0;
          for (let m = 0; m < mons; m++) box(dx + 0.14 + m * (0.7 / mons), dy + 0.62, 0.62 / mons, 0.06, 7, 6, '#1d1f27', '#2a2d38');
          if (!mons) { const [px, py] = P(dx + 0.5, dy + 0.8, 7); g.fillStyle = '#2a2a2e'; g.fillRect(px - 1, py - 5, 2, 5); g.fillRect(px - 2, py - 1, 4, 1); g.fillStyle = '#9aa3ad'; g.fillRect(px - 1, py - 6, 3, 1); }
          const [mx, my] = P(dx + 0.75, dy + 0.9, 7);
          g.fillStyle = noise(dx, dy) > 0.5 ? '#f4f1ea' : '#6b4a2e'; g.fillRect(mx, my - 2, 2, 2);
          if (th.layout === 'cubicles') box(dx, dy + 1.0, 1, 0.06, 0, 10, '#aab2bb');
        });
      }
      chair(s.x, s.y, s.back);
      if (!p) return;
      add(s.x + s.y, () => {
        const [sx, sy] = P(s.x, s.y, 7);
        S.drawSitter(g, sx, sy, S.looks(p), s.back);
        const hx = sx, hy = sy - 24;
        if (p === selected) { g.fillStyle = '#ffd24a'; for (let rr = 0; rr < 4; rr++) g.fillRect(hx - 3 + rr, hy - 6 + rr, 7 - rr * 2, 1); }
        else if (p.lastInteraction > recentCut) { g.fillStyle = '#35c46a'; g.fillRect(hx, hy - 5, 2, 3); g.fillRect(hx, hy - 1, 2, 1); }
        hits.push({ p, x0: sx - 7, x1: sx + 7, y0: sy - 24, y1: sy + 4 });
      });
    });
    for (const f of furn) {
      add(f.x + f.y + f.w * 0.5 + 0.9, () => {
        box(f.x, f.y, f.w, f.d, 0, 8, th.desk);
        for (let i = 0; i < f.w; i++) {
          if (th.layout === 'communal' && i % 2 === 1) { const [px, py] = P(f.x + i + 0.5, f.y + f.d / 2, 8); disk(g, px, py - 3, 2, '#4f9a3f'); g.fillStyle = '#b8683e'; g.fillRect(px - 1, py - 1, 3, 2); }
          else { const [px, py] = P(f.x + i + 0.5, f.y + 0.25, 8); g.fillStyle = '#c9ccd6'; g.fillRect(px - 2, py - 3, 4, 3); g.fillStyle = '#e8eaf0'; g.fillRect(px - 2, py, 5, 1); }
        }
      });
    }

    items.sort((a, b) => a.depth - b.depth);
    for (const it of items) it.fn();
    return { canvas: c, hits, theme: th };
  }

  // ---------- office window ----------
  function open(company, ctx, selected = null) {
    const n = company.people.length;
    const th = THEMES[company.industry] || THEME_DEFAULT;
    const win = makeWindow('office', `<i style="background:${th.trim}"></i>${esc(company.name)}<em>${esc(th.name)} · ${n} ${n === 1 ? 'person' : 'people'} you know</em>`);
    const body = win.querySelector('.body');
    body.className = 'body office-body';
    body.innerHTML = '<div class="view"></div><div class="side"></div>';
    const view = body.querySelector('.view');
    const side = body.querySelector('.side');
    view.style.background = `radial-gradient(ellipse at 50% 40%, ${mix(th.wallL, '#f4efe4', 0.55)}, ${mix(th.wallL, '#1b1d26', 0.55)})`;

    const room = drawRoom(company, selected);
    const cv = room.canvas;
    view.appendChild(cv);
    const availW = Math.max(200, view.clientWidth - 16);
    const availH = Math.min(innerHeight * 0.62, 600);
    const fit = Math.min(availW / cv.width, availH / cv.height);
    const scale = Math.max(1, Math.min(4, fit >= 2 ? Math.floor(fit) : Math.floor(fit * 4) / 4));
    cv.style.width = cv.width * scale + 'px';
    cv.style.height = cv.height * scale + 'px';
    const at = (e) => {
      const rr = cv.getBoundingClientRect();
      const x = (e.clientX - rr.left) / scale, y = (e.clientY - rr.top) / scale;
      return room.hits.find((h) => x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1);
    };
    const tip = document.getElementById('tip');
    cv.addEventListener('pointermove', (e) => {
      const h = at(e);
      cv.style.cursor = h ? 'pointer' : 'default';
      if (h) {
        tip.style.display = 'block'; tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 14 + 'px';
        tip.innerHTML = `<b>${esc(h.p.name)}</b><span>${esc(h.p.title)}</span>`;
      } else tip.style.display = 'none';
    });
    cv.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
    cv.addEventListener('click', (e) => { const h = at(e); if (h) { tip.style.display = 'none'; open(company, ctx, h.p); } });

    if (selected) {
      const card = personCard(selected, ctx, '<button class="btn back">← Everyone here</button>');
      side.appendChild(card);
      card.querySelector('.back').onclick = () => open(company, ctx);
      return;
    }
    const facts = [
      ['Industry', company.industry],
      company.stage && ['Stage', company.stage],
      company.funding && ['Raised', money(company.funding)],
      company.employees && ['Team', company.employees.toLocaleString()],
      company.domain && ['Domain', company.domain],
      ['Last touch', ctx.ago(company.lastInteraction)],
    ].filter(Boolean);
    side.innerHTML = `<div class="facts">${facts.map(([k, v]) => `<div class="row"><span class="k">${k}</span><span>${esc(v)}</span></div>`).join('')}</div>
      <div class="plist">${company.people.map((p, i) =>
        `<button data-i="${i}"><span class="dot" style="background:${S.looks(p).top}"></span><span class="pn">${esc(p.name)}<small>${esc(p.title)}</small></span><span class="ago">${esc(ctx.ago(p.lastInteraction))}</span></button>`).join('')}</div>
      <div class="hint">Click anyone at their desk · <span class="g">▮</span> talked this week</div>`;
    side.querySelectorAll('.plist button').forEach((b) => { b.onclick = () => open(company, ctx, company.people[+b.dataset.i]); });
  }

  function openPerson(person, ctx) {
    const win = makeWindow('person', `<i style="background:${S.looks(person).top}"></i>${esc(person.name)}`);
    if (!win.style.left) { win.style.left = Math.max(8, innerWidth - 356) + 'px'; win.style.top = '64px'; }
    const hasOffice = !!person.company.sprite;
    const body = win.querySelector('.body');
    body.innerHTML = '';
    const card = personCard(person, ctx, hasOffice ? `<button class="btn back">Visit ${esc(person.company.name)} →</button>` : '');
    body.appendChild(card);
    if (hasOffice) card.querySelector('.back').onclick = () => { win.remove(); open(person.company, ctx, person); };
  }

  window.Office = { open, openPerson, THEMES, makeWindow };
})();
