/* Scores one practice run and summarises runs over time. Pure functions, no browser needed.

   A run is the list of target notes plus the frames collected while singing: {t, e, dt}, where t is the score time
   in seconds, e the error against the target note in semitones, and dt the score time each frame stands for.
   A note scores the share of its time spent within `good` cents. The first part of each note is skipped, because
   nobody lands on a note instantly. Silence, or a different note, counts as out of tune. */
(function (root) {
  'use strict';

  const SETTLE_FRAC = 0.3, SETTLE_MAX = 0.35, MIN_WINDOW = 0.12;

  function scoreRun(notes, frames, opts) {
    const good = ((opts && opts.good) || 15) / 100;          // semitones
    const until = opts && opts.until != null ? opts.until : Infinity;
    let fi = 0, win = 0, goodT = 0, voicedT = 0, n = 0;
    let sumE = 0, sumW = 0;                                  // for the bias
    const per = [];                                          // per note: {midi, pct, sung, mean, wsum, sq}
    for (const note of notes) {
      if (note.end > until + 0.05) break;
      const d = note.end - note.start;
      const ws = note.start + Math.min(SETTLE_MAX, SETTLE_FRAC * d), we = note.end - 0.05;
      const wd = we - ws;
      if (wd < MIN_WINDOW) continue;
      while (fi < frames.length && frames[fi].t < ws) fi++;
      let g = 0, v = 0, se = 0, sq = 0;
      for (let k = fi; k < frames.length && frames[k].t < we; k++) {
        const f = frames[k];
        v += f.dt; se += f.e * f.dt; sq += f.e * f.e * f.dt;
        if (Math.abs(f.e) <= good) g += f.dt;
      }
      v = Math.min(v, wd); g = Math.min(g, v);
      const mean = v > 0 ? se / v : 0;
      per.push({ midi: note.midi, pct: g / wd, sung: v / wd, mean, var: v > 0 ? Math.max(0, sq / v - mean * mean) : 0, w: v, wd });
      win += wd; goodT += g; voicedT += v; sumE += se; sumW += v; n++;
    }
    if (!n) return null;
    let varSum = 0;
    for (const p of per) varSum += p.var * p.w;
    const weak = new Map();
    for (const p of per) {
      const w = weak.get(p.midi) || { midi: p.midi, g: 0, d: 0 };
      w.g += p.pct * p.wd; w.d += p.wd; weak.set(p.midi, w);
    }
    const weakest = Array.from(weak.values()).map((w) => ({ midi: w.midi, pct: w.g / w.d }))
      .sort((a, b) => a.pct - b.pct || a.midi - b.midi);
    return {
      score: Math.round((100 * goodT) / win),
      sung: Math.round((100 * voicedT) / win),
      bias: sumW > 0 ? Math.round((100 * sumE) / sumW * 10) / 10 : 0,       // cents; positive is sharp
      wobble: sumW > 0 ? Math.round(100 * Math.sqrt(varSum / sumW) * 10) / 10 : 0,  // cents
      notes: n,
      weakest,
    };
  }

  /* Average of the last n values at every position (shorter at the start). */
  function rolling(values, n) {
    return values.map((_, i) => {
      const s = values.slice(Math.max(0, i - n + 1), i + 1);
      return s.reduce((a, b) => a + b, 0) / s.length;
    });
  }

  function summarize(values) {
    if (!values.length) return null;
    const k = Math.min(5, Math.floor(values.length / 2));
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    return {
      runs: values.length,
      best: Math.max.apply(null, values),
      last: values[values.length - 1],
      first5: k ? avg(values.slice(0, k)) : null,
      last5: k ? avg(values.slice(-k)) : null,
      k,
    };
  }

  const api = { scoring: { scoreRun, rolling, summarize } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api.scoring;
  root.PitchTrace = Object.assign(root.PitchTrace || {}, api);
})(typeof self !== 'undefined' ? self : this);
