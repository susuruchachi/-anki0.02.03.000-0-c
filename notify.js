// ================================================================
// ★【0.03.14】アプリ化（PWA）と通知
//  ・サービスワーカーを登録して、ホーム画面に追加（インストール）できるようにする
//  ・通知：学習の催促（決めた時刻までにその日まだ解いていなければ）、アップデートのお知らせ
//    1) プッシュ通知（Firebase Cloud Messaging）… アプリを閉じていても届く。送るのは GitHub Actions（tools/push-notify.js）
//    2) バックグラウンドでの確認（Periodic Background Sync）… 対応している Android の Chrome などで、ブラウザが決めた間隔で確認
//    3) アプリを開いている（裏に回っている）間 … 時刻になったら知らせる
// ================================================================
const NOTIFY_PREFS_KEY = 'susuru_anki_notify_prefs';
const PUSH_COL = 'susuru_anki_push';
const PUSH_META_DOC = 'susuru_anki_meta/push';
const FCM_VAPID_KEY = ''; // 空なら Firebase の既定の鍵を使う（Firebase コンソールで作った鍵を使う場合はここに入れる）
const APK_URL = 'apk/susuruanki.apk';

let _swReg = null;
let _deferredInstall = null;
let _pushState = { token: null, serverAlive: null, error: '' };
let _periodicOk = null;

function getNotifyPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(NOTIFY_PREFS_KEY) || '{}') || {}; } catch (e) {}
  return { reminder: !!p.reminder, time: /^\d{1,2}:\d{2}$/.test(p.time || '') ? p.time : '20:00', updates: p.updates !== false, friends: p.friends !== false, taunt: p.taunt !== false };
}
function saveNotifyPrefs(p) {
  try { localStorage.setItem(NOTIFY_PREFS_KEY, JSON.stringify(p)); } catch (e) {}
  if (typeof notifyKvSet === 'function') notifyKvSet('prefs', p);
  syncPushDoc();
}

function isStandaloneApp() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true || document.referrer.startsWith('android-app://');
}
function isIOSDevice() { return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function isAndroidDevice() { return /Android/i.test(navigator.userAgent); }

// 苦手・しっかりのカードの枚数（通知の文に使う）
function weakCardCount() {
  try { return db.filter(q => !isGraduated(q) && q.level <= 0 && ((q.correct || 0) + (q.incorrect || 0)) > 0).length; } catch (e) { return 0; }
}

// ---------------- サービスワーカー ----------------
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      _swReg = reg;
      afterServiceWorkerReady();
    }).catch(e => console.warn('サービスワーカーを登録できませんでした:', e));
  });
}
async function afterServiceWorkerReady() {
  if (typeof notifyKvSet !== 'function') return;
  // 今開いているバージョンは「知らせ済み」にする（バックグラウンドで同じバージョンを知らせないように）
  if (typeof APP_VERSION !== 'undefined') { notifyKvSet('lastSeenVersion', APP_VERSION); notifyKvSet('notifiedVersion', APP_VERSION); }
  notifyKvSet('prefs', getNotifyPrefs());
  notifyKvSet('weakCount', weakCardCount());
  try { const ls = localStorage.getItem('susuru_anki_last_study'); if (ls) notifyKvSet('lastStudyDate', ls); } catch (e) {}
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    await ensurePeriodicSync();
    if (currentUser) ensurePush();
  }
  renderNotifySettings();
}

// ---------------- インストール ----------------
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); _deferredInstall = e; renderNotifySettings(); });
window.addEventListener('appinstalled', () => { _deferredInstall = null; renderNotifySettings(); });
async function installApp() {
  if (_deferredInstall) {
    _deferredInstall.prompt();
    try { await _deferredInstall.userChoice; } catch (e) {}
    _deferredInstall = null;
    renderNotifySettings();
    return;
  }
  if (isIOSDevice()) alert('iPhone・iPad では：\nSafari の下にある共有ボタン（□に↑）→「ホーム画面に追加」を押してください。\n（通知を受け取るには、ホーム画面に追加したアプリから開いて通知をオンにします）');
  else alert('ブラウザのメニュー（︙）から「アプリをインストール」または「ホーム画面に追加」を選んでください。');
}

