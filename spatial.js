/* Spray or Wait: spatial estimate.
   Pure functions, no DOM. Runs in the browser and in Node (tests/engine.test.js).

   Inverse distance weighting (IDW): the value at a place is the weighted average of the values at
   known points, where closer points count more (weight = 1 / distance^power, power 2).
   Wind is averaged as east and north components so 350 and 10 degrees average to north, not south.

   Kriging is NOT implemented. It needs enough real stations to fit a variogram for the area, and
   this prototype has model points only. idwReading is the one place to swap it in later. */
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
  const api = { distKm, idw, idwReading, inversionCount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SpraySpatial = api;
})(typeof window !== 'undefined' ? window : globalThis);
