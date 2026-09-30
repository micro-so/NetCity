// City Hall: settings, the mayor's name and the statue made from their photo.
// The photo never leaves the browser: it is reduced to a 16x20 luminance grid
// and cast in bronze. Only that grid is saved (localStorage, this device only).
(function () {
  const KEY_BUST = 'netcity.statue', KEY_NAME = 'netcity.mayor';
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function savedLum() {
    try { const a = JSON.parse(store.get(KEY_BUST)); return Array.isArray(a) && a.length === 320 ? a : null; } catch { return null; }
  }
  const savedBust = () => { const lum = savedLum(); return lum ? window.Sprites.bronzeBust(lum) : null; };
  const mayorName = () => store.get(KEY_NAME) || 'the Mayor';

  // Photo -> 16x20 luminance grid, cropped to the head and shoulders.
  function photoToLum(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth, h = img.naturalHeight;
        const cw = Math.min(w, h * 0.8), ch = cw * 1.25;
        const x0 = (w - cw) / 2, y0 = Math.max(0, Math.min(h - ch, (h - ch) * 0.25));
        // two-step downsample keeps features instead of aliasing
        const mid = document.createElement('canvas'); mid.width = 64; mid.height = 80;
        const mg = mid.getContext('2d'); mg.imageSmoothingQuality = 'high';
        mg.drawImage(img, x0, y0, cw, Math.min(ch, h), 0, 0, 64, 80);
        const c = document.createElement('canvas'); c.width = 16; c.height = 20;
        const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
        g.drawImage(mid, 0, 0, 16, 20);
        const d = g.getImageData(0, 0, 16, 20).data;
        const lum = [];
        for (let i = 0; i < d.length; i += 4) lum.push(+((0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255).toFixed(3));
        URL.revokeObjectURL(url);
        resolve(lum);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
      img.src = url;
    });
  }

  function preview(bust) {
    const c = document.createElement('canvas'); c.width = 24; c.height = 26;
    const g = c.getContext('2d');
    g.drawImage(bust, 4, 1);
    g.fillStyle = '#d9d0bc'; g.fillRect(3, 21, 18, 5);
    g.fillStyle = '#b8813e'; g.fillRect(8, 22, 8, 2);
    c.className = 'bust';
    return c;
  }

  function seg(name, options, current) {
    return `<div class="seg" data-set="${name}">${options.map(([v, label]) =>
      `<button class="btn ${String(v) === String(current) ? 'on' : ''}" data-v="${v}">${label}</button>`).join('')}</div>`;
  }

  function open(api) {
    const win = window.Office.makeWindow('hall', '<i style="background:#6fa894"></i>City Hall<em>Settings & the mayor’s office</em>');
    const body = win.querySelector('.body');
    body.className = 'body hall-body';
    const tod = document.querySelector('[data-tod].on')?.dataset.tod || 'dusk';
    const speed = document.querySelector('[data-speed].on')?.dataset.speed || '1';
    const labelsOn = document.getElementById('toggleLabels').classList.contains('on');
    body.innerHTML = `
      <section class="mayor">
        <div class="plinth"></div>
        <div class="mayor-f">
          <label class="k" for="mayorName">Mayor</label>
          <input id="mayorName" maxlength="40" placeholder="Your name" value="${esc(store.get(KEY_NAME) || '')}">
          <div class="acts">
            <label class="btn">Upload photo<input type="file" accept="image/*" hidden></label>
            <button class="btn" data-act="reset">Reset statue</button>
          </div>
          <p class="hint">Your photo becomes a bronze bust in the plaza. It’s processed in this browser and only a tiny 16×20 grid is saved on this device.</p>
          <p class="err" hidden></p>
        </div>
      </section>
      <section>
        <h4>City</h4>
        <div class="row"><span class="k">Map</span>${seg('map', [['default', 'Default'], ['sf', 'San Francisco'], ['nyc', 'New York']], api.mapId)}</div>
        <div class="row"><span class="k">Light</span>${seg('tod', [['day', '☀ Day'], ['dusk', '◐ Golden'], ['night', '☾ Night'], ['cycle', '⟳ Cycle']], tod)}</div>
        <div class="row"><span class="k">Street life</span>${seg('speed', [['0', 'Paused'], ['1', 'Normal'], ['3', 'Busy']], speed)}</div>
        <div class="row"><span class="k">Labels</span>${seg('labels', [['1', 'On'], ['0', 'Off']], labelsOn ? '1' : '0')}</div>
        <div class="row"><span class="k">Whales</span>${seg('whales', [['1', 'On'], ['0', 'Off']], api.whales() ? '1' : '0')}</div>
      </section>
      <section>
        <h4>Records</h4>
        <div class="row"><span class="k">Source</span><span>${api.stats.demo ? 'Demo city (made-up data)' : 'Micro Blocks'}</span></div>
        <div class="row"><span class="k">Companies</span><span>${api.stats.companies} with a touch in the last 30 days</span></div>
        <div class="row"><span class="k">People</span><span>${api.stats.people} you know there</span></div>
        <div class="row"><span class="k">Data</span>${seg('source', [['demo', 'Demo'], ['micro', 'My Micro network']], api.stats.demo ? 'demo' : 'micro')}</div>
        <div class="row"><span class="k">Access token</span><input id="netToken" type="password" autocomplete="off" placeholder="Only needed when deployed" value="${esc(store.get('netcity.token') || '')}"></div>
        <p class="hint">Your Micro data is read on the server with <code>MICRO_API_KEY</code> and <code>MICRO_TEAM_ID</code> (read-only). Deployed copies also need <code>NETCITY_ACCESS_TOKEN</code>; enter the same value here.</p>
      </section>`;

    const plinth = body.querySelector('.plinth');
    const showBust = () => { plinth.innerHTML = ''; plinth.appendChild(preview(savedBust() || window.Sprites.bronzeBust(null))); };
    showBust();
    const err = body.querySelector('.err');

    body.querySelector('#netToken').addEventListener('change', (e) => store.set('netcity.token', e.target.value.trim() || null));
    body.querySelector('#mayorName').addEventListener('input', (e) => store.set(KEY_NAME, e.target.value.trim() || null));
    body.querySelector('input[type=file]').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      err.hidden = true;
      try {
        const lum = await photoToLum(file);
        store.set(KEY_BUST, JSON.stringify(lum));
        api.setStatue(window.Sprites.bronzeBust(lum));
        showBust();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      e.target.value = '';
    });
    body.querySelector('[data-act=reset]').onclick = () => { store.set(KEY_BUST, null); api.setStatue(null); showBust(); };

    body.querySelectorAll('[data-set]').forEach((group) => {
      group.querySelectorAll('button').forEach((btn) => {
        btn.onclick = () => {
          group.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
          const v = btn.dataset.v;
          switch (group.dataset.set) {
            case 'tod': document.querySelector(`[data-tod="${v}"]`).click(); break;
            case 'speed': document.querySelector(`[data-speed="${v}"]`).click(); break;
            case 'labels': { const t = document.getElementById('toggleLabels'); if (t.classList.contains('on') !== (v === '1')) t.click(); break; }
            case 'whales': api.setWhales(v === '1'); break;
            case 'source': {
              const u = new URL(location.href);
              if (v === 'micro') u.searchParams.set('real', ''); else u.searchParams.delete('real');
              location.href = u.toString().replace('real=', 'real');
              break;
            }
            case 'map': {
              store.set('netcity.map', v);
              const u = new URL(location.href); u.searchParams.delete('map');
              location.href = u.toString();
              break;
            }
          }
        };
      });
    });
  }

  window.Civic = { open, savedBust, mayorName };
})();
