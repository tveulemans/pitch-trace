// Run with: node tests/midi.test.js
const assert = require('node:assert/strict');
const { loadMidi } = require('../midi.js');

/* Tiny MIDI writer for test fixtures. */
const vlq = (n) => {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
};
const meta = (type, bytes) => [0xff, type, ...vlq(bytes.length), ...bytes];
const str = (s) => Array.from(Buffer.from(s, 'latin1'));
const tempo = (bpm) => { const us = Math.round(60e6 / bpm); return meta(0x51, [us >> 16, (us >> 8) & 255, us & 255]); };
const meter = (num, den) => meta(0x58, [num, Math.log2(den), 24, 8]);
const track = (events) => {
  const body = [];
  for (const [delta, bytes] of events) body.push(...vlq(delta), ...bytes);
  body.push(0, 0xff, 0x2f, 0);
  return [...str('MTrk'), (body.length >>> 24) & 255, (body.length >> 16) & 255, (body.length >> 8) & 255, body.length & 255, ...body];
};
const smf = (format, division, tracks) =>
  new Uint8Array([...str('MThd'), 0, 0, 0, 6, 0, format, 0, tracks.length, division >> 8, division & 255, ...tracks.flat()]);

/* Format 1, 480 ticks per quarter, 120 bpm, two parts, running status, velocity-0 note off. */
{
  const conductor = track([[0, tempo(120)], [0, meter(4, 4)], [0, meta(0x59, [0xfc, 0])]]); // A-flat major
  const bass = track([
    [0, meta(0x03, str('Bass'))],
    [0, [0x90, 44, 80]], [480, [0x80, 44, 0]],
    [0, [0x90, 46, 80]], [480, [46, 0]],          // running status, velocity-0 note off
    [480, [0x90, 48, 80]], [960, [0x80, 48, 0]],
  ]);
  const tenor = track([[0, meta(0x03, str('Tenor'))], [960, [0x91, 60, 80]], [480, [0x81, 60, 0]]]);
  const sc = loadMidi(smf(1, 480, [conductor, bass, tenor]), 'My_Song.mid');
  assert.equal(sc.title, 'My Song');
  assert.equal(sc.parts.length, 2);
  assert.deepEqual(sc.parts.map((p) => p.name), ['Bass', 'Tenor']);
  assert.equal(sc.flats, true);
  const b = sc.parts[0];
  assert.equal(b.notes.length, 3);
  assert.deepEqual([b.lo, b.hi], [44, 48]);
  assert.ok(Math.abs(b.notes[0].start - 0) < 1e-9 && Math.abs(b.notes[0].end - 0.5) < 1e-9);
  assert.ok(Math.abs(b.notes[1].start - 0.5) < 1e-9 && Math.abs(b.notes[1].end - 1.0) < 1e-9);
  assert.ok(Math.abs(b.notes[2].start - 1.5) < 1e-9 && Math.abs(b.notes[2].end - 2.5) < 1e-9);
  assert.ok(Math.abs(sc.parts[1].notes[0].start - 1.0) < 1e-9);
  assert.ok(Math.abs(sc.durationSec - 2.5) < 1e-9 || sc.durationSec >= 2.5);

  const bars = sc.bars(0);
  assert.equal(bars[0].n, 1);
  assert.ok(Math.abs(bars[1].sec - 2.0) < 1e-9, 'bar 2 starts after 4 beats at 120 bpm');
  assert.equal(bars[0].beats, 4);

  const withPickup = sc.bars(1);
  assert.equal(withPickup[0].n, 0);
  assert.ok(Math.abs(withPickup[1].sec - 0.5) < 1e-9, 'bar 1 starts after a one-beat pickup');
  assert.equal(withPickup[1].n, 1);
  assert.ok(Math.abs(sc.meterAt(0).beatSec - 0.5) < 1e-9);
}

/* Tempo change: 120 bpm for one bar, then 60 bpm. */
{
  const cond = track([[0, tempo(120)], [1920, tempo(60)]]);
  const t = track([[0, [0x90, 60, 90]], [1920, [0x80, 60, 0]], [0, [0x90, 62, 90]], [480, [0x80, 62, 0]]]);
  const sc = loadMidi(smf(1, 480, [cond, t]), 'tempo.mid');
  const n = sc.parts[0].notes;
  assert.ok(Math.abs(n[0].end - 2.0) < 1e-9);
  assert.ok(Math.abs(n[1].start - 2.0) < 1e-9 && Math.abs(n[1].end - 3.0) < 1e-9, 'a quarter at 60 bpm lasts one second');
  assert.ok(Math.abs(sc.secToTick(3.0) - 2400) < 1e-6);
  assert.equal(Math.round(sc.bpmAt(2.5)), 60);
}

/* Meter change 4/4 to 3/4 and compound meter beat. */
{
  const cond = track([[0, meter(4, 4)], [1920, meter(3, 4)], [0, tempo(120)]]);
  const t = track([[0, [0x90, 60, 90]], [3840, [0x80, 60, 0]]]);
  const sc = loadMidi(smf(1, 480, [cond, t]), 'meter.mid');
  const bars = sc.bars(0);
  assert.ok(Math.abs(bars[1].sec - 2.0) < 1e-9);
  assert.ok(Math.abs(bars[2].sec - 3.5) < 1e-9, 'a 3/4 bar lasts 1.5 s at 120 bpm');
  assert.equal(bars[1].beats, 3);
  const six8 = loadMidi(smf(1, 480, [track([[0, meter(6, 8)], [0, tempo(120)]]), t]), 'c.mid');
  assert.equal(six8.meterAt(0).beats, 2);
  assert.ok(Math.abs(six8.meterAt(0).beatSec - 0.75) < 1e-9);
}

