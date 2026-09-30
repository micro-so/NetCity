// Pixel-art sprite factory. Everything is drawn in code at 1x and upscaled with
// image-rendering: pixelated. Every sprite has a day and a night canvas; night
// is the day image tinted blue plus an emissive layer (lit windows, neon, lamps).
(function () {
  const HW = 16, HH = 8, TH = 16, FLOOR = 5;
  const rng = window.NetCityData.rng;

  // ---------- color ----------
  const hex2rgb = (h) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const rgb2hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  function mix(a, b, t) { const A = hex2rgb(a), B = hex2rgb(b); return rgb2hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); }
  const shade = (h, f) => (f < 0 ? mix(h, '#000000', -f) : mix(h, '#ffffff', f));
  // Light comes from the left: left faces warm, right faces fall into cool shadow.
  const mat = (base, top) => ({
    left: mix(base, '#fff1d6', 0.05),
    right: mix(base, '#27304f', 0.38),
    top: top || mix(base, '#fff6e6', 0.22),
    rim: mix(base, '#fffaf0', 0.4),
    edge: mix(base, '#1b1f33', 0.5),
  });

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  const pickR = (r, a) => a[Math.floor(r() * a.length)];

  // ---------- primitives ----------
  const iso = (tx, ty) => [(tx - ty) * HW, (tx + ty) * HH];

  function diamond(g, x, y, color) {
    g.fillStyle = color;
    for (let r = 0; r < TH; r++) {
      const w = r < HH ? (r + 1) * 2 : (TH - r) * 2;
      g.fillRect(x - w, y + r, w * 2, 1);
    }
  }
  // Diamond with a per-pixel color function fn(px, py, row) -> color | null
  function diamondFn(g, x, y, fn) {
    for (let r = 0; r < TH; r++) {
      const w = r < HH ? (r + 1) * 2 : (TH - r) * 2;
      for (let k = -w; k < w; k++) {
        const c = fn(x + k, y + r, r, k, w);
        if (c) { g.fillStyle = c; g.fillRect(x + k, y + r, 1, 1); }
      }
    }
  }
  function disk(g, cx, cy, r, color) {
    g.fillStyle = color;
    for (let y = -r; y <= r; y++) {
      const w = Math.round(Math.sqrt(r * r - y * y + r * 0.8));
      g.fillRect(cx - w, cy + y, w * 2 + 1, 1);
    }
  }
  // A rect sheared along a face: slope +0.5 (faces running down-right) or -0.5.
  function slopeRect(g, x, yb, w, h, slope, color) {
    g.fillStyle = color;
    for (let k = 0; k < w; k++) g.fillRect(x + k, Math.round(yb + k * slope) - h, 1, h);
  }

  // Axis-aligned box in tile space, filled column by column for crisp edges.
  function isoBox(g, ox, oy, tx, ty, w, d, z, h, m) {
    const P = (x, y) => [ox + (x - y) * HW, oy + (x + y) * HH - z];
    const A = P(tx, ty), B = P(tx + w, ty), C = P(tx + w, ty + d), D = P(tx, ty + d);
    const x0 = Math.round(D[0]), xc = Math.round(C[0]), x1 = Math.round(B[0]);
    h = Math.round(h);
    if (h > 0) {
      g.fillStyle = m.left;
      for (let x = x0; x < xc; x++) g.fillRect(x, Math.round(D[1] + (x - D[0]) / 2) - h, 1, h);
      g.fillStyle = m.right;
      for (let x = xc; x < x1; x++) g.fillRect(x, Math.round(C[1] - (x - C[0]) / 2) - h, 1, h);
    }
    g.fillStyle = m.top;
    for (let x = x0; x < x1; x++) {
      const yt = x <= A[0] ? A[1] + (A[0] - x) / 2 : A[1] + (x - A[0]) / 2;
      const yb = x <= C[0] ? D[1] + (x - D[0]) / 2 : C[1] - (x - C[0]) / 2;
      g.fillRect(x, Math.round(yt) - h, 1, Math.max(1, Math.round(yb - yt)));
    }
    if (h > 1 && m.edge) {
      g.fillStyle = m.edge; g.fillRect(xc, Math.round(C[1]) - h, 1, h);
      g.fillStyle = m.rim;
      for (let x = x0; x < xc; x++) g.fillRect(x, Math.round(D[1] + (x - D[0]) / 2) - h, 1, 1);
    }
    return { A, B, C, D, h, x0, xc, x1, lenL: xc - x0, lenR: x1 - xc };
  }
  // Rect on a box face. side 'L' (front-left) or 'R' (front-right); u = px along the
  // face from its left end; zz = px above the box base (bottom of the rect).
  function faceRect(g, bx, side, u, zz, w, h, color) {
    if (side === 'L') {
      const x = bx.x0 + u;
      slopeRect(g, x, bx.D[1] + (x - bx.D[0]) / 2 - zz, w, h, 0.5, color);
    } else {
      const x = bx.xc + u;
      slopeRect(g, x, bx.C[1] - (x - bx.C[0]) / 2 - zz, w, h, -0.5, color);
    }
  }

  // ---------- layers ----------
  function newLayer(w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ec = document.createElement('canvas'); ec.width = w; ec.height = h;
    return { c, g: c.getContext('2d'), ec, e: ec.getContext('2d'), w, h };
  }

  const NIGHT = { mul: [0.24, 0.28, 0.44], add: [8, 12, 34] };
  const NIGHT_SOFT = { mul: [0.42, 0.44, 0.6], add: [10, 14, 36] };
  function nightify(src, emis, opts = NIGHT, glow = 0.55) {
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    if (c.width && c.height) {
      const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = d[i] * opts.mul[0] + opts.add[0];
        d[i + 1] = d[i + 1] * opts.mul[1] + opts.add[1];
        d[i + 2] = d[i + 2] * opts.mul[2] + opts.add[2];
      }
      g.putImageData(img, 0, 0);
    }
    if (emis) {
      g.drawImage(emis, 0, 0);
      if (glow) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = glow;
        g.filter = 'blur(2px)';
        g.drawImage(emis, 0, 0);
        g.restore();
      }
    }
    return c;
  }

  // Crop to content, build night + hit mask.
  function finalize(L, ox, oy, nightOpts, glow) {
    const pad = 4;
    const d = L.g.getImageData(0, 0, L.w, L.h).data;
    let x0 = L.w, y0 = L.h, x1 = -1, y1 = -1;
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      if (d[(y * L.w + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) { x0 = y0 = 0; x1 = y1 = 1; }
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(L.w - 1, x1 + pad); y1 = Math.min(L.h - 1, y1 + pad);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const crop = (src) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(src, -x0, -y0); return c; };
    const day = crop(L.c), emis = crop(L.ec);
    const night = nightify(day, emis, nightOpts, glow);
    const mask = day.getContext('2d').getImageData(0, 0, w, h).data;
    return {
      day, night, ox: ox - x0, oy: oy - y0, w, h,
      hit: (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[(y * w + x) * 4 + 3] > 0,
    };
  }

  // ---------- building kit ----------
  const GLASS_L = '#9cc6de', GLASS_R = '#5d7f9e', WARM = '#ffd98a', COOL = '#d8ecff';

  function kit(L, O) {
    L.bounds = { tx0: 9, ty0: 9, tx1: -9, ty1: -9, top: 0 };
    L.boxes = [];
    const raw = (tx, ty, w, d, z, h, m, prop) => {
      const b = L.bounds;
      b.tx0 = Math.min(b.tx0, tx); b.ty0 = Math.min(b.ty0, ty);
      b.tx1 = Math.max(b.tx1, tx + w); b.ty1 = Math.max(b.ty1, ty + d); b.top = Math.max(b.top, z + h);
      const bx = isoBox(L.g, O.ox, O.oy, tx, ty, w, d, z, h, m);
      bx.tx = tx; bx.ty = ty; bx.w = w; bx.d = d; bx.z = z;
      if (!prop) {
        L.boxes.push(bx);
        if (L.decal && L.decal.index === L.boxes.length - 1) paintDecal(L, O, bx);
      }
      return bx;
    };
    const box = (tx, ty, w, d, z, h, m) => raw(tx, ty, w, d, z, h, m, false);
    const pbox = (tx, ty, w, d, z, h, m) => raw(tx, ty, w, d, z, h, m, true);
    // does a roof prop footprint overlap the painted logo?
    const hitsLogo = (tx, ty, w, d) => {
      const a = L.logoArea;
      return a && tx < a.u0 + a.s && tx + w > a.u0 && ty < a.v0 + a.s && ty + d > a.v0;
    };
    const pt = (tx, ty, z) => { const [x, y] = iso(tx, ty); return [Math.round(O.ox + x), Math.round(O.oy + y - z)]; };
    const both = (fn) => { fn(L.g, false); fn(L.e, true); };

    // Grid of punched windows on both front faces.
    function windows(bx, r, o = {}) {
      const fh = o.floorH || FLOOR, ww = o.ww || 2, wh = o.wh || 3, step = o.step || 4, pad = o.pad ?? 2;
      const start = o.start || 0, top = (o.top ?? bx.h) - 1;
      const litP = o.litP ?? 0.3;
      for (const side of ['L', 'R']) {
        const len = side === 'L' ? bx.lenL : bx.lenR;
        for (let zz = start; zz + wh + 1 <= top; zz += fh) {
          for (let u = pad; u + ww <= len - pad + (o.tight ? 1 : 0); u += step) {
            if (o.frame) faceRect(L.g, bx, side, u - 1, zz, ww + 2, wh + 2, o.frame);
            faceRect(L.g, bx, side, u, zz + 1, ww, wh, side === 'L' ? (o.glass || GLASS_L) : (o.glassR || GLASS_R));
            if (o.sill) faceRect(L.g, bx, side, u, zz, ww, 1, o.sill);
            if (side === 'L' && !o.noGlint && r() < 0.25) faceRect(L.g, bx, side, u, zz + wh, 1, 1, '#e6f3fb');
            if (r() < litP) faceRect(L.e, bx, side, u, zz + 1, ww, wh, o.lit || (r() < 0.8 ? WARM : COOL));
          }
        }
      }
    }
    // Full-glass curtain wall with mullions.
    function curtain(bx, r, o = {}) {
      const fh = o.floorH || FLOOR, step = o.step || 4;
      for (const side of ['L', 'R']) {
        const len = side === 'L' ? bx.lenL : bx.lenR;
        faceRect(L.g, bx, side, 1, 1, len - 2, bx.h - 2, side === 'L' ? (o.glass || GLASS_L) : (o.glassR || GLASS_R));
        for (let zz = 0; zz < bx.h - 1; zz += fh) {
          faceRect(L.g, bx, side, 1, zz, len - 2, 1, o.frame);
          for (let u = 1; u < len - 1; u += step) {
            if (r() < (o.litP ?? 0.3)) faceRect(L.e, bx, side, u + 1, zz + 1, Math.min(step - 1, len - 2 - u), fh - 1, o.lit || (r() < 0.75 ? WARM : COOL));
          }
        }
        for (let u = 1; u < len - 1; u += step) faceRect(L.g, bx, side, u, 1, 1, bx.h - 2, o.mullion || o.frame);
        if (side === 'L') for (let u = 2; u < len - 2; u += 7) faceRect(L.g, bx, side, u, Math.floor(bx.h * 0.6), 2, 1, '#eef7fc');
      }
    }
    function neonRim(bx, color, zz) {
      both((g, e) => {
        faceRect(g, bx, 'L', 0, zz ?? bx.h - 1, bx.lenL, 1, e ? color : mix(color, '#ffffff', 0.2));
        faceRect(g, bx, 'R', 0, zz ?? bx.h - 1, bx.lenR, 1, e ? color : mix(color, '#000000', 0.2));
      });
    }
    function antenna(tx, ty, z, h) {
      const [x, y] = pt(tx, ty, z);
      L.g.fillStyle = '#3a3d48'; L.g.fillRect(x, y - h, 1, h);
      L.g.fillStyle = '#d23a3a'; L.g.fillRect(x, y - h - 1, 1, 1);
      L.e.fillStyle = '#ff5050'; L.e.fillRect(x - 1, y - h - 2, 3, 3);
    }
    function acUnits(bx, r, count) {
      const lr = rng(Math.round(bx.tx * 1000 + bx.ty * 77 + bx.h * 13));
      for (let i = 0, placed = 0; i < 12 && placed < count; i++) {
        const u = 0.08 + lr() * Math.max(0.05, bx.w - 0.4), v = 0.08 + lr() * Math.max(0.05, bx.d - 0.34);
        if (hitsLogo(bx.tx + u, bx.ty + v, 0.28, 0.22)) continue;
        pbox(bx.tx + u, bx.ty + v, 0.28, 0.22, bx.z + bx.h, 3, mat('#a9adb3'));
        placed++;
      }
    }
    function waterTank(tx, ty, z) {
      const [x, y] = pt(tx + 0.17, ty + 0.17, z);
      L.g.fillStyle = '#3a2e26';
      L.g.fillRect(x - 3, y - 4, 1, 4); L.g.fillRect(x + 3, y - 4, 1, 4); L.g.fillRect(x, y - 3, 1, 3);
      pbox(tx, ty, 0.36, 0.36, z + 4, 8, mat('#8e5c38'));
      const b2 = pbox(tx + 0.02, ty + 0.02, 0.32, 0.32, z + 12, 1, mat('#5a3a24'));
      faceRect(L.g, b2, 'L', 0, -3, b2.lenL, 1, '#5a3a24');
      pbox(tx + 0.1, ty + 0.1, 0.16, 0.16, z + 13, 2, mat('#6b4a2e'));
    }
    function helipad(bx) {
      const cx = bx.tx + bx.w / 2, cy = bx.ty + bx.d / 2, z = bx.z + bx.h;
      pbox(cx - 0.42, cy - 0.42, 0.84, 0.84, z, 1, mat('#3b4048', '#454b55'));
      const [x, y] = pt(cx, cy, z + 1);
      L.g.fillStyle = '#f2f2f2';
      L.g.fillRect(x - 3, y - 2, 1, 5); L.g.fillRect(x + 3, y - 2, 1, 5); L.g.fillRect(x - 2, y, 5, 1);
      both((g, e) => { g.fillStyle = e ? '#ffd24a' : '#e9c34a'; g.fillRect(x - 8, y, 1, 1); g.fillRect(x + 8, y, 1, 1); g.fillRect(x, y - 4, 1, 1); g.fillRect(x, y + 4, 1, 1); });
    }
    function solar(bx, r) {
      const z = bx.z + bx.h;
      for (let i = 0; i < 3; i++) {
        const u = 0.15 + i * (bx.w - 0.3) / 3;
        pbox(bx.tx + u, bx.ty + 0.15, (bx.w - 0.3) / 3 - 0.06, bx.d * 0.45, z, 2, mat('#2d3f6b', '#4a6aa8'));
      }
    }
    function greenRoof(bx, r, trees) {
      pbox(bx.tx + 0.06, bx.ty + 0.06, bx.w - 0.12, bx.d - 0.12, bx.z + bx.h, 1, mat('#5f9e46', '#6fae4f'));
      for (let i = 0; i < 6; i++) {
        const [x, y] = pt(bx.tx + 0.2 + r() * (bx.w - 0.4), bx.ty + 0.2 + r() * (bx.d - 0.4), bx.z + bx.h + 1);
        L.g.fillStyle = r() < 0.5 ? '#3f7f36' : '#8cc063'; L.g.fillRect(x, y - 1, 2, 2);
      }
      for (let i = 0; i < (trees || 0); i++) {
        const [x, y] = pt(bx.tx + 0.25 + r() * (bx.w - 0.5), bx.ty + 0.25 + r() * (bx.d - 0.5), bx.z + bx.h + 1);
        disk(L.g, x, y - 5, 3, '#2f6f33'); disk(L.g, x - 1, y - 6, 2, '#4a9443');
      }
    }
    function billboard(tx, ty, z, w, color, r) {
      const [x0, y0] = pt(tx, ty, z);
      L.g.fillStyle = '#3a3d48';
      L.g.fillRect(x0 + 3, y0 - 6, 1, 6); L.g.fillRect(x0 + Math.round(w * HW) - 4, y0 - 6 + Math.round(w * HH) - 1, 1, 6);
      const bx = pbox(tx, ty + 0.05, w, 0.06, z + 6, 11, mat('#2a2c34'));
      faceRect(L.g, bx, 'L', 1, 1, bx.lenL - 2, 9, color);
      faceRect(L.g, bx, 'L', 3, 5, Math.max(2, bx.lenL - 12), 2, '#ffffff');
      faceRect(L.g, bx, 'L', 3, 2, Math.max(2, bx.lenL - 18), 1, mix(color, '#ffffff', 0.6));
      faceRect(L.e, bx, 'L', 1, 1, bx.lenL - 2, 9, mix(color, '#ffffff', 0.15));
    }
    return { box, pbox, pt, windows, curtain, neonRim, antenna, acUnits, waterTank, helipad, solar, greenRoof, billboard, both };
  }

  const center = (w, d) => [(2 - w) / 2, (2 - d) / 2];
  // floors = people you know, growing logarithmically past 30 so giants don't break the skyline
  const floorsOf = (n) => (n <= 30 ? n : Math.min(70, 30 + Math.round(14 * Math.log(n / 30))));

  // ---------- architecture by industry ----------
  const ARCH = {
    'Venture Capital'(K, n, r) {
      const stone = pickR(r, ['#ddcca6', '#e3d6b8', '#d6c29a']), gold = '#d9ae4c', cornice = mix(stone, '#ffffff', 0.25);
      const pil = (bx, from, to) => {
        for (const side of ['L', 'R']) {
          const len = side === 'L' ? bx.lenL : bx.lenR;
          for (let u = 2; u < len - 2; u += 3) {
            K.both((g, e) => { if (!e || r() < 0.4) faceRect(g, bx, side, u, from, 1, to - from, e ? WARM : side === 'L' ? '#7d6c52' : '#5a4e40'); });
          }
        }
      };
      if (n <= 2) {
        const w = 1.3, [t] = center(w, w), h = 13;
        const b = K.box(t, t, w, w, 0, h, mat(stone));
        pil(b, 2, h - 3);
        K.box(t - 0.08, t - 0.08, w + 0.16, w + 0.16, h, 2, mat(cornice));
        K.box(t + 0.15, t + 0.15, w - 0.3, w - 0.3, h + 2, 2, mat(cornice));
        FR(b, 'L', 8, 0, 3, 5, '#6b4a24');
        return;
      }
      const F = floorsOf(n), H = F * FLOOR + 4;
      const w = 1.8, [t] = center(w, w);
      const podH = Math.min(H, 16);
      const pod = K.box(t, t, w, w, 0, podH, mat(stone));
      pil(pod, 2, podH - 3);
      K.box(t - 0.06, t - 0.06, w + 0.12, w + 0.12, podH, 2, mat(cornice));
      let z = podH + 2, rest = H - podH;
      if (rest <= 0) { K.box(t + 0.3, t + 0.3, w - 0.6, w - 0.6, z, 3, mat(gold)); return; }
      const tiers = F >= 12 ? [0.62, 0.25, 0.13] : [1];
      let inset = 0.18;
      for (const f of tiers) {
        const h = Math.max(5, Math.round(rest * f));
        const b = K.box(t + inset, t + inset, w - inset * 2, w - inset * 2, z, h, mat(stone));
        K.windows(b, r, { ww: 1, wh: 3, step: 3, sill: '#b7a47e', glass: '#4f6a86', glassR: '#35485f', litP: 0.35 });
        z += h;
        K.box(t + inset - 0.04, t + inset - 0.04, w - inset * 2 + 0.08, w - inset * 2 + 0.08, z, 1, mat(cornice));
        z += 1;
        inset += 0.12;
      }
      if (F >= 12) {
        for (let i = 0; i < 2; i++) { const s = inset - 0.06 + i * 0.06; K.box(t + s, t + s, w - s * 2, w - s * 2, z, 3, mat(gold)); z += 3; }
        K.antenna(t + inset + 0.1, t + inset + 0.1, z, 10);
      } else K.box(t + inset, t + inset, w - inset * 2, w - inset * 2, z, 2, mat(gold));
    },

    'AI / ML'(K, n, r) {
      const dark = '#2c3047', neon = '#b490ff';
      if (n <= 2) {
        const w = 0.95, [t] = center(w, w);
        const b = K.box(t, t, w, w, 0, 20, mat(dark, '#3a3f5c'));
        K.neonRim(b, neon); K.neonRim(b, neon, 1);
        return;
      }
      const F = floorsOf(n), H = F * FLOOR + 2;
      const tower = (tx, ty, w, d, h) => {
        const b = K.box(tx, ty, w, d, 0, h, mat(dark, '#3b405e'));
        K.curtain(b, r, { frame: '#23273a', glass: '#4a5378', glassR: '#2f3552', step: 3, litP: 0.3, lit: COOL });
        for (let zz = FLOOR * 4; zz < h - 2; zz += FLOOR * 4) K.neonRim(b, neon, zz);
        K.neonRim(b, neon);
        const cap = K.box(tx + 0.1, ty + 0.1, w - 0.2, d - 0.2, h, 3, mat('#23273a'));
        return cap;
      };
      if (n >= 12 && r() < 0.6) {
        tower(0.2, 0.35, 0.7, 0.75, H);
        const cap = tower(1.05, 0.9, 0.7, 0.75, Math.round(H * 0.72));
        K.antenna(0.55, 0.72, H + 3, 12);
        K.acUnits(cap, r, 1);
      } else {
        const w = 1.45, [t] = center(w, w);
        const cap = tower(t, t, w, w, H);
        K.antenna(t + 0.22, t + 0.22, H + 3, 8 + Math.round(r() * 8));
        K.box(t + 0.3, t + 0.35, 0.18, 0.18, H + 3, 2, mat('#c9ccd6'));
        K.acUnits(cap, r, 1);
      }
    },

    'Fintech'(K, n, r) {
      const glass = '#6fb3b8', frame = '#eef3f1';
      if (n <= 2) {
        const w = 1.35, [t] = center(w, w);
        const b = K.box(t, t, w, w, 0, 11, mat(glass));
        K.curtain(b, r, { frame, glass: '#8fd0d2', glassR: '#4f8f96', step: 5, litP: 0.4, floorH: 11 });
        K.box(t - 0.12, t - 0.12, w + 0.24, w + 0.24, 11, 2, mat('#f4f6f5'));
        return;
      }
      const F = floorsOf(n), H = F * FLOOR + 2;
      const tiers = F >= 9 ? [0.5, 0.3, 0.2] : [1];
      let z = 0, w = 1.8;
      let last;
      for (const f of tiers) {
        const h = Math.max(6, Math.round(H * f));
        const [t] = center(w, w);
        last = K.box(t, t, w, w, z, h, mat(glass));
        K.curtain(last, r, { frame, glass: '#8fd0d2', glassR: '#4f8f96', step: 6, litP: 0.3 });
        z += h;
        w -= 0.35;
      }
      K.acUnits(last, r, 2);
    },

    'Developer Tools'(K, n, r) {
      const brick = pickR(r, ['#a9573f', '#9c4f3a', '#b3654a']), trim = '#e9dfcc';
      if (n <= 2) {
        const w = 1.6, d = 1.25, [tx, ty] = center(w, d);
        const b = K.box(tx, ty, w, d, 0, 12, mat(brick));
        FR(b, 'L', 4, 0, 14, 8, '#b9bcc2');
        for (let k = 1; k < 8; k += 2) FR(b, 'L', 4, k, 14, 1, '#8e9197');
        K.windows(b, r, { ww: 3, wh: 4, step: 6, pad: 3, start: 3, frame: trim, glass: '#3e5266', glassR: '#2c3a48', litP: 0.4 });
        K.box(tx - 0.03, ty - 0.03, w + 0.06, d + 0.06, 12, 2, mat(mix(brick, '#000000', 0.2)));
        return;
      }
      const F = floorsOf(n), H = F * 6 + 3;
      let w = 1.8, d = 1.45;
      if (r() < 0.5) [w, d] = [d, w];
      const [tx, ty] = center(w, d);
      const b = K.box(tx, ty, w, d, 0, H, mat(brick));
      K.windows(b, r, { floorH: 6, ww: 3, wh: 4, step: 5, pad: 2, frame: mix(brick, '#ffffff', 0.25), sill: trim, glass: '#44596e', glassR: '#2e3d4c', litP: 0.35 });
      // fire escape on the right face
      for (let zz = 6; zz < H - 3; zz += 6) {
        FR(b, 'R', 3, zz - 1, 9, 1, '#24262c');
        FR(b, 'R', 3 + ((zz / 6) % 2 ? 1 : 6), zz - 5, 1, 5, '#24262c');
      }
      K.box(tx - 0.04, ty - 0.04, w + 0.08, d + 0.08, H, 2, mat(mix(brick, '#000000', 0.25)));
      if (F >= 3) K.waterTank(tx + w - 0.55, ty + 0.15, H + 2);
      if (r() < 0.6) K.acUnits({ tx, ty, w: w * 0.5, d: d * 0.6, z: 0, h: H + 2 }, r, 1);
    },

    'Healthcare'(K, n, r) {
      const white = '#eef0ec', glass = '#7fbccb';
      if (n <= 2) {
        const w = 1.5, d = 1.2, [tx, ty] = center(w, d);
        const b = K.box(tx, ty, w, d, 0, 12, mat(white));
        K.windows(b, r, { ww: 5, wh: 2, step: 7, pad: 3, start: 1, glass, glassR: '#4f8595' });
        K.box(tx + 0.3, ty + d, 0.5, 0.18, 6, 1, mat('#4fa3a0'));
        return;
      }
      const F = floorsOf(n), H = F * FLOOR + 3;
      const w = 1.8, d = 1.6, [tx, ty] = center(w, d);
      const b = K.box(tx, ty, w, d, 0, H, mat(white));
      K.windows(b, r, { ww: 3, wh: 2, step: 4, pad: 2, tight: true, glass, glassR: '#4f8595', litP: 0.35, noGlint: true });
      for (const side of ['L', 'R']) {
        const len = side === 'L' ? b.lenL : b.lenR;
        for (let u = 1; u < len; u += 12) FR(b, side, u, 0, 2, H, side === 'L' ? '#fbfbf8' : '#b9c2c6');
      }
      K.box(tx + 0.4, ty + d, 0.7, 0.2, 7, 1, mat('#4fa3a0'));
      K.acUnits(b, r, 2);
      const u = Math.round(b.lenL / 2) - 3, zz = H - 10;
      FR(b, 'L', u, zz, 7, 7, '#ffffff');
      K.both((g, e) => { faceRect(g, b, 'L', u + 3, zz + 1, 1, 5, e ? '#ff5a5a' : '#d8373a'); faceRect(g, b, 'L', u + 1, zz + 3, 5, 1, e ? '#ff5a5a' : '#d8373a'); });
    },

    'Consumer'(K, n, r) {
      const pastel = pickR(r, ['#f2a7a0', '#f5cf7a', '#9fd3c7', '#b9a7e0', '#f7b6d2', '#a8d08d', '#f6b98a']);
      const stripe = pickR(r, ['#d8433b', '#2f6db3', '#2f8f5b', '#1f1f24']);
      const F = floorsOf(n), H = n <= 2 ? 13 : F * FLOOR + 8;
      let w = n <= 2 ? 1.4 : 1.7, d = n <= 2 ? 1.2 : 1.6;
      if (r() < 0.5) [w, d] = [d, w];
      const [tx, ty] = center(w, d);
      const b = K.box(tx, ty, w, d, 0, H, mat(pastel));
      // storefront
      for (const side of ['L', 'R']) {
        const len = side === 'L' ? b.lenL : b.lenR;
        FR(b, side, 1, 1, len - 2, 6, side === 'L' ? '#bfe0ee' : '#6e8ea3');
        for (let u = 1; u < len - 1; u += 5) FR(b, side, u, 1, 1, 6, '#2a2a2e');
        for (let u = 2; u < len - 2; u += 3) if (r() < 0.6) FRE(b, side, u, 1, 2, 5, WARM);
      }
      // striped awnings
      const aw = (side) => {
        const a = side === 'L' ? K.box(tx, ty + d, w, 0.16, 7, 2, mat('#f4f1ea')) : K.box(tx + w, ty, 0.16, d, 7, 2, mat('#f4f1ea'));
        const len = side === 'L' ? a.lenL : a.lenR;
        for (let u = 0; u < len; u += 4) FR(a, side, u, 0, 2, 2, stripe);
      };
      aw('L'); aw('R');
      if (H > 14) {
        K.windows(b, r, { start: 9, top: H - 2, ww: 2, wh: 3, step: 5, pad: 3, frame: '#ffffff', litP: 0.35 });
        for (let zz = 9 + FLOOR; zz < H - 3; zz += FLOOR * 2) {
          FR(b, 'L', 2, zz, b.lenL - 4, 1, '#ffffff');
          FR(b, 'R', 2, zz, b.lenR - 4, 1, '#d9d9e0');
        }
      }
      K.box(tx - 0.03, ty - 0.03, w + 0.06, d + 0.06, H, 2, mat(mix(pastel, '#ffffff', 0.4)));
      if (n >= 4 && r() < 0.8) K.billboard(tx + 0.15, ty + 0.15, H + 2, Math.min(1.2, w - 0.3), stripe, r);
    },

    'Climate'(K, n, r) {
      const timber = pickR(r, ['#c9975f', '#b98a55', '#d3a46c']);
      const slats = (bx) => {
        for (const side of ['L', 'R']) {
          const len = side === 'L' ? bx.lenL : bx.lenR;
          for (let u = 1; u < len - 1; u += 2) FR(bx, side, u, 0, 1, bx.h, side === 'L' ? mix(timber, '#000000', 0.12) : mix(timber, '#1b2140', 0.45));
        }
      };
      if (n <= 2) {
        const w = 1.3, d = 1.2, [tx, ty] = center(w, d);
        const b = K.box(tx, ty, w, d, 0, 10, mat(timber));
        slats(b);
        K.windows(b, r, { ww: 4, wh: 4, step: 8, pad: 3, start: 2, glass: '#a9d3e0', litP: 0.5, noGlint: true });
        return;
      }
      const F = floorsOf(n), H = F * FLOOR + 2;
      const tiers = F >= 8 ? [0.45, 0.33, 0.22] : [1];
      let z = 0, w = 1.8, d = 1.7, last;
      for (const f of tiers) {
        const h = Math.max(6, Math.round(H * f));
        const [tx, ty] = center(w, d);
        last = K.box(tx, ty, w, d, z, h, mat(timber));
        slats(last);
        K.windows(last, r, { ww: 3, wh: 3, step: 5, pad: 2, glass: '#a9d3e0', glassR: '#5f8594', litP: 0.35, noGlint: true });
        for (let zz = FLOOR; zz < h - 1; zz += FLOOR * 2) {
          for (let u = 2; u < last.lenL - 2; u += 6) FR(last, 'L', u, zz, 2, 1, '#4f9a3f');
        }
        z += h;
        if (tiers.length > 1) K.greenRoof({ ...last, z: z - h, h }, r, 2);
        w -= 0.35; d -= 0.35;
      }
      if (F >= 10) {
        const [x, y] = K.pt(last.tx + 0.22, last.ty + 0.22, z + 1);
        const g = CUR.g;
        g.fillStyle = '#e9edf0'; g.fillRect(x, y - 22, 1, 22);
        g.fillRect(x - 1, y - 23, 3, 2);
        g.fillRect(x - 6, y - 26, 5, 1); g.fillRect(x + 2, y - 21, 5, 1); g.fillRect(x, y - 30, 1, 7);
      }
    },

    'Enterprise SaaS'(K, n, r) {
      const concrete = pickR(r, ['#a9a79f', '#b3b0a6', '#9d9b94']);
      const deep = (bx) => K.windows(bx, r, { ww: 2, wh: 3, step: 4, pad: 2, frame: mix(concrete, '#000000', 0.35), glass: '#3d4a5c', glassR: '#2b3442', litP: 0.3, noGlint: true });
      if (n <= 2) {
        const w = 1.4, [t] = center(w, w);
        const b = K.box(t, t, w, w, 0, 10, mat(concrete));
        deep(b);
        return;
      }
      const F = floorsOf(n), H = F * FLOOR + 3;
      const dark = mix(concrete, '#000000', 0.45);
      // concrete spandrel bands every few floors break up the window grid
      const bands = (bx) => {
        for (let zz = FLOOR * 4; zz < bx.h - 3; zz += FLOOR * 4) {
          FR(bx, 'L', 0, zz, bx.lenL, 2, mix(concrete, '#ffffff', 0.18));
          FR(bx, 'R', 0, zz, bx.lenR, 2, mix(concrete, '#1b2140', 0.25));
        }
      };
      if (F < 8) {
        const w = 1.7, [t] = center(w, w);
        const b = K.box(t, t, w, w, 0, H, mat(concrete));
        deep(b); bands(b);
        K.acUnits(b, r, 2);
        return;
      }
      // cantilever: a recessed glass lobby on pilotis, the office block overhanging it
      const baseH = Math.max(12, Math.round(H * 0.18));
      const bw = 1.25, [bt] = center(bw, bw);
      const lobby = K.box(bt, bt, bw, bw, 0, baseH, mat('#4a5a6c'));
      K.curtain(lobby, r, { frame: '#2a3340', glass: '#7fa6c0', glassR: '#46607a', step: 5, floorH: baseH, litP: 0.6 });
      // shadow cast by the overhang onto the lobby
      for (const side of ['L', 'R']) {
        const len = side === 'L' ? lobby.lenL : lobby.lenR;
        FR(lobby, side, 0, baseH - 5, len, 5, side === 'L' ? '#1f2633' : '#171c26');
      }
      const w = 1.85, [t] = center(w, w);
      // pilotis at the overhang corners
      for (const [cx, cy] of [[t + 0.05, t + w - 0.15], [t + w - 0.15, t + w - 0.15], [t + w - 0.15, t + 0.05]]) K.pbox(cx, cy, 0.1, 0.1, 0, baseH, mat(dark));
      const top = K.box(t, t, w, w, baseH, H - baseH, mat(concrete));
      deep(top); bands(top);
      FR(top, 'L', 0, 0, top.lenL, 2, dark);
      FR(top, 'R', 0, 0, top.lenR, 2, mix(dark, '#000000', 0.3));
      const pw = 0.9, [pt] = center(pw, pw);
      const pent = K.box(pt + 0.2, pt, pw, pw * 0.8, H, 6, mat(mix(concrete, '#ffffff', 0.1)));
      void pent;
      K.acUnits(top, r, 2);
    },

    'Media'(K, n, r) {
      const deco = pickR(r, ['#7d3242', '#2f4058', '#44395e']);
      const fins = (bx) => {
        for (const side of ['L', 'R']) {
          const len = side === 'L' ? bx.lenL : bx.lenR;
          for (let u = 1; u < len; u += 4) FR(bx, side, u, 0, 1, bx.h, side === 'L' ? mix(deco, '#ffffff', 0.35) : mix(deco, '#ffffff', 0.12));
        }
      };
      const F = floorsOf(n), H = n <= 2 ? 14 : F * FLOOR + 6;
      const w = n <= 2 ? 1.35 : 1.75, [t] = center(w, w);
      const low = F >= 12 ? Math.round(H * 0.65) : H;
      const b = K.box(t, t, w, w, 0, low, mat(deco));
      K.windows(b, r, { ww: 2, wh: 3, step: 4, pad: 2, start: 9, glass: '#c7a86a', glassR: '#8a6e3e', lit: '#ffcf6a', litP: 0.45, noGlint: true });
      fins(b);
      // marquee with bulbs
      const mq = K.box(t, t + w, w, 0.14, 5, 4, mat('#1d1d22'));
      for (let u = 1; u < mq.lenL; u += 2) K.both((g, e) => faceRect(g, mq, 'L', u, 1, 1, 1, e ? '#ffe27a' : '#e9d9a0'));
      FR(mq, 'L', 2, 2, mq.lenL - 4, 1, '#ffffff');
      if (F >= 12) {
        const up = K.box(t + 0.3, t + 0.3, w - 0.6, w - 0.6, low, H - low, mat(deco));
        K.windows(up, r, { ww: 2, wh: 3, step: 4, pad: 2, glass: '#c7a86a', glassR: '#8a6e3e', lit: '#ffcf6a', litP: 0.45, noGlint: true });
        fins(up);
        K.antenna(t + 0.42, t + 0.42, H, 14);
      } else if (n >= 3) K.billboard(t + 0.1, t + 0.2, low, Math.min(1.3, w - 0.2), pickR(r, ['#f2c14e', '#e0643a', '#4fb3bf']), r);
    },

    'Crypto'(K, n, r) {
      const black = '#24242c', orange = '#ff8b2e';
      const F = floorsOf(n), H = n <= 2 ? 12 : F * FLOOR + 4;
      const steps = n <= 2 ? 2 : Math.min(5, 2 + Math.floor(F / 5));
      let z = 0, w = n <= 2 ? 1.4 : 1.8;
      for (let i = 0; i < steps; i++) {
        const h = Math.max(4, Math.round(H / steps));
        const [t] = center(w, w);
        const b = K.box(t, t, w, w, z, h, mat(black, '#34343f'));
        K.windows(b, r, { ww: 1, wh: 2, step: 3, pad: 2, glass: '#3a3a46', glassR: '#2a2a33', lit: orange, litP: 0.35, noGlint: true });
        K.neonRim(b, orange);
        z += h; w -= 0.3;
      }
      void z;
    },

    'Other'(K, n, r) {
      const F = floorsOf(n), H = Math.max(10, F * FLOOR + 2);
      const w = 1.6, [t] = center(w, w);
      const b = K.box(t, t, w, w, 0, H, mat('#b8b2a6'));
      K.windows(b, r, {});
    },
  };

  // Archetypes draw onto the layer currently being built.
  let CUR = null;
  const FR = (...a) => faceRect(CUR.g, ...a);
  const FRE = (...a) => faceRect(CUR.e, ...a);

  // ---------- logos ----------
  const FONT = {
    A: [14, 17, 31, 17, 17], B: [30, 17, 30, 17, 30], C: [15, 16, 16, 16, 15], D: [30, 17, 17, 17, 30], E: [31, 16, 30, 16, 31],
    F: [31, 16, 30, 16, 16], G: [15, 16, 19, 17, 15], H: [17, 17, 31, 17, 17], I: [31, 4, 4, 4, 31], J: [7, 1, 1, 17, 14],
    K: [17, 18, 28, 18, 17], L: [16, 16, 16, 16, 31], M: [17, 27, 21, 17, 17], N: [17, 25, 21, 19, 17], O: [14, 17, 17, 17, 14],
    P: [30, 17, 30, 16, 16], Q: [14, 17, 21, 18, 13], R: [30, 17, 30, 18, 17], S: [15, 16, 14, 1, 30], T: [31, 4, 4, 4, 4],
    U: [17, 17, 17, 17, 14], V: [17, 17, 17, 10, 4], W: [17, 17, 21, 27, 17], X: [17, 10, 4, 10, 17], Y: [17, 10, 4, 4, 4], Z: [31, 2, 4, 8, 31],
  };
  const BRAND = ['#e0643a', '#2c5f8a', '#1d1b16', '#35a36b', '#7a5af5', '#f2b31e', '#e84a7f', '#0f9fb0', '#ff7a1a', '#3b5bdb', '#c2410c', '#14532d'];
  function glyph(g, ch, x, y, sc, color) {
    const rows = FONT[ch] || FONT.O;
    g.fillStyle = color;
    rows.forEach((bits, ry) => { for (let cx = 0; cx < 5; cx++) if (bits & (16 >> cx)) g.fillRect(x + cx * sc, y + ry * sc, sc, sc); });
  }
  // A startup-style mark: monogram on a tile, circle, ring or split background.
  function makeLogo(company) {
    const c = document.createElement('canvas'); c.width = 16; c.height = 16;
    const g = c.getContext('2d');
    if (company.logoImg) { g.imageSmoothingEnabled = true; g.drawImage(company.logoImg, 0, 0, 16, 16); return c; }
    const h = hash(company.name), r = rng(h);
    const col = BRAND[h % BRAND.length], ch = (company.name.match(/[A-Za-z]/) || ['N'])[0].toUpperCase();
    const style = (h >>> 5) % 5;
    const light = ['#f2b31e', '#ff7a1a'].includes(col);
    const ink = light ? '#1d1b16' : '#ffffff';
    if (style === 0) { g.fillStyle = col; g.fillRect(1, 1, 14, 14); g.clearRect(1, 1, 1, 1); g.clearRect(14, 1, 1, 1); g.clearRect(1, 14, 1, 1); g.clearRect(14, 14, 1, 1); glyph(g, ch, 3, 3, 2, ink); }
    else if (style === 1) { disk(g, 8, 8, 7, col); glyph(g, ch, 3, 3, 2, ink); }
    else if (style === 2) { disk(g, 8, 8, 7, col); disk(g, 8, 8, 5, '#ffffff'); glyph(g, ch, 6, 6, 1, col); g.fillStyle = col; g.fillRect(7, 7, 0, 0); }
    else if (style === 3) {
      const c2 = BRAND[(h >>> 9) % BRAND.length] === col ? '#1d1b16' : BRAND[(h >>> 9) % BRAND.length];
      for (let y = 1; y < 15; y++) { g.fillStyle = col; g.fillRect(1, y, 15 - y, 1); g.fillStyle = c2; g.fillRect(16 - y, y, y - 1, 1); }
      glyph(g, ch, 3, 3, 2, '#ffffff');
    } else {
      g.fillStyle = '#ffffff'; g.fillRect(1, 1, 14, 14);
      g.fillStyle = col;
      const m = Math.floor(r() * 3);
      if (m === 0) { for (let i = 0; i < 3; i++) g.fillRect(3 + i * 4, 3 + (2 - i) * 3, 3, 10 - (2 - i) * 3); }
      else if (m === 1) { for (let y = 0; y < 10; y++) g.fillRect(8 - Math.ceil(y / 2), 3 + y, Math.ceil(y / 2) * 2 + 1, 1); }
      else { disk(g, 6, 8, 3, col); g.fillStyle = mix(col, '#1d1b16', 0.35); g.fillRect(9, 5, 4, 7); }
    }
    return c;
  }
  // Paint the logo flat onto a roof, projected into iso space.
  function paintDecal(L, O, bx) {
    const logo = L.decal.logo;
    const s = Math.max(0.45, Math.min(1.1, Math.min(bx.w, bx.d) * 0.64));
    const u0 = bx.tx + (bx.w - s) / 2 + 0.03, v0 = bx.ty + (bx.d - s) / 2 + 0.03;
    const z = bx.z + bx.h;
    const x = O.ox + (u0 - v0) * HW, y = O.oy + (u0 + v0) * HH - z;
    for (const [g, a] of [[L.g, 1], [L.e, 0.45]]) {
      g.save();
      g.imageSmoothingEnabled = false;
      g.globalAlpha = a;
      g.setTransform((HW * s) / 16, (HH * s) / 16, (-HW * s) / 16, (HH * s) / 16, x, y);
      g.drawImage(logo, 0, 0);
      g.restore();
    }
    L.logoArea = { u0, v0, s };
  }
  const facadeSize = (bx) => { const s = Math.max(0.45, Math.min(0.8, Math.min(bx.w, bx.d) * 0.5)); return { s, px: Math.round(s * 16) }; };
  const signArea = (bx) => { const s = Math.max(0.5, Math.min(0.95, bx.w * 0.55)); return { u0: bx.tx + (bx.w - s) / 2, v0: bx.ty + bx.d - 0.34, s, sd: 0.24 }; };
  // Upright sign on posts at the front edge of the roof, facing the street.
  function paintSign(L, O, K, bx, logo) {
    const a = signArea(bx), z = bx.z + bx.h, post = 4, hpx = Math.round(a.s * 16);
    const [p1x, p1y] = K.pt(a.u0 + 0.08, a.v0 + 0.12, z), [p2x, p2y] = K.pt(a.u0 + a.s - 0.08, a.v0 + 0.12, z);
    L.g.fillStyle = '#3a3d48';
    L.g.fillRect(p1x, p1y - post, 1, post); L.g.fillRect(p2x, p2y - post, 1, post);
    const panel = K.pbox(a.u0 - 0.04, a.v0 + 0.1, a.s + 0.08, 0.05, z + post, hpx + 2, mat('#f6f1e6'));
    drawOnFace(L, panel, logo, 1, 1, a.s, hpx, 0.85);
  }
  // Mounted near the top of the building's front-left face.
  function paintFacade(L, bx, logo) {
    const { s, px } = facadeSize(bx);
    const u = Math.round((bx.lenL - s * 16) / 2), zz = bx.h - px - 4;
    faceRect(L.g, bx, 'L', u - 1, zz - 1, Math.round(s * 16) + 2, px + 2, '#2f323c');
    drawOnFace(L, bx, logo, u, zz, s, px, 0.9);
  }
  // Draw a logo onto a box's left face: image x runs along the face, image y is vertical.
  function drawOnFace(L, bx, logo, u, zz, s, hpx, glow) {
    const x0 = bx.x0 + u, yb = bx.D[1] + (x0 - bx.D[0]) / 2 - zz;
    for (const [g, a] of [[L.g, 1], [L.e, glow]]) {
      g.save();
      g.imageSmoothingEnabled = false;
      g.globalAlpha = a;
      g.setTransform((s * 16) / 16, (s * 8) / 16, 0, hpx / 16, x0, yb - hpx);
      g.drawImage(logo, 0, 0);
      g.restore();
    }
  }
  // Real logos (company.logo URL) load CORS-enabled so they can be baked in; failures fall back to monograms.
  function loadLogos(companies, timeout = 2500) {
    return Promise.all(companies.filter((c) => c.logo).map((c) => new Promise((res) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const done = (ok) => { if (ok) c.logoImg = img; res(); };
      img.onload = () => done(true); img.onerror = () => done(false);
      setTimeout(() => done(false), timeout);
      img.src = c.logo;
    })));
  }

  // The roof to paint: highest structural box wide enough, not covered by a later box.
  function pickRoof(boxes) {
    let best = -1;
    boxes.forEach((b, i) => {
      if (Math.min(b.w, b.d) < 0.5) return;
      const top = b.z + b.h;
      const cx = b.tx + b.w / 2, cy = b.ty + b.d / 2;
      const covered = boxes.slice(i + 1).some((c) => c.z >= top - 0.5 && c.tx < cx + 0.2 && c.tx + c.w > cx - 0.2 && c.ty < cy + 0.2 && c.ty + c.d > cy - 0.2);
      if (covered) return;
      if (best < 0 || top >= boxes[best].z + boxes[best].h) best = i;
    });
    return best;
  }

  // Companies without a known sector still get real architecture, picked per company.
  const MIXED = ['Enterprise SaaS', 'Consumer', 'Media', 'Fintech', 'Developer Tools', 'Healthcare', 'Climate'];
  const styleOf = (company) => (ARCH[company.industry] && company.industry !== 'Other' ? company.industry : MIXED[hash(company.id) % MIXED.length]);

  function makeBuilding(company) {
    const n = company.people.length;
    const F = floorsOf(n);
    const H = F * 6 + 80;
    const arch = ARCH[styleOf(company)];
    const O = { ox: 56, oy: H + 40 };
    // pass 1: find the roof; pass 2: draw for real with the logo painted on it
    const probe = newLayer(112, H + 80);
    CUR = probe;
    arch(kit(probe, O), n, rng(hash(company.id)));
    const L = newLayer(112, H + 80);
    const roofIdx = pickRoof(probe.boxes);
    const tallIdx = probe.boxes.reduce((bi, b, i) => (bi < 0 || b.h > probe.boxes[bi].h ? i : bi), -1);
    const logo = makeLogo(company);
    // placement varies per company: painted on the roof, a rooftop sign, or on the facade
    const q = (hash(company.name) >>> 3) % 10;
    let mode = q < 4 ? 'roof' : q < 7 ? 'sign' : 'facade';
    const tall = probe.boxes[tallIdx];
    if (mode === 'facade' && (!tall || tall.h < facadeSize(tall).px + 8)) mode = 'sign';
    if (roofIdx < 0) mode = 'facade';
    L.decal = mode === 'roof' ? { index: roofIdx, logo } : null;
    if (mode === 'sign') L.logoArea = signArea(probe.boxes[roofIdx]);
    CUR = L;
    const K = kit(L, O);
    arch(K, n, rng(hash(company.id)));
    if (mode === 'sign') paintSign(L, O, K, L.boxes[roofIdx], logo);
    if (mode === 'facade' && L.boxes[tallIdx]) paintFacade(L, L.boxes[tallIdx], logo);
    CUR = null;
    const s = finalize(L, O.ox, O.oy);
    s.foot = L.bounds;
    return s;
  }

  // ---------- civic ----------
  function makeCityHall() {
    const L = newLayer(112, 210), O = { ox: 56, oy: 160 };
    CUR = L;
    const K = kit(L, O), r = rng(2000);
    const stone = '#ebe2cf', recess = '#8f826b';
    K.pbox(0.04, 0.04, 1.92, 1.92, 0, 2, mat('#d6ccb5'));
    K.pbox(0.1, 0.1, 1.8, 1.8, 2, 2, mat('#ddd3bd'));
    const base = K.box(0.2, 0.2, 1.6, 1.6, 4, 17, mat(stone));
    for (const side of ['L', 'R']) {
      const len = side === 'L' ? base.lenL : base.lenR;
      FR(base, side, 2, 1, len - 4, 13, side === 'L' ? recess : '#62594b');
      for (let u = 3; u < len - 3; u += 3) FR(base, side, u, 1, 1, 13, side === 'L' ? '#fbf7ee' : '#bcb19b');
      for (let u = 4; u < len - 4; u += 6) FRE(base, side, u, 3, 1, 7, WARM);
    }
    K.box(0.14, 0.14, 1.72, 1.72, 21, 2, mat('#f5efe2'));
    const upper = K.box(0.34, 0.34, 1.32, 1.32, 23, 6, mat(stone));
    K.windows(upper, r, { ww: 1, wh: 3, step: 4, pad: 3, glass: '#4f6a86', glassR: '#35485f', litP: 0.6 });
    K.box(0.3, 0.3, 1.4, 1.4, 29, 1, mat('#f5efe2'));
    const drum = K.box(0.6, 0.6, 0.8, 0.8, 30, 7, mat(stone));
    for (const side of ['L', 'R']) { const len = side === 'L' ? drum.lenL : drum.lenR; for (let u = 2; u < len - 1; u += 3) FR(drum, side, u, 1, 1, 5, side === 'L' ? '#9a8d75' : '#6d6352'); }
    // patina dome
    const [cx, cy] = K.pt(1, 1, 37);
    const R = 12;
    for (let dy = 0; dy <= R; dy++) {
      const hw = Math.round(Math.sqrt(R * R - dy * dy) * 1.05);
      for (let x = -hw; x <= hw; x++) {
        const t = (x + hw) / (2 * hw + 0.001);
        const c = dy > R - 3 && t < 0.6 ? '#a9d6c4' : t < 0.3 ? '#8cc2ad' : t < 0.7 ? '#6fa894' : '#4d8574';
        L.g.fillStyle = (x % 4 === 0 && dy < R - 1) ? mix(c, '#2f5a4d', 0.25) : c;
        L.g.fillRect(cx + x, cy - dy, 1, 1);
      }
    }
    L.e.fillStyle = 'rgba(160,230,210,.35)';
    for (let dy = 0; dy <= R; dy++) { const hw = Math.round(Math.sqrt(R * R - dy * dy)); L.e.fillRect(cx - hw, cy - dy, hw, 1); }
    // lantern, flag
    L.g.fillStyle = '#f5efe2'; L.g.fillRect(cx - 2, cy - R - 5, 5, 5);
    L.g.fillStyle = '#6fa894'; L.g.fillRect(cx - 3, cy - R - 6, 7, 1); L.g.fillRect(cx - 1, cy - R - 8, 3, 2);
    L.e.fillStyle = '#ffe9a8'; L.e.fillRect(cx - 1, cy - R - 4, 3, 3);
    L.g.fillStyle = '#3a3d48'; L.g.fillRect(cx, cy - R - 20, 1, 12);
    L.g.fillStyle = '#e0643a'; L.g.fillRect(cx + 1, cy - R - 20, 7, 2); L.g.fillStyle = '#f6f1e6'; L.g.fillRect(cx + 1, cy - R - 18, 7, 1); L.g.fillStyle = '#2c5f8a'; L.g.fillRect(cx + 1, cy - R - 17, 7, 2);
    // steps and doors
    const [dx, dy2] = K.pt(0.95, 1.8, 4);
    L.g.fillStyle = '#5a3a24'; L.g.fillRect(dx - 2, dy2 - 8, 4, 7);
    L.e.fillStyle = WARM; L.e.fillRect(dx - 2, dy2 - 8, 4, 7);
    CUR = null;
    const sp = finalize(L, O.ox, O.oy);
    sp.foot = L.bounds;
    return sp;
  }

  // Bronze bust on a stone plinth. bust: 16x20 canvas (transparent background).
  function makeStatue(bust) {
    const L = newLayer(48, 72), O = { ox: 24, oy: 50 };
    CUR = L;
    const K = kit(L, O);
    K.pbox(0.18, 0.18, 0.64, 0.64, 0, 3, mat('#cfc6b2'));
    const plinth = K.pbox(0.27, 0.27, 0.46, 0.46, 3, 12, mat('#e2dac8'));
    K.pbox(0.23, 0.23, 0.54, 0.54, 15, 2, mat('#efe8d8'));
    FR(plinth, 'L', 2, 4, plinth.lenL - 4, 4, '#b8813e');
    FR(plinth, 'L', 3, 5, plinth.lenL - 6, 1, '#e0b060');
    const [x, y] = K.pt(0.5, 0.5, 17);
    L.g.drawImage(bust, x - 8, y - 19);
    L.e.globalAlpha = 0.4; L.e.drawImage(bust, x - 8, y - 19); L.e.globalAlpha = 1;
    FRE(plinth, 'L', 1, 0, plinth.lenL - 2, 2, '#ffd98a');
    CUR = null;
    return finalize(L, O.ox, O.oy, NIGHT, 0.6);
  }

  // Bust silhouette mask on a 16x20 grid: head, neck, shoulders.
  function bustMask(x, y) {
    const hx = (x + 0.5 - 8) / 4.6, hy = (y + 0.5 - 7) / 5.6;
    if (hx * hx + hy * hy <= 1) return true;
    if (y >= 12 && y < 15 && x >= 6 && x < 10) return true;
    if (y >= 14) { const hwid = 3 + (y - 14) * 1.1; return Math.abs(x + 0.5 - 8) <= hwid; }
    return false;
  }
  const BRONZE = ['#2e1c10', '#4f3219', '#7a4f27', '#a8733a', '#d49f58', '#f0cd87'];
  // Turn a luminance grid (or null for a generic bust) into a bronze bust canvas.
  function bronzeBust(lum) {
    const c = document.createElement('canvas'); c.width = 16; c.height = 20;
    const g = c.getContext('2d');
    let lo = 1, hi = 0;
    if (lum) for (let y = 0; y < 20; y++) for (let x = 0; x < 16; x++) if (bustMask(x, y)) { lo = Math.min(lo, lum[y * 16 + x]); hi = Math.max(hi, lum[y * 16 + x]); }
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 16; x++) {
        if (!bustMask(x, y)) continue;
        // sculpted light from the left
        const shape = 0.62 - (x - 8) / 16 - (y > 13 ? 0.08 : 0);
        let v = lum ? ((lum[y * 16 + x] - lo) / Math.max(0.05, hi - lo)) * 0.75 + shape * 0.35 : shape + (y < 3 ? 0.1 : 0);
        if (!bustMask(x - 1, y)) v += 0.18;
        if (!bustMask(x + 1, y)) v -= 0.22;
        const i = Math.max(0, Math.min(BRONZE.length - 1, Math.round(v * (BRONZE.length - 1))));
        g.fillStyle = BRONZE[i]; g.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }

  // ---------- map scenery: bridges, neighborhoods, landmarks ----------
  // Suspension bridge `len` tiles long along the x or y axis; origin = start tile's top corner.
  function makeBridge(len, axis, style) {
    const TOPZ = style === 'brooklyn' ? 42 : 56;
    const W = (len + 3) * HW + 40, Ht = (len + 3) * HH + TOPZ + 60;
    const L = newLayer(W, Ht);
    const O = axis === 'x' ? { ox: 2 * HW + 10, oy: TOPZ + 30 } : { ox: W - 2 * HW - 10, oy: TOPZ + 30 };
    const B = (a0, c0, aw, cw, z, h, m) => (axis === 'x' ? isoBox(L.g, O.ox, O.oy, a0, c0, aw, cw, z, h, m) : isoBox(L.g, O.ox, O.oy, c0, a0, cw, aw, z, h, m));
    const P = (a, c, z) => { const [x, y] = axis === 'x' ? iso(a, c) : iso(c, a); return [Math.round(O.ox + x), Math.round(O.oy + y - z)]; };
    const C = {
      golden: { steel: '#c8452f', cable: '#b53a26', deck: '#b8402c' },
      bay: { steel: '#a3acb6', cable: '#cfd6dc', deck: '#8d959e' },
      brooklyn: { steel: '#bca887', cable: '#5f646e', deck: '#6f5f4c' },
    }[style];
    const deckZ = 11, t1 = len * 0.24, t2 = len * 0.76;
    const cableZ = (s) => {
      if (s < t1) return deckZ + 3 + (TOPZ - deckZ - 3) * Math.pow(s / t1, 1.7);
      if (s > t2) return deckZ + 3 + (TOPZ - deckZ - 3) * Math.pow((len - s) / (len - t2), 1.7);
      const m = (t1 + t2) / 2, hs = (t2 - t1) / 2;
      return deckZ + 5 + (TOPZ - deckZ - 5) * ((s - m) / hs) ** 2;
    };
    const cable = (c) => {
      L.g.fillStyle = C.cable;
      for (let s = 0; s <= len; s += 0.01) { const [x, y] = P(s, c, cableZ(s)); L.g.fillRect(x, y, 1, 1); }
      for (let s = 0.25; s < len; s += 0.25) {
        const z = cableZ(s); if (z - deckZ < 5) continue;
        const [x, y] = P(s, c, z), [, y2] = P(s, c, deckZ + 3);
        L.g.fillStyle = mix(C.cable, '#ffffff', 0.25); L.g.fillRect(x, y + 1, 1, y2 - y - 1);
        if (style === 'bay' && Math.round(s * 4) % 2 === 0) { L.e.fillStyle = '#eef4ff'; L.e.fillRect(x, y, 1, 1); }
      }
    };
    for (const t of [t1, t2]) B(t - 0.2, 0.2, 0.4, 0.6, -2, deckZ + 2, mat('#8d8f94'));
    cable(0.3);
    B(0, 0.28, len, 0.44, deckZ, 3, mat(C.deck, '#5a5c62'));
    for (let a = 0.25; a < len; a += 0.5) { const [x, y] = P(a, 0.5, deckZ + 3); L.g.fillStyle = '#e8cf5a'; L.g.fillRect(x, y, 2, 1); }
    for (let a = 0.5; a < len; a += 1) for (const c of [0.3, 0.7]) { const [x, y] = P(a, c, deckZ + 4); L.e.fillStyle = '#ffd98a'; L.e.fillRect(x, y, 1, 1); }
    for (const t of [t1, t2]) {
      if (style === 'brooklyn') {
        const tw = B(t - 0.14, 0.16, 0.28, 0.68, deckZ, TOPZ - deckZ + 8, mat(C.steel));
        for (const u of [2, Math.max(4, tw.lenR - 6)]) faceRect(L.g, tw, 'R', u, 5, 3, 15, '#3a3530');
        faceRect(L.g, tw, 'L', 1, TOPZ - deckZ + 4, tw.lenL - 2, 1, mix(C.steel, '#000000', 0.3));
      } else {
        for (const c of [0.2, 0.7]) B(t - 0.07, c, 0.14, 0.1, deckZ, TOPZ - deckZ + 4, mat(C.steel));
        for (const zz of [deckZ + 18, deckZ + 32, TOPZ + 1]) B(t - 0.05, 0.2, 0.1, 0.6, zz, 3, mat(C.steel));
      }
      const [x, y] = P(t, 0.25, TOPZ + 6);
      L.g.fillStyle = '#d23a3a'; L.g.fillRect(x, y, 1, 1); L.e.fillStyle = '#ff5050'; L.e.fillRect(x - 1, y - 1, 3, 3);
    }
    cable(0.7);
    return finalize(L, O.ox, O.oy, NIGHT, 0.9);
  }

  // Small background buildings for neighborhoods across the water.
  function makeFiller(kind, seed) {
    const r = rng(seed), L = newLayer(48, 120), O = { ox: 24, oy: 96 };
    CUR = L;
    const K = kit(L, O);
    if (kind === 'brownstone') {
      const h = 13 + Math.floor(r() * 3) * 5, col = pickR(r, ['#8a4a36', '#7a4232', '#9a5a3e', '#6f3d2e']);
      const b = K.box(0.12, 0.1, 0.78, 0.8, 0, h, mat(col));
      K.windows(b, r, { ww: 1, wh: 3, step: 3, pad: 2, sill: '#e8dccb', glass: '#3e5266', glassR: '#2c3a48', litP: 0.45 });
      K.box(0.1, 0.08, 0.82, 0.84, h, 2, mat(mix(col, '#000000', 0.35)));
      K.pbox(0.35, 0.9, 0.22, 0.14, 0, 3, mat('#b9ab94'));
    } else if (kind === 'house') {
      const col = pickR(r, ['#f2c9b0', '#bfe0d6', '#f4e3a8', '#c9c2e8', '#f2b8c6', '#e9efe9', '#a8cfe0']);
      const b = K.box(0.15, 0.15, 0.7, 0.7, 0, 10, mat(col));
      K.windows(b, r, { ww: 2, wh: 3, step: 5, pad: 3, frame: '#ffffff', litP: 0.5, noGlint: true });
      K.box(0.1, 0.1, 0.8, 0.8, 10, 2, mat('#7d5a4a'));
      K.box(0.25, 0.25, 0.5, 0.5, 12, 2, mat('#6a4a3c'));
    } else if (kind === 'tower') {
      const h = 34 + Math.floor(r() * 36);
      const b = K.box(0.12, 0.12, 0.76, 0.76, 0, h, mat(pickR(r, ['#7fa3b8', '#9aa7b0', '#6f8fa6'])));
      K.curtain(b, r, { frame: '#dfe6ea', glass: '#9cc6de', glassR: '#5d7f9e', step: 4, litP: 0.35 });
    } else {
      const b = K.box(0.05, 0.1, 0.9, 0.8, 0, 9, mat(pickR(r, ['#a9a79f', '#b8a898', '#9d9b94'])));
      K.windows(b, r, { ww: 3, wh: 2, step: 6, pad: 3, glass: '#46586a', litP: 0.3, noGlint: true });
      for (let i = 0; i < 3; i++) K.pbox(0.1 + i * 0.28, 0.15, 0.26, 0.7, 9, 3, mat('#8f8d86', '#b9b7b0'));
    }
    CUR = null;
    return finalize(L, O.ox, O.oy);
  }

  // A soft grassy hill (screen-space dome), optionally with Sutro Tower.
  function makeHill(rx, hgt, seed, sutro, dry) {
    const r = rng(seed), W = rx * 2 + 16, Hh = hgt + rx + (sutro ? 90 : 20);
    const L = newLayer(W, Hh), cx = W / 2, base = Hh - rx / 2 - 4;
    const cols = dry ? ['#d2bc6e', '#c2ad62', '#a8944f', '#8a7a40'] : ['#8cc063', '#6fae4f', '#5c9a3d', '#4a7f30'];
    for (let y = -hgt; y <= rx / 2; y++) {
      const t = y < 0 ? 1 - (y / hgt) ** 2 : 1 - (y / (rx / 2)) ** 2;
      const hw = Math.round(rx * Math.sqrt(Math.max(0, t)));
      for (let x = -hw; x <= hw; x++) {
        const lx = (x + hw) / (2 * hw + 1);
        let c = lx < 0.25 ? cols[0] : lx < 0.6 ? cols[1] : lx < 0.85 ? cols[2] : cols[3];
        if (y > rx / 2 - 3) c = cols[3];
        if (r() < 0.04) c = dry ? '#6f7a3a' : '#3f7f36';
        L.g.fillStyle = c; L.g.fillRect(cx + x, base + y, 1, 1);
      }
    }
    for (let i = 0; i < (dry ? 5 : 9); i++) {
      const x = cx + Math.round((r() - 0.5) * rx * 1.3), y = base - Math.round(r() * hgt * 0.6);
      disk(L.g, x, y - 3, 2 + Math.floor(r() * 2), dry ? '#5f6a32' : '#2f6f33');
    }
    if (sutro) {
      const tx = cx, ty = base - hgt + 2;
      L.g.fillStyle = '#c9463d';
      for (let k = 0; k < 70; k++) {
        const spread = Math.round((70 - k) / 70 * 6);
        const col = Math.floor(k / 8) % 2 ? '#f2eee6' : '#c9463d';
        L.g.fillStyle = col;
        if (k < 58) { L.g.fillRect(tx - spread, ty - k, 1, 1); L.g.fillRect(tx + spread, ty - k, 1, 1); L.g.fillRect(tx, ty - k, 1, 1); }
        if (k % 12 === 0 && k < 58) L.g.fillRect(tx - spread, ty - k, spread * 2 + 1, 1);
      }
      L.g.fillStyle = '#c9463d'; L.g.fillRect(tx - 7, ty - 58, 15, 2);
      for (const dx of [-7, 0, 7]) { L.g.fillStyle = '#f2eee6'; L.g.fillRect(tx + dx, ty - 70, 1, 12); L.e.fillStyle = '#ff5050'; L.e.fillRect(tx + dx - 1, ty - 71, 3, 2); }
    }
    return finalize(L, cx, base, NIGHT, 0.9);
  }

  function makeIsland(kind) {
    const L = newLayer(90, 110), O = { ox: 45, oy: 70 };
    CUR = L;
    const K = kit(L, O);
    if (kind === 'alcatraz') {
      K.pbox(-0.9, -0.6, 1.8, 1.2, -2, 4, mat('#8a7a64', '#7f9a5a'));
      K.pbox(-0.7, -0.45, 1.3, 0.9, 2, 3, mat('#9a8a72', '#86a060'));
      const cell = K.box(-0.5, -0.3, 0.9, 0.5, 5, 9, mat('#e9e2d2'));
      K.windows(cell, rng(5), { ww: 1, wh: 2, step: 3, pad: 2, glass: '#4a4f58', litP: 0.3, noGlint: true });
      const lh = K.box(0.35, -0.35, 0.16, 0.16, 5, 22, mat('#f2eee6'));
      void lh;
      const [x, y] = K.pt(0.43, -0.27, 27);
      L.g.fillStyle = '#3a3d48'; L.g.fillRect(x - 1, y - 2, 3, 2);
      L.e.fillStyle = '#fff1b8'; L.e.fillRect(x - 2, y - 3, 5, 4);
    } else {
      // Liberty Island: star fort, pedestal, green figure with a torch
      K.pbox(-0.8, -0.8, 1.6, 1.6, -2, 3, mat('#8f9a6a', '#7fae5a'));
      K.pbox(-0.45, -0.45, 0.9, 0.9, 1, 5, mat('#c9bfa8'));
      K.pbox(-0.22, -0.22, 0.44, 0.44, 6, 16, mat('#d9cfb6'));
      const [x, y] = K.pt(0, 0, 22);
      const G = ['#9fd1bd', '#7fb7a2', '#5f9a86', '#46806d'];
      L.g.fillStyle = G[2]; L.g.fillRect(x - 3, y - 18, 7, 18);
      L.g.fillStyle = G[1]; L.g.fillRect(x - 3, y - 18, 3, 18);
      L.g.fillStyle = G[3]; L.g.fillRect(x + 3, y - 16, 1, 16);
      L.g.fillStyle = G[1]; L.g.fillRect(x - 2, y - 23, 5, 5);
      L.g.fillStyle = G[0]; for (const dx of [-3, -1, 1, 3]) L.g.fillRect(x + dx, y - 25, 1, 2);
      L.g.fillStyle = G[2]; L.g.fillRect(x + 3, y - 30, 2, 13);
      L.g.fillStyle = '#e0b060'; L.g.fillRect(x + 3, y - 33, 2, 3);
      L.e.fillStyle = '#ffd24a'; L.e.fillRect(x + 2, y - 35, 4, 5);
      L.g.fillStyle = G[3]; L.g.fillRect(x - 4, y - 14, 2, 5);
    }
    CUR = null;
    return finalize(L, O.ox, O.oy, NIGHT, 0.9);
  }

  // Landmark towers that sit on a city lot (origin = lot top corner, like buildings).
  function makeLandmark(kind) {
    const L = newLayer(112, 330), O = { ox: 56, oy: 290 };
    CUR = L;
    const K = kit(L, O), r = rng(S_hash(kind));
    if (kind === 'transamerica') {
      const H = 150;
      for (let i = 0; i < 30; i++) {
        const f = i / 30, w = 1.3 * (1 - f) + 0.06, t = (2 - w) / 2;
        const b = K.box(t, t, w, w, i * (H / 30), H / 30 + 0.5, mat('#ece6da'));
        if (i % 2 === 0 && w > 0.3) K.windows(b, r, { ww: 1, wh: 2, step: 3, pad: 1, glass: '#6b7f96', glassR: '#4a5a6f', litP: 0.4, noGlint: true, floorH: 5 });
      }
      K.box(0.25, 0.8, 0.3, 0.4, 40, 30, mat('#ece6da'));
      K.box(1.45, 0.8, 0.3, 0.4, 40, 30, mat('#ece6da'));
      K.antenna(1, 1, H + 2, 16);
    } else if (kind === 'empire') {
      const stone = '#d8cdb4';
      const tiers = [[1.8, 20], [1.4, 60], [1.1, 40], [0.8, 26], [0.5, 12]];
      let z = 0;
      for (const [w, h] of tiers) {
        const t = (2 - w) / 2, b = K.box(t, t, w, w, z, h, mat(stone));
        K.windows(b, r, { ww: 1, wh: 3, step: 3, pad: 2, glass: '#4f6a86', glassR: '#35485f', litP: 0.4 });
        for (const side of ['L', 'R']) { const len = side === 'L' ? b.lenL : b.lenR; for (let u = 4; u < len - 3; u += 6) faceRect(L.g, b, side, u, 0, 1, h, side === 'L' ? '#ece4d0' : '#a99d85'); }
        z += h;
      }
      K.both((g, e) => { const [x, y] = K.pt(1, 1, z); g.fillStyle = e ? '#8fd0ff' : '#cfd6dc'; g.fillRect(x - 1, y - 16, 3, 16); g.fillRect(x, y - 30, 1, 14); });
    } else {
      // One World Trade: tapering glass obelisk
      const H = 190;
      for (let i = 0; i < 38; i++) {
        const f = i / 38, w = 1.4 - f * 0.75, t = (2 - w) / 2;
        const b = K.box(t, t, w, w, i * (H / 38), H / 38 + 0.5, mat('#8fb6cf'));
        faceRect(L.g, b, 'L', 1, 0, b.lenL - 2, 1, '#cfe6f2');
        for (let u = 2; u < b.lenL - 1; u += 3) if (r() < 0.35) faceRect(L.e, b, 'L', u, 1, 2, 3, COOL);
        for (let u = 2; u < b.lenR - 1; u += 3) if (r() < 0.25) faceRect(L.e, b, 'R', u, 1, 2, 3, COOL);
      }
      K.antenna(1, 1, H, 40);
    }
    CUR = null;
    const sp = finalize(L, O.ox, O.oy, NIGHT, 0.6);
    sp.foot = L.bounds;
    return sp;
  }
  const S_hash = (k) => hash(k);

  // ---------- nature & street furniture ----------
  const TREES = {
    oak: ['#2f6f33', '#3f8a3c', '#63a84e'],
    lime: ['#4f8a2f', '#6aa83a', '#9ccc5a'],
    cherry: ['#c7708f', '#e79ab4', '#f7c6d6'],
    autumn: ['#b8562a', '#d9793a', '#f0a94e'],
  };
  function makeTree(kind, seed) {
    const L = newLayer(20, 30);
    const g = L.g, r = rng(seed);
    if (kind === 'pine' || kind === 'cypress') {
      const cols = kind === 'pine' ? ['#1f4f35', '#2b6644', '#3f8055'] : ['#274f2e', '#32663a', '#4a8448'];
      g.fillStyle = '#5a3d26'; g.fillRect(9, 24, 2, 4);
      const tall = kind === 'cypress' ? 22 : 18, maxW = kind === 'cypress' ? 3 : 6;
      for (let y = 0; y < tall; y++) {
        const w = Math.max(1, Math.round(((y + 1) / tall) * maxW + (kind === 'pine' && y % 5 === 4 ? -1 : 0)));
        g.fillStyle = cols[1]; g.fillRect(10 - w, 5 + y, w * 2, 1);
        g.fillStyle = cols[0]; g.fillRect(10, 5 + y, w, 1);
        g.fillStyle = cols[2]; g.fillRect(10 - w, 5 + y, 1, 1);
      }
    } else {
      const cols = TREES[kind] || TREES.oak;
      g.fillStyle = '#5a3d26'; g.fillRect(9, 20, 2, 8);
      disk(g, 10, 14, 7, cols[0]);
      disk(g, 9, 13, 6, cols[1]);
      disk(g, 8, 11, 3, cols[2]);
      for (let i = 0; i < 6; i++) { g.fillStyle = r() < 0.5 ? cols[2] : cols[0]; g.fillRect(4 + Math.floor(r() * 12), 8 + Math.floor(r() * 12), 1, 1); }
    }
    return finalize(L, 10, 28, NIGHT, 0);
  }

  function makeLamp() {
    const L = newLayer(12, 24);
    L.g.fillStyle = '#2b2f3a'; L.g.fillRect(5, 6, 1, 16); L.g.fillRect(5, 5, 3, 1); L.g.fillRect(4, 21, 3, 1);
    L.g.fillStyle = '#e8e2c8'; L.g.fillRect(7, 6, 2, 1);
    L.e.fillStyle = '#fff1b8'; L.e.fillRect(6, 6, 4, 2);
    return finalize(L, 5, 22, NIGHT, 1);
  }
  function makeBench() {
    const L = newLayer(20, 14), g = L.g;
    const O = { ox: 10, oy: 4 };
    isoBox(g, O.ox, O.oy, 0.1, 0.35, 0.8, 0.22, 2, 1, mat('#8a5a36'));
    isoBox(g, O.ox, O.oy, 0.1, 0.3, 0.8, 0.06, 3, 3, mat('#7a4e2e'));
    g.fillStyle = '#2b2f3a'; g.fillRect(4, 10, 1, 2); g.fillRect(15, 9, 1, 2);
    return finalize(L, O.ox, O.oy + 8, NIGHT, 0);
  }
  function makeFountain() {
    const L = newLayer(48, 32), O = { ox: 24, oy: 8 };
    isoBox(L.g, O.ox, O.oy, 0.1, 0.1, 0.8, 0.8, 0, 3, mat('#d9d2c2'));
    isoBox(L.g, O.ox, O.oy, 0.18, 0.18, 0.64, 0.64, 2, 1, mat('#5aa0c8', '#7ec0e0'));
    isoBox(L.g, O.ox, O.oy, 0.44, 0.44, 0.12, 0.12, 3, 7, mat('#d9d2c2'));
    const [x, y] = iso(0.5, 0.5);
    for (const [dx, dy] of [[0, -14], [-2, -12], [2, -12], [-4, -9], [4, -9], [-5, -6], [5, -6]]) {
      L.g.fillStyle = '#e8f6ff'; L.g.fillRect(O.ox + x + dx, O.oy + y + dy, 1, 1);
      L.e.fillStyle = '#a8dcff'; L.e.fillRect(O.ox + x + dx, O.oy + y + dy, 1, 1);
    }
    return finalize(L, O.ox, O.oy + 8, NIGHT, 0.8);
  }
  function makeBoat(seed) {
    const r = rng(seed), L = newLayer(30, 34), g = L.g;
    const hull = pickR(r, ['#f2efe6', '#2f3b52', '#b3423a']);
    g.fillStyle = hull; g.fillRect(6, 26, 18, 3); g.fillRect(8, 29, 14, 1);
    g.fillStyle = mix(hull, '#000000', 0.3); g.fillRect(8, 28, 14, 1);
    g.fillStyle = '#5a3d26'; g.fillRect(14, 6, 1, 20);
    for (let y = 0; y < 18; y++) {
      const w = Math.round((y / 18) * 8);
      g.fillStyle = '#fbfaf5'; g.fillRect(15, 7 + y, w, 1);
      g.fillStyle = '#e4e0d4'; g.fillRect(14 - Math.round(w * 0.6), 9 + y, Math.round(w * 0.6), 1);
    }
    g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(3, 30, 4, 1); g.fillRect(23, 30, 3, 1);
    L.e.fillStyle = '#ffe9a8'; L.e.fillRect(18, 25, 2, 1);
    return finalize(L, 15, 29, NIGHT, 0.8);
  }

  const CAR_COLORS = ['#e9e4d8', '#2d3142', '#b23a48', '#3c6e71', '#e0a458', '#5b7fa3', '#f1f1ee', '#f2c14e', '#6b705c'];
  // variant: null | 'taxi' (yellow cab with a roof sign) | 'waymo' (white SUV with a lidar dome)
  function makeCar(color, axis, variant) {
    const L = newLayer(28, 26), O = { ox: 14, oy: 12 };
    if (variant === 'taxi') color = '#f2c14e';
    if (variant === 'waymo') color = '#f2f3f1';
    const [w, d] = axis === 'x' ? [variant === 'waymo' ? 0.6 : 0.55, 0.28] : [0.28, variant === 'waymo' ? 0.6 : 0.55];
    const t = [(1 - w) / 2 - 0.5, (1 - d) / 2 - 0.5];
    isoBox(L.g, O.ox, O.oy, t[0], t[1], w, d, 1, 3, mat(color));
    const [cw, cd] = axis === 'x' ? [w * 0.5, d * 0.85] : [w * 0.85, d * 0.5];
    isoBox(L.g, O.ox, O.oy, t[0] + (w - cw) / 2, t[1] + (d - cd) / 2, cw, cd, 4, 2, { left: '#2b3548', right: '#1d2433', top: mix(color, '#ffffff', 0.15), rim: '#46526a', edge: '#151a24' });
    L.g.fillStyle = '#15161a';
    const ends = axis === 'x' ? [iso(t[0], t[1] + d), iso(t[0] + w, t[1] + d)] : [iso(t[0] + w, t[1]), iso(t[0] + w, t[1] + d)];
    for (const [ex, ey] of ends) L.g.fillRect(O.ox + ex, O.oy + ey - 1, 1, 1);
    const [hx, hy] = axis === 'x' ? iso(t[0] + w, t[1] + d / 2) : iso(t[0] + w / 2, t[1] + d);
    L.e.fillStyle = '#fff4c8'; L.e.fillRect(O.ox + hx - 1, O.oy + hy - 3, 2, 1);
    const [rx, ry] = iso(t[0] + w / 2, t[1] + d / 2);
    const X = O.ox + rx, Y = O.oy + ry - 6;
    if (variant === 'taxi') {
      // roof sign, lit at night
      L.g.fillStyle = '#f7f1dc'; L.g.fillRect(X - 2, Y - 2, 4, 2);
      L.g.fillStyle = '#2a2a2e'; L.g.fillRect(X - 2, Y, 4, 1);
      L.e.fillStyle = '#fff2b0'; L.e.fillRect(X - 2, Y - 2, 4, 2);
      // checker stripe along the side
      const [sx, sy] = axis === 'x' ? iso(t[0] + 0.1, t[1] + d) : iso(t[0] + w, t[1] + d - 0.1);
      L.g.fillStyle = '#1d1b16';
      for (let k = 0; k < 6; k += 2) L.g.fillRect(O.ox + sx + (axis === 'x' ? k : k), O.oy + sy - 2 + (axis === 'x' ? Math.round(k / 2) : -Math.round(k / 2)), 1, 1);
    } else if (variant === 'waymo') {
      // spinning lidar dome on a roof pod, plus side sensors
      L.g.fillStyle = '#d9dcdc'; L.g.fillRect(X - 2, Y, 4, 1);
      L.g.fillStyle = '#1c1f24'; L.g.fillRect(X - 1, Y - 3, 3, 3);
      L.g.fillStyle = '#4a5260'; L.g.fillRect(X - 1, Y - 3, 1, 1);
      L.e.fillStyle = '#6fe3d4'; L.e.fillRect(X - 1, Y - 2, 3, 1);
      for (const [ex, ey] of ends) { L.g.fillStyle = '#1c1f24'; L.g.fillRect(O.ox + ex, O.oy + ey - 3, 1, 1); }
    }
    return finalize(L, O.ox, O.oy, NIGHT, 1);
  }

  // ---------- people ----------
  const SKIN = ['#f3d2b5', '#e5b48c', '#c98d62', '#a86d45', '#7a4b2e', '#5a3620'];
  const HAIR = ['#2a1d14', '#4a2f1c', '#8a5a2e', '#c9a25a', '#1a1a1d', '#9a3f24', '#d9d2c4', '#5a4a6a'];
  const STYLES = ['short', 'short', 'long', 'bun', 'bald', 'curly', 'buzz', 'bob', 'ponytail'];

  function roleOf(p) {
    const t = (p.title || '').toLowerCase(), ind = p.company.industry;
    if (ind === 'Venture Capital' && !/ceo|engineer/.test(t)) return 'vc';
    if (ind === 'Healthcare' && !/ceo|founder|sales|account|finance|market|growth/.test(t)) return 'health';
    if (/ceo|founder|coo/.test(t)) return 'founder';
    if (/design/.test(t)) return 'design';
    if (/sales|account|partnership/.test(t)) return 'sales';
    if (/finance|chief of staff|recruit/.test(t)) return 'exec';
    if (/marketing|growth/.test(t)) return 'growth';
    if (/product/.test(t)) return 'product';
    return 'eng';
  }

  function looks(p) {
    if (p._look) return p._look;
    const r = rng(hash(p.id));
    const role = roleOf(p);
    const lk = { role, skin: pickR(r, SKIN), hair: pickR(r, HAIR), style: pickR(r, STYLES), legs: '#2e3a55', shoes: '#1f1f22', glasses: r() < 0.3, headphones: false, coffee: r() < 0.25, beanie: null, tie: null, inner: null, kind: 'tee' };
    switch (role) {
      case 'vc': Object.assign(lk, { kind: 'vest', top: pickR(r, ['#1f2a44', '#3a3d44', '#4a5a3a', '#1c1c20', '#5a4a3a']), arms: pickR(r, ['#bcd3ea', '#e8eef4', '#c9dcef']), legs: '#c2ab83', shoes: '#6b4a2e' }); lk.inner = lk.arms; break;
      case 'founder': Object.assign(lk, { kind: 'hoodie', top: pickR(r, ['#1c1c20', '#8a8f98', '#2c3a55', '#34503f', '#e9e4d8']) }); lk.arms = lk.top; break;
      case 'design': Object.assign(lk, { kind: 'turtleneck', top: '#16161a', arms: '#16161a', legs: '#16161a', glasses: r() < 0.7 }); break;
      case 'sales': Object.assign(lk, { kind: 'suit', top: pickR(r, ['#1f2a44', '#3a3d44', '#2a2a2e']), inner: '#f4f4f2', tie: pickR(r, ['#b23a48', '#2f6db3', '#6b4aa0']) }); lk.arms = lk.top; lk.legs = lk.top; break;
      case 'exec': Object.assign(lk, { kind: 'blazer', top: pickR(r, ['#b08a5a', '#6b6f78', '#2c3a55']), inner: pickR(r, ['#f4f4f2', '#1c1c20']) }); lk.arms = lk.top; break;
      case 'growth': Object.assign(lk, { kind: 'sweater', top: pickR(r, ['#d9a336', '#e07a5f', '#9a86c8', '#8fae8a', '#d6617a']), inner: '#f4f4f2' }); lk.arms = lk.top; break;
      case 'product': Object.assign(lk, { kind: 'overshirt', top: pickR(r, ['#a04a3a', '#3f5f7a', '#6b7a4a']), inner: '#f0ece2' }); lk.arms = lk.top; break;
      case 'health':
        if (r() < 0.5) Object.assign(lk, { kind: 'scrubs', top: pickR(r, ['#4fa3a0', '#6c8fd1', '#6aa06a']) });
        else Object.assign(lk, { kind: 'labcoat', top: '#f6f6f2', arms: '#f6f6f2', inner: '#7aa6d6' });
        if (lk.kind === 'scrubs') { lk.arms = lk.top; lk.legs = lk.top; }
        break;
      default:
        Object.assign(lk, { kind: r() < 0.6 ? 'hoodie' : 'tee', top: pickR(r, ['#3a6fd9', '#2ab0b0', '#e07a2e', '#34503f', '#8a8f98', '#c2467e', '#1c1c20', '#f2f2f2']), headphones: r() < 0.4 });
        lk.arms = lk.top;
        if (r() < 0.15) lk.beanie = pickR(r, ['#d8433b', '#2f6db3', '#e9c34a']);
    }
    if (lk.style === 'bald' && lk.beanie) lk.style = 'short';
    p._look = lk;
    return lk;
  }

  // Street walker: 5 px wide, 12 px tall, drawn with feet at (x .. x+4, y).
  function drawWalkerPx(g, x, y, lk, step) {
    const R = (c, a, b, w, h) => { g.fillStyle = c; g.fillRect(x + a, y + b, w, h); };
    R('rgba(20,24,40,.28)', -1, 0, 7, 1);
    if (step) { R(lk.legs, 1, -3, 1, 2); R(lk.legs, 3, -3, 1, 3); R(lk.shoes, 1, -1, 1, 1); R(lk.shoes, 3, -1, 1, 1); }
    else { R(lk.legs, 2, -3, 1, 3); R(lk.shoes, 2, -1, 1, 1); }
    R(lk.top, 1, -7, 3, 4);
    R(lk.arms, 0, -7, 1, 3); R(lk.arms, 4, -7, 1, 3);
    R(lk.skin, 0, -4, 1, 1); R(lk.skin, 4, -4, 1, 1);
    if (lk.kind === 'vest') R(lk.inner, 2, -7, 1, 2);
    if (lk.kind === 'suit' || lk.kind === 'blazer') { R(lk.inner, 2, -7, 1, 3); if (lk.tie) R(lk.tie, 2, -6, 1, 2); }
    if (lk.kind === 'labcoat') R(lk.inner, 2, -7, 1, 2);
    if (lk.kind === 'hoodie') R(mix(lk.top, '#000000', 0.25), 1, -8, 3, 1);
    R(lk.skin, 1, -10, 3, 3);
    R(mix(lk.skin, '#000000', 0.18), 3, -10, 1, 3);
    if (lk.glasses) { R('#1a1a1d', 1, -9, 1, 1); R('#1a1a1d', 3, -9, 1, 1); }
    if (lk.beanie) { R(lk.beanie, 1, -12, 3, 2); R(mix(lk.beanie, '#ffffff', 0.3), 1, -11, 3, 1); }
    else switch (lk.style) {
      case 'long': R(lk.hair, 1, -11, 3, 1); R(lk.hair, 0, -10, 1, 4); R(lk.hair, 4, -10, 1, 4); break;
      case 'bun': R(lk.hair, 1, -11, 3, 1); R(lk.hair, 2, -12, 1, 1); break;
      case 'bald': break;
      case 'curly': R(lk.hair, 0, -12, 5, 2); R(lk.hair, 0, -10, 1, 1); R(lk.hair, 4, -10, 1, 1); break;
      case 'buzz': R(mix(lk.hair, lk.skin, 0.35), 1, -11, 3, 1); break;
      case 'bob': R(lk.hair, 1, -11, 3, 1); R(lk.hair, 0, -10, 1, 2); R(lk.hair, 4, -10, 1, 2); break;
      case 'ponytail': R(lk.hair, 1, -11, 3, 1); R(lk.hair, 4, -10, 1, 3); break;
      default: R(lk.hair, 1, -11, 3, 1); R(lk.hair, 1, -10, 1, 1);
    }
    if (lk.headphones) { R('#1a1a1d', 0, -9, 1, 2); R('#1a1a1d', 4, -9, 1, 2); R('#1a1a1d', 1, -12, 3, 1); }
    if (lk.coffee) { R('#f4f1ea', 5, -5, 1, 2); R('#6b4a2e', 5, -5, 1, 1); }
  }

  function makeWalker(p) {
    const lk = looks(p);
    return [0, 1].map((step) => {
      const L = newLayer(12, 18);
      drawWalkerPx(L.g, 3, 15, lk, step);
      return finalize(L, 5, 15, NIGHT_SOFT, 0);
    });
  }

  // Office sitter facing the viewer; (x, y) = center column at desk-top height.
  function drawSitter(g, x, y, lk, back) {
    const R = (c, a, b, w, h) => { g.fillStyle = c; g.fillRect(x + a, y + b, w, h); };
    R(lk.top, -4, -9, 9, 9);
    R(lk.top, -3, -10, 7, 1);
    R(lk.arms, -5, -8, 1, 7); R(lk.arms, 5, -8, 1, 7);
    R(mix(lk.top, '#1b1f33', 0.25), 3, -9, 2, 9);
    if (!back) {
      if (lk.kind === 'vest') { R(lk.inner, -1, -10, 3, 6); R(mix(lk.inner, '#000000', 0.15), 0, -6, 1, 2); }
      if (lk.kind === 'suit' || lk.kind === 'blazer') { R(lk.inner, -1, -10, 3, 7); if (lk.tie) R(lk.tie, 0, -9, 1, 6); R(mix(lk.top, '#000000', 0.25), -2, -9, 1, 5); R(mix(lk.top, '#000000', 0.25), 2, -9, 1, 5); }
      if (lk.kind === 'labcoat') { R(lk.inner, -1, -10, 3, 6); R('#d6d6d0', -2, -10, 1, 8); R('#d6d6d0', 2, -10, 1, 8); }
      if (lk.kind === 'hoodie') { R('#eeeeee', -1, -8, 1, 3); R('#eeeeee', 1, -8, 1, 3); R(mix(lk.top, '#000000', 0.2), -3, -11, 7, 1); }
      if (lk.kind === 'sweater' || lk.kind === 'overshirt') R(lk.inner, -1, -10, 3, 2);
      if (lk.kind === 'turtleneck') R(lk.top, -1, -11, 3, 1);
      if (lk.kind === 'scrubs') R(mix(lk.top, '#000000', 0.2), -1, -10, 3, 3);
    }
    if (lk.kind !== 'turtleneck') R(mix(lk.skin, '#000000', 0.1), -1, -11, 3, 1);
    R(lk.skin, -3, -17, 6, 6);
    R(mix(lk.skin, '#000000', 0.15), 2, -17, 1, 6);
    const H = (a, b, w, h) => R(lk.hair, a, b, w, h);
    if (back) {
      if (lk.style !== 'bald') H(-3, -17, 6, 6);
      if (lk.style === 'long' || lk.style === 'ponytail') H(-2, -11, 4, 3);
    } else {
      R('#1a1a1d', -2, -14, 1, 1); R('#1a1a1d', 1, -14, 1, 1);
      R(mix(lk.skin, '#8a3a3a', 0.35), -1, -12, 2, 1);
      if (lk.glasses) { R('#1a1a1d', -3, -14, 6, 1); R('#9fc4e8', -2, -14, 1, 1); R('#9fc4e8', 1, -14, 1, 1); }
    }
    if (lk.beanie) { R(lk.beanie, -4, -20, 8, 4); R(mix(lk.beanie, '#ffffff', 0.3), -4, -17, 8, 1); }
    else switch (lk.style) {
      case 'long': H(-4, -19, 8, 3); H(-4, -16, 1, 8); H(3, -16, 1, 8); break;
      case 'bun': H(-3, -19, 6, 3); H(-1, -21, 3, 2); break;
      case 'bald': R(lk.skin, -2, -18, 4, 1); break;
      case 'curly': H(-4, -21, 8, 4); H(-5, -19, 1, 4); H(4, -19, 1, 4); H(-4, -17, 1, 3); H(3, -17, 1, 3); break;
      case 'buzz': R(mix(lk.hair, lk.skin, 0.35), -3, -18, 6, 2); break;
      case 'bob': H(-4, -19, 8, 3); H(-4, -16, 1, 5); H(3, -16, 1, 5); break;
      case 'ponytail': H(-3, -19, 6, 3); H(3, -18, 2, 1); H(4, -17, 1, 5); break;
      default: H(-3, -19, 6, 3); H(-3, -16, 1, 2); H(2, -16, 1, 1);
    }
    if (lk.headphones) { R('#1a1a1d', -3, -21, 6, 1); R('#1a1a1d', -4, -16, 1, 3); R('#1a1a1d', 3, -16, 1, 3); }
  }

  window.Sprites = {
    HW, HH, TH, FLOOR, mix, shade, mat, hash, iso, diamond, diamondFn, disk, slopeRect, isoBox, faceRect,
    newLayer, finalize, nightify, NIGHT, NIGHT_SOFT, makeBuilding, makeTree, makeLamp, makeBench, makeFountain, makeBoat,
    makeCar, CAR_COLORS, makeLogo, loadLogos, makeCityHall, makeStatue, bronzeBust, makeBridge, makeFiller, makeHill, makeIsland, makeLandmark, styleOf, looks, makeWalker, drawSitter, drawWalkerPx, pickR,
  };
})();
