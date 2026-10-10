// ----------------- お知らせ履歴 -----------------
// ★ ここにあなたのUID（管理タブでコピーしたもの）を貼り付けてください！
const ADMIN_UID = "gIAmjFfGLGWHyk6PZuP1q86mQ5x1"; 

// ★ 管理者チェック関数：アプデ投稿エリアの表示/非表示を制御
function updateAdminUIVisibility() {
  const postArea = document.getElementById('updatePostArea');
  if (!postArea) return; 
  
  if (currentUser && currentUser.uid === ADMIN_UID) {
    postArea.style.display = 'block';
    loadUserReports(); // 管理者なら要望一覧も自動で読み込む
  } else {
    postArea.style.display = 'none';
  }
}

// ★【0.03.00】Firestore のお知らせと、アプリ同梱のお知らせ（release-notes.js）をまとめて新しい順に表示する
async function loadUpdates() {
  const area = document.getElementById('updatesListArea');
  area.innerHTML = '<p style="text-align:center; color:var(--text3); font-size:0.9rem;">読み込み中...</p>';
  const isAdmin = currentUser && currentUser.uid === ADMIN_UID;
  const items = [];
  let fetchFailed = false;
  try {
    const snap = await firestore.collection('susuru_anki_updates').orderBy('date','desc').limit(30).get();
    snap.forEach(doc => {
      const d = doc.data();
      const date = d.date && d.date.toDate ? d.date.toDate() : null;
      items.push({ id: doc.id, title: d.title, version: d.version, content: d.content, date, fromCloud: true });
    });
  } catch(e) {
    console.warn("アプデ情報の取得に失敗しました", e);
    fetchFailed = true;
  }
  // 同じバージョンのお知らせが Firestore にあればそちらを優先し、同梱分は出さない
  const cloudVersions = new Set(items.map(it => String(it.version)));
  (typeof BUNDLED_RELEASE_NOTES !== 'undefined' ? BUNDLED_RELEASE_NOTES : []).forEach(n => {
    if (cloudVersions.has(String(n.version))) return;
    items.push({ title: n.title, version: n.version, content: n.content, date: n.date ? new Date(n.date + 'T00:00:00') : null, fromCloud: false });
  });
  items.sort((x, y) => (y.date ? y.date.getTime() : 0) - (x.date ? x.date.getTime() : 0));

  if (items.length === 0) {
    area.innerHTML = fetchFailed
      ? '<p style="text-align:center; color:var(--danger); font-size:0.9rem;">取得に失敗しました</p>'
      : '<p style="text-align:center; color:var(--text3); font-size:0.9rem;">まだお知らせはありません。</p>';
    return;
  }
  area.innerHTML = '';
  items.forEach(it => {
    const dateStr = it.date ? it.date.toLocaleDateString('ja-JP') : '';
    const delBtn = (isAdmin && it.fromCloud) ? `<button class="btn btn-danger" style="padding:4px 10px; font-size:0.75rem; margin-top:10px; width:auto;" onclick="deleteUpdate('${it.id}')">🗑️ このお知らせを削除</button>` : '';
    area.innerHTML += `<div class="card" style="margin-bottom:10px;">
      <div class="update-banner-title" style="margin-bottom:8px;">🎉 ${escapeHtml(it.title)} (v${escapeHtml(it.version)}) 
        <span style="font-size:0.7rem; color:var(--text3); margin-left:auto;">${dateStr}</span>
      </div>
      <div style="font-size:0.85rem; line-height:1.5; color:var(--text); white-space:pre-wrap;">${escapeHtml(it.content)}</div>
      ${delBtn}
    </div>`;
  });
  if (fetchFailed) area.innerHTML += '<p style="text-align:center; color:var(--text3); font-size:0.75rem;">※ オンラインのお知らせは取得できませんでした</p>';
  markLatestReleaseNoteSeen();
}

// ★【0.03.00】最新版の同梱お知らせを、まだ見ていない人のホーム画面にバナーで出す
const SEEN_RELEASE_KEY = 'susuru_anki_seen_release';
function getLatestReleaseNote() {
  return (typeof BUNDLED_RELEASE_NOTES !== 'undefined' && BUNDLED_RELEASE_NOTES.length) ? BUNDLED_RELEASE_NOTES[0] : null;
}
function showReleaseBannerIfNew() {
  const banner = document.getElementById('releaseBanner');
  const note = getLatestReleaseNote();
  if (!banner || !note) return;
  let seen = null;
  try { seen = localStorage.getItem(SEEN_RELEASE_KEY); } catch(e) {}
  if (seen === note.version) { banner.style.display = 'none'; return; }
  document.getElementById('releaseBannerText').innerText = `v${note.version}：${note.title}`;
  banner.style.display = 'flex';
}
function markLatestReleaseNoteSeen() {
  const note = getLatestReleaseNote();
  if (!note) return;
  try { localStorage.setItem(SEEN_RELEASE_KEY, note.version); } catch(e) {}
  const banner = document.getElementById('releaseBanner');
  if (banner) banner.style.display = 'none';
}
function openReleaseNotesFromBanner() {
  openPage('pgUpdates'); loadUpdates();
}

