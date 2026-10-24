/* Song library for Pitch Trace: keeps loaded MIDI files in this browser (IndexedDB).
 * Nothing is uploaded anywhere. Every call can fail (private windows, blocked storage),
 * so callers treat the library as optional. */
(function (root) {
  'use strict';

  const DB = 'pitch-trace', STORE = 'songs';

  function open() {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) return reject(new Error('IndexedDB is not available'));
      let req;
      try { req = root.indexedDB.open(DB, 1); } catch (e) { return reject(e); }
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Storage is blocked'));
    });
  }

  function run(mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      let req;
      const t = db.transaction(STORE, mode);
      try { req = fn(t.objectStore(STORE)); } catch (e) { db.close(); return reject(e); }
      t.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
      t.onerror = () => { db.close(); reject(t.error); };
      t.onabort = () => { db.close(); reject(t.error || new Error('Storage was interrupted')); };
    }));
  }

  const library = {
    list: () => run('readonly', (s) => s.getAll()).then((rows) => (rows || []).sort((a, b) => a.name.localeCompare(b.name))),
    put: (rec) => run('readwrite', (s) => s.put(rec)),
    remove: (id) => run('readwrite', (s) => s.delete(id)),
  };

  root.PitchTrace = Object.assign(root.PitchTrace || {}, { library });
})(typeof window !== 'undefined' ? window : globalThis);
