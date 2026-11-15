/* Run with: node tests/engine.test.js   (no dependencies) */
const E = require('../engine.js'), S = require('../sim.js');
let pass = 0, fail = 0;
function t(name, cond, detail) { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); } }
const base = { tLo: 70, tHi: 67, wLo: 5, wHi: 6, dLo: 330, dHi: 335 };
const ev = (o, cfg, meta) => E.evaluate(Object.assign({}, base, o), cfg, meta);
const has = (e, c) => e.triggers.some(x => x.code === c);

console.log('Temperature');
t('baseline readings are GO', ev({}).status === 'GO', ev({}).status);
t('upper warmer than lower is an inversion STOP', ev({ tHi: 73 }).status === 'STOP' && has(ev({ tHi: 73 }), 'INVERSION'));
t('upper warmer by 0.1 F still alerts (never silently ignored)', ev({ tHi: 70.1 }).status === 'STOP' && /uncertainty/.test(ev({ tHi: 70.1 }).triggers[0].text));
t('upper cooler than lower: no inversion', !has(ev({ tHi: 66 }), 'INVERSION') && ev({ tHi: 66 }).status === 'GO');
t('equal temperatures: CAUTION, not GO', ev({ tHi: 70 }).status === 'CAUTION' && has(ev({ tHi: 70 }), 'SMALL_DIFF'));
t('upper cooler by 0.3 F (inside uncertainty): CAUTION', ev({ tHi: 69.7 }).status === 'CAUTION');
t('upper cooler by 0.6 F: clear of the uncertainty band', ev({ tHi: 69.4 }).status === 'GO');

console.log('Wind limits');
t('low wind at 5 ft flagged', has(ev({ wLo: 2 }), 'WIND_LOW_LO') && ev({ wLo: 2 }).status === 'CAUTION');
t('low wind at 30 ft flagged', has(ev({ wLo: 3.2, wHi: 2.5 }), 'WIND_LOW_HI'));
t('high wind at 5 ft is STOP', ev({ wLo: 11, wHi: 12 }).status === 'STOP' && has(ev({ wLo: 11, wHi: 12 }), 'WIND_HIGH_LO'));
t('high wind at 30 ft only is STOP while ground check says GO', (() => { const e = ev({ wLo: 6, wHi: 12 }); return e.status === 'STOP' && has(e, 'WIND_HIGH_HI') && e.ground.status === 'GO' && e.missed; })());
t('label limits change the answer', ev({ wLo: 6, wHi: 12 }, { windMax: 15, shearSpeed: 10 }).status === 'GO');

console.log('Shear');
t('speed shear at threshold flagged', has(ev({ wLo: 4, wHi: 9 }), 'SHEAR_SPEED'));
t('speed shear below threshold not flagged', !has(ev({ wLo: 4, wHi: 8.9 }), 'SHEAR_SPEED'));
t('direction shear flagged', has(ev({ dLo: 330, dHi: 270 }), 'SHEAR_DIR'));
t('angDiff wraps at north: 359 vs 1 is 2', E.angDiff(359, 1) === 2 && E.angDiff(1, 359) === 2 && E.angDiff(350, 10) === 20 && E.angDiff(0, 180) === 180 && E.angDiff(90, 270) === 180);
t('359 vs 1 degrees does not trigger direction shear', !has(ev({ dLo: 359, dHi: 1 }), 'SHEAR_DIR') && ev({ dLo: 359, dHi: 1 }).shearDir === 2);
t('calm wind: direction treated as unreliable, no direction shear', (() => { const e = ev({ wLo: 0.4, dLo: 90, dHi: 270 }); return !has(e, 'SHEAR_DIR') && e.dirReliable === false && e.shearDir === null; })());

console.log('Missing, invalid, stale');
t('missing upper temperature: UNABLE, never GO', ev({ tHi: null }).status === 'UNABLE');
t('missing whole upper sensor: UNABLE', ev({ tHi: null, wHi: null, dHi: null }).status === 'UNABLE');
t('missing upper sensor but ground wind over limit: confirmed STOP', ev({ tHi: null, wHi: null, dHi: null, wLo: 14 }).status === 'STOP');
t('NaN reading: UNABLE', ev({ wLo: NaN }).status === 'UNABLE');
t('negative wind speed: UNABLE', ev({ wHi: -3 }).status === 'UNABLE');
t('impossible temperature: UNABLE', ev({ tLo: 999 }).status === 'UNABLE');
t('direction of 400 degrees: UNABLE', ev({ dHi: 400 }).status === 'UNABLE');
t('string instead of number: UNABLE', ev({ tLo: '70' }).status === 'UNABLE');
t('stale readings: UNABLE', ev({}, {}, { ageMin: 15, staleMin: 10 }).status === 'UNABLE' && ev({}, {}, { ageMin: 15, staleMin: 10 }).problems[0].code === 'STALE');
t('fresh readings at the limit are accepted', ev({}, {}, { ageMin: 10, staleMin: 10 }).status === 'GO');
t('stale readings never yield GO even if values look fine', ev({}, {}, { ageMin: 999, staleMin: 10 }).status !== 'GO');
t('empty reading object: UNABLE', E.evaluate({}).status === 'UNABLE' && E.evaluate(null).status === 'UNABLE');
t('UNABLE is distinct from a hazardous measurement', ev({ tHi: null }).triggers.length === 0 && ev({ tHi: null }).problems.length > 0);

