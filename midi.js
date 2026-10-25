/* Standard MIDI File reader for Pitch Trace.
 * Turns a .mid file into parts with note times in seconds, plus a bar grid.
 * No dependencies. Classic script (works from file://) that also exports for Node tests. */
(function (root) {
  'use strict';

  const MAX_BYTES = 5 * 1024 * 1024;
  const MAX_SECONDS = 2 * 60 * 60;
  const MAX_BARS = 20000;

  const utf8 = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { fatal: true }) : null;
  function decode(bytes) {
    try { if (utf8) return utf8.decode(bytes); } catch (e) { /* not UTF-8, fall through */ }
    let s = '';
    for (let k = 0; k < bytes.length; k++) s += String.fromCharCode(bytes[k]); // Latin-1 for older files
    return s;
  }

  /* ---------- binary parsing ---------- */

  function parseSmf(input) {
    const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (u8.length > MAX_BYTES) throw new Error('This file is too large to be a MIDI score.');
    let p = 0;
    const u32 = () => ((u8[p++] << 24) | (u8[p++] << 16) | (u8[p++] << 8) | u8[p++]) >>> 0;
    const u16 = () => (u8[p++] << 8) | u8[p++];
    const tag = () => String.fromCharCode(u8[p++], u8[p++], u8[p++], u8[p++]);

    if (u8.length < 14 || tag() !== 'MThd') throw new Error('This is not a MIDI file.');
    const headerLen = u32();
    const format = u16();
    u16(); // declared track count; the chunks themselves are authoritative
    const division = u16();
    p = 8 + headerLen;
    if (format > 1) throw new Error('MIDI format 2 is not supported. Export the score again as a standard MIDI file.');
    if (division & 0x8000) throw new Error('This MIDI file uses SMPTE timing, which is not supported.');
    if (!division) throw new Error('This MIDI file has an invalid time division.');

    const tracks = [], tempos = [], meters = [], keys = [];
    let endTick = 0;

    function parseTrack(start, end) {
      const tr = { name: '', notes: [], lyrics: [] };
      const open = new Map(); // channel*128+pitch -> [{tick, vel}]
      let i = start, tick = 0, rs = 0;
      const vlq = () => {
        let v = 0;
        for (let n = 0; n < 4 && i < end; n++) {
          const c = u8[i++];
          v = v * 128 + (c & 0x7f);
          if (!(c & 0x80)) break;
        }
        return v;
      };
      const text = (a, b) => decode(u8.subarray(a, b)).trim();
      const close = (key, at) => {
        const q = open.get(key);
        if (!q || !q.length) return;
        const o = q.shift();
        tr.notes.push({ tick: o.tick, dur: Math.max(1, at - o.tick), midi: key & 127, vel: o.vel, ch: key >> 7 });
      };

      while (i < end) {
        tick += vlq();
        if (i >= end) break;
        const st = u8[i];
        if (st === 0xff) {
          const type = u8[i + 1];
          i += 2;
          const len = vlq();
          const d = i;
          i = Math.min(end, i + len);
          if (type === 0x2f) break;
          if (type === 0x51 && len === 3) tempos.push({ tick, us: (u8[d] << 16) | (u8[d + 1] << 8) | u8[d + 2] });
          else if (type === 0x58 && len >= 2) meters.push({ tick, num: u8[d], den: 1 << u8[d + 1] });
          else if (type === 0x59 && len >= 2) keys.push({ tick, sf: (u8[d] << 24) >> 24 });
          else if (type === 0x03 && !tr.name) tr.name = text(d, i);
          else if (type === 0x05) tr.lyrics.push({ tick, text: decode(u8.subarray(d, i)) });
          continue;
        }
        if (st === 0xf0 || st === 0xf7) {
          i++;
          i = Math.min(end, i + vlq());
          continue;
        }
        if (st > 0xf7) break; // not valid inside a file
        if (st & 0x80) { rs = st; i++; } else if (!rs) break;
        const hi = rs & 0xf0, ch = rs & 0x0f;
        const a = u8[i++];
        if (hi === 0xc0 || hi === 0xd0) continue;
        const b = u8[i++];
        if (a === undefined || b === undefined) break;
        const key = ch * 128 + a;
        if (hi === 0x90 && b > 0) {
          if (!open.has(key)) open.set(key, []);
          open.get(key).push({ tick, vel: b });
        } else if (hi === 0x80 || hi === 0x90) {
          close(key, tick);
        }
      }
      for (const key of Array.from(open.keys())) while ((open.get(key) || []).length) close(key, tick);
      endTick = Math.max(endTick, tick);
      tr.notes.sort((x, y) => x.tick - y.tick || x.midi - y.midi);
      return tr;
    }

    while (p + 8 <= u8.length && tracks.length < 256) {
      const id = tag();
      const len = u32();
      const start = p;
      const end = Math.min(u8.length, start + len);
      p = end;
      if (id === 'MTrk') tracks.push(parseTrack(start, end));
    }
    return { format, division, tracks, tempos, meters, keys, endTick };
  }

  /* ---------- timing ---------- */

  function tempoMap(tempos, division) {
    const list = tempos.slice().sort((a, b) => a.tick - b.tick);
    if (!list.length || list[0].tick > 0) list.unshift({ tick: 0, us: 500000 });
    const segs = [];
    for (const e of list) {
      const last = segs[segs.length - 1];
      const spt = e.us / 1e6 / division;
      if (last && e.tick === last.tick) { last.spt = spt; continue; }
      segs.push({ tick: e.tick, sec: last ? last.sec + (e.tick - last.tick) * last.spt : 0, spt });
    }
    const find = (key, v) => {
      let lo = 0, hi = segs.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (segs[mid][key] <= v) lo = mid; else hi = mid - 1;
      }
      return segs[lo];
    };
    return {
      tickToSec: (t) => { const s = find('tick', t); return s.sec + (t - s.tick) * s.spt; },
      secToTick: (sec) => { const s = find('sec', sec); return s.tick + (sec - s.sec) / s.spt; },
      bpmAt: (sec) => { const s = find('sec', sec); return 60 / (s.spt * division); },
    };
  }

  function beatInfo(m, division) {
    const num = Math.max(1, m.num || 4), den = Math.max(1, m.den || 4);
    const barTicks = Math.round((division * 4 * num) / den);
    let beatTicks = (division * 4) / den, beats = num;
    if (den >= 8 && num % 3 === 0 && num > 3) { beatTicks *= 3; beats = num / 3; } // 6/8, 9/8, 12/8 count in dotted beats
    return { beats, beatTicks, barTicks };
  }

  /* ---------- lyrics ---------- */

  /* Lyric events carry one syllable each. Writers differ in how they mark word breaks, so accept the usual
     conventions: a trailing hyphen means the word continues, "/" or "\" starts a new line (karaoke files),
     lone "-" or "_" placeholders are skipped. Extra verses stored at the same tick are ignored. */
  function buildLyrics(events, tm) {
    const out = [];
    let lastTick = -1, newline = false;
    for (const ev of events) {
      let t = ev.text.replace(/\0/g, '');
      if (t[0] === '/' || t[0] === '\\') { newline = true; t = t.slice(1); }
      const core = t.trim();
      if (!core || core === '-' || core === '_') continue;
      if (ev.tick === lastTick) continue;
      const join = core.endsWith('-');
      out.push({ start: tm.tickToSec(ev.tick), text: join ? core.slice(0, -1) : core, join, newline });
      newline = false;
      lastTick = ev.tick;
    }
    return out;
  }

  /* ---------- score ---------- */

  function loadMidi(input, fileName) {
    const m = parseSmf(input);
    const { division } = m;
    const tm = tempoMap(m.tempos, division);

    // Meters sorted by tick, later event wins at the same tick, 4/4 assumed from the start.
    const meters = [];
    for (const e of m.meters.slice().sort((a, b) => a.tick - b.tick)) {
      if (meters.length && meters[meters.length - 1].tick === e.tick) meters[meters.length - 1] = e; else meters.push(e);
    }
    if (!meters.length || meters[0].tick > 0) meters.unshift({ tick: 0, num: 4, den: 4 });

    // One part per track, or per channel when a track mixes several. Drums (channel 10) are not parts.
    const parts = [];
    m.tracks.forEach((tr, ti) => {
      const byCh = new Map();
      for (const n of tr.notes) {
        if (n.ch === 9) continue;
        if (!byCh.has(n.ch)) byCh.set(n.ch, []);
        byCh.get(n.ch).push(n);
      }
      const many = byCh.size > 1;
      const base = tr.name || 'Part ' + (new Set(parts.map((p) => p.track)).size + 1);
      let first = true;
      for (const [ch, list] of byCh) {
        const notes = list.map((n) => ({
          start: tm.tickToSec(n.tick), end: tm.tickToSec(n.tick + n.dur), midi: n.midi, vel: n.vel,
        }));
        let lo = 127, hi = 0;
        for (const n of notes) { if (n.midi < lo) lo = n.midi; if (n.midi > hi) hi = n.midi; }
        parts.push({
          name: many ? base + ' (ch ' + (ch + 1) + ')' : base, notes, lo, hi, track: ti, channel: ch,
          lyrics: first ? buildLyrics(tr.lyrics, tm) : [],
        });
        first = false;
      }
    });
    if (!parts.length) throw new Error('No notes were found in this MIDI file.');

    let lastTick = m.endTick;
    for (const tr of m.tracks) for (const n of tr.notes) lastTick = Math.max(lastTick, n.tick + n.dur);
    const durationSec = tm.tickToSec(lastTick);
    if (!(durationSec > 0) || durationSec > MAX_SECONDS) throw new Error('This MIDI file has an unusable length.');

    const keys = m.keys.slice().sort((a, b) => a.tick - b.tick);
    const title = String(fileName || 'Score').replace(/\.(mid|midi|kar)$/i, '').replace(/_/g, ' ').trim() || 'Score';

    function meterAt(sec) {
      const tick = Math.max(0, tm.secToTick(Math.max(0, sec)));
      let mi = 0;
      while (mi + 1 < meters.length && meters[mi + 1].tick <= tick) mi++;
      const b = beatInfo(meters[mi], division);
      return {
        num: meters[mi].num, den: meters[mi].den, beats: b.beats,
        beatSec: tm.tickToSec(tick + b.beatTicks) - tm.tickToSec(tick),
      };
    }

    /* Bar grid. A pickup (anacrusis) is not stored in MIDI, so the caller says how many beats it lasts;
       bar 1 then starts after it. The pickup itself is bar 0. */
    function bars(pickupBeats) {
      const out = [];
      const first = beatInfo(meters[0], division);
      const pick = Math.max(0, Math.round((pickupBeats || 0) * first.beatTicks));
      let tick = 0, n = 1, mi = 0;
      if (pick > 0) { out.push({ n: 0, tick: 0, beats: Math.max(1, Math.round(pickupBeats)) }); tick = pick; }
      while (tick <= lastTick && out.length < MAX_BARS) {
        while (mi + 1 < meters.length && meters[mi + 1].tick <= tick) mi++;
        const b = beatInfo(meters[mi], division);
        out.push({ n: n++, tick, beats: b.beats });
        let next = tick + b.barTicks;
        if (mi + 1 < meters.length && meters[mi + 1].tick < next) next = meters[mi + 1].tick; // meter change inside a bar
        tick = next;
      }
      out.forEach((b, k) => {
        b.sec = tm.tickToSec(b.tick);
        b.endSec = k + 1 < out.length ? tm.tickToSec(out[k + 1].tick) : tm.tickToSec(b.tick + beatInfo(meters[mi], division).barTicks);
      });
      return out;
    }

    return {
      title, division, durationSec, parts,
      flats: keys.length ? keys[0].sf < 0 : false,
      tickToSec: tm.tickToSec, secToTick: tm.secToTick, bpmAt: tm.bpmAt,
      meterAt, bars,
    };
  }

  const api = { loadMidi };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PitchTrace = Object.assign(root.PitchTrace || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
