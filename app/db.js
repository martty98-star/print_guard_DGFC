/* PrintGuard — IndexedDB helpers (loaded before app.js) */
'use strict';

(function attachPrintGuardAppDB(global) {
  const DB_NAME     = 'printguard-db';
  const DB_VERSION  = 2;
  const ST_ITEMS    = 'items';
  const ST_MOVES    = 'movements';
  const ST_CORECS   = 'co_records';
  const ST_SETTINGS = 'settings';

  let db;

  function setDb(instance) {
    db = instance;
  }

  function openDB() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(ST_ITEMS))
          d.createObjectStore(ST_ITEMS, { keyPath: 'articleNumber' });
        if (!d.objectStoreNames.contains(ST_MOVES)) {
          const m = d.createObjectStore(ST_MOVES, { keyPath: 'id' });
          m.createIndex('byArticle', 'articleNumber', { unique: false });
        }
        if (!d.objectStoreNames.contains(ST_CORECS)) {
          const c = d.createObjectStore(ST_CORECS, { keyPath: 'id' });
          c.createIndex('byMachine', 'machineId', { unique: false });
        }
        if (!d.objectStoreNames.contains(ST_SETTINGS))
          d.createObjectStore(ST_SETTINGS, { keyPath: 'key' });
      };
      req.onsuccess = e => res(e.target.result);
      req.onerror   = e => rej(e.target.error);
    });
  }

  function idbAll(store) {
    return new Promise((res, rej) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = e => res(e.target.result || []);
      req.onerror   = e => rej(e.target.error);
    });
  }

  function idbPut(store, obj) {
    return new Promise((res, rej) => {
      const req = db.transaction(store, 'readwrite').objectStore(store).put(obj);
      req.onsuccess = e => res(e.target.result);
      req.onerror   = e => rej(e.target.error);
    });
  }

  function idbDelete(store, key) {
    return new Promise((res, rej) => {
      const req = db.transaction(store, 'readwrite').objectStore(store).delete(key);
      req.onsuccess = () => res();
      req.onerror   = e => rej(e.target.error);
    });
  }

  function idbClear(store) {
    return new Promise((res, rej) => {
      const req = db.transaction(store, 'readwrite').objectStore(store).clear();
      req.onsuccess = () => res();
      req.onerror   = e => rej(e.target.error);
    });
  }

  global.PrintGuardAppDB = {
    DB_NAME,
    DB_VERSION,
    ST_ITEMS,
    ST_MOVES,
    ST_CORECS,
    ST_SETTINGS,
    setDb,
    openDB,
    idbAll,
    idbPut,
    idbDelete,
    idbClear,
  };
})(typeof window !== 'undefined' ? window : globalThis);
