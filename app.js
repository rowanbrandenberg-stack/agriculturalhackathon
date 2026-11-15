/* Spray or Wait: interface. Decision rules live in engine.js, the simulated tower in sim.js. */
(function () {
  const E = window.SprayEngine, S = window.SpraySim;
  const $ = id => document.getElementById(id);
  const f1 = E.f1;
  const BUILD = '2026-11-15.8';
  const LIVE_URL = 'https://rowanbrandenberg-stack.github.io/agriculturalhackathon/';
  const TZ = { name: 'America/Phoenix', offset: '-07:00', abbr: 'MST' };
  const WATCH_HOURS = { low: 1, medium: 4, high: 12 };   // prototype values, confirm with a PCA
  const COL = { GO: '#1c7c3c', CAUTION: '#b96a00', STOP: '#b3261e', UNABLE: '#5b6770' };
  /* The applicator picks what the PCA already recommended. The tool never recommends a product. Heat limits are prototype values. */
  const PROFILES = {
    custom: { name: 'Custom (set below)', vol: null, heat: null, text: '', note: 'Set volatility yourself from the product label.' },
    oil: { name: 'Horticultural oil', vol: 'low', heat: 90, text: 'Oil sprays can burn leaves and fruit in heat.', note: 'Low vapor risk. Prototype heat limit 90°F because oil can burn leaves and fruit.' },
    sulfur: { name: 'Sulfur', vol: 'low', heat: 90, text: 'Sulfur can burn foliage in heat.', note: 'Low vapor risk. Prototype heat limit 90°F because sulfur can burn foliage.' },
    contact: { name: 'Contact insecticide, low volatility', vol: 'low', heat: null, text: '', note: 'Standard checks apply.' },
    volatile: { name: 'Volatile herbicide on the orchard floor', vol: 'high', heat: 85, text: 'Volatile products can give off more vapor in heat.', note: 'High vapor risk. Prototype heat limit 85°F and a 12 hour watch after spraying.' }
  };
  const SITE_SIDE = { 0: 'north', 45: 'northeast', 90: 'east', 135: 'southeast', 180: 'south', 225: 'southwest', 270: 'west', 315: 'northwest' };
  const CFG_KEYS = ['windMin', 'windMax', 'shearSpeed', 'shearDir', 'volatility', 'heatLimit', 'heatText', 'productName', 'profile', 'siteOn', 'siteName', 'siteBearing', 'jobHours'];

  let cfg = Object.assign({}, E.DEFAULT_CFG);
  try { const sv = JSON.parse(localStorage.getItem('sow_cfg') || 'null'); if (sv) { const c = Object.assign({}, cfg); CFG_KEYS.forEach(k => { if (k in sv) c[k] = sv[k]; }); if (!E.validateCfg(c).length) cfg = c; } } catch (e) {}

  let stepMin = S.STEP_MIN;
  let series = simSeries();
  let source = { kind: 'sim' };
  let dropHi = false;
  let evals = [], overIdx = null, community = [];
  let idx = Math.round(370 / stepMin);
  let playing = false, timer = null, stopAt = null;
  let log = [];
  let session = idle();
  let lastStatus = null;
  let fileRep = null;
  let fcState = null;
  const today = new Date();

  function idle() { return { state: 'idle', startMin: null, endMin: null, watchUntil: null }; }
  function simSeries() { return S.generateDay(7).map(r => ({ min: r.min, ageMin: 0, r: { tLo: r.tLo, tHi: r.tHi, wLo: r.wLo, wHi: r.wHi, dLo: r.dLo, dHi: r.dHi } })); }

  /* ---------- helpers ---------- */
  const num = x => typeof x === 'number' && isFinite(x);
  const v1 = x => num(x) ? f1(x) : 'n/a';
  function fmtTime(min) {
    min = ((Math.round(min) % 1440) + 1440) % 1440;
    let h = Math.floor(min / 60), m = min % 60; const ap = h < 12 ? 'AM' : 'PM';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + String(m).padStart(2, '0') + ' ' + ap;
  }
  function durWords(min) {
    min = Math.round(min);
    if (min < 60) return min + ' minute' + (min === 1 ? '' : 's');
    const h = Math.floor(min / 60), m = min % 60;
    if (!m) return h + ' hour' + (h === 1 ? '' : 's');
    return h + ' h ' + m + ' min';
  }
  const jobWords = () => (cfg.jobHours === 1 ? '1 hour' : cfg.jobHours + ' hour');
  const p2 = n => String(n).padStart(2, '0');
  const dateStr = () => today.getFullYear() + '-' + p2(today.getMonth() + 1) + '-' + p2(today.getDate());
  const measIso = min => dateStr() + 'T' + p2(Math.floor(min / 60)) + ':' + p2(min % 60) + ':00' + TZ.offset;
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function saveCfg() { try { const o = {}; CFG_KEYS.forEach(k => o[k] = cfg[k]); localStorage.setItem('sow_cfg', JSON.stringify(o)); } catch (e) {} }
  const sourceName = () => source.kind === 'sim' ? 'Simulated tower readings' : 'Imported tower readings';
  const reading = i => { const r = Object.assign({}, series[i].r); if (dropHi) { r.tHi = null; r.wHi = null; r.dHi = null; } return r; };
  const metaOf = i => ({ ageMin: series[i].ageMin, staleMin: cfg.staleIntervals * stepMin });
  function recompute() { evals = series.map((s, i) => E.evaluate(reading(i), cfg, metaOf(i))); overIdx = null; }
  /* Community reports are about right now, so they adjust only the current reading, never the day totals. */
  function setNow() {
    if (overIdx != null && overIdx !== idx && overIdx < series.length) evals[overIdx] = E.evaluate(reading(overIdx), cfg, metaOf(overIdx));
    evals[idx] = E.evaluate(reading(idx), Object.assign({}, cfg, { community: community }), metaOf(idx)); overIdx = idx;
  }
  const baseEvals = () => evals.map((e, i) => i === overIdx ? E.evaluate(reading(i), cfg, metaOf(i)) : e);
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }

  /* ---------- current weather ---------- */
  function goodReasons(r, ev) {
    const lo = cfg.loLabel, hi = cfg.hiLabel, out = [];
    out.push(['No inversion detected between ' + lo + ' and ' + hi, 'The ' + hi + ' reading is ' + f1(-ev.dT) + '°F cooler than the ' + lo + ' reading.']);
    out.push(['Wind inside your limits at both heights', f1(r.wLo) + ' mph at ' + lo + ' and ' + f1(r.wHi) + ' mph at ' + hi + '. Limits are ' + cfg.windMin + ' to ' + cfg.windMax + ' mph.']);
    out.push(['Wind similar at both heights', 'From the ' + E.compass(r.dLo) + ' at ' + lo + ' and the ' + E.compass(r.dHi) + ' at ' + hi + ', ' + Math.round(ev.shearDir) + '° apart. Speeds differ by ' + f1(Math.abs(ev.shearSpd)) + ' mph.']);
    if (cfg.siteOn) out.push(['Measured winds point away from the ' + cfg.siteName, 'This does not establish where all droplets or vapor will travel.']);
    return out;
  }
  function renderStatus() {
    const r = reading(idx), ev = evals[idx];
    $('statusCard').className = 'status ' + ev.status;
    $('statusWord').textContent = ev.status;
    let action = { GO: 'Measured weather checks passed. Confirm label requirements and on site conditions before applying.', CAUTION: 'Marginal. Read the reasons and recheck before each tank.', STOP: 'Do not spray right now.', UNABLE: 'Unable to assess. This is not a GO.' }[ev.status];
    if (session.state === 'spraying' && ev.status === 'STOP') action = 'Stop spraying now.';
    $('statusAction').textContent = action;
    const ul = $('reasons'); ul.innerHTML = '';
    const add = (cls, title, text) => { const li = document.createElement('li'); li.className = cls; li.innerHTML = '<b>' + esc(title) + '</b>' + esc(text); ul.appendChild(li); };
    ev.problems.forEach(p => add('pb', 'Cannot assess', p.text));
    ev.triggers.forEach(t => add('l' + t.level, t.title, t.text));
    if (ev.status === 'GO') goodReasons(r, ev).forEach(g => add('ok', g[0], g[1]));
    const gp = $('groundPill'); gp.textContent = ev.ground.status; gp.className = 'pill ' + ev.ground.status;
    $('groundText').textContent = ev.ground.text;
    const gm = $('groundMiss');
    if (ev.missed) {
      const miss = ev.triggers.filter(t => !/^WIND_(LOW|HIGH)_LO$/.test(t.code)).map(t => t.title.toLowerCase());
      gm.className = 'gmiss'; gm.textContent = 'A wind check at 5 ft alone does not show: ' + miss.join('; ') + '.';
    } else if (ev.ground.status === ev.status) { gm.className = 'gmiss same'; gm.textContent = 'Same result as the two height rules for this reading.'; }
    else { gm.className = 'gmiss same'; gm.textContent = 'The two height rules give ' + ev.status + ' for this reading.'; }
    $('clock').textContent = fmtTime(series[idx].min);
  }

  /* ---------- planned job ---------- */
  function renderJob() {
    const b = baseEvals(); b[idx] = evals[idx];
    const j = E.jobAssessment(b, idx, stepMin, cfg.jobHours), endT = fmtTime(series[Math.min(series.length - 1, idx + j.runMin / stepMin)].min);
    let tag, cls, txt;
    if (j.state === 'STOP') { tag = 'STOP'; cls = 'STOP'; txt = 'Current weather is STOP, so this job should not start now.'; }
    else if (j.state === 'UNKNOWN' && j.current === 'UNABLE') { tag = 'UNKNOWN'; cls = 'UNABLE'; txt = 'Current weather cannot be assessed, so the window for this job is unknown.'; }
    else if (j.state === 'UNKNOWN') { tag = 'UNKNOWN'; cls = 'UNABLE'; txt = 'The data ends at ' + fmtTime(series[series.length - 1].min) + '. Only ' + durWords(j.runMin) + ' of suitable conditions are projected and this job needs ' + durWords(j.needMin) + '. The rest is not known.'; }
    else if (j.state === 'WAIT' && j.current === 'CAUTION') { tag = 'WAIT'; cls = 'CAUTION'; txt = 'Current weather is CAUTION.'; }
    else if (j.state === 'WAIT') { tag = 'WAIT'; cls = 'CAUTION'; txt = 'Only ' + durWords(j.runMin) + ' of projected suitable conditions remain for this ' + jobWords() + ' job.'; }
    else { tag = 'SUFFICIENT WINDOW'; cls = 'GO'; txt = durWords(j.runMin) + ' of projected suitable conditions, until ' + endT + '. This ' + jobWords() + ' job fits.'; }
    let nxt = '';
    if (j.state !== 'SUFFICIENT') nxt = j.next ? 'Next projected suitable weather window: ' + fmtTime(series[j.next.start].min) + ' to ' + fmtTime(series[j.next.start].min + j.next.hours * 60) + ' (' + durWords(j.next.hours * 60) + ').'
      : 'No later window of ' + durWords(j.needMin) + ' is projected in this data.';
    const src = source.kind === 'sim' ? 'Projection source: the remaining samples of a known simulated day. This is a demonstration, not a forecast.' : 'Projection source: later rows of the imported file. This is not a forecast.';
    $('jobStrip').className = 'jobstrip ' + cls;
    $('jobStrip').innerHTML = '<div class="jl"><span class="jk">Current weather</span><span class="pill ' + evals[idx].status + '">' + evals[idx].status + '</span></div>' +
      '<div class="jl"><span class="jk">Planned job</span><span class="pill ' + cls + '">' + tag + '</span><span class="jt">' + esc(txt) + ' ' + esc(nxt) + '</span></div>' +
      '<div class="jsrc">' + src + '</div>';
    return j;
  }

  /* ---------- orchard cross section ---------- */
  function sky(min) {
    const h = min / 60;
    if (h < 5.3 || h > 20) return ['#16263a', '#2a4058', '#e9eef5'];
    if (h < 7 || h > 18.3) return ['#f0b98a', '#f8dcc0', '#3a2a22'];
    return ['#bfe0f5', '#e6f3fb', '#22313a'];
  }
  function renderTower() {
    const r = reading(idx), ev = evals[idx];
    const [s1, s2, ink] = sky(series[idx].min);
    const yHi = 78, yLo = 240, gY = 275, mast = 282;
    const inv = ev.dT != null && ev.dT > 0, near = ev.dT != null && !inv && ev.dT > -cfg.sensorUnc;
    let h = '<defs><linearGradient id="sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + s1 + '"/><stop offset="1" stop-color="' + s2 + '"/></linearGradient>';
    h += '<marker id="ahL" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#0b6e99"/></marker>';
    h += '<marker id="ahH" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#c2410c"/></marker></defs>';
    h += '<rect x="0" y="0" width="560" height="330" fill="url(#sk)"/>';
    const cap = (y, t, fill) => '<text x="14" y="' + y + '" font-size="13" font-weight="600" fill="' + fill + '">' + t + '</text>';
    if (inv) {
      h += '<rect x="0" y="56" width="560" height="62" fill="#e8590c" opacity="' + Math.min(0.5, 0.18 + ev.dT * 0.05) + '"/>';
      h += '<path d="M0,200 C90,186 180,214 280,198 S470,188 560,204 L560,275 L0,275 z" fill="#9aa3ad" opacity="0.5"/>';
      h += cap(50, 'Inversion: warmer air above cooler air', ink);
    } else if (near) h += cap(50, 'Small temperature difference', ink);
    else if (ev.dT == null) h += cap(50, 'Temperature difference not available', ink);
    else h += cap(50, 'No inversion detected between ' + cfg.loLabel + ' and ' + cfg.hiLabel, ink);
    h += '<rect x="0" y="' + gY + '" width="560" height="55" fill="#6b5a3c"/><rect x="0" y="' + gY + '" width="560" height="7" fill="#5c7a3a"/>';
    [58, 168, 410, 512].forEach(x => {
      h += '<rect x="' + (x - 5) + '" y="238" width="10" height="38" fill="#5b4326"/>';
      h += '<ellipse cx="' + x + '" cy="196" rx="46" ry="56" fill="#3f7d3a"/><ellipse cx="' + (x - 12) + '" cy="182" rx="26" ry="30" fill="#4f9447" opacity=".7"/>';
    });
    h += '<line x1="' + mast + '" y1="' + gY + '" x2="' + mast + '" y2="62" stroke="#2b2f33" stroke-width="4"/>';
    h += '<line x1="' + (mast - 26) + '" y1="' + gY + '" x2="' + (mast + 26) + '" y2="' + gY + '" stroke="#2b2f33" stroke-width="4"/>';
    if (inv) h += '<text x="14" y="302" font-size="13" font-weight="600" fill="#f4f1e6">Fine droplets and vapor can stay in this shallow layer</text>';
    function sensor(y, col, label, t, w, d, mk) {
      const ok = num(t) || num(w);
      let s = '<circle cx="' + mast + '" cy="' + y + '" r="8" fill="' + (ok ? col : '#8a949b') + '" stroke="#fff" stroke-width="2"/>';
      if (num(w) && w > 0.2) { const len = Math.max(8, Math.min(170, w * 13)); s += '<line x1="' + (mast - 16 - len) + '" y1="' + y + '" x2="' + (mast - 16) + '" y2="' + y + '" stroke="' + col + '" stroke-width="5" stroke-linecap="round" marker-end="url(#' + mk + ')"/>'; }
      s += '<rect x="' + (mast + 16) + '" y="' + (y - 21) + '" width="246" height="42" rx="8" fill="#fff" opacity=".95" stroke="' + (ok ? col : '#8a949b') + '" stroke-width="2"/>';
      s += '<text x="' + (mast + 26) + '" y="' + (y - 4) + '" font-size="12" font-weight="600" fill="' + (ok ? col : '#5b6770') + '">' + label + '</text>';
      const val = !ok ? 'No valid reading' : (num(t) ? f1(t) + '°F' : 'no temp') + ',  ' + (num(w) ? f1(w) + ' mph' + (w < cfg.calmMph || !num(d) ? ', calm' : ' from ' + E.compass(d)) : 'no wind');
      s += '<text x="' + (mast + 26) + '" y="' + (y + 14) + '" font-size="15" font-weight="600" fill="#17201b">' + val + '</text>';
      return s;
    }
    h += sensor(yHi, '#c2410c', 'Sensor at ' + cfg.hiLabel + ', above the canopy', r.tHi, r.wHi, r.dHi, 'ahH');
    h += sensor(yLo, '#0b6e99', 'Sensor at ' + cfg.loLabel + ', ground station height', r.tLo, r.wLo, r.dLo, 'ahL');
    const dtTxt = ev.dT == null ? 'no comparison' : ev.dT > 0 ? f1(ev.dT) + '°F warmer at ' + cfg.hiLabel : ev.dT === 0 ? 'same temperature' : f1(-ev.dT) + '°F cooler at ' + cfg.hiLabel;
    h += '<rect x="322" y="8" width="230" height="30" rx="15" fill="' + (ev.dT == null ? '#5b6770' : inv ? '#b3261e' : near ? '#b96a00' : '#1c7c3c') + '"/>';
    h += '<text x="437" y="28" text-anchor="middle" font-size="14" font-weight="600" fill="#fff">' + dtTxt + '</text>';
    h += '<text x="548" y="322" text-anchor="end" font-size="11" fill="#f4f1e6" opacity=".9">' + sourceName() + ', measured ' + fmtTime(series[idx].min) + '</text>';
    $('tower').innerHTML = h;
  }

  /* ---------- potential downwind direction ---------- */
  function renderCompass() {
    const r = reading(idx), ev = evals[idx];
    const cx = 110, cy = 122, R = 76;
    const pt = (deg, rad) => [cx + rad * Math.sin(deg * Math.PI / 180), cy - rad * Math.cos(deg * Math.PI / 180)];
    let h = '<defs><marker id="cL" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#0b6e99"/></marker><marker id="cH" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#c2410c"/></marker></defs>';
    h += '<text x="110" y="14" text-anchor="middle" font-size="12" font-weight="600" fill="#15212a">Potential downwind direction</text>';
    h += '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="#f3f5f6" stroke="#b9b3a3" stroke-width="1.5"/>';
    if (cfg.siteOn) { const a = pt(cfg.siteBearing - cfg.siteCone, R), b = pt(cfg.siteBearing + cfg.siteCone, R);
      h += '<path d="M' + cx + ',' + cy + ' L' + a[0] + ',' + a[1] + ' A' + R + ',' + R + ' 0 0 1 ' + b[0] + ',' + b[1] + ' z" fill="#b3261e" opacity=".13"/>'; }
    [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([l, d]) => { const p = pt(d, R + 11); h += '<text x="' + p[0] + '" y="' + (p[1] + 4) + '" text-anchor="middle" font-size="11" font-weight="600" fill="#5d665f">' + l + '</text>'; });
    h += '<rect x="' + (cx - 11) + '" y="' + (cy - 11) + '" width="22" height="22" rx="3" fill="#3f7d3a"/>';
    const arrow = (d, w, col, mk) => { if (!num(d) || !num(w) || w < cfg.calmMph) return ''; const p = pt((d + 180) % 360, Math.min(R - 6, 16 + w * 5));
      return '<line x1="' + cx + '" y1="' + cy + '" x2="' + p[0] + '" y2="' + p[1] + '" stroke="' + col + '" stroke-width="4.5" stroke-linecap="round" marker-end="url(#' + mk + ')"/>'; };
    h += arrow(r.dHi, r.wHi, '#c2410c', 'cH') + arrow(r.dLo, r.wLo, '#0b6e99', 'cL');
    if (cfg.siteOn) { const p = pt(cfg.siteBearing, R), lp = pt(cfg.siteBearing, R - 20);
      h += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="7" fill="#b3261e" stroke="#fff" stroke-width="2"/>';
      h += '<text x="' + lp[0] + '" y="' + (lp[1] + (cfg.siteBearing > 90 && cfg.siteBearing < 270 ? -6 : 16)) + '" text-anchor="middle" font-size="11" font-weight="600" fill="#b3261e">' + esc(cfg.siteName) + '</text>'; }
    $('compass').innerHTML = h;
    $('miniStats').innerHTML =
      '<div><span>Temperature difference</span><b>' + (ev.dT == null ? 'n/a' : (ev.dT > 0 ? '+' : '') + f1(ev.dT) + ' °F') + '</b></div>' +
      '<div><span>Wind speed difference</span><b>' + (ev.shearSpd == null ? 'n/a' : (ev.shearSpd > 0 ? '+' : '') + f1(ev.shearSpd) + ' mph') + '</b></div>' +
      '<div><span>Wind direction difference</span><b>' + (ev.shearDir == null ? 'not reliable' : Math.round(ev.shearDir) + '°') + '</b></div>';
    renderBlock(ev);
  }
  /* Illustration only: shows which side the sensitive site is on. It does not recommend rows or buffers. */
  function renderBlock(ev) {
    const N = 12, x0 = 40, y0 = 8, cell = 11; let h = '';
    h += '<rect x="' + (x0 - 4) + '" y="' + (y0 - 4) + '" width="' + (N * cell + 8) + '" height="' + (N * cell + 8) + '" rx="6" fill="#f3f5f6" stroke="#b9b3a3"/>';
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) h += '<circle cx="' + (x0 + (i + 0.5) * cell) + '" cy="' + (y0 + (j + 0.5) * cell) + '" r="4" fill="#3f7d3a"/>';
    const toward = ev.triggers.some(t => t.code === 'SITE_DOWNWIND');
    if (cfg.siteOn) { const c = N * cell / 2, bx = x0 + c, by = y0 + c, ux = Math.sin(cfg.siteBearing * Math.PI / 180), uy = -Math.cos(cfg.siteBearing * Math.PI / 180), k = (c + 14) / Math.max(Math.abs(ux), Math.abs(uy));
      const sx = bx + ux * k, sy = by + uy * k;
      h += '<circle cx="' + sx + '" cy="' + sy + '" r="7" fill="#b3261e" stroke="#fff" stroke-width="2"/>';
      h += '<text x="' + Math.max(4, Math.min(208, sx)) + '" y="' + (sy < by - 20 ? sy + 3 : sy + 19) + '" text-anchor="' + (sx > bx + 20 ? 'end' : sx < bx - 20 ? 'start' : 'middle') + '" font-size="10" font-weight="600" fill="#b3261e"' + (sy < by - 20 ? ' dx="12"' : '') + '>' + esc(cfg.siteName) + '</text>'; }
    $('blockMap').innerHTML = h;
    $('blockTxt').innerHTML = (cfg.siteOn ? 'Illustration only. The ' + esc(cfg.siteName) + ' is on the ' + SITE_SIDE[cfg.siteBearing] + ' side.' + (toward ? ' <b>Measured wind currently points toward it.</b>' : '') : 'No sensitive site set.') +
      ' Required buffers must be determined from the applicable label and site conditions.';
  }

  /* ---------- timeline ---------- */
  function runs(arr) { const out = []; let s = 0; for (let i = 1; i <= arr.length; i++) { if (i === arr.length || arr[i] !== arr[s]) { out.push([s, i, arr[s]]); s = i; } } return out; }
  function poly(vals, x, y, col) {
    let out = '', seg = [];
    const flush = () => { if (seg.length > 1) out += '<polyline fill="none" stroke="' + col + '" stroke-width="2" points="' + seg.join(' ') + '"/>'; seg = []; };
    vals.forEach((v, i) => { if (num(v)) seg.push(x(i + 0.5).toFixed(1) + ',' + y(v).toFixed(1)); else flush(); }); flush(); return out;
  }
  function renderTimeline() {
    const svg = $('tl'); const W = Math.max(300, svg.clientWidth || 1000), H = 300; const narrow = W < 700;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    const L = narrow ? 76 : 150, Rm = narrow ? 6 : 12, n = series.length, base = baseEvals();
    const x = i => L + (i / n) * (W - L - Rm);
    const SHORT = { 'Two height rules': 'Two height', 'Ground wind check': 'Ground only', 'Missed by ground': 'Missed', 'Temp difference': 'Temp diff', 'Wind speed': 'Wind mph' };
    const lab = (y, t, sub) => narrow ? '<text x="2" y="' + y + '" font-size="11" font-weight="600" fill="#17201b">' + SHORT[t] + '</text>' :
      '<text x="8" y="' + y + '" font-size="12" font-weight="600" fill="#17201b">' + t + '</text>' + (sub ? '<text x="8" y="' + (y + 13) + '" font-size="10" fill="#5d665f">' + sub + '</text>' : '');
    let h = lab(26, 'Two height rules');
    runs(base.map(e => e.status)).forEach(([a, b, s]) => { h += '<rect x="' + x(a) + '" y="8" width="' + (x(b) - x(a) + 0.5) + '" height="28" fill="' + COL[s] + '"/>'; });
    h += lab(57, 'Ground wind check');
    runs(base.map(e => e.ground.status)).forEach(([a, b, s]) => { h += '<rect x="' + x(a) + '" y="42" width="' + (x(b) - x(a) + 0.5) + '" height="20" fill="' + COL[s] + '" opacity=".8"/>'; });
    h += lab(78, 'Missed by ground');
    runs(base.map(e => e.missed ? 1 : 0)).forEach(([a, b, s]) => { if (s) h += '<rect x="' + x(a) + '" y="68" width="' + (x(b) - x(a) + 0.5) + '" height="10" fill="#17201b"/>'; });
    const aT = 96, aB = 176, aMin = -4, aMax = 7; const ya = v => aB - (Math.max(aMin, Math.min(aMax, v)) - aMin) / (aMax - aMin) * (aB - aT);
    h += lab(126, 'Temp difference', cfg.hiLabel + ' minus ' + cfg.loLabel + ', °F');
    h += '<rect x="' + L + '" y="' + aT + '" width="' + (W - L - Rm) + '" height="' + (ya(0) - aT) + '" fill="#b3261e" opacity=".09"/>';
    h += '<line x1="' + L + '" y1="' + ya(0) + '" x2="' + (W - Rm) + '" y2="' + ya(0) + '" stroke="#b3261e" stroke-width="1" stroke-dasharray="4 3"/>';
    h += '<text x="' + (W - Rm - 4) + '" y="' + (aT + 12) + '" text-anchor="end" font-size="10" fill="#b3261e">above the line = inversion alert</text>';
    h += poly(base.map(e => e.dT), x, ya, '#17201b');
    const bT = 190, bB = 270, bMax = 16; const yb = v => bB - Math.min(bMax, v) / bMax * (bB - bT);
    h += lab(222, 'Wind speed', 'mph, your limits shaded');
    h += '<rect x="' + L + '" y="' + yb(Math.min(bMax, cfg.windMax)) + '" width="' + (W - L - Rm) + '" height="' + Math.max(0, yb(cfg.windMin) - yb(Math.min(bMax, cfg.windMax))) + '" fill="#1c7c3c" opacity=".12"/>';
    h += poly(series.map((s, i) => reading(i).wHi), x, yb, '#c2410c') + poly(series.map((s, i) => reading(i).wLo), x, yb, '#0b6e99');
    h += '<text x="' + (W - Rm - 4) + '" y="' + (bT + 10) + '" text-anchor="end" font-size="10" fill="#c2410c">' + cfg.hiLabel + '</text><text x="' + (W - Rm - 40) + '" y="' + (bT + 10) + '" text-anchor="end" font-size="10" fill="#0b6e99">' + cfg.loLabel + '</text>';
    const t0 = series[0].min, t1 = series[n - 1].min + stepMin;
    for (let hr = Math.ceil(t0 / 60); hr * 60 <= t1; hr += (narrow ? 6 : 2)) {
      const xi = L + ((hr * 60 - t0) / (t1 - t0)) * (W - L - Rm);
      h += '<line x1="' + xi + '" y1="8" x2="' + xi + '" y2="272" stroke="#000" opacity=".07"/>';
      if (hr * 60 < t1) h += '<text x="' + (xi + 3) + '" y="290" font-size="11" fill="#5d665f">' + fmtTime(hr * 60).replace(':00', '') + '</text>';
    }
    if (session.startMin != null) {
      const ix = m => x((m - t0) / stepMin), a = ix(session.startMin), b = ix(session.endMin != null ? session.endMin : series[idx].min);
      h += '<rect x="' + a + '" y="2" width="' + Math.max(2, b - a) + '" height="4" fill="#0b6e99"/>';
    }
    const px = x(idx + 0.5);
    h += '<line x1="' + px + '" y1="0" x2="' + px + '" y2="276" stroke="#17201b" stroke-width="2"/><circle cx="' + px + '" cy="4" r="5" fill="#17201b"/>';
    svg.innerHTML = h;
    const missedH = base.filter(e => e.missed).length * stepMin / 60;
    $('tlfoot').innerHTML = (source.kind === 'sim' ? 'In this simulated day' : 'In this imported data') + ', ground wind checks missed <b>' + f1(missedH) + ' hours</b> flagged by our two height rules. ' +
      '<span class="muted">Counted from the readings and the active thresholds. It is not a measure of drift prevented or of detection accuracy.</span>';
  }
  function tlPick(evn) {
    const rect = $('tl').getBoundingClientRect(), W = rect.width, L = W < 700 ? 76 : 150, Rm = W < 700 ? 6 : 12;
    const f = (evn.clientX - rect.left - L) / (W - L - Rm);
    if (f < 0 || f > 1) return; jump(Math.min(series.length - 1, Math.floor(f * series.length)));
  }

  /* ---------- rules, monitoring, recent alerts ---------- */
  function renderRules() {
    $('rulesLine').innerHTML = 'Active rules: inversion alert whenever ' + cfg.hiLabel + ' is warmer than ' + cfg.loLabel + '; wind ' + cfg.windMin + ' to ' + cfg.windMax + ' mph at both heights; speed difference ' + cfg.shearSpeed + ' mph; direction difference ' + cfg.shearDir + '°. <a href="#rulesSec" class="lnk" data-open="rulesSec">See all rules</a>';
    const rows = [
      ['Inversion', cfg.hiLabel + ' temperature greater than ' + cfg.loLabel + ' temperature', 'STOP. Any positive difference alerts. A difference inside ±' + cfg.sensorUnc + '°F sensor uncertainty is still shown, with a note.'],
      ['Small temperature difference', cfg.hiLabel + ' less than ' + cfg.sensorUnc + '°F cooler than ' + cfg.loLabel, 'CAUTION. The readings cannot rule out an inversion.'],
      ['Wind above limit', 'Over ' + cfg.windMax + ' mph at either height', 'STOP. 10 mph is common guidance. The product label controls the real limit.'],
      ['Wind below minimum', 'Under ' + cfg.windMin + ' mph at either height', 'CAUTION. 3 mph is common guidance. The product label controls the real limit.'],
      ['Speed difference between heights', cfg.shearSpeed + ' mph or more', 'CAUTION. Configurable prototype threshold, not a sourced limit.'],
      ['Direction difference between heights', cfg.shearDir + '° or more, shortest way around the compass', 'CAUTION. Configurable prototype threshold. Skipped when wind is under ' + cfg.calmMph + ' mph because calm air has no reliable direction.'],
      ['Sensitive site', 'Measured wind at either height within ' + cfg.siteCone + '° of the site', 'CAUTION alone. STOP together with any other flag.'],
      ['Missing or invalid reading', 'Any required value absent or impossible', 'UNABLE to assess. Never GO.'],
      ['Stale reading', 'Older than ' + cfg.staleIntervals + ' sampling intervals (' + cfg.staleIntervals * stepMin + ' minutes at a ' + stepMin + ' minute interval)', 'UNABLE to assess. Never GO.'],
      ['Combining', 'Worst single flag decides', 'Nothing is averaged, so no good reading can cancel a STOP.']];
    $('rulesBox').innerHTML = '<table class="rt"><thead><tr><th>Rule</th><th>Active threshold</th><th>Result and purpose</th></tr></thead><tbody>' + rows.map(r => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>').join('') + '</tbody></table>';
  }
  function renderSession() {
    const box = $('sessionBox'), btn = $('sprayBtn'), nowMin = series[idx].min;
    if (session.state === 'idle') { box.className = 'sessionBox'; box.textContent = 'Not spraying. Press start when the rig goes out. Every reading is checked and you are alerted when the weather call changes.'; btn.textContent = 'Start spraying'; btn.className = 'btn primary big'; }
    else if (session.state === 'spraying') { box.className = 'sessionBox on'; box.innerHTML = '<b>Spraying since ' + fmtTime(session.startMin) + '.</b> Every reading is being checked.'; btn.textContent = 'Finish spraying'; btn.className = 'btn danger big'; }
    else { box.className = 'sessionBox watch'; box.innerHTML = '<b>After spray watch.</b> Sprayed ' + fmtTime(session.startMin) + ' to ' + fmtTime(session.endMin) + '. Watching ' + durWords(Math.max(0, session.watchUntil - nowMin)) + ' more for an inversion. <a href="#fileSec" class="lnk" data-open="fileSec">Sign the application record</a>'; btn.textContent = 'End watch'; btn.className = 'btn big'; }
  }
  function toggleSession() {
    const nowMin = series[idx].min, ev = evals[idx];
    if (session.state === 'idle') { session = { state: 'spraying', startMin: nowMin, endMin: null, watchUntil: null }; fileRep = null; renderFile(); addLog('SPRAY START' + (ev.status !== 'GO' ? ' (started on ' + ev.status + ')' : '')); }
    else if (session.state === 'spraying') { session.state = 'watch'; session.endMin = nowMin; session.watchUntil = nowMin + WATCH_HOURS[cfg.volatility] * 60; addLog('SPRAY END, watch for ' + WATCH_HOURS[cfg.volatility] + ' h'); buildFile(); }
    else { addLog('WATCH ENDED'); session = idle(); }
    renderAll();
  }
  function renderRecent() {
    const ev = log.filter(l => l.event !== 'Reading').slice(0, 5);
    $('recent').innerHTML = ev.length ? ev.map(l => '<li><span class="rt1">' + fmtTime(l.min) + '</span><span class="pill ' + l.status + '">' + l.status + '</span><div><b>' + esc(l.event) + '</b>' + (l.reasons ? '<div class="muted">' + esc(l.reasons) + '</div>' : '') + '</div></li>').join('')
      : '<li class="muted">No alerts yet in this session. Alerts appear here when the weather call changes during playback or monitoring.</li>';
  }

  /* ---------- record ---------- */
  function addLog(event) {
    const r = reading(idx), ev = evals[idx], b = baseEvals(); b[idx] = ev;
    log.unshift({ min: series[idx].min, measTs: measIso(series[idx].min), eventTs: new Date().toISOString(), event: event || 'Reading', status: ev.status, ground: ev.ground.status,
      job: E.jobAssessment(b, idx, stepMin, cfg.jobHours).state, r: r, dT: ev.dT, shearSpd: ev.shearSpd, shearDir: ev.shearDir,
      reasons: ev.triggers.map(t => t.title).concat(ev.problems.map(p => p.text)).join('; '), source: sourceName(), ageMin: series[idx].ageMin,
      th: { windMin: cfg.windMin, windMax: cfg.windMax, shearSpeed: cfg.shearSpeed, shearDir: cfg.shearDir, sensorUnc: cfg.sensorUnc }, jobHours: cfg.jobHours, product: PROFILES[cfg.profile || 'custom'].name, vol: cfg.volatility, site: cfg.siteOn ? cfg.siteName + ' ' + SITE_SIDE[cfg.siteBearing] : 'none' });
    if (log.length > 1500) log.length = 1500;
    renderLog(); renderRecent();
  }
  function renderLog() {
    const only = $('logAlerts').checked; let h = '';
    log.filter(l => !only || l.event !== 'Reading').slice(0, 250).forEach(l => {
      const isEv = l.event !== 'Reading';
      h += '<tr class="' + (isEv ? 'ev ' + l.status : '') + '"><td class="num">' + fmtTime(l.min) + ' ' + TZ.abbr + '</td><td>' + esc(l.event) + '</td><td><span class="pill ' + l.status + '">' + l.status + '</span></td><td><span class="pill ' + l.ground + '">' + l.ground + '</span></td><td class="num">' + v1(l.r.tLo) + '</td><td class="num">' + v1(l.r.tHi) + '</td><td class="num">' + (l.dT == null ? 'n/a' : (l.dT > 0 ? '+' : '') + f1(l.dT)) + '</td><td class="num">' + v1(l.r.wLo) + (num(l.r.dLo) ? ' ' + E.compass(l.r.dLo) : '') + '</td><td class="num">' + v1(l.r.wHi) + (num(l.r.dHi) ? ' ' + E.compass(l.r.dHi) : '') + '</td><td>' + esc(l.reasons || 'None. All measured checks passed.') + '</td></tr>';
    });
    $('log').querySelector('tbody').innerHTML = h || '<tr><td colspan="10">No entries yet.</td></tr>';
  }
  const csvq = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  function logCsv() {
    const n = x => num(x) ? f1(x) : '';
    const head = ['measurement_timestamp', 'timezone', 'event_timestamp_utc', 'event', 'data_source', 'demo_data', 'reading_age_min', 'lower_height_ft', 'upper_height_ft', 'temp_lower_f', 'temp_upper_f', 'temp_diff_f',
      'wind_lower_mph', 'wind_upper_mph', 'wind_lower_from_deg', 'wind_upper_from_deg', 'wind_speed_diff_mph', 'wind_dir_diff_deg', 'weather_status', 'ground_only_status', 'planned_job_status', 'alert_reasons',
      'wind_min_mph', 'wind_max_mph', 'speed_shear_threshold_mph', 'dir_shear_threshold_deg', 'sensor_uncertainty_f', 'job_hours', 'product_type', 'volatility', 'sensitive_site'];
    const rows = [head.join(',')];
    log.slice().reverse().forEach(l => rows.push([csvq(l.measTs), csvq(TZ.name), csvq(l.eventTs), csvq(l.event), csvq(l.source), source.kind === 'sim' ? 'true' : 'false', n(l.ageMin), 5, 30, n(l.r.tLo), n(l.r.tHi), n(l.dT),
      n(l.r.wLo), n(l.r.wHi), num(l.r.dLo) ? Math.round(l.r.dLo) : '', num(l.r.dHi) ? Math.round(l.r.dHi) : '', n(l.shearSpd), num(l.shearDir) ? Math.round(l.shearDir) : '', l.status, l.ground, l.job, csvq(l.reasons),
      l.th.windMin, l.th.windMax, l.th.shearSpeed, l.th.shearDir, l.th.sensorUnc, l.jobHours, csvq(l.product), csvq(l.vol), csvq(l.site)].join(',')));
    return rows.join('\r\n');
  }
  window.__sowCsv = logCsv;   // used by the automated checks

  /* ---------- alerts ---------- */
  let audioCtx = null;
  function beep(level) {
    if (!$('optSound').checked) return;
    try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); const n = level === 2 ? 3 : 1;
      for (let i = 0; i < n; i++) { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = level === 2 ? 880 : 620; g.gain.value = 0.12; o.connect(g); g.connect(audioCtx.destination); const t = audioCtx.currentTime + i * 0.22; o.start(t); o.stop(t + 0.15); } } catch (e) {}
  }
  function push(title, body) { try { if ($('optPush').checked && 'Notification' in window && Notification.permission === 'granted') new Notification(title, { body: body }); } catch (e) {} }
  function showAlert(status, title, sub) {
    const bar = $('alertBar'); bar.className = 'alertbar ' + status; bar.hidden = false;
    bar.innerHTML = '<div>' + esc(title) + '<div class="sub">' + esc(sub) + '</div></div><button id="alertOk">OK</button>';
    $('alertOk').onclick = () => { bar.hidden = true; };
  }
  function checkAlert() {
    const ev = evals[idx], t = fmtTime(series[idx].min);
    if (lastStatus && ev.status !== lastStatus) {
      const worse = E.RANK[ev.status] > E.RANK[lastStatus];
      const why = ev.triggers.length ? ev.triggers[0].title + '. ' + ev.triggers[0].text : ev.problems.length ? ev.problems[0].text : 'All measured checks pass at both heights.';
      let title = t + '  ' + lastStatus + ' → ' + ev.status;
      if (session.state === 'spraying' && ev.status === 'STOP') title = t + '  STOP SPRAYING';
      else if (session.state === 'spraying' && ev.status === 'CAUTION') title = t + '  CAUTION while spraying';
      addLog('ALERT ' + lastStatus + ' to ' + ev.status + (session.state === 'spraying' ? ' during spraying' : ''));
      showAlert(ev.status, title, why);
      if (worse || session.state !== 'idle') { beep(ev.status === 'STOP' ? 2 : 1); push('Spray or Wait: ' + ev.status, why); }
      if (worse && session.state === 'spraying' && playing) togglePlay();
    } else addLog();
    if (session.state === 'watch') {
      const prev = evals[Math.max(0, idx - 1)];
      if (ev.dT > 0 && !(prev.dT > 0)) { addLog('POST SPRAY ALERT inversion detected ' + durWords(series[idx].min - session.endMin) + ' after spraying'); showAlert('CAUTION', t + '  Inversion detected after your spray', 'Noted in the record.'); beep(1); }
      if (series[idx].min >= session.watchUntil) { addLog('WATCH COMPLETE'); session = idle(); }
    }
    lastStatus = ev.status;
    if (stopAt && ev.status === stopAt && playing) { stopAt = null; togglePlay(); }
  }

  /* ---------- playback and scenarios ---------- */
  function renderAll() { renderStatus(); renderJob(); renderTower(); renderCompass(); renderTimeline(); renderSession(); }
  function stepOnce() { if (idx >= series.length - 1) { if (playing) togglePlay(); return; } idx++; setNow(); checkAlert(); renderAll(); }
  function togglePlay() {
    playing = !playing; $('play').textContent = playing ? 'Pause' : 'Play'; $('play').classList.toggle('playing', playing);
    clearInterval(timer); if (playing) timer = setInterval(stepOnce, +$('speed').value); else stopAt = null;
  }
  function jump(i) {
    idx = Math.max(0, Math.min(series.length - 1, i)); setNow(); lastStatus = evals[idx].status; $('alertBar').hidden = true;
    if (session.state !== 'idle' && series[idx].min < session.startMin) session = idle();
    addLog('Reading'); renderAll();
  }
  const idxAt = min => { let best = 0; series.forEach((s, i) => { if (Math.abs(s.min - min) < Math.abs(series[best].min - min)) best = i; }); return best; };
  /* Resets only the demo: playback position, session, alerts and the in memory session record. Settings and saved records are kept. */
  function resetDemo() {
    if (playing) togglePlay(); stopAt = null; session = idle(); fileRep = null; log = []; $('alertBar').hidden = true;
    idx = idxAt(370); setNow(); lastStatus = evals[idx].status; addLog('Reading'); renderAll(); renderFile();
  }

  /* ---------- settings ---------- */
  function fillForm() {
    $('cfgProf').value = cfg.profile || 'custom'; $('profNote').textContent = PROFILES[cfg.profile || 'custom'].note;
    $('cfgVol').value = cfg.volatility; $('cfgMin').value = cfg.windMin; $('cfgMax').value = cfg.windMax; $('cfgJob').value = cfg.jobHours;
    $('cfgSiteOn').value = cfg.siteOn ? '1' : '0'; $('cfgSiteName').value = cfg.siteName; $('cfgSiteDir').value = String(cfg.siteBearing);
    $('cfgShS').value = cfg.shearSpeed; $('cfgShD').value = cfg.shearDir;
  }
  function readForm() {
    const c = Object.assign({}, cfg), val = id => { const s = $(id).value.trim(); return s === '' ? NaN : Number(s); };
    const pk = $('cfgProf').value, pr = PROFILES[pk];
    if (pk !== cfg.profile && pr.vol) $('cfgVol').value = pr.vol; else if (pr.vol && $('cfgVol').value !== pr.vol) $('cfgProf').value = 'custom';
    const pk2 = $('cfgProf').value, pr2 = PROFILES[pk2];
    c.profile = pk2; c.heatLimit = pr2.heat; c.heatText = pr2.text; c.productName = pk2 === 'custom' ? '' : pr2.name.toLowerCase(); c.volatility = $('cfgVol').value;
    c.windMin = val('cfgMin'); c.windMax = val('cfgMax'); c.jobHours = val('cfgJob'); c.shearSpeed = val('cfgShS'); c.shearDir = val('cfgShD');
    c.siteOn = $('cfgSiteOn').value === '1'; c.siteName = $('cfgSiteName').value.trim() || 'sensitive site'; c.siteBearing = +$('cfgSiteDir').value;
    const errs = E.validateCfg(c), box = $('cfgErr');
    if (errs.length) { box.hidden = false; box.textContent = 'Not applied. ' + errs.join(' ') + ' The previous settings are still active.'; fillForm(); return false; }
    box.hidden = true; cfg = c; $('profNote').textContent = pr2.note; saveCfg(); applyChange('SETTINGS CHANGED'); if (fcState) renderForecast(); return true;
  }
  function applyChange(evt) { recompute(); setNow(); lastStatus = evals[idx].status; renderRules(); addLog(evt); renderAll(); }
  function renderSource() {
    $('srcTag').textContent = sourceName();
    $('srcLabel').textContent = source.kind === 'sim' ? 'Sensors at 5 ft and 30 ft, one reading every ' + stepMin + ' minutes. Not live.'
      : 'File ' + source.file + ', ' + source.rows + ' readings measured ' + fmtTime(source.first) + ' to ' + fmtTime(source.last) + '. Last reading ' + fmtTime(source.last) + '. A file is not a live feed.';
    $('clockSub').textContent = 'measurement time, ' + TZ.abbr;
  }

  /* ---------- CSV import ---------- */
  function sampleCsv() {
    const rows = ['time,temp_low_f,temp_high_f,wind_low_mph,wind_high_mph,dir_low_deg,dir_high_deg'];
    S.generateDay(7).forEach(r => rows.push([p2(Math.floor(r.min / 60)) + ':' + p2(r.min % 60), f1(r.tLo), f1(r.tHi), f1(r.wLo), f1(r.wHi), Math.round(r.dLo), Math.round(r.dHi)].join(',')));
    download('tower_sample.csv', rows.join('\n'));
  }
  function loadCsv(text, name) {
    const lines = text.trim().split(/\r?\n/); const head = lines.shift().toLowerCase().split(',').map(s => s.trim());
    const col = n => head.indexOf(n); const need = ['time', 'temp_low_f', 'temp_high_f', 'wind_low_mph', 'wind_high_mph', 'dir_low_deg', 'dir_high_deg'];
    if (need.some(n => col(n) < 0)) { showAlert('CAUTION', 'File not imported', 'The CSV needs these columns: ' + need.join(', ')); return; }
    const cell = (c, n) => { const s = (c[col(n)] || '').trim(); const v = s === '' ? NaN : Number(s); return isFinite(v) ? v : null; };
    const rows = [];
    lines.forEach(l => { const c = l.split(','); const tm = (c[col('time')] || '').match(/(\d{1,2}):(\d{2})/); if (!tm) return;
      rows.push({ min: +tm[1] * 60 + +tm[2], r: { tLo: cell(c, 'temp_low_f'), tHi: cell(c, 'temp_high_f'), wLo: cell(c, 'wind_low_mph'), wHi: cell(c, 'wind_high_mph'), dLo: cell(c, 'dir_low_deg'), dHi: cell(c, 'dir_high_deg') } }); });
    if (rows.length < 2) { showAlert('CAUTION', 'File not imported', 'No usable rows were found.'); return; }
    rows.sort((a, b) => a.min - b.min);
    const gaps = rows.slice(1).map((r, i) => r.min - rows[i].min).filter(g => g > 0).sort((a, b) => a - b); const step = Math.max(1, gaps[Math.floor(gaps.length / 2)] || 5);
    // Lay the readings on a regular time grid. A slot with no new reading carries the last one forward with its age, so gaps become stale.
    const out = []; let k = 0;
    for (let t = rows[0].min; t <= rows[rows.length - 1].min; t += step) { while (k + 1 < rows.length && rows[k + 1].min <= t) k++; out.push({ min: t, ageMin: t - rows[k].min, r: rows[k].r }); }
    if (playing) togglePlay();
    series = out; stepMin = step; source = { kind: 'import', file: name || 'file', rows: rows.length, first: rows[0].min, last: rows[rows.length - 1].min };
    session = idle(); fileRep = null; log = []; idx = 0; renderSource(); applyChange('DATA IMPORTED ' + source.file); renderFile();
  }

  /* ---------- regional model forecast ---------- */
  async function loadForecast() {
    const box = $('fcBox'); box.innerHTML = '<div class="muted">Loading forecast…</div>';
    const lat = parseFloat($('lat').value), lon = parseFloat($('lon').value);
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
      '&hourly=temperature_2m,temperature_80m,wind_speed_10m,wind_direction_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=4';
    try {
      const res = await fetch(url); if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json(), hh = j.hourly;
      const nowLocal = new Date(Date.now() + j.utc_offset_seconds * 1000).toISOString().slice(0, 13);
      fcState = { fetched: new Date(), hours: hh.time.map((t, i) => ({ t: t, past: t.slice(0, 13) < nowLocal, r: { tLo: hh.temperature_2m[i], tHi: hh.temperature_80m[i], wLo: hh.wind_speed_10m[i], wHi: hh.wind_speed_10m[i], dLo: hh.wind_direction_10m[i], dHi: hh.wind_direction_10m[i] } })) };
      renderForecast();
    } catch (e) { fcState = null; box.innerHTML = '<div class="muted">Could not reach the forecast service. Nothing is shown rather than guessed. The tower call above does not depend on it.</div>'; }
  }
  function renderForecast() {
    const box = $('fcBox'); const fcfg = Object.assign({}, cfg, { loLabel: '2 m', hiLabel: '80 m', skipHiWind: true, skipShearSpeed: true, shearDir: 180, community: [] });
    const hrs = fcState.hours.map(x => Object.assign({}, x, { ev: E.evaluate(x.r, fcfg) }));
    const days = {}; hrs.forEach(x => { (days[x.t.slice(0, 10)] = days[x.t.slice(0, 10)] || []).push(x); });
    let h = '<div class="fcgrid"><div></div>';
    for (let i = 0; i < 24; i++) h += '<div class="hr">' + (i % 3 === 0 ? (i === 0 ? '12a' : i < 12 ? i + 'a' : i === 12 ? '12p' : (i - 12) + 'p') : '') + '</div>';
    Object.keys(days).slice(0, 4).forEach(d => {
      h += '<div class="day">' + new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }) + '</div>';
      const by = {}; days[d].forEach(x => by[+x.t.slice(11, 13)] = x);
      for (let i = 0; i < 24; i++) { const x = by[i]; h += x ? '<div class="c ' + x.ev.status + (x.past ? ' past' : '') + '" data-t="' + x.t + '" title="' + esc(x.ev.status) + '"></div>' : '<div></div>'; }
    });
    h += '</div>';
    const fut = hrs.filter(x => !x.past), fit = E.goWindows(fut.map(x => x.ev), 60).find(w => w.hours >= cfg.jobHours && !w.openEnded);
    const lbl = t => new Date(t).toLocaleString('en-US', { weekday: 'short', hour: 'numeric' });
    h += '<div class="fcnext">' + (fit ? 'Model suggests a possible window ' + lbl(fut[fit.start].t) + ' to ' + lbl(fut[Math.min(fut.length - 1, fit.end)].t) + '. Confirm with the tower before relying on it.' : 'The model shows no ' + durWords(cfg.jobHours * 60) + ' window in this period.') + '</div>';
    h += '<div class="fcwhy" id="fcWhy">Fetched ' + fcState.fetched.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + '. Tap an hour for the model values.</div>';
    box.innerHTML = h;
    box.querySelectorAll('.c').forEach(c => c.addEventListener('click', () => { const x = hrs.find(y => y.t === c.dataset.t);
      $('fcWhy').innerHTML = '<b>' + lbl(x.t) + ': ' + x.ev.status + '.</b> Model: ' + v1(x.r.tLo) + '°F at 2 m, ' + v1(x.r.tHi) + '°F at 80 m, wind ' + v1(x.r.wLo) + ' mph at 10 m. ' + esc(x.ev.triggers.map(t => t.title).concat(x.ev.problems.map(p => p.text)).join('; ') || 'Model checks pass.'); }));
  }

  /* ---------- grower network (shared database) ---------- */
  const SB = 'https://nuafgtzcyrrvtiligkyl.supabase.co/rest/v1/';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51YWZndHpjeXJydnRpbGlna3lsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ3NTc1NzQsImV4cCI6MjExMDMzMzU3NH0.mhfolpk5bCK2e2lzn8DTLn1TWnjC5p0cLE1RF9YAa8E';
  const SBH = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };
  const KIND = { inversion: ['Air not moving', '#b3261e'], drift: ['Drift seen', '#b96a00'], crew: ['Crew in field', '#6d28d9'], spraying: ['Application recorded', '#0b6e99'] };
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
    community = netRows.concat(netLocal).filter(r => KIND[r.kind]).map(r => Object.assign({ kind: r.kind, note: r.note || '', local: !!r.local, ageMin: Math.max(0, (now - new Date(r.created_at).getTime()) / 60000) }, geo(me, { lat: r.lat, lon: r.lon })))
      .filter(c => c.distMi <= 5 && c.ageMin <= 480).sort((a, b) => a.ageMin - b.ageMin);
  }
  function applyNetwork(announce) {
    const before = evals[idx].status; buildCommunity(); setNow(); const after = evals[idx];
    if (announce && after.status !== before) {
      const t = after.triggers.find(x => /^NET_/.test(x.code)) || after.triggers[0];
      addLog('COMMUNITY REPORT changed the call ' + before + ' to ' + after.status);
      if (t) { showAlert(after.status, fmtTime(series[idx].min) + '  Community report: ' + before + ' → ' + after.status, t.title + '. ' + t.text); beep(1); }
    }
    lastStatus = after.status; renderAll(); renderNetwork();
  }
  async function pullNetwork(announce) {
    try { const res = await fetch(SB + 'reports?select=id,created_at,kind,lat,lon,note&order=created_at.desc&limit=200', { headers: SBH });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      netRows = await res.json(); netOnline = true; const ids = new Set(netRows.map(r => r.id)); netLocal = netLocal.filter(r => !ids.has(r.id));
    } catch (e) { netOnline = false; }
    applyNetwork(announce);
  }
  async function postReport(kind, note) {
    const me = blockPos(), row = { kind: kind, lat: +me.lat.toFixed(3), lon: +me.lon.toFixed(3), note: (note || '').trim().slice(0, 140) || null };
    let saved = null;
    try { const res = await fetch(SB + 'reports', { method: 'POST', headers: Object.assign({ Prefer: 'return=representation' }, SBH), body: JSON.stringify(row) });
      if (!res.ok) throw new Error('HTTP ' + res.status); saved = (await res.json())[0]; netOnline = true; } catch (e) { netOnline = false; }
    netLocal.unshift(saved || Object.assign({ id: 'local' + Date.now(), created_at: new Date().toISOString(), local: true }, row));
    addLog('COMMUNITY REPORT SENT: ' + KIND[kind][0] + (saved ? '' : ' (not delivered, kept on this device)')); applyNetwork(true);
    return !!saved;
  }
  const SAMPLE = (function () { let s = 11; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; const out = [];
    [[1.6, 1.3, 'inversion', 9], [-1.9, 0.4, 'drift', 6], [0.7, -1.8, 'spraying', 7], [-0.9, -1.4, 'crew', 3], [2.3, -0.6, 'inversion', 4]].forEach(c => {
      for (let i = 0; i < c[3]; i++) out.push({ kind: c[2], dx: c[0] + (rnd() - 0.5) * 1.3, dy: c[1] + (rnd() - 0.5) * 1.3, ageMin: 20 + rnd() * 300 }); });
    return out; })();
  function renderNetwork() {
    const Sz = 320, N = 20, span = 3, px = m => Sz / 2 + m / span * (Sz / 2), py = m => Sz / 2 - m / span * (Sz / 2), W = { drift: 3, inversion: 2, crew: 1.2, spraying: 1 };
    const real = community.filter(c => c.distMi <= span * 1.3).map(c => ({ kind: c.kind, dx: c.distMi * Math.sin(c.bearing * Math.PI / 180), dy: c.distMi * Math.cos(c.bearing * Math.PI / 180), ageMin: c.ageMin }));
    const pts = real.concat(SAMPLE);
    let h = '<defs><clipPath id="hc"><rect x="0" y="0" width="' + Sz + '" height="' + Sz + '" rx="4"/></clipPath></defs><g clip-path="url(#hc)"><rect width="' + Sz + '" height="' + Sz + '" fill="#e6eae8"/>';
    let q = 5; const r2 = () => (q = (q * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) h += '<rect x="' + (i * Sz / 6 + 1.5) + '" y="' + (j * Sz / 6 + 1.5) + '" width="' + (Sz / 6 - 3) + '" height="' + (Sz / 6 - 3) + '" rx="3" fill="' + ['#d7e0bf', '#cddab0', '#e2dcc0', '#d3ddb8'][Math.floor(r2() * 4)] + '"/>';
    const cell = Sz / N; let vmax = 0; const vals = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const mx = ((i + 0.5) / N * 2 - 1) * span, my = -((j + 0.5) / N * 2 - 1) * span; let v = 0;
      pts.forEach(p => { v += W[p.kind] * Math.exp(-((p.dx - mx) ** 2 + (p.dy - my) ** 2) / 0.6) * Math.max(0.3, 1 - p.ageMin / 480); }); vals.push([i, j, v]); if (v > vmax) vmax = v; }
    vals.forEach(([i, j, v]) => { const t = v / Math.max(vmax, 3); if (t < 0.07) return;
      const c = t < 0.5 ? [250, 204 - 89 * t * 2, 21] : [249 - 70 * (t - 0.5) * 2, 115 - 77 * (t - 0.5) * 2, 22 + 8 * (t - 0.5) * 2];
      h += '<rect x="' + (i * cell) + '" y="' + (j * cell) + '" width="' + (cell + 0.5) + '" height="' + (cell + 0.5) + '" fill="rgb(' + c.map(Math.round).join(',') + ')" opacity="' + (0.25 + 0.6 * t).toFixed(2) + '"/>'; });
    [1, 2, 3].forEach(m => { h += '<circle cx="' + Sz / 2 + '" cy="' + Sz / 2 + '" r="' + (m / span * Sz / 2) + '" fill="none" stroke="#17201b" stroke-opacity=".28" stroke-dasharray="3 5"/><text x="' + (Sz / 2 + 4) + '" y="' + (Sz / 2 - m / span * Sz / 2 + 12) + '" font-size="9" fill="#17201b" opacity=".6">' + m + ' mi</text>'; });
    real.forEach(p => { h += '<circle cx="' + px(p.dx) + '" cy="' + py(p.dy) + '" r="6" fill="' + KIND[p.kind][1] + '" stroke="#fff" stroke-width="2"/>'; });
    h += '<rect x="' + (Sz / 2 - 9) + '" y="' + (Sz / 2 - 9) + '" width="18" height="18" rx="4" fill="#15212a" stroke="#fff" stroke-width="2"/><text x="' + Sz / 2 + '" y="' + (Sz / 2 + 24) + '" text-anchor="middle" font-size="10" font-weight="600" fill="#15212a">This block</text>';
    h += '<text x="' + Sz / 2 + '" y="14" text-anchor="middle" font-size="11" font-weight="600" fill="#17201b">N</text></g>';
    $('heatMap').innerHTML = h;
    $('heatState').innerHTML = '<span class="srcTag light">Sample community reports</span> drawn as shading so the map is not empty. <span class="srcTag light">Actual community reports</span> ' + real.length + ' nearby, drawn as solid dots' + (netOnline === false ? '. The shared database could not be reached, so only reports made on this device are shown.' : '.') + ' Only actual reports affect the weather call.';
    const using = new Set(evals[idx].triggers.filter(t => /^NET_/.test(t.code)).map(t => ({ NET_INVERSION: 'inversion', NET_DRIFT: 'drift', NET_CREW: 'crew' }[t.code])));
    $('netFeed').innerHTML = community.slice(0, 10).map(c => '<li><span class="dot" style="background:' + KIND[c.kind][1] + '"></span><div><b>' + KIND[c.kind][0] + '</b> ' + (c.distMi < 0.15 ? 'at this block' : f1(c.distMi) + ' mi ' + E.compass(c.bearing)) + ', ' + (c.ageMin < 1 ? 'just now' : c.ageMin < 60 ? Math.round(c.ageMin) + ' min ago' : f1(c.ageMin / 60) + ' h ago') + (c.local ? ' (this device only)' : '') + (using.has(c.kind) ? ' <span class="used">affecting the call</span>' : '') + '</div></li>').join('') || '<li class="muted">No actual reports within 5 miles in the last 8 hours.</li>';
  }

  /* ---------- application record and signature ---------- */
  function loadSaved() { try { return JSON.parse(localStorage.getItem('sow_records') || '[]'); } catch (e) { return []; } }
  function buildFile() {
    const iS = idxAt(session.startMin), iE = idxAt(session.endMin), b = baseEvals();
    let worst = 'GO'; for (let i = iS; i <= iE; i++) if (E.RANK[b[i].status] > E.RANK[worst]) worst = b[i].status;
    fileRep = { start: session.startMin, end: session.endMin, rs: reading(iS), re: reading(iE), worst: worst, source: sourceName(),
      alerts: log.filter(l => l.min >= session.startMin && l.min <= session.endMin && /^ALERT/.test(l.event)).length, product: cfg.profile && cfg.profile !== 'custom' ? PROFILES[cfg.profile].name : 'Not set', saved: null };
    renderFile();
  }
  function fileRows(f) {
    const w = r => v1(r.wLo) + ' mph from ' + (num(r.dLo) ? E.compass(r.dLo) : 'n/a') + ' at 5 ft, ' + v1(r.wHi) + ' mph from ' + (num(r.dHi) ? E.compass(r.dHi) : 'n/a') + ' at 30 ft';
    return [['Block', $('blockName').textContent], ['Date applied', dateStr() + ' (' + TZ.name + ')'], ['Time of application', fmtTime(f.start) + ' to ' + fmtTime(f.end)],
      ['Wind at start', w(f.rs)], ['Wind at finish', w(f.re)], ['Temperature at start', v1(f.rs.tLo) + '°F at 5 ft, ' + v1(f.rs.tHi) + '°F at 30 ft'],
      ['Product type', f.product], ['Weather call during the job', f.worst + (f.alerts ? ', ' + f.alerts + ' alert' + (f.alerts > 1 ? 's' : '') : ', no alerts')], ['Data source', f.source + (source.kind === 'sim' ? ' (demonstration data)' : '')]];
  }
  function renderSaved() {
    const recs = loadSaved();
    $('savedList').innerHTML = recs.length ? recs.map(r => '<li><span class="rt1">' + esc(r.date) + '</span><div><b>' + esc(r.ref) + '</b> ' + esc(r.time) + ', signed by ' + esc(r.signer) + (r.demo ? ' <span class="srcTag light">Demo data</span>' : '') + '<div class="muted">' + esc(r.call) + '. ' + (r.shared ? 'Conditions sent to the shared database.' : 'Not sent to the shared database.') + '</div></div></li>').join('') : '<li class="muted">No saved records on this device yet.</li>';
  }
  function renderFile() {
    const box = $('fileBox'); renderSaved();
    if (!fileRep) { box.innerHTML = '<div class="muted">Start a spray job in Monitoring, then finish it. The record is filled in from the tower readings and waits here for your signature.</div>'; return; }
    const rows = fileRows(fileRep).map(r => '<tr><th>' + r[0] + '</th><td>' + esc(r[1]) + '</td></tr>').join('');
    let h = '<table class="ft">' + rows + '</table>';
    if (fileRep.saved) {
      const s = fileRep.saved;
      h += '<div class="filed"><b>' + (s.stored ? 'Signed and saved in this browser.' : 'Signed, but this browser refused to store it. Print or download it now.') + '</b> Reference ' + s.ref + '.<br>Signed by ' + esc(s.signer) + ' at ' + s.signedAt + '.<img class="signimg" alt="Signature" src="' + s.sig + '"></div>';
      h += '<div class="row"><button id="filePrint" class="btn primary">Print or save as PDF</button><button id="fileDl" class="btn">Download text copy</button></div>';
      h += '<div class="muted small">' + (s.shared ? 'The conditions, with no name and no signature, were sent to the shared community database.' : 'The shared community database could not be reached, so nothing was sent there.') + ' Nothing was sent to the Arizona Department of Agriculture. This covers the timing and weather part of Form 1080 and is not the official form.</div>';
    } else {
      h += '<div class="sign"><label for="signName">Applicator name</label><input id="signName" type="text" autocomplete="name" style="width:100%" value="' + esc(fileRep.signer || '') + '"></div>';
      h += '<div class="sign"><label>Sign here</label><div class="signpad"><canvas id="signPad"></canvas><div class="line"></div><div class="hint">Draw with a finger or the mouse</div></div></div>';
      h += '<button id="fileBtn" class="btn primary big" disabled>Sign and save record</button><div class="row"><button id="signClear" class="btn">Clear signature</button></div>';
    }
    box.innerHTML = h;
    if (fileRep.saved) {
      const s = fileRep.saved;
      $('filePrint').onclick = () => { $('printDoc').innerHTML = '<h1>Pesticide application record</h1><div>Timing and weather record generated by Spray or Wait. Not the official Arizona Form 1080.</div><table>' + rows + '<tr><th>Reference</th><td>' + s.ref + '</td></tr><tr><th>Signed by</th><td>' + esc(s.signer) + ', ' + s.signedAt + '</td></tr></table><img alt="Signature" style="height:80px" src="' + s.sig + '">'; window.print(); };
      $('fileDl').onclick = () => download('application_record_' + dateStr() + '.txt', 'SPRAY OR WAIT: APPLICATION RECORD\r\n\r\n' + fileRows(fileRep).map(r => r[0] + ': ' + r[1]).join('\r\n') + '\r\nReference: ' + s.ref + '\r\nSigned by: ' + s.signer + ', ' + s.signedAt + '\r\n', 'text/plain');
      return;
    }
    const cv = $('signPad'), ctx = cv.getContext('2d'); let drawing = false, inked = false;
    const fit = () => { const r = cv.getBoundingClientRect(); cv.width = Math.max(10, r.width) * 2; cv.height = Math.max(10, r.height) * 2; ctx.scale(2, 2); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#15212a'; };
    fit(); $('fileSec').addEventListener('toggle', () => { if (!inked && $('signPad') === cv) fit(); });
    const pos = ev => { const r = cv.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
    const ready = () => { $('fileBtn').disabled = !(inked && $('signName').value.trim().length > 1); };
    cv.addEventListener('pointerdown', ev => { drawing = true; cv.setPointerCapture(ev.pointerId); const p = pos(ev); ctx.beginPath(); ctx.moveTo(p[0], p[1]); ev.preventDefault(); });
    cv.addEventListener('pointermove', ev => { if (!drawing) return; const p = pos(ev); ctx.lineTo(p[0], p[1]); ctx.stroke(); inked = true; ready(); });
    cv.addEventListener('pointerup', () => { drawing = false; });
    $('signName').addEventListener('input', () => { fileRep.signer = $('signName').value; ready(); });
    $('signClear').onclick = () => { ctx.clearRect(0, 0, cv.width, cv.height); inked = false; ready(); };
    $('fileBtn').onclick = async () => { const fb = $('fileBtn'); fb.disabled = true; fb.textContent = 'Saving…';
      const s = { sig: cv.toDataURL('image/png'), signer: $('signName').value.trim(), signedAt: new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
        ref: 'SOW ' + dateStr().slice(5).replace('-', '') + ' ' + String(Math.floor(1000 + Math.random() * 9000)) };
      s.shared = await postReport('spraying', 'Application recorded. Weather call during job: ' + fileRep.worst);
      const rec = { ref: s.ref, date: dateStr(), time: fmtTime(fileRep.start) + ' to ' + fmtTime(fileRep.end), signer: s.signer, signedAt: s.signedAt, call: 'Weather call during the job: ' + fileRep.worst, fields: fileRows(fileRep), sig: s.sig, demo: source.kind === 'sim', source: fileRep.source, shared: s.shared };
      // Save, then read it back. Only say it is saved if the read back matches.
      try { const all = loadSaved(); all.unshift(rec); localStorage.setItem('sow_records', JSON.stringify(all.slice(0, 50))); s.stored = loadSaved().some(r => r.ref === s.ref); } catch (e) { s.stored = false; }
      fileRep.saved = s; addLog('APPLICATION RECORD SIGNED ' + s.ref + (s.stored ? ', saved in this browser' : ', NOT stored')); renderFile(); };
  }

  /* ---------- pest guide ---------- */
  function renderPest() {
    const p = window.SprayPests.find(x => x.id === $('pestSel').value) || window.SprayPests[0];
    const row = (t, v) => '<div class="pr"><div class="pk">' + t + '</div><div>' + v + '</div></div>';
    $('pestBox').innerHTML = '<div>' + row('Why it matters', esc(p.why)) + row('When', esc(p.when)) + row('Scout first', esc(p.scout)) + '</div><div>' +
      row('Options Extension lists', '<ul>' + p.options.map(o => '<li>' + esc(o) + '</li>').join('') + '</ul>') + row('Help the grove defend itself', esc(p.defend)) +
      row('Source', '<a href="' + p.src[1] + '" target="_blank" rel="noopener">' + esc(p.src[0]) + '</a>') +
      (p.profile !== 'custom' ? '<div class="row"><button id="pestUse" class="btn">Use the ' + PROFILES[p.profile].name.toLowerCase() + ' spray profile</button></div>' : '') + '</div>';
    const b = $('pestUse'); if (b) b.onclick = () => { $('cfgProf').value = p.profile; readForm(); };
  }

  /* ---------- waitlist and QR ---------- */
  async function joinWaitlist() {
    const email = $('wlEmail').value.trim().toLowerCase(), msg = $('wlMsg');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { msg.textContent = 'Enter a valid email address.'; return; }
    $('wlBtn').disabled = true; msg.textContent = 'Adding you…';
    try { const res = await fetch(SB + 'waitlist', { method: 'POST', headers: Object.assign({ Prefer: 'return=minimal' }, SBH), body: JSON.stringify({ email: email, role: $('wlRole').value }) });
      if (res.status === 409) msg.textContent = 'You are already on the list.';
      else if (!res.ok) throw new Error('HTTP ' + res.status);
      else { msg.textContent = 'You are on the list.'; $('wlEmail').value = ''; }
    } catch (e) { msg.textContent = 'Could not reach the waitlist. You were not added. Try again when you are online.'; }
    $('wlBtn').disabled = false;
  }
  function renderQr() {
    try { const q = window.qrcode(0, 'M'); q.addData(LIVE_URL); q.make(); $('qrBox').innerHTML = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); } catch (e) { $('qrBox').textContent = LIVE_URL; }
  }

  /* ---------- wire up ---------- */
  function openSec(id) { const d = $(id); if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }
  function init() {
    $('build').textContent = 'Build ' + BUILD + '.';
    fillForm(); renderSource(); recompute(); setNow(); lastStatus = evals[idx].status; renderRules(); addLog('Reading'); renderAll(); renderFile();
    $('play').onclick = () => { stopAt = null; togglePlay(); };
    $('speed').onchange = () => { if (playing) { clearInterval(timer); timer = setInterval(stepOnce, +$('speed').value); } };
    $('demoReset').onclick = resetDemo;
    document.querySelectorAll('.jump').forEach(b => b.onclick = () => { if (playing) togglePlay(); jump(idxAt(+b.dataset.min));
      if (b.dataset.play) { stopAt = b.dataset.play; $('speed').value = '1000'; togglePlay(); } });
    let drag = false; const tl = $('tl');
    tl.addEventListener('pointerdown', e => { drag = true; if (playing) togglePlay(); tlPick(e); });
    window.addEventListener('pointermove', e => { if (drag) tlPick(e); });
    window.addEventListener('pointerup', () => { drag = false; });
    window.addEventListener('resize', renderTimeline);
    ['cfgProf', 'cfgVol', 'cfgMin', 'cfgMax', 'cfgJob', 'cfgSiteOn', 'cfgSiteName', 'cfgSiteDir', 'cfgShS', 'cfgShD'].forEach(id => $(id).addEventListener('change', readForm));
    $('optDropHi').onchange = () => { dropHi = $('optDropHi').checked; applyChange(dropHi ? 'TEST: 30 ft sensor disconnected' : 'TEST ENDED: 30 ft sensor reconnected'); };
    $('sprayBtn').onclick = toggleSession;
    $('noteBtn').onclick = () => { const v = $('noteIn').value.trim(); if (v) { addLog('NOTE: ' + v); $('noteIn').value = ''; } };
    $('noteIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('noteBtn').click(); });
    $('logAlerts').onchange = renderLog;
    $('logCsv').onclick = () => download('spray_or_wait_record_' + dateStr() + '.csv', logCsv());
    $('optPush').onchange = () => { if ($('optPush').checked && 'Notification' in window && Notification.permission !== 'granted') { try { Notification.requestPermission(); } catch (e) {} } };
    $('csvSample').onclick = sampleCsv;
    $('csvIn').onchange = e => { const f = e.target.files[0]; if (!f) return; const fr = new FileReader(); fr.onload = () => loadCsv(String(fr.result), f.name); fr.readAsText(f); e.target.value = ''; };
    $('resetBtn').onclick = () => { if (playing) togglePlay(); cfg = Object.assign({}, E.DEFAULT_CFG); saveCfg(); series = simSeries(); stepMin = S.STEP_MIN; source = { kind: 'sim' }; dropHi = false; $('optDropHi').checked = false; $('cfgErr').hidden = true;
      fillForm(); renderSource(); recompute(); renderRules(); resetDemo(); if (fcState) renderForecast(); };
    $('fcBtn').onclick = loadForecast;
    $('fcSec').addEventListener('toggle', () => { if ($('fcSec').open && !fcState) loadForecast(); });
    document.addEventListener('click', e => { const a = e.target.closest('[data-open],#openRecord'); if (!a) return; e.preventDefault(); openSec(a.dataset.open || 'recordSec'); });
    document.querySelectorAll('.qbtn').forEach(b => b.onclick = async () => { b.disabled = true; const ok = await postReport(b.dataset.kind, null); b.disabled = false;
      $('quickMsg').textContent = ok ? 'Sent to the shared database.' : 'Could not reach the shared database. Kept on this device only.'; });
    ['lat', 'lon'].forEach(id => $(id).addEventListener('change', () => applyNetwork(false)));
    $('pestSel').innerHTML = window.SprayPests.map(p => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join(''); $('pestSel').onchange = renderPest; renderPest();
    $('wlBtn').onclick = joinWaitlist; renderQr();
    renderNetwork(); pullNetwork(false); setInterval(() => pullNetwork(true), 8000);
    window.__sow = { state: () => ({ idx: idx, time: fmtTime(series[idx].min), status: evals[idx].status, ground: evals[idx].ground.status, logLen: log.length, playing: playing, source: source.kind }) };
  }
  init();
})();