// ---------------- 通知の許可 ----------------
async function enableNotifications() {
  if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) {
    if (isIOSDevice() && !isStandaloneApp()) return alert('iPhone・iPad で通知を受け取るには、先に Safari の共有ボタン →「ホーム画面に追加」でアプリにして、ホーム画面のアイコンから開いてください（iOS 16.4 以降）。');
    return alert('このブラウザは通知に対応していません。');
  }
  let perm = Notification.permission;
  if (perm !== 'granted') perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    renderNotifySettings();
    return alert('通知が許可されませんでした。ブラウザ（または端末）の設定で、このサイトの通知を許可してください。');
  }
  let firstTime = false; try { firstTime = !localStorage.getItem(NOTIFY_PREFS_KEY); } catch (e) {}
  const p = getNotifyPrefs();
  if (firstTime || (!p.reminder && !p.updates)) { p.reminder = true; p.updates = true; }
  saveNotifyPrefs(p);
  await ensurePeriodicSync();
  await ensurePush();
  renderNotifySettings();
  sendTestNotification(true);
}

async function ensurePeriodicSync() {
  _periodicOk = false;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!('periodicSync' in reg)) return false;
    try { const st = await navigator.permissions.query({ name: 'periodic-background-sync' }); if (st.state !== 'granted') return false; } catch (e) {}
    await reg.periodicSync.register('susuru-check', { minInterval: 60 * 60 * 1000 });
    _periodicOk = true;
    return true;
  } catch (e) { return false; }
}

// プッシュ通知の宛先（トークン）を登録する
async function ensurePush() {
  _pushState.error = '';
  try {
    if (!currentUser || typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
    if (!firebase.messaging || !(await firebase.messaging.isSupported())) { _pushState.error = 'この端末・ブラウザはプッシュ通知に対応していません'; return false; }
    const reg = await navigator.serviceWorker.ready;
    const opts = { serviceWorkerRegistration: reg };
    if (FCM_VAPID_KEY) opts.vapidKey = FCM_VAPID_KEY;
    const token = await firebase.messaging().getToken(opts);
    if (!token) return false;
    _pushState.token = token;
    try { localStorage.setItem('susuru_anki_push_token', token); localStorage.setItem('susuru_anki_push_uid', currentUser.uid); } catch (e) {}
    await syncPushDoc(true);
    await checkPushServer();
    return true;
  } catch (e) {
    console.warn('プッシュ通知の登録に失敗:', e);
    _pushState.error = 'プッシュ通知を登録できませんでした（' + (e.code || e.message || '') + '）';
    return false;
  } finally { renderNotifySettings(); }
}

// 送信側（GitHub Actions）が動いているか：最後に動いた時刻が新しければ、催促・お知らせはプッシュに任せる
async function checkPushServer() {
  try {
    const snap = await firestore.doc(PUSH_META_DOC).get();
    const last = snap.exists ? (snap.data().lastRunAt || 0) : 0;
    _pushState.serverAlive = !!last && Date.now() - last < 3 * 60 * 60 * 1000;
  } catch (e) { _pushState.serverAlive = false; }
  if (typeof notifyKvSet === 'function') notifyKvSet('pushActive', !!(_pushState.token && _pushState.serverAlive));
  renderNotifySettings();
}

// 設定・最後に学習した日などをクラウドの通知用ドキュメントに書く（送信側が読む）
let _pushDocTimer = null;
function syncPushDoc(immediate) {
  clearTimeout(_pushDocTimer);
  const run = async () => {
    const token = _pushState.token || (() => { try { return localStorage.getItem('susuru_anki_push_token'); } catch (e) { return null; } })();
    if (!currentUser || !token) return;
    const p = getNotifyPrefs();
    let lastStudy = null; try { lastStudy = localStorage.getItem('susuru_anki_last_study'); } catch (e) {}
    const body = {
      uid: currentUser.uid, reminder: p.reminder, time: p.time, updates: p.updates, friends: p.friends, taunt: p.taunt,
      tzOffset: new Date().getTimezoneOffset(), weakCount: weakCardCount(), updatedAt: Date.now(),
      tokens: { [token]: { at: Date.now(), ua: (isAndroidDevice() ? 'android' : isIOSDevice() ? 'ios' : 'other') + (isStandaloneApp() ? '-app' : '') } }
    };
    if (lastStudy) body.lastStudyDate = lastStudy;
    try { await firestore.collection(PUSH_COL).doc(currentUser.uid).set(body, { merge: true }); }
    catch (e) { console.warn('通知設定の保存に失敗:', e); _pushState.error = '通知の設定をクラウドに保存できませんでした（Firestore のルールを確認してください）'; renderNotifySettings(); }
  };
  if (immediate) return run();
  _pushDocTimer = setTimeout(run, 1500);
}

// ログアウトの前に、この端末への通知を止める
async function removePushTokenBeforeLogout() {
  try {
    const token = localStorage.getItem('susuru_anki_push_token');
    if (currentUser && token) await firestore.collection(PUSH_COL).doc(currentUser.uid).update(new firebase.firestore.FieldPath('tokens', token), firebase.firestore.FieldValue.delete());
  } catch (e) {}
  try { localStorage.removeItem('susuru_anki_push_token'); } catch (e) {}
  _pushState.token = null;
  if (typeof notifyKvSet === 'function') notifyKvSet('pushActive', false);
}

// ログインしたら（auth.js から呼ぶ）
function onNotifyAuthReady() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && 'serviceWorker' in navigator) ensurePush();
  else renderNotifySettings();
}