console.log('Settings');
t('default settings are valid', E.validateCfg(E.DEFAULT_CFG).length === 0);
t('max below min rejected', E.validateCfg(Object.assign({}, E.DEFAULT_CFG, { windMin: 10, windMax: 5 })).length > 0);
t('negative minimum rejected', E.validateCfg(Object.assign({}, E.DEFAULT_CFG, { windMin: -1 })).length > 0);
t('zero shear threshold rejected', E.validateCfg(Object.assign({}, E.DEFAULT_CFG, { shearSpeed: 0 })).length > 0);
t('direction threshold over 180 rejected', E.validateCfg(Object.assign({}, E.DEFAULT_CFG, { shearDir: 200 })).length > 0);
t('NaN threshold rejected', E.validateCfg(Object.assign({}, E.DEFAULT_CFG, { windMax: NaN })).length > 0);
t('zero job length rejected', E.validateCfg(Object.assign({}, E.DEFAULT_CFG, { jobHours: 0 })).length > 0);
t('invalid settings can never produce GO', ev({}, { windMin: 10, windMax: 5 }).status === 'UNABLE');

console.log('No averaging');
t('one STOP is not cancelled by otherwise ideal readings', ev({ tHi: 70.2, wLo: 6, wHi: 7 }).status === 'STOP');
t('inversion plus high wind stays STOP', ev({ tHi: 75, wHi: 14 }).status === 'STOP');
t('sensitive site alone is CAUTION', (() => { const e = ev({ dLo: 270, dHi: 270 }); return e.status === 'CAUTION' && has(e, 'SITE_DOWNWIND'); })());
t('sensitive site plus another flag is STOP', ev({ dLo: 270, dHi: 270, wLo: 2.5 }).status === 'STOP');
t('community report can add caution', ev({}, { community: [{ kind: 'inversion', distMi: 1, bearing: 10, ageMin: 5 }] }).status === 'CAUTION');
t('community report cannot turn a STOP into anything else', ev({ tHi: 75 }, { community: [{ kind: 'spraying', distMi: 0, bearing: 0, ageMin: 1 }] }).status === 'STOP');
t('old community report is ignored', ev({}, { community: [{ kind: 'inversion', distMi: 1, bearing: 10, ageMin: 200 }] }).status === 'GO');

console.log('Planned job');
const day = S.generateDay(7), evals = day.map(r => E.evaluate(r));
const at = hhmm => { const [h, m] = hhmm.split(':').map(Number); return (h * 60 + m) / 5; };
const j3 = E.jobAssessment(evals, at('15:00'), 5, 2);
t('3:00 PM is GO now', evals[at('15:00')].status === 'GO');
t('3:00 PM: 2 hour job must WAIT with 15 minutes left', j3.state === 'WAIT' && j3.runMin === 15, JSON.stringify(j3));
const j11 = E.jobAssessment(evals, at('11:00'), 5, 2);
t('11:00 AM: sufficient window for a 2 hour job', j11.state === 'SUFFICIENT' && j11.runMin >= 120, JSON.stringify(j11));
t('11:00 AM: 6 hour job must WAIT', E.jobAssessment(evals, at('11:00'), 5, 6).state === 'WAIT');
t('6:10 AM: current STOP takes precedence', E.jobAssessment(evals, at('06:10'), 5, 2).state === 'STOP');
t('6:10 AM: next projected window is reported', (() => { const j = E.jobAssessment(evals, at('06:10'), 5, 2); return j.next && day[j.next.start].min > 370; })());
const short = [{ status: 'GO' }, { status: 'GO' }, { status: 'GO' }];
t('GO until the data ends is UNKNOWN, not a confirmed window', E.jobAssessment(short, 0, 5, 2).state === 'UNKNOWN');
t('UNABLE now means the job window is UNKNOWN', E.jobAssessment([{ status: 'UNABLE' }, { status: 'GO' }], 0, 5, 1).state === 'UNKNOWN');
t('CAUTION now means WAIT', E.jobAssessment([{ status: 'CAUTION' }, { status: 'GO' }], 0, 5, 1).state === 'WAIT');

