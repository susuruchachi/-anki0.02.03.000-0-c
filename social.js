// ★★★ すするanki0.02.51-g - ソーシャル機能（ランキング・フレンド・チャット・成績比較・オンライン対戦） ★★★

// ★ グローバル変数の安全な初期化
window.shareStats = localStorage.getItem('shareStats') === 'true';

// ★ 本日のデイリーランキング表示
let rankingMode = 'quiz'; // ★【0.03.39】'quiz'（通常のクイズ）／'drill'（暗記テスト）
function setRankingMode(m) { rankingMode = m; document.querySelectorAll('[data-rankmode]').forEach(b => b.classList.toggle('active', b.dataset.rankmode === m)); loadDailyRanking(); }
async function loadDailyRanking() {
  const listDiv = document.getElementById('rankingList');
  if (!currentUser) { listDiv.innerHTML = 'ログインしてください'; return; }
  const d = getTodayStr();
  try {
    listDiv.innerHTML = '(読み込み中...)';
    const snap = await firestore.collection('susuru_anki_daily_scores').where('date', '==', d).get();
    
    if(snap.empty) { listDiv.innerHTML = 'まだ今日のスコアがありません。あなたが1番乗りです！'; return; }
    
    const key = rankingMode === 'drill' ? 'drillScore' : 'score';
    let scores = [];
    snap.forEach(doc => { const x = doc.data(); if ((x[key] || 0) > 0) scores.push(x); });
    if (!scores.length) { listDiv.innerHTML = rankingMode === 'drill' ? '今日はまだ暗記テストのスコアがありません。' : 'まだ今日のスコアがありません。あなたが1番乗りです！'; return; }
    scores.sort((a, b) => (b[key] || 0) - (a[key] || 0));
    scores = scores.slice(0, 10);
    
    listDiv.innerHTML = '';
    let rank = 1;
    scores.forEach(data => {
      const extra = rankingMode === 'drill' && data.drillTotal ? ` <span class="hint-small">正答率 ${Math.round(data.drillScore / data.drillTotal * 100)}%</span>` : '';
      listDiv.innerHTML += `<div><span style="display:inline-block; width:24px; color:var(--warn); font-weight:bold;">${rank}</span>: ${escapeHtml(data.name)} <span style="color:var(--success); font-weight:bold;">(${data[key]}問)</span>${extra}</div>`;
      rank++;
    });
  } catch(e) {
    console.error(e);
    listDiv.innerHTML = '<span style="color:var(--danger)">ランキング取得エラー (通信状況等をご確認ください)</span>';
  }
}

// ★ 自分のUIDをクリップボードにコピー
function copyMyUid() {
  const uid = document.getElementById('txtMyUid').value; 
  if (!uid) return alert("ログインが必要です。");
  navigator.clipboard.writeText(uid).then(() => alert("✅ UIDをコピーしました！"));
}

