// Run with: node tests/pitch.test.js
const assert = require('node:assert/strict');
const { yin, median, FMIN, FMAX } = require('../pitch.js');

const SR = 48000, N = 2048;

function tone(f, harmonics) {
  const x = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let h = 1; h <= harmonics; h++) s += Math.sin((2 * Math.PI * f * h * i) / SR) / h;
    x[i] = 0.2 * s;
  }
  return x;
}

const cents = (measured, expected) => 1200 * Math.log2(measured / expected);

// Notes from the bass to the soprano range, as a pure tone and as a voice-like harmonic tone.
for (const f of [82.41, 98, 110, 130.81, 146.83, 196, 261.63, 329.63, 440, 523.25, 659.26, 880, 1046.5]) {
  for (const harmonics of [1, 5]) {
    const r = yin(tone(f, harmonics), SR, FMIN, FMAX);
    assert.ok(r, `no pitch for ${f} Hz (${harmonics} harmonics)`);
    assert.ok(Math.abs(cents(r.freq, f)) < 3, `${f} Hz measured ${r.freq.toFixed(2)} Hz`);
    assert.ok(r.clarity > 0.9, `${f} Hz clarity ${r.clarity.toFixed(2)}`);
  }
}

// A slightly flat note must read as flat.
{
  const flat = 220 * Math.pow(2, -15 / 1200);
  const r = yin(tone(flat, 4), SR, FMIN, FMAX);
  assert.ok(Math.abs(cents(r.freq, 220) + 15) < 2);
}

// Noise gives no confident pitch.
{
  let seed = 1;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const noise = new Float32Array(N).map(() => (rnd() - 0.5) * 0.2);
  const r = yin(noise, SR, FMIN, FMAX);
  assert.ok(r === null || r.clarity < 0.8);
}

// Median helper.
assert.equal(median([3, 1, 2]), 2);
assert.equal(median([4, 1, 3, 2]), 2.5);

console.log('pitch tests passed');