/* Format 0 with two channels splits into two parts; drums are ignored. */
{
  const only = track([
    [0, tempo(100)],
    [0, [0x90, 40, 80]], [0, [0x91, 64, 80]], [0, [0x99, 36, 100]],
    [480, [0x80, 40, 0]], [0, [0x81, 64, 0]], [0, [0x89, 36, 0]],
  ]);
  const sc = loadMidi(smf(0, 480, [only]), 'f0.mid');
  assert.equal(sc.parts.length, 2);
  assert.deepEqual(sc.parts.map((p) => p.name), ['Part 1 (ch 1)', 'Part 1 (ch 2)']);
}

/* Dangling notes are closed, same-pitch notes pair first-in first-out. */
{
  const t = track([[0, [0x90, 60, 80]], [100, [0x90, 60, 80]], [100, [0x80, 60, 0]], [100, [0x80, 60, 0]], [0, [0x90, 62, 80]]]);
  const sc = loadMidi(smf(1, 480, [t]), 'x.mid');
  assert.equal(sc.parts[0].notes.length, 3);
}

/* Bad input is refused with a readable message. */
assert.throws(() => loadMidi(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]), 'x'), /not a MIDI file/);
assert.throws(() => loadMidi(smf(1, 0x8000 | 25, [track([])]), 'x'), /SMPTE/);
assert.throws(() => loadMidi(smf(1, 480, [track([[0, tempo(120)]])]), 'x'), /No notes/);
assert.throws(() => loadMidi(smf(2, 480, [track([])]), 'x'), /format 2/);

/* A truncated file still yields what it can. */
{
  const full = smf(1, 480, [track([[0, [0x90, 60, 80]], [480, [0x80, 60, 0]], [0, [0x90, 62, 80]], [480, [0x80, 62, 0]]])]);
  const cut = full.slice(0, full.length - 8);
  const sc = loadMidi(cut, 'cut.mid');
  assert.ok(sc.parts[0].notes.length >= 1);
}

/* Lyric events: syllables, hyphen joins, placeholders, extra verses at the same tick, UTF-8 text. */
{
  const ly = (s) => meta(0x05, Array.from(Buffer.from(s, 'utf8')));
  const t = track([
    [0, tempo(120)],
    [0, ly('Hel-')], [0, [0x90, 60, 80]], [480, [0x80, 60, 0]],
    [0, ly('lo')], [0, ly('verse2')], [0, [0x90, 62, 80]], [480, [0x80, 62, 0]],
    [0, ly('-')], [0, ly('caf\u00e9')], [0, [0x90, 64, 80]], [480, [0x80, 64, 0]],
  ]);
  const sc = loadMidi(smf(1, 480, [t]), 'ly.mid');
  const L = sc.parts[0].lyrics;
  assert.deepEqual(L.map((e) => e.text), ['Hel', 'lo', 'caf\u00e9']);
  assert.deepEqual(L.map((e) => e.join), [true, false, false]);
  assert.ok(Math.abs(L[1].start - 0.5) < 1e-6);
  const none = loadMidi(smf(1, 480, [track([[0, [0x90, 60, 80]], [480, [0x80, 60, 0]]])]), 'n.mid');
  assert.equal(none.parts[0].lyrics.length, 0);
}

/* Space convention (MuseScore 4): a trailing space ends a word, no space means the word goes on. */
{
  const ly = (s) => meta(0x05, Array.from(Buffer.from(s, 'utf8')));
  const tr = track([
    [0, tempo(120)],
    [0, ly('Chil')], [0, [0x90, 60, 80]], [480, [0x80, 60, 0]],
    [0, ly('dren ')], [0, [0x90, 62, 80]], [480, [0x80, 62, 0]],
    [0, ly('du ')], [0, [0x90, 64, 80]], [480, [0x80, 64, 0]],
  ]);
  const L = loadMidi(smf(1, 480, [tr]), 'sp.mid').parts[0].lyrics;
  assert.deepEqual(L.map((e) => e.text), ['Chil', 'dren', 'du']);
  assert.deepEqual(L.map((e) => e.join), [true, false, false]);
  // Events with neither hyphens nor spaces are one word each.
  const tr2 = track([[0, tempo(120)], [0, ly('la')], [0, [0x90, 60, 80]], [480, [0x80, 60, 0]], [0, ly('la')], [0, [0x90, 62, 80]], [480, [0x80, 62, 0]]]);
  assert.deepEqual(loadMidi(smf(1, 480, [tr2]), 'w.mid').parts[0].lyrics.map((e) => e.join), [false, false]);
}

/* A tempo override scales every time: 0.5 plays twice as fast, notes and lyrics together. */
{
  const ly = (s) => meta(0x05, Array.from(Buffer.from(s, 'utf8')));
  const tr = track([[0, tempo(60)], [0, ly('a')], [0, [0x90, 60, 80]], [480, [0x80, 60, 0]], [480, ly('b')], [0, [0x90, 62, 80]], [480, [0x80, 62, 0]]]);
  const bytes = smf(1, 480, [tr]);
  const a = loadMidi(bytes, 'x.mid'), b = loadMidi(bytes, 'x.mid', { tempoScale: 0.5 });
  assert.ok(Math.abs(a.parts[0].notes[1].start - 2) < 1e-6);
  assert.ok(Math.abs(b.parts[0].notes[1].start - 1) < 1e-6);
  assert.ok(Math.abs(b.parts[0].lyrics[1].start - 1) < 1e-6);
  assert.ok(Math.abs(b.durationSec * 2 - a.durationSec) < 1e-6);
  assert.ok(Math.abs(b.bpmAt(0) - 120) < 1e-6);
}

console.log('midi tests passed');