// 解いたら呼ぶ（quiz.js の recordDailyLog から）：今日は学習済み
let _lastMarkedStudy = null;
function notifyMarkStudied() {
  const today = localDateStr();
  if (_lastMarkedStudy === today) return;
  _lastMarkedStudy = today;
  try { localStorage.setItem('susuru_anki_last_study', today); } catch (e) {}
  if (typeof notifyKvSet === 'function') { notifyKvSet('lastStudyDate', today); notifyKvSet('weakCount', weakCardCount()); }
  syncPushDoc();
}

// 通知を出す（サービスワーカー経由。無ければ Notification で）
async function showLocalNotification(title, body, tag) {
  try {
    const reg = _swReg || (navigator.serviceWorker && await navigator.serviceWorker.ready);
    if (reg && reg.showNotification) return reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', tag: tag || 'susuru', lang: 'ja', data: { url: './' } });
  } catch (e) {}
  try { new Notification(title, { body, icon: 'icons/icon-192.png', tag }); } catch (e) {}
}
function sendTestNotification(silentIfDenied) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') { if (!silentIfDenied) alert('先に「🔔 通知をオンにする」を押してください。'); return; }
  showLocalNotification('🔔 すするanki', '通知はこのように届きます。', 'test');
}

// アプリを開いている（裏に回っている）間：時刻になったら催促する
setInterval(async () => {
  const p = getNotifyPrefs();
  if (!p.reminder || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;
  if (_pushState.token && _pushState.serverAlive) return;
  const today = localDateStr();
  const [h, m] = p.time.split(':').map(Number);
  const now = new Date();
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return;
  let last = null; try { last = localStorage.getItem('susuru_anki_last_study'); } catch (e) {}
  const reminded = typeof notifyKvGet === 'function' ? await notifyKvGet('lastRemindDate') : null;
  if (last === today || reminded === today) return;
  if (typeof notifyKvSet === 'function') notifyKvSet('lastRemindDate', today);
  const weak = weakCardCount();
  showLocalNotification('📚 今日の学習がまだです', weak ? `苦手なカードが ${weak} 枚あります。1問だけでも解いてみませんか？` : '1問だけでも解いてみませんか？', 'reminder');
}, 60 * 1000);

// ---------------- 設定画面 ----------------
function onNotifyPrefChange() {
  const p = getNotifyPrefs();
  const r = document.getElementById('chkNotifyReminder'), t = document.getElementById('txtNotifyTime'), u = document.getElementById('chkNotifyUpdates');
  if (r) p.reminder = r.checked;
  if (t && /^\d{1,2}:\d{2}$/.test(t.value)) p.time = t.value;
  if (u) p.updates = u.checked;
  const f = document.getElementById('chkNotifyFriends'); if (f) p.friends = f.checked;
  const tn = document.getElementById('chkNotifyTaunt'); if (tn) p.taunt = tn.checked;
  saveNotifyPrefs(p);
  if ((p.reminder || p.updates || p.friends) && typeof Notification !== 'undefined' && Notification.permission === 'default') enableNotifications();
  renderNotifySettings();
}

function renderNotifySettings() {
  const box = document.getElementById('notifySettings');
  if (!box) return;
  const p = getNotifyPrefs();
  const hasNotif = typeof Notification !== 'undefined';
  const perm = hasNotif ? Notification.permission : 'unsupported';
  const standalone = isStandaloneApp();
  let installHTML;
  if (standalone) installHTML = '<div class="hint-small">✅ アプリとして使っています</div>';
  else if (_deferredInstall) installHTML = '<button class="btn btn-accent" onclick="installApp()">📲 アプリとしてインストール（ホーム画面に追加）</button>';
  else if (isIOSDevice()) installHTML = '<div class="hint-small">📲 アプリにするには：Safari の共有ボタン（□に↑）→「ホーム画面に追加」</div>';
  else installHTML = '<button class="btn btn-secondary" onclick="installApp()">📲 アプリとしてインストールする方法</button>';
  const apkHTML = ''; // ★【0.03.25】APK のボタンは、設定画面にいつも出す（index.html）
  let permHTML;
  if (perm === 'granted') permHTML = '<div class="hint-small" style="color:var(--success);">✅ 通知は許可されています</div>';
  else if (perm === 'denied') permHTML = '<div class="hint-small" style="color:var(--danger);">🚫 通知がブロックされています。ブラウザ（端末）の設定で、このサイトの通知を許可してください。</div>';
  else if (perm === 'unsupported') permHTML = `<div class="hint-small">${isIOSDevice() && !standalone ? 'iPhone・iPad では、ホーム画面に追加したアプリから開くと通知をオンにできます（iOS 16.4 以降）。' : 'このブラウザは通知に対応していません。'}</div>`;
  else permHTML = '<button class="btn" onclick="enableNotifications()">🔔 通知をオンにする</button>';
  let how;
  if (_pushState.token && _pushState.serverAlive) how = '📡 プッシュ通知：有効（アプリを閉じていても届きます）';
  else if (_pushState.token) how = '📡 プッシュ通知：この端末は登録済み（送信側がまだ動いていないため、アプリを開いている間とバックグラウンド確認で知らせます）';
  else if (perm === 'granted' && !currentUser) how = '📡 プッシュ通知：ログインすると、アプリを閉じていても届くようになります';
  else if (_pushState.error) how = '📡 ' + _pushState.error;
  else how = '';
  const bg = _periodicOk ? '🔄 バックグラウンド確認：有効' : (perm === 'granted' ? '🔄 バックグラウンド確認：この端末では使えません（ホーム画面に追加した Android の Chrome などで使えます）' : '');
  box.innerHTML = `
    ${installHTML}${apkHTML}
    <div style="margin-top:12px;">${permHTML}</div>
    <label class="toggle-pill" style="margin-top:10px; display:flex; align-items:center; gap:8px;"><input type="checkbox" id="chkNotifyReminder" ${p.reminder ? 'checked' : ''} onchange="onNotifyPrefChange()">📚 学習の催促（その日まだ解いていなければ）</label>
    <div class="form-row" style="margin-top:6px; align-items:center;">
      <span class="hint-small" style="white-space:nowrap;">⏰ 時刻</span>
      <input type="time" id="txtNotifyTime" class="form-control" value="${p.time}" onchange="onNotifyPrefChange()" style="max-width:140px;">
    </div>
    <label class="toggle-pill" style="margin-top:8px; display:flex; align-items:center; gap:8px;"><input type="checkbox" id="chkNotifyUpdates" ${p.updates ? 'checked' : ''} onchange="onNotifyPrefChange()">🆕 アップデートのお知らせ</label>
    <label class="toggle-pill" style="margin-top:8px; display:flex; align-items:center; gap:8px;"><input type="checkbox" id="chkNotifyFriends" ${p.friends ? 'checked' : ''} onchange="onNotifyPrefChange()">🤝 フレンド申請・承認のお知らせ</label>
    <label class="toggle-pill" style="margin-top:8px; display:flex; align-items:center; gap:8px;"><input type="checkbox" id="chkNotifyTaunt" ${p.taunt ? 'checked' : ''} onchange="onNotifyPrefChange()">🔥 フレンドの頑張りのお知らせ（フレンドのほうが進んでいたら、通知の時刻から4時間ごとに夜まであおります）</label>
    <div class="hint-small" style="margin-top:8px; line-height:1.6;">${[how, bg].filter(Boolean).join('<br>')}</div>
    ${perm === 'granted' ? '<button class="btn btn-secondary" style="margin-top:8px;" onclick="sendTestNotification()">🔔 テスト通知を送る</button>' : ''}
  `;
}

// ================================================================
// ★【0.03.31】アップデートの確認（アプリを開いている間）
// 新しいバージョンが公開されたら、画面の上に「再読み込みしますか？」を出す。
// アプリを裏に回しているときは通知でも知らせる（同じバージョンは1回だけ）
// ================================================================
const UPDATE_CHECK_MS = 3 * 60 * 1000;
let _updateFound = null, _updateDismissed = null, _updateTimer = null;
function versionNewer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return x > y; }
  return false;
}
async function checkForAppUpdate() {
  if (typeof APP_VERSION === 'undefined' || navigator.onLine === false) return;
  try {
    const txt = await (await fetch('./version-info.js?t=' + Date.now(), { cache: 'no-store' })).text();
    const v = (txt.match(/APP_VERSION\s*=\s*["']([^"']+)["']/) || [])[1];
    if (!v || !versionNewer(v, APP_VERSION)) return;
    if (_updateFound && _updateFound.version === v) { showUpdateBar(); return; }
    let title = '';
    try { const rn = await (await fetch('./release-notes.js?t=' + Date.now(), { cache: 'no-store' })).text(); const m = rn.match(new RegExp(`version:\\s*'${v.replace(/\./g, '\\.')}'[\\s\\S]*?title:\\s*'([^']*)'`)); if (m) title = m[1]; } catch (e) {}
    _updateFound = { version: v, title };
    showUpdateBar();
    // 裏にいるときは通知でも（プッシュ通知・バックグラウンド確認と同じバージョンを二重に出さない）
    const notified = typeof notifyKvGet === 'function' ? await notifyKvGet('notifiedVersion') : null;
    if (notified !== v && document.visibilityState !== 'visible' && getNotifyPrefs().updates && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      if (typeof notifyKvSet === 'function') notifyKvSet('notifiedVersion', v);
      showLocalNotification(`🆕 すするanki v${v} が出ました`, (title ? title + '。' : '') + '開いて「再読み込み」すると新しいバージョンになります', 'update');
    }
  } catch (e) { /* オフラインなど */ }
}
function showUpdateBar() {
  if (!_updateFound || _updateDismissed === _updateFound.version) return;
  let bar = document.getElementById('updateBar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'updateBar'; bar.className = 'update-bar'; document.body.appendChild(bar); }
  const busy = document.body.classList.contains('in-quiz') || (typeof _drillActive !== 'undefined' && _drillActive);
  bar.innerHTML = `<div style="flex:1; min-width:0;"><b>🆕 新しいバージョン v${escapeHtml(_updateFound.version)} があります</b>
      <div class="hint-small">${_updateFound.title ? escapeHtml(_updateFound.title) + '。' : ''}再読み込みすると新しくなります${busy ? '（クイズ中の問題は最初からになります。暗記テストの途中経過は保存されます）' : ''}</div></div>
    <div style="display:flex; gap:6px; flex-shrink:0;"><button class="btn btn-primary" style="width:auto; padding:6px 12px;" onclick="applyAppUpdate()">🔄 再読み込み</button><button class="btn btn-secondary" style="width:auto; padding:6px 10px;" onclick="dismissUpdateBar()">あとで</button></div>`;
  bar.style.display = 'flex';
}
function dismissUpdateBar() { if (_updateFound) _updateDismissed = _updateFound.version; const bar = document.getElementById('updateBar'); if (bar) bar.style.display = 'none'; }
async function applyAppUpdate() {
  try { if (typeof drillSave === 'function' && typeof _drillActive !== 'undefined' && _drillActive) drillSave(); } catch (e) {}
  try { if (typeof flushPendingSaves === 'function') flushPendingSaves(); } catch (e) {}
  const bar = document.getElementById('updateBar'); if (bar) bar.innerHTML = '<div style="flex:1;"><b>🔄 新しいバージョンを読み込んでいます…</b></div>';
  // ★【0.03.60】新しいサービスワーカーに切り替わるのを待ってから読み込み直す（途中で読み込み直すと、古いファイルと新しいファイルが混ざることがあった）
  let reloaded = false;
  // アップデートで読み込み直したときは、週間プランの課題を自動で開かない（いた画面に戻る）
  try { localStorage.setItem('susuru_anki_plan_autoopen', String(Date.now())); } catch (e) {}
  const go = () => { if (reloaded) return; reloaded = true; if (document.body) document.body.classList.remove('in-quiz'); location.reload(); };
  try {
    if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('controllerchange', go, { once: true });
    if (_swReg) {
      await _swReg.update();
      const w = _swReg.installing || _swReg.waiting;
      if (w) { w.addEventListener('statechange', () => { if (w.state === 'activated') setTimeout(go, 200); }); setTimeout(go, 5000); return; }
    }
  } catch (e) {}
  setTimeout(go, 300);
}
function startUpdateWatch() {
  clearInterval(_updateTimer);
  _updateTimer = setInterval(checkForAppUpdate, UPDATE_CHECK_MS);
  setTimeout(checkForAppUpdate, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { checkForAppUpdate(); showUpdateBar(); } });
  window.addEventListener('online', checkForAppUpdate);
}
startUpdateWatch();
