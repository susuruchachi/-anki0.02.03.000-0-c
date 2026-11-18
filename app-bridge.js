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
  try { return Number(window.SusuruApp.versionCode()) < appVersionCode(ANDROID_APK_VERSION); } catch (e) { return false; }
}
function appApkUrl() { return new URL('apk/susuruanki.apk?v=' + ANDROID_APK_VERSION, location.href).href; }
// ★【0.04.24】新しいアプリ（0.04.24 から）は、自分で自分を入れ直す（PackageInstaller）。一度この仕組みで入れると、次からは確認なしで、
//  アプリを閉じたとき（裏に回して1分・プレイ中でない）に入れ替わる。古いアプリは今まで通り（インストールの画面へ）
function appApkNew() { return isAndroidApp() && !!window.SusuruApp.apkPrepare; }
let _apkInstallAfter = false;
function appInstallApk() {
  try {
    if (appApkNew()) {
      if (window.SusuruApp.apkReady()) window.SusuruApp.apkInstallNow();
      else { _apkInstallAfter = true; if (typeof showAppToast === 'function') showAppToast('📲 新しいアプリをダウンロードしています…'); window.SusuruApp.apkPrepare(appApkUrl(), appVersionCode(ANDROID_APK_VERSION)); }
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
    try { if (localStorage.getItem(k + '_auto') === ANDROID_APK_VERSION) return; localStorage.setItem(k + '_auto', ANDROID_APK_VERSION); } catch (e) {}
    if (typeof showAppToast === 'function') showAppToast(`📲 新しいアプリ（${ANDROID_APK_VERSION}）を用意しました。アプリを閉じると、自動で入れ替わります`);
    return;
  }
  try { if (!_apkForce && localStorage.getItem(k) === today) return; localStorage.setItem(k, today); } catch (e) {}
  if (confirm(`📲 新しい Android アプリ（${ANDROID_APK_VERSION}）があります（学習データはそのまま）。\n今回だけ確認が出ます。次からは、アプリを閉じたときに自動で更新されます。\n更新しますか？`)) window.SusuruApp.apkInstallNow();
};
let _apkForce = false;
function appCheckApkUpdate(force) {
  if (!appApkUpdateAvailable()) return;
  if (appApkNew()) { _apkForce = !!force; try { window.SusuruApp.apkPrepare(appApkUrl(), appVersionCode(ANDROID_APK_VERSION)); } catch (e) {} return; }
  const k = 'susuru_anki_apk_notice', today = new Date().toDateString();
  try { if (!force && localStorage.getItem(k) === today) return; localStorage.setItem(k, today); } catch (e) {}
  if (confirm(`📲 新しい Android アプリ（${ANDROID_APK_VERSION}）があります。\n今のアプリに上書きで入れます（学習データはそのまま）。更新しますか？`)) appInstallApk();
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
