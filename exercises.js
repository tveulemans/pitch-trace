/* Built-in training exercises. Each one is turned into a small Standard MIDI File (with the syllables as lyric
   events), so the app plays it exactly like a song: scrolling target notes, guide tone, colour-coded trace.
   The pattern is repeated on higher and lower starting notes so that it stays inside the range you give. */
(function (root) {
  'use strict';

  const DIVISION = 480;
  const SYL = { 0: 'Do', 2: 'Re', 4: 'Mi', 5: 'Fa', 7: 'Sol', 9: 'La', 11: 'Si', 12: 'Do' };

  /* notes: [semitones above the starting note, beats]; rest: silent beats before the next repeat.
     Every pattern fills whole 4/4 bars, so the bar numbers stay tidy. */
  const LIST = [
    { id: 'long', name: 'Long notes', bpm: 60, step: 2, lyric: () => 'Ah', notes: [[0, 6]], rest: 2,
      help: 'Hold each note steadily for six beats. Watch the line settle on the bar.' },
    { id: 'five', name: 'Five-note scale', bpm: 80, step: 2, notes: [[0, 1], [2, 1], [4, 1], [5, 1], [7, 1], [5, 1], [4, 1], [2, 1], [0, 2]], rest: 2,
      help: 'Do Re Mi Fa Sol and back. The classic first warm-up.' },
    { id: 'arp', name: 'Do-Mi-Sol', bpm: 76, step: 2, notes: [[0, 1], [4, 1], [7, 1], [4, 1], [0, 2]], rest: 2,
      help: 'The notes of a major chord, one after the other. Trains the jump between notes.' },
    { id: 'leaps', name: 'Leaps from Do', bpm: 66, step: 2, notes: [[0, 2], [7, 2], [0, 2], [4, 2], [0, 2], [9, 2], [0, 2], [12, 2], [0, 2]], rest: 2,
      help: 'Come back to Do after each leap. Do stays the same every time, so you hear whether you drifted.' },
    { id: 'scale', name: 'Major scale', bpm: 80, step: 2, notes: [[0, 1], [2, 1], [4, 1], [5, 1], [7, 1], [9, 1], [11, 1], [12, 1], [11, 1], [9, 1], [7, 1], [5, 1], [4, 1], [2, 1], [0, 2]], rest: 4,
      help: 'A full octave up and down.' },
  ];

  const vlq = (n) => { const b = [n & 127]; n >>= 7; while (n) { b.unshift((n & 127) | 128); n >>= 7; } return b; };
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const meta = (type, data) => [0xff, type, ...vlq(data.length), ...data];
  const ascii = (s) => Array.from(s, (ch) => ch.charCodeAt(0) & 127);

  function spanOf(ex) { return Math.max.apply(null, ex.notes.map((n) => n[0])); }

  /* The starting notes to visit: begin in the middle of the range, go up, then down, then back to the middle. */
  function tonics(lo, hi, span, step) {
    const all = [];
    for (let t = lo; t + span <= hi; t += step) all.push(t);
    if (all.length && all[all.length - 1] + span < hi) all.push(hi - span); // reach the top note too
    if (all.length < 2) return all;
    const n = all.length, m = Math.floor((n - 1) / 2), order = [];
    for (let i = m; i < n; i++) order.push(all[i]);
    for (let i = n - 2; i >= 0; i--) order.push(all[i]);
    for (let i = 1; i <= m; i++) order.push(all[i]);
    return order;
  }

  /* lo and hi are MIDI note numbers. If the range is narrower than the pattern, the top is raised to fit. */
  function build(id, lo, hi) {
    const ex = LIST.find((e) => e.id === id);
    if (!ex) throw new Error('Unknown exercise');
    lo = Math.round(Math.min(lo, hi)); hi = Math.round(Math.max(lo, hi));
    const span = spanOf(ex);
    let widened = false;
    if (hi - lo < span) { hi = lo + span; widened = true; }

    const usPerBeat = Math.round(60e6 / ex.bpm);
    const ev = [];                                   // [absolute tick, bytes]
    ev.push([0, meta(0x51, [(usPerBeat >> 16) & 255, (usPerBeat >> 8) & 255, usPerBeat & 255])]);
    ev.push([0, meta(0x58, [4, 2, 24, 8])]);
    ev.push([0, meta(0x03, ascii('Exercise'))]);

    const list = tonics(lo, hi, span, ex.step);
    let tick = 0, beats = 0;
    for (const t of list) {
      const start = tick;
      for (const [off, len] of ex.notes) {
        const text = ex.lyric ? ex.lyric(off) : (SYL[off] || '');
        if (text) ev.push([tick, meta(0x05, ascii(text))]);
        ev.push([tick, [0x90, t + off, 80]]);
        tick += len * DIVISION;
        ev.push([tick, [0x80, t + off, 0]]);
      }
      tick += ex.rest * DIVISION;
      beats += (tick - start) / DIVISION;
    }
    const pad = (4 - (beats % 4)) % 4;               // whole bars
    tick += pad * DIVISION;

    ev.sort((a, b) => a[0] - b[0] || (a[1][0] === 0x80 ? -1 : 0) - (b[1][0] === 0x80 ? -1 : 0));
    const body = [];
    let last = 0;
    for (const [at, bytes] of ev) { body.push(...vlq(at - last), ...bytes); last = at; }
    body.push(...vlq(Math.max(0, tick - last)), 0xff, 0x2f, 0);

    const bytes = new Uint8Array([
      ...ascii('MThd'), ...u32(6), 0, 1, 0, 1, DIVISION >> 8, DIVISION & 255,
      ...ascii('MTrk'), ...u32(body.length), ...body,
    ]);
    return { name: ex.name, bytes, widened, lo, hi, reps: list.length };
  }

  const api = { exercises: { list: LIST, build, spanOf } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api.exercises;
  root.PitchTrace = Object.assign(root.PitchTrace || {}, api);
})(typeof self !== 'undefined' ? self : this);
