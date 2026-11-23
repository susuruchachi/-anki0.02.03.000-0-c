// ----------------- Firebase Auth -----------------
function firebaseLogin() { 
  if (typeof appGoogleLogin === 'function' && appGoogleLogin()) return; // ★【0.04.03】Android アプリの中では、アプリ側でログイン
  // ★【0.04.45】iOS アプリの中では Google のログインができない（Google がアプリの中の画面でのログインを許さない）ので、メールアドレスで
  if (typeof isIOSApp === 'function' && isIOSApp()) {
    alert('iPad のアプリの中では、Google でログインできません。\n下の「📧 メールアドレスでログイン」から入ってください。\n\nまだメールアドレスを追加していなければ、先に Safari のすするanki（いつものウェブ版）で、Google でログインしたまま設定の「📧 メールアドレスとパスワードを追加」から追加してください。同じアカウントに入れます。');
    document.querySelectorAll('details').forEach(x => { if (/メールアドレスでログイン/.test(x.textContent || '')) { x.open = true; x.scrollIntoView({ block: 'center' }); } });
    return;
  }
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ 'prompt': 'select_account' });
  
  auth.signInWithPopup(provider)
    .catch(err => { 
      if (err.code === 'auth/popup-blocked') {
        alert("⚠️ ポップアップがブロックされました。\nブラウザの設定で許可してからお試しください。");
      } else if (err.code === 'auth/cancelled-popup-request') {
        // ユーザーが意図的にポップアップを閉じた場合
        console.log("ログインがキャンセルされました");
      } else { 
        alert("⚠️ ログインエラー: " + err.message); 
      }
    });
}

async function firebaseLogout() { 
  // ★【0.03.14】この端末への通知を止めてからログアウトする
  if (typeof removePushTokenBeforeLogout === 'function') await removePushTokenBeforeLogout();
  if (typeof appGoogleLogout === 'function') appGoogleLogout();
  auth.signOut()
    .then(() => alert("✅ ログアウトしました"))
    .catch(err => alert("⚠️ ログアウトエラー: " + err.message));
}

