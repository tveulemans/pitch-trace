/* Pitch detection for Pitch Trace: YIN with parabolic interpolation.
 * Classic script (works from file://) that also exports for Node tests. */
(function (root) {
  'use strict';

  const FMIN = 60, FMAX = 1200;
  const dBuf = new Float32Array(1025);

  /* YIN pitch detector (de Cheveigné & Kawahara, 2002) with parabolic interpolation. */
  function yin(x, sr, fmin, fmax) {
    const W = x.length >> 1;
    const tauMin = Math.max(2, Math.floor(sr / fmax));
    const tauMax = Math.min(W - 1, Math.ceil(sr / fmin));
    const cm = dBuf;
    let running = 0;
    cm[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) { const diff = x[j] - x[j + tau]; s += diff * diff; }
      running += s;
      cm[tau] = running > 0 ? (s * tau) / running : 1;
    }
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (cm[t] < 0.12) {
        while (t + 1 <= tauMax && cm[t + 1] < cm[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) {
      let best = tauMin;
      for (let t = tauMin; t <= tauMax; t++) if (cm[t] < cm[best]) best = t;
      if (cm[best] > 0.25) return null;
      tau = best;
    }
    let better = tau;
    if (tau > 1 && tau < tauMax) {
      const a = cm[tau - 1], b = cm[tau], c = cm[tau + 1];
      const den = a - 2 * b + c;
      if (den !== 0) better = tau + (0.5 * (a - c)) / den;
    }
    return { freq: sr / better, clarity: 1 - cm[tau] };
  }

  function median(arr) {
    const s = arr.slice().sort((p, q) => p - q);
    const n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }

  const api = { yin, median, FMIN, FMAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PitchTrace = api;
})(typeof window !== 'undefined' ? window : globalThis);
