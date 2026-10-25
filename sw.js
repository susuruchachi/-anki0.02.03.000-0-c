// ================================================================
// ★【0.03.14】すするanki サービスワーカー
//  ・アプリ本体はネット優先（更新がすぐ届く）。つながらないときは保存しておいたもので開く（オフライン対応）
//  ・CDN のライブラリは保存しておいたものを使い、裏で新しくする
//  ・通知：プッシュ通知の表示、通知をタップしたらアプリを開く
//  ・バックグラウンドでの確認（対応している Android の Chrome など）：学習の催促・アップデートのお知らせ
// ================================================================
importScripts('notify-kv.js');

const CORE_CACHE = 'susuru-core-v1';
const RUNTIME_CACHE = 'susuru-runtime-v1';
const CORE_FILES = [
  './', './index.html', './manifest.webmanifest', './RULES.md', './notify-kv.js',
  './version-info.js', './release-notes.js', './config.js', './utils.js', './storage.js', './tree.js', './pages.js', './box.js',
  './quiz.js', './context-menu.js', './import-export.js', './batch-add.js', './scan-import.js', './shared.js', './stats.js',
  './social.js', './match.js', './safety.js', './updates.js', './auth.js', './main.js', './rich-content.js', './rich-editors.js',
  './chem-search.js', './notify.js', './ai.js', './drill.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/badge-96.png', './icons/apple-touch-icon.png', './icons/favicon-48.png'
];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com', 'www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CORE_CACHE).then(cache =>
    Promise.all(CORE_FILES.map(f => cache.add(new Request(f, { cache: 'reload' })).catch(() => {})))
  ).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith('susuru-') && k !== CORE_CACHE && k !== RUNTIME_CACHE).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});

function networkFirst(req) {
  return new Promise(resolve => {
    let done = false;
    const fromCache = () => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : null));
    // 電波が弱いときは 6 秒で保存しておいたものに切り替える
    const timer = setTimeout(() => { fromCache().then(r => { if (r && !done) { done = true; resolve(r); } }); }, 6000);
    fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CORE_CACHE).then(c => c.put(req, copy)).catch(() => {}); }
      if (!done) { done = true; clearTimeout(timer); resolve(res); }
    }).catch(() => {
      fromCache().then(r => { if (!done) { done = true; clearTimeout(timer); resolve(r || new Response('オフラインです', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })); } });
    });
  });
}
function staleWhileRevalidate(req) {
  return caches.open(RUNTIME_CACHE).then(cache => cache.match(req).then(hit => {
    const net = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {}); return res; }).catch(() => hit);
    return hit || net;
  }));
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('/sw.js')) return;
    event.respondWith(networkFirst(req));
  } else if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req));
  }
});

// ---------------- 通知 ----------------
function show(title, body, opts = {}) {
  return self.registration.showNotification(title || 'すするanki', Object.assign({
    body: body || '', icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', lang: 'ja',
    tag: opts.tag || 'susuru', renotify: !!opts.renotify, data: { url: opts.url || './' }
  }, opts.extra || {}));
}

// プッシュ通知（サーバーから。Firebase Cloud Messaging のデータメッセージ）
self.addEventListener('push', event => {
  let j = {};
  try { j = event.data ? event.data.json() : {}; } catch (e) { j = { data: { body: event.data && event.data.text() } }; }
  const d = j.data || {}, n = j.notification || {};
  const title = d.title || n.title || 'すするanki';
  const body = d.body || n.body || '';
  event.waitUntil((async () => {
    if (d.kind === 'update' && d.version) await notifyKvSet('notifiedVersion', d.version);
    if (d.kind === 'reminder') await notifyKvSet('lastRemindDate', localDateStr());
    await show(title, body, { tag: d.tag || d.kind || 'susuru', url: d.url || './', renotify: true });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus(); }
    return self.clients.openWindow(target);
  }));
});

// 画面からの依頼で通知を出す（テスト通知・アプリを開いている間の催促）
self.addEventListener('message', event => {
  const m = event.data || {};
  if (m.type === 'notify') event.waitUntil(show(m.title, m.body, { tag: m.tag, url: m.url, renotify: true }));
  if (m.type === 'check') event.waitUntil(backgroundCheck()); // 動作確認用
});

// ---------------- バックグラウンドでの確認 ----------------
// （Periodic Background Sync。ホーム画面に追加した Android の Chrome などで、ブラウザが決めた間隔で呼ばれる）
async function backgroundCheck() {
  const prefs = (await notifyKvGet('prefs')) || {};
  const pushActive = !!(await notifyKvGet('pushActive')); // プッシュ通知が使えるなら、そちらに任せる（二重に知らせない）
  const today = localDateStr();
  // 学習の催促
  if (prefs.reminder && !pushActive) {
    const [h, m] = String(prefs.time || '20:00').split(':').map(Number);
    const now = new Date();
    const lastStudy = await notifyKvGet('lastStudyDate');
    const lastRemind = await notifyKvGet('lastRemindDate');
    if (now.getHours() * 60 + now.getMinutes() >= h * 60 + m && lastStudy !== today && lastRemind !== today) {
      await notifyKvSet('lastRemindDate', today);
      const weak = await notifyKvGet('weakCount');
      await show('📚 今日の学習がまだです', weak ? `苦手なカードが ${weak} 枚あります。1問だけでも解いてみませんか？` : '1問だけでも解いてみませんか？', { tag: 'reminder' });
    }
  }
  // アップデートのお知らせ
  if (prefs.updates !== false && !pushActive) {
    try {
      const res = await fetch('./version-info.js', { cache: 'no-store' });
      const txt = await res.text();
      const v = (txt.match(/APP_VERSION\s*=\s*["']([^"']+)["']/) || [])[1];
      const seen = await notifyKvGet('lastSeenVersion');
      const notified = await notifyKvGet('notifiedVersion');
      if (v && seen && v !== seen && v !== notified) {
        await notifyKvSet('notifiedVersion', v);
        await show('🆕 すするanki がアップデートされました', `v${v} の新しい機能・修正があります。開いてお知らせを見てみましょう`, { tag: 'update' });
      }
    } catch (e) { /* オフライン */ }
  }
}
self.addEventListener('periodicsync', event => {
  if (event.tag === 'susuru-check') event.waitUntil(backgroundCheck());
});
