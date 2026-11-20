// ================================================================
// ★【0.04.03】Android アプリ（WebView 版）とのつなぎ
// アプリの中では window.SusuruApp（MainActivity.java の Bridge）が使える。ブラウザ・ホーム画面アプリでは何もしない。
//  ・Google ログイン：WebView の中では Google がログインを許さないので、アプリ側でログインして ID トークンをもらう
//  ・ファイルの保存（エクスポート）：アプリの「ダウンロード」に保存する
//  ・戻るボタン：メニュー・ダイアログを閉じる → 前の画面 → （何も無ければアプリを裏に回す）
// ================================================================
function isAndroidApp() { return typeof window.SusuruApp !== 'undefined' && !!window.SusuruApp; }

// ログイン（auth.js の firebaseLogin から呼ぶ）。アプリの中なら true を返し、結果は __susuruNativeLogin で受け取る
function appGoogleLogin() {
  if (!isAndroidApp()) return false;
  try { window.SusuruApp.signInWithGoogle(); return true; } catch (e) { return false; }
}
window.__susuruNativeLogin = function (token, err) {
  if (!token) {
    const p = String(err || '').split('|'), kind = p[0], detail = p.slice(1).filter(Boolean).join(' / ');
    let sha = ''; try { sha = window.SusuruApp.signatureSha1 ? window.SusuruApp.signatureSha1() : ''; } catch (e) {}
    // アカウントを選んだのにログインできないとき：多くは Firebase に Android アプリ（パッケージ名と SHA-1）が登録されていない
    alert(`⚠️ Google ログインができませんでした${kind === 'cancel' ? '（ログインの画面が閉じられました）' : ''}\n\n` +
      `アカウントを選んだのにこうなるときは、Firebase のコンソールの「プロジェクトの設定」→「マイアプリ」に、Android アプリ（パッケージ名 io.github.susuruchachi.susuruanki）と、このアプリの SHA-1 が登録されているか確かめてください。\n` +
      (sha ? `\nこのアプリの SHA-1：\n${sha}\n` : '') + (detail ? `\nくわしい内容：${detail}` : ''));
    return;
  }
  if (typeof showAppToast === 'function') showAppToast('🔐 ログインしています…');
  const cred = firebase.auth.GoogleAuthProvider.credential(token);
  auth.signInWithCredential(cred).then(() => { if (typeof showAppToast === 'function') showAppToast('✅ ログインしました'); })
    .catch(e => alert('⚠️ ログインエラー（Firebase）: ' + (e.code || '') + '\n' + e.message));
};
function appGoogleLogout() { if (isAndroidApp()) { try { window.SusuruApp.signOutGoogle(); } catch (e) {} } }

