// ----------------- 共有・ライブ同期カテゴリー -----------------
let currentSharedDocId = null, currentSharedData = null, unsubscribeShared = null;

// ★ フレンドの表示名キャッシュ＆読み込みフラグ
let sharedFriendsLoaded = false;
let friendNameCache = {}; // { UID: "表示名" }

// ================================================================
// ★【0.03.02】共有・公開カテゴリーの権限判定を一か所にまとめる
// ・ownedDocs（自分が作った）を最優先で「編集可」とみなす（起動直後で権限を取得する前でも編集できるように）
// ・購読も所有もしていない docId（＝公開を停止・削除済み）は「共有ではない」として扱う
// ================================================================
function getSharedAccess(docId) {
  if (!docId) return { shared: false, canEdit: true, isOwner: false, readOnly: false };
  const perm = sharedDocPermissions[docId];
  const isOwner = ownedDocs.includes(docId) || !!(perm && perm.isOwner);
  const known = isOwner || subscribedDocs.includes(docId);
  if (!known) return { shared: false, stale: true, canEdit: true, isOwner: false, readOnly: false };
  const canEdit = isOwner || !!(perm && perm.canEdit);
  return { shared: true, docId, canEdit, isOwner, readOnly: !canEdit };
}
// ★【0.03.02】共有ドキュメントごとの「一番上のフォルダー名・含まれるフォルダー・前回見たカードID」をこの端末に覚えておく
// （空のフォルダーでも共有かどうか判定するため／他の編集者が削除したカードを見分けるため）
const SHARED_META_KEY = 'susuru_anki_shared_meta';
let sharedMeta = (() => { try { return JSON.parse(localStorage.getItem(SHARED_META_KEY) || '{}') || {}; } catch (e) { return {}; } })();
function saveSharedMeta() { try { localStorage.setItem(SHARED_META_KEY, JSON.stringify(sharedMeta)); } catch (e) {} }
function setSharedMeta(docId, root, cats, ids) {
  if (!docId) return;
  const m = sharedMeta[docId] || {};
  if (root) m.root = root;
  if (cats) m.cats = [...new Set(cats)];
  if (ids) m.ids = [...new Set(ids)];
  sharedMeta[docId] = m; saveSharedMeta();
}
// フォルダー名の変更を、共有ドキュメントの記録にも反映する
function renameInSharedMeta(oldName, newName) {
  let changed = false;
  Object.values(sharedMeta).forEach(m => {
    if (m.root === oldName) { m.root = newName; changed = true; }
    if (Array.isArray(m.cats) && m.cats.includes(oldName)) { m.cats = m.cats.map(c => c === oldName ? newName : c); changed = true; }
  });
  if (changed) saveSharedMeta();
}
function isSharedDocRoot(catName) {
  return Object.keys(sharedMeta).some(id => sharedMeta[id].root === catName && getSharedAccess(id).shared);
}
function knownSharedDocIds() { return [...new Set([...(subscribedDocs || []), ...(ownedDocs || [])])]; }

// フォルダー（またはその上位のフォルダー）が属している共有ドキュメントを探す
function getCategoryShareInfo(catName) {
  const docForCat = (c) => {
    const byMeta = knownSharedDocIds().find(id => (sharedMeta[id] && (sharedMeta[id].root === c || (sharedMeta[id].cats || []).includes(c))));
    if (byMeta) return byMeta;
    const card = db.find(q => q.category === c && q.sharedDocId && getSharedAccess(q.sharedDocId).shared);
    return card ? card.sharedDocId : null;
  };
  let docId = docForCat(catName);
  // 上位フォルダーをたどる（空のサブフォルダーでも判定できるように）
  let cur = catName, guard = 0;
  while (!docId && guard++ < 100) {
    let parent = null;
    for (const p in categoryTree) { if ((categoryTree[p] || []).includes(cur)) { parent = p; break; } }
    if (!parent) break;
    docId = docForCat(parent);
    cur = parent;
  }
  if (!docId) return { shared: false, canEdit: true, isOwner: false, readOnly: false, docId: null };
  const acc = getSharedAccess(docId);
  if (!acc.shared) return { shared: false, canEdit: true, isOwner: false, readOnly: false, docId: null };
  return { ...acc, root: (sharedMeta[docId] && sharedMeta[docId].root) || null };
}

// 共有ドキュメントの印を外して、手元の普通のカードに戻す（公開の停止・削除、ドキュメント消失時）
function detachSharedDoc(docId) {
  db.forEach(q => { if (q.sharedDocId === docId) { delete q.sharedDocId; touchCard(q); } });
  subscribedDocs = subscribedDocs.filter(id => id !== docId);
  ownedDocs = ownedDocs.filter(id => id !== docId);
  delete sharedDocPermissions[docId];
  markDocLeft(docId);
  delete sharedMeta[docId]; saveSharedMeta();
}

// 共有ドキュメントに保存するカードの形（成績は含めない）
function toSharedCard(card) {
  const o = { id: card.id, question: card.question, answer: card.answer, category: card.category, updatedAt: card.updatedAt || Date.now() };
  ['note', 'questionImage', 'answerImage', 'choices', 'kind', 'no'].forEach(f => { if (card[f] !== undefined && card[f] !== null && card[f] !== '') o[f] = card[f]; });
  return o;
}
const SHARED_CONTENT_FIELDS = ['question', 'answer', 'category', 'questionImage', 'answerImage', 'choices', 'kind', 'no'];
function sharedCardDiffers(lq, cq) {
  return SHARED_CONTENT_FIELDS.some(f => !(f === 'no' && cq.no === undefined) && JSON.stringify(lq[f] === undefined ? null : lq[f]) !== JSON.stringify(cq[f] === undefined ? null : cq[f]));
}

