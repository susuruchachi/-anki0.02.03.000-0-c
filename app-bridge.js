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
function appInstallApk() { try { window.SusuruApp.installApk(new URL('apk/susuruanki.apk?v=' + ANDROID_APK_VERSION, location.href).href); } catch (e) { alert('⚠️ ダウンロードできませんでした'); } }
function appCheckApkUpdate(force) {
  if (!appApkUpdateAvailable()) return;
  const k = 'susuru_anki_apk_notice', today = new Date().toDateString();
  try { if (!force && localStorage.getItem(k) === today) return; localStorage.setItem(k, today); } catch (e) {}
  if (confirm(`📲 新しい Android アプリ（${ANDROID_APK_VERSION}）があります。\n今のアプリに上書きで入れます（学習データはそのまま）。更新しますか？`)) appInstallApk();
}
window.addEventListener('load', () => setTimeout(() => appCheckApkUpdate(false), 4000));

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
