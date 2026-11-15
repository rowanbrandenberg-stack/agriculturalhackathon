/* Spray or Wait: interface. Decision rules live in engine.js, the simulated tower in sim.js. */
(function () {
  const E = window.SprayEngine, S = window.SpraySim;
  const $ = id => document.getElementById(id);
  const f1 = E.f1;
  const BUILD = '2026-11-15.15';
  /* Live mode: a real location, real model weather. Rounded coordinates for the area, not the farm's address. No tower is installed there. */
  const FARM = { name: 'SouthWinds Farm area', place: 'near Benson, Arizona', lat: 31.97, lon: -110.29 };
  const BLOCK_SIM = 'Block 7, lemons, Yuma County, Arizona';
  const LIVE_URL = 'https://rowanbrandenberg-stack.github.io/agriculturalhackathon/';
  const TZ = { name: 'America/Phoenix', offset: '-07:00', abbr: 'MST' };
  const WATCH_HOURS = { low: 1, medium: 4, high: 12 };   // prototype values, confirm with a PCA
  const COL = { GO: '#1c7c3c', CAUTION: '#b96a00', STOP: '#b3261e', UNABLE: '#5b6770' };
  /* The applicator picks what the PCA already recommended. The tool never recommends a product. Heat limits are prototype values. */
  const PROFILES = {
    custom: { name: 'Custom (set below)', vol: null, heat: null, text: '', note: 'Set volatility yourself from the product label.' },
    oil: { name: 'Horticultural or neem oil', vol: 'low', heat: 90, text: 'Oil sprays can burn leaves and fruit in heat.', note: 'Low vapor risk. Prototype heat limit 90°F because oil can burn leaves and fruit.' },
    sulfur: { name: 'Sulfur', vol: 'low', heat: 90, text: 'Sulfur can burn foliage in heat.', note: 'Low vapor risk. Prototype heat limit 90°F because sulfur can burn foliage.' },
    biofung: { name: 'Organic fungicide (biological)', vol: 'low', heat: null, text: '', note: 'Standard checks apply. Check the label for rain and sunlight limits, which this tool does not measure.' },
    contact: { name: 'Contact insecticide, low volatility', vol: 'low', heat: null, text: '', note: 'Standard checks apply.' },
    volatile: { name: 'Volatile herbicide on the orchard floor', vol: 'high', heat: 85, text: 'Volatile products can give off more vapor in heat.', note: 'High vapor risk. Prototype heat limit 85°F and a 12 hour watch after spraying.' }
  };
  const SITE_SIDE = { 0: 'north', 45: 'northeast', 90: 'east', 135: 'southeast', 180: 'south', 225: 'southwest', 270: 'west', 315: 'northwest' };
  const CFG_KEYS = ['windMin', 'windMax', 'shearSpeed', 'shearDir', 'volatility', 'heatLimit', 'heatText', 'productName', 'profile', 'siteOn', 'siteName', 'siteBearing', 'jobHours', 'jobCost'];

  let cfg = Object.assign({ jobCost: 0 }, E.DEFAULT_CFG);
  try { const sv = JSON.parse(localStorage.getItem('sow_cfg') || 'null'); if (sv) { const c = Object.assign({}, cfg); CFG_KEYS.forEach(k => { if (k in sv) c[k] = sv[k]; }); if (!E.validateCfg(c).length && num0(c.jobCost)) cfg = c; } } catch (e) {}

  function num0(x) { return typeof x === 'number' && isFinite(x) && x >= 0; }
  let stepMin = S.STEP_MIN;
  let series = simSeries();
  let source = { kind: 'sim' };
  let dropHi = false;
  let evals = [], overIdx = null, community = [], feedLoc = null, reqId = 0;
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
  const dayDate = min => { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + Math.floor(min / 1440)); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
  const measIso = min => dayDate(min) + 'T' + p2(Math.floor((min % 1440) / 60)) + ':' + p2(min % 60) + ':00' + TZ.offset;
  const tm = min => fmtTime(min) + (min >= 1440 ? ' tomorrow' : '');
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function saveCfg() { try { const o = {}; CFG_KEYS.forEach(k => o[k] = cfg[k]); localStorage.setItem('sow_cfg', JSON.stringify(o)); } catch (e) {} }
  const sourceName = () => source.kind === 'sim' ? 'Simulated tower readings' : source.kind === 'live' ? 'Live regional model' : 'Imported tower readings';
  const isLive = () => source.kind === 'live';
  const reading = i => { const r = Object.assign({}, series[i].r); if (dropHi) { r.tHi = null; r.wHi = null; r.dHi = null; } return r; };
  /* What the rules see. In live model mode the upper wind is at 260 ft, far above any canopy, so the shear and upper wind rules
     are not applied: the upper wind is replaced by the ground wind and only the temperature pair and ground wind are judged. */
  const cfgAt = i => (isLive() && series[i].near) ? Object.assign({}, cfg, { nearby: series[i].near }) : cfg;
  const evalReading = i => { const r = reading(i); if (isLive()) { r.wHi = r.wLo; r.dHi = r.dLo; } return r; };
  const metaOf = i => ({ ageMin: series[i].ageMin, staleMin: cfg.staleIntervals * stepMin });
  /* Actual community reports are used only in live mode, and only once the feed for that location has loaded. Demo and imported data never see them. */
  const usedCommunity = () => (isLive() && feedLoc === 'live') ? community : [];
  const locName = () => isLive() ? FARM.name + ', ' + FARM.place : source.kind === 'sim' ? 'Demo block (simulated)' : 'Imported file';
  function recompute() { evals = series.map((s, i) => E.evaluate(evalReading(i), cfgAt(i), metaOf(i))); overIdx = null; }
  /* Community reports are about right now, so they adjust only the current reading, never the day totals. */
  function setNow() {
    if (overIdx != null && overIdx !== idx && overIdx < series.length) evals[overIdx] = E.evaluate(evalReading(overIdx), cfgAt(overIdx), metaOf(overIdx));
    evals[idx] = E.evaluate(evalReading(idx), Object.assign({}, cfgAt(idx), { community: usedCommunity() }), metaOf(idx)); overIdx = idx;
  }
  const baseEvals = () => evals.map((e, i) => i === overIdx ? E.evaluate(evalReading(i), cfgAt(i), metaOf(i)) : e);
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }

  /* ---------- current weather ---------- */
  function goodReasons(r, ev) {
    const lo = cfg.loLabel, hi = cfg.hiLabel, out = [];
    out.push(['No inversion detected between ' + lo + ' and ' + hi, 'The ' + hi + ' reading is ' + f1(-ev.dT) + '°F cooler than the ' + lo + ' reading.']);
    if (isLive()) out.push(['Ground wind inside your limits', f1(r.wLo) + ' mph from the ' + E.compass(r.dLo) + ' in the model at 10 m. Limits are ' + cfg.windMin + ' to ' + cfg.windMax + ' mph. Not checked in this mode: upper wind and wind shear. They need a tower.']);
    else {
      out.push(['Wind inside your limits at both heights', f1(r.wLo) + ' mph at ' + lo + ' and ' + f1(r.wHi) + ' mph at ' + hi + '. Limits are ' + cfg.windMin + ' to ' + cfg.windMax + ' mph.']);
      out.push(['Wind similar at both heights', 'From the ' + E.compass(r.dLo) + ' at ' + lo + ' and the ' + E.compass(r.dHi) + ' at ' + hi + ', ' + Math.round(ev.shearDir) + '° apart. Speeds differ by ' + f1(Math.abs(ev.shearSpd)) + ' mph.']);
    }
    if (cfg.siteOn) out.push(['Measured winds point away from the ' + cfg.siteName, 'This does not establish where all droplets or vapor will travel.']);
    return out;
  }
  let moreOpen = false;
  function renderStatus() {
    const r = reading(idx), ev = evals[idx];
    $('statusCard').className = 'status ' + ev.status;
    $('statusWord').textContent = ev.status;
    let action = { GO: (isLive() ? 'The model checks that can run passed. Upper wind and shear are not checked without a tower.' : 'Measured weather checks passed.') + ' Confirm label requirements and on site conditions before applying.', CAUTION: 'Marginal. Read the reasons and recheck before each tank.', STOP: 'Do not spray right now.', UNABLE: 'Unable to assess. This is not a GO. Check or restore the sensor that is not reporting.' }[ev.status];
    if (session.state === 'spraying' && ev.status === 'STOP') action = 'Stop spraying now.';
    $('statusAction').textContent = action;
    const nC = ev.concerns.length, feedBad = isLive() && netOnline === false;
    $('splitLine').innerHTML = '<span>Weather <b class="pill ' + ev.weather + '">' + ev.weather + '</b></span><span>Site and community concerns <b class="pill ' + (nC ? (ev.concerns.some(c => c.level === 2) ? 'STOP' : 'CAUTION') : 'NONE') + '">' + (nC ? nC + ' open' : 'none') + '</b></span>' +
      (isLive() ? '<span class="muted">' + (feedBad ? 'Community feed unavailable. Reports are not being checked.' : feedLoc === 'live' ? 'Community feed checked for this location.' : 'Community feed loading.') + '</span>' : '<span class="muted">Demo: actual community reports are not used.</span>');
    const ul = $('reasons'); ul.innerHTML = '';
    const items = [];
    ev.problems.forEach(p => items.push(['pb', 'Cannot assess', p.text, 1.5]));
    ev.triggers.forEach(t => items.push(['l' + t.level, t.title, t.text, t.level]));
    if (ev.status === 'GO') { goodReasons(r, ev).forEach(g => items.push(['ok', g[0], g[1], 0])); }
    const li = it => '<li class="' + it[0] + '"><b>' + esc(it[1]) + '</b>' + esc(it[2]) + '</li>';
    const rest = items.slice(1), stops = rest.filter(it => it[3] === 2).length;
    ul.innerHTML = (items[0] ? li(items[0]) : '') + (rest.length ? '<li class="more"><details id="moreWhy"' + (moreOpen ? ' open' : '') + '><summary>' + (ev.status === 'GO' ? 'View the other checks (' + rest.length + ')' : 'View additional concerns (' + rest.length + (stops ? ', ' + stops + ' of them STOP' : '') + ')') + '</summary><ul class="reasons">' + rest.map(li).join('') + '</ul></details></li>' : '');
    const mw = $('moreWhy'); if (mw) mw.addEventListener('toggle', () => { moreOpen = mw.open; });
    const gp = $('groundPill'); gp.textContent = ev.ground.status; gp.className = 'pill ' + ev.ground.status;
    $('groundText').textContent = ev.ground.text;
    const gm = $('groundMiss');
    if (ev.missed) {
      const miss = ev.triggers.filter(t => !/^WIND_(LOW|HIGH)_LO$/.test(t.code) && !/^NET_|^SITE_/.test(t.code)).map(t => t.title.toLowerCase());
      gm.className = 'gmiss'; gm.textContent = 'A wind check near the ground alone does not show: ' + miss.join('; ') + '.';
    } else if (ev.ground.status === ev.weather) { gm.className = 'gmiss same'; gm.textContent = 'Same weather result as ' + (isLive() ? 'the model checks' : 'the two height rules') + ' for this reading.'; }
    else { gm.className = 'gmiss same'; gm.textContent = (isLive() ? 'The model checks' : 'The two height rules') + ' give ' + ev.weather + ' for the weather on this reading.'; }
    $('clock').textContent = fmtTime(series[idx].min);
    $('clockSub').textContent = isLive() ? (series[idx].min >= 1440 ? 'tomorrow, ' : '') + (idx > nowIdx() ? 'model forecast hour' : idx === nowIdx() ? 'this hour, model' : 'earlier model hour') + ', ' + TZ.abbr : 'measurement time, ' + TZ.abbr;
  }

  /* ---------- planned job ---------- */
  const wxEvals = () => evals.map(e => ({ status: e.weather }));
  const jobNow = () => E.jobAssessment(wxEvals(), idx, stepMin, cfg.jobHours);
  const CONCERN_NOTE = 'Weather may be suitable during this window. Site concerns still require resolution.';
  function renderJob() {
    const ev = evals[idx], j = jobNow(), endT = tm(series[Math.min(series.length - 1, idx + j.runMin / stepMin)].min), nC = ev.concerns.length;
    let tag, cls, txt;
    if (j.state === 'STOP') { tag = 'STOP'; cls = 'STOP'; txt = 'Current weather is STOP, so this job should not start now.'; }
    else if (j.state === 'UNKNOWN' && j.current === 'UNABLE') { tag = 'UNKNOWN'; cls = 'UNABLE'; txt = 'Current weather cannot be assessed, so the window for this job is unknown. Check or restore the sensor that is not reporting.'; }
    else if (j.state === 'UNKNOWN') { tag = 'UNKNOWN'; cls = 'UNABLE'; txt = 'The data ends at ' + tm(series[series.length - 1].min) + '. Only ' + durWords(j.runMin) + ' of suitable weather is projected and this job needs ' + durWords(j.needMin) + '. The rest is not known.'; }
    else if (j.state === 'WAIT' && j.current === 'CAUTION') { tag = 'WAIT'; cls = 'CAUTION'; txt = 'Current weather is CAUTION.'; }
    else if (j.state === 'WAIT') { tag = 'WAIT'; cls = 'CAUTION'; txt = 'Only ' + durWords(j.runMin) + ' of projected suitable weather remain for this ' + jobWords() + ' job.'; }
    else if (nC) { tag = 'WEATHER WINDOW ONLY'; cls = 'CAUTION'; txt = durWords(j.runMin) + ' of projected suitable weather, until ' + endT + ', long enough for this ' + jobWords() + ' job. ' + CONCERN_NOTE; }
    else { tag = 'SUFFICIENT WINDOW'; cls = 'GO'; txt = durWords(j.runMin) + ' of projected suitable weather, until ' + endT + '. This ' + jobWords() + ' job fits.'; }
    let nxt = '';
    if (j.state !== 'SUFFICIENT') nxt = j.next ? 'Projected suitable weather window: ' + tm(series[j.next.start].min) + ' to ' + tm(series[j.next.start].min + j.next.hours * 60) + ' (' + durWords(j.next.hours * 60) + ').' + (nC ? ' ' + CONCERN_NOTE : '')
      : 'No later window of ' + durWords(j.needMin) + ' is projected in this data.';
    if (cfg.jobCost > 0 && j.state !== 'SUFFICIENT') nxt += ' Product cost you entered for this job: $' + Math.round(cfg.jobCost).toLocaleString('en-US') + '. That is what a wasted application puts at stake.';
    const src = source.kind === 'sim' ? 'Projection source: the remaining samples of a known simulated day. This is a demonstration, not a forecast.' : isLive() ? 'Projection source: the regional model forecast for the hours ahead (Open-Meteo). A forecast for the area, not a measurement at the farm, and no replacement for readings in the field.' : 'Projection source: later rows of the imported file. This is not a forecast.';
    const cPill = nC ? (ev.concerns.some(c => c.level === 2) ? 'STOP' : 'CAUTION') : 'NONE';
    $('jobStrip').className = 'jobstrip ' + cls;
    $('jobStrip').innerHTML = '<div class="jl"><span class="jk">Current weather</span><span class="pill ' + ev.weather + '">' + ev.weather + '</span><span class="jt">Temperature, wind, inversion' + (isLive() ? '' : ' and shear') + ' checks only.</span></div>' +
      '<div class="jl"><span class="jk">Site concerns</span><span class="pill ' + cPill + '">' + (nC ? nC + ' OPEN' : 'NONE') + '</span><span class="jt">' + (nC ? esc(ev.concerns.map(c => c.title).join('; ')) + '.' : 'No sensitive site or community concern flagged for this reading.') + '</span></div>' +
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
    h += sensor(yHi, '#c2410c', isLive() ? 'Model at 80 m, about 260 ft' : 'Sensor at ' + cfg.hiLabel + ', above the canopy', r.tHi, r.wHi, r.dHi, 'ahH');
    h += sensor(yLo, '#0b6e99', isLive() ? 'Model near the ground (2 m air, 10 m wind)' : 'Sensor at ' + cfg.loLabel + ', ground station height', r.tLo, r.wLo, r.dLo, 'ahL');
    const dtTxt = ev.dT == null ? 'no comparison' : ev.dT > 0 ? f1(ev.dT) + '°F warmer at ' + cfg.hiLabel : ev.dT === 0 ? 'same temperature' : f1(-ev.dT) + '°F cooler at ' + cfg.hiLabel;
    h += '<rect x="322" y="8" width="230" height="30" rx="15" fill="' + (ev.dT == null ? '#5b6770' : inv ? '#b3261e' : near ? '#b96a00' : '#1c7c3c') + '"/>';
    h += '<text x="437" y="28" text-anchor="middle" font-size="14" font-weight="600" fill="#fff">' + dtTxt + '</text>';
    h += '<text x="548" y="322" text-anchor="end" font-size="11" fill="#f4f1e6" opacity=".9">' + (isLive() ? 'Regional model, no tower at this site, ' + tm(series[idx].min) : sourceName() + ', measured ' + fmtTime(series[idx].min)) + '</text>';
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
      '<div><span>Wind speed difference</span><b>' + (isLive() ? 'needs a tower' : ev.shearSpd == null ? 'n/a' : (ev.shearSpd > 0 ? '+' : '') + f1(ev.shearSpd) + ' mph') + '</b></div>' +
      '<div><span>Wind direction difference</span><b>' + (isLive() ? 'needs a tower' : ev.shearDir == null ? 'not reliable' : Math.round(ev.shearDir) + '°') + '</b></div>';
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
    const L = narrow ? 76 : 150, Rm = narrow ? 6 : 12, n = series.length, base = evals.map(e => ({ status: e.weather, missed: e.missed, dT: e.dT, ground: e.ground }));
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
    const tick = (narrow ? 6 : 2) * (t1 - t0 > 1500 ? 2 : 1);
    for (let hr = Math.ceil(t0 / 60 / tick) * tick; hr * 60 <= t1; hr += tick) {
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
    if (isLive()) { const nx = x(nowIdx() + 0.5); svg.innerHTML += '<text x="' + (nx + 4) + '" y="' + (H - 2) + '" font-size="10" font-weight="600" fill="#15212a">now</text><line x1="' + nx + '" y1="276" x2="' + nx + '" y2="292" stroke="#15212a"/>'; }
    if (evals.some(e => e.weather === 'UNABLE')) { $('tlfoot').innerHTML = '<b>Comparison unavailable: insufficient sensor data.</b> Missing readings are not counted as detected or as missed. Restore the sensor to compare.'; return; }
    $('tlfoot').innerHTML = (source.kind === 'sim' ? 'In this simulated day' : isLive() ? 'In the regional model for today and tomorrow at this location' : 'In this imported data') + ', ground wind checks missed <b>' + f1(missedH) + ' hours</b> flagged by ' + (isLive() ? 'the inversion check' : 'our two height rules') + '. ' +
      '<span class="muted">Counted from the readings and the active thresholds. It is not a measure of drift prevented or of detection accuracy.</span>';
  }
  function tlPick(evn) {
    const rect = $('tl').getBoundingClientRect(), W = rect.width, L = W < 700 ? 76 : 150, Rm = W < 700 ? 6 : 12;
    const f = (evn.clientX - rect.left - L) / (W - L - Rm);
    if (f < 0 || f > 1) return; jump(Math.min(series.length - 1, Math.floor(f * series.length)));
  }

  /* ---------- rules, monitoring, recent alerts ---------- */
  function renderRules() {
    const live = isLive(), lo = cfg.loLabel, hi = cfg.hiLabel, loW = cfg.loWindLabel || lo, dflt = cfg.windMin === 3 && cfg.windMax === 10;
    const guide = dflt ? ' <b>3 to 10 mph is general guidance, not confirmed for your product.</b> Enter the limits from your label in the settings.' : ' Wind limits were set by you.';
    $('rulesLine').innerHTML = (live
      ? 'Checks running in live model mode: inversion (' + hi + ' air against ' + lo + ' air), wind ' + cfg.windMin + ' to ' + cfg.windMax + ' mph at ' + loW + ', nearby and network model points. <b>Not available without a tower:</b> upper wind limit, speed difference, direction difference.'
      : 'Checks running: inversion alert whenever ' + hi + ' is warmer than ' + lo + '; wind ' + cfg.windMin + ' to ' + cfg.windMax + ' mph at both heights; speed difference ' + cfg.shearSpeed + ' mph; direction difference ' + cfg.shearDir + '°.') + guide + ' <a href="#rulesSec" class="lnk" data-open="rulesSec">See all rules</a>';
    const ON = '<span class="pill GO">ON</span>', OFF = '<span class="pill UNABLE">NOT AVAILABLE</span>', NA = 'Not available in this mode. ', tol = live ? 'tolerance setting' : 'sensor uncertainty';
    const rows = [
      ['Inversion', ON, hi + ' temperature greater than ' + lo + ' temperature', 'STOP. Any positive difference alerts. A difference inside the ±' + cfg.sensorUnc + '°F ' + tol + ' is still shown, with a note.'],
      ['Small temperature difference', ON, hi + ' less than ' + cfg.sensorUnc + '°F cooler than ' + lo, 'CAUTION. The ' + (live ? 'model values' : 'readings') + ' cannot rule out an inversion.'],
      ['Wind above limit', ON, 'Over ' + cfg.windMax + ' mph at ' + (live ? loW + ' (model wind)' : 'either height'), 'STOP. 10 mph is common guidance. The product label controls the real limit.'],
      ['Wind below minimum', ON, 'Under ' + cfg.windMin + ' mph at ' + (live ? loW + ' (model wind)' : 'either height'), 'CAUTION. 3 mph is common guidance. The product label controls the real limit.'],
      ['Upper wind limit', live ? OFF : ON, live ? 'Model wind at 80 m is far above any canopy' : 'Over ' + cfg.windMax + ' or under ' + cfg.windMin + ' mph at ' + hi, live ? NA + 'Needs a sensor just above the canopy.' : 'Same limits as the lower sensor.'],
      ['Speed difference between heights', live ? OFF : ON, live ? 'Needs two sensors on a tower' : cfg.shearSpeed + ' mph or more', (live ? NA : 'CAUTION. ') + 'Configurable prototype threshold, not a sourced limit.'],
      ['Direction difference between heights', live ? OFF : ON, live ? 'Needs two sensors on a tower' : cfg.shearDir + '° or more, shortest way around the compass', (live ? NA : 'CAUTION. ') + 'Configurable prototype threshold. Skipped when wind is under ' + cfg.calmMph + ' mph because calm air has no reliable direction.'],
      ['Sensitive site', cfg.siteOn ? ON : '<span class="pill UNABLE">OFF</span>', cfg.siteOn ? 'Measured wind at either height within ' + cfg.siteCone + '° of the site' : (live ? 'No sensitive site is set for this location' : 'Switched off in settings'), 'A site concern, reported apart from the weather. CAUTION alone. STOP together with any other flag.'],
      ['Community reports', live ? ON : OFF, live ? 'Unverified reports within 3 miles of this location' : 'Demo mode never uses actual community reports', 'A site concern, reported apart from the weather. Reports can only add caution.']];
    if (live) rows.push(['Nearby and network model points', ON, 'An inversion at model points around the site, or in the network estimate, while the site estimate shows none', 'CAUTION. Two estimation methods on the same weather model. A consistency check, not independent field validation.']);
    rows.push(['Missing or invalid ' + (live ? 'value' : 'reading'), ON, 'Any required value absent or impossible', 'UNABLE to assess. Never GO. Missing data is not the same as a confirmed hazard.'],
      ['Stale ' + (live ? 'model data' : 'reading'), ON, 'Older than ' + cfg.staleIntervals + ' sampling intervals (' + cfg.staleIntervals * stepMin + ' minutes at a ' + stepMin + ' minute interval)', 'UNABLE to assess. Never GO.'],
      ['Combining', ON, 'Worst single flag decides', 'Nothing is averaged, so no good reading can cancel a STOP.']);
    $('rulesBox').innerHTML = (live ? '<p class="muted small"><b>Model uncertainty.</b> These are regional model values at 2 m and 80 m for temperature and 10 m for wind, on a grid of several kilometres. They have no sensor accuracy, can miss a shallow inversion in one field, and do not replace measurements in the orchard. The ±' + cfg.sensorUnc + '°F figure is a tolerance setting, not a measured accuracy.</p>'
      : '<p class="muted small"><b>Sensor accuracy.</b> The ±' + cfg.sensorUnc + '°F figure is an assumed accuracy for the simulated sensors.</p>') +
      '<table class="rt"><thead><tr><th>Check</th><th>In this mode</th><th>Active threshold</th><th>Result and purpose</th></tr></thead><tbody>' + rows.map(r => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td>' + r[3] + '</td></tr>').join('') + '</tbody></table>';
  }
  function renderSession() {
    const box = $('sessionBox'), btn = $('sprayBtn'), nowMin = series[idx].min;
    if (session.state === 'idle') { box.className = 'sessionBox'; box.textContent = 'Not spraying. Press start when the rig goes out. Every reading is checked and you are alerted when the weather call changes.'; btn.textContent = 'Start spraying'; btn.className = 'btn primary big'; }
    else if (session.state === 'spraying') { box.className = 'sessionBox on'; box.innerHTML = '<b>Spraying since ' + fmtTime(session.startMin) + '.</b> Every reading is being checked.'; btn.textContent = 'Finish spraying'; btn.className = 'btn danger big'; }
    else { box.className = 'sessionBox watch'; box.innerHTML = '<b>After spray watch.</b> Sprayed ' + fmtTime(session.startMin) + ' to ' + fmtTime(session.endMin) + '. Watching ' + durWords(Math.max(0, session.watchUntil - nowMin)) + ' more for an inversion. <a href="#fileSec" class="lnk" data-open="fileSec">Sign the application record</a>'; btn.textContent = 'End watch'; btn.className = 'btn big'; }
  }
  function toggleSession() {
    const nowMin = series[idx].min, ev = evals[idx];
    if (session.state === 'idle') { session = { state: 'spraying', startMin: nowMin, endMin: null, watchUntil: null }; fileRep = null; renderFile(); addLog('SPRAY START' + (ev.status !== 'GO' ? ' (started on ' + ev.status + ')' : ''));
      if (isLive() && $('optNotify').checked) postReport('spraying', 'Application started'); }
    else if (session.state === 'spraying') { session.state = 'watch'; session.endMin = nowMin; session.watchUntil = nowMin + WATCH_HOURS[cfg.volatility] * 60; addLog('SPRAY END, watch for ' + WATCH_HOURS[cfg.volatility] + ' h'); buildFile(); }
    else { addLog('WATCH ENDED'); session = idle(); }
    renderAll();
  }
  function renderRecent() {
    const ev = log.filter(l => l.event !== 'Reading').slice(0, 5);
    $('recent').innerHTML = ev.length ? ev.map(l => '<li><span class="rt1">' + fmtTime(l.min) + '</span><span class="pill ' + l.status + '">' + l.status + '</span><div><b>' + esc(l.event) + '</b>' + (l.reasons ? '<div class="muted">' + esc(l.reasons) + '</div>' : '') + '</div></li>').join('')
      : '<li class="muted">No alerts yet in this session. Alerts appear here when the weather call changes during playback or monitoring.</li>';
  }

  /* ---------- what, when, how ---------- */
  const HOW_SOURCES = [['University of Arizona Extension, AZ1050', 'https://extension.arizona.edu/sites/extension.arizona.edu/files/pubs/az1050.pdf'], ['Ohio State Extension, FABE 535', 'https://ohioline.osu.edu/factsheet/fabe-535'], ['Montana State Extension', 'https://www.montana.edu/extension/pesticides/reference/drift.html'], ['NDSU Extension, AE1246', 'https://ndsu.edu/agriculture/sites/default/files/2024-10/ae1246.pdf'], ['Health Canada', 'https://www.canada.ca/en/health-canada/services/consumer-product-safety/pesticides-pest-management/growers-commercial-users/drift-mitigation/management-pesticide-spray-drift.html']];
  function renderWWW() {
    const ev = evals[idx], p = PROFILES[cfg.profile || 'custom'];
    $('whatNote').innerHTML = esc(p.note) + ' <b>Rate and amount come from the label and your PCA.</b> This tool does not set them. <a href="#pestSec" class="lnk" data-open="pestSec">Not sure what the pest is? Open the pest guide</a>';
    const tips = ['Read the spray drift section of the label first. It sets wind limits, droplet size, release height and buffers.',
      'Use the coarsest droplets the label allows. Higher pressure makes finer droplets, and finer droplets drift more.',
      'Match the sprayer air to the canopy. Too much air for the foliage sends spray through and above the trees.'];
    if (cfg.volatility === 'high') tips.push('Low drift nozzles reduce droplet drift. They do not reduce vapor drift from a volatile product.');
    let lead = '';
    if (ev.status === 'UNABLE' || ev.weather === 'UNABLE') lead = '<b>A sensor is not reporting.</b> Check or restore it. This is missing data, not a confirmed weather hazard, and it still cannot be a GO.';
    else if (ev.weather === 'STOP') lead = '<b>Changing the setup does not fix a STOP.</b> Wait for the weather.';
    else if (ev.status === 'STOP') lead = '<b>The weather is not the blocker.</b> Resolve the site concern first.';
    else if (ev.triggers.some(t => t.code === 'SITE_DOWNWIND')) lead = '<b>Measured wind points toward the ' + esc(cfg.siteName) + '.</b> Buffers there are set by the label.';
    $('howBox').innerHTML = (lead ? '<div>' + lead + '</div>' : '') + '<ul>' + tips.map(t => '<li>' + t + '</li>').join('') + '</ul><div class="wsrc">General practice from ' + HOW_SOURCES.map(s => '<a href="' + s[1] + '" target="_blank" rel="noopener">' + s[0] + '</a>').join(', ') + '. The label and your PCA decide for your product.</div>';
  }

  /* ---------- neighbor view: a notice for people next to the block, not a drift map ---------- */
  function renderNeighbor() {
    const side = +$('nbrSide').value, r = reading(idx), ev = evals[idx], spraying = session.state === 'spraying';
    const dirLine = (w, d, label) => {
      if (!num(w)) return ['No valid wind reading at ' + label + '.', null];
      if (w < cfg.calmMph || !num(d)) return ['Wind at ' + label + ' is near calm. Direction is not reliable.', null];
      const toward = E.angDiff((d + 180) % 360, side) <= cfg.siteCone;
      return ['Measured wind at ' + label + ' (' + f1(w) + ' mph from the ' + E.compass(d) + ') points ' + (toward ? 'toward' : 'away from') + ' your side.', toward];
    };
    const lo = dirLine(r.wLo, r.dLo, cfg.loLabel), hi = dirLine(r.wHi, r.dHi, cfg.hiLabel), toward = lo[1] === true || hi[1] === true, unknown = lo[1] === null && hi[1] === null;
    let tag, cls, head;
    if (spraying && toward) { tag = 'HEADS UP'; cls = 'STOP'; head = 'An application is in progress at this block and measured wind points toward your side.'; }
    else if (spraying && unknown) { tag = 'HEADS UP'; cls = 'CAUTION'; head = 'An application is in progress at this block. Wind direction cannot be read right now.'; }
    else if (spraying) { tag = 'IN PROGRESS'; cls = 'CAUTION'; head = 'An application is in progress at this block. Measured wind points away from your side.'; }
    else { tag = 'NO APPLICATION'; cls = 'GO'; head = 'No application is in progress at this block' + (session.state === 'watch' ? '. The last one ran ' + fmtTime(session.startMin) + ' to ' + fmtTime(session.endMin) + '.' : '.'); }
    const near = community.filter(c => c.kind === 'spraying' && c.distMi <= 3).length;
    $('nbrBox').innerHTML = '<div class="nbrHead"><span class="pill ' + cls + '">' + tag + '</span><b>' + esc(head) + '</b></div><ul class="recent">' +
      '<li><span class="rt1">' + fmtTime(series[idx].min) + '</span><div>' + esc(lo[0]) + '</div></li><li><span class="rt1"></span><div>' + esc(hi[0]) + '</div></li>' +
      '<li><span class="rt1"></span><div>Weather call at the tower: <span class="pill ' + ev.status + '">' + ev.status + '</span> ' + esc(ev.triggers[0] ? ev.triggers[0].title : ev.problems[0] ? ev.problems[0].text : 'all measured checks pass') + '</div></li>' +
      '<li><span class="rt1"></span><div>Applications reported within 3 miles in the last 8 hours: ' + near + ' actual report' + (near === 1 ? '' : 's') + '.</div></li></ul>';
  }

  /* ---------- record ---------- */
  function addLog(event) {
    const r = reading(idx), ev = evals[idx];
    log.unshift({ min: series[idx].min, measTs: measIso(series[idx].min), eventTs: new Date().toISOString(), event: event || 'Reading', status: ev.status, ground: ev.ground.status,
      job: jobNow().state, weather: ev.weather, concerns: ev.concerns.map(c => c.title).join('; '), mode: source.kind === 'sim' ? 'demo' : source.kind, location: locName(), feed: isLive() ? (netOnline === false ? 'unavailable' : feedLoc === 'live' ? 'checked' : 'loading') : 'not used', r: r, dT: ev.dT, shearSpd: ev.shearSpd, shearDir: ev.shearDir,
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
      'wind_min_mph', 'wind_max_mph', 'speed_shear_threshold_mph', 'dir_shear_threshold_deg', 'sensor_uncertainty_f', 'job_hours', 'product_type', 'volatility', 'sensitive_site', 'overall_decision', 'site_concerns', 'mode', 'location', 'community_feed'];
    const rows = [head.join(',')];
    log.slice().reverse().forEach(l => rows.push([csvq(l.measTs), csvq(TZ.name), csvq(l.eventTs), csvq(l.event), csvq(l.source), l.mode === 'demo' ? 'true' : 'false', n(l.ageMin), l.mode === 'live' ? 6.6 : 5, l.mode === 'live' ? 262 : 30, n(l.r.tLo), n(l.r.tHi), n(l.dT),
      n(l.r.wLo), n(l.r.wHi), num(l.r.dLo) ? Math.round(l.r.dLo) : '', num(l.r.dHi) ? Math.round(l.r.dHi) : '', n(l.shearSpd), num(l.shearDir) ? Math.round(l.shearDir) : '', l.weather, l.ground, l.job, csvq(l.reasons),
      l.th.windMin, l.th.windMax, l.th.shearSpeed, l.th.shearDir, l.th.sensorUnc, l.jobHours, csvq(l.product), csvq(l.vol), csvq(l.site), l.status, csvq(l.concerns), l.mode, csvq(l.location), l.feed].join(',')));
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
  function renderAll() { renderStatus(); renderJob(); renderTower(); renderCompass(); renderTimeline(); renderSession(); renderNeighbor(); renderWWW(); renderKrig(); }
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
    $('whatSel').value = cfg.profile || 'custom'; $('cfgProf').value = cfg.profile || 'custom'; $('profNote').textContent = PROFILES[cfg.profile || 'custom'].note;
    $('cfgVol').value = cfg.volatility; $('cfgMin').value = cfg.windMin; $('cfgMax').value = cfg.windMax; $('cfgJob').value = cfg.jobHours;
    $('cfgSiteOn').value = cfg.siteOn ? '1' : '0'; $('cfgSiteName').value = cfg.siteName; $('cfgSiteDir').value = String(cfg.siteBearing);
    $('cfgShS').value = cfg.shearSpeed; $('cfgShD').value = cfg.shearDir; $('cfgCost').value = cfg.jobCost || '';
  }
  function readForm() {
    const c = Object.assign({}, cfg), val = id => { const s = $(id).value.trim(); return s === '' ? NaN : Number(s); };
    const pk = $('cfgProf').value, pr = PROFILES[pk];
    if (pk !== cfg.profile && pr.vol) $('cfgVol').value = pr.vol; else if (pr.vol && $('cfgVol').value !== pr.vol) $('cfgProf').value = 'custom';
    const pk2 = $('cfgProf').value, pr2 = PROFILES[pk2];
    c.profile = pk2; c.heatLimit = pr2.heat; c.heatText = pr2.text; c.productName = pk2 === 'custom' ? '' : pr2.name.toLowerCase(); c.volatility = $('cfgVol').value;
    c.windMin = val('cfgMin'); c.windMax = val('cfgMax'); c.jobHours = val('cfgJob'); c.shearSpeed = val('cfgShS'); c.shearDir = val('cfgShD');
    c.siteOn = $('cfgSiteOn').value === '1'; c.siteName = $('cfgSiteName').value.trim() || 'sensitive site'; c.siteBearing = +$('cfgSiteDir').value;
    const cost = $('cfgCost').value.trim() === '' ? 0 : Number($('cfgCost').value); c.jobCost = cost;
    const errs = E.validateCfg(c), box = $('cfgErr'); if (!num0(cost)) errs.push('Product cost must be 0 or more.');
    if (errs.length) { box.hidden = false; box.textContent = 'Not applied. ' + errs.join(' ') + ' The previous settings are still active.'; fillForm(); return false; }
    box.hidden = true; cfg = c; $('whatSel').value = cfg.profile; $('profNote').textContent = pr2.note; saveCfg(); applyChange('SETTINGS CHANGED'); if (fcState) renderForecast(); return true;
  }
  function applyChange(evt) { recompute(); setNow(); lastStatus = evals[idx].status; renderRules(); addLog(evt); renderAll(); }
  function renderSource() {
    $('srcTag').textContent = sourceName();
    $('blockName').textContent = isLive() ? FARM.name + ', ' + FARM.place + ' (example location)' : BLOCK_SIM;
    $('modeSim').classList.toggle('on', !isLive()); $('modeLive').classList.toggle('on', isLive());
    $('scen').hidden = isLive(); $('liveNow').hidden = !isLive(); $('demoReset').hidden = isLive();
    $('liveNote').hidden = !isLive();
    document.querySelector('.gtitle').textContent = isLive() ? 'Ground only comparison: model wind near the ground' : 'Ground station comparison: wind at 5 ft only';
    if (isLive()) $('liveNote').innerHTML = '<span class="srcTag">Live regional model</span> Real weather model values for the ' + FARM.name + ' ' + FARM.place + ', fetched ' + source.fetched.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + ' and refreshed every 10 minutes. Temperature at 2 m and 80 m, wind at 10 m and 80 m (Open-Meteo). ' + (livePts > 1 ? 'The site value is an inverse distance weighted estimate from ' + livePts + ' model points within ' + RING_KM + ' km, and the tool warns when those points disagree about an inversion.' + (liveNet ? ' A second model kriges ' + liveNet + ' network points across 40 km and is compared with the farm model below.' : '') : '') + ' <b>No tower is installed at the farm.</b> A regional model does not resolve one field, so treat this as the best available estimate until a two height tower is on site. Hours after now are forecast.';
    $('srcLabel').textContent = source.kind === 'sim' ? 'Sensors at 5 ft and 30 ft, one reading every ' + stepMin + ' minutes. Not live.'
      : isLive() ? 'Open-Meteo model for the area, hourly. Not a measurement at the farm.'
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
    if (playing) togglePlay(); clearInterval(liveTimer); reqId++; community = []; netLocal = []; feedLoc = null; cfg.loLabel = E.DEFAULT_CFG.loLabel; cfg.hiLabel = E.DEFAULT_CFG.hiLabel; delete cfg.loWindLabel; delete cfg.uncLabel; cfg.skipHiWind = false; cfg.skipShearSpeed = false;
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
  const KIND = { inversion: ['Air not moving', '#b3261e'], drift: ['Drift seen', '#b96a00'], crew: ['Crew in field', '#6d28d9'], spraying: ['Application nearby', '#0b6e99'] };
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
    const my = reqId, mode = source.kind; let rows = null;
    try { rows = await fetchReports(); } catch (e) {}
    if (my !== reqId || mode !== source.kind) return;           // a switch happened while this was loading
    if (rows) { netRows = rows; netOnline = true; feedLoc = isLive() ? 'live' : 'demo'; const ids = new Set(netRows.map(r => r.id)); netLocal = netLocal.filter(r => !ids.has(r.id)); }
    else { netOnline = false; if (isLive()) feedLoc = null; }
    applyNetwork(announce);
  }
  async function postReport(kind, note) {
    if (!isLive()) { addLog('COMMUNITY REPORT NOT SENT (demo mode never sends reports)'); return false; }
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
    $('heatState').innerHTML = '<span class="srcTag light">Sample community reports</span> drawn as shading so the map is not empty. <span class="srcTag light">Actual community reports</span> ' + real.length + ' nearby, drawn as solid dots. ' + (netOnline === false ? '<b>Community feed unavailable.</b> This is not the same as zero reports. ' : '') + (isLive() ? 'Actual reports count as site concerns for this location. They never change the weather result.' : '<b>Demo mode: actual reports are shown here but never change the demo decision, and nothing you tap is sent.</b>');
    const using = new Set(evals[idx].triggers.filter(t => /^NET_/.test(t.code)).map(t => ({ NET_INVERSION: 'inversion', NET_DRIFT: 'drift', NET_CREW: 'crew' }[t.code])));
    $('netFeed').innerHTML = community.slice(0, 10).map(c => '<li><span class="dot" style="background:' + KIND[c.kind][1] + '"></span><div><b>' + KIND[c.kind][0] + '</b> ' + (c.distMi < 0.15 ? 'at this block' : f1(c.distMi) + ' mi ' + E.compass(c.bearing)) + ', ' + (c.ageMin < 1 ? 'just now' : c.ageMin < 60 ? Math.round(c.ageMin) + ' min ago' : f1(c.ageMin / 60) + ' h ago') + (c.local ? ' (this device only)' : '') + (using.has(c.kind) ? ' <span class="used">affecting the call</span>' : '') + '</div></li>').join('') || '<li class="muted">No actual reports within 5 miles in the last 8 hours.</li>';
  }

  /* ---------- application record and signature ---------- */
  function loadSaved() { try { return JSON.parse(localStorage.getItem('sow_records') || '[]'); } catch (e) { return []; } }
  function buildFile() {
    const iS = idxAt(session.startMin), iE = idxAt(session.endMin), b = wxEvals();
    let worst = 'GO'; for (let i = iS; i <= iE; i++) if (E.RANK[b[i].status] > E.RANK[worst]) worst = b[i].status;
    fileRep = { start: session.startMin, end: session.endMin, rs: reading(iS), re: reading(iE), worst: worst, source: sourceName(),
      alerts: log.filter(l => l.min >= session.startMin && l.min <= session.endMin && /^ALERT/.test(l.event)).length, product: cfg.profile && cfg.profile !== 'custom' ? PROFILES[cfg.profile].name : 'Not set', saved: null };
    renderFile();
  }
  function fileRows(f) {
    const w = r => v1(r.wLo) + ' mph from ' + (num(r.dLo) ? E.compass(r.dLo) : 'n/a') + ' at 5 ft, ' + v1(r.wHi) + ' mph from ' + (num(r.dHi) ? E.compass(r.dHi) : 'n/a') + ' at 30 ft';
    return [['Block', $('blockName').textContent], ['Date applied', dayDate(f.start) + ' (' + TZ.name + ')'], ['Time of application', fmtTime(f.start) + ' to ' + fmtTime(f.end)],
      ['Wind at start', w(f.rs)], ['Wind at finish', w(f.re)], ['Temperature at start', v1(f.rs.tLo) + '°F at 5 ft, ' + v1(f.rs.tHi) + '°F at 30 ft'],
      ['Product type', f.product], ['Weather call during the job', f.worst + (f.alerts ? ', ' + f.alerts + ' alert' + (f.alerts > 1 ? 's' : '') : ', no alerts')], ['Data source', f.source + (source.kind === 'sim' ? ' (demonstration data)' : isLive() ? ' (Open-Meteo, not measured at the site)' : '')]];
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
      h += '<div class="muted small">' + (s.shared ? 'The conditions, with no name and no signature, were sent to the shared community database.' : 'Nothing was sent to the shared community database.') + ' Nothing was sent to the Arizona Department of Agriculture. This covers the timing and weather part of Form 1080 and is not the official form.</div>';
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
      s.shared = (isLive() && $('optNotify').checked) ? await postReport('spraying', 'Application recorded. Weather call during job: ' + fileRep.worst) : false;
      const rec = { ref: s.ref, date: dateStr(), time: fmtTime(fileRep.start) + ' to ' + fmtTime(fileRep.end), signer: s.signer, signedAt: s.signedAt, call: 'Weather call during the job: ' + fileRep.worst, fields: fileRows(fileRep), sig: s.sig, demo: source.kind === 'sim', source: fileRep.source, shared: s.shared };
      // Save, then read it back. Only say it is saved if the read back matches.
      try { const all = loadSaved(); all.unshift(rec); localStorage.setItem('sow_records', JSON.stringify(all.slice(0, 50))); s.stored = loadSaved().some(r => r.ref === s.ref); } catch (e) { s.stored = false; }
      fileRep.saved = s; addLog('APPLICATION RECORD SIGNED ' + s.ref + (s.stored ? ', saved in this browser' : ', NOT stored')); renderFile(); };
  }

  /* ---------- pest guide ---------- */
  /* ---------- crop, pest and chemical reference ---------- */
  const PESTS = window.SprayPests, CROPS = window.SprayCrops, CHEMS = window.SprayChems;
  const chemById = id => CHEMS.find(c => c.id === id);
  const cropPests = () => PESTS.filter(p => p.crops.indexOf($('cropSel').value) >= 0);
  function setCrop() {
    const list = cropPests(), opts = list.map(p => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('');
    $('pestPick').innerHTML = '<option value="">' + (list.length ? 'Not sure yet' : 'No entries yet') + '</option>' + opts;
    $('pestSel').innerHTML = opts || '<option value="">No entries yet</option>';
    $('pestCropTxt').textContent = 'Crop: ' + CROPS.find(c => c.id === $('cropSel').value).name + '. Change the crop in the What box at the top.';
    try { localStorage.setItem('sow_crop', $('cropSel').value); } catch (e) {}
    renderPest(); renderChemBox();
  }
  function useChem(c) { $('cfgProf').value = c.profile; if (readForm()) $('chemBox').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.chem === c.id)); }
  function renderChemBox() {
    const p = PESTS.find(x => x.id === $('pestPick').value), box = $('chemBox'), crop = CROPS.find(c => c.id === $('cropSel').value);
    if (!p) { box.innerHTML = cropPests().length ? '' : '<span class="muted small">No University of Arizona sourced entries for ' + esc(crop.name.toLowerCase()) + ' in this database yet. Ask your PCA, or see <a href="' + crop.more[1] + '" target="_blank" rel="noopener">' + esc(crop.more[0]) + '</a>.</span>'; return; }
    const cs = p.chems.map(chemById);
    box.innerHTML = (cs.length ? '<div class="muted small">Listed by UA Extension for this pest. Tap the one on your PCA recommendation:</div>' + cs.map(c => '<button type="button" class="chem" data-chem="' + c.id + '">' + esc(c.name) + (c.organic ? ' <i>organic</i>' : '') + '</button>').join('')
      : '<span class="muted small">Product choice for this pest is for your PCA.</span>') + ' <a href="#pestSec" class="lnk" data-open="pestSec">Scouting and source</a>';
    box.querySelectorAll('button').forEach(b => { b.onclick = () => useChem(chemById(b.dataset.chem)); });
  }
  function renderPest() {
    const p = PESTS.find(x => x.id === $('pestSel').value);
    if (!p) { const crop = CROPS.find(c => c.id === $('cropSel').value); $('pestBox').innerHTML = '<div>No University of Arizona sourced entries for ' + esc(crop.name.toLowerCase()) + ' in this database yet.' + (crop.more ? ' See <a href="' + crop.more[1] + '" target="_blank" rel="noopener">' + esc(crop.more[0]) + '</a>.' : '') + '</div>'; return; }
    const row = (t, v) => '<div class="pr"><div class="pk">' + t + '</div><div>' + v + '</div></div>';
    $('pestBox').innerHTML = '<div>' + row('Why it matters', esc(p.why)) + row('When', esc(p.when)) + row('Scout first', esc(p.scout)) + '</div><div>' +
      row('Options Extension lists', '<ul>' + p.options.map(o => '<li>' + esc(o) + '</li>').join('') + '</ul>') + row('Help the crop defend itself', esc(p.defend)) +
      row('Source', '<a href="' + p.src[1] + '" target="_blank" rel="noopener">' + esc(p.src[0]) + '</a>') +
      (p.profile !== 'custom' ? '<div class="row"><button id="pestUse" class="btn">Use the ' + PROFILES[p.profile].name.toLowerCase() + ' spray profile</button></div>' : '') + '</div>';
    const b = $('pestUse'); if (b) b.onclick = () => { $('cfgProf').value = p.profile; readForm(); };
  }
  function renderChemTable() {   // aggregate: every pest and crop in the database that lists each chemical
    const cropName = id => CROPS.find(c => c.id === id).name.toLowerCase();
    $('chemT').innerHTML = '<thead><tr><th>Active ingredient</th><th>Group</th><th>Organic</th><th>Selectivity (UA)</th><th>Weather profile here</th><th>Listed in this database for</th></tr></thead><tbody>' +
      CHEMS.map(c => { const use = PESTS.filter(p => p.chems.indexOf(c.id) >= 0);
        const crops = Array.from(new Set([].concat.apply([], use.map(p => p.crops)))).map(cropName);
        return '<tr><td><b>' + esc(c.name) + '</b><div class="muted small">' + esc(c.brand) + '</div></td><td>' + esc(c.group) + '</td><td>' + (c.organic ? 'Organic formulations exist' : 'No') + '</td><td>' + esc(c.sel || 'Not rated here') + '</td><td>' + esc(PROFILES[c.profile].name) + '</td><td>' +
          (use.length ? use.length + (use.length > 1 ? ' pests' : ' pest') + ' on ' + esc(crops.join(', ')) + '<div class="muted small">' + esc(use.map(p => p.name.split(':')[0]).join('; ')) + '</div>' : (c.note ? esc(c.note) + ' <a href="' + c.src + '" target="_blank" rel="noopener">UA source</a>' : 'None yet')) + '</td></tr>'; }).join('') + '</tbody>';
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

  /* ---------- live mode: real model weather for a real location ---------- */
  let liveTimer = null, followNow = true, simSite = true, livePts = 1, liveNet = 0;
  const SP = window.SpraySpatial;
  function renderKrig() {
    const box = $('krigBox'), s = series[idx], kr = isLive() && s.near && s.near.net; $('modelSec').hidden = !kr; if (!kr) { box.innerHTML = ''; return; }
    const r = s.r, idwDT = r.tHi - r.tLo, words = d => Math.abs(d) < 0.05 ? 'no difference between heights' : f1(Math.abs(d)) + '°F ' + (d > 0 ? 'warmer' : 'cooler') + ' aloft';
    const agree = (kr.v > 0) === (idwDT > 0), gap = Math.abs(kr.v - idwDT);
    box.innerHTML = '<div class="kg"><div><span>Farm estimate, IDW</span><b>' + words(idwDT) + '</b><i>' + livePts + ' model points within ' + RING_KM + ' km</i></div>' +
      '<div><span>Network estimate, kriging</span><b>' + words(kr.v) + '</b><i>' + kr.n + ' model points across 40 km</i></div>' +
      '<div><span>Compare</span><b class="' + (agree ? 'kok' : 'kbad') + '">' + (agree ? 'Estimates agree' : 'Estimates disagree') + '</b><i>' + f1(gap) + '°F apart' + (agree ? '' : '. The stricter one decides') + '</i></div></div>' +
      '<div class="muted small">' + (agree ? 'Two spatial estimation methods agree. ' : 'Two spatial estimation methods disagree. ') + 'This is a consistency check, not independent field validation: both use points from the same regional weather model. ' +
      'Kriging interpolation spread at this spot: ' + f1(kr.sd) + '°F. That number comes from the fitted variogram and says how much the model points vary with distance. It is not a measured or validated accuracy at the farm. ' +
      'Demo network: model points stand in for member farm towers, which do not exist yet.</div>';
  }
  function nowIdx() { if (!isLive()) return idx; const d = new Date(), m = d.getHours() * 60; let best = 0; series.forEach((s, i) => { if (s.min <= m) best = i; }); return best; }
  const RING_KM = 5;
  function livePoints() {   // the site plus four points 5 km north, east, south and west
    const dLat = RING_KM / 111.2, dLon = RING_KM / (111.2 * Math.cos(FARM.lat * Math.PI / 180)), r4 = v => Math.round(v * 1e4) / 1e4;
    const local = [[0, 0], [dLat, 0], [0, dLon], [-dLat, 0], [0, -dLon]].map(o => ({ lat: r4(FARM.lat + o[0]), lon: r4(FARM.lon + o[1]) }));
    /* Stand in for the company network: a 5 by 5 grid of model points 10 km apart, without the farm's own point. No member farm has a tower yet. */
    const net = [];
    for (let i = -2; i <= 2; i++) for (let k = -2; k <= 2; k++) if (i || k) net.push({ lat: r4(FARM.lat + i * 2 * dLat), lon: r4(FARM.lon + k * 2 * dLon), net: true });
    return local.concat(net);
  }
  async function fetchLive() {
    const P = livePoints();
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + P.map(p => p.lat).join(',') + '&longitude=' + P.map(p => p.lon).join(',') +
      '&hourly=temperature_2m,temperature_80m,wind_speed_10m,wind_speed_80m,wind_direction_10m,wind_direction_80m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FPhoenix&forecast_days=2';
    const res = await fetch(url); if (!res.ok) throw new Error('HTTP ' + res.status);
    let j = await res.json(); if (!Array.isArray(j)) j = [j];
    const good = j.map((x, k) => ({ p: P[k], hh: x && x.hourly })).filter(x => x.p && x.hh && x.hh.time && x.hh.time.length >= 24);
    if (!good.length) throw new Error('unexpected response');
    const T0 = good[0].hh.time, d0 = T0[0].slice(0, 10), nn = v => (typeof v === 'number' && isFinite(v)) ? v : null;
    livePts = good.filter(g => !g.p.net).length; liveNet = good.filter(g => g.p.net).length;
    return T0.map((t, i) => {
      const all = good.map(g => ({ net: !!g.p.net, lat: g.p.lat, lon: g.p.lon, r: { tLo: nn(g.hh.temperature_2m[i]), tHi: nn(g.hh.temperature_80m[i]), wLo: nn(g.hh.wind_speed_10m[i]), wHi: nn(g.hh.wind_speed_80m[i]), dLo: nn(g.hh.wind_direction_10m[i]), dHi: nn(g.hh.wind_direction_80m[i]) } }));
      const pts = all.filter(p => !p.net), netPts = all.filter(p => p.net).map(p => ({ lat: p.lat, lon: p.lon, v: (p.r.tLo != null && p.r.tHi != null) ? p.r.tHi - p.r.tLo : null }));
      const c = SP.inversionCount(pts), kr = netPts.length >= 8 ? SP.krige(netPts, FARM) : null;
      return { min: (t.slice(0, 10) === d0 ? 0 : 1440) + (+t.slice(11, 13)) * 60, ageMin: 0, r: SP.idwReading(pts, FARM), near: pts.length > 1 || kr ? { inv: pts.length > 1 ? c.inv : 0, of: c.of, km: RING_KM, net: kr } : null };
    }).slice(0, 48);
  }
  async function fetchReports() {
    const res = await fetch(SB + 'reports?select=id,created_at,kind,lat,lon,note&order=created_at.desc&limit=200', { headers: SBH });
    if (!res.ok) throw new Error('HTTP ' + res.status); return res.json();
  }
  const liveBtn = on => { const b = $('modeLive'); b.disabled = on; b.textContent = on ? 'Loading live data…' : 'Live: ' + FARM.name; };
  /* Every load carries a request number. A reply is used only if no switch has happened since it was asked for,
     and nothing is evaluated or logged until the weather and the community feed for the new location are both in. */
  async function goLive() {
    const my = ++reqId; liveBtn(true);
    const got = await Promise.allSettled([fetchLive(), fetchReports()]);
    if (my !== reqId) return;                                   // the user switched again: this reply is stale
    liveBtn(false);
    if (got[0].status !== 'fulfilled') { showAlert('CAUTION', 'Live data could not be loaded', 'The weather service did not answer, so nothing changed. You are still on the simulated demo day.'); return; }
    if (playing) togglePlay();
    community = []; netLocal = []; netRows = []; feedLoc = null;   // nothing from the previous location carries over
    series = got[0].value; stepMin = 60; source = { kind: 'live', fetched: new Date(), req: my }; dropHi = false; $('optDropHi').checked = false;
    cfg.loLabel = '2 m'; cfg.hiLabel = '80 m (about 260 ft)'; cfg.loWindLabel = '10 m'; cfg.uncLabel = 'tolerance setting'; cfg.skipHiWind = true; cfg.skipShearSpeed = true;
    simSite = cfg.siteOn; cfg.siteOn = false; fillForm();   // the demo school is invented, so it is not shown next to a real place
    $('lat').value = FARM.lat; $('lon').value = FARM.lon;
    if (got[1].status === 'fulfilled') { netRows = got[1].value; netOnline = true; feedLoc = 'live'; } else { netOnline = false; }
    buildCommunity();
    session = idle(); fileRep = null; log = []; followNow = true; idx = nowIdx(); $('alertBar').hidden = true;
    renderSource(); recompute(); setNow(); lastStatus = evals[idx].status; renderRules();
    addLog('LIVE MODEL DATA LOADED' + (netOnline ? '' : ' (community feed unavailable)')); renderAll(); renderFile(); renderNetwork();
    clearInterval(liveTimer); liveTimer = setInterval(refreshLive, 600000);
  }
  async function refreshLive() {
    if (!isLive()) return; const my = reqId; let s = null;
    try { s = await fetchLive(); } catch (e) {}
    if (my !== reqId || !isLive()) return;
    if (s) { series = s; source.fetched = new Date(); }
    else { const age = (Date.now() - source.fetched.getTime()) / 60000; series.forEach(x => { x.ageMin = age; }); }   // a failed refresh ages the data until it goes stale
    if (followNow) idx = nowIdx(); idx = Math.min(idx, series.length - 1);
    renderSource(); recompute(); setNow(); checkAlert(); renderAll();
  }
  function goSim() {
    reqId++; liveBtn(false);                                    // cancels any live load still in flight
    if (!isLive()) return; clearInterval(liveTimer); if (playing) togglePlay();
    community = []; netLocal = []; feedLoc = null;
    series = simSeries(); stepMin = S.STEP_MIN; source = { kind: 'sim' };
    cfg.loLabel = E.DEFAULT_CFG.loLabel; cfg.hiLabel = E.DEFAULT_CFG.hiLabel; delete cfg.loWindLabel; delete cfg.uncLabel; cfg.skipHiWind = false; cfg.skipShearSpeed = false; cfg.siteOn = simSite; fillForm();
    $('lat').value = 32.69; $('lon').value = -114.62;
    renderSource(); recompute(); renderRules(); resetDemo(); pullNetwork(false);
  }
  window.__sowRefresh = refreshLive;

  /* ---------- wire up ---------- */
  function openSec(id) { const d = $(id); if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }
  function init() {
    $('build').textContent = 'Build ' + BUILD + '.';
    fillForm(); renderSource(); recompute(); setNow(); lastStatus = evals[idx].status; renderRules(); addLog('Reading'); renderAll(); renderFile();
    $('play').onclick = () => { stopAt = null; togglePlay(); };
    $('speed').onchange = () => { if (playing) { clearInterval(timer); timer = setInterval(stepOnce, +$('speed').value); } };
    $('demoReset').onclick = resetDemo;
    $('modeLive').onclick = () => { if (!isLive()) goLive(); }; $('modeSim').onclick = goSim;
    $('liveNow').onclick = () => { followNow = true; jump(nowIdx()); };
    document.querySelectorAll('.jump').forEach(b => b.onclick = () => { if (playing) togglePlay(); jump(idxAt(+b.dataset.min));
      if (b.dataset.play) { stopAt = b.dataset.play; $('speed').value = '1000'; togglePlay(); } });
    let drag = false; const tl = $('tl');
    tl.addEventListener('pointerdown', e => { drag = true; followNow = false; if (playing) togglePlay(); tlPick(e); });
    window.addEventListener('pointermove', e => { if (drag) tlPick(e); });
    window.addEventListener('pointerup', () => { drag = false; });
    window.addEventListener('resize', renderTimeline);
    ['cfgProf', 'cfgVol', 'cfgMin', 'cfgMax', 'cfgJob', 'cfgSiteOn', 'cfgSiteName', 'cfgSiteDir', 'cfgShS', 'cfgShD', 'cfgCost'].forEach(id => $(id).addEventListener('change', readForm));
    $('nbrSide').onchange = renderNeighbor;
    $('whatSel').innerHTML = $('cfgProf').innerHTML; $('whatSel').value = cfg.profile || 'custom'; $('whatSel').onchange = () => { $('cfgProf').value = $('whatSel').value; readForm(); };
    $('optDropHi').onchange = () => { dropHi = $('optDropHi').checked; applyChange(dropHi ? 'TEST: 30 ft sensor disconnected' : 'TEST ENDED: 30 ft sensor reconnected'); };
    $('sprayBtn').onclick = toggleSession;
    $('noteBtn').onclick = () => { const v = $('noteIn').value.trim(); if (v) { addLog('NOTE: ' + v); $('noteIn').value = ''; } };
    $('noteIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('noteBtn').click(); });
    $('logAlerts').onchange = renderLog;
    $('logCsv').onclick = () => download('spray_or_wait_record_' + dateStr() + '.csv', logCsv());
    $('optPush').onchange = () => { if ($('optPush').checked && 'Notification' in window && Notification.permission !== 'granted') { try { Notification.requestPermission(); } catch (e) {} } };
    $('csvSample').onclick = sampleCsv;
    $('csvIn').onchange = e => { const f = e.target.files[0]; if (!f) return; const fr = new FileReader(); fr.onload = () => loadCsv(String(fr.result), f.name); fr.readAsText(f); e.target.value = ''; };
    $('resetBtn').onclick = () => { if (playing) togglePlay(); clearInterval(liveTimer); reqId++; liveBtn(false); community = []; netLocal = []; feedLoc = null; cfg = Object.assign({ jobCost: 0 }, E.DEFAULT_CFG); saveCfg(); series = simSeries(); stepMin = S.STEP_MIN; source = { kind: 'sim' }; dropHi = false; $('optDropHi').checked = false; $('cfgErr').hidden = true;
      $('lat').value = 32.69; $('lon').value = -114.62; fillForm(); renderSource(); recompute(); renderRules(); resetDemo(); if (fcState) renderForecast(); };
    $('fcBtn').onclick = loadForecast;
    $('fcSec').addEventListener('toggle', () => { if ($('fcSec').open && !fcState) loadForecast(); });
    document.addEventListener('click', e => { const a = e.target.closest('[data-open],#openRecord'); if (!a) return; e.preventDefault(); openSec(a.dataset.open || 'recordSec'); });
    document.querySelectorAll('.qbtn').forEach(b => b.onclick = async () => { b.disabled = true; const ok = await postReport(b.dataset.kind, null); b.disabled = false;
      $('quickMsg').textContent = !isLive() ? 'Demo mode. Nothing was sent. Reports are only sent from live mode.' : ok ? 'Sent to the shared database.' : 'Could not reach the shared database. Kept on this device only.'; });
    ['lat', 'lon'].forEach(id => $(id).addEventListener('change', () => applyNetwork(false)));
    $('cropSel').innerHTML = CROPS.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
    try { const sc = localStorage.getItem('sow_crop'); if (sc && CROPS.find(c => c.id === sc)) $('cropSel').value = sc; } catch (e) {}
    $('cropSel').onchange = setCrop;
    $('pestPick').onchange = () => { if ($('pestPick').value) { $('pestSel').value = $('pestPick').value; renderPest(); } renderChemBox(); };
    $('pestSel').onchange = () => { $('pestPick').value = $('pestSel').value; renderPest(); renderChemBox(); };
    setCrop(); renderChemTable();
    $('wlBtn').onclick = joinWaitlist; renderQr();
    renderNetwork(); pullNetwork(false); setInterval(() => pullNetwork(true), 8000);
    window.__sow = { state: () => ({ idx: idx, time: fmtTime(series[idx].min), status: evals[idx].status, weather: evals[idx].weather, concerns: evals[idx].concerns.length, feed: netOnline, used: usedCommunity().length, ground: evals[idx].ground.status, logLen: log.length, playing: playing, source: source.kind, n: series.length, step: stepMin }) };
  }
  init();
})();
