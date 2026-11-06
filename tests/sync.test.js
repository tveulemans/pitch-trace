const assert = require('assert');
const s = require('../sync.js');

// history: union, no duplicates, sorted
const h = (k, t) => ({ v: 2, k, t, levels: [1], label: k });
let m = s.merge({ history: [h('a', 1), h('a', 2)] }, { history: [h('a', 2), h('b', 3)] });
assert.deepStrictEqual(m.history.map((x) => x.k + x.t), ['a1', 'a2', 'b3']);

// clearing an item on one device removes its older entries everywhere, but not newer ones
m = s.merge({ history: [h('a', 1), h('a', 9)], cleared: { a: 5 } }, { history: [h('a', 2), h('b', 3)] });
assert.deepStrictEqual(m.history.map((x) => x.k + x.t), ['b3', 'a9']);

// songs: the more recently changed copy wins; new songs are added
const song = (id, mod, extra) => Object.assign({ id, name: id, bytes: 'AAAA', added: 1, mod }, extra);
m = s.merge({ songs: { x: song('x', 5, { pickup: 1 }), y: song('y', 2) } }, { songs: { x: song('x', 7, { pickup: 2 }), z: song('z', 1) } });
assert.strictEqual(m.songs.x.pickup, 2);
assert.deepStrictEqual(Object.keys(m.songs).sort(), ['x', 'y', 'z']);

// a song removed after its last change disappears; one changed after the removal survives
m = s.merge({ songs: { x: song('x', 5) }, gone: {} }, { songs: {}, gone: { x: 6 } });
assert.ok(!m.songs.x); assert.strictEqual(m.gone.x, 6);
m = s.merge({ songs: { x: song('x', 9) } }, { songs: {}, gone: { x: 6 } });
assert.ok(m.songs.x); assert.ok(!('x' in m.gone));

// settings: newest wins
m = s.merge({ settings: { vals: { a4: 440 }, t: 1 } }, { settings: { vals: { a4: 442 }, t: 2 } });
assert.strictEqual(m.settings.vals.a4, 442);

// merging is stable: merging twice changes nothing, and null remote is fine
const once = s.merge({ history: [h('a', 1)], songs: { x: song('x', 1) } }, null);
assert.ok(s.same(once, s.merge(once, once)));

// bytes survive base64
const bytes = new Uint8Array([0, 1, 2, 250, 255, 77]);
assert.deepStrictEqual(Array.from(new Uint8Array(s.b64ToBytes(s.bytesToB64(bytes.buffer)))), Array.from(bytes));

// remote client against a stubbed GitHub
(async () => {
  let stored = null, sha = 0;
  const f = async (url, o = {}) => {
    const res = (status, body) => ({ status, ok: status < 300, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
    if (!url.includes('/contents/')) return res(200, {});
    if ((o.method || 'GET') === 'PUT') {
      const b = JSON.parse(o.body);
      if (stored && b.sha !== String(sha)) return res(409, {});
      stored = Buffer.from(b.content, 'base64').toString('utf8'); sha++;
      return res(200, { content: { sha: String(sha) } });
    }
    if (!stored) return res(404, {});
    return res(200, { sha: String(sha), encoding: 'base64', content: Buffer.from(stored).toString('base64') });
  };
  const r = s.remote({ token: 't', repo: 'o/r' }, f);
  assert.strictEqual(await r.get(), null);
  await r.put({ v: 1, history: [h('é', 1)] }, null);
  const got = await r.get();
  assert.strictEqual(got.data.history[0].k, 'é');
  await assert.rejects(() => r.put({ v: 1 }, 'stale'), (e) => e.conflict === true);
  console.log('sync tests passed');
})();
