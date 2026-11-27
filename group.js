// ================================================================
// ★【0.04.20】👪 グループ
// ・フレンドを招待して作る（名前は自由。招待された人は参加・ことわるを選べる）
// ・グループで共有したカテゴリーは、メンバーなら誰でも編集できる（Firestore のルールでグループのメンバーかを確かめる）
//   共有リンクをメンバー以外が開いたときは、ふつうの共有カテゴリーと同じく見るだけ（内容の変更は届く）
// ・カレンダーの予定もグループで共有できる（グループの文書の events に入れる）
// グループの文書：susuru_anki_groups/{id} = { name, owner, members:[uid], invited:[uid], invitedBy:{uid:名前},
//   names:{uid:名前}, cats:[{ id, name, by }], events:{ id: 予定 }, createdAt, updatedAt }
// ================================================================
const GROUP_COL = 'susuru_anki_groups';
const GROUP_CACHE_KEY = 'susuru_anki_groups_cache';
let myGroups = (() => { try { return JSON.parse(localStorage.getItem(GROUP_CACHE_KEY) || '[]') || []; } catch (e) { return []; } })();
let groupInvites = [];
let _groupUnsubs = [];

function groupMyName() { return (currentUser && (currentUser.displayName || currentUser.email)) || '名無し'; }
function groupById(id) { return myGroups.find(g => g.id === id) || null; }
function groupIsMember(g) { return !!(g && currentUser && (g.members || []).includes(currentUser.uid)); }
function groupNameOf(id) { const g = groupById(id); return g ? g.name : 'グループ'; }

// ログインしたら、自分のグループと招待を見張る
function startGroupWatch() {
  _groupUnsubs.forEach(u => { try { u(); } catch (e) {} }); _groupUnsubs = [];
  groupInvites = [];
  if (typeof currentUser === 'undefined' || !currentUser) { renderGroupCard(); return; }
  const col = firestore.collection(GROUP_COL);
  _groupUnsubs.push(col.where('members', 'array-contains', currentUser.uid).onSnapshot(snap => {
    myGroups = snap.docs.map(d => Object.assign({ id: d.id }, d.data())).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    try { localStorage.setItem(GROUP_CACHE_KEY, JSON.stringify(myGroups)); } catch (e) {}
    groupApplyEditRights();
    if (typeof planSyncGroupPlans === 'function') { try { planSyncGroupPlans(); } catch (e) { console.warn(e); } } // ★【0.04.39】グループの週間プラン
    renderGroupCard();
    groupRefreshOpenSheet();
    if (typeof calOnGroupsChanged === 'function') calOnGroupsChanged();
  }, e => console.warn('グループの読み込みに失敗:', e.message)));
  _groupUnsubs.push(col.where('invited', 'array-contains', currentUser.uid).onSnapshot(snap => {
    groupInvites = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    groupInvites.forEach(g => { if (typeof friendNotify === 'function') friendNotify('👪 グループへの招待', `${(g.invitedBy || {})[currentUser.uid] || 'フレンド'} さんから「${g.name}」に招待されました`, 'grp:' + g.id); });
    renderGroupCard();
    if (typeof renderFriendRequests === 'function') renderFriendRequests();
  }, e => console.warn('グループの招待の読み込みに失敗:', e.message)));
}

// グループで共有しているカテゴリーは、メンバーなら編集できる
function groupApplyEditRights() {
  if (typeof sharedDocPermissions === 'undefined') return;
  myGroups.forEach(g => (g.cats || []).forEach(c => {
    const p = sharedDocPermissions[c.id];
    if (p && !p.canEdit) sharedDocPermissions[c.id] = Object.assign({}, p, { canEdit: true });
  }));
}
// 共有カテゴリーの文書を、自分が編集できるか（グループの分）
// ★【0.04.65】いくつかのグループで共有できる（groupIds。前の版の文書は groupId だけ）
function groupIdsOf(data) { return data ? (Array.isArray(data.groupIds) ? data.groupIds.filter(Boolean) : (data.groupId ? [data.groupId] : [])) : []; }
function groupMyEditGroup(data) { return groupIdsOf(data).find(g => groupIsMember(groupById(g))) || ''; }
function groupCanEditShared(data) {
  if (!data || !currentUser) return false;
  return !!groupMyEditGroup(data);
}
// 共有カテゴリーを書きかえるときに付けるもの：作成者・フレンドでなく、グループのメンバーとして直すときは、
//  どのグループのメンバーとしてか（editGroup）。前の版のルールで直せる groupId のグループのメンバーなら付けない
function sharedEditExtra(data) {
  if (!data || !currentUser || data.ownerId === currentUser.uid || (data.friends || []).includes(currentUser.uid)) return {};
  if (data.groupId && groupIsMember(groupById(data.groupId))) return {};
  const g = groupMyEditGroup(data);
  return g ? { editGroup: g } : {};
}

