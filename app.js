(() => {
  'use strict';

  const { yin, median, FMIN, FMAX } = window.PitchTrace;

  const $ = (id) => document.getElementById(id);
  const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const NATURAL_LABEL = ['C', '', 'D', '', 'E', 'F', '', 'G', '', 'A', '', 'B'];
  // Visible windows in MIDI note numbers (sounding pitch).
  const RANGES = { soprano: [58, 83], alto: [53, 78], tenor: [46, 71], bass: [38, 64] };
  const GOOD = 15, CLOSE = 30; // cents

  const state = { running: false, a4: 440, windowSec: 12, range: 'auto', sens: 50 };
  try {
    const saved = JSON.parse(localStorage.getItem('pitchtrace.settings') || '{}');
    for (const k of ['a4', 'windowSec', 'range', 'sens']) if (saved[k] != null) state[k] = saved[k];
  } catch (e) { /* storage unavailable: defaults apply */ }
  function save() { try { localStorage.setItem('pitchtrace.settings', JSON.stringify(state)); } catch (e) {} }

  // Elements
  const cv = $('cv'), plot = $('plot'), ctx2d = cv.getContext('2d');
  const noteEl = $('note'), centsEl = $('cents'), verdictEl = $('verdict'), hzEl = $('hz');
  const readoutEl = $('readout'), pinEl = $('pin'), statusEl = $('status'), statusText = $('statusText');
  const toggleBtn = $('toggle'), rangeSel = $('range'), winSel = $('win'), a4In = $('a4'), sensIn = $('sens');
  const levelBar = $('levelBar'), gateMark = $('gateMark'), msgEl = $('msg'), emptyEl = $('empty');

  rangeSel.value = state.range; winSel.value = String(state.windowSec); a4In.value = String(state.a4); sensIn.value = String(state.sens);

  // Colors for the canvas come from the CSS tokens so both themes work.
  let col = {};
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue(n).trim();
    col = { grid: g('--grid'), gridStrong: g('--grid-strong'), ink: g('--ink'), muted: g('--muted'), band: g('--band'), bandStrong: g('--band-strong'), accent: g('--accent'), good: g('--good'), warn: g('--warn'), bad: g('--bad'), panel: g('--panel') };
  }
  readColors();
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(() => { readColors(); redraw(); });

  // Audio and analysis state
  let audioCtx = null, analyser = null, stream = null, source = null, wakeLock = null, raf = 0;
  const buf = new Float32Array(2048);
  let gateDb = -45, lastAnalysis = 0, stopTime = 0;
  const pts = []; // {t, m}  (m null = gap)
  let lastVoiced = null, jump = 0, breakPushed = true;
  const med = [];
  const view = { lo: 48, hi: 66 };
  let autoCenter = 57;

  const nowSec = () => performance.now() / 1000;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±');
  const qOf = (cents) => { const a = Math.abs(cents); return a <= GOOD ? 'good' : a <= CLOSE ? 'warn' : 'bad'; };
  const noteName = (midi) => NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);

  function setGate() { gateDb = -30 - state.sens * 0.3; gateMark.style.left = ((gateDb + 70) / 70) * 100 + '%'; }
  setGate();

  function setStatus(kind, text) { statusEl.dataset.s = kind; statusText.textContent = text; }
  function showMsg(text) { msgEl.textContent = text; msgEl.hidden = !text; }

  function showNote(m) {
    if (m == null) {
      readoutEl.dataset.q = 'idle';
      pinEl.removeAttribute('data-q');
      pinEl.style.left = '50%';
      noteEl.textContent = '—'; centsEl.innerHTML = '&nbsp;'; hzEl.innerHTML = '&nbsp;';
      verdictEl.textContent = state.running ? 'Sing a note' : 'Microphone off';
      if (state.running) setStatus('listening', 'Listening');
      return;
    }
    const n = Math.round(m);
    const cents = Math.round((m - n) * 100);
    const q = qOf(cents);
    readoutEl.dataset.q = q;
    noteEl.textContent = noteName(n);
    centsEl.textContent = sign(cents) + Math.abs(cents) + ' ¢';
    verdictEl.textContent = Math.abs(cents) <= GOOD ? 'In tune' : cents > 0 ? 'Sharp' : 'Flat';
    hzEl.textContent = (state.a4 * Math.pow(2, (m - 69) / 12)).toFixed(1) + ' Hz';
    pinEl.dataset.q = q;
    pinEl.style.left = clamp(50 + cents, 0, 100) + '%';
    setStatus('hearing', 'Hearing you');
  }

  function setLevel(db) { levelBar.style.width = clamp(((db + 70) / 70) * 100, 0, 100) + '%'; }

  function pushBreak(t) { if (!breakPushed) { pts.push({ t, m: null }); breakPushed = true; } }
  function unvoiced(t) {
    med.length = 0;
    pushBreak(t);
    if (lastVoiced && t - lastVoiced.t > 0.6) { lastVoiced = null; showNote(null); }
  }

  function analyse(t) {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const db = 20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-9);
    setLevel(db);
    if (db < gateDb) return unvoiced(t);
    const r = yin(buf, audioCtx.sampleRate, FMIN, FMAX);
    if (!r || r.clarity < 0.8) return unvoiced(t);
    const raw = 69 + 12 * Math.log2(r.freq / state.a4);
    // Reject sudden octave-sized jumps unless they persist for a few frames.
    if (lastVoiced && t - lastVoiced.t < 0.3 && Math.abs(raw - lastVoiced.m) > 9) {
      if (++jump < 4) return;
    }
    jump = 0;
    med.push(raw); if (med.length > 3) med.shift();
    const m = median(med);
    lastVoiced = { t, m };
    pts.push({ t, m });
    breakPushed = false;
    while (pts.length && pts[0].t < t - 40) pts.shift();
    showNote(m);
  }

  // Drawing
  let cssW = 0, cssH = 0, dpr = 1;
  function resize() {
    const r = plot.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    cssW = r.width; cssH = r.height;
    cv.width = Math.max(1, Math.round(cssW * dpr));
    cv.height = Math.max(1, Math.round(cssH * dpr));
    redraw();
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

  function colorFor(m) {
    const c = Math.abs(m - Math.round(m)) * 100;
    return c <= GOOD ? col.good : c <= CLOSE ? col.warn : col.bad;
  }

  function updateView(now) {
    let tLo, tHi;
    if (state.range === 'auto') {
      const recent = latestMidi(now, 0.6);
      if (recent != null && (recent < view.lo + 3 || recent > view.hi - 3)) autoCenter = recent;
      tLo = autoCenter - 9; tHi = autoCenter + 9;
    } else { [tLo, tHi] = RANGES[state.range]; }
    view.lo += (tLo - view.lo) * 0.12;
    view.hi += (tHi - view.hi) * 0.12;
  }

  function draw(now) {
    if (!cssW) return;
    const c = ctx2d;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, cssW, cssH);
    updateView(now);

    const L = 44, R = 12, T = 8, B = 18;
    const pw = cssW - L - R, ph = cssH - T - B;
    if (pw < 40 || ph < 40) return;
    const yOf = (m) => T + ((view.hi - m) * ph) / (view.hi - view.lo);
    const xOf = (t) => L + pw - ((now - t) / state.windowSec) * pw;

    // Highlight the row of the note being sung, with a narrow in-tune corridor.
    const cur = latestMidi(now, 0.4);
    if (cur != null) {
      const n = Math.round(cur);
      c.fillStyle = col.band;
      c.fillRect(L, yOf(n + 0.5), pw, yOf(n - 0.5) - yOf(n + 0.5));
      c.fillStyle = col.bandStrong;
      c.fillRect(L, yOf(n + GOOD / 100), pw, yOf(n - GOOD / 100) - yOf(n + GOOD / 100));
    }

    // Semitone grid and note labels.
    c.font = '11px ui-monospace, Menlo, Consolas, monospace';
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (let m = Math.ceil(view.lo); m <= Math.floor(view.hi); m++) {
      const pc = ((m % 12) + 12) % 12;
      const y = yOf(m);
      const nat = NATURAL_LABEL[pc] !== '';
      c.strokeStyle = nat ? col.gridStrong : col.grid;
      c.lineWidth = pc === 0 ? 1.5 : 1;
      c.beginPath(); c.moveTo(L, y); c.lineTo(L + pw, y); c.stroke();
      if (nat) {
        c.fillStyle = pc === 0 ? col.ink : col.muted;
        c.fillText(NATURAL_LABEL[pc] + (Math.floor(m / 12) - 1), L - 8, y);
      }
    }

    // Time grid.
    const step = state.windowSec <= 6 ? 1 : state.windowSec <= 12 ? 2 : 4;
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.fillStyle = col.muted; c.font = '10px ui-monospace, Menlo, Consolas, monospace';
    c.strokeStyle = col.grid; c.lineWidth = 1;
    for (let a = step; a < state.windowSec; a += step) {
      const x = L + pw - (a / state.windowSec) * pw;
      c.beginPath(); c.moveTo(x, T); c.lineTo(x, T + ph); c.stroke();
      c.fillText('−' + a + 's', x, cssH - 5);
    }
    c.strokeStyle = col.muted; c.lineWidth = 1;
    c.beginPath(); c.moveTo(L + pw, T); c.lineTo(L + pw, T + ph); c.stroke();

    // Pitch trace, colored by distance from the nearest semitone.
    c.save();
    c.beginPath(); c.rect(L, T, pw, ph); c.clip();
    c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = 3.5;
    let prev = null;
    for (const p of pts) {
      if (p.m == null) { prev = null; continue; }
      if (prev && p.t - prev.t < 0.15) {
        const x2 = xOf(p.t);
        if (x2 >= L) {
          c.globalAlpha = 0.25 + 0.75 * clamp((x2 - L) / pw, 0, 1);
          c.strokeStyle = colorFor(p.m);
          c.beginPath(); c.moveTo(xOf(prev.t), yOf(prev.m)); c.lineTo(x2, yOf(p.m)); c.stroke();
        }
      }
      prev = p;
    }
    c.globalAlpha = 1;
    const last = pts[pts.length - 1];
    if (last && last.m != null && now - last.t < 0.2) {
      const x = xOf(last.t), y = yOf(last.m);
      c.fillStyle = colorFor(last.m);
      c.beginPath(); c.arc(x, y, 5.5, 0, Math.PI * 2); c.fill();
      c.strokeStyle = col.panel; c.lineWidth = 2;
      c.beginPath(); c.arc(x, y, 5.5, 0, Math.PI * 2); c.stroke();
    }
    c.restore();
  }

  function redraw() { draw(state.running ? nowSec() : stopTime || nowSec()); }

  function tick(ts) {
    if (!state.running) return;
    raf = requestAnimationFrame(tick);
    if (ts - lastAnalysis >= 32) { lastAnalysis = ts; analyse(nowSec()); }
    draw(nowSec());
  }

  // Start / stop
  async function start() {
    showMsg('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.isSecureContext) {
      showMsg('The microphone is only available on secure pages. Open this file from https:// (for example GitHub Pages or Netlify) or from localhost.');
      setStatus('error', 'No microphone access');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      const name = e && e.name;
      showMsg(name === 'NotAllowedError' || name === 'SecurityError'
        ? 'The microphone is blocked. Allow it in the browser’s site settings, then press Start again.'
        : name === 'NotFoundError'
          ? 'No microphone was found on this device.'
          : 'The microphone could not be opened: ' + (e && e.message ? e.message : name));
      setStatus('error', 'No microphone access');
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC({ latencyHint: 'interactive' });
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser); // not connected to the speakers, so there is no feedback

    pts.length = 0; med.length = 0; lastVoiced = null; jump = 0; breakPushed = true;
    state.running = true; stopTime = 0;
    toggleBtn.textContent = 'Stop'; toggleBtn.dataset.on = 'true';
    emptyEl.hidden = true;
    setStatus('listening', 'Listening');
    showNote(null);
    requestWake();
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    state.running = false;
    cancelAnimationFrame(raf);
    stopTime = nowSec();
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (audioCtx) audioCtx.close().catch(() => {});
    stream = null; audioCtx = null; analyser = null; source = null;
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    toggleBtn.textContent = 'Start'; toggleBtn.dataset.on = 'false';
    setStatus('off', 'Microphone off');
    showNote(null);
    setLevel(-70);
    draw(stopTime);
  }

  function requestWake() {
    if (navigator.wakeLock && state.running) navigator.wakeLock.request('screen').then((l) => { wakeLock = l; }).catch(() => {});
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') requestWake(); });

  toggleBtn.addEventListener('click', () => (state.running ? stop() : start()));
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !/^(SELECT|INPUT|BUTTON|SUMMARY)$/.test(document.activeElement.tagName)) { e.preventDefault(); toggleBtn.click(); }
  });
  rangeSel.addEventListener('change', () => { state.range = rangeSel.value; save(); redraw(); });
  winSel.addEventListener('change', () => { state.windowSec = Number(winSel.value); save(); redraw(); });
  a4In.addEventListener('change', () => { state.a4 = clamp(Number(a4In.value) || 440, 415, 466); a4In.value = String(state.a4); save(); });
  sensIn.addEventListener('input', () => { state.sens = Number(sensIn.value); setGate(); save(); });

  setLevel(-70);
  showNote(null);
  resize();
})();
