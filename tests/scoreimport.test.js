const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const si = require('../scoreimport.js');
const { loadMidi } = require('../midi.js');

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
 <work><work-title>Test &amp; Song</work-title></work>
 <part-list>
  <score-part id="P1"><part-name>Soprano</part-name></score-part>
  <score-part id="P2"><part-name>Bass</part-name></score-part>
 </part-list>
 <part id="P1">
  <measure number="0" implicit="yes">
   <attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
   <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>100</per-minute></metronome></direction-type></direction>
   <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><lyric number="1"><syllabic>single</syllabic><text>Oh</text></lyric></note>
  </measure>
  <measure number="1">
   <barline location="left"><repeat direction="forward"/></barline>
   <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><lyric number="1"><syllabic>begin</syllabic><text>Hel</text></lyric><lyric number="2"><syllabic>begin</syllabic><text>Sec</text></lyric></note>
   <note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><lyric number="1"><syllabic>end</syllabic><text>lo</text></lyric><lyric number="2"><syllabic>end</syllabic><text>ond</text></lyric></note>
   <note><pitch><step>E</step><alter>-1</alter><octave>5</octave></pitch><duration>2</duration><tie type="start"/><voice>1</voice></note>
  </measure>
  <measure number="2">
   <note><pitch><step>E</step><alter>-1</alter><octave>5</octave></pitch><duration>4</duration><tie type="stop"/><voice>1</voice></note>
   <note><grace/><pitch><step>F</step><octave>5</octave></pitch><voice>1</voice></note>
   <note><rest/><duration>4</duration><voice>1</voice></note>
   <barline location="right"><repeat direction="backward"/></barline>
  </measure>
  <measure number="3">
   <note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice></note>
  </measure>
 </part>
 <part id="P2">
  <measure number="0" implicit="yes">
   <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><transpose><chromatic>0</chromatic><octave-change>-1</octave-change></transpose></attributes>
   <note><pitch><step>G</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice></note>
  </measure>
  <measure number="1"><note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>1</voice></note></measure>
  <measure number="2"><note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>1</voice></note></measure>
  <measure number="3"><note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>1</voice></note></measure>
 </part>