auth.onAuthStateChanged(user => {
  currentUser = user;
  window._authReady = true; // ★【0.04.12】ログインの確認が済んだ（共有用リンクの購読で待つ）
  const ls = document.getElementById('fbLoginState');
  if(!ls) return;
  
  if(user) {
    ls.innerHTML = `<span style="color:var(--success);">✅ ${escapeHtml(user.displayName || user.email)}</span>`;
    setTimeout(renderLoginMethods, 0); // ★【0.04.26】ログインの方法
    const btnLogin = document.getElementById('btnFbLogin');
    const btnLogout = document.getElementById('btnFbLogout');
    if(btnLogin) btnLogin.style.display = 'none';
    if(btnLogout) btnLogout.style.display = 'inline-flex';
    
    const txtUid = document.getElementById('txtMyUid');
    if(txtUid) txtUid.value = user.uid;
    
    // ★【0.03.47】自分で決めた表示名（customName）があれば、Google の名前で上書きしない
    firestore.collection('susuru_anki_profiles').doc(user.uid).get().then(p => {
      const cn = p.exists && p.data().customName;
      return firestore.collection('susuru_anki_profiles').doc(user.uid).set({
        displayName: cn || user.displayName || (user.email ? user.email.split('@')[0] : '') || '名無し',
        uid: user.uid,
        lastLogin: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }).catch(e => console.error("プロフィール保存エラー:", e));
    if (typeof onFriendAuthReady === 'function') onFriendAuthReady(); // 表示名・URL のフレンド申請
    
    syncToCloud(true);
    
    if (typeof currentSharedDocId !== 'undefined' && currentSharedDocId) {
      listenToSharedDoc(currentSharedDocId);
    }
    
    // ★ 管理者UI表示の更新
    if (typeof updateAdminUIVisibility === 'function') updateAdminUIVisibility();
    
    // ★【0.03.10】招待リンク（オンライン対戦）・対戦途中からの復帰のチェック（ログインが終わってから）
    if (typeof onMatchAuthReady === 'function') onMatchAuthReady();
    if (typeof onNotifyAuthReady === 'function') onNotifyAuthReady(); // ★【0.03.14】プッシュ通知の登録
    if (typeof streakBackfill === 'function') setTimeout(streakBackfill, 4000); // ★【0.03.62】連続記録の過去分
    if (typeof loadAiKeysFromCloud === 'function') loadAiKeysFromCloud(); // ★【0.03.15】AI のキー（自分の・家族の）
    if (typeof startFriendRequestWatch === 'function') startFriendRequestWatch(); // ★【0.03.25】フレンド申請
    if (typeof startGroupWatch === 'function') startGroupWatch(); // ★【0.04.20】グループ
    if (typeof calStartSubWatch === 'function') calStartSubWatch(); // ★【0.04.22】URL で購読するカレンダー
    if (typeof calStartLinkWatch === 'function') calStartLinkWatch(); // ★【0.04.36】航海日誌と同期
  } else {
    if (typeof stopCloudListener === 'function') stopCloudListener();
    if (typeof startFriendRequestWatch === 'function') startFriendRequestWatch(); // ログアウトしたら見張りをやめる
    if (typeof startGroupWatch === 'function') startGroupWatch();
    if (typeof calStartSubWatch === 'function') calStartSubWatch();
    if (typeof calStartLinkWatch === 'function') calStartLinkWatch();
    ls.innerHTML = `<span style="color:var(--warn);">未ログイン</span>`;
    setTimeout(renderLoginMethods, 0);
    const btnLogin = document.getElementById('btnFbLogin');
    const btnLogout = document.getElementById('btnFbLogout');
    if(btnLogin) btnLogin.style.display = 'inline-flex';
    if(btnLogout) btnLogout.style.display = 'none';
    
    const txtUid = document.getElementById('txtMyUid');
    if(txtUid) txtUid.value = '';
    
    // ★ 管理者UI表示の更新（非管理者の場合は非表示）
    if (typeof updateAdminUIVisibility === 'function') updateAdminUIVisibility();
  }
});

// ================================================================
// ★【0.04.26】📧 メールアドレスとパスワードでもログインできるようにする
// ・Google で作ったアカウントに「メールアドレス＋パスワード」をつなぐ（linkWithCredential）。つないだあとは、
//   どちらでログインしても同じアカウント（同じ UID・同じデータ）。Google でログインできない端末で使う
// ・メールだけで新しく作ることもできる（そのときは別のアカウントになる）
// ・Firebase コンソールの Authentication →「ログイン方法」で「メール / パスワード」を有効にしておく必要がある
// ================================================================
function authErrText(e) {
  const c = e && e.code || '';
  return {
    'auth/operation-not-allowed': 'メールアドレスでのログインが、まだ有効になっていません（管理者が Firebase の設定で「メール / パスワード」を有効にする必要があります）',
    'auth/invalid-email': 'メールアドレスの形が正しくありません',
    'auth/weak-password': 'パスワードは6文字以上にしてください',
    'auth/email-already-in-use': 'このメールアドレスは、もう別のアカウントで使われています',
    'auth/credential-already-in-use': 'このメールアドレスは、もう別のアカウントで使われています',
    'auth/provider-already-linked': 'メールアドレスは、もうこのアカウントにつながっています',
    'auth/requires-recent-login': '安全のため、一度ログアウトして、もう一度ログインしてからやり直してください',
    'auth/wrong-password': 'メールアドレスかパスワードが違います',
    'auth/invalid-credential': 'メールアドレスかパスワードが違います',
    'auth/invalid-login-credentials': 'メールアドレスかパスワードが違います',
    'auth/user-not-found': 'このメールアドレスのアカウントはありません',
    'auth/too-many-requests': '何度も失敗したので、しばらく待ってからやり直してください',
    'auth/network-request-failed': 'インターネットにつながっていないようです'
  }[c] || (e && e.message) || String(e);
}
function authProviders() { return currentUser ? (currentUser.providerData || []).map(p => p.providerId) : []; }
function renderLoginMethods() {
  const box = document.getElementById('loginMethodsBox'); if (!box) return;
  const v = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  if (!currentUser) {
    box.innerHTML = `<details style="margin-top:10px;"><summary class="hint-small" style="cursor:pointer;">📧 メールアドレスでログイン（Google でログインできない端末など）</summary>
      <input type="email" id="txtAuthEmail" class="form-control" placeholder="メールアドレス" autocomplete="username" style="margin-top:8px;" value="${escAttr(v('txtAuthEmail'))}">
      <input type="password" id="txtAuthPw" class="form-control" placeholder="パスワード（6文字以上）" autocomplete="current-password" style="margin-top:6px;">
      <div class="form-row" style="margin-top:6px;"><button class="btn btn-primary" onclick="emailLogin()">🔑 ログイン</button><button class="btn btn-secondary" onclick="emailResetPw()">パスワードを忘れた</button></div>
      <div class="hint-small" style="margin-top:6px;">Google で使っているアカウントにメールアドレスをつないでおくと、同じアカウント（同じデータ）にログインできます。つなぐのは、Google でログインしてから、ここ（設定）の「📧 メールアドレスとパスワードを追加」で。</div>
      <button class="btn btn-secondary" style="margin-top:6px;" onclick="emailSignUp()">＋ メールアドレスで新しくアカウントを作る</button></details>`;
    return;
  }
  const ps = authProviders(), hasMail = ps.includes('password'), hasG = ps.includes('google.com');
  const mail = (currentUser.providerData || []).find(p => p.providerId === 'password');
  box.innerHTML = `<div class="hint-small" style="margin-top:10px;">🔐 ログインの方法：${hasG ? 'Google ✅' : 'Google —'}・${hasMail ? `メール ✅（${escapeHtml(mail.email || currentUser.email || '')}）` : 'メール —'}</div>
    ${hasMail ? `<button class="btn btn-secondary" style="margin-top:6px;" onclick="emailResetPw(${jsArg(mail.email || currentUser.email || '')})">🔑 パスワードを変える（メールが届きます）</button>`
      : `<details style="margin-top:6px;"><summary class="hint-small" style="cursor:pointer;">📧 メールアドレスとパスワードを追加（ほかの端末で、同じアカウントにログインできる）</summary>
        <input type="email" id="txtLinkEmail" class="form-control" placeholder="メールアドレス" autocomplete="username" style="margin-top:8px;" value="${escAttr(currentUser.email || '')}">
        <input type="password" id="txtLinkPw" class="form-control" placeholder="パスワード（6文字以上）" autocomplete="new-password" style="margin-top:6px;">
        <button class="btn btn-primary" style="margin-top:6px;" onclick="emailLink()">📧 このアカウントに追加</button>
        <div class="hint-small" style="margin-top:4px;">追加したあとは、ログインの画面の「📧 メールアドレスでログイン」から、このアカウントに入れます。</div></details>`}
    ${!hasG ? `<div class="hint-small" style="margin-top:6px;">Google でもログインできるようにするには：<button class="chip" onclick="googleLink()">Google を追加</button></div>` : ''}`;
}
async function emailLogin() {
  const email = (document.getElementById('txtAuthEmail').value || '').trim(), pw = document.getElementById('txtAuthPw').value || '';
  if (!email || !pw) return alert('メールアドレスとパスワードを入れてください。');
  try { await auth.signInWithEmailAndPassword(email, pw); alert('✅ ログインしました'); }
  catch (e) { alert('⚠️ ログインできませんでした：' + authErrText(e)); }
}
async function emailSignUp() {
  const email = (document.getElementById('txtAuthEmail').value || '').trim(), pw = document.getElementById('txtAuthPw').value || '';
  if (!email || !pw) return alert('上の欄にメールアドレスとパスワード（6文字以上）を入れてから押してください。');
  if (!confirm('メールアドレスで、新しいアカウントを作ります。\n\n⚠️ Google で使っているアカウントがあるなら、ここで作ると別のアカウント（データも別）になります。同じアカウントにしたいときは、Google でログインしてから、設定の「📧 メールアドレスとパスワードを追加」を使ってください。\n\n新しく作りますか？')) return;
  try {
    const r = await auth.createUserWithEmailAndPassword(email, pw);
    const name = email.split('@')[0].slice(0, 20);
    try { await r.user.updateProfile({ displayName: name }); } catch (e) {}
    alert(`✅ アカウントを作りました（表示名：${name}。設定の「表示名」で変えられます）`);
  } catch (e) { alert('⚠️ 作れませんでした：' + authErrText(e)); }
}
async function emailLink() {
  if (!currentUser) return;
  const email = (document.getElementById('txtLinkEmail').value || '').trim(), pw = document.getElementById('txtLinkPw').value || '';
  if (!email || pw.length < 6) return alert('メールアドレスと、6文字以上のパスワードを入れてください。');
  try {
    await currentUser.linkWithCredential(firebase.auth.EmailAuthProvider.credential(email, pw));
    await currentUser.reload().catch(() => {});
    currentUser = auth.currentUser;
    renderLoginMethods();
    alert(`✅ このアカウントに、メールアドレス（${email}）でもログインできるようになりました。\nほかの端末では、設定のログインの「📧 メールアドレスでログイン」から入れます。`);
  } catch (e) { alert('⚠️ 追加できませんでした：' + authErrText(e)); }
}
async function emailResetPw(email) {
  email = email || ((document.getElementById('txtAuthEmail') || {}).value || '').trim();
  if (!email) return alert('上の欄にメールアドレスを入れてから押してください。');
  try { await auth.sendPasswordResetEmail(email); alert(`📧 ${email} に、パスワードを決め直すメールを送りました（届かなければ迷惑メールのフォルダーも見てください）。`); }
  catch (e) { alert('⚠️ 送れませんでした：' + authErrText(e)); }
}
async function googleLink() {
  if (!currentUser) return;
  if (typeof isAndroidApp === 'function' && isAndroidApp()) return alert('Google の追加は、ブラウザ版（iPad・パソコンなど）ですすするanki を開いて、メールアドレスでログインしてから行ってください。');
  try {
    const provider = new firebase.auth.GoogleAuthProvider(); provider.setCustomParameters({ prompt: 'select_account' });
    await currentUser.linkWithPopup(provider);
    await currentUser.reload().catch(() => {}); currentUser = auth.currentUser; renderLoginMethods();
    alert('✅ Google でもログインできるようになりました。');
  } catch (e) { alert('⚠️ 追加できませんでした：' + authErrText(e)); }
}
