'use strict';
const assert = require('node:assert/strict');
const ex = require('../exercises.js');
const { loadMidi } = require('../midi.js');

const cases = [];
for (const e of ex.list) for (const v of (e.variants || [null])) cases.push([e, v]);
for (const [e, v] of cases) {
  const sp = v ? ex.spanOf(v) : ex.spanOf(e);
  for (const [lo, hi] of [[40, 62], [43, 60], [40, 48], [55, 55]]) {
    const r = ex.build(e.id, lo, hi, 1, { variant: v && v.id });
    const sc = loadMidi(r.bytes, 'x.mid');
    const p = sc.parts[r.partIndex || 0];
    assert.ok(p.notes.length > 0, e.id);
    assert.ok(p.lo >= lo, e.id + ' stays above the lowest note');
    assert.ok(p.hi <= r.hi, e.id + ' stays below the highest note');
    if (!e.callResponse) assert.equal(p.lyrics.length, p.notes.length, e.id + ' has a syllable per note');
    assert.equal(sc.meterAt(0).num, 4);
    const barSec = sc.meterAt(0).beatSec * 4, nb = sc.durationSec / barSec;
    assert.ok(Math.abs(nb - Math.round(nb)) < 1e-6, e.id + ' fills whole bars');
    if (hi - lo < sp) assert.ok(r.widened);
  }
}
// Starts in the middle of the range, visits both ends.
{
  const sc = loadMidi(ex.build('scales', 40, 64, 1, { variant: 'five' }).bytes, 'x.mid');
  const n = sc.parts[0].notes;
  assert.ok(n[0].midi > 40 && n[0].midi < 60);
  assert.equal(sc.parts[0].lo, 40);
  assert.equal(sc.parts[0].hi, 64);
}
// Hold the note, from memory: a call track and an answer track with the same pitches, the answer after the call.
{
  const r = ex.build('single', 40, 62, 7, { mode: 'memory', seconds: 10 });
  const sc = loadMidi(r.bytes, 'x.mid');
  assert.deepEqual(sc.parts.map((p) => p.name), ['Call', 'Your turn']);
  const [c, a] = sc.parts;
  assert.equal(c.notes.length, r.reps); assert.equal(a.notes.length, r.reps);
  c.notes.forEach((n, i) => {
    assert.equal(n.midi, a.notes[i].midi);
    assert.ok(n.midi >= 40 && n.midi <= 62);
    assert.ok(a.notes[i].start > n.end);
    assert.ok(Math.abs(a.notes[i].end - a.notes[i].start - 10) < 1e-6, 'held for the requested seconds');
    assert.ok(Math.abs(n.end - n.start - 4) < 1e-6, 'the call lasts four seconds');
    if (i) assert.notEqual(n.midi, c.notes[i - 1].midi);
  });
  assert.deepEqual(ex.build('single', 40, 62, 7, { mode: 'memory', seconds: 10 }).bytes, r.bytes);   // same seed, same exercise
  assert.notDeepEqual(Array.from(ex.build('single', 40, 62, 8, { mode: 'memory', seconds: 10 }).bytes), Array.from(r.bytes));
  assert.equal(r.partIndex, 1); assert.equal(r.callResponse, true);
}
// Hold the note, with the guide tone: one track, longer notes when asked.
{
  const short = ex.build('single', 40, 62, 7, { mode: 'guide', seconds: 5 }), long = ex.build('single', 40, 62, 7, { mode: 'guide', seconds: 12 });
  const s = loadMidi(short.bytes, 'x'), l = loadMidi(long.bytes, 'x');
  assert.equal(s.parts.length, 1); assert.equal(short.callResponse, false);
  assert.ok(Math.abs(s.parts[0].notes[0].end - s.parts[0].notes[0].start - 5) < 1e-6);
  assert.ok(Math.abs(l.parts[0].notes[0].end - l.parts[0].notes[0].start - 12) < 1e-6);
  assert.equal(l.parts[0].lyrics.length, l.parts[0].notes.length);
  assert.ok(l.durationSec > 120 && l.durationSec < 240, 'about three minutes');
  assert.ok(!ex.list.some((e) => ['long', 'find', 'five', 'arp', 'leaps', 'scale', 'hold'].includes(e.id)), 'old exercises are merged');
  assert.equal(ex.list.length, 3);
}
assert.equal(loadMidi(ex.build('scales', 40, 64, 1, { variant: 'five' }).bytes, 'x').parts[0].lyrics[0].text, 'Do');
assert.throws(() => ex.build('nope', 40, 60), /Unknown/);
console.log('exercise tests passed');
