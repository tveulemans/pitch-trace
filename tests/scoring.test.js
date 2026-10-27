'use strict';
const assert = require('node:assert/strict');
const sc = require('../scoring.js');

const notes = [{ start: 0, end: 2, midi: 60 }, { start: 2, end: 4, midi: 62 }];
const frames = (fn, from, to, dt = 0.033) => { const out = []; for (let t = from; t < to; t += dt) out.push({ t, m: fn(t), dt }); return out; };
const sing = (m1, m2) => frames((t) => (t < 2 ? m1 : m2), 0, 4);

// Perfect singing finds every note at every level.
{
  const r = sc.scoreRun(notes, sing(60, 62), { level: 5 });
  assert.deepEqual(r.levels, [100, 100, 100, 100, 100]);
  assert.ok(r.inTune >= 99 && r.sung >= 99);
  assert.equal(r.dist, 0); assert.equal(r.bias, 0);
  assert.equal(sc.scoreRun(notes, [], { level: 1 }).found, 0);
}
// Being 1.4 semitones low: found at level 1 only, direction and distance reported.
{
  const r = sc.scoreRun(notes, sing(58.6, 60.6), { level: 2 });
  assert.deepEqual(r.levels, [100, 0, 0, 0, 0]);
  assert.equal(r.found, 0);
  assert.equal(r.lowN, 2); assert.equal(r.highN, 0);
  assert.ok(Math.abs(r.lowAvg + 1.4) < 0.01 && Math.abs(r.dist - 1.4) < 0.01 && Math.abs(r.bias + 1.4) < 0.01);
  assert.equal(r.weakest[0].pct, 0);
  assert.ok(r.weakest[0].off < -1.3);
}
// A neighbouring note earns no credit: singing the second note's pitch during the first misses it.
{
  const r = sc.scoreRun(notes, sing(62, 62), { level: 3 });
  assert.equal(r.found, 50);
  assert.ok(Math.abs(r.dist - 1) < 0.01);
}
// Octaves count only when folding is on.
{
  const f = sing(48, 74);
  assert.equal(sc.scoreRun(notes, f, { level: 3, fold: true }).found, 100);
  assert.equal(sc.scoreRun(notes, f, { level: 3, fold: false }).found, 0);
}
// Half the note sung right still finds it; a short blip does not.
{
  const half = frames(() => 60, 0.7, 1.5).concat(frames(() => 62, 2, 4));
  assert.equal(sc.scoreRun(notes, half, { level: 3 }).found, 100);
  const blip = frames(() => 60, 0.7, 0.9).concat(frames(() => 62, 2, 4));
  const r = sc.scoreRun(notes, blip, { level: 3 });
  assert.equal(r.found, 50);
  assert.equal(r.silentN, 1);
}
// Steadiness: +-20 cents wobble around the target is measured.
{
  let s = 1;
  const r = sc.scoreRun(notes, frames((t) => (t < 2 ? 60 : 62) + (s = -s) * 0.2, 0, 4), { level: 1 });
  assert.ok(Math.abs(r.wobble - 20) < 2, 'wobble ' + r.wobble);
}
// Only notes that ended before "until" count; the settling time is forgiven.
{
  assert.equal(sc.scoreRun(notes, sing(60, 62), { until: 2.1 }).notes, 1);
  assert.equal(sc.scoreRun(notes, [], { until: 0.5 }), null);
  const late = frames((t) => (t % 2 < 0.2 ? 63 : t < 2 ? 60 : 62), 0, 4);
  assert.equal(sc.scoreRun(notes, late, { level: 5 }).found, 100);
}
assert.deepEqual(sc.rolling([10, 20, 30], 2), [10, 15, 25]);
assert.equal(sc.summarize([]), null);
{
  const s = sc.summarize([50, 60, 70, 80, 90, 95]);
  assert.equal(s.best, 95); assert.equal(s.k, 3); assert.equal(s.first5, 60);
  assert.equal(sc.summarize([3, 2, 1, 2], true).best, 1);
}
console.log('scoring tests passed');