console.log('Simulated day and demo scenarios');
const s610 = evals[at('06:10')];
t('6:10 AM: tower STOP for inversion while ground wind check is GO', s610.status === 'STOP' && s610.triggers[0].code === 'INVERSION' && s610.ground.status === 'GO' && s610.missed);
t('11:00 AM: GO at both heights', evals[at('11:00')].status === 'GO');
const s1615 = evals[at('16:15')];
t('4:15 PM: upper wind STOP that the ground check misses', s1615.status === 'STOP' && s1615.triggers.some(x => x.code === 'WIND_HIGH_HI') && s1615.ground.status === 'GO');
const eve = evals.slice(at('17:40'), at('18:45')).map(e => e.status);
t('5:40 PM starts GO', eve[0] === 'GO');
t('evening passes through CAUTION and then STOP', eve.indexOf('CAUTION') > 0 && eve.indexOf('STOP') > eve.indexOf('CAUTION'), eve.join(','));
const missed = evals.filter(e => e.missed).length * 5 / 60;
t('comparison statistic is computed from the data (' + missed.toFixed(1) + ' h)', missed > 0 && missed < 24);
const missed2 = day.map(r => E.evaluate(r, { windMin: 4.5 })).filter(e => e.missed).length * 5 / 60;
t('changing thresholds changes the comparison statistic (' + missed2.toFixed(1) + ' h)', missed2 !== missed);
t('simulated day is deterministic', JSON.stringify(S.generateDay(7)) === JSON.stringify(S.generateDay(7)));
t('no slot in the simulated day is UNABLE', evals.every(e => e.status !== 'UNABLE'));

console.log('Spatial estimate (IDW)');
const SPT = require('../spatial.js');
const A = { lat: 31.97, lon: -110.29 }, B = { lat: 32.015, lon: -110.29 }, C = { lat: 31.925, lon: -110.29 };
t('distance: 0.045 degrees of latitude is about 5 km', Math.abs(SPT.distKm(A, B) - 5) < 0.1, String(SPT.distKm(A, B)));
t('IDW of equal values is that value', Math.abs(SPT.idw([{ ...A, v: 4 }, { ...B, v: 4 }], A) - 4) < 1e-9);
t('IDW: two points at equal distance give the midpoint', Math.abs(SPT.idw([{ ...B, v: 10 }, { ...C, v: 20 }], A) - 15) < 0.01);
const near = SPT.idw([{ ...A, v: 10 }, { ...B, v: 20 }], A);
t('IDW: the closer point counts more but does not take everything', near > 10 && near < 11, String(near));
t('IDW skips missing values', Math.abs(SPT.idw([{ ...A, v: null }, { ...B, v: 7 }], A) - 7) < 1e-9);
t('IDW with no valid values is null, never a number', SPT.idw([{ ...A, v: null }], A) === null);
const wr = SPT.idwReading([{ ...B, r: { tLo: 50, tHi: 48, wLo: 5, dLo: 350, wHi: 5, dHi: 350 } }, { ...C, r: { tLo: 50, tHi: 48, wLo: 5, dLo: 10, wHi: 5, dHi: 10 } }], A);
t('wind from 350 and 10 degrees averages to north, not south', E.angDiff(wr.dLo, 0) < 1 && Math.abs(wr.wLo - 5) < 1e-9, JSON.stringify(wr));
t('inversion count over points', JSON.stringify(SPT.inversionCount([{ r: { tLo: 50, tHi: 55 } }, { r: { tLo: 50, tHi: 45 } }, { r: { tLo: null, tHi: 45 } }])) === '{"inv":1,"of":2}');
const nbE = ev({}, { nearby: { inv: 2, of: 5, km: 5 } });
t('nearby points inverted while the site is not: CAUTION, never GO', nbE.status === 'CAUTION' && has(nbE, 'NEARBY_INVERSION'), nbE.status);
t('no nearby inversion: stays GO', ev({}, { nearby: { inv: 0, of: 5, km: 5 } }).status === 'GO');
const nbS = ev({ tHi: 75 }, { nearby: { inv: 5, of: 5, km: 5 } });
t('site inversion is still STOP and is not double counted', nbS.status === 'STOP' && !has(nbS, 'NEARBY_INVERSION'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