// ---------------- 画面（フレンドの画面のカード） ----------------
function renderGroupCard() {
  const box = document.getElementById('groupBox'); if (!box) return;
  if (typeof currentUser === 'undefined' || !currentUser) { box.innerHTML = '<div class="hint-small">ログインすると、グループを作れます。</div>'; return; }
  const inv = groupInvites.map(g => `<div class="group-row group-invite"><div style="min-width:0;"><b>📨 ${escapeHtml(g.name)}</b><div class="hint-small">${escapeHtml((g.invitedBy || {})[currentUser.uid] || 'フレンド')} さんからの招待・${(g.members || []).length}人</div></div>
      <div style="display:flex; gap:6px; flex-shrink:0;"><button class="chip" onclick="groupAccept(${jsArg(g.id)})">参加する</button><button class="chip" onclick="groupDecline(${jsArg(g.id)})">ことわる</button></div></div>`).join('');
  const list = myGroups.map(g => `<div class="group-row" onclick="groupOpen(${jsArg(g.id)})"><div style="min-width:0;"><b>👪 ${escapeHtml(g.name)}</b><div class="hint-small">${(g.members || []).length}人${(g.invited || []).length ? `・招待中 ${(g.invited || []).length}人` : ''}・📂 ${(g.cats || []).length}・📅 ${Object.values(g.events || {}).filter(e => e && !e.deleted).length}</div></div><span class="hint-small">開く ›</span></div>`).join('');
  box.innerHTML = inv + (list || (inv ? '' : '<div class="hint-small">まだグループはありません。フレンドを招待してグループを作ると、カテゴリーや予定をグループの中だけで共有できます。</div>')) +
    `<button class="btn btn-secondary" style="margin-top:8px;" onclick="groupCreate()">＋ グループを作る</button>`;
}

async function groupCreate() {
  if (!currentUser) return alert('ログインしてください。');
  const name = (prompt('グループの名前（あとで変えられます）', '') || '').trim();
  if (!name) return;
  try {
    const ref = await firestore.collection(GROUP_COL).add({ name: name.slice(0, 40), owner: currentUser.uid, members: [currentUser.uid], invited: [], invitedBy: {},
      names: { [currentUser.uid]: groupMyName() }, cats: [], events: {}, createdAt: Date.now(), updatedAt: Date.now() });
    myGroups.push({ id: ref.id, name, owner: currentUser.uid, members: [currentUser.uid], invited: [], names: { [currentUser.uid]: groupMyName() }, cats: [], events: {} });
    renderGroupCard();
    groupOpen(ref.id);
    groupInvitePick(ref.id);
  } catch (e) { alert('⚠️ グループを作れませんでした: ' + (e.code || e.message) + '\n（Firestore のルールが新しくなっていないかもしれません）'); }
}
async function groupAccept(id) {
  const g = groupInvites.find(x => x.id === id); if (!g) return;
  try {
    await firestore.collection(GROUP_COL).doc(id).update({
      members: firebase.firestore.FieldValue.arrayUnion(currentUser.uid), invited: firebase.firestore.FieldValue.arrayRemove(currentUser.uid),
      ['names.' + currentUser.uid]: groupMyName(), updatedAt: Date.now() });
    alert(`👪 「${g.name}」に参加しました。グループのカテゴリーは、グループの画面から取り込めます。`);
    groupOpen(id);
  } catch (e) { alert('⚠️ 参加できませんでした: ' + (e.code || e.message)); }
}
async function groupDecline(id) {
  const g = groupInvites.find(x => x.id === id); if (!g) return;
  if (!confirm(`「${g.name}」への招待をことわりますか？`)) return;
  try { await firestore.collection(GROUP_COL).doc(id).update({ invited: firebase.firestore.FieldValue.arrayRemove(currentUser.uid), updatedAt: Date.now() }); }
  catch (e) { alert('⚠️ ことわれませんでした: ' + (e.code || e.message)); }
}

