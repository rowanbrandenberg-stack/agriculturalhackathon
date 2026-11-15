/* Spray or Wait: user interface. Engine lives in engine.js, simulated tower in sim.js. */
(function () {
  const E = window.SprayEngine, S = window.SpraySim;
  const $ = id => document.getElementById(id);
  const f1 = E.f1;
  const WATCH_HOURS = { low: 1, medium: 4, high: 12 }; // post spray watch, placeholder values to confirm with a PCA
  /* Spray profiles: the applicator picks what the PCA already told them to spray. The tool never recommends a product.
     Values are starting points to confirm against the label and with a PCA. */
  const PROFILES = {
    custom: { name: 'Custom (set below)', vol: null, heat: null, text: '', note: 'Set volatility yourself from the product label.' },
    oil: { name: 'Horticultural oil', vol: 'low', heat: 90, text: 'Oil sprays can burn leaves and fruit in heat.', note: 'Low vapor risk. Heat limit 90\u00B0F because oil can burn leaves and fruit.' },
    sulfur: { name: 'Sulfur', vol: 'low', heat: 90, text: 'Sulfur can burn foliage in heat.', note: 'Low vapor risk. Heat limit 90\u00B0F because sulfur can burn foliage.' },
    contact: { name: 'Contact insecticide, low volatility', vol: 'low', heat: null, text: '', note: 'Droplet drift is the main risk. Standard checks apply.' },
    volatile: { name: 'Volatile herbicide on the orchard floor', vol: 'high', heat: 85, text: 'Volatile products give off more vapor in heat, and vapor can drift for hours after spraying.', note: 'High vapor risk. Any inversion is a stop, heat limit 85\u00B0F, and the after spray watch runs 12 hours.' }
  };
  const SITE_WORDS = { 0: 'north', 45: 'northeast', 90: 'east', 135: 'southeast', 180: 'south', 225: 'southwest', 270: 'west', 315: 'northwest' };

  let cfg = Object.assign({}, E.DEFAULT_CFG);
  try { const saved = JSON.parse(localStorage.getItem('sow_cfg') || 'null'); if (saved) Object.assign(cfg, saved); } catch (e) {}

  let data = S.generateDay(7);
  let stepMin = S.STEP_MIN;
  let evals = [];
  let idx = Math.round(370 / stepMin);
  let playing = false, timer = null;
  let log = [];
  let session = { state: 'idle', startMin: null, endMin: null, watchUntil: null };
  let lastStatus = null;
  let fcState = null;
  const today = new Date();

  /* ---------- helpers ---------- */
  function fmtTime(min) {
    min = ((Math.round(min) % 1440) + 1440) % 1440;
    let h = Math.floor(min / 60), m = min % 60; const ap = h < 12 ? 'AM' : 'PM';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + String(m).padStart(2, '0') + ' ' + ap;
  }
  function fmtDur(h) { const m = Math.round(h * 60); if (m < 60) return m + ' min'; const hh = Math.floor(m / 60), mm = m % 60; return hh + ' h' + (mm ? ' ' + mm + ' min' : ''); }
  function stamp(min) {
    const d = today; const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(Math.floor(min / 60)) + ':' + p(min % 60);
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function saveCfg() { try { localStorage.setItem('sow_cfg', JSON.stringify(cfg)); } catch (e) {} }
  let community = [], overIdx = null;
  function recompute() { evals = data.map(r => E.evaluate(r, cfg)); overIdx = null; }
  /* Network reports are about right now, so they only adjust the current reading, not the whole day. */
  function setNow() {
    if (overIdx != null && overIdx !== idx) evals[overIdx] = E.evaluate(data[overIdx], cfg);
    evals[idx] = E.evaluate(data[idx], Object.assign({}, cfg, { community: community })); overIdx = idx;
  }
  const COL = { GO: '#1c7c3c', CAUTION: '#b96a00', STOP: '#b3261e' };

  /* ---------- status card ---------- */
  function goodReasons(r, ev) {
    const out = [];
    out.push(['No inversion', 'Air at ' + cfg.hiLabel + ' is ' + f1(-ev.dT) + '°F cooler than at ' + cfg.loLabel + ', so the air is mixing upward.']);
    out.push(['Wind in range at both heights', f1(r.wLo) + ' mph at ' + cfg.loLabel + ' and ' + f1(r.wHi) + ' mph at ' + cfg.hiLabel + ', inside ' + cfg.windMin + ' to ' + cfg.windMax + ' mph.']);
    out.push(['Wind agrees between heights', 'From the ' + E.compass(r.dLo) + ' at ' + cfg.loLabel + ' and the ' + E.compass(r.dHi) + ' at ' + cfg.hiLabel + '.']);
    if (cfg.siteOn) out.push(['Drift heads away from the ' + cfg.siteName, 'Spray would move toward the ' + E.compass((r.dHi + 180) % 360) + '. The ' + cfg.siteName + ' is to the ' + E.compass(cfg.siteBearing) + '.']);
    return out;
  }
  function renderStatus() {
    const r = data[idx], ev = evals[idx];
    const card = $('statusCard'); card.className = 'status ' + ev.status;
    $('statusWord').textContent = ev.status;
    let action = { GO: 'Conditions are inside your limits at both heights.', CAUTION: 'Marginal. Read the reasons and recheck before each tank.', STOP: 'Do not spray right now.' }[ev.status];
    if (ev.plan.mode === 'partial') action = 'Part of the block can go now. Hold the edge rows shown on the block map.';
    if (session.state === 'spraying' && ev.status === 'STOP') action = 'Stop spraying now.';
    $('statusAction').textContent = action;
    const ul = $('reasons'); ul.innerHTML = '';
    if (ev.triggers.length) {
      ev.triggers.forEach(t => { const li = document.createElement('li'); li.className = 'l' + t.level; li.innerHTML = '<b>' + esc(t.title) + '</b>' + esc(t.text); ul.appendChild(li); });
    } else {
      goodReasons(r, ev).forEach(g => { const li = document.createElement('li'); li.className = 'ok'; li.innerHTML = '<b>' + esc(g[0]) + '</b>' + esc(g[1]); ul.appendChild(li); });
    }
    const gp = $('groundPill'); gp.textContent = ev.ground.status; gp.className = 'pill ' + ev.ground.status;
    $('groundText').textContent = ev.ground.text;
    const gm = $('groundMiss');
    if (ev.missed) {
      const miss = ev.triggers.filter(t => !/^WIND_(LOW|HIGH)_LO$/.test(t.code)).map(t => t.title.toLowerCase());
      gm.className = 'gmiss'; gm.textContent = 'It cannot see: ' + miss.join(', ') + '.';
    } else { gm.className = 'gmiss same'; gm.textContent = 'Same answer as the tower right now.'; }
    $('clock').textContent = fmtTime(r.min);
  }

  /* ---------- orchard cross section ---------- */
  function sky(min) {
    const h = min / 60;
    if (h < 5.3 || h > 20) return ['#16263a', '#2a4058', '#e9eef5'];
    if (h < 7 || h > 18.3) return ['#f0b98a', '#f8dcc0', '#3a2a22'];
    return ['#bfe0f5', '#e6f3fb', '#22313a'];
  }
  function renderTower() {
    const r = data[idx], ev = evals[idx];
    const [s1, s2, ink] = sky(r.min);
    const yHi = 78, yLo = 240, gY = 275, mast = 282;
    const inv = ev.dT > 0, near = !inv && ev.dT > -cfg.nearNeutral;
    let h = '';
    h += '<defs><linearGradient id="sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + s1 + '"/><stop offset="1" stop-color="' + s2 + '"/></linearGradient>';
    h += '<marker id="ahL" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#0b6e99"/></marker>';
    h += '<marker id="ahH" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#c2410c"/></marker>';
    h += '<marker id="ahU" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#4b7f9c"/></marker></defs>';
    h += '<rect x="0" y="0" width="560" height="330" fill="url(#sk)"/>';
    if (inv) {
      h += '<rect x="0" y="56" width="560" height="62" fill="#e8590c" opacity="' + Math.min(0.5, 0.18 + ev.dT * 0.05) + '"/>';
      h += '<text x="14" y="50" font-size="12" font-weight="700" fill="' + ink + '">WARMER AIR ABOVE ACTS LIKE A LID</text>';
      h += '<path d="M0,200 C90,186 180,214 280,198 S470,188 560,204 L560,275 L0,275 z" fill="#9aa3ad" opacity="0.5"/>';
    } else if (!near) {
      [90, 205, 470].forEach(x => { h += '<path d="M' + x + ',150 C' + (x - 14) + ',125 ' + (x + 14) + ',105 ' + x + ',72" fill="none" stroke="#4b7f9c" stroke-width="3" stroke-dasharray="6 5" marker-end="url(#ahU)" opacity=".8"/>'; });
      h += '<text x="14" y="50" font-size="12" font-weight="700" fill="' + ink + '">AIR IS MIXING UPWARD</text>';
    } else {
      h += '<text x="14" y="50" font-size="12" font-weight="700" fill="' + ink + '">AIR IS BARELY MIXING</text>';
    }
    h += '<rect x="0" y="' + gY + '" width="560" height="55" fill="#6b5a3c"/><rect x="0" y="' + gY + '" width="560" height="7" fill="#5c7a3a"/>';
    [58, 168, 410, 512].forEach(x => {
      h += '<rect x="' + (x - 5) + '" y="238" width="10" height="38" fill="#5b4326"/>';
      h += '<ellipse cx="' + x + '" cy="196" rx="46" ry="56" fill="#3f7d3a"/><ellipse cx="' + (x - 12) + '" cy="182" rx="26" ry="30" fill="#4f9447" opacity=".7"/>';
    });
    h += '<line x1="' + mast + '" y1="' + gY + '" x2="' + mast + '" y2="62" stroke="#2b2f33" stroke-width="4"/>';
    h += '<line x1="' + mast + '" y1="' + gY + '" x2="' + (mast - 26) + '" y2="' + gY + '" stroke="#2b2f33" stroke-width="4"/><line x1="' + mast + '" y1="' + gY + '" x2="' + (mast + 26) + '" y2="' + gY + '" stroke="#2b2f33" stroke-width="4"/>';
    function sensor(y, col, label, t, w, d, mk) {
      let s = '<circle cx="' + mast + '" cy="' + y + '" r="8" fill="' + col + '" stroke="#fff" stroke-width="2"/>';
      const len = Math.max(8, Math.min(170, w * 13));
      s += '<line x1="' + (mast - 16 - len) + '" y1="' + y + '" x2="' + (mast - 16) + '" y2="' + y + '" stroke="' + col + '" stroke-width="5" stroke-linecap="round" marker-end="url(#' + mk + ')"/>';
      s += '<rect x="' + (mast + 16) + '" y="' + (y - 21) + '" width="246" height="42" rx="8" fill="#fff" opacity=".95" stroke="' + col + '" stroke-width="2"/>';
      s += '<text x="' + (mast + 26) + '" y="' + (y - 4) + '" font-size="12" font-weight="700" fill="' + col + '">' + label + '</text>';
      s += '<text x="' + (mast + 26) + '" y="' + (y + 14) + '" font-size="15" font-weight="800" fill="#17201b">' + f1(t) + '°F · ' + f1(w) + ' mph from ' + E.compass(d) + '</text>';
      return s;
    }
    if (inv) h += '<text x="14" y="302" font-size="12" font-weight="700" fill="#f4f1e6">COOL AIR AND SPRAY STAY TRAPPED UNDER THE LID</text>';
    h += sensor(yHi, '#c2410c', 'SENSOR AT ' + cfg.hiLabel.toUpperCase() + ' (above the canopy)', r.tHi, r.wHi, r.dHi, 'ahH');
    h += sensor(yLo, '#0b6e99', 'SENSOR AT ' + cfg.loLabel.toUpperCase() + ' (ground station height)', r.tLo, r.wLo, r.dLo, 'ahL');
    const dtTxt = ev.dT > 0 ? f1(ev.dT) + '°F warmer up top' : f1(-ev.dT) + '°F cooler up top';
    h += '<rect x="352" y="8" width="200" height="30" rx="15" fill="' + (inv ? '#b3261e' : near ? '#b96a00' : '#1c7c3c') + '"/>';
    h += '<text x="452" y="28" text-anchor="middle" font-size="14" font-weight="800" fill="#fff">' + dtTxt + '</text>';
    $('tower').innerHTML = h;
  }

  /* ---------- compass ---------- */
  function renderCompass() {
    const r = data[idx];
    const cx = 110, cy = 122, R = 76;
    const pt = (deg, rad) => [cx + rad * Math.sin(deg * Math.PI / 180), cy - rad * Math.cos(deg * Math.PI / 180)];
    let h = '<defs><marker id="cL" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#0b6e99"/></marker><marker id="cH" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#c2410c"/></marker></defs>';
    h += '<text x="110" y="14" text-anchor="middle" font-size="12" font-weight="800" fill="#1f3d2b" letter-spacing="1">WHERE DRIFT WOULD GO</text>';
    h += '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="#f6f3ea" stroke="#b9b3a3" stroke-width="1.5"/>';
    if (cfg.siteOn) {
      const a = pt(cfg.siteBearing - cfg.siteCone, R), b = pt(cfg.siteBearing + cfg.siteCone, R);
      h += '<path d="M' + cx + ',' + cy + ' L' + a[0] + ',' + a[1] + ' A' + R + ',' + R + ' 0 0 1 ' + b[0] + ',' + b[1] + ' z" fill="#b3261e" opacity=".13"/>';
    }
    [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([l, d]) => { const p = pt(d, R + 11); h += '<text x="' + p[0] + '" y="' + (p[1] + 4) + '" text-anchor="middle" font-size="11" font-weight="700" fill="#5d665f">' + l + '</text>'; });
    h += '<rect x="' + (cx - 11) + '" y="' + (cy - 11) + '" width="22" height="22" rx="3" fill="#3f7d3a"/>';
    function arrow(dFrom, spd, col, mk, w) {
      if (spd < 0.5) return '';
      const p = pt((dFrom + 180) % 360, Math.min(R - 6, 16 + spd * 5));
      return '<line x1="' + cx + '" y1="' + cy + '" x2="' + p[0] + '" y2="' + p[1] + '" stroke="' + col + '" stroke-width="' + w + '" stroke-linecap="round" marker-end="url(#' + mk + ')"/>';
    }
    h += arrow(r.dHi, r.wHi, '#c2410c', 'cH', 4.5) + arrow(r.dLo, r.wLo, '#0b6e99', 'cL', 4.5);
    if (cfg.siteOn) {
      const p = pt(cfg.siteBearing, R);
      h += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="7" fill="#b3261e" stroke="#fff" stroke-width="2"/>';
      const lp = pt(cfg.siteBearing, R - 20);
      h += '<text x="' + lp[0] + '" y="' + (lp[1] + (cfg.siteBearing > 90 && cfg.siteBearing < 270 ? -6 : 16)) + '" text-anchor="middle" font-size="11" font-weight="800" fill="#b3261e">' + esc(cfg.siteName) + '</text>';
    }
    $('compass').innerHTML = h;
    const ev = evals[idx];
    renderBlock(ev);
    $('miniStats').innerHTML =
      '<div><span>Temp difference</span><b>' + (ev.dT > 0 ? '+' : '') + f1(ev.dT) + ' °F</b></div>' +
      '<div><span>Wind speed difference</span><b>' + (ev.shearSpd > 0 ? '+' : '') + f1(ev.shearSpd) + ' mph</b></div>' +
      '<div><span>Wind direction difference</span><b>' + Math.round(E.angDiff(r.dLo, r.dHi)) + '°</b></div>';
  }

  /* ---------- whole block or part of it ---------- */
  function renderBlock(ev) {
    const N = 12, x0 = 40, y0 = 6, cell = 11, plan = ev.plan; let held = 0, h = '';
    h += '<rect x="' + (x0 - 4) + '" y="' + (y0 - 4) + '" width="' + (N * cell + 8) + '" height="' + (N * cell + 8) + '" rx="6" fill="#efe9da" stroke="#b9b3a3"/>';
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const cx = (i + 0.5) / N * 2 - 1, cy = (j + 0.5) / N * 2 - 1; let hold = plan.mode === 'none';
      if (plan.mode === 'partial') plan.holds.forEach(s => { const ux = Math.sin(s.bearing * Math.PI / 180), uy = -Math.cos(s.bearing * Math.PI / 180); if (cx * ux + cy * uy > Math.abs(ux) + Math.abs(uy) - cfg.bufferRows * 2 / N) hold = true; });
      if (hold) held++;
      h += '<circle cx="' + (x0 + (i + 0.5) * cell) + '" cy="' + (y0 + (j + 0.5) * cell) + '" r="4" fill="' + (hold ? '#d9d2c2' : plan.mode === 'marginal' ? '#d9a441' : '#3f7d3a') + '"' + (hold ? ' stroke="#b3261e" stroke-width="1.2"' : '') + '/>';
    }
    $('blockMap').innerHTML = h;
    const pct = Math.round((1 - held / (N * N)) * 100);
    $('blockTxt').innerHTML = plan.mode === 'all' ? '<b>Spray the whole block.</b>' : plan.mode === 'none' ? '<b>Hold the whole block.</b>' : plan.mode === 'marginal' ? '<b>Whole block is marginal.</b> The issue is not tied to one edge, so no part of the block is safer than the rest.' :
      '<b>Spray ' + pct + '% now.</b> Hold the ' + cfg.bufferRows + ' edge rows facing the ' + esc(plan.holds.map(s => s.who).join(' and ')) + ' until the wind stops pointing that way.';
  }

  /* ---------- timeline ---------- */
  function runs(arr) { const out = []; let s = 0; for (let i = 1; i <= arr.length; i++) { if (i === arr.length || arr[i] !== arr[s]) { out.push([s, i, arr[s]]); s = i; } } return out; }
  function renderTimeline() {
    const svg = $('tl'); const W = Math.max(300, svg.clientWidth || 1000), H = 300; const narrow = W < 700;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    const L = narrow ? 76 : 150, Rm = narrow ? 6 : 12, n = data.length;
    const x = i => L + (i / n) * (W - L - Rm);
    let h = '';
    const SHORT = { 'Two height tower': 'Tower', 'Ground station only': 'Ground only', 'Risk it missed': 'Missed', 'Temp difference': 'Temp diff', 'Wind speed': 'Wind mph' };
    const lab = (y, t, sub) => narrow ? '<text x="2" y="' + y + '" font-size="11" font-weight="700" fill="#17201b">' + SHORT[t] + '</text>' :
      '<text x="8" y="' + y + '" font-size="12" font-weight="700" fill="#17201b">' + t + '</text>' + (sub ? '<text x="8" y="' + (y + 13) + '" font-size="10" fill="#5d665f">' + sub + '</text>' : '');
    // ribbons
    h += lab(26, 'Two height tower');
    runs(evals.map(e => e.status)).forEach(([a, b, s]) => { h += '<rect x="' + x(a) + '" y="8" width="' + (x(b) - x(a) + 0.5) + '" height="28" fill="' + COL[s] + '"/>'; });
    h += lab(57, 'Ground station only');
    runs(evals.map(e => e.ground.status)).forEach(([a, b, s]) => { h += '<rect x="' + x(a) + '" y="42" width="' + (x(b) - x(a) + 0.5) + '" height="20" fill="' + COL[s] + '" opacity=".8"/>'; });
    h += lab(78, 'Risk it missed');
    runs(evals.map(e => e.ground.status === 'GO' && e.status !== 'GO' ? 1 : 0)).forEach(([a, b, s]) => { if (s) h += '<rect x="' + x(a) + '" y="68" width="' + (x(b) - x(a) + 0.5) + '" height="10" fill="#17201b"/>'; });
    // chart A: temp difference
    const aT = 96, aB = 176, aMin = -4, aMax = 7; const ya = v => aB - (Math.max(aMin, Math.min(aMax, v)) - aMin) / (aMax - aMin) * (aB - aT);
    h += lab(126, 'Temp difference', cfg.hiLabel + ' minus ' + cfg.loLabel + ', °F');
    h += '<rect x="' + L + '" y="' + aT + '" width="' + (W - L - Rm) + '" height="' + (ya(0) - aT) + '" fill="#b3261e" opacity=".09"/>';
    h += '<line x1="' + L + '" y1="' + ya(0) + '" x2="' + (W - Rm) + '" y2="' + ya(0) + '" stroke="#b3261e" stroke-width="1" stroke-dasharray="4 3"/>';
    h += '<text x="' + (W - Rm - 4) + '" y="' + (aT + 12) + '" text-anchor="end" font-size="10" fill="#b3261e">above the line = inversion</text>';
    h += '<polyline fill="none" stroke="#17201b" stroke-width="2" points="' + evals.map((e, i) => x(i + 0.5).toFixed(1) + ',' + ya(e.dT).toFixed(1)).join(' ') + '"/>';
    // chart B: wind
    const bT = 190, bB = 270, bMax = 16; const yb = v => bB - Math.min(bMax, v) / bMax * (bB - bT);
    h += lab(222, 'Wind speed', 'mph, label range shaded');
    h += '<rect x="' + L + '" y="' + yb(cfg.windMax) + '" width="' + (W - L - Rm) + '" height="' + (yb(cfg.windMin) - yb(cfg.windMax)) + '" fill="#1c7c3c" opacity=".12"/>';
    h += '<polyline fill="none" stroke="#c2410c" stroke-width="2" points="' + data.map((r, i) => x(i + 0.5).toFixed(1) + ',' + yb(r.wHi).toFixed(1)).join(' ') + '"/>';
    h += '<polyline fill="none" stroke="#0b6e99" stroke-width="2" points="' + data.map((r, i) => x(i + 0.5).toFixed(1) + ',' + yb(r.wLo).toFixed(1)).join(' ') + '"/>';
    h += '<text x="' + (W - Rm - 4) + '" y="' + (bT + 10) + '" text-anchor="end" font-size="10" fill="#c2410c">' + cfg.hiLabel + '</text><text x="' + (W - Rm - 40) + '" y="' + (bT + 10) + '" text-anchor="end" font-size="10" fill="#0b6e99">' + cfg.loLabel + '</text>';
    // hours
    for (let hr = 0; hr <= 24; hr += (narrow ? 6 : 2)) {
      const xi = L + (hr / 24) * (W - L - Rm);
      h += '<line x1="' + xi + '" y1="8" x2="' + xi + '" y2="272" stroke="#000" opacity=".07"/>';
      if (hr < 24) h += '<text x="' + (xi + 3) + '" y="290" font-size="11" fill="#5d665f">' + fmtTime(hr * 60).replace(':00', '') + '</text>';
    }
    // spray session shading
    if (session.startMin != null) {
      const a = x(session.startMin / stepMin), b = x((session.endMin != null ? session.endMin : data[idx].min) / stepMin);
      h += '<rect x="' + a + '" y="2" width="' + Math.max(2, b - a) + '" height="4" fill="#0b6e99"/>';
      if (session.watchUntil != null && session.endMin != null) h += '<rect x="' + b + '" y="2" width="' + Math.max(0, x(Math.min(1440, session.watchUntil) / stepMin) - b) + '" height="4" fill="#0b6e99" opacity=".35"/>';
    }
    // playhead
    const px = x(idx + 0.5);
    h += '<line x1="' + px + '" y1="0" x2="' + px + '" y2="276" stroke="#17201b" stroke-width="2"/><circle cx="' + px + '" cy="4" r="5" fill="#17201b"/>';
    svg.innerHTML = h;
    const base = evals.map((e, i) => i === overIdx ? E.evaluate(data[i], cfg) : e);  // day totals ignore live network reports
    const missedH = base.filter(e => e.ground.status === 'GO' && e.status !== 'GO').length * stepMin / 60;
    const stopMiss = base.filter(e => e.ground.status === 'GO' && e.status === 'STOP').length * stepMin / 60;
    $('tlfoot').innerHTML = 'Today a ground station alone would have said "looks fine" for <b>' + f1(missedH) + ' hours</b> that the tower flagged, including <b>' + f1(stopMiss) + ' hours</b> the tower called STOP.';
  }
  function tlPick(evn) {
    const svg = $('tl'); const rect = svg.getBoundingClientRect(); const W = rect.width; const L = W < 700 ? 76 : 150, Rm = W < 700 ? 6 : 12;
    const f = (evn.clientX - rect.left - L) / (W - L - Rm);
    if (f < 0 || f > 1) return; jump(Math.min(data.length - 1, Math.floor(f * data.length)));
  }

  /* ---------- next window ---------- */
  function renderWindow() {
    const box = $('windowBox'); const now = idx; const ev = evals[now];
    const wins = E.goWindows(evals, stepMin).filter(w => w.end > now).map(w => { const s = Math.max(w.start, now); return { start: s, end: w.end, hours: (w.end - s) * stepMin / 60 }; });
    const fit = wins.find(w => w.hours >= cfg.jobHours);
    let h = '';
    if (fit) {
      const startTxt = fit.start === now ? 'Now' : fmtTime(data[fit.start].min);
      h += '<div class="big">' + startTxt + ' until ' + fmtTime(fit.end * stepMin) + '</div><div class="sub">' + fmtDur(fit.hours) + ' of GO conditions, enough for a ' + fmtDur(cfg.jobHours) + ' job.</div>';
    } else {
      h += '<div class="big">No window left today</div><div class="sub">Nothing ahead gives ' + fmtDur(cfg.jobHours) + ' of GO conditions.</div>';
      const short = wins[0]; if (short) h += '<div class="sub">A ' + fmtDur(short.hours) + ' gap ' + (short.start === now ? 'is open now' : 'opens at ' + fmtTime(data[short.start].min)) + ', too short for this job.</div>';
    }
    if (ev.status === 'GO') {
      let j = now; while (j < evals.length && evals[j].status === 'GO') j++;
      if (j < evals.length) {
        const mins = (j - now) * stepMin; const why = evals[j].triggers[0];
        h += '<div class="' + (mins <= 60 ? 'warn' : 'sub') + '">Conditions turn in ' + fmtDur(mins / 60) + ' (' + fmtTime(data[j].min) + '): ' + esc(why.title.toLowerCase()) + '.</div>';
      }
    }
    let k = now; while (k < evals.length && evals[k].dT > 0) k++; while (k < evals.length && evals[k].dT <= 0) k++;
    if (k < evals.length && evals[now].dT <= 0) {
      h += '<div class="' + (cfg.volatility === 'high' ? 'warn' : 'sub') + '">Next inversion expected about ' + fmtTime(data[k].min) + '.' + (cfg.volatility === 'high' ? ' High volatility product: vapor can still move then, so finish well before.' : '') + '</div>';
    }
    if (fit) h += '<div class="row"><button id="icsBtn" class="btn">Add window to calendar</button></div>';
    h += '<div class="sub small">Looks ahead using the tower trend for the rest of today (simulated here).</div>';
    box.innerHTML = h;
    if (fit) $('icsBtn').onclick = () => {
      const z = m => stamp(Math.min(1439, m)).replace(/[- :]/g, '').replace(/^(\d{8})(\d{4})$/, '$1T$200');
      const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:SprayOrWait', 'BEGIN:VEVENT', 'UID:sow' + Date.now() + '@sprayorwait', 'DTSTAMP:' + z(data[now].min), 'DTSTART:' + z(data[fit.start].min), 'DTEND:' + z(fit.end * stepMin), 'SUMMARY:Spray window, ' + $('blockName').textContent, 'DESCRIPTION:GO conditions forecast at both heights. Recheck Spray or Wait and the label before you start.', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })); a.download = 'spray_window.ics'; document.body.appendChild(a); a.click(); a.remove();
    };
  }

  /* ---------- session ---------- */
  function renderSession() {
    const box = $('sessionBox'), btn = $('sprayBtn'); const nowMin = data[idx].min;
    if (session.state === 'idle') { box.className = 'sessionBox'; box.textContent = 'Not spraying. Press start when the rig goes out and the tower keeps watching every reading.'; btn.textContent = 'Start spraying'; btn.className = 'btn primary'; }
    else if (session.state === 'spraying') { box.className = 'sessionBox on'; box.innerHTML = '<b>Spraying since ' + fmtTime(session.startMin) + '.</b> Watching every reading. You get an alert the moment conditions change.'; btn.textContent = 'Finish spraying'; btn.className = 'btn danger'; }
    else { box.className = 'sessionBox watch'; const left = Math.max(0, session.watchUntil - nowMin); box.innerHTML = '<b>After spray watch.</b> Sprayed ' + fmtTime(session.startMin) + ' to ' + fmtTime(session.endMin) + '. Watching ' + fmtDur(left / 60) + ' more for an inversion (' + cfg.volatility + ' volatility).'; btn.textContent = 'End watch'; btn.className = 'btn'; }
  }
  function toggleSession() {
    const nowMin = data[idx].min, ev = evals[idx];
    if (session.state === 'idle') {
      session = { state: 'spraying', startMin: nowMin, endMin: null, watchUntil: null };
      fileRep = null; renderFile();
      addLog('SPRAY START' + (ev.status !== 'GO' ? ' (started on ' + ev.status + ')' : ''));
    } else if (session.state === 'spraying') {
      session.state = 'watch'; session.endMin = nowMin; session.watchUntil = nowMin + WATCH_HOURS[cfg.volatility] * 60;
      addLog('SPRAY END, watch for ' + WATCH_HOURS[cfg.volatility] + ' h');
      buildFile();
    } else { addLog('WATCH ENDED'); session = { state: 'idle', startMin: null, endMin: null, watchUntil: null }; }
    renderAll();
  }

  /* ---------- log ---------- */
  function addLog(event) {
    const r = data[idx], ev = evals[idx];
    log.unshift({ min: r.min, event: event || 'Reading', status: ev.status, ground: ev.ground.status, r: r, dT: ev.dT, trig: ev.triggers.map(t => t.title).join('; ') });
    if (log.length > 800) log.length = 800;
    renderLog();
  }
  function renderLog() {
    const only = $('logAlerts').checked; const tb = $('log').querySelector('tbody'); let h = '';
    log.filter(l => !only || l.event !== 'Reading').slice(0, 200).forEach(l => {
      const isEv = l.event !== 'Reading';
      h += '<tr class="' + (isEv ? 'ev ' + l.status : '') + '"><td class="num">' + stamp(l.min).slice(5) + '</td><td>' + esc(l.event) + '</td><td><span class="pill ' + l.status + '">' + l.status + '</span></td><td><span class="pill ' + l.ground + '">' + l.ground + '</span></td><td class="num">' + f1(l.r.tLo) + '</td><td class="num">' + f1(l.r.tHi) + '</td><td class="num">' + (l.dT > 0 ? '+' : '') + f1(l.dT) + '</td><td class="num">' + f1(l.r.wLo) + ' ' + E.compass(l.r.dLo) + '</td><td class="num">' + f1(l.r.wHi) + ' ' + E.compass(l.r.dHi) + '</td><td>' + esc(l.trig || 'None. All checks passed.') + '</td></tr>';
    });
    tb.innerHTML = h || '<tr><td colspan="10">No entries yet.</td></tr>';
  }
  function download(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  function exportLog() {
    const q = s => '"' + String(s).replace(/"/g, '""') + '"';
    const rows = [['timestamp', 'event', 'status', 'ground_station_only', 'temp_5ft_f', 'temp_30ft_f', 'temp_diff_f', 'wind_5ft_mph', 'wind_5ft_from_deg', 'wind_30ft_mph', 'wind_30ft_from_deg', 'triggers', 'product', 'product_volatility', 'wind_limits_mph'].join(',')];
    log.slice().reverse().forEach(l => rows.push([stamp(l.min), q(l.event), l.status, l.ground, f1(l.r.tLo), f1(l.r.tHi), f1(l.dT), f1(l.r.wLo), Math.round(l.r.dLo), f1(l.r.wHi), Math.round(l.r.dHi), q(l.trig), q(PROFILES[cfg.profile || 'custom'].name), cfg.volatility, cfg.windMin + ' to ' + cfg.windMax].join(',')));
    download('spray_record_' + stamp(0).slice(0, 10) + '.csv', rows.join('\n'));
  }

  /* ---------- alerts ---------- */
  let audioCtx = null;
  function beep(level) {
    if (!$('optSound').checked) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const n = level === 2 ? 3 : 1;
      for (let i = 0; i < n; i++) { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = level === 2 ? 880 : 620; g.gain.value = 0.12; o.connect(g); g.connect(audioCtx.destination); const t = audioCtx.currentTime + i * 0.22; o.start(t); o.stop(t + 0.15); }
    } catch (e) {}
  }
  function push(title, body) { try { if ($('optPush').checked && 'Notification' in window && Notification.permission === 'granted') new Notification(title, { body: body }); } catch (e) {} }
  function showAlert(status, title, sub) {
    const bar = $('alertBar'); bar.className = 'alertbar ' + status; bar.hidden = false;
    bar.innerHTML = '<div>' + esc(title) + '<div class="sub">' + esc(sub) + '</div></div><button id="alertOk">OK</button>';
    $('alertOk').onclick = () => { bar.hidden = true; };
  }
  function checkAlert() {
    const ev = evals[idx], r = data[idx];
    if (lastStatus && ev.status !== lastStatus) {
      const worse = E.RANK[ev.status] > E.RANK[lastStatus];
      const why = ev.triggers.length ? ev.triggers[0].title + '. ' + ev.triggers[0].text : 'All checks pass at both heights.';
      let title = fmtTime(r.min) + '  ' + lastStatus + ' → ' + ev.status;
      if (session.state === 'spraying' && ev.status === 'STOP') title = fmtTime(r.min) + '  STOP SPRAYING';
      else if (session.state === 'spraying' && ev.status === 'CAUTION') title = fmtTime(r.min) + '  CAUTION while spraying';
      addLog('ALERT ' + lastStatus + ' to ' + ev.status + (session.state === 'spraying' ? ' during spraying' : ''));
      if (worse || session.state !== 'idle') { showAlert(ev.status, title, why); beep(ev.level); push('Spray or Wait: ' + ev.status, why); }
      else { showAlert(ev.status, title, why); }
      if (worse && session.state === 'spraying' && playing) togglePlay();
    } else addLog();
    if (session.state === 'watch') {
      const prev = evals[Math.max(0, idx - 1)];
      if (ev.dT > 0 && prev.dT <= 0) { addLog('POST SPRAY ALERT inversion formed ' + fmtDur((r.min - session.endMin) / 60) + ' after spraying'); showAlert('CAUTION', fmtTime(r.min) + '  Inversion formed after your spray', 'Vapor from the treated block can now move sideways. Noted in the record.'); beep(1); push('Spray or Wait', 'Inversion formed after your spray.'); }
      if (r.min >= session.watchUntil) { addLog('WATCH COMPLETE'); session = { state: 'idle', startMin: null, endMin: null, watchUntil: null }; }
    }
    lastStatus = ev.status;
  }

  /* ---------- playback ---------- */
  function renderAll() { renderStatus(); renderTower(); renderCompass(); renderTimeline(); renderWindow(); renderSession(); }
  function stepOnce() {
    if (idx >= data.length - 1) { if (playing) togglePlay(); return; }
    idx++; setNow(); checkAlert(); renderAll();
  }
  function togglePlay() {
    playing = !playing; $('play').textContent = playing ? 'Pause' : 'Play';
    clearInterval(timer); if (playing) timer = setInterval(stepOnce, +$('speed').value);
  }
  function jump(i) {
    idx = i; setNow(); lastStatus = evals[idx].status; $('alertBar').hidden = true;
    if (session.state !== 'idle' && data[idx].min < session.startMin) session = { state: 'idle', startMin: null, endMin: null, watchUntil: null };
    addLog('Reading'); renderAll();
  }

  /* ---------- settings ---------- */
  function fillForm() {
    $('cfgProf').value = cfg.profile || 'custom'; $('profNote').textContent = PROFILES[cfg.profile || 'custom'].note;
    $('cfgVol').value = cfg.volatility; $('cfgMin').value = cfg.windMin; $('cfgMax').value = cfg.windMax; $('cfgJob').value = cfg.jobHours;
    $('cfgSiteOn').value = cfg.siteOn ? '1' : '0'; $('cfgSiteName').value = cfg.siteName; $('cfgSiteDir').value = String(cfg.siteBearing);
    $('cfgShS').value = cfg.shearSpeed; $('cfgShD').value = cfg.shearDir; $('cfgBuf').value = cfg.bufferRows;
  }
  function readForm() {
    const num = (id, d) => { const v = parseFloat($(id).value); return isFinite(v) ? v : d; };
    const pk = $('cfgProf').value, pr = PROFILES[pk];
    if (pk !== cfg.profile && pr.vol) $('cfgVol').value = pr.vol;            // profile just changed: apply its volatility
    else if (pr.vol && $('cfgVol').value !== pr.vol) { $('cfgProf').value = 'custom'; } // volatility edited by hand: back to custom
    const pk2 = $('cfgProf').value, pr2 = PROFILES[pk2];
    cfg.profile = pk2; cfg.heatLimit = pr2.heat; cfg.heatText = pr2.text; cfg.productName = pk2 === 'custom' ? '' : pr2.name.toLowerCase();
    $('profNote').textContent = pr2.note;
    cfg.volatility = $('cfgVol').value; cfg.windMin = num('cfgMin', 3); cfg.windMax = num('cfgMax', 10); cfg.jobHours = num('cfgJob', 2);
    cfg.siteOn = $('cfgSiteOn').value === '1'; cfg.siteName = $('cfgSiteName').value.trim() || 'sensitive site'; cfg.siteBearing = +$('cfgSiteDir').value;
    cfg.shearSpeed = num('cfgShS', 5); cfg.shearDir = num('cfgShD', 45); cfg.bufferRows = Math.max(1, Math.min(6, Math.round(num('cfgBuf', 3))));
    saveCfg(); recompute(); setNow(); lastStatus = evals[idx].status; addLog('SETTINGS CHANGED'); renderAll(); if (fcState) renderForecast();
  }

  /* ---------- CSV in and out ---------- */
  function sampleCsv() {
    const rows = ['time,temp_low_f,temp_high_f,wind_low_mph,wind_high_mph,dir_low_deg,dir_high_deg'];
    S.generateDay(7).forEach(r => rows.push([stamp(r.min).slice(11), f1(r.tLo), f1(r.tHi), f1(r.wLo), f1(r.wHi), Math.round(r.dLo), Math.round(r.dHi)].join(',')));
    download('tower_sample.csv', rows.join('\n'));
  }
  function loadCsv(text) {
    const lines = text.trim().split(/\r?\n/); const head = lines.shift().toLowerCase().split(',').map(s => s.trim());
    const col = n => head.indexOf(n); const need = ['time', 'temp_low_f', 'temp_high_f', 'wind_low_mph', 'wind_high_mph', 'dir_low_deg', 'dir_high_deg'];
    if (need.some(n => col(n) < 0)) { alertInline('CSV needs these columns: ' + need.join(', ')); return; }
    const out = [];
    lines.forEach(l => { const c = l.split(','); const tm = (c[col('time')] || '').match(/(\d{1,2}):(\d{2})/); if (!tm) return;
      const row = { min: +tm[1] * 60 + +tm[2], tLo: +c[col('temp_low_f')], tHi: +c[col('temp_high_f')], wLo: +c[col('wind_low_mph')], wHi: +c[col('wind_high_mph')], dLo: +c[col('dir_low_deg')], dHi: +c[col('dir_high_deg')] };
      if (Object.values(row).every(isFinite)) out.push(row); });
    if (out.length < 2) { alertInline('No usable rows found in that CSV.'); return; }
    out.sort((a, b) => a.min - b.min); data = out; stepMin = Math.max(1, out[1].min - out[0].min);
    $('srcLabel').textContent = 'Uploaded tower data: ' + out.length + ' readings, every ' + stepMin + ' min';
    recompute(); log = []; session = { state: 'idle', startMin: null, endMin: null, watchUntil: null }; jump(0);
  }
  function alertInline(msg) { showAlert('CAUTION', msg, ''); }

  /* ---------- real forecast outlook ---------- */
  async function loadForecast() {
    const box = $('fcBox'); box.innerHTML = '<div class="muted">Loading forecast…</div>';
    const lat = parseFloat($('lat').value), lon = parseFloat($('lon').value);
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
      '&hourly=temperature_2m,temperature_80m,wind_speed_10m,wind_direction_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=4';
    try {
      const res = await fetch(url); if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json(); const hh = j.hourly;
      const nowLocal = new Date(Date.now() + j.utc_offset_seconds * 1000).toISOString().slice(0, 13);
      fcState = { hours: hh.time.map((t, i) => ({ t: t, past: t.slice(0, 13) < nowLocal, r: { tLo: hh.temperature_2m[i], tHi: hh.temperature_80m[i], wLo: hh.wind_speed_10m[i], wHi: hh.wind_speed_10m[i], dLo: hh.wind_direction_10m[i], dHi: hh.wind_direction_10m[i] } })).filter(x => x.r.tLo != null && x.r.tHi != null && x.r.wLo != null) };
      renderForecast();
    } catch (e) {
      fcState = null; box.innerHTML = '<div class="muted">Could not reach the forecast service right now. The live tower call above does not depend on it.</div>';
    }
  }
  function renderForecast() {
    const box = $('fcBox'); const fcfg = Object.assign({}, cfg, { loLabel: 'ground level', hiLabel: '260 ft', skipHiWind: true, skipShearSpeed: true });
    const hrs = fcState.hours.map(x => Object.assign({}, x, { ev: E.evaluate(x.r, fcfg) }));
    const days = {}; hrs.forEach(x => { (days[x.t.slice(0, 10)] = days[x.t.slice(0, 10)] || []).push(x); });
    let h = '<div class="fcgrid"><div></div>';
    for (let i = 0; i < 24; i++) h += '<div class="hr">' + (i % 3 === 0 ? (i === 0 ? '12a' : i < 12 ? i + 'a' : i === 12 ? '12p' : (i - 12) + 'p') : '') + '</div>';
    Object.keys(days).slice(0, 4).forEach(d => {
      const dt = new Date(d + 'T12:00:00'); h += '<div class="day">' + dt.toLocaleDateString('en-US', { weekday: 'short' }) + '</div>';
      const byHour = {}; days[d].forEach(x => byHour[+x.t.slice(11, 13)] = x);
      for (let i = 0; i < 24; i++) { const x = byHour[i]; h += x ? '<div class="c ' + x.ev.status + (x.past ? ' past' : '') + '" data-t="' + x.t + '" title="' + esc(x.ev.status + (x.ev.triggers[0] ? ': ' + x.ev.triggers[0].title : '')) + '"></div>' : '<div></div>'; }
    });
    h += '</div>';
    const fut = hrs.filter(x => !x.past); const wins = E.goWindows(fut.map(x => x.ev), 60); const fit = wins.find(w => w.hours >= cfg.jobHours);
    const lbl = t => new Date(t).toLocaleString('en-US', { weekday: 'short', hour: 'numeric' });
    h += '<div class="fcnext">' + (fit ? 'Next forecast window: ' + lbl(fut[fit.start].t) + ' to ' + lbl(fut[Math.min(fut.length - 1, fit.end)].t) + ' (' + fmtDur(fit.hours) + ')' : 'No ' + fmtDur(cfg.jobHours) + ' window in the forecast.') + '</div>';
    const inv = fut.filter(x => x.ev.dT > 0).length;
    h += '<div class="fcwhy" id="fcWhy">Forecast shows an inversion in ' + inv + ' of the next ' + fut.length + ' hours. Tap an hour for the reason.</div>';
    box.innerHTML = h;
    box.querySelectorAll('.c').forEach(c => c.addEventListener('click', () => { const x = hrs.find(y => y.t === c.dataset.t); $('fcWhy').innerHTML = '<b>' + lbl(x.t) + ': ' + x.ev.status + '.</b> ' + f1(x.r.tLo) + '°F at ground level, ' + f1(x.r.tHi) + '°F at 260 ft, wind ' + f1(x.r.wLo) + ' mph from ' + E.compass(x.r.dLo) + '. ' + esc(x.ev.triggers.map(t => t.title).join('; ') || 'All checks pass.'); }));
  }

  /* ---------- pest guide ---------- */
  function renderPest() {
    const p = window.SprayPests.find(x => x.id === $('pestSel').value) || window.SprayPests[0];
    const row = (t, v) => '<div class="pr"><div class="pk">' + t + '</div><div>' + v + '</div></div>';
    $('pestBox').innerHTML = '<div>' + row('Why it matters', esc(p.why)) + row('When', esc(p.when)) + row('Scout first', esc(p.scout)) + '</div><div>' +
      row('Options Extension lists', '<ul>' + p.options.map(o => '<li>' + esc(o) + '</li>').join('') + '</ul>') + row('Help the grove defend itself', esc(p.defend)) +
      row('Source', '<a href="' + p.src[1] + '" target="_blank" rel="noopener">' + esc(p.src[0]) + '</a>') +
      (p.profile !== 'custom' ? '<div class="row"><button id="pestUse" class="btn primary">Use the ' + PROFILES[p.profile].name.toLowerCase() + ' spray profile</button><span class="muted small">Sets the drift rules for that kind of product.</span></div>' : '') + '</div>';
    const b = $('pestUse'); if (b) b.onclick = () => { $('cfgProf').value = p.profile; readForm(); addLog('PEST: ' + p.name + ', profile set to ' + PROFILES[p.profile].name); };
  }
  function initPests() { $('pestSel').innerHTML = window.SprayPests.map(p => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join(''); $('pestSel').onchange = renderPest; renderPest(); }

  /* ---------- grower network (shared public database) ---------- */
  const SB_URL = 'https://nuafgtzcyrrvtiligkyl.supabase.co/rest/v1/reports';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51YWZndHpjeXJydnRpbGlna3lsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ3NTc1NzQsImV4cCI6MjExMDMzMzU3NH0.mhfolpk5bCK2e2lzn8DTLn1TWnjC5p0cLE1RF9YAa8E';
  const KIND = { inversion: ['Inversion signs', '#b3261e'], drift: ['Drift seen', '#b96a00'], crew: ['Crew in field', '#6d28d9'], spraying: ['Spraying now', '#0b6e99'] };
  let netRows = [], netLocal = [], netOnline = null;
  function blockPos() { return { lat: parseFloat($('lat').value) || 32.69, lon: parseFloat($('lon').value) || -114.62 }; }
  function geo(a, b) {
    const R = 3958.8, rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    const y = Math.sin(dLon) * Math.cos(b.lat * rad), x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos(dLon);
    return { distMi: 2 * R * Math.asin(Math.sqrt(s)), bearing: (Math.atan2(y, x) / rad + 360) % 360 };
  }
  function buildCommunity() {
    const me = blockPos(), now = Date.now();
    community = netRows.concat(netLocal).filter(r => KIND[r.kind]).map(r => Object.assign({ kind: r.kind, note: r.note || '', ageMin: Math.max(0, (now - new Date(r.created_at).getTime()) / 60000), local: !!r.local }, geo(me, { lat: r.lat, lon: r.lon })))
      .filter(c => c.distMi <= 5 && c.ageMin <= 480).sort((a, b) => a.ageMin - b.ageMin);
  }
  function applyNetwork(announce) {
    const before = evals[idx].status; buildCommunity(); setNow(); const after = evals[idx];
    if (announce && after.status !== before) {
      const t = after.triggers.find(x => /^NET_/.test(x.code)) || after.triggers[0];
      addLog('NETWORK REPORT changed status ' + before + ' to ' + after.status);
      if (t) { showAlert(after.status, fmtTime(data[idx].min) + '  Grower network: ' + before + ' → ' + after.status, t.title + '. ' + t.text); beep(after.level); push('Spray or Wait: ' + after.status, t.title); }
    }
    lastStatus = after.status; renderAll(); renderNetwork();
  }
  async function pullNetwork(announce) {
    try {
      const res = await fetch(SB_URL + '?select=id,created_at,kind,lat,lon,note&order=created_at.desc&limit=200', { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      netRows = await res.json(); netOnline = true; const ids = new Set(netRows.map(r => r.id)); netLocal = netLocal.filter(r => !ids.has(r.id));
    } catch (e) { netOnline = false; }
    applyNetwork(announce);
  }
  async function postReport(kind, d, b, note) {
    const me = blockPos(), rad = Math.PI / 180;
    const row = { kind: kind, lat: +(me.lat + d * Math.cos(b * rad) / 69.0).toFixed(3), lon: +(me.lon + d * Math.sin(b * rad) / (69.17 * Math.cos(me.lat * rad))).toFixed(3), note: (note || '').trim().slice(0, 140) || null };
    let saved = null;
    try {
      const res = await fetch(SB_URL, { method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(row) });
      if (!res.ok) throw new Error('HTTP ' + res.status); saved = (await res.json())[0]; netOnline = true;
    } catch (e) { netOnline = false; }
    netLocal.unshift(saved || Object.assign({ id: 'local' + Date.now(), created_at: new Date().toISOString(), local: true }, row));
    addLog('REPORT SENT: ' + KIND[kind][0]); applyNetwork(true);
    return !!saved;
  }
  async function sendReport() {
    $('repBtn').disabled = true;
    const ok = await postReport($('repKind').value, parseFloat($('repDist').value), parseFloat($('repDir').value), $('repNote').value);
    $('repBtn').disabled = false; $('repNote').value = '';
    $('repMsg').textContent = ok ? 'Shared with growers nearby.' : 'No connection. Saved on this device only.';
  }

  /* ---------- report filed for you (pre-fills what Arizona Form 1080 asks for) ---------- */
  let fileRep = null;
  function buildFile() {
    const iS = Math.round(session.startMin / stepMin), iE = Math.min(data.length - 1, Math.round(session.endMin / stepMin));
    let worst = 'GO'; for (let i = iS; i <= iE; i++) { const b = E.evaluate(data[i], cfg).status; if (E.RANK[b] > E.RANK[worst]) worst = b; }
    fileRep = { start: session.startMin, end: session.endMin, rs: data[iS], re: data[iE], worst: worst,
      alerts: log.filter(l => l.min >= session.startMin && l.min <= session.endMin && /^ALERT/.test(l.event)).length, product: PROFILES[cfg.profile || 'custom'].name, filed: null };
    renderFile();
  }
  function fileText() {
    const f = fileRep, w = r => f1(r.wLo) + ' mph from ' + E.compass(r.dLo) + ' at 5 ft, ' + f1(r.wHi) + ' mph from ' + E.compass(r.dHi) + ' at 30 ft';
    return [['Block', $('blockName').textContent], ['Date applied', stamp(f.start).slice(0, 10)], ['Time of application', fmtTime(f.start) + ' to ' + fmtTime(f.end)],
      ['Wind at start', w(f.rs)], ['Wind at finish', w(f.re)], ['Temperature', f1(f.rs.tLo) + '°F at 5 ft, ' + f1(f.rs.tHi) + '°F at 30 ft'],
      ['Product type', f.product], ['Tower call during the job', f.worst + (f.alerts ? ', ' + f.alerts + ' alert' + (f.alerts > 1 ? 's' : '') : ', no alerts')]];
  }
  function renderFile() {
    const box = $('fileBox');
    if (!fileRep) { box.innerHTML = '<div class="muted">When you finish, your required application report is filled in from the tower record. One tap sends it.</div>'; return; }
    let h = '<table class="ft">' + fileText().map(r => '<tr><th>' + r[0] + '</th><td>' + esc(r[1]) + '</td></tr>').join('') + '</table>';
    if (fileRep.filed) h += '<div class="filed"><b>Sent for you.</b> Confirmation ' + fileRep.filed + '. Your conditions were also shared, with no name, to sharpen the call for growers nearby.</div>';
    else h += '<button id="fileBtn" class="btn primary big">Send my report</button>';
    h += '<div class="row"><button id="fileDl" class="btn">Download a copy</button></div>';
    h += '<div class="muted small">Fills in the time of application and wind direction and speed that Arizona Form 1080 asks for. Demo: it does not file with the state yet.</div>';
    box.innerHTML = h;
    const fb = $('fileBtn'); if (fb) fb.onclick = async () => { fb.disabled = true; fb.textContent = 'Sending…';
      await postReport('spraying', 0, 0, 'Application report. Tower call during job: ' + fileRep.worst);
      fileRep.filed = 'SOW ' + stamp(fileRep.start).slice(5, 10).replace('-', '') + ' ' + String(Math.floor(1000 + Math.random() * 9000)) + ' (demo)';
      addLog('APPLICATION REPORT SENT ' + fileRep.filed); renderFile(); };
    $('fileDl').onclick = () => download('application_report_' + stamp(fileRep.start).slice(0, 10) + '.txt', 'SPRAY OR WAIT: APPLICATION REPORT\n\n' + fileText().map(r => r[0] + ': ' + r[1]).join('\n') + (fileRep.filed ? '\nConfirmation: ' + fileRep.filed : '') + '\n');
  }

  /* ---------- grower heatmap ---------- */
  const SAMPLE = (function () { let s = 11; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; const out = [];
    [[1.6, 1.3, 'inversion', 9], [-1.9, 0.4, 'drift', 6], [0.7, -1.8, 'spraying', 7], [-0.9, -1.4, 'crew', 3], [2.3, -0.6, 'inversion', 4]].forEach(c => {
      for (let i = 0; i < c[3]; i++) out.push({ kind: c[2], dx: c[0] + (rnd() - 0.5) * 1.3, dy: c[1] + (rnd() - 0.5) * 1.3, ageMin: 20 + rnd() * 300 }); });
    return out; })();
  function renderHeat() {
    const S = 320, N = 20, span = 3, px = m => S / 2 + m / span * (S / 2), py = m => S / 2 - m / span * (S / 2), W = { drift: 3, inversion: 2, crew: 1.2, spraying: 1 };
    const real = community.filter(c => c.distMi <= span * 1.3).map(c => ({ kind: c.kind, dx: c.distMi * Math.sin(c.bearing * Math.PI / 180), dy: c.distMi * Math.cos(c.bearing * Math.PI / 180), ageMin: c.ageMin, real: true }));
    const pts = real.concat(SAMPLE);
    let h = '<defs><clipPath id="hc"><rect x="0" y="0" width="' + S + '" height="' + S + '" rx="14"/></clipPath></defs><g clip-path="url(#hc)"><rect width="' + S + '" height="' + S + '" fill="#e9e4d4"/>';
    let q = 5; const r2 = () => (q = (q * 16807) % 2147483647) / 2147483647;           // patchwork of fields so it reads as a map
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) h += '<rect x="' + (i * S / 6 + 1.5) + '" y="' + (j * S / 6 + 1.5) + '" width="' + (S / 6 - 3) + '" height="' + (S / 6 - 3) + '" rx="3" fill="' + ['#d7e0bf', '#cddab0', '#e2dcc0', '#d3ddb8'][Math.floor(r2() * 4)] + '"/>';
    const cell = S / N; let vmax = 0; const vals = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const mx = ((i + 0.5) / N * 2 - 1) * span, my = -((j + 0.5) / N * 2 - 1) * span; let v = 0;
      pts.forEach(p => { const d2 = (p.dx - mx) ** 2 + (p.dy - my) ** 2; v += W[p.kind] * Math.exp(-d2 / 0.6) * Math.max(0.3, 1 - p.ageMin / 480); }); vals.push([i, j, v]); if (v > vmax) vmax = v; }
    vals.forEach(([i, j, v]) => { const t = v / Math.max(vmax, 3); if (t < 0.07) return;
      const c = t < 0.5 ? [250 + (249 - 250) * t * 2, 204 + (115 - 204) * t * 2, 21] : [249 + (179 - 249) * (t - 0.5) * 2, 115 + (38 - 115) * (t - 0.5) * 2, 22 + 8 * (t - 0.5) * 2];
      h += '<rect x="' + (i * cell) + '" y="' + (j * cell) + '" width="' + (cell + 0.5) + '" height="' + (cell + 0.5) + '" fill="rgb(' + c.map(Math.round).join(',') + ')" opacity="' + (0.25 + 0.6 * t).toFixed(2) + '"/>'; });
    [1, 2, 3].forEach(m => { h += '<circle cx="' + S / 2 + '" cy="' + S / 2 + '" r="' + (m / span * S / 2) + '" fill="none" stroke="#17201b" stroke-opacity=".28" stroke-dasharray="3 5"/><text x="' + (S / 2 + 4) + '" y="' + (S / 2 - m / span * S / 2 + 12) + '" font-size="9" fill="#17201b" opacity=".6">' + m + ' mi</text>'; });
    real.forEach(p => { h += '<circle cx="' + px(p.dx) + '" cy="' + py(p.dy) + '" r="6" fill="' + KIND[p.kind][1] + '" stroke="#fff" stroke-width="2"/>'; });
    if (cfg.siteOn) { const sx = px(0.45 * Math.sin(cfg.siteBearing * Math.PI / 180)), sy = py(0.45 * Math.cos(cfg.siteBearing * Math.PI / 180)); h += '<circle cx="' + sx + '" cy="' + sy + '" r="5" fill="#b3261e" stroke="#fff" stroke-width="1.5"/><text x="' + (sx + 8) + '" y="' + (sy + 4) + '" font-size="10" font-weight="800" fill="#b3261e">' + esc(cfg.siteName) + '</text>'; }
    h += '<rect x="' + (S / 2 - 9) + '" y="' + (S / 2 - 9) + '" width="18" height="18" rx="4" fill="#1f3d2b" stroke="#fff" stroke-width="2"/><text x="' + S / 2 + '" y="' + (S / 2 + 24) + '" text-anchor="middle" font-size="10" font-weight="800" fill="#1f3d2b">YOU</text>';
    h += '<text x="' + S / 2 + '" y="14" text-anchor="middle" font-size="11" font-weight="800" fill="#17201b">N</text></g>';
    $('heatMap').innerHTML = h;
    $('heatState').textContent = (netOnline ? real.length + ' live report' + (real.length === 1 ? '' : 's') + ' nearby' : 'Offline') + ' + sample reports for the demo';
  }
  function renderNetwork() {
    const cx = 120, cy = 120, R = 100, me = community;
    let h = '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="#f6f3ea" stroke="#b9b3a3"/>';
    [1, 2].forEach(m => { h += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (R * m / 3) + '" fill="none" stroke="#b9b3a3" stroke-dasharray="3 4"/>'; });
    h += '<text x="' + (cx + 4) + '" y="' + (cy - R / 3 + 12) + '" font-size="9" fill="#5d665f">1 mi</text><text x="' + (cx + 4) + '" y="' + (cy - 2 * R / 3 + 12) + '" font-size="9" fill="#5d665f">2 mi</text><text x="' + (cx + 4) + '" y="' + (cy - R + 12) + '" font-size="9" fill="#5d665f">3 mi</text>';
    h += '<text x="' + cx + '" y="12" text-anchor="middle" font-size="11" font-weight="700" fill="#5d665f">N</text>';
    h += '<rect x="' + (cx - 8) + '" y="' + (cy - 8) + '" width="16" height="16" rx="3" fill="#3f7d3a"/>';
    me.filter(c => c.distMi <= 3).forEach(c => { const rr = R * c.distMi / 3, x = cx + rr * Math.sin(c.bearing * Math.PI / 180), y = cy - rr * Math.cos(c.bearing * Math.PI / 180);
      h += '<circle cx="' + x + '" cy="' + y + '" r="7" fill="' + KIND[c.kind][1] + '" stroke="#fff" stroke-width="2" opacity="' + Math.max(0.35, 1 - c.ageMin / 480) + '"/>'; });
    $('netMap').innerHTML = h;
    const using = new Set(evals[idx].triggers.filter(t => /^NET_/.test(t.code)).map(t => ({ NET_INVERSION: 'inversion', NET_DRIFT: 'drift', NET_CREW: 'crew' }[t.code])));
    let f = '';
    me.slice(0, 12).forEach(c => { f += '<li><span class="dot" style="background:' + KIND[c.kind][1] + '"></span><div><b>' + KIND[c.kind][0] + '</b> ' + (c.distMi < 0.15 ? 'at this block' : f1(c.distMi) + ' mi ' + E.compass(c.bearing)) + ' · ' + (c.ageMin < 1 ? 'just now' : c.ageMin < 60 ? Math.round(c.ageMin) + ' min ago' : f1(c.ageMin / 60) + ' h ago') + (using.has(c.kind) ? ' <span class="used">changing your call</span>' : '') + (c.note ? '<div class="nt">' + esc(c.note) + '</div>' : '') + '</div></li>'; });
    $('netFeed').innerHTML = f || '<li class="muted">No reports within 5 miles in the last 8 hours.</li>';
    renderHeat();
    $('netState').textContent = netOnline === null ? 'Connecting…' : netOnline ? 'Live. Shared database, ' + me.length + ' recent report' + (me.length === 1 ? '' : 's') + ' nearby.' : 'Offline. Showing reports made on this device only.';
  }
  function initNetwork() {
    $('repBtn').onclick = sendReport; renderNetwork(); pullNetwork(false);
    $('fab').onclick = () => { $('report').scrollIntoView({ behavior: 'smooth' }); };
    document.querySelectorAll('.qbtn').forEach(b => b.onclick = async () => { b.disabled = true; const ok = await postReport(b.dataset.kind, 0, 0, null); b.disabled = false;
      $('quickMsg').textContent = ok ? 'Shared with growers nearby. Thank you.' : 'No connection. Saved on this device only.'; });
    $('moreBtn').onclick = () => { const m = $('more'); m.hidden = !m.hidden; $('moreBtn').textContent = m.hidden ? 'Show details' : 'Hide details'; };
    setInterval(() => pullNetwork(true), 8000);
    ['lat', 'lon'].forEach(id => $(id).addEventListener('change', () => applyNetwork(false)));
  }

  /* ---------- wire up ---------- */
  function init() {
    fillForm(); recompute(); setNow(); lastStatus = evals[idx].status; addLog('Reading'); renderAll(); initNetwork(); initPests();
    $('play').onclick = togglePlay;
    $('speed').onchange = () => { if (playing) { clearInterval(timer); timer = setInterval(stepOnce, +$('speed').value); } };
    document.querySelectorAll('.jump').forEach(b => b.onclick = () => { if (playing) togglePlay(); jump(Math.round(+b.dataset.min / stepMin)); });
    let drag = false; const tl = $('tl');
    tl.addEventListener('pointerdown', e => { drag = true; if (playing) togglePlay(); tlPick(e); });
    window.addEventListener('pointermove', e => { if (drag) tlPick(e); });
    window.addEventListener('pointerup', () => { drag = false; });
    window.addEventListener('resize', renderTimeline);
    ['cfgProf', 'cfgVol', 'cfgMin', 'cfgMax', 'cfgJob', 'cfgSiteOn', 'cfgSiteName', 'cfgSiteDir', 'cfgShS', 'cfgShD', 'cfgBuf'].forEach(id => $(id).addEventListener('change', readForm));
    $('sprayBtn').onclick = toggleSession;
    $('noteBtn').onclick = () => { const v = $('noteIn').value.trim(); if (v) { addLog('NOTE: ' + v); $('noteIn').value = ''; } };
    $('noteIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('noteBtn').click(); });
    $('logAlerts').onchange = renderLog; $('logCsv').onclick = exportLog; $('logClear').onclick = () => { log = []; renderLog(); };
    $('optPush').onchange = () => { if ($('optPush').checked && 'Notification' in window && Notification.permission !== 'granted') { try { Notification.requestPermission(); } catch (e) {} } };
    $('csvSample').onclick = sampleCsv;
    $('csvIn').onchange = e => { const f = e.target.files[0]; if (!f) return; const fr = new FileReader(); fr.onload = () => loadCsv(String(fr.result)); fr.readAsText(f); e.target.value = ''; };
    $('resetBtn').onclick = () => { cfg = Object.assign({}, E.DEFAULT_CFG); saveCfg(); data = S.generateDay(7); stepMin = S.STEP_MIN; $('srcLabel').textContent = 'Simulated tower: sensors at 5 ft and 30 ft, reading every 5 min'; fillForm(); recompute(); log = []; session = { state: 'idle', startMin: null, endMin: null, watchUntil: null }; if (playing) togglePlay(); jump(Math.round(370 / stepMin)); if (fcState) renderForecast(); };
    $('fcBtn').onclick = loadForecast;
    loadForecast();
  }
  init();
})();
