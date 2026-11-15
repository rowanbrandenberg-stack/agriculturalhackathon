/* Spray or Wait: decision engine.
   Pure functions, no DOM. Runs in the browser and in Node (tests/engine.test.js).

   Rules, in plain words:
   1. Inversion: upper temperature greater than lower temperature is ALWAYS an inversion alert (STOP).
      A positive difference inside the sensor uncertainty is still shown, with a note. It is never ignored.
   2. Wind: flag below windMin or above windMax at EITHER height. 3 and 10 mph are common guidance.
      The product label controls the real limits, so both are settings.
   3. Shear: flag a large speed or direction difference between heights. These two thresholds are
      configurable prototype values, not sourced limits.
   4. Direction is not trusted when wind is effectively calm.
   5. Missing, invalid or stale required readings can never produce GO. They produce UNABLE
      (unable to assess), unless a valid reading already confirms a STOP.
   6. Status is the worst single trigger. Nothing is averaged, so nothing can cancel a STOP. */
(function (root) {
  const DEFAULT_CFG = {
    windMin: 3, windMax: 10,       // mph, common guidance; label controls
    shearSpeed: 5,                 // mph, prototype threshold
    shearDir: 45,                  // degrees, prototype threshold
    sensorUnc: 0.5,                // deg F, stated uncertainty of the temperature difference
    calmMph: 1,                    // below this, wind direction is treated as unreliable
    staleIntervals: 2,             // a reading older than this many sampling intervals is stale
    volatility: 'low', hotF: 85, heatLimit: null, heatText: '', productName: '', profile: 'custom',
    siteOn: true, siteName: 'school', siteBearing: 90, siteCone: 45,
    jobHours: 2,
    loLabel: '5 ft', hiLabel: '30 ft',
    skipHiWind: false, skipShearSpeed: false   // used only for the regional model forecast
  };

  const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  function compass(d) { return COMPASS[Math.round((((d % 360) + 360) % 360) / 22.5) % 16]; }
  /* Shortest circular angle: 359 vs 1 is 2 degrees. */
  function angDiff(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
  function f1(x) { return (Math.round(x * 10) / 10).toFixed(1); }
  const isNum = x => typeof x === 'number' && isFinite(x);
  const okTemp = t => isNum(t) && t >= -60 && t <= 140;
  const okWind = w => isNum(w) && w >= 0 && w <= 150;
  const okDir = d => isNum(d) && d >= 0 && d <= 360;
  const RANK = { GO: 0, CAUTION: 1, UNABLE: 1.5, STOP: 2 };
  const NAMES = ['GO', 'CAUTION', 'STOP'];

  function validateCfg(c) {
    const e = [];
    if (!isNum(c.windMin) || c.windMin < 0) e.push('Wind minimum must be 0 mph or more.');
    if (!isNum(c.windMax) || c.windMax <= 0 || c.windMax > 60) e.push('Wind maximum must be between 0 and 60 mph.');
    if (isNum(c.windMin) && isNum(c.windMax) && c.windMax <= c.windMin) e.push('Wind maximum must be greater than wind minimum.');
    if (!isNum(c.shearSpeed) || c.shearSpeed <= 0) e.push('Speed difference threshold must be greater than 0 mph.');
    if (!isNum(c.shearDir) || c.shearDir <= 0 || c.shearDir > 180) e.push('Direction difference threshold must be between 1 and 180 degrees.');
    if (!isNum(c.jobHours) || c.jobHours <= 0 || c.jobHours > 24) e.push('Job length must be between 0 and 24 hours.');
    if (!isNum(c.sensorUnc) || c.sensorUnc < 0 || c.sensorUnc > 5) e.push('Sensor uncertainty must be between 0 and 5 degrees F.');
    if (!isNum(c.staleIntervals) || c.staleIntervals < 1) e.push('Freshness limit must be at least 1 sampling interval.');
    if (c.heatLimit != null && !okTemp(c.heatLimit)) e.push('Heat limit is not a valid temperature.');
    return e;
  }

  /* r = { tLo, tHi, wLo, wHi, dLo, dHi }. Temps in F, wind mph, direction is where wind comes FROM.
     meta = { ageMin, staleMin }. A reading older than staleMin is stale. */
  function evaluate(r, cfgIn, meta) {
    const cfg = Object.assign({}, DEFAULT_CFG, cfgIn || {});
    const lo = cfg.loLabel, hi = cfg.hiLabel;
    const loW = cfg.loWindLabel || lo, unc = cfg.uncLabel || 'sensor uncertainty';
    r = r || {};
    const cfgErr = validateCfg(cfg);
    if (cfgErr.length) return { status: 'UNABLE', level: -1, triggers: [], problems: [{ code: 'BAD_SETTINGS', text: 'Settings are not valid. ' + cfgErr[0] }],
      dT: null, shearSpd: null, shearDir: null, dirReliable: false, ground: { status: 'UNABLE', text: 'Settings are not valid.' }, missed: false };

    const problems = [];
    const stale = !!(meta && isNum(meta.ageMin) && isNum(meta.staleMin) && meta.ageMin > meta.staleMin);
    if (stale) problems.push({ code: 'STALE', text: 'Readings are ' + Math.round(meta.ageMin) + ' minutes old. The limit is ' + Math.round(meta.staleMin) + ' minutes (' + cfg.staleIntervals + ' sampling intervals).' });
    const needHiWind = !cfg.skipHiWind;
    const V = { tLo: !stale && okTemp(r.tLo), tHi: !stale && okTemp(r.tHi), wLo: !stale && okWind(r.wLo), wHi: !stale && okWind(r.wHi), dLo: !stale && okDir(r.dLo), dHi: !stale && okDir(r.dHi) };
    if (!stale) {
      if (!V.tLo) problems.push({ code: 'NO_TLO', text: 'No valid temperature from the ' + lo + ' sensor.' });
      if (!V.tHi) problems.push({ code: 'NO_THI', text: 'No valid temperature from the ' + hi + ' sensor.' });
      if (!V.wLo) problems.push({ code: 'NO_WLO', text: 'No valid wind speed from the ' + loW + ' sensor.' });
      if (needHiWind && !V.wHi) problems.push({ code: 'NO_WHI', text: 'No valid wind speed from the ' + hi + ' sensor.' });
      if (V.wLo && r.wLo >= cfg.calmMph && !V.dLo) problems.push({ code: 'NO_DLO', text: 'No valid wind direction from the ' + loW + ' sensor.' });
      if (needHiWind && V.wHi && r.wHi >= cfg.calmMph && !V.dHi) problems.push({ code: 'NO_DHI', text: 'No valid wind direction from the ' + hi + ' sensor.' });
    }

    const T = [];
    const dT = V.tLo && V.tHi ? r.tHi - r.tLo : null;

    // 1. Inversion. Any positive difference is an alert.
    if (dT != null && dT > 0) {
      T.push({ code: 'INVERSION', level: 2, title: 'Temperature inversion',
        text: 'Air at ' + hi + ' is ' + f1(dT) + '°F warmer than at ' + lo + '. That is an inversion. The warm air acts like a lid, so fine spray can hang under it and drift sideways.' +
          (dT < cfg.sensorUnc ? ' This difference is inside the ±' + cfg.sensorUnc + '°F ' + unc + ', so it may not be a true inversion. The alert is shown anyway because a positive difference is never ignored.' : '') });
    } else if (dT != null && dT > -cfg.sensorUnc) {
      T.push({ code: 'SMALL_DIFF', level: 1, title: 'Small temperature difference',
        text: (dT === 0 ? 'Air at ' + hi + ' and ' + lo + ' is the same temperature.' : 'Air at ' + hi + ' is only ' + f1(-dT) + '°F cooler than at ' + lo + '.') +
          ' That is inside the ±' + cfg.sensorUnc + '°F ' + unc + ' of an inversion. Mixing strength is not established by these readings.' });
    }

    // 2. Wind limits at each height
    if (V.wLo && r.wLo > cfg.windMax) T.push({ code: 'WIND_HIGH_LO', level: 2, title: 'Wind above your limit at ' + loW,
      text: 'Wind at ' + loW + ' is ' + f1(r.wLo) + ' mph. Your limit is ' + cfg.windMax + ' mph.' });
    if (needHiWind && V.wHi && r.wHi > cfg.windMax) T.push({ code: 'WIND_HIGH_HI', level: 2, title: 'Wind above your limit at ' + hi,
      text: 'Wind at ' + hi + ' is ' + f1(r.wHi) + ' mph. Your limit is ' + cfg.windMax + ' mph. A reading at ' + loW + ' alone does not show this.' });
    if (V.wLo && r.wLo < cfg.windMin) T.push({ code: 'WIND_LOW_LO', level: 1, title: 'Wind below your minimum at ' + loW,
      text: 'Wind at ' + loW + ' is ' + f1(r.wLo) + ' mph. Your minimum is ' + cfg.windMin + ' mph. Calm air has no steady direction and often comes with an inversion.' });
    if (needHiWind && V.wHi && r.wHi < cfg.windMin) T.push({ code: 'WIND_LOW_HI', level: 1, title: 'Wind below your minimum at ' + hi,
      text: 'Wind at ' + hi + ' is ' + f1(r.wHi) + ' mph. Your minimum is ' + cfg.windMin + ' mph.' });

    // 3. Shear: speed
    const shearSpd = V.wLo && V.wHi ? r.wHi - r.wLo : null;
    if (!cfg.skipShearSpeed && shearSpd != null && Math.abs(shearSpd) >= cfg.shearSpeed) T.push({ code: 'SHEAR_SPEED', level: 1,
      title: 'Wind speed differs between heights',
      text: 'Wind is ' + f1(Math.abs(shearSpd)) + ' mph ' + (shearSpd > 0 ? 'faster' : 'slower') + ' at ' + hi + ' than at ' + lo + '. This is at or over the ' + cfg.shearSpeed + ' mph prototype threshold.' });

    // 4. Shear: direction. Only when wind is moving at both heights; calm air has no reliable direction.
    const movLo = V.wLo && r.wLo >= cfg.calmMph && V.dLo, movHi = V.wHi && r.wHi >= cfg.calmMph && V.dHi;
    const dirReliable = movLo && movHi;
    const shearDirDeg = dirReliable ? angDiff(r.dLo, r.dHi) : null;
    if (dirReliable && shearDirDeg >= cfg.shearDir) T.push({ code: 'SHEAR_DIR', level: 1,
      title: 'Wind direction differs between heights',
      text: 'Wind at ' + lo + ' is from the ' + compass(r.dLo) + ' and wind at ' + hi + ' is from the ' + compass(r.dHi) + ', ' + Math.round(shearDirDeg) + '° apart. This is at or over the ' + cfg.shearDir + '° prototype threshold. Ground wind direction alone does not represent both heights.' });

    // 5. Sensitive site in the measured downwind direction at either height
    let site = null;
    if (cfg.siteOn) {
      const hits = [];
      if (movLo && angDiff((r.dLo + 180) % 360, cfg.siteBearing) <= cfg.siteCone) hits.push(lo);
      if (movHi && angDiff((r.dHi + 180) % 360, cfg.siteBearing) <= cfg.siteCone) hits.push(hi);
      if (hits.length) site = { code: 'SITE_DOWNWIND', level: 1, bearing: cfg.siteBearing, who: cfg.siteName,
        title: 'Measured wind points toward the ' + cfg.siteName,
        text: 'Wind measured at ' + hits.join(' and ') + ' points toward the ' + cfg.siteName + ' to the ' + compass(cfg.siteBearing) + '.' };
    }

    // 6. Product specific heat limit (prototype values)
    const heatLimit = cfg.heatLimit != null ? cfg.heatLimit : (cfg.volatility === 'high' ? cfg.hotF : null);
    if (heatLimit != null && V.tLo && r.tLo >= heatLimit) T.push({ code: 'PRODUCT_HEAT', level: 1, title: 'At or above the heat limit set for this product',
      text: 'It is ' + f1(r.tLo) + '°F at ' + lo + '. The heat limit set for ' + (cfg.productName || 'this product') + ' is ' + heatLimit + '°F. ' + (cfg.heatText || 'Volatile products can give off more vapor in heat.') });

    // 6b. Spatial check (live model mode): some model points around the site show an inversion while the site estimate does not.
    const nb = cfg.nearby;
    if (nb && nb.inv > 0 && !T.some(t => t.code === 'INVERSION')) T.push({ code: 'NEARBY_INVERSION', level: 1, title: 'Inversion at nearby model points',
      text: nb.inv + ' of ' + nb.of + ' model points within ' + nb.km + ' km show warmer air above cooler air, while the estimate for this site does not. Inversions are patchy. Check on site.' });

    // 6c. Network check (live model mode): kriging across the whole network says inversion at this site while the site estimate does not.
    if (nb && nb.net && nb.net.v > 0 && !T.some(t => t.code === 'INVERSION' || t.code === 'NEARBY_INVERSION')) T.push({ code: 'NETWORK_INVERSION', level: 1, title: 'The network model shows an inversion here',
      text: 'The network estimate (kriging across ' + nb.net.n + ' points) puts the upper air ' + f1(nb.net.v) + '°F warmer than the lower air at this site, while the farm estimate does not. The two estimates disagree. Check on site.' });

    // 7. Actual community reports nearby. Unverified, so they can only ADD caution.
    const comm = cfg.community || [];
    const closest = a => a.slice().sort((x, y) => x.distMi - y.distMi)[0];
    const where = c => c.distMi < 0.15 ? 'at this block' : f1(c.distMi) + ' mi to the ' + compass(c.bearing);
    const ago = c => c.ageMin < 1 ? 'just now' : Math.round(c.ageMin) + ' min ago';
    const nInv = comm.filter(c => c.kind === 'inversion' && c.distMi <= 3 && c.ageMin <= 90);
    if (nInv.length) { const c = closest(nInv);
      T.push({ code: 'NET_INVERSION', level: 1, title: 'Still air reported nearby',
        text: nInv.length + (nInv.length > 1 ? ' growers' : ' grower') + ' within 3 miles reported signs of still air in the last 90 minutes (closest ' + where(c) + ', ' + ago(c) + '). Reports are unverified. Check on site.' }); }
    const nDrift = comm.filter(c => c.kind === 'drift' && c.distMi <= 3 && c.ageMin <= 180);
    if (nDrift.length) { const c = closest(nDrift);
      T.push({ code: 'NET_DRIFT', level: 1, title: 'Drift reported nearby',
        text: 'A grower reported seeing drift ' + where(c) + ', ' + ago(c) + '. Reports are unverified.' }); }
    const crews = comm.filter(c => c.kind === 'crew' && c.distMi <= 1.5 && c.ageMin <= 480).filter(c => c.distMi < 0.15 ||
      (movLo && angDiff((r.dLo + 180) % 360, c.bearing) <= cfg.siteCone) || (movHi && angDiff((r.dHi + 180) % 360, c.bearing) <= cfg.siteCone));
    let crew = null;
    if (crews.length) { const c = closest(crews);
      crew = { code: 'NET_CREW', level: 1, bearing: c.bearing, who: 'crew', title: 'People reported in the measured downwind direction',
        text: 'A grower reported a crew working ' + where(c) + ', ' + ago(c) + '. Measured wind points that way.' }; }

    // A site or crew in the measured downwind direction plus any other flag is a STOP.
    [site, crew].forEach(s => { if (s && T.length) { s.level = 2; s.text += ' With the other flags, this is a stop.'; } });
    if (site) T.push(site); if (crew) T.push(crew);

    T.sort((a, b) => b.level - a.level);
    const level = T.reduce((m, t) => Math.max(m, t.level), 0);
    // A confirmed STOP from valid readings stands. Otherwise any required reading problem means we cannot assess.
    const status = level === 2 ? 'STOP' : problems.length ? 'UNABLE' : NAMES[level];

    // Weather and site concerns are reported separately. The overall decision above keeps every restriction.
    const isConcern = t => t.code === 'SITE_DOWNWIND' || /^NET_/.test(t.code);
    const wxT = T.filter(t => !isConcern(t)), concerns = T.filter(isConcern);
    const wxLevel = wxT.reduce((m, t) => Math.max(m, t.code === 'SITE_DOWNWIND' ? 0 : t.level), 0);
    const weather = wxLevel === 2 ? 'STOP' : problems.length ? 'UNABLE' : NAMES[wxLevel];

    // What a single ground level station would conclude: wind speed at one height only.
    let g;
    if (!V.wLo) g = { status: 'UNABLE', text: 'No valid wind reading at ' + loW + '.' };
    else if (r.wLo > cfg.windMax) g = { status: 'STOP', text: 'Wind ' + f1(r.wLo) + ' mph at ' + loW + ' is over ' + cfg.windMax + ' mph.' };
    else if (r.wLo < cfg.windMin) g = { status: 'CAUTION', text: 'Wind ' + f1(r.wLo) + ' mph at ' + loW + ' is under ' + cfg.windMin + ' mph.' };
    else g = { status: 'GO', text: 'Wind ' + f1(r.wLo) + ' mph at ' + loW + ' is inside ' + cfg.windMin + ' to ' + cfg.windMax + ' mph. Wind check passed.' };

    return { status, level: status === 'UNABLE' ? -1 : level, triggers: T, problems, dT, shearSpd, shearDir: shearDirDeg, dirReliable,
      ground: g, weather, concerns, missed: g.status === 'GO' && (weather === 'CAUTION' || weather === 'STOP') };
  }

  /* Contiguous GO runs. Each run reports whether it was cut off by the end of the data. */
  function goWindows(evals, stepMin) {
    const out = []; let s = -1;
    for (let i = 0; i <= evals.length; i++) {
      const go = i < evals.length && evals[i].status === 'GO';
      if (go && s < 0) s = i;
      if (!go && s >= 0) { out.push({ start: s, end: i, hours: (i - s) * stepMin / 60, openEnded: i === evals.length }); s = -1; }
    }
    return out;
  }

  /* Is there enough projected suitable weather for the planned job, starting now?
     A current STOP always wins. Unknown future conditions are never reported as a confirmed window. */
  function jobAssessment(evals, idx, stepMin, jobHours) {
    const need = jobHours * 60, cur = evals[idx].status;
    let n = 0; while (idx + n < evals.length && evals[idx + n].status === 'GO') n++;
    const runMin = n * stepMin, ranOut = idx + n >= evals.length;
    const next = goWindows(evals, stepMin).find(w => w.start > idx && w.hours * 60 >= need) || null;
    let state;
    if (cur === 'STOP') state = 'STOP';
    else if (cur === 'UNABLE') state = 'UNKNOWN';
    else if (cur === 'CAUTION') state = 'WAIT';
    else if (runMin >= need) state = 'SUFFICIENT';
    else if (ranOut) state = 'UNKNOWN';       // still GO when the data ends: the rest of the job is not known
    else state = 'WAIT';
    return { state, current: cur, runMin, needMin: need, ranOut, next };
  }

  /* Savings estimate. Every input is the grower's own number. Nothing here is measured. */
  function savings(i) {
    const ok = v => typeof v === 'number' && isFinite(v) && v >= 0;
    if (![i.acres, i.costPerAcre, i.jobs, i.badPct, i.lostPct, i.towerYear].every(ok) || i.badPct > 100 || i.lostPct > 100) return null;
    const jobCost = i.acres * i.costPerAcre, lostJobs = i.jobs * i.badPct / 100 * i.lostPct / 100, avoidable = lostJobs * jobCost;
    return { jobCost, lostJobs, avoidable, net: avoidable - i.towerYear, breakEvenJobs: jobCost > 0 ? i.towerYear / jobCost : null };
  }

  const api = { DEFAULT_CFG, evaluate, validateCfg, goWindows, jobAssessment, savings, compass, angDiff, f1, RANK, NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SprayEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