// ファイルを保存する（ブラウザではダウンロード、アプリでは「ダウンロード」フォルダーに）
function saveBlobFile(blob, name) {
  if (isAndroidApp() && window.SusuruApp.saveFile) {
    const r = new FileReader();
    r.onload = () => { const b64 = String(r.result).split(',')[1] || ''; try { window.SusuruApp.saveFile(name, blob.type || 'application/octet-stream', b64); } catch (e) { alert('⚠️ 保存できませんでした'); } };
    r.readAsDataURL(blob);
    return;
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

// 戻るボタン（アプリが呼ぶ）。何か閉じた・戻ったら true
window.susuruAppBack = function () {
  const sm = document.getElementById('sideMenu');
  if (sm && sm.classList.contains('open')) { closeMenu(); return true; }
  // 開いているダイアログ（いちばん上のもの）を閉じる
  const ov = [...document.querySelectorAll('[id$="Overlay"], .ctx-overlay')].filter(el => el.id !== 'menuOverlay' && getComputedStyle(el).display !== 'none');
  if (ov.length) {
    const el = ov[ov.length - 1], close = el.querySelector('[onclick*="close" i]');
    if (close) close.click(); else el.style.display = 'none';
    return true;
  }
  if (typeof pageHistory !== 'undefined' && pageHistory.length) { history.back(); return true; }
  const act = document.querySelector('.screen.active');
  if (act && act.id !== 'pgHome') { openPage('pgHome'); return true; }
  return false;
};

// ★ 新しい APK があれば知らせる（アプリの中で、1日1回まで）。押すとダウンロードして上書きインストールの画面へ
function appVersionCode(v) { const p = String(v || '').split('.').map(Number); return (p[0] || 0) * 1000000 + (p[1] || 0) * 1000 + (p[2] || 0); }
function appApkUpdateAvailable() {
  if (!isAndroidApp() || typeof ANDROID_APK_VERSION === 'undefined') return false;
  try { return Number(window.SusuruApp.versionCode()) < appVersionCode(appApkLatest()); } catch (e) { return false; }
}
// ★【0.04.38】公開されている最新の APK の版（開いたあとに出た新しい版も、version-info.js を読み直して知る）
let _apkLatest = null;
function appApkLatest() { return _apkLatest && appVersionCode(_apkLatest) > appVersionCode(ANDROID_APK_VERSION) ? _apkLatest : ANDROID_APK_VERSION; }
function appApkUrl() { return new URL('apk/susuruanki.apk?v=' + appApkLatest(), location.href).href; }
// ★【0.04.24】新しいアプリ（0.04.24 から）は、自分で自分を入れ直す（PackageInstaller）。一度この仕組みで入れると、次からは確認なしで、
//  アプリを閉じたとき（裏に回して1分・プレイ中でない）に入れ替わる。古いアプリは今まで通り（インストールの画面へ）
function appApkNew() { return isAndroidApp() && !!window.SusuruApp.apkPrepare; }
let _apkInstallAfter = false;
function appInstallApk() {
  try {
    if (appApkNew()) {
      if (window.SusuruApp.apkReady()) window.SusuruApp.apkInstallNow();
      else { _apkInstallAfter = true; if (typeof showAppToast === 'function') showAppToast('📲 新しいアプリをダウンロードしています…'); window.SusuruApp.apkPrepare(appApkUrl(), appVersionCode(appApkLatest())); }
      return;
    }
    window.SusuruApp.installApk(appApkUrl());
  } catch (e) { alert('⚠️ ダウンロードできませんでした'); }
}
// ダウンロードが終わった（アプリから呼ばれる）
window.__susuruApkReady = function (ok, silent) {
  if (!ok) { if (_apkInstallAfter) alert('⚠️ 新しいアプリをダウンロードできませんでした。通信のよいところで、もう一度試してください。'); _apkInstallAfter = false; return; }
  if (_apkInstallAfter) { _apkInstallAfter = false; window.SusuruApp.apkInstallNow(); return; }
  const k = 'susuru_anki_apk_notice', today = new Date().toDateString();
  if (silent) {
    // 確認なしで入れられる：閉じたときに入れ替わることだけ知らせる（版ごとに1回）
    try { if (localStorage.getItem(k + '_auto') === appApkLatest()) return; localStorage.setItem(k + '_auto', appApkLatest()); } catch (e) {}
    if (typeof showAppToast === 'function') showAppToast(`📲 新しいアプリ（${appApkLatest()}）を用意しました。アプリを閉じると、自動で入れ替わります`);
    return;
  }
  try { if (!_apkForce && localStorage.getItem(k) === today) return; localStorage.setItem(k, today); } catch (e) {}
  if (confirm(`📲 新しい Android アプリ（${appApkLatest()}）があります（学習データはそのまま）。\n今回だけ確認が出ます。次からは、アプリを閉じたときに自動で更新されます。\n更新しますか？`)) window.SusuruApp.apkInstallNow();
};
let _apkForce = false;
function appCheckApkUpdate(force) {
  if (!appApkUpdateAvailable()) return;
  if (appApkNew()) { _apkForce = !!force; try { window.SusuruApp.apkPrepare(appApkUrl(), appVersionCode(appApkLatest())); } catch (e) {} return; }
  const k = 'susuru_anki_apk_notice', today = new Date().toDateString();
  try { if (!force && localStorage.getItem(k) === today) return; localStorage.setItem(k, today); } catch (e) {}
  if (confirm(`📲 新しい Android アプリ（${appApkLatest()}）があります。\n今のアプリに上書きで入れます（学習データはそのまま）。更新しますか？`)) appInstallApk();
}
window.addEventListener('load', () => setTimeout(() => appCheckApkUpdate(false), 4000));
// プレイ中か（裏に回ったときに入れ替えてよいか）をアプリに伝えておく
function appReportIdle() { try { if (appApkNew() && window.SusuruApp.apkSetIdle) window.SusuruApp.apkSetIdle(typeof appIdleForUpdate === 'function' ? appIdleForUpdate(true) : false); } catch (e) {} }
if (typeof window !== 'undefined') {
  setInterval(appReportIdle, 5000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') appReportIdle(); });
}
// 更新されたら一度だけ知らせる
window.addEventListener('load', () => setTimeout(() => {
  if (!isAndroidApp()) return;
  try {
    const v = Number(window.SusuruApp.versionCode()), k = 'susuru_anki_apk_last', last = Number(localStorage.getItem(k) || 0);
    if (last && v > last && typeof showAppToast === 'function') showAppToast(`✅ アプリを新しくしました（${Math.floor(v / 1000) % 1000 ? '0.' + String(Math.floor(v / 1000) % 1000).padStart(2, '0') + '.' + String(v % 1000).padStart(2, '0') : v}）`);
    localStorage.setItem(k, String(v));
  } catch (e) {}
}, 2500));

// ================================================================
// ★【0.04.13】読み上げ：Android アプリ（WebView）はブラウザの読み上げ（speechSynthesis）が動かないので、
//  アプリ側の Android の読み上げ（TextToSpeech）につなぐ。speechSynthesis・SpeechSynthesisUtterance と同じ形で使えるようにするので、
//  クイズ・暗記テスト・聞き流し・AI の声が使えないときのいつもの読み上げは、そのまま動く
// ================================================================
(function () {
  if (!isAndroidApp() || !window.SusuruApp.ttsSpeak) return;
  const voices = [
    { name: 'Android 日本語', lang: 'ja-JP', localService: true, default: true, voiceURI: 'android-ja' },
    { name: 'Android English', lang: 'en-US', localService: true, default: false, voiceURI: 'android-en' }
  ];
  function Utterance(text) { this.text = String(text == null ? '' : text); this.lang = ''; this.rate = 1; this.pitch = 1; this.volume = 1; this.voice = null; this.onend = null; this.onerror = null; this.onstart = null; }
  Utterance.prototype.addEventListener = function (t, f) { this['on' + t] = f; };
  let queue = [], cur = null, seq = 0;
  const fire = (u, t) => { try { if (u && typeof u['on' + t] === 'function') u['on' + t]({ type: t, utterance: u }); } catch (e) {} };
  function next() {
    if (cur || !queue.length) return;
    cur = queue.shift(); cur._id = 'u' + (++seq);
    const lang = cur.lang || (cur.voice && cur.voice.lang) || 'ja-JP';
    let ok = false; try { ok = window.SusuruApp.ttsSpeak(cur._id, cur.text, lang, Number(cur.rate) || 1); } catch (e) {}
    if (!ok) { const u = cur; cur = null; fire(u, 'error'); next(); return; }
    fire(cur, 'start');
  }
  window.__susuruTtsDone = function (id) {
    if (!cur || cur._id !== id) return; // 止めたもの・前のものは無視
    const u = cur; cur = null; fire(u, 'end'); next();
  };
  const synth = {
    get speaking() { return !!cur; }, get pending() { return queue.length > 0; }, paused: false, onvoiceschanged: null,
    speak(u) { if (!u || !u.text) { fire(u, 'end'); return; } queue.push(u); next(); },
    cancel() { const q = queue; queue = []; const u = cur; cur = null; try { window.SusuruApp.ttsStop(); } catch (e) {} if (u) fire(u, 'end'); q.forEach(x => fire(x, 'end')); },
    pause() {}, resume() {}, getVoices() { return voices.slice(); },
    addEventListener(t, f) { if (t === 'voiceschanged') this.onvoiceschanged = f; }, removeEventListener() {}
  };
  try { Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true, writable: true }); } catch (e) { window.speechSynthesis = synth; }
  window.SpeechSynthesisUtterance = Utterance;
})();

// ================================================================
// ★【0.04.18】Android のホーム画面のウィジェットに、連続記録・今日の数・週間プランの次の課題を渡す
//  （アプリを開いたとき・1問解いたとき・プランが変わったとき。日付が変わったときの表示はウィジェット側で計算する）
// ================================================================
let _widgetTimer = null;
function appWidgetSync(now) {
  if (!isAndroidApp() || !window.SusuruApp.setWidgetData) return;
  clearTimeout(_widgetTimer);
  _widgetTimer = setTimeout(() => {
    try {
      const s = typeof getStreakInfo === 'function' ? getStreakInfo() : { cur: 0, best: 0, todayCount: 0 };
      const days = Object.keys(studyDays || {}).filter(k => studyDayCount(studyDays[k]) > 0).sort();
      const data = { streak: s.cur, best: s.best, today: s.todayCount, todayDate: getTodayStr(), last: days.length ? days[days.length - 1] : '', at: Date.now() };
      if (typeof planList === 'function' && planList().length) {
        const t = typeof planUrgentTask === 'function' ? planUrgentTask() : null;
        if (t) {
          const name = t.title.split('：').slice(1).join('：') || t.title;
          const text = t.key === 'words' ? (t.overdue ? `⏰ ${name}：単語の期限を過ぎています` : `🧠 ${name}：今週の単語`) : t.key === 'chants' ? `🎵 ${name}：チャンツ` : t.key === 'examples' ? `📖 ${name}：例文` : `🔁 ${name}：先週の復習`;
          data.plan = { text, deadline: t.deadline && !t.overdue ? +t.deadline : 0, url: t.planId ? `${location.origin}${location.pathname}?plantask=${encodeURIComponent(t.planId + ':' + t.key)}` : '' };
        } else data.plan = {};
        const n = typeof planTodayRemaining === 'function' ? planTodayRemaining() : 0;
        if (n > 1) data.foot = `すするanki ・ 残りの課題 ${n}つ`;
      }
      data.board = widgetBoardMine();
      try { if (typeof calWidgetData === 'function') data.cal = calWidgetData(); } catch (e) {} // ★【0.04.25】カレンダーのウィジェット
      try { if (typeof calStarWidgetData === 'function') data.stars = calStarWidgetData(); } catch (e) {} // ★【0.04.43】大事な予定のウィジェット
      if (_widgetFriends) data.board.rank = widgetRank(_widgetFriends.list), data.board.rankAt = _widgetFriends.at;
      window.SusuruApp.setWidgetData(JSON.stringify(data));
      // フレンドの成績は10分に1回だけ読み直す（読み終わったら、もう一度ウィジェットに送る）
      if (!_widgetFriendsBusy && typeof currentUser !== 'undefined' && currentUser && (!_widgetFriends || Date.now() - _widgetFriends.at > 600000)) {
        _widgetFriendsBusy = true;
        widgetLoadFriends().then(list => { _widgetFriends = { list, at: Date.now() }; appWidgetSync(true); }).catch(() => {}).finally(() => { _widgetFriendsBusy = false; });
      }
    } catch (e) {}
  }, now ? 0 : 1500);
}
// ★【0.04.19】大きいウィジェット：フレンドとの今週のランキング・自分の進み具合
let _widgetFriends = null, _widgetFriendsBusy = false;
async function widgetLoadFriends() {
  const friends = typeof myFriendList === 'function' ? await myFriendList() : [];
  if (!friends.length) return [];
  const docs = (await firestore.collection('susuru_anki_category_scores').where('mode', '==', 'summary').get()).docs.map(d => d.data());
  return docs.filter(d => friends.includes(d.uid)).map(d => ({ name: d.name || 'フレンド', week: d.week || 0, today: d.today || 0, streak: d.streak || 0, date: d.date || '' }));
}
function widgetRank(list) {
  const today = getTodayStr(), mon = streakShift(today, -((new Date(today + 'T12:00:00').getDay() + 6) % 7));
  // 前の日・前の週のまとめは、今日・今週を0にして比べる（成績の画面と同じ）
  const rows = (list || []).map(d => ({ n: d.name, w: d.date >= mon ? d.week : 0, t: d.date === today ? d.today : 0, s: d.date >= streakShift(today, -1) ? d.streak : 0 }));
  const me = typeof statsSummary === 'function' ? statsSummary() : { week: 0, today: 0, streak: 0 };
  rows.push({ n: 'あなた', w: me.week, t: me.today, s: me.streak, me: true });
  rows.sort((a, b) => b.w - a.w || b.t - a.t || (b.me ? 1 : 0) - (a.me ? 1 : 0));
  rows.forEach((r, i) => { r.r = i + 1; });
  const mine = rows.find(r => r.me), top = rows.slice(0, 5);
  if (!top.includes(mine)) top[4] = mine;
  return top;
}
function widgetBoardMine() {
  const b = {};
  try { const m = typeof statsSummary === 'function' ? statsSummary() : null; if (m) b.week = m.week; } catch (e) {}
  try {
    if (typeof planTasks === 'function' && typeof planList === 'function' && planList().length) {
      const icon = { words: '🧠単語', chants: '🎵チャンツ', examples: '📖例文' };
      b.tasks = planTasks().filter(t => !t.optional).map(t => ({ t: icon[t.key] || '🔁先週', done: !!t.done, wait: !!(t.upcoming || t.locked), p: Math.round((t.progress || 0) * 100) }));
    }
  } catch (e) {}
  try {
    const d = JSON.parse(localStorage.getItem('susuru_widget_drill') || 'null');
    if (d && typeof drillProgText === 'function') b.drill = `📝 ${d.cat}：${drillProgText(d)}`;
  } catch (e) {}
  return b;
}
window.addEventListener('load', () => setTimeout(() => appWidgetSync(true), 3000));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') appWidgetSync(true); });

// ================================================================
// ★【0.04.38】設定の「📲 アプリ・通知」：アプリの中では「🔄 新しいバージョンを確認」（新しい APK があれば、その場で更新）
//  新しい APK があるときは、設定（下のメニュー）と「📲 アプリ・通知」に印を出す
// ================================================================
function appVersionText(code) { const c = Number(code) || 0; return `${Math.floor(c / 1000000)}.${String(Math.floor(c / 1000) % 1000).padStart(2, '0')}.${String(c % 1000).padStart(2, '0')}`; }
async function appApkFetchLatest() {
  try {
    const txt = await (await fetch('./version-info.js?t=' + Date.now(), { cache: 'no-store' })).text();
    const v = (txt.match(/ANDROID_APK_VERSION\s*=\s*["']([^"']+)["']/) || [])[1];
    if (v) _apkLatest = v;
  } catch (e) {}
  appApkRender();
}
function appApkBadgeCount() { return isAndroidApp() && appApkUpdateAvailable() ? 1 : 0; }
function appApkRender() {
  const btn = document.getElementById('apkDlBtn'), hint = document.getElementById('apkDlHint');
  if (btn && isAndroidApp()) {
    const avail = appApkUpdateAvailable(); let cur = ''; try { cur = appVersionText(window.SusuruApp.versionCode()); } catch (e) {}
    btn.removeAttribute('download'); btn.setAttribute('href', '#');
    btn.innerHTML = avail ? `📲 新しいアプリ（${escapeHtml(appApkLatest())}）に更新する <span class="friend-req-badge app-upd-badge" style="display:inline-flex;">1</span>` : `🔄 アプリの新しいバージョンを確認${cur ? `（今：${escapeHtml(cur)}）` : ''}`;
    btn.classList.toggle('btn-accent', avail);
    if (hint) hint.textContent = avail ? '押すと、新しいアプリをダウンロードして入れ替えます（学習データはそのまま）。ふだんは自動で更新されますが、うまくいかないときはここから更新できます。' : '新しいアプリがあれば、ふだんは自動で更新されます。うまくいかないときは、ここで確認・更新できます。';
  }
  document.querySelectorAll('.app-upd-badge').forEach(b => { if (b.closest('#apkDlBtn')) return; b.textContent = '1'; b.style.display = appApkBadgeCount() ? 'inline-flex' : 'none'; });
  if (typeof renderFriendRequests === 'function') { try { renderFriendRequests(); } catch (e) {} }
}
async function appApkCheckNow(ev) {
  if (ev) ev.preventDefault();
  if (!isAndroidApp()) return;
  const btn = document.getElementById('apkDlBtn'); if (btn) btn.textContent = '⏳ 確認しています…';
  await appApkFetchLatest();
  if (appApkUpdateAvailable()) { _apkForce = true; appInstallApk(); return; }
  let cur = ''; try { cur = appVersionText(window.SusuruApp.versionCode()); } catch (e) {}
  alert(`✅ 最新のアプリです${cur ? `（${cur}）` : ''}。`);
}
window.addEventListener('load', () => setTimeout(appApkFetchLatest, 3000));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && isAndroidApp()) appApkFetchLatest(); });

