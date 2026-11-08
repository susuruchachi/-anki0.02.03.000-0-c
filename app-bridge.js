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
    if (err && err !== 'cancel') alert('⚠️ ログインできませんでした\n' + err + '\n\n（アプリの Google ログインの設定がまだ済んでいないかもしれません）');
    return;
  }
  const cred = firebase.auth.GoogleAuthProvider.credential(token);
  auth.signInWithCredential(cred).catch(e => alert('⚠️ ログインエラー: ' + e.message));
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
