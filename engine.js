/* Spray or Wait: decision engine.
   Pure functions, no DOM. Runs in the browser and in Node (for tests).
   Thresholds follow the challenge brief (3 to 10 mph is common guidance).
   Every limit is adjustable because the pesticide label always wins. */
(function (root) {
  const DEFAULT_CFG = {
    windMin: 3,        // mph, common guidance; label may differ
    windMax: 10,       // mph, common guidance; label may differ
    shearSpeed: 5,     // mph difference between heights that we flag
    shearDir: 45,      // degrees difference between heights that we flag
    invStrong: 0.5,    // deg F; above this an inversion is a hard stop
    nearNeutral: 0.5,  // deg F; upper air this close to lower air = barely mixing
    volatility: 'low', // low | medium | high
    hotF: 85,          // deg F; heat raises vapor loss for volatile products
    heatLimit: null,   // deg F; product specific ceiling, null = none
    heatText: '',
    productName: '',
    profile: 'custom',
    siteOn: true,
    siteName: 'school',
    siteBearing: 90,   // degrees from the block toward the sensitive site
    siteCone: 45,      // degrees either side counted as "toward"
    jobHours: 2,
    bufferRows: 3,     // edge rows (of 12) to hold back on the side facing a downwind site
    loLabel: '5 ft',
    hiLabel: '30 ft',
    skipHiWind: false,     // used for coarse forecast data
    skipShearSpeed: false  // used for coarse forecast data
  };

  const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  function compass(d) { return COMPASS[Math.round((((d % 360) + 360) % 360) / 22.5) % 16]; }
  function angDiff(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
  function f1(x) { return (Math.round(x * 10) / 10).toFixed(1); }
  const RANK = { GO: 0, CAUTION: 1, STOP: 2 };
  const NAMES = ['GO', 'CAUTION', 'STOP'];

  /* r = { tLo, tHi, wLo, wHi, dLo, dHi }  temps in F, wind mph, direction = where wind comes FROM */
  function evaluate(r, cfgIn) {
    const cfg = Object.assign({}, DEFAULT_CFG, cfgIn || {});
    const lo = cfg.loLabel, hi = cfg.hiLabel;
    const T = [];
    const dT = r.tHi - r.tLo;

    // 1. Temperature inversion: upper air warmer than lower air
    if (dT > 0) {
      const strong = dT >= cfg.invStrong || cfg.volatility === 'high';
      T.push({
        code: 'INVERSION', level: strong ? 2 : 1,
        title: strong ? 'Temperature inversion' : 'Weak temperature inversion',
        text: 'Air at ' + hi + ' is ' + f1(dT) + '°F warmer than at ' + lo +
          '. Spray gets trapped in a shallow layer near the ground and can drift sideways a long way.' +
          (strong ? '' : ' The difference is small, so treat it as an inversion starting or ending.')
      });
    } else if (dT > -cfg.nearNeutral) {
      T.push({
        code: 'NEAR_INVERSION', level: 1,
        title: 'Air is barely mixing',
        text: 'Air at ' + hi + ' is only ' + f1(-dT) + '°F cooler than at ' + lo +
          '. An inversion may be forming or just breaking up.'
      });
    }

    // 2. Wind limits at each height
    if (r.wLo > cfg.windMax) T.push({ code: 'WIND_HIGH_LO', level: 2, title: 'Wind too strong at ' + lo,
      text: 'Wind at ' + lo + ' is ' + f1(r.wLo) + ' mph, over your ' + cfg.windMax + ' mph limit.' });
    if (!cfg.skipHiWind && r.wHi > cfg.windMax) T.push({ code: 'WIND_HIGH_HI', level: 2, title: 'Wind too strong above the trees',
      text: 'Wind at ' + hi + ' is ' + f1(r.wHi) + ' mph, over your ' + cfg.windMax +
        ' mph limit. Spray that clears the canopy will be carried off target.' });
    if (r.wLo < cfg.windMin) T.push({ code: 'WIND_LOW_LO', level: 1, title: 'Wind too light at ' + lo,
      text: 'Wind at ' + lo + ' is only ' + f1(r.wLo) + ' mph, under your ' + cfg.windMin +
        ' mph minimum. Near calm air moves spray in unpredictable directions and often comes with an inversion.' });
    if (!cfg.skipHiWind && r.wHi < cfg.windMin) T.push({ code: 'WIND_LOW_HI', level: 1, title: 'Wind too light at ' + hi,
      text: 'Wind at ' + hi + ' is only ' + f1(r.wHi) + ' mph, under your ' + cfg.windMin + ' mph minimum.' });

    // 3. Wind shear: speed
    const shearSpd = r.wHi - r.wLo;
    if (!cfg.skipShearSpeed && Math.abs(shearSpd) >= cfg.shearSpeed) T.push({ code: 'SHEAR_SPEED', level: 1,
      title: 'Wind speed changes with height',
      text: 'Wind is ' + f1(Math.abs(shearSpd)) + ' mph ' + (shearSpd > 0 ? 'faster' : 'slower') + ' at ' + hi +
        ' than at ' + lo + '. A ground reading does not show what the spray meets above the trees.' });

    // 4. Wind shear: direction (only meaningful when air is actually moving at both heights)
    const moving = r.wLo >= 1 && r.wHi >= 1;
    const shearDirDeg = moving ? angDiff(r.dLo, r.dHi) : 0;
    if (moving && shearDirDeg >= cfg.shearDir) T.push({ code: 'SHEAR_DIR', level: 1,
      title: 'Wind direction changes with height',
      text: 'Wind at ' + lo + ' is from the ' + compass(r.dLo) + ' but wind at ' + hi + ' is from the ' + compass(r.dHi) +
        ' (' + Math.round(shearDirDeg) + '° apart). Drift will not follow the ground wind.' });

    // 5. Sensitive site downwind at either height
    let site = null;
    if (cfg.siteOn) {
      const hits = [];
      if (r.wLo >= 1 && angDiff((r.dLo + 180) % 360, cfg.siteBearing) <= cfg.siteCone) hits.push(lo);
      if (r.wHi >= 1 && angDiff((r.dHi + 180) % 360, cfg.siteBearing) <= cfg.siteCone) hits.push(hi);
      if (hits.length) {
        site = { code: 'SITE_DOWNWIND', level: 1, bearing: cfg.siteBearing, who: cfg.siteName, title: 'Wind is blowing toward the ' + cfg.siteName,
          text: 'Wind at ' + hits.join(' and ') + ' would carry drift toward the ' + cfg.siteName +
            ' to the ' + compass(cfg.siteBearing) + '.' };
      }
    }

    // 6. Product specific heat limit (leaf burn for oils and sulfur, extra vapor for volatile products)
    const heatLimit = cfg.heatLimit != null ? cfg.heatLimit : (cfg.volatility === 'high' ? cfg.hotF : null);
    if (heatLimit != null && r.tLo >= heatLimit) T.push({ code: 'PRODUCT_HEAT', level: 1,
      title: 'Too hot for this product',
      text: 'It is ' + f1(r.tLo) + '\u00B0F at ' + lo + ', at or above the ' + heatLimit + '\u00B0F limit set for ' + (cfg.productName || 'this product') + '. ' +
        (cfg.heatText || 'High volatility products give off more vapor in heat, and vapor can drift after spraying.') });

    // 7. Grower network: recent reports from nearby growers. Unverified, so they can only ADD caution, never remove it.
    const comm = cfg.community || [];
    const closest = a => a.slice().sort((x, y) => x.distMi - y.distMi)[0];
    const where = c => c.distMi < 0.15 ? 'at this block' : f1(c.distMi) + ' mi to the ' + compass(c.bearing);
    const ago = c => c.ageMin < 1 ? 'just now' : Math.round(c.ageMin) + ' min ago';
    const nInv = comm.filter(c => c.kind === 'inversion' && c.distMi <= 3 && c.ageMin <= 90);
    if (nInv.length) {
      const c = closest(nInv); const own = T.some(t => t.code === 'NEAR_INVERSION' || t.code === 'INVERSION');
      T.push({ code: 'NET_INVERSION', level: own ? 2 : 1, title: 'Inversion signs reported nearby',
        text: nInv.length + (nInv.length > 1 ? ' growers' : ' grower') + ' within 3 miles reported inversion signs in the last 90 minutes (closest ' + where(c) + ', ' + ago(c) + '). ' +
          (own ? 'Your own tower agrees, so this is a stop.' : 'Your tower does not show it yet. Reports are unverified, so check on site before you start.') });
    }
    const nDrift = comm.filter(c => c.kind === 'drift' && c.distMi <= 3 && c.ageMin <= 180);
    if (nDrift.length) { const c = closest(nDrift);
      T.push({ code: 'NET_DRIFT', level: 1, title: 'Drift reported nearby',
        text: 'A grower reported seeing drift ' + where(c) + ', ' + ago(c) + '. Conditions in the area are carrying spray off target.' }); }
    const crews = comm.filter(c => c.kind === 'crew' && c.distMi <= 1.5 && c.ageMin <= 480).filter(c => c.distMi < 0.15 ||
      (r.wLo >= 1 && angDiff((r.dLo + 180) % 360, c.bearing) <= cfg.siteCone) || (r.wHi >= 1 && angDiff((r.dHi + 180) % 360, c.bearing) <= cfg.siteCone));
    let crew = null;
    if (crews.length) { const c = closest(crews);
      crew = { code: 'NET_CREW', level: 1, bearing: c.bearing, who: 'crew', title: 'People reported working downwind',
        text: 'A grower reported a crew working ' + where(c) + ', ' + ago(c) + ', and the wind would carry drift that way.' }; }

    // A sensitive site or crew downwind plus any other flag is a stop: the risks stack.
    [site, crew].forEach(s => {
      if (!s) return;
      if (T.length) { s.level = 2; s.text += ' Combined with the other flags, that makes this a stop.'; }
    });
    if (site) T.push(site); if (crew) T.push(crew);

    T.sort((a, b) => b.level - a.level);
    const level = T.reduce((m, t) => Math.max(m, t.level), 0);

    // What a single ground level station would conclude: wind speed at one height only.
    let g = { status: 'GO', text: 'Wind ' + f1(r.wLo) + ' mph at ' + lo + ' is inside ' + cfg.windMin + ' to ' + cfg.windMax + ' mph. Looks fine.' };
    if (r.wLo > cfg.windMax) g = { status: 'STOP', text: 'Wind ' + f1(r.wLo) + ' mph at ' + lo + ' is over ' + cfg.windMax + ' mph.' };
    else if (r.wLo < cfg.windMin) g = { status: 'CAUTION', text: 'Wind ' + f1(r.wLo) + ' mph at ' + lo + ' is under ' + cfg.windMin + ' mph.' };

    // Whole block or only part? If the ONLY issue is a site or crew downwind, the interior can be sprayed
    // while the edge rows facing that site are held back. Any other flag means the whole block waits.
    let plan = { mode: level === 0 ? 'all' : level === 1 ? 'marginal' : 'none', holds: [] };
    if (level === 1 && T.every(t => t.code === 'SITE_DOWNWIND' || t.code === 'NET_CREW')) plan = { mode: 'partial', holds: T.map(t => ({ bearing: t.bearing, who: t.who })) };

    return {
      plan,
      status: NAMES[level], level, triggers: T, dT, shearSpd, shearDir: shearDirDeg,
      ground: g, missed: level > RANK[g.status]
    };
  }

  /* Contiguous GO runs in a series of evaluated points. stepMin = minutes per point. */
  function goWindows(evals, stepMin) {
    const out = []; let s = -1;
    for (let i = 0; i <= evals.length; i++) {
      const go = i < evals.length && evals[i].status === 'GO';
      if (go && s < 0) s = i;
      if (!go && s >= 0) { out.push({ start: s, end: i, hours: (i - s) * stepMin / 60 }); s = -1; }
    }
    return out;
  }

  const api = { DEFAULT_CFG, evaluate, goWindows, compass, angDiff, f1, RANK, NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SprayEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
