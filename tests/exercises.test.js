'use strict';
const assert = require('node:assert/strict');
const ex = require('../exercises.js');
const { loadMidi } = require('../midi.js');

for (const e of ex.list) {
  for (const [lo, hi] of [[40, 62], [43, 60], [40, 48], [55, 55]]) {
    const r = ex.build(e.id, lo, hi);
    const sc = loadMidi(r.bytes, 'x.mid');
    const p = sc.parts[0];
    assert.ok(p.notes.length > 0, e.id);
    assert.ok(p.lo >= lo, e.id + ' stays above the lowest note');
    assert.ok(p.hi <= r.hi, e.id + ' stays below the highest note');
    assert.equal(p.lyrics.length, p.notes.length, e.id + ' has a syllable per note');
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
assert.equal(loadMidi(ex.build('five', 40, 64).bytes, 'x').parts[0].lyrics[0].text, 'Do');
assert.throws(() => ex.build('nope', 40, 60), /Unknown/);
console.log('exercise tests passed');