// ================================================================
// ★【0.04.44】⏰ アラーム（Android アプリだけ）
//  ・🔥 連続記録：決めた時刻（夜8時など）になっても今日まだ解いていなければ、アラームの音で鳴らす。解くまでスヌーズで何度も鳴る（日付が変わるまで）
//  ・📅 予定：カレンダーの予定ごとに「⏰ アラーム」（何分前）を選ぶと、その時刻に鳴らす（この端末だけの設定）
//  鳴らすのはアプリ（Alarms.java）。ここは設定と、これから14日の予定のアラームの時刻を渡すだけ。今日解いたかはウィジェットのデータで見ている
// ================================================================
const ALARM_KEY = 'susuru_anki_alarm', CAL_ALARM_KEY = 'susuru_anki_cal_alarms';
const CAL_ALARM_OPTS = [[0, '時刻ちょうど'], [5, '5分前'], [10, '10分前'], [15, '15分前'], [30, '30分前'], [60, '1時間前'], [120, '2時間前'], [1440, '1日前']];
function appAlarmOk() { return isAndroidApp() && !!window.SusuruApp.setAlarms; }
function alarmPrefs() {
  let p = {}; try { p = JSON.parse(localStorage.getItem(ALARM_KEY) || '{}') || {}; } catch (e) {}
  return { on: !!p.on, time: /^\d{1,2}:\d{2}$/.test(p.time || '') ? p.time : '20:00', snooze: [5, 10, 15, 20, 30].includes(Number(p.snooze)) ? Number(p.snooze) : 10 };
}
function calAlarms() { try { return JSON.parse(localStorage.getItem(CAL_ALARM_KEY) || '{}') || {}; } catch (e) { return {}; } }
function calAlarmOf(id, gid) { const v = calAlarms()[`${gid || ''}~${id}`]; return v === undefined || v === null || v === '' ? null : Number(v); }
function calAlarmSet(id, gid, min) {
  const m = calAlarms(), k = `${gid || ''}~${id}`;
  if (min === null || min === undefined || min === '' || isNaN(Number(min))) delete m[k]; else m[k] = Number(min);
  try { localStorage.setItem(CAL_ALARM_KEY, JSON.stringify(m)); } catch (e) {}
}
// これから14日の、アラームを入れた予定の鳴らす時刻
function calAlarmList() {
  const m = calAlarms(); if (!Object.keys(m).length || typeof calAllEvents !== 'function') return [];
  const all = calAllEvents().filter(e => m[`${e.gid || ''}~${e.id}`] !== undefined), today = calToday(), now = Date.now(), out = [];
  for (let i = 0; i <= 15 && out.length < 60; i++) {
    const ds = calAddDays(today, i);
    all.forEach(e => {
      if (!calOccursOn(e, ds)) return;
      if (calSpan(e) > 0 && calInstanceStart(e, ds) !== ds) return; // 何日か続く予定は、はじめの日だけ
      const min = Number(m[`${e.gid || ''}~${e.id}`]) || 0;
      const [h, mi] = (e.start || '07:00').split(':').map(Number), d = planParseDate(ds);
      d.setHours(h, mi, 0, 0);
      const at = d.getTime() - min * 60000;
      if (at <= now) return;
      const t = calType(e), when = e.start ? (min ? `${CAL_ALARM_OPTS.find(o => o[0] === min) ? CAL_ALARM_OPTS.find(o => o[0] === min)[1] : min + '分前'}` : 'もうすぐ') : (min >= 1440 ? '明日' : '今日');
      out.push({ k: `${e.gid || ''}~${e.id}~${ds}`, at, title: `${t.icon} ${String(e.title).slice(0, 40)}（${when}）`, body: `${calMD(ds)} ${calTimeText(e)}${e.place ? '・' + e.place : ''}${e.note ? '\n' + String(e.note).slice(0, 80) : ''}`, url: './?page=pgCalendar' });
    });
  }
  return out.sort((a, b) => a.at - b.at).slice(0, 60);
}
let _alarmTimer = null;
function appAlarmSync(now) {
  if (!appAlarmOk()) return;
  clearTimeout(_alarmTimer);
  _alarmTimer = setTimeout(() => {
    try {
      const p = alarmPrefs(), [h, m] = p.time.split(':').map(Number);
      window.SusuruApp.setAlarms(JSON.stringify({ streak: { on: p.on, h, m, snooze: p.snooze }, events: calAlarmList() }));
    } catch (e) {}
  }, now ? 0 : 1500);
}
window.addEventListener('load', () => setTimeout(() => appAlarmSync(true), 4000));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') appAlarmSync(true); });
function alarmStatus() { try { return JSON.parse(window.SusuruApp.alarmStatus() || '{}'); } catch (e) { return {}; } }
function alarmSettingsHTML() {
  if (!isAndroidApp()) return '';
  if (!appAlarmOk()) return `<div class="setting-box-title" style="margin-top:16px;">⏰ アラーム</div><div class="hint-small">連続記録が途切れそうなときや、予定の前にアラームの音で鳴らせます。アプリを新しくすると使えます。</div>${typeof appInstallApk === 'function' ? '<button class="btn btn-secondary" style="margin-top:6px;" onclick="appInstallApk()">📲 アプリを更新する</button>' : ''}`;
  const p = alarmPrefs(), st = alarmStatus(), warn = [];
  if (st.notif === false) warn.push(`<div class="hint-small" style="color:var(--danger);">🚫 通知がオフなので鳴りません</div><button class="btn btn-secondary" style="margin-top:4px;" onclick="window.SusuruApp.openAlarmSettings('notif')">🔔 通知を許可する</button>`);
  if (st.channel === false) warn.push(`<div class="hint-small" style="color:var(--danger);">🚫「すするanki のアラーム」の通知がオフになっています</div><button class="btn btn-secondary" style="margin-top:4px;" onclick="window.SusuruApp.openAlarmSettings('channel')">🔔 アラームの通知をオンにする</button>`);
  if (st.exact === false) warn.push(`<div class="hint-small" style="color:var(--warning, #e0a020);">⚠️ 「アラームとリマインダー」が許可されていないので、少し遅れて鳴ることがあります</div><button class="btn btn-secondary" style="margin-top:4px;" onclick="window.SusuruApp.openAlarmSettings('exact')">⏰ 許可する</button>`);
  if (st.fullScreen === false) warn.push(`<div class="hint-small" style="color:var(--warning, #e0a020);">⚠️ 「全画面通知」が許可されていないので、画面が消えているときに大きく出ません（音は鳴ります）</div><button class="btn btn-secondary" style="margin-top:4px;" onclick="window.SusuruApp.openAlarmSettings('fullscreen')">📱 許可する</button>`);
  const next = st.next && p.on ? new Date(st.next) : null;
  const nextTxt = next ? `次は ${next.getMonth() + 1}/${next.getDate()} ${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}${st.snoozeAt && st.snoozeAt === st.next ? '（スヌーズ中）' : ''}（今日すでに解いていれば鳴りません）` : '';
  const evN = Object.keys(calAlarms()).length;
  return `<div class="setting-box-title" style="margin-top:16px;">⏰ アラーム（この端末）</div>
    <label class="toggle-pill" style="margin-top:6px; display:flex; align-items:center; gap:8px;"><input type="checkbox" id="chkAlarmStreak" ${p.on ? 'checked' : ''} onchange="onAlarmPrefChange()">🔥 連続記録アラーム（今日まだ解いていなければ、アラームの音で鳴らす）</label>
    <div class="form-row" style="margin-top:6px; align-items:center;">
      <span class="hint-small" style="white-space:nowrap;">⏰ 時刻</span>
      <input type="time" id="txtAlarmTime" class="form-control" value="${p.time}" onchange="onAlarmPrefChange()" style="max-width:160px;">
    </div>
    <div class="form-row" style="margin-top:6px; align-items:center;">
      <span class="hint-small" style="white-space:nowrap;">💤 スヌーズ</span>
      <select id="selAlarmSnooze" class="form-control" onchange="onAlarmPrefChange()" style="max-width:160px;">${[5, 10, 15, 20, 30].map(v => `<option value="${v}" ${p.snooze === v ? 'selected' : ''}>${v}分ごと</option>`).join('')}</select>
    </div>
    <div class="hint-small">今日1問も解いていないと、この時刻から解くまで、スヌーズの間隔で何度も鳴ります（止めても、また鳴ります。日付が変わる5分前まで）。解いたら止まります。${nextTxt ? '<br>' + nextTxt : ''}</div>
    <div class="hint-small" style="margin-top:6px;">📅 予定のアラームは、カレンダーの予定の「⏰ アラーム」で選べます${evN ? `（${evN}件の予定に入っています）` : ''}。</div>
    ${warn.length ? `<div style="margin-top:8px;">${warn.join('')}</div>` : ''}
    <button class="btn btn-secondary" style="margin-top:8px;" onclick="alarmTest()">🔔 アラームを試す</button>`;
}
function onAlarmPrefChange() {
  const p = alarmPrefs();
  const c = document.getElementById('chkAlarmStreak'), t = document.getElementById('txtAlarmTime'), s = document.getElementById('selAlarmSnooze');
  if (c) p.on = c.checked;
  if (t && /^\d{1,2}:\d{2}$/.test(t.value)) p.time = t.value;
  if (s) p.snooze = Number(s.value) || 10;
  try { localStorage.setItem(ALARM_KEY, JSON.stringify(p)); } catch (e) {}
  if (p.on && alarmStatus().notif === false && typeof enableNotifications === 'function') enableNotifications();
  appAlarmSync(true);
  setTimeout(() => { if (typeof renderNotifySettings === 'function') renderNotifySettings(); }, 300);
}
function alarmTest() {
  if (!appAlarmOk()) return;
  if (alarmStatus().notif === false) return alert('通知がオフなので鳴らせません。先に通知を許可してください。');
  try { window.SusuruApp.testAlarm('⏰ アラームのテスト', 'こんなふうに鳴ります。「止める」で止まります。'); } catch (e) {}
}
