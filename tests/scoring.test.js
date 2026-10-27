'use strict';
const assert = require('node:assert/strict');
const sc = require('../scoring.js');

const notes = [{ start: 0, end: 2, midi: 60 }, { start: 2, end: 4, midi: 62 }];
const frames = (fn, from, to, dt = 0.032) => { const out = []; for (let t = from; t < to; t += dt) out.push({ t, e: fn(t), dt }); return out; };

// Perfect singing scores 100; silence scores 0.
{
  const r = sc.scoreRun(notes, frames(() => 0, 0, 4), { good: 15 });
  assert.ok(r.score >= 98, 'perfect: ' + r.score);
  assert.ok(r.sung >= 98);
  assert.equal(r.bias, 0);
  assert.equal(sc.scoreRun(notes, [], { good: 15 }).score, 0);
}
// Singing only the first note scores about half.
{
  const r = sc.scoreRun(notes, frames(() => 0, 0, 2), {});
  assert.ok(r.score > 40 && r.score < 60, 'half: ' + r.score);
  assert.equal(r.weakest[0].midi, 62);
}
// A constant 40 cents sharp is out of tune, with a clear bias and almost no wobble.
{
  const r = sc.scoreRun(notes, frames(() => 0.4, 0, 4), {});
  assert.ok(r.score < 5);
  assert.ok(Math.abs(r.bias - 40) < 1, 'bias ' + r.bias);
  assert.ok(r.wobble < 1);
}
// Wobble of +-20 cents around the target is measured.
{
  let s = 1;
  const r = sc.scoreRun(notes, frames((t) => ((s = -s) * 0.2), 0, 4), {});
  assert.ok(Math.abs(r.wobble - 20) < 2, 'wobble ' + r.wobble);
}
// Only notes that ended before "until" count.
{
  const r = sc.scoreRun(notes, frames(() => 0, 0, 4), { until: 2.1 });
  assert.equal(r.notes, 1);
  assert.equal(sc.scoreRun(notes, [], { until: 0.5 }), null);
}
// The settling time at the start of a note is forgiven.
{
  const r = sc.scoreRun(notes, frames((t) => (t % 2 < 0.2 ? 0.8 : 0), 0, 4), {});
  assert.ok(r.score >= 95, 'settle ' + r.score);
}
assert.deepEqual(sc.rolling([10, 20, 30], 2), [10, 15, 25]);
assert.equal(sc.summarize([]), null);
{
  const s = sc.summarize([50, 60, 70, 80, 90, 95]);
  assert.equal(s.best, 95); assert.equal(s.last, 95); assert.equal(s.k, 3);
  assert.equal(s.first5, 60); assert.ok(Math.abs(s.last5 - 88.3333) < 0.01);
}
console.log('scoring tests passed');
