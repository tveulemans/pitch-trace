/* Scores one practice run and summarises runs over time. Pure functions, no browser needed.

   A run is the list of target notes plus the frames collected while singing: {t, m, dt}, where t is the score time
   in seconds, m the pitch you sang (MIDI number with decimals) and dt the score time the frame stands for.
   Each frame is compared with the note you should be singing at that moment, never with a neighbouring note.
   With `fold` an octave too high or low is accepted.

   The headline is "notes found": a note is found when you were within the level's tolerance for at least half of it.
   The levels run from wide to strict, so the score can start high and grow with you. The first part of each note is
   skipped, because nobody lands on a note instantly. */
(function (root) {
  'use strict';

  const LEVELS = [2, 1, 0.5, 0.25, 0.15];                    // tolerance in semitones
  const LEVEL_NAMES = ['±2 semitones', '±1 semitone', '±50 cents', '±25 cents', '±15 cents'];
  const SETTLE_FRAC = 0.3, SETTLE_MAX = 0.35, MIN_WINDOW = 0.12, FOUND_SHARE = 0.5, SUNG_SHARE = 0.25;

  const fold = (x) => ((((x + 6) % 12) + 12) % 12) - 6;
  const median = (a) => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100;

  function scoreRun(notes, frames, opts) {
    opts = opts || {};
    const level = Math.min(LEVELS.length, Math.max(1, opts.level || 1));
    const until = opts.until != null ? opts.until : Infinity;
    const doFold = !!opts.fold;
    let fi = 0, win = 0, voicedT = 0, wsum = 0, vsum = 0;
    const per = [];
    for (const note of notes) {
      if (note.end > until + 0.05) break;
      const d = note.end - note.start;
      const ws = note.start + Math.min(SETTLE_MAX, SETTLE_FRAC * d), we = note.end - 0.05;
      const wd = we - ws;
      if (wd < MIN_WINDOW) continue;
      while (fi < frames.length && frames[fi].t < ws) fi++;
      const errs = [], dts = [];
      let v = 0;
      for (let k = fi; k < frames.length && frames[k].t < we; k++) {
        const x = frames[k].m - note.midi;
        errs.push(doFold ? fold(x) : x); dts.push(frames[k].dt); v += frames[k].dt;
      }
      v = Math.min(v, wd);
      const sung = v / wd >= SUNG_SHARE;
      const within = LEVELS.map((tol) => { let g = 0; for (let k = 0; k < errs.length; k++) if (Math.abs(errs[k]) <= tol) g += dts[k]; return Math.min(g, wd); });
      let mean = 0, varw = 0, med = null;
      if (errs.length) {
        med = median(errs);
        let tot = 0, se = 0;
        for (let k = 0; k < errs.length; k++) { tot += dts[k]; se += errs[k] * dts[k]; }
        mean = se / tot;
        for (let k = 0; k < errs.length; k++) varw += (errs[k] - mean) * (errs[k] - mean) * dts[k];
        varw /= tot;
      }
      per.push({ midi: note.midi, wd, v, sung, med, within, found: within.map((g) => g / wd >= FOUND_SHARE), varw });
      win += wd; voicedT += v;
      if (sung) { wsum += v; vsum += varw * v; }
    }
    if (!per.length) return null;
    const n = per.length;
    const levels = LEVELS.map((_, i) => Math.round((100 * per.filter((p) => p.found[i]).length) / n));
    const L = level - 1;
    const sungNotes = per.filter((p) => p.sung);
    const missed = sungNotes.filter((p) => !p.found[L]);
    const lows = missed.filter((p) => p.med < 0), highs = missed.filter((p) => p.med > 0);
    const avg = (a) => (a.length ? a.reduce((s, p) => s + p.med, 0) / a.length : 0);
    const byNote = new Map();
    for (const p of per) {
      const w = byNote.get(p.midi) || { midi: p.midi, n: 0, found: 0, sum: 0, sungN: 0 };
      w.n++; if (p.found[L]) w.found++;
      if (p.sung) { w.sum += p.med; w.sungN++; }
      byNote.set(p.midi, w);
    }
    const weakest = Array.from(byNote.values())
      .map((w) => ({ midi: w.midi, pct: w.found / w.n, off: w.sungN ? w.sum / w.sungN : null }))
      .sort((a, b) => a.pct - b.pct || a.midi - b.midi);
    return {
      level,
      found: levels[L],
      foundCount: per.filter((p) => p.found[L]).length,
      levels,
      notes: n,
      inTune: Math.round((100 * per.reduce((s, p) => s + p.within[L], 0)) / win),
      sung: Math.round((100 * voicedT) / win),
      dist: sungNotes.length ? r2(sungNotes.reduce((s, p) => s + Math.abs(p.med), 0) / sungNotes.length) : null,   // semitones
      bias: sungNotes.length ? r2(avg(sungNotes)) : 0,                                                              // semitones, positive is sharp
      wobble: wsum > 0 ? r1(100 * Math.sqrt(vsum / wsum)) : 0,                                                      // cents
      lowN: lows.length, lowAvg: r2(avg(lows)), highN: highs.length, highAvg: r2(avg(highs)),
      silentN: per.filter((p) => !p.sung).length,
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

  function summarize(values, lowerBetter) {
    if (!values.length) return null;
    const k = Math.min(5, Math.floor(values.length / 2));
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    return {
      runs: values.length,
      best: lowerBetter ? Math.min.apply(null, values) : Math.max.apply(null, values),
      last: values[values.length - 1],
      first5: k ? avg(values.slice(0, k)) : null,
      last5: k ? avg(values.slice(-k)) : null,
      k,
    };
  }

  const api = { scoring: { scoreRun, rolling, summarize, LEVELS, LEVEL_NAMES } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api.scoring;
  root.PitchTrace = Object.assign(root.PitchTrace || {}, api);
})(typeof self !== 'undefined' ? self : this);