// ★ 定期同期＆起動時同期ロジック
async function syncSubscriptions() {
  if (!currentUser) return;
  if (!subscribedDocs || subscribedDocs.length === 0) return;
  
  let changed = false;
  const needPush = [];
  for (let docId of [...subscribedDocs]) {
    try {
      const snap = await firestore.collection("susuru_anki_shared").doc(docId).get();
      if (!snap.exists) {
        // ★【0.03.02】公開が停止・削除されたドキュメント：手元のカードは普通のカードとして残す
        detachSharedDoc(docId); changed = true; continue;
      }
      const data = snap.data();
      const isOwner = (data.ownerId === currentUser.uid);
      const canEdit = isOwner || (data.friends && data.friends.includes(currentUser.uid));
      sharedDocPermissions[docId] = { canEdit, isOwner };
      if (isOwner && !ownedDocs.includes(docId)) { ownedDocs.push(docId); changed = true; }
      
      const cloudCards = data.cards || [];
      const cloudCardIds = new Set(cloudCards.map(c => c.id));
      const prevMeta = sharedMeta[docId] || {};
      const seenBefore = new Set(prevMeta.ids || []);
      let localWins = false;
      
      // 1. クラウドから削除されたカードをローカルからも消す
      //    編集できる人：前回クラウドにあったのに今は無い＝他の人が削除した → 消す／一度もクラウドに無い＝手元で追加した → 書き戻す
      const missing = db.filter(q => q.sharedDocId === docId && !cloudCardIds.has(q.id));
      const removed = canEdit ? missing.filter(q => seenBefore.has(q.id)) : missing;
      if (removed.length > 0) {
        const ids = new Set(removed.map(q => q.id));
        tombstoneCards([...ids]);
        db = db.filter(q => !ids.has(q.id));
        changed = true;
      }
      if (canEdit && missing.length > removed.length) localWins = true;
      
      // 2. クラウドの更新をローカルに反映・新規追加
      cloudCards.forEach(cq => {
        if (!cq || !cq.id || !cq.question || !cq.answer) return;
        if (deletedCards.includes(cq.id)) { if (canEdit) localWins = true; return; } // 自分で削除したカードは復活させない
        let lq = db.find(q => q.id === cq.id);
        if (lq) {
          if (sharedCardDiffers(lq, cq)) {
            // 編集できる人：手元の方が新しければ手元を優先（作成者は同時刻なら手元を優先）
            const lu = lq.updatedAt || 0, cu = cq.updatedAt || 0;
            const preferLocal = canEdit && (lu > cu || (isOwner && lu === cu));
            if (preferLocal) { localWins = true; }
            else {
              SHARED_CONTENT_FIELDS.forEach(f => { if (cq[f] !== undefined) lq[f] = cq[f]; else if (f !== 'no') delete lq[f]; });
              touchCard(lq); changed = true;
            }
          }
          if (lq.sharedDocId !== docId) { lq.sharedDocId = docId; touchCard(lq); changed = true; }
        } else {
          const newLocalCard = { id: cq.id, question: cq.question, answer: cq.answer, category: cq.category, sharedDocId: docId, level: 0, correct: 0, incorrect: 0, streak: 0, wrongStreak: 0, shikkariStreak: 0 };
          ['note', 'questionImage', 'answerImage', 'choices', 'kind', 'no'].forEach(f => { if (cq[f] !== undefined) newLocalCard[f] = cq[f]; });
          touchCard(newLocalCard);
          db.push(newLocalCard);
          changed = true;
        }
      });
      
      // 3. カテゴリー構造の同期（自分で削除したフォルダーは復活させない）
      const isDead = c => deletedCats.includes(c);
      (data.categories || []).forEach(c => { if (!isDead(c) && !categories.includes(c)) { categories.push(c); changed = true; } });
      const tree = data.categoryTree || {};
      for (let p in tree) {
        if (isDead(p)) continue;
        (tree[p] || []).forEach(c => {
          if (isDead(c)) return;
          const placed = Object.keys(categoryTree).some(k => (categoryTree[k] || []).includes(c));
          if (placed && canEdit) return; // 編集できる人の手元の配置は動かさない
          if (!placed || !(categoryTree[p] || []).includes(c)) {
            for (const k in categoryTree) categoryTree[k] = (categoryTree[k] || []).filter(x => x !== c);
            if (!categoryTree[p]) categoryTree[p] = [];
            categoryTree[p].push(c); changed = true;
          }
        });
      }
      // 3'. 閲覧専用：共有ドキュメントから無くなった空のフォルダー（作成者が名前を変えた・消した）を片付ける
      if (!canEdit && Array.isArray(prevMeta.cats)) {
        const nowCats = new Set(data.categories || []);
        const gone = prevMeta.cats.filter(c => !nowCats.has(c) && categories.includes(c) && !db.some(q => q.category === c) && !(categoryTree[c] || []).length);
        if (gone.length) {
          markCatsDeleted(gone);
          categories = categories.filter(c => !gone.includes(c));
          for (const k in categoryTree) categoryTree[k] = (categoryTree[k] || []).filter(c => !gone.includes(c));
          gone.forEach(c => delete categoryTree[c]);
          changed = true;
        }
      }
      setSharedMeta(docId, data.catName, data.categories || [], [...cloudCardIds]);
      if (localWins) needPush.push(docId);
      // ★【0.03.15】作成者：以前からの共有コードを、コードで探せる対応表に登録しておく
      if (isOwner && data.shareCode && !registeredShareCodeDocs().includes(docId)) ensureShareCode(docId).catch(e => console.warn('共有コードの登録に失敗:', e));
    } catch (e) { console.warn("Sync error for doc:", docId, e); }
  }
  
  if (changed) {
    autoMerge();
    if (document.getElementById('pgBox').classList.contains('active')) renderBox();
    if (document.getElementById('pgTree').classList.contains('active')) renderTree();
  }
  for (const docId of needPush) await pushSharedDocFromLocal(docId);
}

// ★【0.03.02】手元の内容（カード・フォルダー構造）を共有ドキュメントへ書き戻す（作成者・共同編集者のみ）
// フォルダー名の変更・統合・移動・削除のあとに呼ぶ。以前はこれが無く、次回起動時に元の状態へ戻ってしまっていた
async function pushSharedDocFromLocal(docId) {
  if (!currentUser || !docId) return;
  if (!getSharedAccess(docId).canEdit) return;
  try {
    const ref = firestore.collection('susuru_anki_shared').doc(docId);
    const snap = await ref.get();
    if (!snap.exists) { detachSharedDoc(docId); saveData(); return; }
    const data = snap.data();
    const localCards = db.filter(q => q.sharedDocId === docId);
    const localIds = new Set(localCards.map(q => q.id));
    const delSet = new Set(deletedCards);
    // 手元に無く、削除もしていないカード（他の共同編集者が追加したもの）は残す
    const keep = (data.cards || []).filter(c => c && !localIds.has(c.id) && !delSet.has(c.id));
    const newCards = [...localCards.map(toSharedCard), ...keep];
    // 一番上のフォルダー名が変わっていたら（名前の変更）、共有ドキュメントの名前も変える
    const rootCat = (sharedMeta[docId] && sharedMeta[docId].root && categories.includes(sharedMeta[docId].root)) ? sharedMeta[docId].root : data.catName;
    const update = { cards: newCards };
    let allRelated = null;
    if (rootCat && categories.includes(rootCat)) {
      allRelated = getAllSubcategories(rootCat);
      const partialTree = {};
      allRelated.forEach(c => { if (categoryTree[c]) partialTree[c] = categoryTree[c].filter(ch => allRelated.includes(ch)); });
      update.categories = allRelated;
      update.categoryTree = partialTree;
      if (rootCat !== data.catName) update.catName = rootCat;
    }
    await ref.update(JSON.parse(JSON.stringify(update)));
    if (data.isPublic) syncPublicIndex(docId, Object.assign({}, data, update));
    setSharedMeta(docId, rootCat, allRelated || data.categories || [], newCards.map(c => c.id));
  } catch (e) { console.warn('共有ドキュメントへの書き戻しに失敗:', e); }
}
// フォルダー（とその中身）に関係する編集可能な共有ドキュメントをすべて書き戻す
function pushSharedDocsForCategories(catNames) {
  const ids = new Set();
  (catNames || []).forEach(c => {
    const info = getCategoryShareInfo(c);
    if (info.shared && info.canEdit) ids.add(info.docId);
  });
  db.forEach(q => { if (q.sharedDocId && (catNames || []).includes(q.category)) { const a = getSharedAccess(q.sharedDocId); if (a.shared && a.canEdit) ids.add(q.sharedDocId); } });
  ids.forEach(id => pushSharedDocFromLocal(id));
}

