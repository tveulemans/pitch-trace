/* Score import for Pitch Trace: reads MusicXML (.musicxml, .xml, compressed .mxl) and MuseScore files (.mscz, .mscx)
 * and writes them out as a Standard MIDI File, which the app then handles like any other song. Going through MIDI keeps
 * the rest of the app (library, sync, playback, scoring) unchanged, and unlike a MIDI exported by MuseScore, every
 * voice keeps its own lyrics. Repeats are played out, and the verse follows the pass (verse 2 on the second time).
 * Nothing is uploaded: the file is read in the browser. */
(function (root) {
  'use strict';

  const DIV = 480;                        // ticks per quarter note in the generated file
  const MAX_MEASURES = 3000, MAX_NOTES = 400000, MAX_ZIP_ENTRY = 40 * 1024 * 1024;

  /* ---------- a small XML reader (no DOMParser, so it also runs in tests) ---------- */

  function parseXml(s) {
    const top = { name: '#doc', attrs: {}, kids: [], text: '' };
    const stack = [top];
    const dec = (t) => t.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (m, e) => {
      e = e.toLowerCase();
      if (e === 'lt') return '<'; if (e === 'gt') return '>'; if (e === 'amp') return '&'; if (e === 'quot') return '"'; if (e === 'apos') return "'";
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    });
    let i = 0;
    while (i < s.length) {
      const lt = s.indexOf('<', i);
      if (lt < 0) break;
      if (lt > i) stack[stack.length - 1].text += dec(s.slice(i, lt));
      if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt); i = e < 0 ? s.length : e + 3; continue; }
      if (s.startsWith('<![CDATA[', lt)) { const e = s.indexOf(']]>', lt); stack[stack.length - 1].text += s.slice(lt + 9, e < 0 ? s.length : e); i = e < 0 ? s.length : e + 3; continue; }
      if (s.startsWith('<?', lt)) { const e = s.indexOf('?>', lt); i = e < 0 ? s.length : e + 2; continue; }
      if (s[lt + 1] === '!') {                                        // DOCTYPE, possibly with an internal subset
        let depth = 0, j = lt;
        for (; j < s.length; j++) { const c = s[j]; if (c === '[') depth++; else if (c === ']') depth--; else if (c === '>' && depth <= 0) break; }
        i = j + 1; continue;
      }
      let j = lt + 1, q = '';
      for (; j < s.length; j++) { const c = s[j]; if (q) { if (c === q) q = ''; } else if (c === '"' || c === "'") q = c; else if (c === '>') break; }
      const inner = s.slice(lt + 1, j);
      i = j + 1;
      if (inner[0] === '/') { if (stack.length > 1) stack.pop(); continue; }
      const selfClose = inner.endsWith('/');
      const body = selfClose ? inner.slice(0, -1) : inner;
      const nm = /^[^\s/>]+/.exec(body);
      if (!nm) continue;
      const attrs = {};
      const re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let a;
      body.slice(nm[0].length).replace(re, (m, k, v1, v2) => { attrs[k] = dec(v1 != null ? v1 : v2); return m; });
      const el = { name: nm[0], attrs, kids: [], text: '' };
      stack[stack.length - 1].kids.push(el);
      if (!selfClose) stack.push(el);
    }
    return top.kids[0] || null;
  }
  const kid = (el, name) => (el ? el.kids.find((k) => k.name === name) : undefined);
  const kidsOf = (el, name) => (el ? el.kids.filter((k) => k.name === name) : []);
  const txt = (el, name) => { const k = name ? kid(el, name) : el; return k ? k.text.trim() : ''; };
  const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

  /* ---------- zip (.mxl and .mscz are zip files) ---------- */

  const utf8 = (u) => new TextDecoder('utf-8').decode(u);
  async function inflateRaw(data) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open compressed score files. Export the score as uncompressed MusicXML (.musicxml) instead.');
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  function readZip(buf) {
    const u = new Uint8Array(buf), dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    let e = -1;
    for (let i = u.length - 22; i >= Math.max(0, u.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('This is not a valid zip-based score file.');
    const n = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const files = new Map();
    for (let k = 0; k < n; k++) {
      if (p + 46 > u.length || dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      const name = utf8(u.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + el + cl;
      if (name.endsWith('/')) continue;
      files.set(name, async () => {
        if (usize > MAX_ZIP_ENTRY) throw new Error('A file inside the archive is too large.');
        const ln = dv.getUint16(lho + 26, true), le = dv.getUint16(lho + 28, true), start = lho + 30 + ln + le;
        const data = u.subarray(start, start + csize);
        if (method === 0) return data;
        if (method === 8) return inflateRaw(data);
        throw new Error('This archive uses an unsupported compression method.');
      });
    }
    return files;
  }

  /* ---------- what a parsed score looks like ----------
     { title, warnings[], measures: [{ dur, num, den, tempos: [{tick, bpm}], fwd, back, times, ending: [numbers] | null, short }],
       tracks: [{ name, notes: [{ m, tick, dur, midi, tieStart, tieStop, lyrics: [{ order, text }] }] }] }  (ticks: 480 per quarter) */

  const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const BEAT_UNIT = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125, '64th': 0.0625, breve: 8 };

  function lyricText(l) {
    const t = l.texts.join(' ').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    return (l.syllabic === 'begin' || l.syllabic === 'middle') && !/-$/.test(t) ? t + '-' : t;
  }
  function tieNumbers(s) { return String(s || '').split(/[,\s]+/).map((x) => parseInt(x, 10)).filter(Number.isFinite); }

  /* Several voices or staves in one part become separate tracks, so each can be chosen and scored on its own. */
  function nameTracks(parts) {
    const out = [];
    for (const p of parts) {
      const keys = Array.from(p.tracks.keys()).filter((k) => p.tracks.get(k).notes.length);
      keys.sort((a, b) => { const x = a.split('|'), y = b.split('|'); return (+x[0] - +y[0]) || (+x[1] - +y[1]) || (a < b ? -1 : 1); });
      const staves = new Set(keys.map((k) => k.split('|')[0]));
      for (const k of keys) {
        const [s, v] = k.split('|');
        const same = keys.filter((x) => x.split('|')[0] === s).length;
        let name = p.name || 'Part';
        if (keys.length > 1) name += ' · ' + (staves.size > 1 ? 'staff ' + s + (same > 1 ? ' voice ' + v : '') : 'voice ' + v);
        out.push({ name, notes: p.tracks.get(k).notes });
      }
    }
    return out;
  }

  /* ---------- MusicXML ---------- */

  function parseMusicXml(root0) {
    if (!root0 || root0.name !== 'score-partwise') throw new Error(root0 && root0.name === 'score-timewise' ? 'This MusicXML file is in the "timewise" layout, which is not supported. Export it as "partwise".' : 'This does not look like a MusicXML score.');
    const warnings = [];
    const title = txt(kid(root0, 'work'), 'work-title') || txt(root0, 'movement-title');
    const names = {};
    for (const sp of kidsOf(kid(root0, 'part-list'), 'score-part')) names[sp.attrs.id] = txt(sp, 'part-name') || txt(sp, 'part-abbreviation');
    const measures = [];
    const parts = [];
    let graceSkipped = false;
    kidsOf(root0, 'part').forEach((part, pi) => {
      const P = { name: names[part.attrs.id] || '', tracks: new Map() };
      parts.push(P);
      let divisions = 1, transpose = 0, num0 = 4, den0 = 4, ending = null;
      kidsOf(part, 'measure').forEach((me, mi) => {
        if (mi >= MAX_MEASURES) throw new Error('This score has too many measures.');
        const M = measures[mi] || (measures[mi] = { dur: 0, num: null, den: null, tempos: [], fwd: false, back: false, times: 2, ending: null, short: false, implicit: false });
        if (pi === 0) M.implicit = me.attrs.implicit === 'yes' || me.attrs.number === '0';
        const tk = (pos) => Math.round((pos * DIV) / divisions);
        let pos = 0, maxPos = 0, lastStart = 0;
        for (const el of me.kids) {
          if (el.name === 'attributes') {
            const d = num(txt(el, 'divisions'), 0); if (d > 0) divisions = d;
            const t = kid(el, 'time');
            if (t) {
              const b = txt(t, 'beats').split('+').reduce((s, x) => s + (parseInt(x, 10) || 0), 0), bt = parseInt(txt(t, 'beat-type'), 10);
              if (b > 0 && bt > 0) { num0 = b; den0 = bt; }
            }
            const tr = kid(el, 'transpose');
            if (tr) transpose = (parseInt(txt(tr, 'chromatic'), 10) || 0) + 12 * (parseInt(txt(tr, 'octave-change'), 10) || 0);
          } else if (el.name === 'direction' || el.name === 'sound') {
            let bpm = 0;
            const snd = el.name === 'sound' ? el : kid(el, 'sound');
            if (snd && snd.attrs.tempo) bpm = num(snd.attrs.tempo, 0);
            if (!bpm && el.name === 'direction') {
              const dtype = kid(el, 'direction-type');
              const met = dtype ? kid(dtype, 'metronome') : null;
              if (met) {
                const unit = BEAT_UNIT[txt(met, 'beat-unit')] || 1, dots = kidsOf(met, 'beat-unit-dot').length;
                const pm = num(txt(met, 'per-minute'), 0);
                if (pm > 0) bpm = pm * unit * (2 - Math.pow(0.5, dots));
              }
            }
            if (bpm >= 20 && bpm <= 400 && pi === 0) M.tempos.push({ tick: tk(pos), bpm });
          } else if (el.name === 'barline') {
            if (pi === 0) {
              const rep = kid(el, 'repeat');
              if (rep) { if (rep.attrs.direction === 'forward') M.fwd = true; else if (rep.attrs.direction === 'backward') { M.back = true; M.times = Math.max(2, parseInt(rep.attrs.times, 10) || 2); } }
              const en = kid(el, 'ending');
              if (en) {
                if (en.attrs.type === 'start') ending = tieNumbers(en.attrs.number);
                else if (ending && (en.attrs.type === 'stop' || en.attrs.type === 'discontinue')) { M.ending = M.ending || ending; M.endAfter = true; }
              }
            }
          } else if (el.name === 'backup') { pos -= num(txt(el, 'duration'), 0); if (pos < 0) pos = 0; }
          else if (el.name === 'forward') { pos += num(txt(el, 'duration'), 0); maxPos = Math.max(maxPos, pos); }
          else if (el.name === 'note') {
            if (kid(el, 'grace')) { graceSkipped = true; continue; }
            const chord = !!kid(el, 'chord');
            const start = chord ? lastStart : pos;
            const dur = num(txt(el, 'duration'), 0);
            const pitch = kid(el, 'pitch');
            if (pitch && !kid(el, 'cue') && dur > 0) {
              const step = txt(pitch, 'step'), oct = parseInt(txt(pitch, 'octave'), 10);
              if (step in STEP && Number.isFinite(oct)) {
                const midi = 12 * (oct + 1) + STEP[step] + Math.round(num(txt(pitch, 'alter'), 0)) + transpose;
                const key = (txt(el, 'staff') || '1') + '|' + (txt(el, 'voice') || '1');
                if (!P.tracks.has(key)) P.tracks.set(key, { notes: [] });
                const ties = kidsOf(el, 'tie').map((t) => t.attrs.type);
                const lyrics = kidsOf(el, 'lyric').map((l, li) => ({
                  order: num(l.attrs.number, li + 1),
                  text: lyricText({ syllabic: txt(l, 'syllabic'), texts: kidsOf(l, 'text').map((t) => t.text) }),
                })).filter((l) => l.text);
                P.tracks.get(key).notes.push({ m: mi, tick: tk(start), dur: tk(dur), midi, tieStart: ties.includes('start'), tieStop: ties.includes('stop'), lyrics });
              }
            }
            if (!chord) { lastStart = pos; pos += dur; } 
            maxPos = Math.max(maxPos, pos);
          }
        }
        M.dur = Math.max(M.dur, tk(maxPos));
        if (M.num == null) { M.num = num0; M.den = den0; }
        if (pi === 0 && ending && !M.ending) M.ending = ending;
        if (pi === 0 && M.endAfter) ending = null;
      });
    });
    if (graceSkipped) warnings.push('Grace notes were left out.');
    return { title, warnings, measures, tracks: nameTracks(parts) };
  }

  /* ---------- MuseScore (.mscx) ---------- */

  const MS_BASE = { long: 7680, breve: 3840, whole: 1920, half: 960, quarter: 480, eighth: 240, '16th': 120, '32nd': 60, '64th': 30, '128th': 15, '256th': 7.5 };
  const frac = (s) => { const m = /^(-?\d+)\s*\/\s*(\d+)$/.exec(String(s || '').trim()); return m ? parseInt(m[1], 10) / parseInt(m[2], 10) : NaN; };

  function parseMscx(rootEl) {
    if (!rootEl || rootEl.name !== 'museScore') throw new Error('This does not look like a MuseScore file.');
    const score = kid(rootEl, 'Score');
    if (!score) throw new Error('This MuseScore file has no score in it.');
    const warnings = [];
    let title = '';
    for (const mt of kidsOf(score, 'metaTag')) if (mt.attrs.name === 'workTitle' && mt.text.trim()) title = mt.text.trim();
    if (!title) { const vb = kidsOf(score, 'Staff').map((s) => kid(s, 'VBox')).find(Boolean); if (vb) { const t = kidsOf(vb, 'Text').find((x) => txt(x, 'style') === 'Title'); if (t) title = txt(t, 'text'); } }
    const partOfStaff = {}, partList = [];
    for (const p of kidsOf(score, 'Part')) {
      const nm = txt(p, 'trackName') || txt(kid(p, 'Instrument'), 'longName') || txt(kid(p, 'Instrument'), 'trackName') || '';
      const rec = { name: nm, tracks: new Map() };
      partList.push(rec);
      for (const s of kidsOf(p, 'Staff')) partOfStaff[s.attrs.id] = rec;
    }
    const measures = [];
    let sawAdvanced = false;
    kidsOf(score, 'Staff').forEach((staff, si) => {
      const P = partOfStaff[staff.attrs.id] || (() => { const r = { name: '', tracks: new Map() }; partList.push(r); return r; })();
      const first = si === 0;
      let num0 = 4, den0 = 4;
      kidsOf(staff, 'Measure').forEach((me, mi) => {
        if (mi >= MAX_MEASURES) throw new Error('This score has too many measures.');
        const M = measures[mi] || (measures[mi] = { dur: 0, num: null, den: null, tempos: [], fwd: false, back: false, times: 2, ending: null, short: false, implicit: false });
        if (first) {
          if (kid(me, 'startRepeat')) M.fwd = true;
          const er = kid(me, 'endRepeat');
          if (er) { M.back = true; M.times = Math.max(2, parseInt(er.text, 10) || 2); }
        }
        const voices = kidsOf(me, 'voice');
        const lists = voices.length ? voices : [me];
        let nominal = null;
        lists.forEach((vo, vi) => {
          const tuplets = [];
          let pos = 0, maxPos = 0;
          const factor = () => tuplets.reduce((f, t) => f * t.normal / t.actual, 1);
          for (const el of vo.kids) {
            const n = el.name;
            if (n === 'TimeSig') {
              const a = parseInt(txt(el, 'sigN'), 10), b = parseInt(txt(el, 'sigD'), 10);
              if (a > 0 && b > 0) { num0 = a; den0 = b; }
            } else if (n === 'Tempo') {
              const t = num(txt(el, 'tempo'), 0) * 60;
              if (first && vi === 0 && t >= 20 && t <= 400) M.tempos.push({ tick: Math.round(pos), bpm: t });
            } else if (n === 'location') {
              const f = frac(txt(el, 'fractions'));
              if (Number.isFinite(f)) { pos += f * 1920; if (pos < 0) pos = 0; }
            } else if (n === 'Tuplet') {
              tuplets.push({ normal: num(txt(el, 'normalNotes'), 2), actual: num(txt(el, 'actualNotes'), 3) });
            } else if (n === 'endTuplet') { tuplets.pop(); }
            else if (n === 'Volta' || n === 'Jump' || n === 'Marker' || (n === 'Spanner' && el.attrs.type === 'Volta')) sawAdvanced = true;
            else if (n === 'Chord' || n === 'Rest') {
              const isGrace = el.kids.some((k) => /^(acciaccatura|appoggiatura|grace)/.test(k.name));
              if (isGrace) continue;
              const dt = txt(el, 'durationType');
              let d;
              if (dt === 'measure') { const f = frac(txt(el, 'duration')); d = Number.isFinite(f) ? f * 1920 : (nominal != null ? nominal : (num0 * 1920) / den0); }
              else {
                d = MS_BASE[dt] || 0;
                const dots = parseInt(txt(el, 'dots'), 10) || 0;
                d *= 2 - Math.pow(0.5, dots);
                d *= factor();
              }
              if (n === 'Chord' && d > 0) {
                const lyrics = kidsOf(el, 'Lyrics').map((l) => ({
                  order: (parseInt(txt(l, 'no'), 10) || 0) + 1,
                  text: lyricText({ syllabic: txt(l, 'syllabic'), texts: [kidsOf(l, 'text').map((t) => t.text).join('')] }),
                })).filter((l) => l.text);
                const key = String(staff.attrs.id || si + 1) + '|' + (vi + 1);
                for (const note of kidsOf(el, 'Note')) {
                  const midi = parseInt(txt(note, 'pitch'), 10);
                  if (!Number.isFinite(midi)) continue;
                  if (!P.tracks.has(key)) P.tracks.set(key, { notes: [] });
                  const sp = kidsOf(note, 'Spanner').filter((s) => s.attrs.type === 'Tie');
                  P.tracks.get(key).notes.push({
                    m: mi, tick: Math.round(pos), dur: Math.round(d), midi,
                    tieStart: sp.some((s) => kid(s, 'next')), tieStop: sp.some((s) => kid(s, 'prev')), lyrics,
                  });
                }
              }
              pos += d; maxPos = Math.max(maxPos, pos);
            }
          }
          M.dur = Math.max(M.dur, Math.round(maxPos));
        });
        if (me.attrs.len) { const f = frac(me.attrs.len); if (Number.isFinite(f)) { M.dur = Math.round(f * 1920); M.implicit = true; } }
        if (M.num == null) { M.num = num0; M.den = den0; }
      });
    });
    if (sawAdvanced) warnings.push('First and second endings, jumps and codas in MuseScore files are not followed. Export the score as MusicXML to play them.');
    return { title, warnings, measures, tracks: nameTracks(partList) };
  }

  /* ---------- from a parsed score to MIDI ---------- */

  /* Which measure plays when, with repeats played out. pass is 1 the first time through a repeated section. */
  function playOrder(measures) {
    const order = [], n = measures.length, done = {};
    let i = 0, start = 0, pass = 1, guard = 0;
    while (i < n && guard++ < n * 40) {
      const m = measures[i];
      if (m.fwd && start !== i) { start = i; pass = 1; }
      if (m.ending && m.ending.length && !m.ending.includes(pass)) {
        if (m.back && done[i] == null) { /* a skipped ending closes its own repeat: nothing to do */ }
        i++; continue;
      }
      order.push({ k: i, pass });
      if (m.back) {
        const seen = done[i] || 0;
        if (seen < m.times - 1) { done[i] = seen + 1; pass = seen + 2; i = start; continue; }
        done[i] = 0; pass = 1; start = i + 1;
      }
      i++;
    }
    return order;
  }

  const vlq = (n) => { const b = [n & 127]; n >>= 7; while (n) { b.unshift((n & 127) | 128); n >>= 7; } return b; };
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const ascii = (s) => Array.from(String(s), (ch) => ch.charCodeAt(0) & 127);
  const utf8Bytes = (s) => Array.from(new TextEncoder().encode(String(s)));
  const meta = (type, data) => [0xff, type, ...vlq(data.length), ...data];

  function toMidi(model) {
    const { measures } = model;
    if (!measures.length || !model.tracks.length) throw new Error('No notes were found in this score.');
    for (let k = 0; k < measures.length; k++) {
      const m = measures[k];
      if (!m) throw new Error('This score has a gap in its measures.');
      if (!m.num) { m.num = 4; m.den = 4; }
      if (!(m.dur > 0)) m.dur = Math.round((m.num * DIV * 4) / m.den);
    }
    const order = playOrder(measures);
    const warnings = model.warnings.slice();
    if (order.length > measures.length) warnings.push('Repeats are played out (' + measures.length + ' measures become ' + order.length + ').');
    const starts = [];
    let total = 0;
    for (const o of order) { starts.push(total); total += measures[o.k].dur; }
    const byMeasure = (notes) => { const g = []; for (const n of notes) (g[n.m] || (g[n.m] = [])).push(n); return g; };

    let noteCount = 0;
    const tracks = model.tracks.map((tr) => {
      const g = byMeasure(tr.notes);
      const ev = [];
      const open = new Map();
      order.forEach((o, j) => {
        const list = g[o.k];
        if (!list) return;
        for (const n of list) {
          const at = starts[j] + n.tick;
          const key = n.midi;
          const prev = open.get(key);
          if (n.tieStop && prev && prev.end === at) { prev.end = at + n.dur; if (!n.tieStart) open.delete(key); continue; }
          let text = '';
          if (n.lyrics.length) {
            const ls = n.lyrics.slice().sort((a, b) => a.order - b.order);
            text = ls[Math.min(o.pass - 1, ls.length - 1)].text;
          }
          const note = { at, end: at + n.dur, midi: n.midi, text };
          ev.push(note);
          if (n.tieStart) open.set(key, note); else open.delete(key);
          if (++noteCount > MAX_NOTES) throw new Error('This score has too many notes.');
        }
      });
      const events = [];
      for (const n of ev) {
        if (n.text) events.push([n.at, 0, meta(0x05, utf8Bytes(n.text))]);
        events.push([n.at, 2, [0x90, Math.max(0, Math.min(127, n.midi)), 80]]);
        events.push([n.end, 1, [0x80, Math.max(0, Math.min(127, n.midi)), 0]]);
      }
      return { name: tr.name, events };
    });

    // The conductor track: tempo, meter, title.
    const cond = [[0, 0, meta(0x03, utf8Bytes(model.title || 'Score'))]];
    let lastBpm = null, lastSig = '';
    let haveFirst = false;
    order.forEach((o, j) => {
      const m = measures[o.k];
      const sig = m.num + '/' + m.den;
      if (sig !== lastSig) { lastSig = sig; cond.push([starts[j], 0, meta(0x58, [m.num & 255, Math.round(Math.log2(m.den)), 24, 8])]); }
      for (const t of m.tempos.slice().sort((a, b) => a.tick - b.tick)) {
        const at = starts[j] + t.tick;
        if (at === 0) haveFirst = true;
        if (t.bpm === lastBpm) continue;
        lastBpm = t.bpm;
        const us = Math.round(60e6 / t.bpm);
        cond.push([at, 0, meta(0x51, [(us >> 16) & 255, (us >> 8) & 255, us & 255])]);
      }
    });
    if (!haveFirst) cond.push([0, 0, meta(0x51, [0x07, 0xa1, 0x20])]);       // 120 bpm until the score says otherwise

    const writeTrack = (name, events) => {
      const evs = (name == null ? events : [[0, 0, meta(0x03, utf8Bytes(name))], ...events]).slice();
      evs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const body = [];
      let last = 0;
      for (const [at, , bytes] of evs) { body.push(...vlq(at - last), ...bytes); last = at; }
      body.push(...vlq(Math.max(0, total - last)), 0xff, 0x2f, 0);
      return [...ascii('MTrk'), ...u32(body.length), ...body];
    };
    const head = [...ascii('MThd'), ...u32(6), 0, 1, 0, tracks.length + 1, DIV >> 8, DIV & 255];
    const parts = [head, writeTrack(null, cond), ...tracks.map((t) => writeTrack(t.name, t.events))];
    const bytes = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let off = 0;
    for (const p of parts) { bytes.set(p, off); off += p.length; }

    // A short first measure is a pickup; say how many beats it lasts in the way the app counts them.
    const m0 = measures[0];
    const full = Math.round((m0.num * DIV * 4) / m0.den);
    let beatTicks = (DIV * 4) / m0.den;
    if (m0.den >= 8 && m0.num % 3 === 0 && m0.num > 3) beatTicks *= 3;
    let pickup = 0;
    if (m0.dur < full * 0.98 || (m0.implicit && m0.dur < full)) pickup = Math.max(0, Math.min(16, Math.round((m0.dur / beatTicks) * 2) / 2));
    return { bytes, pickup, title: model.title, warnings, measures: measures.length, played: order.length };
  }

  /* ---------- entry point ---------- */

  const decodeText = (u) => utf8(u).replace(/^﻿/, '');
  const isZip = (u) => u.length > 4 && u[0] === 0x50 && u[1] === 0x4b;

  async function convert(buffer, fileName) {
    let u = new Uint8Array(buffer);
    let xml;
    if (isZip(u)) {
      const files = readZip(u);
      const names = Array.from(files.keys());
      let pick = null;
      const mscx = names.filter((n) => /\.mscx$/i.test(n) && !/^excerpts\//i.test(n)).sort((a, b) => a.split('/').length - b.split('/').length)[0];
      if (mscx) pick = mscx;
      else {
        let rootFile = null;
        if (files.has('META-INF/container.xml')) {
          const c = parseXml(decodeText(await files.get('META-INF/container.xml')()));
          const rf = c && (function find(el) { if (el.name === 'rootfile') return el; for (const k of el.kids) { const r = find(k); if (r) return r; } return null; })(c);
          if (rf && rf.attrs['full-path'] && files.has(rf.attrs['full-path'])) rootFile = rf.attrs['full-path'];
        }
        pick = rootFile || names.find((n) => /\.(musicxml|xml)$/i.test(n) && !/^META-INF\//i.test(n));
      }
      if (!pick) throw new Error('No score was found inside this file.');
      u = await files.get(pick)();
    }
    xml = decodeText(u);
    const rootEl = parseXml(xml);
    if (!rootEl) throw new Error('This file could not be read as a score.');
    const model = rootEl.name === 'museScore' ? parseMscx(rootEl) : parseMusicXml(rootEl);
    if (!model.title) model.title = String(fileName || '').replace(/\.[^.]+$/, '').replace(/_/g, ' ');
    return toMidi(model);
  }

  const api = { scoreImport: { convert, parseXml, parseMusicXml, parseMscx, toMidi, playOrder, readZip } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api.scoreImport;
  root.PitchTrace = Object.assign(root.PitchTrace || {}, api);
})(typeof self !== 'undefined' ? self : this);
