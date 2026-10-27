(() => {
  'use strict';

  const { yin, median, FMIN, FMAX, loadMidi, library, exercises, scoring } = window.PitchTrace;

  const $ = (id) => document.getElementById(id);
  // Plain letters, because the flat and sharp symbols are missing from many monospace fonts.
  const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const NATURAL_LABEL = ['C', '', 'D', '', 'E', 'F', '', 'G', '', 'A', '', 'B'];
  // Fixed-do solfège: Do is always C.
  const SOL_SHARP = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
  const SOL_FLAT = ['Do', 'Reb', 'Re', 'Mib', 'Mi', 'Fa', 'Solb', 'Sol', 'Lab', 'La', 'Sib', 'Si'];
  const SOL_NATURAL = ['Do', '', 'Re', '', 'Mi', 'Fa', '', 'Sol', '', 'La', '', 'Si'];
  // Visible windows in MIDI note numbers (sounding pitch).
  const RANGES = { soprano: [58, 83], alto: [53, 78], tenor: [46, 71], bass: [38, 64] };
  const GOOD = 15, CLOSE = 30;  // cents
  const PLAYHEAD = 0.28;        // where "now" sits across the plot when a score is loaded
  const GRACE = 0.2;            // seconds after a note ends during which it still counts as the target
  const LOOKAHEAD = 0.4;        // seconds of guide tone scheduled ahead (at 100% speed)

  /* ---------- settings ---------- */

  const state = {
    running: false, a4: 440, windowSec: 12, range: 'auto', sens: 50,
    speed: 1, countIn: true, guideMine: true, guideOthers: true, octave: 'any', partName: '', agc: false, names: 'letters', staff: 'off', lyrics: true, lyricLane: false, exercise: 'five', exLo: 40, exHi: 62,
  };
  const PERSIST = ['a4', 'windowSec', 'range', 'sens', 'speed', 'countIn', 'guideMine', 'guideOthers', 'octave', 'partName', 'agc', 'names', 'staff', 'lyrics', 'lyricLane', 'exercise', 'exLo', 'exHi'];
  try {
    const saved = JSON.parse(localStorage.getItem('pitchtrace.settings') || '{}');
    for (const k of PERSIST) if (saved[k] != null) state[k] = saved[k];
  } catch (e) { /* storage unavailable: defaults apply */ }
  if (![6, 12, 24].includes(state.windowSec)) state.windowSec = 12;
  if (!(state.speed >= 0.25 && state.speed <= 1)) state.speed = 1;
  if (state.octave !== 'exact') state.octave = 'any';
  if (state.names !== 'solfege') state.names = 'letters';
  if (state.staff !== 'bass') state.staff = 'off';
  state.lyrics = state.lyrics !== false;
  state.lyricLane = state.lyricLane === true;
  state.exLo = Math.min(84, Math.max(28, Math.round(Number(state.exLo)) || 40));
  state.exHi = Math.min(84, Math.max(28, Math.round(Number(state.exHi)) || 62));
  if (state.range === 'score' || !(state.range === 'auto' || RANGES[state.range])) state.range = 'auto';
  function save() {
    try {
      const out = {};
      for (const k of PERSIST) out[k] = state[k];
      localStorage.setItem('pitchtrace.settings', JSON.stringify(out));
    } catch (e) { /* ignore */ }
  }
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* ignore */ } };

  /* ---------- elements ---------- */

  const cv = $('cv'), plot = $('plot'), ctx2d = cv.getContext('2d');
  const noteEl = $('note'), centsEl = $('cents'), verdictEl = $('verdict'), hzEl = $('hz');
  const readoutEl = $('readout'), pinEl = $('pin'), statusEl = $('status'), statusText = $('statusText');
  const toggleBtn = $('toggle'), rangeSel = $('range'), winSel = $('win'), a4In = $('a4'), sensIn = $('sens');
  const levelBar = $('levelBar'), gateMark = $('gateMark'), msgEl = $('msg'), emptyEl = $('empty');
  const transportEl = $('transport'), playBtn = $('play'), restartBtn = $('restart'), speedSel = $('speed');
  const posText = $('posText'), seekEl = $('seek');
  const loadBtn = $('load'), fileIn = $('file'), songField = $('songField'), songSel = $('song');
  const partField = $('partField'), partSel = $('part'), scoreRangeOpt = $('scoreRange');
  const octSel = $('octave'), countInCb = $('countIn'), mineCb = $('guideMine'), othersCb = $('guideOthers');
  const othersField = $('othersField'), pickupField = $('pickupField'), pickupIn = $('pickup'), removeBtn = $('removeSong');
  const agcCb = $('agc'), calibBtn = $('calibrate'), calibNote = $('calibNote'), rangeInfo = $('rangeInfo'), namesSel = $('names'), staffSel = $('staff'), lyricsCb = $('lyrics'), laneCb = $('lyricLane'), lineEl = $('lyricLine'), fixBtn = $('lyricFix');
  agcCb.checked = !!state.agc;
  namesSel.value = state.names;
  staffSel.value = state.staff;
  lyricsCb.checked = state.lyrics; laneCb.checked = state.lyricLane;

  rangeSel.value = state.range; winSel.value = String(state.windowSec); a4In.value = String(state.a4); sensIn.value = String(state.sens);
  speedSel.value = String(state.speed); if (speedSel.value !== String(state.speed)) { speedSel.value = '1'; state.speed = 1; }
  octSel.value = state.octave; countInCb.checked = !!state.countIn; mineCb.checked = !!state.guideMine; othersCb.checked = !!state.guideOthers;

  // Colors for the canvas come from the CSS tokens so both themes work.
  let col = {};
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue(n).trim();
    col = { grid: g('--grid'), gridStrong: g('--grid-strong'), ink: g('--ink'), muted: g('--muted'), band: g('--band'), bandStrong: g('--band-strong'), accent: g('--accent'), good: g('--good'), warn: g('--warn'), bad: g('--bad'), panel: g('--panel') };
  }
  readColors();
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(() => { readColors(); draw(); });

  /* ---------- helpers ---------- */

  const wall = () => performance.now() / 1000;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±');
  const qOf = (cents) => { const a = Math.abs(cents); return a <= GOOD ? 'good' : a <= CLOSE ? 'warn' : 'bad'; };
  const fold = (x) => x - 12 * Math.round(x / 12);
  let flats = false;
  const noteName = (midi) => {
    const table = state.names === 'solfege' ? (flats ? SOL_FLAT : SOL_SHARP) : (flats ? FLAT : SHARP);
    return table[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
  };
  // Position of a note on the staff, counted in letter steps (C4 = 28, so each step is a line or a space).
  const LETTER = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
  const NATURAL_SEMI = [0, 2, 4, 5, 7, 9, 11];
  const stepOf = (midi) => LETTER[(flats ? FLAT : SHARP)[((midi % 12) + 12) % 12][0]] + 7 * (Math.floor(midi / 12) - 1);
  const naturalMidi = (step) => NATURAL_SEMI[step % 7] + 12 * (Math.floor(step / 7) + 1);
  const BASS_LINES = [43, 47, 50, 53, 57]; // G2 B2 D3 F3 A3
  const fmt = (sec) => { sec = Math.max(0, sec); return Math.floor(sec / 60) + ':' + String(Math.floor(sec % 60)).padStart(2, '0'); };

  function setStatus(kind, text) { statusEl.dataset.s = kind; statusText.textContent = text; }
  function showMsg(text) { msgEl.textContent = text; msgEl.hidden = !text; }

  /* ---------- score and transport state ---------- */

  let score = null, song = null, partIdx = 0;
  let bars = [], queue = [], songs = [];
  const tp = { playing: false, pos: 0, basePos: 0, baseWall: 0, pos0: 0, startPos: 0 };
  let qi = 0, ki = 0, clicks = [], schedTimer = 0, starting = false;
  let lastSeekInput = 0, lastPosText = '';

  // The timeline is wall-clock time in the free tuner and score time (seconds into the song) with a score.
  const tlNow = () => (!score ? wall() : tp.playing ? tp.basePos + (wall() - tp.baseWall) * state.speed : tp.pos);
  let stopTime = 0;
  const viewTime = () => (score ? tlNow() : state.running ? wall() : stopTime || wall());

  /* ---------- audio ---------- */

  let audioCtx = null, analyser = null, stream = null, source = null, master = null, wave = null, wakeLock = null;
  const voices = new Set();

  function ensureCtx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC({ latencyHint: 'interactive' });
      master = audioCtx.createGain();
      master.gain.value = 0.9;
      master.connect(audioCtx.destination);
      // A few harmonics so low notes stay audible on small phone speakers.
      wave = audioCtx.createPeriodicWave(new Float32Array(5), new Float32Array([0, 1, 0.55, 0.3, 0.15]));
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  const wantWake = () => state.running || tp.playing;
  function requestWake() {
    if (navigator.wakeLock && wantWake() && !wakeLock) {
      navigator.wakeLock.request('screen').then((l) => {
        wakeLock = l;
        l.addEventListener('release', () => { if (wakeLock === l) wakeLock = null; });
      }).catch(() => {});
    }
  }
  function releaseWake() { if (wakeLock && !wantWake()) { wakeLock.release().catch(() => {}); wakeLock = null; } }

  function voice(when, dur, midi, mine) {
    const f = state.a4 * Math.pow(2, (midi - 69) / 12);
    const osc = audioCtx.createOscillator();
    osc.setPeriodicWave(wave);
    osc.frequency.value = f;
    const g = audioCtx.createGain();
    const peak = mine ? 0.28 : 0.12;
    const end = when + Math.max(0.06, dur);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.025);
    g.gain.setValueAtTime(peak, Math.max(when + 0.025, end - 0.05));
    g.gain.linearRampToValueAtTime(0, end);
    osc.connect(g); g.connect(master);
    osc.start(when); osc.stop(end + 0.02);
    const v = { osc, g, mine };
    voices.add(v);
    osc.onended = () => { voices.delete(v); try { g.disconnect(); } catch (e) { /* already gone */ } };
  }

  function click(when, accent) {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'triangle';
    o.frequency.value = accent ? 1500 : 1000;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.5, when + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.07);
    o.connect(g); g.connect(master);
    o.start(when); o.stop(when + 0.09);
    o.onended = () => { try { g.disconnect(); } catch (e) { /* already gone */ } };
  }

  function stopVoices(filter) {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    for (const v of Array.from(voices)) {
      if (filter && !filter(v)) continue;
      try {
        v.g.gain.cancelScheduledValues(now);
        v.g.gain.setTargetAtTime(0, now, 0.01);
        v.osc.stop(now + 0.06);
      } catch (e) { /* already stopped */ }
      voices.delete(v);
    }
  }

  function scheduler() {
    if (!tp.playing || !audioCtx) return;
    const p = tlNow();
    const horizon = p + LOOKAHEAD * state.speed;
    const at = (s) => audioCtx.currentTime + Math.max(0, (s - p) / state.speed);
    while (ki < clicks.length && clicks[ki].t < horizon) { click(at(clicks[ki].t), clicks[ki].accent); ki++; }
    while (qi < queue.length) {
      const n = queue[qi];
      if (n.end <= tp.pos0) { qi++; continue; }
      const s = Math.max(n.start, tp.pos0);
      if (s >= horizon) break;
      qi++;
      if (n.end <= p || !(n.mine ? state.guideMine : state.guideOthers)) continue;
      const from = Math.max(s, p);
      voice(at(from), (n.end - from) / state.speed, n.midi, n.mine);
    }
  }

  /* ---------- pitch analysis ---------- */

  const buf = new Float32Array(2048);
  let gateDb = -45, lastAnalysis = 0, raf = 0, lastUi = 0;
  const pts = []; // {t, m, e}  t = timeline seconds, m = MIDI pitch (null = gap), e = error in semitones (null = no target)
  let lastVoiced = null, jump = 0, breakPushed = true;
  const med = [];
  const view = { lo: 48, hi: 66 };
  let autoCenter = 57;

  // The sensitivity slider sets the level (in dB) below which the microphone is ignored.
  // 0 to 50 covers -30 to -45 dB; 50 to 100 reaches down to -75 dB for quiet singing and quiet phones.
  const METER_MIN = -80;
  const gateFromSens = (s) => (s <= 50 ? -30 - s * 0.3 : -45 - (s - 50) * 0.6);
  const sensFromGate = (g) => clamp(g >= -45 ? (-30 - g) / 0.3 : 50 + (-45 - g) / 0.6, 0, 100);
  function setGate() {
    gateDb = gateFromSens(state.sens);
    gateMark.style.left = clamp(((gateDb - METER_MIN) / -METER_MIN) * 100, 0, 100) + '%';
  }
  setGate();
  let calib = null; // while measuring room noise: { max, n }

  function idleVerdict() {
    if (!state.running) return score && !tp.playing ? 'Press Play' : 'Microphone off';
    return score && tp.playing ? 'Sing your part' : 'Sing a note';
  }

  function showNote(m, hit) {
    if (m == null) {
      readoutEl.dataset.q = 'idle';
      pinEl.removeAttribute('data-q');
      pinEl.style.left = '50%';
      noteEl.removeAttribute('data-long');
      noteEl.textContent = '—'; centsEl.innerHTML = '&nbsp;'; hzEl.innerHTML = '&nbsp;';
      verdictEl.textContent = idleVerdict();
      if (state.running) setStatus('listening', 'Listening');
      return;
    }
    const n = Math.round(m);
    const err = hit ? hit.e : m - n;
    const cents = Math.round(err * 100);
    const a = Math.abs(cents);
    const q = qOf(cents);
    readoutEl.dataset.q = q;
    const name = noteName(n);
    noteEl.textContent = name;
    noteEl.dataset.long = String(name.length >= 4); // longer names get a smaller type size
    centsEl.textContent = sign(cents) + a + ' ¢';
    verdictEl.textContent = a <= GOOD ? 'In tune' : hit && a >= 70 ? (cents > 0 ? 'Too high' : 'Too low') : cents > 0 ? 'Sharp' : 'Flat';
    hzEl.textContent = (hit ? 'Target ' + noteName(hit.tg) + ' · ' : '') + (state.a4 * Math.pow(2, (m - 69) / 12)).toFixed(1) + ' Hz';
    pinEl.dataset.q = q;
    pinEl.style.left = clamp(50 + cents, 0, 100) + '%';
    setStatus('hearing', 'Hearing you');
  }

  function setLevel(db) { levelBar.style.width = clamp(((db - METER_MIN) / -METER_MIN) * 100, 0, 100) + '%'; }

  function pushBreak(t) { if (!breakPushed) { pts.push({ t, m: null }); breakPushed = true; } }
  function unvoiced(rec, t) {
    med.length = 0;
    if (rec) pushBreak(t);
    if (lastVoiced && wall() - lastVoiced.w > 0.6) { lastVoiced = null; showNote(null); }
  }

  /* The note the singer should be on at score time t, closest in pitch to what they sing.
     A note that just ended still counts for a moment, because voices arrive slightly late. */
  function targetHit(m, t) {
    const notes = score.parts[partIdx].notes;
    let lo = 0, hi = notes.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (notes[mid].start <= t) lo = mid + 1; else hi = mid; }
    let best = null;
    for (let i = lo - 1, seen = 0; i >= 0 && seen < 8; i--, seen++) {
      const n = notes[i];
      if (t >= n.end + GRACE) continue;
      let e = m - n.midi;
      if (state.octave === 'any') e = fold(e);
      if (!best || Math.abs(e) < Math.abs(best.e)) best = { e, tg: n.midi };
    }
    return best;
  }

  function analyse() {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const db = 20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-9);
    setLevel(db);
    if (calib) { calib.max = Math.max(calib.max, db); calib.n++; }
    const t = tlNow();
    const rec = !score || (tp.playing && t >= tp.pos0); // not recorded while paused or during the count-in
    // Once a note is sounding, keep listening a little below the threshold so quiet note endings are not cut off.
    const singing = lastVoiced && wall() - lastVoiced.w < 0.3;
    if (db < (singing ? gateDb - 6 : gateDb)) return unvoiced(rec, t);
    const r = yin(buf, audioCtx.sampleRate, FMIN, FMAX);
    if (!r || r.clarity < 0.8) return unvoiced(rec, t);
    const raw = 69 + 12 * Math.log2(r.freq / state.a4);
    const w = wall();
    // Reject sudden octave-sized jumps unless they persist for a few frames.
    if (lastVoiced && w - lastVoiced.w < 0.3 && Math.abs(raw - lastVoiced.m) > 9) {
      if (++jump < 4) return;
    }
    jump = 0;
    med.push(raw); if (med.length > 3) med.shift();
    const m = median(med);
    const hit = score && (rec || !tp.playing) ? targetHit(m, t) : null;
    const e = hit ? hit.e : score ? null : m - Math.round(m);
    lastVoiced = { w, t, m, e };
    if (run && rec && tp.playing && hit) run.frames.push({ t, e: hit.e, dt: 0.032 * state.speed });
    if (rec) {
      pts.push({ t, m, e });
      breakPushed = false;
      while (pts.length && pts[0].t < t - 40) pts.shift();
    }
    showNote(m, hit);
  }

  /* ---------- drawing ---------- */

  let cssW = 0, cssH = 0, dpr = 1;
  function resize() {
    const r = plot.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    cssW = r.width; cssH = r.height;
    cv.width = Math.max(1, Math.round(cssW * dpr));
    cv.height = Math.max(1, Math.round(cssH * dpr));
    draw();
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(plot); else window.addEventListener('resize', resize);

  function latestMidi(now, within) {
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      if (now - p.t > within) return null;
      if (p.m != null) return p.m;
    }
    return null;
  }

  function colorForE(e) {
    if (e == null) return col.muted;
    const c = Math.abs(e) * 100;
    return c <= GOOD ? col.good : c <= CLOSE ? col.warn : col.bad;
  }

  function viewTarget(now) {
    if (state.range === 'score' && score) {
      const p = score.parts[partIdx];
      const mid = (p.lo + p.hi) / 2, span = Math.max(14, p.hi - p.lo + 5);
      return [mid - span / 2, mid + span / 2];
    }
    if (state.range === 'auto' || state.range === 'score') {
      const recent = latestMidi(now, 0.6);
      if (recent != null && (recent < view.lo + 3 || recent > view.hi - 3)) autoCenter = recent;
      return [autoCenter - 9, autoCenter + 9];
    }
    return RANGES[state.range];
  }
  function updateView(now, snap) {
    const [tLo, tHi] = viewTarget(now);
    const k = snap ? 1 : 0.12;
    view.lo += (tLo - view.lo) * k;
    view.hi += (tHi - view.hi) * k;
  }

  function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  const MONO = 'ui-monospace, Menlo, Consolas, monospace';
  const SANS = '"Avenir Next", "Segoe UI", Roboto, system-ui, sans-serif';

  // The five lines of the bass clef (clé de fa) at their true pitch, with the clef on the left.
  function drawBassStaff(c, L, pw, T, ph, yOf, clefW) {
    c.save();
    c.beginPath(); c.rect(L, T, pw, ph); c.clip();
    c.strokeStyle = col.ink; c.fillStyle = col.ink; c.globalAlpha = 0.5; c.lineWidth = 1.5;
    for (const m of BASS_LINES) { const y = yOf(m); c.beginPath(); c.moveTo(L, y); c.lineTo(L + pw, y); c.stroke(); }
    const u = Math.min((yOf(43) - yOf(57)) / 4, clefW / 3);
    if (u >= 5) {
      const x0 = L + 8, yF = yOf(53); // the clef curls around the F line
      c.globalAlpha = 0.8; c.lineCap = 'round'; c.lineWidth = Math.max(1.5, u * 0.3);
      c.beginPath();
      c.moveTo(x0 + 0.35 * u, yF);
      c.bezierCurveTo(x0 + 0.35 * u, yF - 1.5 * u, x0 + 2.0 * u, yF - 1.3 * u, x0 + 1.9 * u, yF + 0.3 * u);
      c.bezierCurveTo(x0 + 1.8 * u, yF + 1.6 * u, x0 + 1.0 * u, yF + 2.4 * u, x0 + 0.2 * u, yF + 3.0 * u);
      c.stroke();
      c.beginPath(); c.arc(x0 + 0.35 * u, yF, 0.36 * u, 0, Math.PI * 2); c.fill();
      for (const m of [55, 51.5]) { c.beginPath(); c.arc(x0 + 2.7 * u, yOf(m), 0.15 * u + 0.5, 0, Math.PI * 2); c.fill(); }
    }
    c.restore();
  }

  /* The line being sung, in large type above the controls: the current syllable is highlighted, the next line is dimmed.
     MIDI has no line breaks, so a new line starts after a rest, after a "/" marker, after sentence punctuation, or when the line gets long. */
  let run = null;
  let linesFor = null, lines = [], lineIdx = -2, sylIdx = -2, lineSpans = [], lineData = [], fixing = false;

  function buildLines(ly) {
    const notes = score.parts[partIdx].notes;
    const out = [];
    let cur = null, chars = 0, ni = 0, prevEnd = 0;
    for (const e of ly) {
      while (ni < notes.length && notes[ni].start < e.start - 1e-6) { prevEnd = Math.max(prevEnd, notes[ni].end); ni++; }
      const gap = e.start - prevEnd, beat = score.meterAt(e.start).beatSec;
      const prev = cur && cur[cur.length - 1];
      const brk = !cur || e.newline || (prev && !prev.join && (gap > beat * 1.2 || (/[.!?;:]$/.test(prev.text) && chars >= 12) || chars + e.text.length > 34));
      if (brk) { cur = []; out.push(cur); chars = 0; }
      cur.push(e); chars += e.text.length + (e.join ? 0 : 1);
    }
    return out;
  }

  function updateLyricLine(now) {
    const ly = score && state.lyrics ? lyricsOf() : [];
    fixBtn.hidden = !(song && !song.exercise);
    if (!ly.length) { if (!lineEl.hidden) { lineEl.hidden = true; linesFor = null; } return; }
    lineEl.hidden = false;
    if (linesFor !== ly) { linesFor = ly; lines = buildLines(ly); lineIdx = -2; sylIdx = -2; }
    // The current line: the last one that has started (a little early, so the next line is ready during a rest).
    let li = 0;
    for (let k = 0; k < lines.length; k++) { if (lines[k][0].start - 0.6 <= now) li = k; else break; }
    let si = -1;
    const L = lines[li];
    for (let k = 0; k < L.length; k++) { if (L[k].start <= now) si = k; else break; }
    if (li !== lineIdx) {
      lineIdx = li; sylIdx = -2;
      const curEl = lineEl.firstElementChild, nxtEl = lineEl.lastElementChild;
      curEl.textContent = ''; lineSpans = [];
      lineData = L;
      curEl.classList.toggle('fixing', fixing);
      L.forEach((e) => {
        const sp = document.createElement('span');
        sp.textContent = e.text + (fixing ? (e.join ? '-' : ' ') : (e.join ? '' : ' '));
        curEl.append(sp); lineSpans.push(sp);
      });
      nxtEl.textContent = lines[li + 1] ? lines[li + 1].map((e) => e.text + (e.join ? '' : ' ')).join('') : '';
    }
    if (si !== sylIdx) {
      sylIdx = si;
      lineSpans.forEach((sp, k) => { sp.className = k < si ? 'past' : k === si ? 'now' : ''; });
    }
  }

  /* Fixing word breaks: in this mode every syllable shows its hyphen (joined to the next) or a space; tapping one flips it.
     The fixes are kept with the song, keyed by the syllable's position in its track. */
  fixBtn.addEventListener('click', () => {
    fixing = !fixing;
    fixBtn.textContent = fixing ? 'Done' : 'Fix word breaks';
    fixBtn.setAttribute('aria-pressed', String(fixing));
    if (fixing && tp.playing) pause();
    lineIdx = -2; draw();
  });
  lineEl.firstElementChild.addEventListener('click', (ev) => {
    if (!fixing || !song) return;
    const sp = ev.target.closest('span');
    const k = sp ? lineSpans.indexOf(sp) : -1;
    if (k < 0) return;
    const e = lineData[k];
    e.join = !e.join;
    song.fixes = song.fixes || {};
    if (e.join === e.orig) delete song.fixes[e.key]; else song.fixes[e.key] = e.join;
    persistSong(song);
    linesFor = null; draw();
  });

  // Lyrics of the chosen part; if that track has none, use the first track that does (they are timed by their own events).
  function lyricsOf() {
    if (!score) return [];
    const mine = score.parts[partIdx].lyrics;
    if (mine && mine.length) return mine;
    for (const p of score.parts) if (p.lyrics && p.lyrics.length) return p.lyrics;
    return [];
  }

  function drawLyrics(c, L, pw, T, ph, now, xOf, tL, tR, laneH) {
    const ly = lyricsOf();
    if (!ly.length) return;
    const y0 = T + ph + 4, mid = y0 + laneH / 2;
    c.save();
    c.beginPath(); c.rect(L, y0, pw, laneH); c.clip();
    c.font = '600 14px ' + SANS; c.textBaseline = 'middle'; c.textAlign = 'left';
    for (let i = 0; i < ly.length; i++) {
      const e = ly[i], nx = i + 1 < ly.length ? ly[i + 1].start : e.start + 2;
      if (nx < tL) continue;
      if (e.start > tR) break;
      const x = xOf(e.start), room = xOf(nx) - x - 3;
      const active = e.start <= now && now < nx;
      c.save();
      c.beginPath(); c.rect(x, y0, Math.max(4, room), laneH); c.clip();
      c.fillStyle = active ? col.accent : nx <= now ? col.muted : col.ink;
      c.globalAlpha = nx <= now ? 0.6 : 1;
      c.fillText(e.text + (e.join ? '-' : ''), x + 1, mid);
      c.restore();
      c.strokeStyle = col.gridStrong; c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y0 + 4); c.stroke();
    }
    c.restore();
  }

  function draw() {
    if (!cssW) return;
    const now = viewTime();
    const c = ctx2d;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, cssW, cssH);
    updateView(now, !(state.running || tp.playing));
    updateLyricLine(now);

    const hasLyrics = !!(score && state.lyrics && state.lyricLane && lyricsOf().length);
    const laneH = hasLyrics ? 26 : 0;
    const L = 44, R = 12, T = score ? 20 : 8, B = 18 + laneH;
    const pw = cssW - L - R, ph = cssH - T - B;
    if (pw < 40 || ph < 40) return;
    const phx = score ? L + pw * PLAYHEAD : L + pw;
    const pxs = pw / state.windowSec;
    const yOf = (m) => T + ((view.hi - m) * ph) / (view.hi - view.lo);
    const xOf = (t) => phx + (t - now) * pxs;
    const semi = ph / (view.hi - view.lo);
    const tL = now - (phx - L) / pxs, tR = now + (L + pw - phx) / pxs;

    // Free tuner: highlight the row of the note being sung, with a narrow in-tune corridor.
    if (!score) {
      const cur = latestMidi(now, 0.4);
      if (cur != null) {
        const n = Math.round(cur);
        c.fillStyle = col.band;
        c.fillRect(L, yOf(n + 0.5), pw, yOf(n - 0.5) - yOf(n + 0.5));
        c.fillStyle = col.bandStrong;
        c.fillRect(L, yOf(n + GOOD / 100), pw, yOf(n - GOOD / 100) - yOf(n + GOOD / 100));
      }
    }

    // Semitone grid and note labels.
    c.font = '11px ' + MONO;
    c.textAlign = 'right'; c.textBaseline = 'middle';
    const labels = [];
    for (let m = Math.ceil(view.lo); m <= Math.floor(view.hi); m++) {
      const pc = ((m % 12) + 12) % 12;
      const y = yOf(m);
      const nat = NATURAL_LABEL[pc] !== '';
      c.strokeStyle = nat ? col.gridStrong : col.grid;
      c.lineWidth = pc === 0 ? 1.5 : 1;
      c.beginPath(); c.moveTo(L, y); c.lineTo(L + pw, y); c.stroke();
      if (nat) labels.push({ y, pc, text: (state.names === 'solfege' ? SOL_NATURAL : NATURAL_LABEL)[pc] + (Math.floor(m / 12) - 1) });
    }
    // On a short plot some labels would collide: the octave markers (C or Do) always stay, the rest fill the gaps.
    const shown = labels.filter((l) => l.pc === 0);
    for (const l of labels) if (l.pc !== 0 && shown.every((s) => Math.abs(s.y - l.y) >= 12)) shown.push(l);
    for (const l of shown) { c.fillStyle = l.pc === 0 ? col.ink : col.muted; c.fillText(l.text, L - 8, l.y); }

    c.lineWidth = 1;
    if (hasLyrics) drawLyrics(c, L, pw, T, ph, now, xOf, tL, tR, laneH - 4);
    if (score) {
      // Bar lines with bar numbers, and beat lines when there is room.
      c.font = '10px ' + MONO; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
      for (const b of bars) {
        if (b.endSec < tL) continue;
        if (b.sec > tR) break;
        const len = b.endSec - b.sec;
        if (pxs * len / b.beats > 22) {
          c.strokeStyle = col.grid;
          for (let j = 1; j < b.beats; j++) {
            const bx = xOf(b.sec + (len * j) / b.beats);
            if (bx >= L && bx <= L + pw) { c.beginPath(); c.moveTo(bx, T); c.lineTo(bx, T + ph); c.stroke(); }
          }
        }
        const x = xOf(b.sec);
        if (x >= L && x <= L + pw) {
          c.strokeStyle = col.gridStrong;
          c.beginPath(); c.moveTo(x, T - 5); c.lineTo(x, T + ph); c.stroke();
          if (b.n >= 1) { c.fillStyle = col.muted; c.fillText(String(b.n), x + 4, T - 7); }
        }
      }
    } else {
      // Seconds before now.
      const step = state.windowSec <= 6 ? 1 : state.windowSec <= 12 ? 2 : 4;
      c.textAlign = 'center'; c.textBaseline = 'alphabetic';
      c.fillStyle = col.muted; c.font = '10px ' + MONO;
      c.strokeStyle = col.grid;
      for (let a = step; a < state.windowSec; a += step) {
        const x = L + pw - (a / state.windowSec) * pw;
        c.beginPath(); c.moveTo(x, T); c.lineTo(x, T + ph); c.stroke();
        c.fillText('−' + a + 's', x, cssH - 5);
      }
    }

    if (state.staff === 'bass') drawBassStaff(c, L, pw, T, ph, yOf, Math.min(phx - L - 14, pw * 0.22));

    // Playhead (the right edge in the free tuner).
    c.strokeStyle = col.muted; c.lineWidth = score ? 1.5 : 1;
    c.beginPath(); c.moveTo(phx, score ? T - 5 : T); c.lineTo(phx, T + ph); c.stroke();

    c.save();
    c.beginPath(); c.rect(L, T, pw, ph); c.clip();

    // Target notes for the chosen part.
    if (score) {
      const notes = score.parts[partIdx].notes;
      const h = clamp(semi * 0.66, 9, 26);
      c.font = '10px ' + MONO; c.textAlign = 'left'; c.textBaseline = 'middle';
      for (const n of notes) {
        if (n.end < tL) continue;
        if (n.start > tR) break;
        const x1 = xOf(n.start), x2 = xOf(n.end), y = yOf(n.midi);
        const w = Math.max(2, x2 - x1 - 1);
        const active = n.start <= now && now < n.end;
        const a = active ? 1 : n.end <= now ? 0.35 : 0.75;
        if (state.staff === 'bass') {
          // Ledger lines for notes above or below the staff.
          const s = stepOf(n.midi);
          c.save();
          c.strokeStyle = col.ink; c.globalAlpha = 0.5 * a; c.lineWidth = 1.5;
          const ledger = (k) => { const ly = yOf(naturalMidi(k)); c.beginPath(); c.moveTo(x1 - 5, ly); c.lineTo(x1 + w + 5, ly); c.stroke(); };
          if (s >= 28) for (let k = 28; k <= s; k += 2) ledger(k);
          else if (s <= 16) for (let k = 16; k >= s; k -= 2) ledger(k);
          c.restore();
        }
        roundRect(c, x1, y - h / 2, w, h, 4);
        c.globalAlpha = active ? 0.5 : 0.22 * a;
        c.fillStyle = col.accent; c.fill();
        c.globalAlpha = a;
        c.strokeStyle = col.accent; c.lineWidth = active ? 2 : 1.25; c.stroke();
        const label = noteName(n.midi);
        if (w > label.length * 6.2 + 10) { c.fillStyle = col.ink; c.fillText(label, x1 + 5, y + 0.5); }
      }
      c.globalAlpha = 1;
    }

    // Pitch trace, colored by distance from the target (or from the nearest semitone in the free tuner).
    c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = 3.5;
    let prev = null;
    for (const p of pts) {
      if (p.m == null) { prev = null; continue; }
      if (prev && p.t - prev.t < 0.15) {
        const x2 = xOf(p.t);
        if (x2 >= L) {
          c.globalAlpha = 0.25 + 0.75 * clamp((x2 - L) / Math.max(1, phx - L), 0, 1);
          c.strokeStyle = colorForE(p.e);
          c.beginPath(); c.moveTo(xOf(prev.t), yOf(prev.m)); c.lineTo(x2, yOf(p.m)); c.stroke();
        }
      }
      prev = p;
    }
    c.globalAlpha = 1;
    if (lastVoiced && wall() - lastVoiced.w < 0.25) {
      const x = phx, y = yOf(lastVoiced.m);
      c.fillStyle = colorForE(lastVoiced.e);
      c.beginPath(); c.arc(x, y, 5.5, 0, Math.PI * 2); c.fill();
      c.strokeStyle = col.panel; c.lineWidth = 2;
      c.beginPath(); c.arc(x, y, 5.5, 0, Math.PI * 2); c.stroke();
    }
    c.restore();
  }

  function frame(ts) {
    raf = 0;
    if (state.running && analyser && ts - lastAnalysis >= 32) { lastAnalysis = ts; analyse(); }
    if (tp.playing && tlNow() >= score.durationSec + 0.5) pause(true);
    draw();
    if (score && ts - lastUi >= 100) { lastUi = ts; updateTransportUI(); }
    if (state.running || tp.playing) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  /* ---------- microphone ---------- */

  async function start() {
    showMsg('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.isSecureContext) {
      showMsg('The microphone is only available on secure pages. Open this app from https:// (for example GitHub Pages) or from localhost.');
      setStatus('error', 'No microphone access');
      return false;
    }
    ensureCtx(); // inside the tap, so the browser allows audio
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: !!state.agc } });
    } catch (e) {
      const name = e && e.name;
      showMsg(name === 'NotAllowedError' || name === 'SecurityError'
        ? 'The microphone is blocked. Allow it in the browser’s site settings, then press Start again.'
        : name === 'NotFoundError'
          ? 'No microphone was found on this device.'
          : 'The microphone could not be opened: ' + (e && e.message ? e.message : name));
      setStatus('error', 'No microphone access');
      return false;
    }
    source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser); // the microphone is never routed to the speakers, so there is no feedback

    pts.length = 0; med.length = 0; lastVoiced = null; jump = 0; breakPushed = true;
    state.running = true; stopTime = 0;
    toggleBtn.textContent = 'Stop'; toggleBtn.dataset.on = 'true';
    updateEmpty();
    setStatus('listening', 'Listening');
    showNote(null);
    requestWake();
    kick();
    return true;
  }

  function stopMic() {
    state.running = false;
    stopTime = wall();
    if (stream) stream.getTracks().forEach((t) => t.stop());
    try { if (source) source.disconnect(); } catch (e) { /* already gone */ }
    stream = null; source = null; analyser = null;
    toggleBtn.textContent = 'Start'; toggleBtn.dataset.on = 'false';
    setStatus('off', 'Microphone off');
    lastVoiced = null;
    showNote(null);
    setLevel(METER_MIN);
    if (!tp.playing && audioCtx) audioCtx.suspend().catch(() => {});
    releaseWake();
    draw();
  }

  /* ---------- transport ---------- */

  const barAt = (sec) => {
    let lo = 0, hi = bars.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (bars[mid].sec <= sec + 1e-6) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans < 0 ? null : bars[ans];
  };

  function updateTransportUI() {
    if (!score) return;
    const raw = tlNow();
    const p = clamp(raw, 0, score.durationSec);
    const b = barAt(p);
    const txt = tp.playing && raw < tp.pos0
      ? 'Count-in'
      : (b ? (b.n >= 1 ? 'Bar ' + b.n : 'Pickup') : 'Bar 1') + ' · ' + fmt(p) + ' / ' + fmt(score.durationSec);
    if (txt !== lastPosText) { posText.textContent = txt; lastPosText = txt; }
    if (performance.now() - lastSeekInput > 400) seekEl.value = String(p);
  }

  function dropFuture(p) {
    while (pts.length && pts[pts.length - 1].t >= p) pts.pop();
    med.length = 0;
    if (pts.length && pts[pts.length - 1].m != null) pts.push({ t: p - 0.001, m: null });
    breakPushed = true;
  }

  function rebase(p) {
    tp.basePos = p; tp.baseWall = wall(); tp.pos0 = p;
    stopVoices();
    qi = 0; ki = clicks.length;
  }

  function setPos(p) {
    p = clamp(p, 0, score.durationSec);
    tp.pos = p;
    run = null; refreshScoreBtn();
    dropFuture(p);
    if (tp.playing) rebase(p);
    updateTransportUI();
    draw();
  }

  async function play() {
    if (!score || tp.playing || starting) return;
    starting = true;
    try {
      ensureCtx();
      if (!state.running) await start();
    } finally { starting = false; }
    if (!score || tp.playing) return;
    if (tp.pos >= score.durationSec - 0.05) tp.pos = tp.startPos;
    const pos0 = tp.pos;
    const mi = score.meterAt(pos0);
    const nb = state.countIn ? (mi.beats < 3 ? mi.beats * 2 : mi.beats) : 0;
    clicks = [];
    for (let k = 0; k < nb; k++) clicks.push({ t: pos0 - (nb - k) * mi.beatSec, accent: k === 0 });
    tp.pos0 = pos0;
    tp.basePos = pos0 - nb * mi.beatSec;
    tp.baseWall = wall();
    tp.playing = true;
    if (pos0 <= tp.startPos + 0.05) { run = { frames: [], part: partIdx, reach: 0 }; hideResult(); }
    refreshScoreBtn();
    qi = 0; ki = 0;
    dropFuture(tp.basePos);
    clearInterval(schedTimer);
    schedTimer = setInterval(scheduler, 40);
    scheduler();
    playBtn.textContent = 'Pause'; playBtn.dataset.on = 'true';
    showNote(null);
    requestWake();
    kick();
  }

  function pause(atEnd) {
    if (!tp.playing) return;
    const p = clamp(tlNow(), 0, score.durationSec);
    tp.playing = false;
    if (run) run.reach = Math.max(run.reach, atEnd ? score.durationSec : p);
    tp.pos = atEnd ? score.durationSec : Math.max(p, tp.pos0);
    clearInterval(schedTimer); schedTimer = 0;
    stopVoices();
    playBtn.textContent = 'Play'; playBtn.dataset.on = 'false';
    showNote(null);
    releaseWake();
    if (atEnd && run) finishRun(Infinity); else refreshScoreBtn();
    updateTransportUI();
    draw();
  }

  /* ---------- songs ---------- */

  function updateEmpty() { emptyEl.hidden = !!score || state.running || pts.length > 0; }

  function buildQueue() {
    queue = [];
    score.parts.forEach((p, i) => { for (const n of p.notes) queue.push({ start: n.start, end: n.end, midi: n.midi, mine: i === partIdx }); });
    queue.sort((a, b) => a.start - b.start);
    qi = 0;
  }

  function rebuildBars() {
    bars = score.bars(song.pickup || 0);
    const first = score.parts[partIdx].notes[0];
    let k = 0;
    while (k + 1 < bars.length && bars[k + 1].sec <= first.start + 1e-6) k++;
    tp.startPos = bars.length ? bars[Math.max(0, k - 1)].sec : 0;
  }

  function fillSongs() {
    songSel.innerHTML = '';
    songSel.add(new Option('Free tuner (no score)', ''));
    for (const s of songs) songSel.add(new Option(s.name.replace(/\.(mid|midi|kar)$/i, ''), s.id));
    if (song && song.exercise) songSel.add(new Option('Exercise: ' + song.name, song.id));
    songSel.value = song ? song.id : '';
    songField.hidden = songs.length === 0;
  }

  function fillParts() {
    partSel.innerHTML = '';
    score.parts.forEach((p, i) => partSel.add(new Option(p.name, String(i))));
    partSel.value = String(partIdx);
    partField.hidden = score.parts.length < 2;
    othersField.hidden = score.parts.length < 2;
  }

  // "Bass: lowest Ab2, highest C4 (1 octave and 4 semitones)"
  function updateRangeInfo() {
    const p = score.parts[partIdx];
    const span = p.hi - p.lo;
    const oct = Math.floor(span / 12), rem = span % 12;
    const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
    const size = !span ? 'a single note' : [oct ? plural(oct, 'octave') : '', rem ? plural(rem, 'semitone') : ''].filter(Boolean).join(' and ');
    rangeInfo.textContent = '';
    const b = (t) => { const e = document.createElement('b'); e.textContent = t; return e; };
    rangeInfo.append(p.name + ': lowest ', b(noteName(p.lo)), ', highest ', b(noteName(p.hi)), ' (' + size + ')');
    if (song && song.exercise) rangeInfo.append(' \u00b7 ' + exercises.list.find((e) => e.name === song.name).help);
    else if (lyricsOf().length) rangeInfo.append(' \u00b7 lyrics found');
    if (song && !song.exercise) { state.exLo = clamp(p.lo, 28, 84); state.exHi = clamp(p.hi, 28, 84); save(); fillExRange(); }
  }

  function persistSong(rec) {
    if (!library) return;
    library.put(rec).catch(() => showMsg('This device cannot keep songs between visits. The song stays available until you close the app.'));
  }

  function snapView() { updateView(viewTime(), true); }

  function openSong(rec) {
    let sc;
    try { sc = loadMidi(rec.bytes, rec.name); } catch (e) { showMsg((e && e.message) || 'That file could not be read.'); return false; }
    showMsg('');
    pause();
    run = null; hideResult();
    linesFor = null; fixing = false; fixBtn.textContent = 'Fix word breaks';
    sc.parts.forEach((p, pi) => p.lyrics.forEach((e, i) => {
      e.key = pi + ':' + i; e.orig = e.join;
      if (rec.fixes && e.key in rec.fixes) e.join = !!rec.fixes[e.key];
    }));
    score = sc; song = rec; flats = rec.exercise ? true : sc.flats;
    let idx = rec.part != null && rec.part < sc.parts.length ? rec.part : -1;
    const want = (state.partName || '').toLowerCase();
    if (idx < 0 && want) idx = sc.parts.findIndex((p) => p.name.toLowerCase() === want);
    if (idx < 0 && want) idx = sc.parts.findIndex((p) => p.name.toLowerCase().includes(want));
    partIdx = idx < 0 ? 0 : idx;
    buildQueue(); rebuildBars(); fillParts(); updateRangeInfo();
    tp.pos = tp.startPos;
    pts.length = 0; med.length = 0; lastVoiced = null; breakPushed = true;
    seekEl.max = String(sc.durationSec);
    pickupIn.value = String(rec.pickup || 0);
    transportEl.hidden = false; pickupField.hidden = !!rec.exercise; removeBtn.hidden = !!rec.exercise;
    scoreRangeOpt.disabled = false; scoreRangeOpt.hidden = false;
    state.range = 'score'; rangeSel.value = 'score';
    lastPosText = ''; lastSeekInput = 0;
    if (!rec.exercise) lsSet('pitchtrace.last', rec.id);
    fillSongs(); updateEmpty(); showNote(null); updateTransportUI(); snapView(); draw();
    return true;
  }

  function closeSong() {
    pause();
    score = null; song = null; bars = []; queue = []; flats = false;
    transportEl.hidden = true; partField.hidden = true; othersField.hidden = true; pickupField.hidden = true; removeBtn.hidden = true;
    scoreRangeOpt.disabled = true; scoreRangeOpt.hidden = true;
    if (state.range === 'score') { state.range = 'auto'; rangeSel.value = 'auto'; }
    pts.length = 0; med.length = 0; lastVoiced = null; breakPushed = true;
    lineEl.hidden = true; linesFor = null; run = null; hideResult(); refreshScoreBtn();
    lsSet('pitchtrace.last', null);
    fillSongs(); updateEmpty(); showNote(null); snapView(); draw();
  }



  /* ---------- scoring and progress ---------- */

  const resultEl = $('result'), scoreBtn = $('scoreRun');
  const progItem = $('progItem'), progMetric = $('progMetric'), progCv = $('progCv'), progInfo = $('progInfo'), progSummary = $('progSummary'), progClear = $('progClear'), progPanel = $('progPanel');
  const HKEY = 'pitchtrace.history';
  const METRICS = {
    score: { label: 'In tune (%)', get: (h) => h.score },
    bias: { label: 'Flat or sharp (cents)', get: (h) => h.bias },
    wobble: { label: 'Steadiness (cents, lower is better)', get: (h) => h.wobble },
  };
  let history = (() => {
    try { const a = JSON.parse(lsGet(HKEY) || '[]'); return Array.isArray(a) ? a.filter((h) => h && typeof h.k === 'string' && Number.isFinite(h.score)) : []; } catch (e) { return []; }
  })();
  let progSel = -1;

  const keyOf = () => (song.exercise ? 'ex:' + song.exId : 'song:' + song.id + '|' + score.parts[partIdx].name);
  const labelOf = () => (song.exercise ? song.name : song.name.replace(/\.(mid|midi|kar)$/i, '') + (score.parts.length > 1 ? ' · ' + score.parts[partIdx].name : ''));
  const entriesFor = (k) => history.filter((h) => h.k === k);

  function refreshScoreBtn() {
    scoreBtn.hidden = !(run && !tp.playing && run.frames.length > 15);
  }

  function hideResult() { resultEl.hidden = true; }

  function finishRun(until) {
    const r = run; run = null; refreshScoreBtn();
    if (!r || !score) return;
    const res = scoring.scoreRun(score.parts[r.part].notes, r.frames, { good: GOOD, until: until === Infinity ? Infinity : r.reach });
    if (!res) { showMsg('Nothing to score yet: sing through at least one whole note first.'); return; }
    if (res.sung === 0 && until !== Infinity) { showMsg('No singing was heard during that run, so it was not scored.'); return; }
    const key = keyOf();
    const prev = entriesFor(key);
    history.push({ k: key, label: labelOf(), t: Date.now(), score: res.score, sung: res.sung, bias: res.bias, wobble: res.wobble, notes: res.notes, partial: until !== Infinity, speed: state.speed, lo: song.exercise ? song.lo : score.parts[r.part].lo, hi: song.exercise ? song.hi : score.parts[r.part].hi });
    if (history.length > 600) history = history.slice(-600);
    lsSet(HKEY, JSON.stringify(history));
    showResult(res, prev, until !== Infinity);
    progSel = -1; fillProgItems(key); drawProgress();
  }

  function showResult(res, prev, partial) {
    $('resScore').textContent = res.score + '%';
    const bias = Math.abs(res.bias) < 3 ? 'centred on the notes' : (res.bias > 0 ? 'sharp' : 'flat') + ' by about ' + Math.round(Math.abs(res.bias)) + ' cents on average';
    $('resDetail').textContent = 'of the note time within ' + GOOD + ' cents. You sang ' + res.sung + '% of the time, ' + bias + ', and your pitch wobbled by about ±' + Math.round(res.wobble) + ' cents.';
    const weak = res.weakest.filter((w) => w.pct < 0.7).slice(0, 3);
    $('resWeak').textContent = weak.length ? 'Weakest notes: ' + weak.map((w) => noteName(w.midi) + ' (' + Math.round(w.pct * 100) + '%)').join(', ') + '.' : 'No weak notes this time.';
    let trend;
    if (!prev.length) trend = 'First scored run of this: it is your starting point.';
    else {
      const d = res.score - prev[prev.length - 1].score;
      trend = d === 0 ? 'Same as your last run.' : (d > 0 ? '+' : '−') + Math.abs(d) + ' points compared with your last run.';
    }
    $('resTrend').textContent = (partial ? 'Partial run, ' + res.notes + ' notes. ' : '') + trend;
    resultEl.hidden = false;
  }

  scoreBtn.addEventListener('click', () => finishRun(0));
  $('resClose').addEventListener('click', hideResult);

  /* Progress chart: one point per scored run, with the average of the last five runs as a line. */
  function fillProgItems(want) {
    const latest = new Map();
    for (const h of history) latest.set(h.k, h);
    const keys = Array.from(latest.values()).sort((a, b) => b.t - a.t);
    const cur = want || progItem.value || (song && score ? keyOf() : '');
    progItem.innerHTML = '';
    for (const h of keys) progItem.add(new Option(h.label + ' (' + entriesFor(h.k).length + ')', h.k));
    if (keys.length) progItem.value = keys.some((h) => h.k === cur) ? cur : keys[0].k;
  }

  function fmtDate(t) { return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); }
  function fmtStamp(t) { return fmtDate(t) + ' ' + new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }

  function pointColor(metric, v) {
    if (metric === 'score') return v >= 80 ? col.good : v >= 50 ? col.warn : col.bad;
    const a = Math.abs(v);
    return a <= GOOD ? col.good : a <= CLOSE ? col.warn : col.bad;
  }

  function describe(h) {
    const b = Math.abs(h.bias) < 3 ? 'centred' : Math.round(Math.abs(h.bias)) + ' cents ' + (h.bias > 0 ? 'sharp' : 'flat');
    return fmtStamp(h.t) + ' · ' + h.score + '% in tune · ' + b + ' · ±' + Math.round(h.wobble) + ' cents wobble · speed ' + Math.round((h.speed || 1) * 100) + '%' + (h.partial ? ' · partial run' : '');
  }

  function drawProgress() {
    if (!progPanel.open) return;
    const list = entriesFor(progItem.value);
    const r = progCv.getBoundingClientRect();
    const d = window.devicePixelRatio || 1;
    if (!r.width) return;
    progCv.width = Math.round(r.width * d); progCv.height = Math.round(r.height * d);
    const c = progCv.getContext('2d');
    c.setTransform(d, 0, 0, d, 0, 0);
    c.clearRect(0, 0, r.width, r.height);
    progClear.hidden = !list.length;
    if (!list.length) {
      progSummary.textContent = history.length ? '' : 'Finish an exercise or a song from the start to see your first score here.';
      progInfo.textContent = '';
      return;
    }
    const m = progMetric.value, spec = METRICS[m];
    const vals = list.map(spec.get);
    let lo = 0, hi = 100;
    if (m === 'bias') { const a = Math.max(30, Math.ceil(Math.max.apply(null, vals.map(Math.abs)) / 10) * 10); lo = -a; hi = a; }
    if (m === 'wobble') { hi = Math.max(30, Math.ceil(Math.max.apply(null, vals) / 10) * 10); }
    const L = 38, R = 12, T = 10, B = 24, w = r.width - L - R, h = r.height - T - B;
    const y = (v) => T + h - ((v - lo) / (hi - lo)) * h;
    const x = (i) => L + (vals.length < 2 ? w / 2 : (i / (vals.length - 1)) * w);
    c.font = '10px ' + MONO; c.textBaseline = 'middle'; c.textAlign = 'right';
    const ticks = m === 'bias' ? [lo, lo / 2, 0, hi / 2, hi] : [0, 1, 2, 3, 4].map((k) => lo + ((hi - lo) * k) / 4);
    if (m === 'bias') { c.fillStyle = col.band; c.fillRect(L, y(GOOD), w, y(-GOOD) - y(GOOD)); }
    if (m === 'score') { c.fillStyle = col.band; c.fillRect(L, y(100), w, y(80) - y(100)); }
    for (const v of ticks) {
      c.strokeStyle = v === 0 && m === 'bias' ? col.gridStrong : col.grid; c.lineWidth = 1;
      c.beginPath(); c.moveTo(L, y(v)); c.lineTo(L + w, y(v)); c.stroke();
      c.fillStyle = col.muted; c.fillText(String(Math.round(v)), L - 6, y(v));
    }
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    c.fillText(fmtDate(list[0].t), L, r.height - 6);
    c.textAlign = 'right';
    if (list.length > 1) c.fillText(fmtDate(list[list.length - 1].t), L + w, r.height - 6);
    c.lineJoin = 'round'; c.lineCap = 'round';
    if (vals.length > 1) {
      c.strokeStyle = col.muted; c.globalAlpha = 0.5; c.lineWidth = 1.5;
      c.beginPath(); vals.forEach((v, i) => (i ? c.lineTo(x(i), y(v)) : c.moveTo(x(i), y(v)))); c.stroke();
      c.globalAlpha = 1;
      const avg = scoring.rolling(vals, 5);
      c.strokeStyle = col.accent; c.lineWidth = 3;
      c.beginPath(); avg.forEach((v, i) => (i ? c.lineTo(x(i), y(v)) : c.moveTo(x(i), y(v)))); c.stroke();
    }
    vals.forEach((v, i) => {
      c.fillStyle = pointColor(m, v);
      c.beginPath(); c.arc(x(i), y(v), i === progSel ? 6 : 4, 0, Math.PI * 2); c.fill();
      c.strokeStyle = i === progSel ? col.ink : col.panel; c.lineWidth = 2; c.stroke();
    });
    progCv.xs = vals.map((_, i) => x(i));
    const s = scoring.summarize(list.map((e) => e.score));
    let text = s.runs + (s.runs === 1 ? ' run' : ' runs') + ' · best ' + s.best + '% · last ' + s.last + '%';
    if (s.k >= 2) { const dlt = Math.round(s.last5 - s.first5); text += ' · average of the last ' + s.k + ': ' + Math.round(s.last5) + '% against ' + Math.round(s.first5) + '% for the first ' + s.k + ' (' + (dlt >= 0 ? '+' : '−') + Math.abs(dlt) + ')'; }
    progSummary.textContent = text;
    progInfo.textContent = progSel >= 0 && list[progSel] ? describe(list[progSel]) : 'Tap a point for the details of that run. The line is the average of your last five runs.';
  }

  progCv.addEventListener('click', (ev) => {
    const xs = progCv.xs;
    if (!xs || !xs.length) return;
    const px = ev.clientX - progCv.getBoundingClientRect().left;
    let best = 0;
    xs.forEach((v, i) => { if (Math.abs(v - px) < Math.abs(xs[best] - px)) best = i; });
    progSel = best; drawProgress();
  });
  progItem.addEventListener('change', () => { progSel = -1; drawProgress(); });
  progMetric.addEventListener('change', drawProgress);
  progPanel.addEventListener('toggle', () => { fillProgItems(); drawProgress(); });
  let clearTimer = 0;
  progClear.addEventListener('click', () => {
    if (!clearTimer) {
      progClear.textContent = 'Tap again to clear';
      clearTimer = setTimeout(() => { clearTimer = 0; progClear.textContent = 'Clear history of this item'; }, 3000);
      return;
    }
    clearTimeout(clearTimer); clearTimer = 0; progClear.textContent = 'Clear history of this item';
    history = history.filter((h) => h.k !== progItem.value);
    lsSet(HKEY, JSON.stringify(history));
    progSel = -1; fillProgItems(); drawProgress();
  });
  window.addEventListener('resize', drawProgress);
  fillProgItems();

  /* ---------- exercises ---------- */

  const exSel = $('exercise'), exLo = $('exLo'), exHi = $('exHi'), exGo = $('exGo'), exNote = $('exNote');
  exercises.list.forEach((e) => exSel.add(new Option(e.name, e.id)));
  if (!exercises.list.some((e) => e.id === state.exercise)) state.exercise = exercises.list[0].id;
  exSel.value = state.exercise;

  function fillExRange() {
    for (const [sel, val] of [[exLo, state.exLo], [exHi, state.exHi]]) {
      sel.innerHTML = '';
      for (let m = 28; m <= 84; m++) sel.add(new Option(noteName(m), String(m)));
      sel.value = String(val);
    }
    exNote.textContent = '';
  }

  fillExRange();
  exSel.addEventListener('change', () => { state.exercise = exSel.value; save(); });
  exLo.addEventListener('change', () => { state.exLo = Number(exLo.value); if (state.exHi < state.exLo) { state.exHi = state.exLo; exHi.value = String(state.exHi); } save(); });
  exHi.addEventListener('change', () => { state.exHi = Number(exHi.value); if (state.exLo > state.exHi) { state.exLo = state.exHi; exLo.value = String(state.exLo); } save(); });
  exGo.addEventListener('click', () => {
    let ex;
    try { ex = exercises.build(state.exercise, state.exLo, state.exHi); } catch (e) { showMsg('That exercise could not be built.'); return; }
    const rec = { id: 'exercise', exId: state.exercise, lo: ex.lo, hi: ex.hi, name: ex.name, bytes: ex.bytes.buffer, added: Date.now(), pickup: 0, part: 0, exercise: true };
    if (!openSong(rec)) return;
    exNote.textContent = ex.widened
      ? 'Your range is narrower than this exercise, so it goes up to ' + noteName(ex.hi) + '.'
      : 'Starts in the middle of your range, climbs, descends, and comes back. Press Play.';
    play();
  });

  /* ---------- controls ---------- */

  toggleBtn.addEventListener('click', () => (state.running ? stopMic() : start()));
  playBtn.addEventListener('click', () => (tp.playing ? pause() : play()));
  restartBtn.addEventListener('click', () => { if (score) setPos(tp.startPos); });
  seekEl.addEventListener('input', () => { if (!score) return; lastSeekInput = performance.now(); setPos(Number(seekEl.value)); });

  speedSel.addEventListener('change', () => {
    const p = tp.playing ? tlNow() : 0;
    state.speed = Number(speedSel.value);
    if (tp.playing) rebase(p);
    save();
  });
  countInCb.addEventListener('change', () => { state.countIn = countInCb.checked; save(); });
  mineCb.addEventListener('change', () => { state.guideMine = mineCb.checked; if (!state.guideMine) stopVoices((v) => v.mine); save(); });
  othersCb.addEventListener('change', () => { state.guideOthers = othersCb.checked; if (!state.guideOthers) stopVoices((v) => !v.mine); save(); });
  octSel.addEventListener('change', () => { state.octave = octSel.value; save(); });
  lyricsCb.addEventListener('change', () => { state.lyrics = lyricsCb.checked; save(); draw(); });
  laneCb.addEventListener('change', () => { state.lyricLane = laneCb.checked; save(); draw(); });
  staffSel.addEventListener('change', () => { state.staff = staffSel.value; save(); draw(); });
  namesSel.addEventListener('change', () => {
    state.names = namesSel.value;
    save();
    fillExRange();
    if (score) updateRangeInfo();
    if (lastVoiced) showNote(lastVoiced.m, null); // refresh the big readout straight away
    draw();
  });
  rangeSel.addEventListener('change', () => { state.range = rangeSel.value; save(); snapView(); draw(); });
  winSel.addEventListener('change', () => { state.windowSec = Number(winSel.value); save(); draw(); });
  a4In.addEventListener('change', () => { state.a4 = clamp(Number(a4In.value) || 440, 415, 466); a4In.value = String(state.a4); save(); });
  sensIn.addEventListener('input', () => { state.sens = Number(sensIn.value); setGate(); save(); });

  agcCb.addEventListener('change', () => {
    state.agc = agcCb.checked;
    save();
    const track = stream && stream.getAudioTracks()[0];
    if (track && track.applyConstraints) track.applyConstraints({ autoGainControl: state.agc }).catch(() => {});
    calibNote.textContent = 'Run "Set from room noise" again after changing this.';
  });

  // Measure the room for two seconds and put the threshold just above it: as sensitive as the room allows.
  calibBtn.addEventListener('click', async () => {
    if (calib) return;
    if (!state.running && !(await start())) return;
    calib = { max: -120, n: 0 };
    calibBtn.disabled = true;
    calibNote.textContent = 'Stay quiet for two seconds…';
    setTimeout(() => {
      const c = calib; calib = null; calibBtn.disabled = false;
      if (!state.running || c.n < 10) { calibNote.textContent = 'The measurement was interrupted. Try again.'; return; }
      state.sens = Math.round(sensFromGate(clamp(c.max + 8, -75, -30)));
      sensIn.value = String(state.sens);
      setGate(); save();
      calibNote.textContent = 'Room noise is about ' + Math.round(c.max) + ' dB, so the threshold is now ' + Math.round(gateDb) + ' dB.';
    }, 2000);
  });

  partSel.addEventListener('change', () => {
    if (!score) return;
    partIdx = Number(partSel.value);
    song.part = partIdx;
    state.partName = score.parts[partIdx].name.toLowerCase();
    buildQueue(); rebuildBars(); updateRangeInfo(); linesFor = null; run = null; refreshScoreBtn();
    if (tp.playing) rebase(tlNow());
    pts.length = 0; breakPushed = true;
    persistSong(song); save(); snapView(); draw();
  });

  pickupIn.addEventListener('change', () => {
    if (!song) return;
    song.pickup = Math.round(clamp(Number(pickupIn.value) || 0, 0, 16) * 2) / 2;
    pickupIn.value = String(song.pickup);
    rebuildBars();
    persistSong(song); draw();
  });

  loadBtn.addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files && fileIn.files[0];
    fileIn.value = '';
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { showMsg('That file is too large to be a MIDI score.'); return; }
    let bytes;
    try { bytes = await f.arrayBuffer(); } catch (e) { showMsg('That file could not be read.'); return; }
    const old = songs.find((s) => s.id === f.name);
    const rec = { id: f.name, name: f.name, bytes, added: Date.now(), pickup: old ? old.pickup : 0, part: old ? old.part : null };
    if (!openSong(rec)) return;
    songs = songs.filter((s) => s.id !== rec.id).concat(rec).sort((a, b) => a.name.localeCompare(b.name));
    fillSongs();
    persistSong(rec);
  });

  songSel.addEventListener('change', () => {
    const rec = songs.find((s) => s.id === songSel.value);
    if (rec) openSong(rec); else closeSong();
  });

  let removeTimer = 0;
  removeBtn.addEventListener('click', () => {
    if (!song) return;
    if (!removeTimer) {
      removeBtn.textContent = 'Tap again to remove';
      removeTimer = setTimeout(() => { removeTimer = 0; removeBtn.textContent = 'Remove this song'; }, 3000);
      return;
    }
    clearTimeout(removeTimer); removeTimer = 0; removeBtn.textContent = 'Remove this song';
    const id = song.id;
    songs = songs.filter((s) => s.id !== id);
    if (library) library.remove(id).catch(() => {});
    closeSong();
  });

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !/^(SELECT|INPUT|BUTTON|SUMMARY|TEXTAREA)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      if (score) playBtn.click(); else toggleBtn.click();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') pause(); // timers are throttled in the background, so the guide tone would stutter
    else requestWake();
  });

  /* ---------- start up ---------- */

  setLevel(METER_MIN);
  showNote(null);
  updateEmpty();
  resize();

  if (library) {
    library.list().then((list) => {
      songs = list;
      fillSongs();
      const last = lsGet('pitchtrace.last');
      const rec = songs.find((s) => s.id === last);
      if (rec) openSong(rec);
    }).catch(() => { /* no saved songs on this device */ });
  }
})();