// ★ ローカルの編集・追加・削除をクラウドに同期するヘルパー関数
async function updateCardInSharedDoc(docId, card, action) {
  if (!currentUser) return;
  try {
    const snap = await firestore.collection("susuru_anki_shared").doc(docId).get();
    if (!snap.exists) return;
    const data = snap.data();
    let newCards = [...(data.cards || [])];
    if (action === 'edit') {
       const idx = newCards.findIndex(c => c.id === card.id);
       if (idx !== -1) newCards[idx] = Object.assign({}, newCards[idx], toSharedCard(card));
       ['questionImage', 'answerImage', 'choices', 'kind'].forEach(f => { if (idx !== -1 && (card[f] === undefined || card[f] === null)) delete newCards[idx][f]; });
    } else if (action === 'delete') {
       newCards = newCards.filter(c => c.id !== card.id);
    } else if (action === 'add') {
       if (!newCards.some(c => c.id === card.id)) newCards.push(toSharedCard(card));
    }
    await firestore.collection("susuru_anki_shared").doc(docId).update({ cards: JSON.parse(JSON.stringify(newCards)) });
  } catch(e) { console.error("Cloud update failed", e); }
}
// ★【0.03.38】まとめて削除（1回の書き込みで）
async function removeCardsFromSharedDoc(docId, ids) {
  if (!currentUser || !docId || !ids || !ids.length) return;
  try {
    const ref = firestore.collection("susuru_anki_shared").doc(docId);
    const snap = await ref.get();
    if (!snap.exists) return;
    const set = new Set(ids);
    await ref.update({ cards: JSON.parse(JSON.stringify((snap.data().cards || []).filter(c => !set.has(c.id)))) });
  } catch (e) { console.error('Cloud update failed', e); }
}
// ★【0.03.02】まとめて追加（1枚ずつ同時に書き込むと、互いに上書きしてカードが消えることがあったため）
async function addCardsToSharedDoc(docId, cards) {
  if (!currentUser || !docId || !cards || cards.length === 0) return;
  try {
    const ref = firestore.collection("susuru_anki_shared").doc(docId);
    const snap = await ref.get();
    if (!snap.exists) return;
    const existing = snap.data().cards || [];
    const ids = new Set(existing.map(c => c.id));
    const added = cards.filter(c => !ids.has(c.id)).map(toSharedCard);
    await ref.update({ cards: JSON.parse(JSON.stringify([...existing, ...added])) });
  } catch (e) { console.error("Cloud bulk add failed", e); }
}

