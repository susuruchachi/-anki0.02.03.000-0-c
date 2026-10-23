// ★【0.03.14】画面（ページ）とサービスワーカーの両方から読み書きする小さな保存場所（IndexedDB）
// 通知の設定・最後に学習した日・最後に知らせたバージョンなどを置く
(function (g) {
  const DB = 'susuru_anki_notify', STORE = 'kv';
  function open() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  g.notifyKvGet = function (key) {
    return open().then(d => new Promise(resolve => {
      const r = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(undefined);
    })).catch(() => undefined);
  };
  g.notifyKvSet = function (key, value) {
    return open().then(d => new Promise(resolve => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    })).catch(() => false);
  };
  // 端末の時刻での日付（YYYY-MM-DD）
  g.localDateStr = function (d) {
    d = d || new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
})(typeof self !== 'undefined' ? self : window);