// ---------------- グループの画面（下から出る） ----------------
let _groupOpenId = null;
function groupSheet(html) {
  let ov = document.getElementById('groupOverlay');
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'groupOverlay'; ov.className = 'ctx-overlay'; ov.style.zIndex = '1050';
    ov.onclick = () => groupClose();
    document.body.appendChild(ov);
  }
  ov.innerHTML = `<div class="menu-card editor-card group-sheet" onclick="event.stopPropagation()">${html}</div>`;
  ov.style.display = 'flex';
}
function groupClose() { _groupOpenId = null; const ov = document.getElementById('groupOverlay'); if (ov) ov.style.display = 'none'; }
function groupRefreshOpenSheet() { if (_groupOpenId) { const ov = document.getElementById('groupOverlay'); if (ov && ov.style.display === 'flex' && !ov.querySelector('.group-pick')) groupOpen(_groupOpenId); } }
function groupOpen(id) {
  const g = groupById(id); if (!g) return;
  _groupOpenId = id;
  const me = currentUser.uid, owner = g.owner === me, names = g.names || {};
  const subscribed = new Set(typeof knownSharedDocIds === 'function' ? knownSharedDocIds() : []);
  const members = (g.members || []).map(u => `<div class="group-mem"><span>${u === g.owner ? '👑 ' : ''}${escapeHtml(names[u] || '名無し')}${u === me ? '（あなた）' : ''}</span>${owner && u !== me ? `<button class="chip" onclick="groupKick(${jsArg(id)}, ${jsArg(u)})">外す</button>` : ''}</div>`).join('');
  const invited = (g.invited || []).length ? `<div class="hint-small" style="margin-top:4px;">📨 招待中：${(g.invited || []).map(u => escapeHtml((g.invitedNames || {})[u] || names[u] || '…')).join('、')} <button class="chip" onclick="groupCancelInvites(${jsArg(id)})">取り消す</button></div>` : '';
  const cats = (g.cats || []).map(c => {
    const have = subscribed.has(c.id);
    return `<div class="group-cat"><div style="min-width:0;"><b>📂 ${escapeHtml(c.name)}</b><div class="hint-small">${escapeHtml(names[c.by] || '')} さんが共有・メンバーは編集できます</div></div>
      <div style="display:flex; gap:4px; flex-shrink:0; flex-wrap:wrap; justify-content:flex-end;">
        ${have ? `<button class="chip" onclick="groupClose(); openPage('pgShared'); listenToSharedDoc(${jsArg(c.id)})">✅ 開く</button>` : `<button class="chip" onclick="groupImportCat(${jsArg(id)}, ${jsArg(c.id)})">📥 取り込む</button>`}
        <button class="chip" onclick="groupCopyCatLink(${jsArg(c.id)})">🔗</button>
        ${c.by === me ? `<button class="chip" onclick="groupUnshareCat(${jsArg(id)}, ${jsArg(c.id)})">やめる</button>` : ''}</div></div>`;
  }).join('') || '<div class="hint-small">まだありません。</div>';
  const evs = typeof calGroupEventsText === 'function' ? calGroupEventsText(g) : '';
  groupSheet(`<div class="cat-edit-title">👪 ${escapeHtml(g.name)} <button class="chip" onclick="groupRename(${jsArg(id)})">✏️ 名前</button></div>
    <div class="section-label" style="margin-top:8px;">👥 メンバー（${(g.members || []).length}人）</div>${members}${invited}
    <button class="btn btn-secondary" style="margin-top:6px;" onclick="groupInvitePick(${jsArg(id)})">＋ フレンドを招待</button>
    <div class="section-label" style="margin-top:12px;">📂 グループのカテゴリー</div>
    <div class="hint-small" style="margin-bottom:4px;">メンバーは誰でも編集できます。🔗 のリンクをメンバー以外が開くと、見るだけ（内容の変更は届きます）。</div>
    ${cats}
    <button class="btn btn-secondary" style="margin-top:6px;" onclick="groupShareCatPick(${jsArg(id)})">＋ 自分のフォルダーを共有</button>
    <div class="section-label" style="margin-top:12px;">📚 グループの週間プラン</div>${groupPlansHTML(g)}
    <button class="btn btn-secondary" style="margin-top:6px;" onclick="groupClose(); openPage('pgDrill'); setTimeout(() => { const d = document.querySelector('#drillPlanWrap details'); if (d) d.open = true; planEdit('new', ${jsArg(id)}); const el = document.getElementById('planSettings'); if (el) el.scrollIntoView({ block: 'start' }); }, 300)">＋ グループの週間プランを作る</button>
    <div class="section-label" style="margin-top:12px;">📅 グループの予定</div>${evs || '<div class="hint-small">まだありません。</div>'}
    <button class="btn btn-secondary" style="margin-top:6px;" onclick="groupClose(); openCalendar(); calNewEvent(null, ${jsArg(id)})">＋ グループの予定を追加</button>
    <div style="display:flex; gap:8px; margin-top:14px;">
      <button class="btn btn-secondary" onclick="groupClose()">閉じる</button>
      ${owner ? `<button class="btn btn-danger" onclick="groupDelete(${jsArg(id)})">グループを削除</button>` : `<button class="btn btn-danger" onclick="groupLeave(${jsArg(id)})">抜ける</button>`}</div>`);
}

