/* Spray or Wait: simulated two height tower.
   One realistic cool season day in a desert citrus grove, a reading every 5 minutes.
   Shape of the day: night inversion, calm dawn with a light drainage breeze,
   inversion breaks about 8:30 AM, good mixing midday, stronger wind above the
   canopy mid afternoon, inversion returns before sunset. */
(function (root) {
  const STEP_MIN = 5;
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function smooth(x) { return x * x * (3 - 2 * x); }
  function interp(keys, h, angle) {
    for (let i = 0; i < keys.length - 1; i++) {
      const [h0, v0] = keys[i], [h1, v1] = keys[i + 1];
      if (h >= h0 && h <= h1) {
        const f = smooth((h - h0) / (h1 - h0));
        if (!angle) return v0 + (v1 - v0) * f;
        let d = ((v1 - v0 + 540) % 360) - 180;  // shortest way around the compass
        return (v0 + d * f + 360) % 360;
      }
    }
    return keys[keys.length - 1][1];
  }
  const K = {
    tLo: [[0,52],[3,48],[6,46],[8,52],[10,63],[13,76],[16,82],[18,76],[19.5,68],[21,60],[24,52]],
    dT:  [[0,4.0],[3,5.0],[6,5.5],[7,4.5],[8,1.5],[8.5,0],[9,-0.9],[9.5,-1.6],[12,-2.6],[16,-2.4],[17.5,-1.4],[18,-0.6],[18.33,0],[19,1.8],[20,3.0],[24,4.0]],
    wLo: [[0,1.6],[3,1.4],[5,3.2],[5.5,3.8],[7.5,4.0],[8.5,3.7],[10,4.8],[13,5.5],[15,5.8],[15.5,6.4],[17,6.8],[17.5,5.0],[18.5,3.9],[19.5,3.5],[21,2.2],[24,1.6]],
    wHi: [[0,3.8],[3,3.4],[5,4.6],[7.5,5.0],[8.5,5.2],[10,7.0],[13,8.2],[15,8.6],[15.5,11.5],[16.25,13.5],[17,12.0],[17.5,8.0],[18.5,5.6],[19.5,5.0],[21,4.4],[24,3.8]],
    dLo: [[0,135],[8,135],[9,330],[15,325],[15.5,322],[16.25,320],[17,320],[17.5,328],[20,330],[21.5,135],[24,135]],
    dHi: [[0,150],[8,150],[9,335],[15,335],[15.5,285],[16.25,270],[17,275],[17.5,332],[20,335],[21.5,150],[24,150]]
  };
  function generateDay(seed) {
    const rnd = mulberry32(seed || 7);
    const n = () => rnd() * 2 - 1;
    const out = [];
    for (let m = 0; m < 1440; m += STEP_MIN) {
      const h = m / 60;
      const tLo = interp(K.tLo, h) + n() * 0.12;
      const tHi = tLo + interp(K.dT, h) + n() * 0.06;
      out.push({
        min: m,
        tLo: tLo, tHi: tHi,
        wLo: Math.max(0, interp(K.wLo, h) + n() * 0.22),
        wHi: Math.max(0, interp(K.wHi, h) + n() * 0.25),
        dLo: (interp(K.dLo, h, true) + n() * 5 + 360) % 360,
        dHi: (interp(K.dHi, h, true) + n() * 5 + 360) % 360
      });
    }
    return out;
  }
  const api = { generateDay, STEP_MIN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SpraySim = api;
})(typeof window !== 'undefined' ? window : globalThis);