</score-partwise>`;

(async () => {
  // XML reader
  const t = si.parseXml('<a x="1 &gt; 0"><!-- c --><b>t&amp;u</b><c/><![CDATA[<raw>]]></a>');
  assert.strictEqual(t.attrs.x, '1 > 0'); assert.strictEqual(t.kids[0].text, 't&u'); assert.ok(t.text.includes('<raw>'));

  // MusicXML -> MIDI -> app score
  const r = await si.convert(Buffer.from(XML), 'test.musicxml');
  assert.strictEqual(r.title, 'Test & Song');
  assert.strictEqual(r.pickup, 1, 'one-beat pickup');
  assert.ok(r.warnings.some((w) => /Grace/.test(w)) && r.warnings.some((w) => /Repeats/.test(w)));
  assert.strictEqual(r.played, 6, 'measures 1 and 2 are played twice');
  const sc = loadMidi(r.bytes, 'test.musicxml');
  assert.deepStrictEqual(sc.parts.map((p) => p.name), ['Soprano', 'Bass']);
  const S = sc.parts[0], B = sc.parts[1];
  assert.strictEqual(B.notes[0].midi, 43, 'octave-change -1 moves G3 (55) to G2 (43)');
  // pickup + 2 bars twice + final bar: 1+4+4+4+4+4 beats at 100 bpm; tie merged into one long note
  const sp = (60 / 100);
  assert.ok(Math.abs(S.notes[0].start) < 1e-6 && Math.abs(S.notes[0].end - sp) < 1e-3, 'pickup note is one beat');
  const eb = S.notes.filter((n) => n.midi === 75);
  assert.strictEqual(eb.length, 2, 'the tied E-flat is one note per pass');
  assert.ok(Math.abs((eb[0].end - eb[0].start) - 3 * sp) < 1e-3, 'tied note lasts 3 beats (1 + 2)');
  assert.strictEqual(S.notes.filter((n) => n.midi === 77).length, 0, 'grace note left out');
  const words = S.lyrics.map((l) => l.text || l.syllable || JSON.stringify(l));
  assert.ok(words.length >= 5, 'lyrics were read: ' + JSON.stringify(S.lyrics.slice(0, 3)));
  assert.strictEqual(B.lyrics.length, 0, 'the bass has no lyrics of its own');
  // verse 2 on the second pass
  const flat = JSON.stringify(S.lyrics);
  assert.ok(flat.includes('Hel') && flat.includes('Sec') && flat.includes('ond'), 'verse 1 first time, verse 2 second time: ' + flat);

  // zipped: .mxl and .mscz
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-'));
  fs.writeFileSync(path.join(dir, 'score.xml'), XML);
  fs.mkdirSync(path.join(dir, 'META-INF'));
  fs.writeFileSync(path.join(dir, 'META-INF', 'container.xml'), '<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>');
  const mxl = path.join(dir, 'a.mxl');
  cp.execFileSync('python3', ['-I', '-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED);z.write(sys.argv[2],"META-INF/container.xml");z.write(sys.argv[3],"score.xml");z.close()', mxl, path.join(dir, 'META-INF', 'container.xml'), path.join(dir, 'score.xml')]);
  const r2 = await si.convert(fs.readFileSync(mxl), 'a.mxl');
  assert.strictEqual(r2.played, 6);

  const MSCX = `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="4.20"><Score>
 <metaTag name="workTitle">MS Song</metaTag>
 <Part><Staff id="1"/><trackName>Tenor</trackName><Instrument id="tenor"><longName>Tenor</longName></Instrument></Part>
 <Part><Staff id="2"/><trackName>Bass</trackName></Part>
 <Staff id="1">
  <Measure len="1/4"><voice><TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig><Tempo><tempo>2</tempo></Tempo>
    <Chord><durationType>quarter</durationType><Lyrics><syllabic>begin</syllabic><text>Hel</text></Lyrics><Note><pitch>60</pitch><tpc>14</tpc></Note></Chord></voice></Measure>
  <Measure><voice>
    <Chord><durationType>half</durationType><dots>1</dots><Lyrics><syllabic>end</syllabic><text>lo</text></Lyrics><Note><pitch>62</pitch><Spanner type="Tie"><Tie/><next><location><fractions>1/4</fractions></location></next></Spanner></Note></Chord>
    <Chord><durationType>quarter</durationType><Note><pitch>62</pitch><Spanner type="Tie"><prev><location><fractions>-1/4</fractions></location></prev></Spanner></Note></Chord></voice></Measure>
  <Measure><voice><Tuplet><normalNotes>2</normalNotes><actualNotes>3</actualNotes><baseNote>eighth</baseNote></Tuplet>
    <Chord><durationType>eighth</durationType><Note><pitch>64</pitch></Note></Chord><Chord><durationType>eighth</durationType><Note><pitch>65</pitch></Note></Chord><Chord><durationType>eighth</durationType><Note><pitch>67</pitch></Note></Chord><endTuplet/>
    <Rest><durationType>measure</durationType><duration>4/4</duration></Rest></voice></Measure>
 </Staff>
 <Staff id="2">
  <Measure len="1/4"><voice><Rest><durationType>quarter</durationType></Rest></voice></Measure>
  <Measure><voice><Chord><durationType>whole</durationType><Note><pitch>48</pitch></Note></Chord></voice></Measure>
  <Measure><voice><Chord><durationType>whole</durationType><Note><pitch>43</pitch></Note></Chord></voice></Measure>
 </Staff>
</Score></museScore>`;
  const r3 = await si.convert(Buffer.from(MSCX), 'ms.mscx');
  assert.strictEqual(r3.pickup, 1);
  const s3 = loadMidi(r3.bytes, 'ms.mscx');
  assert.deepStrictEqual(s3.parts.map((p) => p.name), ['Tenor', 'Bass']);
  const T = s3.parts[0].notes, bps = 2;   // tempo 2 quarters per second
  assert.ok(Math.abs(T[0].end - T[0].start - 1 / bps) < 1e-3, 'pickup quarter');
  const tied = T.filter((n) => n.midi === 62);
  assert.strictEqual(tied.length, 1, 'tie merged'); assert.ok(Math.abs(tied[0].end - tied[0].start - 4 / bps) < 1e-3, 'dotted half (3 beats) tied to a quarter (1 beat)');
  const trip = T.filter((n) => [64, 65, 67].includes(n.midi));
  assert.ok(Math.abs(trip[0].end - trip[0].start - (1 / 3) / bps) < 2e-3, 'triplet eighth is a third of a beat');
  assert.ok(JSON.stringify(s3.parts[0].lyrics).includes('Hel'));
  const z3 = path.join(dir, 'b.mscz'), mf = path.join(dir, 'score.mscx');
  fs.writeFileSync(mf, MSCX);
  cp.execFileSync('python3', ['-I', '-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED);z.write(sys.argv[2],"score.mscx");z.writestr("Thumbnails/thumbnail.png",b"x");z.close()', z3, mf]);
  const r4 = await si.convert(fs.readFileSync(z3), 'b.mscz');
  assert.strictEqual(r4.pickup, 1);

  // errors
  await assert.rejects(() => si.convert(Buffer.from('<score-timewise/>'), 'x.xml'), /timewise/);
  await assert.rejects(() => si.convert(Buffer.from('hello'), 'x.xml'), /could not be read|does not look/);
  console.log('scoreimport tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