async function groupRename(id) {
  const g = groupById(id); if (!g) return;
  const name = (prompt('グループの名前', g.name) || '').trim();
  if (!name || name === g.name) return;
  try { await firestore.collection(GROUP_COL).doc(id).update({ name: name.slice(0, 40), updatedAt: Date.now() }); }
  catch (e) { alert('⚠️ 名前を変えられませんでした: ' + (e.code || e.message)); }
}
// フレンドを選んで招待する
async function groupInvitePick(id) {
  const g = groupById(id); if (!g) return;
  let friends = [];
  try { friends = (await myFriendList()).filter(u => !(g.members || []).includes(u) && !(g.invited || []).includes(u)); } catch (e) {}
  if (!friends.length) return alert('招待できるフレンドがいません（フレンドの画面からフレンドを追加してください）。');
  const names = await Promise.all(friends.map(u => friendNameOf(u).catch(() => '名無し')));
  groupSheet(`<div class="group-pick"><div class="cat-edit-title">📨 「${escapeHtml(g.name)}」に招待</div>
    <div class="hint-small" style="margin:6px 0;">招待したフレンドは、参加するか、ことわるかを選べます</div>
    ${friends.map((u, i) => `<label class="bulkdel-row"><input type="checkbox" class="grpInv" value="${escAttr(u)}" data-name="${escAttr(names[i])}"><div>${escapeHtml(names[i])}</div></label>`).join('')}
    <div style="display:flex; gap:8px; margin-top:10px;"><button class="btn btn-secondary" onclick="groupOpen(${jsArg(id)})">戻る</button><button class="btn btn-primary" onclick="groupSendInvites(${jsArg(id)})">招待する</button></div></div>`);
}
async function groupSendInvites(id) {
  const picked = [...document.querySelectorAll('.grpInv:checked')].map(x => ({ uid: x.value, name: x.dataset.name }));
  if (!picked.length) return groupOpen(id);
  const up = { invited: firebase.firestore.FieldValue.arrayUnion(...picked.map(p => p.uid)), updatedAt: Date.now() };
  picked.forEach(p => { up['invitedBy.' + p.uid] = groupMyName(); up['invitedNames.' + p.uid] = p.name; });
  try { await firestore.collection(GROUP_COL).doc(id).update(up); alert(`📨 ${picked.map(p => p.name).join('、')} さんを招待しました。`); }
  catch (e) { alert('⚠️ 招待できませんでした: ' + (e.code || e.message)); }
  groupOpen(id);
}
async function groupCancelInvites(id) {
  if (!confirm('まだ参加していない人への招待を、すべて取り消しますか？')) return;
  try { await firestore.collection(GROUP_COL).doc(id).update({ invited: [], updatedAt: Date.now() }); } catch (e) { alert('⚠️ ' + (e.code || e.message)); }
}
async function groupKick(id, uid) {
  const g = groupById(id); if (!g) return;
  if (!confirm(`${(g.names || {})[uid] || 'この人'} さんをグループから外しますか？`)) return;
  try { await firestore.collection(GROUP_COL).doc(id).update({ members: firebase.firestore.FieldValue.arrayRemove(uid), updatedAt: Date.now() }); }
  catch (e) { alert('⚠️ ' + (e.code || e.message)); }
}
async function groupLeave(id) {
  const g = groupById(id); if (!g) return;
  if (!confirm(`「${g.name}」から抜けますか？（取り込んだカテゴリーは手元に残りますが、編集はできなくなります）`)) return;
  try { await firestore.collection(GROUP_COL).doc(id).update({ members: firebase.firestore.FieldValue.arrayRemove(currentUser.uid), updatedAt: Date.now() }); groupClose(); }
  catch (e) { alert('⚠️ 抜けられませんでした: ' + (e.code || e.message)); }
}
async function groupDelete(id) {
  const g = groupById(id); if (!g) return;
  if (!confirm(`「${g.name}」を削除しますか？（グループの予定も消えます。共有したカテゴリーは、それぞれの人の手元に残ります）`)) return;
  try {
    await firestore.collection(GROUP_COL).doc(id).delete();
    myGroups = myGroups.filter(x => x.id !== id); renderGroupCard(); groupClose();
  } catch (e) { alert('⚠️ 削除できませんでした: ' + (e.code || e.message)); }
}

