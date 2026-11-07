/* Sync for Pitch Trace: keeps songs, progress and a few settings in one JSON file (data.json) in a private
 * GitHub repository, through the GitHub contents API. Two devices merge their data, so nothing is lost when
 * you practise on both. The merge rules are pure functions so they can be tested without a browser. */
(function (root) {
  'use strict';

  const PATH = 'data.json';
  /* Settings worth sharing. Device-specific ones (audio delay, microphone sensitivity, speed, view window) stay local. */
  const SYNCED = ['a4', 'range', 'octave', 'names', 'staff', 'lyrics', 'lyricLane', 'level', 'accent', 'countIn', 'guideMine', 'guideOthers', 'exLo', 'exHi', 'exLen', 'exMode', 'exVar'];
  const HISTORY_MAX = 600;

  function bytesToB64(buf) {
    const u = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function b64ToBytes(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  const textToB64 = (s) => bytesToB64(new TextEncoder().encode(s));
  const b64ToText = (b) => new TextDecoder().decode(new Uint8Array(b64ToBytes(b)));

  function norm(d) {
    d = d && typeof d === 'object' ? d : {};
    const st = d.settings && typeof d.settings === 'object' ? d.settings : {};
    return {
      v: 1,
      history: Array.isArray(d.history) ? d.history : [],
      cleared: d.cleared && typeof d.cleared === 'object' ? d.cleared : {},
      songs: d.songs && typeof d.songs === 'object' ? d.songs : {},
      gone: d.gone && typeof d.gone === 'object' ? d.gone : {},
      settings: { vals: st.vals && typeof st.vals === 'object' ? st.vals : {}, t: Number(st.t) || 0 },
    };
  }
  const modOf = (r) => Number(r && (r.mod || r.added)) || 0;

  /* a and b are { history, cleared, songs: {id: record with bytes as base64}, gone: {id: time}, settings: {vals, t} }. */
  function merge(a, b) {
    a = norm(a); b = norm(b);
    const out = norm(null);
    for (const src of [a.cleared, b.cleared]) for (const k in src) out.cleared[k] = Math.max(out.cleared[k] || 0, Number(src[k]) || 0);
    const seen = new Map();
    for (const h of a.history.concat(b.history)) {
      if (!h || typeof h.k !== 'string' || typeof h.t !== 'number') continue;
      if (h.t <= (out.cleared[h.k] || 0)) continue;
      seen.set(h.k + '|' + h.t, h);
    }
    out.history = Array.from(seen.values()).sort((x, y) => x.t - y.t).slice(-HISTORY_MAX);
    for (const src of [a.gone, b.gone]) for (const id in src) out.gone[id] = Math.max(out.gone[id] || 0, Number(src[id]) || 0);
    const ids = new Set(Object.keys(a.songs).concat(Object.keys(b.songs)));
    for (const id of ids) {
      const x = a.songs[id], y = b.songs[id];
      const pick = !x ? y : !y ? x : modOf(y) > modOf(x) ? y : x;
      if ((out.gone[id] || 0) >= modOf(pick)) continue;          // removed after it was last changed
      out.songs[id] = pick;
      delete out.gone[id];
    }
    out.settings = b.settings.t > a.settings.t ? b.settings : a.settings;
    return out;
  }

  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return JSON.stringify(v);
  }
  const same = (a, b) => stable(norm(a)) === stable(norm(b));

  function explain(status, where) {
    if (status === 401) return 'GitHub refused the token. Check that it is correct and has not expired.';
    if (status === 403) return 'GitHub says no (403). The token may lack "Contents: read and write", or the rate limit was hit.';
    if (status === 404) return 'The repository was not found, or the token has no access to it.';
    return 'GitHub answered ' + status + (where ? ' (' + where + ')' : '') + '.';
  }

  /* cfg: { token, repo: "owner/name" }. f is fetch (a stub in tests). */
  function remote(cfg, f) {
    f = f || ((...a) => root.fetch(...a));
    const url = 'https://api.github.com/repos/' + cfg.repo + '/contents/' + PATH;
    const H = { Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const fail = (r, where) => Object.assign(new Error(explain(r.status, where)), { status: r.status });
    return {
      async get() {
        const r = await f(url, { headers: H, cache: 'no-store' });
        if (r.status === 404) {
          const p = await f('https://api.github.com/repos/' + cfg.repo, { headers: H, cache: 'no-store' });
          if (!p.ok) throw fail(p, 'repository');
          return null;                                            // the repository exists but has no data file yet
        }
        if (!r.ok) throw fail(r, 'reading');
        const j = await r.json();
        let text;
        if (j.content && j.encoding === 'base64') text = b64ToText(j.content);
        else {                                                    // files over 1 MB come back without content
          const r2 = await f(url, { headers: Object.assign({}, H, { Accept: 'application/vnd.github.raw+json' }), cache: 'no-store' });
          if (!r2.ok) throw fail(r2, 'reading');
          text = await r2.text();
        }
        return { data: JSON.parse(text), sha: j.sha };
      },
      async put(data, sha) {
        const body = { message: 'Sync ' + new Date().toISOString().slice(0, 16).replace('T', ' '), content: textToB64(JSON.stringify(data)) };
        if (sha) body.sha = sha;
        const r = await f(url, { method: 'PUT', headers: Object.assign({}, H, { 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
        if (r.status === 409 || r.status === 422) throw Object.assign(new Error('The data changed on another device while syncing.'), { conflict: true });
        if (!r.ok) throw fail(r, 'saving');
        const j = await r.json();
        return j.content && j.content.sha;
      },
    };
  }

  const api = { sync: { merge, same, remote, norm, bytesToB64, b64ToBytes, SYNCED, modOf } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api.sync;
  root.PitchTrace = Object.assign(root.PitchTrace || {}, api);
})(typeof self !== 'undefined' ? self : this);
