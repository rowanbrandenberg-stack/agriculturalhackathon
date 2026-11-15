/* Spray or Wait: spatial estimate.
   Pure functions, no DOM. Runs in the browser and in Node (tests/engine.test.js).

   Inverse distance weighting (IDW): the value at a place is the weighted average of the values at
   known points, where closer points count more (weight = 1 / distance^power, power 2).
   Wind is averaged as east and north components so 350 and 10 degrees average to north, not south.

   Ordinary kriging: the weights come from how similar the values are at each distance (the
   variogram), fitted fresh from the points each time. It also returns its own uncertainty (sd).
   It needs many points, so it is used on the whole network, never on one farm's few points. */
(function (root) {
  'use strict';
  const RAD = Math.PI / 180;
  function distKm(a, b) {
    const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD, la = a.lat * RAD, lb = b.lat * RAD;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  }
  const ok = v => typeof v === 'number' && isFinite(v);
  /* pts: [{lat, lon, v}]. Points with a missing value are skipped. floorKm stops one very close point from taking all the weight. */
  function idw(pts, target, power, floorKm) {
    power = power || 2; floorKm = floorKm == null ? 1 : floorKm;
    let sw = 0, sv = 0;
    pts.forEach(p => { if (!ok(p.v)) return; const w = 1 / Math.pow(Math.max(distKm(p, target), floorKm), power); sw += w; sv += w * p.v; });
    return sw ? sv / sw : null;
  }
  /* pts: [{lat, lon, r: {tLo, tHi, wLo, wHi, dLo, dHi}}] -> one reading at target */
  function idwReading(pts, target, power, floorKm) {
    const f = get => idw(pts.map(p => ({ lat: p.lat, lon: p.lon, v: get(p.r) })), target, power, floorKm);
    const wind = (sk, dk) => {
      const u = f(r => ok(r[sk]) && ok(r[dk]) ? r[sk] * Math.sin(r[dk] * RAD) : null), v = f(r => ok(r[sk]) && ok(r[dk]) ? r[sk] * Math.cos(r[dk] * RAD) : null);
      if (u == null || v == null) return [null, null];
      return [f(r => r[sk]), (Math.atan2(u, v) / RAD + 360) % 360];   // speed is the mean speed, direction is the mean vector
    };
    const lo = wind('wLo', 'dLo'), hi = wind('wHi', 'dHi');
    return { tLo: f(r => r.tLo), tHi: f(r => r.tHi), wLo: lo[0], dLo: lo[1], wHi: hi[0], dHi: hi[1] };
  }
  /* How many of the points show an inversion (upper air warmer than lower air). */
  function inversionCount(pts) { const v = pts.filter(p => ok(p.r.tLo) && ok(p.r.tHi)); return { inv: v.filter(p => p.r.tHi > p.r.tLo).length, of: v.length }; }
  /* Fit an exponential variogram gamma(h) = sill * (1 - exp(-h / range)) to the point pairs. No nugget. */
  function fitVariogram(pts) {
    const P = pts.filter(p => ok(p.v)), n = P.length; if (n < 3) return null;
    const mean = P.reduce((a, p) => a + p.v, 0) / n, sill = P.reduce((a, p) => a + (p.v - mean) ** 2, 0) / (n - 1);
    const pairs = []; let maxH = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const h = distKm(P[i], P[j]); pairs.push([h, 0.5 * (P[i].v - P[j].v) ** 2]); if (h > maxH) maxH = h; }
    if (!(sill > 1e-9) || !(maxH > 0)) return { sill: 0, range: 1, n: n, mean: mean };
    const nb = 6, bins = []; for (let b = 0; b < nb; b++) bins.push([0, 0, 0]);
    pairs.forEach(q => { if (q[0] > maxH / 2) return; const b = Math.min(nb - 1, Math.floor(q[0] / (maxH / 2) * nb)); bins[b][0] += q[0]; bins[b][1] += q[1]; bins[b][2]++; });
    const emp = bins.filter(b => b[2] > 0).map(b => [b[0] / b[2], b[1] / b[2], b[2]]);
    let best = null;
    [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.6, 0.8, 1].forEach(f => { const range = f * maxH;
      const err = emp.reduce((a, e) => a + e[2] * (e[1] - sill * (1 - Math.exp(-e[0] / range))) ** 2, 0);
      if (!best || err < best.err) best = { sill: sill, range: range, err: err, n: n, mean: mean }; });
    return best;
  }
  function solve(A, b) {   // Gaussian elimination with partial pivoting. Returns null when singular.
    const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null; const t = M[c]; M[c] = M[p]; M[p] = t;
      for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    const x = new Array(n);
    for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
    return x;
  }
  /* Ordinary kriging of pts [{lat, lon, v}] at target. Returns {v, sd, n, range} or null when there are too few points. */
  function krige(pts, target) {
    const P = pts.filter(p => ok(p.v)), n = P.length, m = fitVariogram(P); if (!m) return null;
    if (m.sill === 0) return { v: m.mean, sd: 0, n: n, range: null };   // every point agrees
    const g = h => m.sill * (1 - Math.exp(-h / m.range));
    const A = [], b = [];
    for (let i = 0; i < n; i++) { const row = []; for (let j = 0; j < n; j++) row.push(i === j ? 0 : g(distKm(P[i], P[j]))); row.push(1); A.push(row); b.push(g(distKm(P[i], target))); }
    A.push(new Array(n).fill(1).concat([0])); b.push(1);
    const w = solve(A, b); if (!w) return null;
    let v = 0, va = w[n]; for (let i = 0; i < n; i++) { v += w[i] * P[i].v; va += w[i] * b[i]; }
    return { v: v, sd: Math.sqrt(Math.max(0, va)), n: n, range: m.range };
  }
  const api = { distKm, idw, idwReading, inversionCount, fitVariogram, krige };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SpraySpatial = api;
})(typeof window !== 'undefined' ? window : globalThis);