// ---------------- グループのカテゴリー ----------------
function groupShareCatPick(id) {
  openFolderPicker({ title: '📂 グループで共有するフォルダー', current: '', hint: 'フォルダーの中のカードを、グループのメンバーが編集できるようにします',
    selectable: c => c !== '未分類', onPick: c => { if (c) groupShareCategory(id, c); } });
}
async function groupShareCategory(id, catName) {
  const g = groupById(id); if (!g) return;
  const info = getCategoryShareInfo(catName);
  let docId = null;
  try {
    if (info.shared) {
      // ★【0.04.65】もう共有しているフォルダー：自分が作ったもの、またはグループで共有されていて自分が直せるものなら、このグループでも共有する
      docId = info.docId;
      const snap = await firestore.collection('susuru_anki_shared').doc(docId).get();
      if (!snap.exists) return alert('⚠️ この共有カテゴリーは削除されています。');
      const data = snap.data(), cur = groupIdsOf(data);
      if (info.root !== catName) return alert(`このフォルダーは、共有カテゴリー「${data.catName}」の中にあります。グループで共有するときは「${data.catName}」を選んでください。`);
      if (cur.includes(id)) return alert(`「${catName}」は、もう「${g.name}」で共有しています。`);
      const owner = data.ownerId === currentUser.uid, via = groupMyEditGroup(data);
      if (!owner && !via) return alert('このフォルダーは、ほかの人の共有カテゴリーです。作った人か、共有しているグループのメンバーなら、ほかのグループでも共有できます。');
      const next = [...cur, id];
      if (owner) await firestore.collection('susuru_anki_shared').doc(docId).update({ groupIds: next, groupId: data.groupId || id, groupName: data.groupName || g.name, updatedAt: Date.now() });
      else await firestore.collection('susuru_anki_shared').doc(docId).update({ groupIds: next, addGroup: id, editGroup: via, updatedAt: Date.now() });
    } else {
      docId = await shareCategory(catName, { groupId: id, groupName: g.name, quiet: true });
      if (!docId) return;
    }
    await firestore.collection(GROUP_COL).doc(id).update({ cats: firebase.firestore.FieldValue.arrayUnion({ id: docId, name: catName, by: currentUser.uid }), updatedAt: Date.now() });
    alert(`📂 「${catName}」を「${g.name}」で共有しました。メンバーは、グループの画面から取り込んで編集できます。`);
  } catch (e) { alert('⚠️ 共有できませんでした: ' + (e.code || e.message)); }
}
async function groupImportCat(gid, docId) {
  try {
    const snap = await firestore.collection('susuru_anki_shared').doc(docId).get();
    if (!snap.exists) return alert('⚠️ このカテゴリーは削除されています。');
    const data = snap.data();
    const n = subscribeToSharedData(docId, data);
    sharedDocPermissions[docId] = { canEdit: true, isOwner: data.ownerId === currentUser.uid };
    saveData(true);
    if (typeof syncSubscriptions === 'function') syncSubscriptions();
    if (typeof renderTree === 'function') try { renderTree(); } catch (e) {}
    alert(`📥 「${data.catName}」を取り込みました（${n}枚）。カードを直すと、グループのみんなに届きます。`);
    groupOpen(gid);
  } catch (e) { alert('⚠️ 取り込めませんでした: ' + (e.code || e.message)); }
}
async function groupCopyCatLink(docId) {
  const url = location.origin + location.pathname + '?share_id=' + docId;
  try { await navigator.clipboard.writeText(url); alert('🔗 リンクをコピーしました。\n' + url + '\n\nグループのメンバー以外が開くと、見るだけになります（内容の変更は届きます）。'); }
  catch (e) { prompt('このリンクをコピーしてください', url); }
}
async function groupUnshareCat(gid, docId) {
  const g = groupById(gid); if (!g) return;
  const c = (g.cats || []).find(x => x.id === docId); if (!c) return;
  if (!confirm(`「${c.name}」の「${g.name}」での共有をやめますか？（このグループのメンバーの手元には残りますが、編集できなくなります。ほかのグループでの共有はそのまま）`)) return;
  try {
    await firestore.collection(GROUP_COL).doc(gid).update({ cats: (g.cats || []).filter(x => x.id !== docId), updatedAt: Date.now() });
    // ★【0.04.65】このグループだけ外す（ほかのグループでの共有は残す）
    const sn = await firestore.collection('susuru_anki_shared').doc(docId).get().catch(() => null);
    if (sn && sn.exists) {
      const data = sn.data(), rest = groupIdsOf(data).filter(x => x !== gid);
      const gidNext = data.groupId === gid ? (rest[0] || '') : (data.groupId || '');
      const upd = { groupIds: rest, groupId: gidNext, groupName: gidNext ? (gidNext === data.groupId ? data.groupName || '' : groupNameOf(gidNext)) : '', updatedAt: Date.now() };
      if (data.ownerId !== currentUser.uid) upd.removeGroup = gid;
      await firestore.collection('susuru_anki_shared').doc(docId).update(upd).catch(e => console.warn(e));
    }
  } catch (e) { alert('⚠️ ' + (e.code || e.message)); }
}

// ★【0.04.39】グループの週間プランの一覧（グループの画面）
function groupPlansHTML(g) {
  const list = Object.entries(g.plans || {}).filter(([, p]) => p && !p.deleted);
  if (!list.length) return '<div class="hint-small">まだありません。</div>';
  const P = typeof studyPlan !== 'undefined' ? (normalizeStudyPlans(studyPlan).plans || {}) : {};
  return list.map(([pid, p]) => {
    const mine = P[typeof planGroupId === 'function' ? planGroupId(g.id, pid) : ''];
    const st = !p.root || !categories.includes(p.root) ? '📥 単語帳のフォルダーを取り込むと使えます' : mine && mine.optOut ? '🙈 自分はやめています' : '✅ 使っています';
    return `<div class="group-cat"><div style="min-width:0;"><b>📚 ${escapeHtml(p.root || '')}</b><div class="hint-small">${escapeHtml(p.byName || '')}${p.byName ? ' さんが作成・' : ''}単語は${PLAN_DAYS[p.wordsFrom ?? 2]}曜から（${escapeHtml(typeof planDueText === 'function' ? planDueText(p) : '')}）・${st}</div></div></div>`;
  }).join('');
}
