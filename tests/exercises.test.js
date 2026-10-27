'use strict';
const assert = require('node:assert/strict');
const ex = require('../exercises.js');
const { loadMidi } = require('../midi.js');

for (const e of ex.list) {
  for (const [lo, hi] of [[40, 62], [43, 60], [40, 48], [55, 55]]) {
    const r = ex.build(e.id, lo, hi);
    const sc = loadMidi(r.bytes, 'x.mid');
    const p = sc.parts[r.partIndex || 0];
    assert.ok(p.notes.length > 0, e.id);
    assert.ok(p.lo >= lo, e.id + ' stays above the lowest note');
    assert.ok(p.hi <= r.hi, e.id + ' stays below the highest note');
    if (!e.callResponse) assert.equal(p.lyrics.length, p.notes.length, e.id + ' has a syllable per note');
    assert.equal(sc.meterAt(0).num, 4);
    const barSec = sc.meterAt(0).beatSec * 4, nb = sc.durationSec / barSec;
    assert.ok(Math.abs(nb - Math.round(nb)) < 1e-6, e.id + ' fills whole bars');
    if (hi - lo < ex.spanOf(e)) assert.ok(r.widened);
  }
}
// Starts in the middle of the range, visits both ends.
{
  const sc = loadMidi(ex.build('five', 40, 64).bytes, 'x.mid');
  const n = sc.parts[0].notes;
  assert.ok(n[0].midi > 40 && n[0].midi < 60);
  assert.equal(sc.parts[0].lo, 40);
  assert.equal(sc.parts[0].hi, 64);
}
// Find the note: a call track and an answer track with the same pitches, the answer one beat after the call ends.
{
  const r = ex.build('find', 40, 62, 7);
  const sc = loadMidi(r.bytes, 'x.mid');
  assert.deepEqual(sc.parts.map((p) => p.name), ['Call', 'Your turn']);
  const [c, a] = sc.parts;
  assert.equal(c.notes.length, 12); assert.equal(a.notes.length, 12);
  c.notes.forEach((n, i) => {
    assert.equal(n.midi, a.notes[i].midi);
    assert.ok(n.midi >= 40 && n.midi <= 62);
    assert.ok(a.notes[i].start > n.end);
    if (i) assert.notEqual(n.midi, c.notes[i - 1].midi);
  });
  assert.deepEqual(ex.build('find', 40, 62, 7).bytes, r.bytes);                  // same seed, same exercise
  assert.notDeepEqual(Array.from(ex.build('find', 40, 62, 8).bytes), Array.from(r.bytes));
  assert.equal(r.partIndex, 1);
}
assert.equal(loadMidi(ex.build('five', 40, 64).bytes, 'x').parts[0].lyrics[0].text, 'Do');
assert.throws(() => ex.build('nope', 40, 60), /Unknown/);
console.log('exercise tests passed');