async function shareCategory(catName) {
  if (!currentUser) return alert("管理画面からログインしてください。");
  const already = getCategoryShareInfo(catName);
  if (already.shared) return alert("このフォルダーは既に共有・公開カテゴリーに含まれています。");
  const allTargets = getAllSubcategories(catName); const subset = db.filter(q => allTargets.includes(q.category));
  let partialTree = {}; allTargets.forEach(t => { if(categoryTree[t]) partialTree[t] = categoryTree[t]; });
  try {
    const docRef = await firestore.collection("susuru_anki_shared").add(JSON.parse(JSON.stringify({ catName: catName, cards: subset.map(toSharedCard), categories: allTargets, categoryTree: partialTree, ownerId: currentUser.uid, ownerName: currentUser.displayName || currentUser.email || '不明', friends: [] })));
    await docRef.update({ createdAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(() => {});
    syncPublicIndex(docRef.id, { catName, cards: subset, ownerId: currentUser.uid, ownerName: currentUser.displayName || currentUser.email || '不明', isPublic: true, subscriberUids: [currentUser.uid] });
    
    // 自分が作ったものも同期対象にする
    if (!subscribedDocs.includes(docRef.id)) subscribedDocs.push(docRef.id);
    if (!ownedDocs.includes(docRef.id)) ownedDocs.push(docRef.id);
    markDocJoined(docRef.id);
    sharedDocPermissions[docRef.id] = { canEdit: true, isOwner: true };
    setSharedMeta(docRef.id, catName, allTargets, subset.map(s => s.id));
    const ids = new Set(subset.map(s => s.id));
    db.forEach(q => { if (ids.has(q.id)) { q.sharedDocId = docRef.id; touchCard(q); } });
    saveData(); syncSubscriptions();
    
    const code = await assignNewShareCode(docRef.id).catch(() => null) || '（発行できませんでした）';
    const shareUrl = window.location.origin + window.location.pathname + "?share_id=" + docRef.id;
    try { await navigator.clipboard.writeText(shareUrl); } catch (e) {}
    alert(`✅ 共有URLを発行・コピーしました！\nURL: ${shareUrl}\n🔑 共有コード: ${code}\n（相手は「🌐 公開カテゴリー」画面の「共有コードで参加」にコードを入力しても開けます）\n\n（※今後、あなたがこのカテゴリー内の問題を編集・追加すると、全員に自動同期されます）`);
  } catch(err) { alert("⚠️ URLの発行に失敗しました。ルールの確認を。"); }
}

function listenToSharedDoc(docId) {
  if (unsubscribeShared) unsubscribeShared(); currentSharedDocId = docId; document.getElementById('sharedTitle').innerText = "⏳ 読み込み中...";
  _sharedShowN = 50; _sharedQuery = ''; currentSharedData = null;
  const cl = document.getElementById('sharedCardsList'); if (cl) cl.innerHTML = '';
  unsubscribeShared = firestore.collection("susuru_anki_shared").doc(docId).onSnapshot((snap) => {
    if (!snap.exists) { alert("⚠️ 共有データが見つかりません。"); exitSharedMode(); return; }
    currentSharedData = snap.data(); renderSharedPage();
    if (currentSharedData.isPublic) syncPublicIndex(docId, currentSharedData); // 開いた人が目次も新しくしておく
  }, err => alert("⚠️ 共有データの取得に失敗しました。"));
}

// ★ ドロップダウンに自分のフレンドを読み込む処理
async function loadFriendsForSharedPanel() {
  const select = document.getElementById('selFriendToAdd');
  if (!select) return;
  select.innerHTML = '<option value="">フレンドから選択...</option>';
  if (!currentUser) return;
  try {
    const snap = await firestore.collection('susuru_anki_profiles').doc(currentUser.uid).get();
    const friends = snap.exists ? (snap.data().friends || []) : [];
    const names = await Promise.all(friends.map(u => friendNameCache[u] ? friendNameCache[u] : friendNameOf(u).then(n => (friendNameCache[u] = n))));
    friends.forEach((fUid, i) => {
      const opt = document.createElement('option');
      opt.value = fUid;
      opt.innerText = names[i];
      select.appendChild(opt);
    });
  } catch(e) { console.warn("フレンドリストの読み込みに失敗", e); }
}

function renderSharedPage() {
  if (!currentSharedData) return; 
  const data = currentSharedData;
  document.getElementById('sharedTitle').innerText = `🌐 ${escapeHtml(data.catName)}`; 
  document.getElementById('sharedOwnerName').innerText = escapeHtml(data.ownerName); 
  document.getElementById('sharedCardCount').innerText = (data.cards || []).length;
  const codeRow = document.getElementById('sharedCodeRow');
  if (codeRow) {
    const owner = currentUser && currentUser.uid === data.ownerId;
    if (data.shareCode) { codeRow.style.display = 'block'; document.getElementById('sharedCodeText').innerText = data.shareCode; }
    else codeRow.style.display = 'none';
    // 作成者なら、コードが無ければ発行し、あれば「コードで探せる」ように登録しておく（発行すると onSnapshot で再描画される）
    if (owner) ensureShareCode(currentSharedDocId).catch(() => {});
  }
  
  const isOwner = currentUser && currentUser.uid === data.ownerId; 
  const isFriend = currentUser && data.friends && data.friends.includes(currentUser.uid); 
  const canEdit = isOwner || isFriend;
  
  document.getElementById('sharedOwnerPanel').style.display = isOwner ? 'block' : 'none'; 
  document.getElementById('sharedEditorPanel').style.display = canEdit ? 'block' : 'none';
  
  const viewerPanel = document.getElementById('sharedViewerPanel');
  if (viewerPanel) viewerPanel.style.display = (!isOwner && !isFriend) ? 'block' : 'none';
  
  if (isOwner) {
    if (!sharedFriendsLoaded) {
      loadFriendsForSharedPanel();
      sharedFriendsLoaded = true;
    }
    
    const fList = document.getElementById('sharedFriendsList'); 
    fList.innerHTML = ''; 
    const friendsArray = data.friends || [];
    
    if (friendsArray.length === 0) {
      fList.innerHTML = '<span style="font-size:0.8rem; color:var(--text3);">許可されたフレンドはいません。</span>';
    } else {
      friendsArray.forEach(fUid => {
        let displayName = friendNameCache[fUid] || fUid;
        if (!friendNameCache[fUid]) {
          firestore.collection('susuru_anki_profiles').doc(fUid).get().then(snap => {
            if (snap.exists) {
              friendNameCache[fUid] = snap.data().displayName || fUid;
              const el = document.getElementById(`shared_friend_name_${fUid}`);
              if (el) el.innerText = friendNameCache[fUid];
            }
          });
        }
        
        fList.innerHTML += `<div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg3); padding:8px; border-radius:6px; border:1px solid var(--border);">
          <span id="shared_friend_name_${escAttr(fUid)}" style="font-size:0.8rem;">${escapeHtml(displayName)}</span>
          <button class="btn btn-danger" style="padding:4px 10px; font-size:0.75rem;" onclick="removeFriendFromShared(${jsArg(fUid)})">削除</button>
        </div>`;
      });
    }
  }
  
  _sharedCanEdit = canEdit;
  renderSharedCards();
}
// ★【0.03.47】カードの一覧は少しずつ表示する（以前は1枚ずつ innerHTML += していたため、千枚単位のカテゴリーで
//  「読み込み中」のまま固まっていた。特に Android では画面全体が止まっていた）
let _sharedShowN = 50, _sharedCanEdit = false, _sharedQuery = '';
function renderSharedCards() {
  const data = currentSharedData; if (!data) return;
  const cList = document.getElementById('sharedCardsList'); if (!cList) return;
  const all = Array.isArray(data.cards) ? data.cards : [];
  if (!all.length) { cList.innerHTML = '<div style="color:var(--text3); font-size:0.9rem; text-align:center;">カードがありません</div>'; return; }
  const q = _sharedQuery.trim().toLowerCase();
  const hits = [];
  all.forEach((card, idx) => { if (!q || [card.question, card.answer, card.category].some(s => String(s || '').toLowerCase().includes(q))) hits.push(idx); });
  const shown = hits.slice(0, _sharedShowN);
  cList.innerHTML = `<input type="text" class="form-control" id="sharedCardSearch" placeholder="🔍 問題・答え・フォルダーで絞り込み（${all.length}枚）" value="${escAttr(_sharedQuery)}" style="margin-bottom:10px;">` +
    shown.map(idx => { const card = all[idx]; return `<div class="q-card"><div class="q-card-text">${renderRichText(card.question, { escape: true, kanbunRows: 10 })}</div><div style="font-size:0.85rem; color:var(--text2); margin-top:4px;">A: <span style="color:var(--text);">${renderRichText(getPrimaryAnswer(card.answer), { escape: true, kanbunRows: 10 })}</span></div><div style="font-size:0.75rem; color:var(--text3); margin-top:8px;">📂 ${escapeHtml(card.category)}</div>${_sharedCanEdit ? `<button class="btn btn-secondary" style="margin-top:10px; font-size:0.8rem;" onclick="deleteCardFromShared(${idx})">🗑️ 削除</button>` : ''}</div>`; }).join('') +
    (hits.length > shown.length ? `<button class="btn btn-secondary" style="margin-top:8px;" onclick="_sharedShowN += 100; renderSharedCards();">さらに表示（残り ${hits.length - shown.length} 枚）</button>` : '') +
    (q && !hits.length ? '<div class="hint-small" style="text-align:center;">見つかりません</div>' : '');
  hydrateRich(cList, { chemScale: 1.1 });
  const s = document.getElementById('sharedCardSearch');
  s.oninput = () => { _sharedQuery = s.value; _sharedShowN = 50; const pos = s.selectionStart; renderSharedCards(); const s2 = document.getElementById('sharedCardSearch'); s2.focus(); try { s2.setSelectionRange(pos, pos); } catch (e) {} };
}

async function addFriendToShared() {
  const selectVal = document.getElementById('selFriendToAdd').value;
  const txtVal = document.getElementById('txtNewFriendUid').value.trim();
  const uid = selectVal || txtVal;
  
  if (!uid) return alert("フレンドを選択するか、UIDを入力してください。");
  
  const newFriends = [...(currentSharedData.friends || [])]; 
  if (!newFriends.includes(uid)) newFriends.push(uid);
  
  try { 
    await firestore.collection("susuru_anki_shared").doc(currentSharedDocId).update({ friends: newFriends }); 
    document.getElementById('selFriendToAdd').value = '';
    document.getElementById('txtNewFriendUid').value = ''; 
  } catch(e) { alert("⚠️ 追加に失敗しました"); }
}

async function removeFriendFromShared(uid) {
  if (!confirm("権限を取り消しますか？")) return;
  const newFriends = (currentSharedData.friends || []).filter(u => u !== uid);
  try { await firestore.collection("susuru_anki_shared").doc(currentSharedDocId).update({ friends: newFriends }); } catch(e) {}
}
async function addCardToShared() {
  const q = document.getElementById('txtSharedNewQ').value.trim(), a = document.getElementById('txtSharedNewA').value.trim(); if (!q || !a) return;
  const newCard = { id: 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36), question: q, answer: a, category: currentSharedData.catName, level: 0, correct: 0, incorrect: 0, streak: 0, wrongStreak: 0, shikkariStreak: 0 };
  try { await firestore.collection("susuru_anki_shared").doc(currentSharedDocId).update({ cards: [...currentSharedData.cards, newCard] }); document.getElementById('txtSharedNewQ').value = ''; document.getElementById('txtSharedNewA').value = ''; } catch(e) {}
}
async function deleteCardFromShared(idx) {
  if (!confirm("クラウド上から削除しますか？")) return;
  const newCards = [...currentSharedData.cards]; const removed = newCards.splice(idx, 1)[0];
  try {
    await firestore.collection("susuru_anki_shared").doc(currentSharedDocId).update({ cards: newCards });
    // ★【0.03.02】手元のカードも削除の記録つきで消す（残っていると、次の同期で書き戻されていた）
    if (removed && removed.id) {
      tombstoneCards([removed.id]);
      db = db.filter(q => q.id !== removed.id);
      saveData(true);
    }
  } catch(e) {}
}

function importCurrentShared() {
  const data = currentSharedData; if (!data) return;
  if (!confirm(`購読しますか？\n（今後、作成者が問題を編集・追加すると自動で同期されます）`)) return;
  
  const count = subscribeToSharedData(currentSharedDocId, data);
  autoMerge(); alert(`✅ 取り込みました！\n新規追加: ${count}件`); exitSharedMode();
  syncSubscriptions();
}
// ★【0.03.02】共有・公開カテゴリーを購読して手元に取り込む（購読を解除した後にもう一度購読した場合も含む）
function subscribeToSharedData(docId, data) {
  if (!subscribedDocs.includes(docId)) subscribedDocs.push(docId);
  markDocJoined(docId);
  (data.categories || []).forEach(c => { if (!categories.includes(c) || deletedCats.includes(c)) { markCatCreated(c); if (!categories.includes(c)) categories.push(c); } });
  for (let p in (data.categoryTree || {})) {
    (data.categoryTree[p] || []).forEach(c => {
      for (const k in categoryTree) categoryTree[k] = (categoryTree[k] || []).filter(x => x !== c);
      if (!categoryTree[p]) categoryTree[p] = [];
      categoryTree[p].push(c);
    });
  }
  let count = 0;
  (data.cards || []).forEach(q => {
    if (!q.question || !q.answer) return;
    const existing = db.find(d => d.id === q.id);
    if (existing) { existing.sharedDocId = docId; touchCard(existing); }
    else {
      const c = { id: q.id, question: q.question, answer: q.answer, category: q.category, sharedDocId: docId, level: 0, correct: 0, incorrect: 0, streak: 0, wrongStreak: 0, shikkariStreak: 0 };
      ['note', 'questionImage', 'answerImage', 'choices', 'kind', 'no'].forEach(f => { if (q[f] !== undefined) c[f] = q[f]; });
      reviveCard(c); // 以前に購読解除したカードも取り込み直せるように（削除の記録より新しくする）
      db.push(c); count++;
    }
  });
  setSharedMeta(docId, data.catName, data.categories || [], (data.cards || []).map(c => c.id));
  return count;
}

function exitSharedMode() {
  if (unsubscribeShared) unsubscribeShared(); currentSharedDocId = null; currentSharedData = null;
  sharedFriendsLoaded = false;
  const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname; window.history.pushState({path: cleanUrl}, '', cleanUrl); openPage('pgHome');
}

async function makePublicCategory(catName) {
  if (!currentUser) return alert("ログインしてください");
  const already = getCategoryShareInfo(catName);
  if (already.shared) return alert("このフォルダーは既に共有・公開カテゴリーに含まれています。");
  if (!confirm(`「${catName}」を公開カテゴリーにしますか？\n\n・誰でも検索して購読できるようになります\n・問題・答え・クイックメモが公開されます（成績は公開されません）\n・市販の単語帳などを書き写したものは公開しないでください`)) return;
  const allTargets = getAllSubcategories(catName); const subset = db.filter(q => allTargets.includes(q.category)); let partialTree = {}; allTargets.forEach(t => { if(categoryTree[t]) partialTree[t] = categoryTree[t]; });
  
  try {
    const docRef = await firestore.collection("susuru_anki_shared").add(JSON.parse(JSON.stringify({
      catName: catName, cards: subset.map(toSharedCard), categories: allTargets, categoryTree: partialTree, ownerId: currentUser.uid, ownerName: currentUser.displayName || currentUser.email || '不明', isPublic: true, friends: [], subscriberUids: [currentUser.uid]
    })));
    await docRef.update({ createdAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(() => {});
    
    if (!subscribedDocs.includes(docRef.id)) subscribedDocs.push(docRef.id);
    if (!ownedDocs.includes(docRef.id)) ownedDocs.push(docRef.id);
    markDocJoined(docRef.id);
    sharedDocPermissions[docRef.id] = { canEdit: true, isOwner: true };
    setSharedMeta(docRef.id, catName, allTargets, subset.map(s => s.id));
    const ids = new Set(subset.map(s => s.id));
    db.forEach(q => { if (ids.has(q.id)) { q.sharedDocId = docRef.id; touchCard(q); } });
    saveData(); syncSubscriptions();
    
    alert(`✅ 「${catName}」を公開カテゴリーに設定しました！\n（※今後、あなたがこのカテゴリーを編集すると全員に同期されます）`);
  } catch(err) { alert("⚠️ 公開設定に失敗しました。ルールの確認を。"); }
}

async function deletePublicCategory(docId, catName) {
  if (!currentUser) return alert("ログインしてください");
  if (!confirm(`「${catName}」の公開を停止してFirebaseからデータを完全削除しますか？\n\n※手元のフォルダーや問題データは消えずにそのまま残り、普通のフォルダーとして編集できるようになります。\n※購読していた人の手元には、同期が止まったフォルダーとして残ります。`)) return;
  try {
    const docSnap = await firestore.collection("susuru_anki_shared").doc(docId).get();
    if (!docSnap.exists) return alert("カテゴリーが見つかりません");
    const data = docSnap.data(); if (data.ownerId !== currentUser.uid) return alert("削除権限がありません");
    await deleteSharedDocAndCode(docId, data.shareCode);
    // ★【0.03.02】カードに残った共有の印も外す（残っていると「公開カテゴリーだから編集できない」状態のままになっていた）
    detachSharedDoc(docId);
    saveData(true);
    if (document.getElementById('pgTree').classList.contains('active')) renderTree();
    alert("✅ 公開を停止しFirebaseから削除しました（手元のデータは安全です）");
    loadPublicCategories();
    loadMyPublicCategories();
  } catch(e) { alert("⚠️ 削除に失敗しました"); }
}

async function unsubscribeSharedCategory(catName) {
  const _root = (getCategoryShareInfo(catName).root) || catName;
  if (!confirm("「" + _root + "」の購読を解除しますか？\n\n※このカテゴリーのフォルダーと中の問題がすべて削除されます（学習成績も消えます）。\n※解除する前の状態は、この端末の「復元ポイント」から戻せます（成績も戻ります）")) return;
  // ★【0.03.02】削除する前に docId を特定する（以前は削除後に探していたため見つからず、購読が残って次の同期で復活していた）
  const info = getCategoryShareInfo(catName);
  const docId = info.docId || (db.find(q => getAllSubcategories(catName).includes(q.category) && q.sharedDocId) || {}).sharedDocId || null;
  if (!docId) return alert('このフォルダーは購読中のカテゴリーではありません。');
  await leaveSharedCategory(docId, catName);
  alert("✅ 「" + catName + "」の購読を解除しました");
}

// 購読解除の共通処理：フォルダーと中身を削除記録つきで消し、購読リストからも外す
async function leaveSharedCategory(docId, catName) {
  takeSnapshot(`「${catName}」の購読解除`);
  // ★【0.03.02】サブフォルダーから解除しても、購読しているカテゴリー全体（一番上のフォルダーから）を解除する
  const root = (docId && sharedMeta[docId] && sharedMeta[docId].root && categories.includes(sharedMeta[docId].root)) ? sharedMeta[docId].root : catName;
  const allTarget = getAllSubcategories(root);
  const removedIds = db.filter(q => allTarget.includes(q.category) || (docId && q.sharedDocId === docId)).map(q => q.id);
  tombstoneCards(removedIds);
  db = db.filter(q => !removedIds.includes(q.id));
  markCatsDeleted(allTarget);
  categories = categories.filter(c => !allTarget.includes(c));
  for (let p in categoryTree) {
    if (allTarget.includes(p)) delete categoryTree[p];
    else if (categoryTree[p]) categoryTree[p] = categoryTree[p].filter(c => !allTarget.includes(c));
  }
  if (docId) {
    subscribedDocs = subscribedDocs.filter(id => id !== docId);
    delete sharedDocPermissions[docId];
    markDocLeft(docId);
    if (currentUser) {
      try {
        await firestore.collection('susuru_anki_shared').doc(docId).update({
          subscriberUids: firebase.firestore.FieldValue.arrayRemove(currentUser.uid)
        });
        const cached = publicCategoriesCache.find(c => c.id === docId);
        if (cached && cached.subscriberUids) cached.subscriberUids = cached.subscriberUids.filter(uid => uid !== currentUser.uid);
      } catch(e) { /* 無視 */ }
    }
  }
  saveData(true);
  if (document.getElementById('pgTree').classList.contains('active')) renderTree();
}

let publicCategoriesCache = []; let unsubscribePublicCategories = null;
// ★【0.03.52】📇 公開カテゴリーの目次（名前・作成者・枚数だけ）。一覧はこれだけを読む（以前は全部の公開カテゴリーを
//  カードの中身ごと読んでいたため、なかなか表示されなかった）。中身を持っている人なら誰でも書き直せる（ルールで元と照合）
const PUB_INDEX_COL = 'susuru_anki_public_index';
const _pubIndexSynced = {};
function publicIndexEntry(d) {
  return { isPublic: true, catName: d.catName || '', ownerId: d.ownerId || '', ownerName: d.ownerName || '', cardCount: (d.cards || []).length,
    subscriberCount: (d.subscriberUids || []).length, shareCode: d.shareCode || null, updatedAt: Date.now() };
}
function syncPublicIndex(docId, d, force) {
  if (typeof currentUser === 'undefined' || !currentUser || !d || d.isPublic !== true || !docId) return Promise.resolve();
  const e = publicIndexEntry(d), key = JSON.stringify([e.catName, e.ownerName, e.cardCount, e.subscriberCount, e.shareCode]);
  if (!force && _pubIndexSynced[docId] === key) return Promise.resolve();
  _pubIndexSynced[docId] = key;
  return firestore.collection(PUB_INDEX_COL).doc(docId).set(e).catch(err => { delete _pubIndexSynced[docId]; console.warn('公開カテゴリーの目次の更新に失敗:', err.message); });
}
function removePublicIndex(docId) { if (!docId) return Promise.resolve(); return firestore.collection(PUB_INDEX_COL).doc(docId).delete().catch(() => {}); }
function stopPublicCategoriesWatch() { if (unsubscribePublicCategories) { unsubscribePublicCategories(); unsubscribePublicCategories = null; } }
function stopSharedDocWatch() { if (unsubscribeShared) { unsubscribeShared(); unsubscribeShared = null; } currentSharedDocId = null; currentSharedData = null; sharedFriendsLoaded = false; }

async function loadPublicCategories() {
  const listDiv = document.getElementById('publicCategoriesList');
  if (!listDiv) return;
  stopPublicCategoriesWatch();
  listDiv.innerHTML = '<div style="text-align:center; color:var(--text2);">読み込み中...</div>';
  try {
    const snap = await firestore.collection(PUB_INDEX_COL).where('isPublic', '==', true).get();
    publicCategoriesCache = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    _publicFull = false;
    if (!publicCategoriesCache.length) return loadPublicCategoriesFull(); // 目次がまだ無いとき（はじめて）
    renderPublicCategories();
  } catch (e) {
    console.warn('公開カテゴリーの目次を読めませんでした（ルールが古いかも）:', e.code || e.message);
    loadPublicCategoriesFull();
  }
}
// 目次に無いものも探す（全部の公開カテゴリーを中身ごと読む。時間がかかる）。読んだものは目次に書いておく
let _publicFull = false;
async function loadPublicCategoriesFull() {
  const listDiv = document.getElementById('publicCategoriesList');
  if (!listDiv) return;
  listDiv.innerHTML = '<div style="text-align:center; color:var(--text2);">⏳ すべての公開カテゴリーを読み込み中…（はじめは時間がかかります。次からは速くなります）</div>';
  try {
    const snap = await firestore.collection('susuru_anki_shared').where('isPublic', '==', true).get();
    publicCategoriesCache = snap.docs.map(d => { const x = d.data(); syncPublicIndex(d.id, x); return Object.assign({ id: d.id }, publicIndexEntry(x)); });
    _publicFull = true;
    renderPublicCategories();
  } catch (err) {
    console.error("公開カテゴリー読み込みエラー:", err);
    listDiv.innerHTML = `<div style="color:var(--danger); padding:20px; text-align:center;">公開カテゴリーの読み込みに失敗しました<br><span style="font-size:0.75rem; color:var(--text3);">${escapeHtml(err.code || err.message)}</span></div>`;
  }
}

function renderPublicCategories() {
  const listDiv = document.getElementById('publicCategoriesList'); const searchText = document.getElementById('searchPublicCategories').value.toLowerCase();
  const filtered = publicCategoriesCache.filter(cat => cat.catName.toLowerCase().includes(searchText) || (cat.ownerName || '').toLowerCase().includes(searchText));
  const more = _publicFull ? '' : '<button class="btn btn-secondary" style="margin-top:6px;" onclick="loadPublicCategoriesFull()">🔍 一覧に無いカテゴリーも探す（時間がかかります）</button>';
  if (filtered.length === 0) { listDiv.innerHTML = '<div style="text-align:center; color:var(--text3); margin-top:40px;">公開カテゴリーがありません</div>' + more; return; }
  listDiv.innerHTML = '';
  filtered.forEach(cat => {
    const card = document.createElement('div'); card.className = 'card'; card.style.cursor = 'pointer'; card.style.position = 'relative';
    const isOwner = currentUser && cat.ownerId === currentUser.uid;
    const isSubscribed = subscribedDocs.includes(cat.id) && !isOwner;
    const subscribeBtn = isOwner
      ? ''
      : isSubscribed
        ? `<button class="btn" style="margin-top:8px; width:100%; background:var(--danger); color:#fff; border-color:var(--danger);" onclick="unsubscribePublicCategory(${jsArg(cat.id)}, ${jsArg(cat.catName)})">🚫 購読を解除</button>`
        : `<button class="btn btn-success" style="margin-top:8px; width:100%;" onclick="importPublicCategory(${jsArg(cat.id)}, ${jsArg(cat.catName)})">📥 購読してインポート</button>`;
    card.innerHTML = `
      <div class="q-card-text">${escapeHtml(cat.catName)}</div>
      <div style="font-size:0.85rem; color:var(--text2); margin-top:4px;">作成者: <span style="color:var(--text);">${escapeHtml(cat.ownerName || 'Unknown')}</span></div>
      <div style="font-size:0.8rem; color:var(--text3); margin-top:6px;">カード数: <span style="color:var(--primary); font-weight:bold;">${cat.cardCount ?? (cat.cards || []).length}問</span> 👥 利用者: <span style="color:var(--accent); font-weight:bold;">${cat.subscriberCount ?? (cat.subscriberUids || []).length}人</span></div>
      <button class="btn btn-secondary" style="margin-top:10px; width:100%;" onclick="openPage('pgShared'); listenToSharedDoc(${jsArg(cat.id)})">🌐 詳細・共同編集者の管理</button>
      ${subscribeBtn}
      ${isOwner ? `<button class="btn btn-danger" style="margin-top:8px; width:100%;" onclick="deletePublicCategory(${jsArg(cat.id)}, ${jsArg(cat.catName)})">🗑️ 削除</button>` : ''}`;
    listDiv.appendChild(card);
  });
  if (more) listDiv.insertAdjacentHTML('beforeend', more);
}

async function unsubscribePublicCategory(docId, catName) {
  if (!confirm(`「${catName}」の購読を解除しますか？\n\n※このカテゴリーの問題がすべてローカルから削除されます。`)) return;
  await leaveSharedCategory(docId, catName);
  renderPublicCategories(); // ボタンを即時更新
  alert(`✅ 「${catName}」の購読を解除しました`);
}

async function loadMyPublicCategories() {
  if (!currentUser) { document.getElementById('myPublicCategoriesSection').style.display = 'none'; return; }
  const section = document.getElementById('myPublicCategoriesSection');
  const listDiv = document.getElementById('myPublicCategoriesList');
  section.style.display = 'block';
  listDiv.innerHTML = '<div style="text-align:center; color:var(--text3); font-size:0.85rem;">読み込み中...</div>';
  try {
    // ★【0.03.52】まず目次（軽い）から。目次に無ければ、自分の共有カテゴリーを中身ごと読む（そのとき目次も作る）
    let snap = await firestore.collection(PUB_INDEX_COL).where('ownerId', '==', currentUser.uid).get().catch(() => ({ empty: true, docs: [], forEach() {} }));
    if (snap.empty) {
      snap = await firestore.collection('susuru_anki_shared').where('ownerId', '==', currentUser.uid).get();
      snap.docs.forEach(d => { if (d.data().isPublic) syncPublicIndex(d.id, d.data()); });
    }
    if (snap.empty) {
      listDiv.innerHTML = '<div style="text-align:center; color:var(--text3); font-size:0.85rem; padding:10px;">公開中のカテゴリーはありません</div>';
      return;
    }
    listDiv.innerHTML = '';
    snap.forEach(doc => {
      const cat = doc.data();
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--border);';
      const isActive = cat.isPublic === true;
      row.innerHTML = `
        <div style="flex:1; min-width:0;">
          <div style="font-weight:bold; font-size:0.9rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(cat.catName || '不明')}</div>
          <div style="font-size:0.75rem; color:var(--text3); margin-top:2px;">
            ${isActive ? '<span style="color:var(--success);">🌐 公開中</span>' : '<span style="color:var(--text3);">🔒 非公開（残存）</span>'}
             カード: ${cat.cardCount ?? (cat.cards || []).length}問 👥 ${cat.subscriberCount ?? (cat.subscriberUids || []).length}人
          </div>
        </div>
        <button class="btn btn-danger" style="width:auto; padding:6px 12px; font-size:0.8rem; margin-left:10px; flex-shrink:0;" onclick="deleteMyPublicCategory(${jsArg(doc.id)}, ${jsArg(cat.catName || '不明')})">🗑️ 削除</button>`;
      listDiv.appendChild(row);
    });
  } catch(e) {
    listDiv.innerHTML = '<div style="color:var(--danger); font-size:0.85rem; text-align:center;">読み込みに失敗しました</div>';
  }
}

async function deleteMyPublicCategory(docId, catName) {
  if (!currentUser) return alert('ログインしてください');
  if (!confirm(`「${catName}」をFirebaseから完全に削除しますか？\n\n※手元のフォルダーや問題データは消えずに残ります。`)) return;
  try {
    await deleteSharedDocAndCode(docId);
    detachSharedDoc(docId);
    saveData(true);
    await loadMyPublicCategories();
    loadPublicCategories();
    alert(`✅ 「${catName}」をFirebaseから削除しました`);
  } catch(e) { alert('⚠️ 削除に失敗しました'); }
}

function filterPublicCategories() { renderPublicCategories(); }

async function importPublicCategory(docId, catName) {
  if (!confirm(`「${catName}」を購読しますか？\n（今後、作成者が問題を編集・追加すると自動で同期されます）`)) return;
  try {
    // ★【0.03.52】一覧（目次）にはカードの中身が無いので、購読するときにそのカテゴリーだけを読む
    const s = await firestore.collection('susuru_anki_shared').doc(docId).get();
    if (!s.exists) return alert('カテゴリーが見つかりません（削除されたかもしれません）');
    const cat = Object.assign({ id: docId }, s.data());
    const count = subscribeToSharedData(docId, cat);
    autoMerge(); alert(`✅ 購読完了！\n新規追加: ${count}件`); openPage('pgBox');
    syncSubscriptions();
    // 利用者数を記録（自分のUIDをsubscriberUidsに追記）
    if (currentUser) {
      try {
        await firestore.collection('susuru_anki_shared').doc(docId).update({
          subscriberUids: firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
        });
        // ローカルキャッシュも即時更新
        const subs = new Set(cat.subscriberUids || []); subs.add(currentUser.uid);
        syncPublicIndex(docId, Object.assign({}, cat, { subscriberUids: [...subs] }));
        const cached = publicCategoriesCache.find(c => c.id === docId);
        if (cached) cached.subscriberCount = subs.size;
      } catch(e2) { /* 失敗しても購読自体は成功しているので無視 */ }
    }
  } catch(e) { alert('⚠️ 購読に失敗しました'); }
}

// ★【0.02.59-g】構造エクスプローラーからのカテゴリー追加・削除をsharedDocに同期
// 指定カテゴリーを含むsharedDocId（オーナー or 共同編集者）を探す
function findEditableSharedDocForCat(catName) {
  if (!currentUser) return null;
  const info = getCategoryShareInfo(catName);
  return info.shared && info.canEdit ? info.docId : null;
}



// ================================================================
// ★【0.03.03】共有コード（6文字）・設定画面の共有カテゴリー管理
// ================================================================
function generateShareCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい 0/O/1/I は使わない
  let c = ''; for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}
// ★【0.03.15】共有コードは「コード → 共有カテゴリー」の対応表（susuru_anki_share_codes）で探す
//   以前は共有カテゴリーの一覧からコードで検索していたため、共有カテゴリーの一覧を誰でも読める必要があった。
//   対応表はコードを知っている人が1件ずつ取れるだけ（一覧は読めない）なので、URLだけで共有したカテゴリーを一覧から見られなくなる
const SHARE_CODE_COL = 'susuru_anki_share_codes';
// コードを登録する。すでに別のカテゴリーのコードとして使われていたら false
async function registerShareCode(docId, code) {
  const ref = firestore.collection(SHARE_CODE_COL).doc(code);
  return firestore.runTransaction(async tx => {
    const s = await tx.get(ref);
    if (s.exists) return s.data().docId === docId;
    tx.set(ref, { docId, owner: currentUser.uid, createdAt: Date.now() });
    return true;
  });
}
// 新しいコードを発行して登録する（重なったら作り直す）
async function assignNewShareCode(docId) {
  if (!currentUser) return null;
  for (let i = 0; i < 6; i++) {
    const code = generateShareCode();
    if (await registerShareCode(docId, code)) {
      await firestore.collection('susuru_anki_shared').doc(docId).update({ shareCode: code });
      markShareCodeRegistered(docId);
      return code;
    }
  }
  throw new Error('共有コードを発行できませんでした');
}
function registeredShareCodeDocs() { try { return JSON.parse(localStorage.getItem('susuru_anki_share_codes_ok') || '[]'); } catch (e) { return []; } }
function markShareCodeRegistered(docId) {
  const list = registeredShareCodeDocs();
  if (!list.includes(docId)) { list.push(docId); try { localStorage.setItem('susuru_anki_share_codes_ok', JSON.stringify(list.slice(-200))); } catch (e) {} }
}
// 既存の共有ドキュメントにコードが無ければ発行する。あれば対応表に登録されているか確かめる（作成者のみ）
async function ensureShareCode(docId) {
  if (!currentUser) return null;
  const ref = firestore.collection('susuru_anki_shared').doc(docId);
  const snap = await ref.get();
  if (!snap.exists || snap.data().ownerId !== currentUser.uid) return snap.exists ? (snap.data().shareCode || null) : null;
  const code = snap.data().shareCode;
  if (!code) return assignNewShareCode(docId);
  if (registeredShareCodeDocs().includes(docId)) return code;
  if (await registerShareCode(docId, code)) { markShareCodeRegistered(docId); return code; }
  return assignNewShareCode(docId); // 前のコードがほかのカテゴリーと重なっていたら、新しいコードにする
}
// 共有ドキュメントを消すときは、コードの対応表も消す
async function deleteSharedDocAndCode(docId, knownCode) {
  let code = knownCode;
  if (!code) { try { const s = await firestore.collection('susuru_anki_shared').doc(docId).get(); code = s.exists ? s.data().shareCode : null; } catch (e) {} }
  await firestore.collection('susuru_anki_shared').doc(docId).delete();
  removePublicIndex(docId);
  if (code) {
    try {
      const m = await firestore.collection(SHARE_CODE_COL).doc(code).get();
      if (m.exists && m.data().docId === docId) await firestore.collection(SHARE_CODE_COL).doc(code).delete();
    } catch (e) {}
  }
}
async function joinByShareCode() {
  const raw = (document.getElementById('txtShareCode').value || '').trim();
  if (!raw) return;
  const m = raw.match(/share_id=([A-Za-z0-9]+)/);
  let docId = m ? m[1] : null;
  try {
    if (!docId) {
      const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length === 6) {
        const m2 = await firestore.collection(SHARE_CODE_COL).doc(code).get().catch(() => null);
        if (m2 && m2.exists) docId = m2.data().docId;
        else {
          // まだ対応表に登録されていない、以前からの公開カテゴリー
          const snap = await firestore.collection('susuru_anki_shared').where('isPublic', '==', true).where('shareCode', '==', code).limit(1).get().catch(() => null);
          if (snap && !snap.empty) docId = snap.docs[0].id;
        }
      } else if (code.length >= 15) docId = raw.trim();
    }
    if (!docId) return alert('⚠️ そのコードの共有カテゴリーが見つかりませんでした。');
    document.getElementById('txtShareCode').value = '';
    openPage('pgShared'); listenToSharedDoc(docId);
  } catch (e) { alert('⚠️ 検索に失敗しました: ' + (e.code || e.message)); }
}
function copySharedCode() {
  const t = (document.getElementById('sharedCodeText') || {}).innerText || '';
  if (t && navigator.clipboard) navigator.clipboard.writeText(t).then(() => alert('📋 コピーしました: ' + t));
}
// 設定画面：自分が作った・購読している共有カテゴリーの一覧（共同編集者の設定へ）
function renderMySharedDocsSettings() {
  const el = document.getElementById('mySharedDocsList');
  if (!el) return;
  const ids = knownSharedDocIds();
  if (ids.length === 0) { el.innerHTML = '共有・公開・購読しているカテゴリーはありません。フォルダーを長押し →「🔗 共有URLを発行」「🌐 公開カテゴリーにする」で共有できます。'; return; }
  el.innerHTML = ids.map(id => {
    const acc = getSharedAccess(id);
    const name = (sharedMeta[id] && sharedMeta[id].root) || '（名前を確認中）';
    const role = acc.isOwner ? '👑 作成者' : acc.canEdit ? '🤝 共同編集者' : '📖 購読中';
    return `<div class="shared-doc-row"><div style="flex:1; min-width:0;"><div style="font-weight:700; color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(name)}</div><div>${role}</div></div>
      <button class="chip" onclick="openPage('pgShared'); listenToSharedDoc(${jsArg(id)})">${acc.isOwner ? '👑 共同編集者の設定' : '🔍 詳細'}</button></div>`;
  }).join('');
}