// ★ 管理者用：お知らせを削除する
async function deleteUpdate(docId) {
  if(!confirm("このお知らせを削除しますか？")) return;
  try {
    await firestore.collection('susuru_anki_updates').doc(docId).delete();
    loadUpdates();
  } catch(e) { alert("削除に失敗しました。"); }
}

// ★ 管理者用：お知らせを投稿する
async function postUpdate() {
  if(!currentUser) return alert("投稿するにはログインが必要です。");
  if(currentUser.uid !== ADMIN_UID) return alert("⛔ 管理者専用機能です。あなたはこの機能を使えません。");
  
  const title = document.getElementById('txtUpdTitle').value.trim();
  const version = document.getElementById('txtUpdVersion').value.trim();
  const content = document.getElementById('txtUpdContent').value.trim();
  
  if(!title || !version || !content) return alert("タイトル、バージョン、内容をすべて入力してください。");
  if(!confirm(`バージョン ${version} のお知らせを配信しますか？`)) return;
  
  try {
    await firestore.collection('susuru_anki_updates').add({
      title: title, version: version, content: content,
      date: firebase.firestore.FieldValue.serverTimestamp(), authorUid: currentUser.uid
    });
    alert("✅ お知らせを配信しました！");
    document.getElementById('txtUpdTitle').value = '';
    document.getElementById('txtUpdVersion').value = '';
    document.getElementById('txtUpdContent').value = '';
    if(typeof loadUpdates === 'function') loadUpdates();
  } catch(e) { alert("⚠️ 投稿に失敗しました。"); }
}

// ★ 全ユーザー用：バグ・要望を送信する
async function submitUserReport() {
  const text = document.getElementById('txtUserReport').value.trim();
  if(!text) return alert("内容を入力してください。");
  const uid = currentUser ? currentUser.uid : '未ログイン';
  const name = currentUser ? (currentUser.displayName || '名無し') : '未ログイン';
  
  try {
    await firestore.collection('susuru_anki_reports').add({
      content: text, uid: uid, name: name,
      date: firebase.firestore.FieldValue.serverTimestamp(),
      version: typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'unknown'
    });
    alert("✅ 報告・要望を送信しました！開発の参考にさせていただきます。");
    document.getElementById('txtUserReport').value = '';
  } catch(e) { alert("⚠️ 送信に失敗しました。"); }
}

// ★ 管理者用：要望一覧を読み込む
async function loadUserReports() {
  if(!currentUser || currentUser.uid !== ADMIN_UID) return;
  const list = document.getElementById('adminReportsList');
  list.innerHTML = '<p style="text-align:center; color:var(--text3); font-size:0.8rem;">読み込み中...</p>';
  try {
    const snap = await firestore.collection('susuru_anki_reports').orderBy('date','desc').limit(50).get();
    list.innerHTML = '';
    if(snap.empty) { list.innerHTML = '<p style="text-align:center; color:var(--text3); font-size:0.8rem;">まだ報告はありません。</p>'; return; }
    snap.forEach(doc => {
      const d = doc.data();
      const dateStr = d.date && d.date.toDate ? d.date.toDate().toLocaleString('ja-JP') : '';
      list.innerHTML += `<div style="background:var(--bg3); padding:10px; border-radius:8px; border:1px solid var(--border);">
        <div style="font-size:0.75rem; color:var(--text2); display:flex; justify-content:space-between;">
          <span>👤 ${escapeHtml(d.name)} (v${escapeHtml(d.version)})</span>
          <span>${dateStr}</span>
        </div>
        <div style="font-size:0.85rem; color:var(--text); margin-top:5px; white-space:pre-wrap;">${escapeHtml(d.content)}</div>
        <button class="btn btn-danger" style="padding:4px 10px; font-size:0.75rem; margin-top:10px; width:auto;" onclick="deleteUserReport('${doc.id}')">✅ 対応完了 (削除)</button>
      </div>`;
    });
  } catch(e) { list.innerHTML = '<p style="color:var(--danger); font-size:0.8rem;">読み込みエラー</p>'; }
}

// ★ 管理者用：要望を削除する
async function deleteUserReport(docId) {
  if(!confirm("この要望を対応済みとして削除しますか？")) return;
  try {
    await firestore.collection('susuru_anki_reports').doc(docId).delete();
    loadUserReports();
  } catch(e) {}
}