// ================================================================
// ★【0.03.25】フレンド申請と承認
//  申請：susuru_anki_friend_requests/{送った人_受け取る人} に { from, to, status: 'pending' } を作る
//  承認：受け取った人が、自分のフレンド一覧に相手を足して、申請を status: 'accepted' にする
//        → 送った人の画面がそれに気づいて、自分のフレンド一覧に相手を足し、申請を消す
//  （相手のプロフィールには書き込まないので、勝手にフレンドにされることはない）
//  通知：アプリを開いている間はその場で、閉じているときはプッシュ通知（送信側 tools/push-notify.js）で知らせる
// ================================================================
const FRIEND_REQ_COL = 'susuru_anki_friend_requests';
let _friendReqIn = [], _friendReqOut = [], _friendReqUnsubs = [];
function friendErrMsg(e) {
  const c = (e && (e.code || e.message)) || '';
  if (/permission/i.test(c)) return 'Firestore のルールで拒否されました。管理者が docs/firestore.rules の最新のルールを公開しているか確認してください。';
  if (/unavailable|network/i.test(c)) return '通信できませんでした。電波の良いところでもう一度試してください。';
  return c;
}
async function myFriendList() {
  const snap = await firestore.collection('susuru_anki_profiles').doc(currentUser.uid).get();
  return snap.exists ? (snap.data().friends || []) : [];
}
// フレンド申請を送る（UID の入力欄・対戦履歴から）
async function sendFriendRequest(toUid, toName) {
  if (!currentUser) return alert('ログインが必要です。');
  toUid = String(toUid || '').trim();
  if (!toUid) return alert('UIDを入力してください。');
  if (toUid === currentUser.uid) return alert('自分自身には申請できません。');
  try {
    const prof = await firestore.collection('susuru_anki_profiles').doc(toUid).get();
    if (!prof.exists) return alert('⚠️ そのUIDのユーザーが見つかりません。UIDをもう一度確かめてください（相手が一度ログインしている必要があります）。');
    const name = toName || prof.data().displayName || '名無し';
    if ((await myFriendList()).includes(toUid)) return alert(`${name} さんはすでにフレンドです。`);
    // 相手からの申請が届いていれば、それを承認する
    const back = _friendReqIn.find(r => r.from === toUid && r.status === 'pending');
    if (back) { await acceptFriendRequest(back.id); return; }
    await firestore.collection(FRIEND_REQ_COL).doc(`${currentUser.uid}_${toUid}`).set({
      from: currentUser.uid, fromName: currentUser.displayName || '名無し', to: toUid, toName: name,
      status: 'pending', createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    alert(`✅ ${name} さんにフレンド申請を送りました。相手が承認するとフレンドになります。`);
  } catch (e) { console.error(e); alert('⚠️ フレンド申請に失敗しました。\n' + friendErrMsg(e)); }
}
async function addAppFriend() {
  const el = document.getElementById('txtAddFriendUid');
  await sendFriendRequest(el.value);
  el.value = '';
}
async function acceptFriendRequest(id) {
  const r = _friendReqIn.find(x => x.id === id); if (!r || !currentUser) return;
  try {
    await firestore.collection('susuru_anki_profiles').doc(currentUser.uid).set({ friends: firebase.firestore.FieldValue.arrayUnion(r.from) }, { merge: true });
    await firestore.collection(FRIEND_REQ_COL).doc(id).update({ status: 'accepted', toName: currentUser.displayName || '名無し', respondedAt: firebase.firestore.FieldValue.serverTimestamp() });
    alert(`✅ ${r.fromName || '相手'} さんとフレンドになりました。`);
    loadAppFriends();
  } catch (e) { console.error(e); alert('⚠️ 承認に失敗しました。\n' + friendErrMsg(e)); }
}
async function rejectFriendRequest(id) {
  const r = _friendReqIn.find(x => x.id === id);
  if (!confirm(`${(r && r.fromName) || '相手'} さんからの申請を断りますか？（相手には知らせません）`)) return;
  try { await firestore.collection(FRIEND_REQ_COL).doc(id).delete(); } catch (e) { alert('⚠️ 失敗しました。\n' + friendErrMsg(e)); }
}
async function cancelFriendRequest(id) {
  if (!confirm('この申請を取り消しますか？')) return;
  try { await firestore.collection(FRIEND_REQ_COL).doc(id).delete(); } catch (e) { alert('⚠️ 失敗しました。\n' + friendErrMsg(e)); }
}
// 届いた申請・承認をその場で知らせる（一度知らせたものは知らせない）
function friendNoticeSeen(key) {
  let seen = {}; try { seen = JSON.parse(localStorage.getItem('susuru_anki_friend_seen') || '{}') || {}; } catch (e) {}
  if (seen[key]) return true;
  seen[key] = Date.now();
  const ks = Object.keys(seen); if (ks.length > 300) ks.sort((a, b) => seen[a] - seen[b]).slice(0, ks.length - 300).forEach(k => delete seen[k]);
  try { localStorage.setItem('susuru_anki_friend_seen', JSON.stringify(seen)); } catch (e) {}
  return false;
}
function friendNotify(title, body, key) {
  if (friendNoticeSeen(key)) return;
  if (typeof showLocalNotification === 'function' && typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') showLocalNotification(title, body, 'friend');
  else showAppToast(`${title}　${body}`, () => { openPage('pgFriends'); loadAppFriends(); });
}
function showAppToast(text, onClick) {
  const t = document.createElement('div'); t.className = 'app-toast'; t.textContent = text;
  t.onclick = () => { t.remove(); if (onClick) onClick(); };
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 6000);
}
// ログインしたら、自分あての申請・自分が送った申請を見張る
function startFriendRequestWatch() {
  _friendReqUnsubs.forEach(u => { try { u(); } catch (e) {} }); _friendReqUnsubs = [];
  _friendReqIn = []; _friendReqOut = []; renderFriendRequests();
  if (!currentUser) return;
  const col = firestore.collection(FRIEND_REQ_COL);
  _friendReqUnsubs.push(col.where('to', '==', currentUser.uid).onSnapshot(snap => {
    _friendReqIn = snap.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(r => r.status === 'pending');
    _friendReqIn.forEach(r => friendNotify('🤝 フレンド申請', `${r.fromName || '名無し'} さんから申請が届きました`, 'in:' + r.id));
    renderFriendRequests();
  }, e => console.warn('フレンド申請の読み込みに失敗:', e.message)));
  _friendReqUnsubs.push(col.where('from', '==', currentUser.uid).onSnapshot(async snap => {
    const all = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    _friendReqOut = all.filter(r => r.status === 'pending');
    renderFriendRequests();
    // 承認された申請：自分のフレンド一覧にも相手を足して、申請を片づける
    for (const r of all.filter(x => x.status === 'accepted')) {
      try {
        await firestore.collection('susuru_anki_profiles').doc(currentUser.uid).set({ friends: firebase.firestore.FieldValue.arrayUnion(r.to) }, { merge: true });
        await col.doc(r.id).delete();
        friendNotify('✅ フレンド申請が承認されました', `${r.toName || '相手'} さんとフレンドになりました`, 'ok:' + r.id);
        if (document.getElementById('pgFriends').classList.contains('active')) loadAppFriends();
      } catch (e) { console.warn('承認された申請の処理に失敗:', e.message); }
    }
  }, e => console.warn('送ったフレンド申請の読み込みに失敗:', e.message)));
  // ★【0.03.47】フレンドからの紹介
  _friendIntros = []; 
  _friendReqUnsubs.push(firestore.collection(FRIEND_INTRO_COL).where('to', '==', currentUser.uid).onSnapshot(snap => {
    _friendIntros = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    _friendIntros.forEach(r => friendNotify('🤝 フレンドの紹介', `${r.fromName || 'フレンド'} さんが ${r.introName || '名無し'} さんを紹介しました`, 'intro:' + r.id));
    renderFriendRequests();
  }, e => console.warn('フレンドの紹介の読み込みに失敗:', e.message)));
  if (location.hash === '#friends') { history.replaceState(null, '', location.pathname + location.search); openPage('pgFriends'); loadAppFriends(); }
}
function renderFriendRequests() {
  const n = _friendReqIn.length + _friendIntros.length;
  document.querySelectorAll('.friend-req-badge').forEach(b => { b.textContent = n; b.style.display = n ? 'inline-flex' : 'none'; });
  const box = document.getElementById('friendRequestsBox');
  if (!box) return;
  const rows = [];
  _friendReqIn.forEach(r => rows.push(`<div class="achieve-row"><div class="achieve-label">📨 ${escapeHtml(r.fromName || '名無し')}<div class="hint-small" style="font-family:'JetBrains Mono',monospace;">${escapeHtml(String(r.from).slice(0, 10))}…</div></div>
    <div style="display:flex; gap:6px;"><button class="btn btn-success" style="width:auto; padding:6px 12px; font-size:0.8rem;" onclick="acceptFriendRequest(${jsArg(r.id)})">承認</button><button class="btn btn-secondary" style="width:auto; padding:6px 10px; font-size:0.8rem;" onclick="rejectFriendRequest(${jsArg(r.id)})">断る</button></div></div>`));
  _friendIntros.forEach(r => rows.push(`<div class="achieve-row"><div class="achieve-label">🤝 ${escapeHtml(r.fromName || 'フレンド')} さんからの紹介：<b>${escapeHtml(r.introName || '名無し')}</b> さん</div>
    <div style="display:flex; gap:6px;"><button class="btn btn-success" style="width:auto; padding:6px 12px; font-size:0.8rem;" onclick="acceptFriendIntro(${jsArg(r.id)})">申請を送る</button><button class="btn btn-secondary" style="width:auto; padding:6px 10px; font-size:0.8rem;" onclick="dismissFriendIntro(${jsArg(r.id)})">閉じる</button></div></div>`));
  _friendReqOut.forEach(r => rows.push(`<div class="achieve-row"><div class="achieve-label">⏳ ${escapeHtml(r.toName || '名無し')} <span class="hint-small">（承認待ち）</span></div><button class="btn btn-secondary" style="width:auto; padding:6px 10px; font-size:0.8rem;" onclick="cancelFriendRequest(${jsArg(r.id)})">取り消す</button></div>`));
  box.innerHTML = rows.length ? rows.join('') : '<div class="hint-small">届いている申請・送った申請はありません。</div>';
}

// ================================================================
// ★【0.03.47】フレンドの紹介・表示名・URL でフレンド申請
// ================================================================
const FRIEND_INTRO_COL = 'susuru_anki_friend_intros';
let _friendIntros = [];
const _friendNames = {};
async function friendNameOf(uid) {
  if (_friendNames[uid]) return _friendNames[uid];
  try { const p = await firestore.collection('susuru_anki_profiles').doc(uid).get(); _friendNames[uid] = (p.exists && p.data().displayName) || '名無し'; } catch (e) { return '名無し'; }
  return _friendNames[uid];
}
// 自分のフレンド（uid）を、ほかのフレンドに紹介する（相手の画面の「📨 フレンド申請」に出る。押すと申請が送られる）
async function openFriendIntro(uid) {
  const friends = (await myFriendList()).filter(f => f !== uid);
  if (!friends.length) return alert('紹介できるほかのフレンドがいません。');
  const name = await friendNameOf(uid);
  const names = await Promise.all(friends.map(friendNameOf));
  let ov = document.getElementById('friendIntroOverlay');
  if (!ov) { ov = document.createElement('div'); ov.id = 'friendIntroOverlay'; ov.className = 'ctx-overlay'; ov.style.zIndex = '1060'; ov.onclick = () => { ov.style.display = 'none'; }; document.body.appendChild(ov); }
  ov.innerHTML = `<div class="menu-card editor-card" onclick="event.stopPropagation()"><div class="cat-edit-title">🤝 ${escapeHtml(name)} さんを紹介</div>
    <div class="hint-small" style="margin:6px 0;">紹介する相手を選んでください（お互いに紹介が届き、押すとフレンド申請が送られます）</div>
    ${friends.map((f, i) => `<label class="bulkdel-row"><input type="checkbox" value="${escAttr(f)}"><div>${escapeHtml(names[i])}</div></label>`).join('')}
    <div class="plan-btns" style="margin-top:10px;"><button class="btn btn-primary" id="friendIntroGo">紹介する</button><button class="btn btn-secondary" onclick="document.getElementById('friendIntroOverlay').style.display='none'">やめる</button></div></div>`;
  ov.style.display = 'flex';
  document.getElementById('friendIntroGo').onclick = async () => {
    const to = [...ov.querySelectorAll('input:checked')].map(x => x.value);
    if (!to.length) return;
    const me = currentUser.displayName || '名無し';
    try {
      for (const t of to) {
        const tName = await friendNameOf(t);
        const at = firebase.firestore.FieldValue.serverTimestamp();
        // t さんに uid さんを、uid さんに t さんを紹介する
        await firestore.collection(FRIEND_INTRO_COL).doc(`${currentUser.uid}_${t}_${uid}`).set({ from: currentUser.uid, fromName: me, to: t, intro: uid, introName: name, createdAt: at });
        await firestore.collection(FRIEND_INTRO_COL).doc(`${currentUser.uid}_${uid}_${t}`).set({ from: currentUser.uid, fromName: me, to: uid, intro: t, introName: tName, createdAt: at });
      }
      ov.style.display = 'none';
      showAppToast(`🤝 ${name} さんを紹介しました`);
    } catch (e) { console.error(e); alert('⚠️ 紹介に失敗しました。\n' + friendErrMsg(e)); }
  };
}
async function acceptFriendIntro(id) {
  const r = _friendIntros.find(x => x.id === id); if (!r) return;
  await sendFriendRequest(r.intro, r.introName);
  dismissFriendIntro(id, true);
}
async function dismissFriendIntro(id, silent) {
  try { await firestore.collection(FRIEND_INTRO_COL).doc(id).delete(); } catch (e) { if (!silent) alert('⚠️ 消せませんでした。\n' + friendErrMsg(e)); }
}
// 表示名：プロフィールの customName に保存して、ログインのたびに使う（Google の名前より優先）
async function saveMyDisplayName() {
  if (!currentUser) return alert('ログインが必要です。');
  const el = document.getElementById('txtMyDisplayName');
  const name = String(el.value || '').trim().slice(0, 20);
  if (!name) return alert('表示名を入力してください。');
  try {
    await firestore.collection('susuru_anki_profiles').doc(currentUser.uid).set({ displayName: name, customName: name }, { merge: true });
    await applyMyDisplayName(name);
    alert(`✅ 表示名を「${name}」にしました。`);
  } catch (e) { alert('⚠️ 表示名を変えられませんでした。\n' + friendErrMsg(e)); }
}
async function applyMyDisplayName(name) {
  if (!currentUser || !name) return;
  try { if (currentUser.displayName !== name && typeof currentUser.updateProfile === 'function') await currentUser.updateProfile({ displayName: name }); } catch (e) { console.warn('表示名の反映に失敗:', e.message); }
  try { Object.defineProperty(currentUser, 'displayName', { value: name, configurable: true, writable: true }); } catch (e) { try { currentUser.displayName = name; } catch (e2) {} }
  const el = document.getElementById('txtMyDisplayName'); if (el) el.value = name;
  const ls = document.getElementById('fbLoginState'); if (ls && ls.querySelector('span')) ls.querySelector('span').textContent = '✅ ' + name;
}
// フレンド申請の URL（開いた人に「○○さんにフレンド申請を送りますか？」と聞く）
function friendLinkUrl() { return location.origin + location.pathname + '?friend=' + encodeURIComponent(currentUser.uid); }
async function shareFriendLink() {
  if (!currentUser) return alert('ログインが必要です。');
  const url = friendLinkUrl(), text = `${currentUser.displayName || ''} さんから すするanki のフレンド申請のリンクです`;
  try { if (navigator.share) { await navigator.share({ title: 'すするanki フレンド申請', text, url }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url); alert('📋 フレンド申請のURLをコピーしました。\n' + url); } catch (e) { prompt('このURLを送ってください', url); }
}
(function captureFriendLink() {
  try {
    const u = new URL(location.href), f = u.searchParams.get('friend');
    if (!f) return;
    localStorage.setItem('susuru_anki_pending_friend', f);
    u.searchParams.delete('friend'); history.replaceState(null, '', u.pathname + (u.search ? u.search : '') + u.hash);
  } catch (e) {}
})();
// ログインが終わったら（auth.js から）：表示名の反映と、URL で開いたフレンド申請
async function onFriendAuthReady() {
  if (!currentUser) return;
  try {
    const p = await firestore.collection('susuru_anki_profiles').doc(currentUser.uid).get();
    const cn = p.exists && p.data().customName;
    if (cn) await applyMyDisplayName(cn);
    else { const el = document.getElementById('txtMyDisplayName'); if (el) el.value = currentUser.displayName || ''; }
  } catch (e) {}
  let f = null; try { f = localStorage.getItem('susuru_anki_pending_friend'); localStorage.removeItem('susuru_anki_pending_friend'); } catch (e) {}
  if (!f || f === currentUser.uid) return;
  if ((await myFriendList()).includes(f)) return showAppToast('🤝 もうフレンドです');
  const name = await friendNameOf(f);
  if (confirm(`🤝 ${name} さんにフレンド申請を送りますか？`)) sendFriendRequest(f, name);
}

// ★ フレンド一覧を読み込んで表示
async function loadAppFriends() {
  const listDiv = document.getElementById('appFriendsList'); 
  listDiv.innerHTML = '<p style="color:var(--text3); font-size:0.8rem; text-align:center;">読み込み中...</p>';
  if (!currentUser) { listDiv.innerHTML = '<p style="color:var(--danger); font-size:0.85rem; text-align:center;">ログインしてください</p>'; return; }
  try {
    const myProfileSnap = await firestore.collection('susuru_anki_profiles').doc(currentUser.uid).get();
    const friends = myProfileSnap.exists ? (myProfileSnap.data().friends || []) : [];
    if (friends.length === 0) { listDiv.innerHTML = '<p style="color:var(--text3); font-size:0.85rem; text-align:center;">フレンドはいません。</p>'; return; }
    listDiv.innerHTML = '';
    const names = await Promise.all(friends.map(friendNameOf)); // ★【0.03.48】1人ずつ待たずに、まとめて読む
    friends.forEach((fUid, i) => {
      const fName = names[i];
      const div = document.createElement('div'); div.className = 'achieve-row';
      div.innerHTML = `<div class="achieve-label">👤 ${escapeHtml(fName)}</div><div style="display:flex; gap:6px;">${friends.length > 1 ? `<button class="btn btn-secondary" style="width:auto; padding:6px 10px; font-size:0.8rem;" onclick="openFriendIntro(${jsArg(fUid)})" title="ほかのフレンドに紹介">🤝 紹介</button>` : ''}<button class="btn" style="width:auto; padding:6px 12px; font-size:0.8rem;" onclick="openChat(${jsArg(fUid)}, ${jsArg(fName)})">💬</button></div>`;
      listDiv.appendChild(div);
    });
  } catch (e) { listDiv.innerHTML = '<p style="color:var(--danger); font-size:0.8rem; text-align:center;">エラーが発生しました。</p>'; }
  if (typeof renderRace === 'function') renderRace();
}

let currentChatUnsubscribe = null, currentChatFriendUid = null;
function getChatId(uid1, uid2) { return [uid1, uid2].sort().join('_'); }

function openChat(friendUid, friendName) {
  document.getElementById('friendsListArea').style.display = 'none'; 
  document.getElementById('chatArea').style.display = 'flex'; 
  document.getElementById('chatWithTitle').innerText = friendName + " とのチャット";
  currentChatFriendUid = friendUid; 
  const chatId = getChatId(currentUser.uid, friendUid); 
  const msgBox = document.getElementById('chatMessages'); 
  msgBox.innerHTML = '履歴を取得中...';
  
  if (currentChatUnsubscribe) currentChatUnsubscribe();
  currentChatUnsubscribe = firestore.collection('susuru_anki_chats').doc(chatId).collection('messages').orderBy('timestamp', 'asc').onSnapshot(snap => {
    msgBox.innerHTML = ''; 
    if (snap.empty) { msgBox.innerHTML = '<div style="color:var(--text3); text-align:center; font-size:0.8rem;">まだメッセージがありません。</div>'; }
    snap.forEach(doc => {
      const data = doc.data(); const isMe = data.senderId === currentUser.uid;
      const wrap = document.createElement('div'); wrap.style.cssText = `display:flex; flex-direction:column; max-width:80%; ${isMe ? 'align-self:flex-end;' : 'align-self:flex-start;'}`;
      const bubble = document.createElement('div'); bubble.style.cssText = `padding:10px 14px; border-radius:14px; font-size:0.9rem; word-break:break-all; ${isMe ? 'background:var(--primary); color:#fff; border-bottom-right-radius:2px;' : 'background:var(--bg3); border:1px solid var(--border); color:var(--text); border-bottom-left-radius:2px;'}`;
      bubble.innerText = data.text; wrap.appendChild(bubble); msgBox.appendChild(wrap);
    });
    msgBox.scrollTop = msgBox.scrollHeight;
  });
}

function closeChat() { 
  if (currentChatUnsubscribe) { currentChatUnsubscribe(); currentChatUnsubscribe = null; } 
  document.getElementById('chatArea').style.display = 'none'; 
  document.getElementById('friendsListArea').style.display = 'flex'; 
  currentChatFriendUid = null; 
}

async function sendChatMessage() {
  const input = document.getElementById('txtChatInput'); 
  const text = input.value.trim(); 
  if (!text || !currentChatFriendUid) return;
  const chatId = getChatId(currentUser.uid, currentChatFriendUid);
  try { 
    await firestore.collection('susuru_anki_chats').doc(chatId).collection('messages').add({ text: text, senderId: currentUser.uid, timestamp: firebase.firestore.FieldValue.serverTimestamp() }); 
    input.value = ''; 
  } catch (e) { alert("⚠️ エラーが発生しました。"); }
}


// ★ 成績保存
// ★【0.03.39】mode：'drill' なら暗記テストの成績として別に記録する（通常のクイズとは混ぜない）
async function recordCategoryScore(catName, isCorrect, mode) {
  const isShared = typeof window.shareStats !== 'undefined' ? window.shareStats : (localStorage.getItem('shareStats') === 'true');
  if(!currentUser || !isShared) return;

  const d = getTodayStr();
  const drill = mode === 'drill';
  const ref = firestore.collection('susuru_anki_category_scores').doc(`${d}_${currentUser.uid}_${drill ? 'drill_' : ''}${catName}`);
  try {
    await ref.set({
      date: d,
      category: catName,
      mode: drill ? 'drill' : 'quiz',
      uid: currentUser.uid,
      name: currentUser.displayName || 'Anonymous',
      score: firebase.firestore.FieldValue.increment(isCorrect ? 1 : 0),
      total: firebase.firestore.FieldValue.increment(1)
    }, { merge: true });
  } catch(e) {}
}

// ★ 成績共有設定のトグル
function toggleShareStats() {
  const chk = document.getElementById('chkShareStats');
  window.shareStats = chk.checked;
  localStorage.setItem('shareStats', window.shareStats);
  alert(window.shareStats ? '✅ 成績共有を有効にしました' : '✅ 成績共有を無効にしました');
}

// ★ フレンド成績比較ページ用
async function loadFriendsForComparison() {
  if (!currentUser) return;
  try {
    const myProfileSnap = await firestore.collection('susuru_anki_profiles').doc(currentUser.uid).get();
    const friends = myProfileSnap.exists ? (myProfileSnap.data().friends || []) : [];
    
    const select = document.getElementById('selCompareFriend');
    select.innerHTML = '<option value="">フレンドを選択...</option>';
    
    const names = await Promise.all(friends.map(friendNameOf));
    friends.forEach((friendUid, i) => {
      const opt = document.createElement('option');
      opt.value = friendUid;
      opt.innerText = names[i];
      select.appendChild(opt);
    });
    
    renderCompareCatBtn();
  } catch(e) {}
}

// ★【0.02.59-g】成績比較: 折れ線グラフ（横軸=日付、縦軸=正答率）
let compareChartInstance = null;

// ★【0.03.62】カテゴリーはフォルダーを選ぶ画面で
function renderCompareCatBtn() {
  const box = document.getElementById('compareCatBtn'); if (!box) return;
  const cur = document.getElementById('selCompareCategory').value;
  box.innerHTML = folderPickButtonHTML(cur, '全カテゴリー', 'pickCompareCategory()');
}
function pickCompareCategory() {
  openFolderPicker({ title: '📁 比べるカテゴリー', current: document.getElementById('selCompareCategory').value, allLabel: '🌐 全カテゴリー',
    hint: '選んだフォルダーの成績だけを比べます', onPick: c => { document.getElementById('selCompareCategory').value = c || ''; renderCompareCatBtn(); renderCompareStats(); } });
}
function setCompareMode(m) {
  document.getElementById('selCompareMode').value = m;
  document.querySelectorAll('[data-cmpmode]').forEach(b => b.classList.toggle('active', b.dataset.cmpmode === m));
  renderCompareStats();
}
async function renderCompareStats() {
  const friendUid = document.getElementById('selCompareFriend').value;
  const category = document.getElementById('selCompareCategory').value;
  const catSet = category ? new Set(getAllSubcategories(category)) : null; // 上のフォルダーを選んだら、中のフォルダーの成績も含める
  const cmpMode = (document.getElementById('selCompareMode') || {}).value || 'quiz'; // ★【0.03.39】通常のクイズ／暗記テスト
  const area = document.getElementById('compareStatsArea');

  if (!friendUid) {
    area.innerHTML = '<div style="text-align:center; color:var(--text3); padding:40px;">フレンドを選択してください</div>';
    return;
  }

  area.innerHTML = '<div style="text-align:center; color:var(--text2);">読み込み中...</div>';

  try {
    const [mySnap, friendSnap] = await Promise.all([
      firestore.collection('susuru_anki_category_scores').where('uid', '==', currentUser.uid).get(),
      firestore.collection('susuru_anki_category_scores').where('uid', '==', friendUid).get()
    ]);

    // date -> { my: rate, friend: rate, friendName } のマップを作る
    const dateMap = {}; // key: date, value: { myScore, myTotal, friendScore, friendTotal, friendName }
    let friendName = 'フレンド';

    const accumulate = (doc, isMe) => {
      const d = doc.data();
      if (d.mode === 'race') return;
      if (catSet && !catSet.has(d.category)) return;
      if ((d.mode === 'drill' ? 'drill' : 'quiz') !== cmpMode) return;
      if (!dateMap[d.date]) dateMap[d.date] = { myScore: 0, myTotal: 0, friendScore: 0, friendTotal: 0, friendName: '?' };
      if (isMe) {
        dateMap[d.date].myScore += (d.score || 0);
        dateMap[d.date].myTotal += (d.total || 0);
      } else {
        dateMap[d.date].friendScore += (d.score || 0);
        dateMap[d.date].friendTotal += (d.total || 0);
        dateMap[d.date].friendName = d.name || 'フレンド';
        friendName = d.name || 'フレンド';
      }
    };

    mySnap.forEach(doc => accumulate(doc, true));
    friendSnap.forEach(doc => accumulate(doc, false));

    const allDates = Object.keys(dateMap).sort();

    area.innerHTML = '';

    if (allDates.length === 0) {
      area.innerHTML = '<div style="text-align:center; color:var(--text3); padding:40px;">成績データがありません</div>';
      return;
    }

    // グラフ用canvasラッパー
    const chartWrap = document.createElement('div');
    chartWrap.style.cssText = 'background:var(--bg3); border:1px solid var(--border); border-radius:12px; padding:16px; margin-bottom:16px;';

    const titleDiv = document.createElement('div');
    titleDiv.style.cssText = 'font-size:0.85rem; color:var(--text2); margin-bottom:10px; text-align:center;';
    titleDiv.innerText = (cmpMode === 'drill' ? '🧠 暗記テスト：' : '') + (category ? `📂 ${category} の正答率推移` : '🌐 全カテゴリー 正答率推移');
    chartWrap.appendChild(titleDiv);

    const canvas = document.createElement('canvas');
    canvas.id = 'compareLineChart';
    canvas.style.cssText = 'width:100%; max-height:260px;';
    chartWrap.appendChild(canvas);
    area.appendChild(chartWrap);

    const myRates = allDates.map(d => {
      const e = dateMap[d];
      return e.myTotal > 0 ? parseFloat((e.myScore / e.myTotal * 100).toFixed(1)) : null;
    });
    const friendRates = allDates.map(d => {
      const e = dateMap[d];
      return e.friendTotal > 0 ? parseFloat((e.friendScore / e.friendTotal * 100).toFixed(1)) : null;
    });

    // 日付ラベルを MM/DD 形式に
    const labels = allDates.map(d => d.slice(5));

    if (compareChartInstance) compareChartInstance.destroy();
    const isDark = !document.body.classList.contains('light-mode');
    Chart.defaults.color = isDark ? '#e8edf5' : '#4b5563';

    compareChartInstance = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'あなた',
            data: myRates,
            borderColor: '#4f7cff',
            backgroundColor: 'rgba(79,124,255,0.08)',
            tension: 0.3,
            pointRadius: 4,
            spanGaps: true
          },
          {
            label: friendName,
            data: friendRates,
            borderColor: '#f5a623',
            backgroundColor: 'rgba(245,166,35,0.08)',
            tension: 0.3,
            pointRadius: 4,
            spanGaps: true
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'top', labels: { font: { size: 12 } } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y ?? '-'}%` } }
        },
        scales: {
          x: { ticks: { font: { size: 11 } } },
          y: { min: 0, max: 100, ticks: { callback: v => v + '%', font: { size: 11 } } }
        }
      }
    });

    // 日付別データ一覧（テキスト補足）
    const tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'margin-top:8px; max-height:260px; overflow-y:auto;';
    [...allDates].reverse().forEach(d => {
      const e = dateMap[d];
      const myR = e.myTotal > 0 ? (e.myScore / e.myTotal * 100).toFixed(1) : '-';
      const frR = e.friendTotal > 0 ? (e.friendScore / e.friendTotal * 100).toFixed(1) : '-';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; justify-content:space-between; padding:8px 4px; border-bottom:1px solid var(--border); font-size:0.82rem;';
      row.innerHTML = `<span style="color:var(--text3);">${d}</span><span style="color:#4f7cff;">あなた: ${myR}%</span><span style="color:#f5a623;">${escapeHtml(e.friendName || friendName)}: ${frR}%</span>`;
      tableWrap.appendChild(row);
    });
    area.appendChild(tableWrap);

  } catch(e) {
    console.error(e);
    area.innerHTML = '<div style="color:var(--danger);">成績データの読み込みに失敗しました</div>';
  }
}

// ====== ⚔️ オンライン対戦機能 → match.js ======
