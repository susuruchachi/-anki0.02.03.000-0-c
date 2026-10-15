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
// フォルダー（またはその中・上位のフォルダー）が属している共有ドキュメントを探す
function getCategoryShareInfo(catName) {
  const sub = new Set(getAllSubcategories(catName));
  let card = db.find(q => sub.has(q.category) && q.sharedDocId && getSharedAccess(q.sharedDocId).shared);
  if (!card) {
    // 上位フォルダーをたどる（空のサブフォルダーでも判定できるように）
    let cur = catName, guard = 0;
    while (!card && guard++ < 100) {
      let parent = null;
      for (const p in categoryTree) { if ((categoryTree[p] || []).includes(cur)) { parent = p; break; } }
      if (!parent) break;
      card = db.find(q => q.category === parent && q.sharedDocId && getSharedAccess(q.sharedDocId).shared);
      cur = parent;
    }
  }
  if (!card) return { shared: false, canEdit: true, isOwner: false, readOnly: false, docId: null };
  return getSharedAccess(card.sharedDocId);
}

// 共有ドキュメントの印を外して、手元の普通のカードに戻す（公開の停止・削除、ドキュメント消失時）
function detachSharedDoc(docId) {
  db.forEach(q => { if (q.sharedDocId === docId) { delete q.sharedDocId; touchCard(q); } });
  subscribedDocs = subscribedDocs.filter(id => id !== docId);
  ownedDocs = ownedDocs.filter(id => id !== docId);
  delete sharedDocPermissions[docId];
  markDocLeft(docId);
}

// 共有ドキュメントに保存するカードの形（成績は含めない）
function toSharedCard(card) {
  const o = { id: card.id, question: card.question, answer: card.answer, category: card.category, updatedAt: card.updatedAt || Date.now() };
  ['note', 'questionImage', 'answerImage', 'choices', 'kind'].forEach(f => { if (card[f] !== undefined && card[f] !== null && card[f] !== '') o[f] = card[f]; });
  return o;
}
const SHARED_CONTENT_FIELDS = ['question', 'answer', 'category', 'questionImage', 'answerImage', 'choices', 'kind'];
function sharedCardDiffers(lq, cq) {
  return SHARED_CONTENT_FIELDS.some(f => JSON.stringify(lq[f] === undefined ? null : lq[f]) !== JSON.stringify(cq[f] === undefined ? null : cq[f]));
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
      let localWins = false;
      
      // 1. クラウドから削除されたカードをローカルからも消す（編集できる人は、手元の変更を優先して後で書き戻す）
      if (!canEdit) {
        const removed = db.filter(q => q.sharedDocId === docId && !cloudCardIds.has(q.id));
        if (removed.length > 0) {
          removed.forEach(q => { if (!deletedCards.includes(q.id)) deletedCards.push(q.id); });
          db = db.filter(q => !(q.sharedDocId === docId && !cloudCardIds.has(q.id)));
          changed = true;
        }
      } else if (db.some(q => q.sharedDocId === docId && !cloudCardIds.has(q.id))) {
        localWins = true;
      }
      
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
              SHARED_CONTENT_FIELDS.forEach(f => { if (cq[f] !== undefined) lq[f] = cq[f]; else delete lq[f]; });
              touchCard(lq); changed = true;
            }
          }
          if (!lq.note && cq.note) { lq.note = cq.note; touchCard(lq); changed = true; }
          if (lq.sharedDocId !== docId) { lq.sharedDocId = docId; touchCard(lq); changed = true; }
        } else {
          const newLocalCard = { id: cq.id, question: cq.question, answer: cq.answer, category: cq.category, sharedDocId: docId, level: 0, correct: 0, incorrect: 0, streak: 0, wrongStreak: 0, shikkariStreak: 0 };
          ['note', 'questionImage', 'answerImage', 'choices', 'kind'].forEach(f => { if (cq[f] !== undefined) newLocalCard[f] = cq[f]; });
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
      if (localWins) needPush.push(docId);
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
    const rootCat = data.catName;
    const update = { cards: newCards };
    if (rootCat && categories.includes(rootCat)) {
      const allRelated = getAllSubcategories(rootCat);
      const partialTree = {};
      allRelated.forEach(c => { if (categoryTree[c]) partialTree[c] = categoryTree[c].filter(ch => allRelated.includes(ch)); });
      update.categories = allRelated;
      update.categoryTree = partialTree;
    }
    await ref.update(JSON.parse(JSON.stringify(update)));
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
    
    // 自分が作ったものも同期対象にする
    if (!subscribedDocs.includes(docRef.id)) subscribedDocs.push(docRef.id);
    if (!ownedDocs.includes(docRef.id)) ownedDocs.push(docRef.id);
    markDocJoined(docRef.id);
    sharedDocPermissions[docRef.id] = { canEdit: true, isOwner: true };
    const ids = new Set(subset.map(s => s.id));
    db.forEach(q => { if (ids.has(q.id)) { q.sharedDocId = docRef.id; touchCard(q); } });
    saveData(); syncSubscriptions();
    
    const shareUrl = window.location.origin + window.location.pathname + "?share_id=" + docRef.id; await navigator.clipboard.writeText(shareUrl); alert(`✅ URLを発行・コピーしました！\nURL: ${shareUrl}\n\n（※今後、あなたがこのカテゴリー内の問題を編集・追加すると、全員に自動同期されます）`);
  } catch(err) { alert("⚠️ URLの発行に失敗しました。ルールの確認を。"); }
}

function listenToSharedDoc(docId) {
  if (unsubscribeShared) unsubscribeShared(); currentSharedDocId = docId; document.getElementById('sharedTitle').innerText = "⏳ 読み込み中...";
  unsubscribeShared = firestore.collection("susuru_anki_shared").doc(docId).onSnapshot((snap) => {
    if (!snap.exists) { alert("⚠️ 共有データが見つかりません。"); exitSharedMode(); return; }
    currentSharedData = snap.data(); renderSharedPage();
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
    for (const fUid of friends) {
      let fName = fUid;
      if (friendNameCache[fUid]) {
        fName = friendNameCache[fUid];
      } else {
        const fSnap = await firestore.collection('susuru_anki_profiles').doc(fUid).get();
        if (fSnap.exists) {
          fName = fSnap.data().displayName || fUid;
          friendNameCache[fUid] = fName; // キャッシュに保存
        }
      }
      const opt = document.createElement('option');
      opt.value = fUid;
      opt.innerText = fName;
      select.appendChild(opt);
    }
  } catch(e) { console.warn("フレンドリストの読み込みに失敗", e); }
}

function renderSharedPage() {
  if (!currentSharedData) return; 
  const data = currentSharedData;
  document.getElementById('sharedTitle').innerText = `🌐 ${escapeHtml(data.catName)}`; 
  document.getElementById('sharedOwnerName').innerText = escapeHtml(data.ownerName); 
  document.getElementById('sharedCardCount').innerText = data.cards.length;
  
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
          <span id="shared_friend_name_${fUid}" style="font-size:0.8rem;">${escapeHtml(displayName)}</span>
          <button class="btn btn-danger" style="padding:4px 10px; font-size:0.75rem;" onclick="removeFriendFromShared('${fUid}')">削除</button>
        </div>`;
      });
    }
  }
  
  const cList = document.getElementById('sharedCardsList'); cList.innerHTML = '';
  if (data.cards.length === 0) cList.innerHTML = '<div style="color:var(--text3); font-size:0.9rem; text-align:center;">カードがありません</div>';
  else data.cards.forEach((card, idx) => cList.innerHTML += `<div class="q-card"><div class="q-card-text">${renderRichText(card.question, { escape: true, kanbunRows: 10 })}</div><div style="font-size:0.85rem; color:var(--text2); margin-top:4px;">A: <span style="color:var(--text);">${renderRichText(getPrimaryAnswer(card.answer), { escape: true, kanbunRows: 10 })}</span></div><div style="font-size:0.75rem; color:var(--text3); margin-top:8px;">📂 ${escapeHtml(card.category)}</div>${canEdit ? `<button class="btn btn-secondary" style="margin-top:10px; font-size:0.8rem;" onclick="deleteCardFromShared(${idx})">🗑️ 削除</button>` : ''}</div>`);
  hydrateRich(cList, { chemScale: 1.1 });
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
  const newCards = [...currentSharedData.cards]; newCards.splice(idx, 1);
  try { await firestore.collection("susuru_anki_shared").doc(currentSharedDocId).update({ cards: newCards }); } catch(e) {}
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
    deletedCards = deletedCards.filter(id => id !== q.id); // 以前に購読解除したカードも取り込み直せるように
    const existing = db.find(d => d.id === q.id);
    if (existing) { existing.sharedDocId = docId; touchCard(existing); }
    else {
      const c = { id: q.id, question: q.question, answer: q.answer, category: q.category, sharedDocId: docId, level: 0, correct: 0, incorrect: 0, streak: 0, wrongStreak: 0, shikkariStreak: 0 };
      ['note', 'questionImage', 'answerImage', 'choices', 'kind'].forEach(f => { if (q[f] !== undefined) c[f] = q[f]; });
      touchCard(c);
      db.push(c); count++;
    }
  });
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
    await firestore.collection("susuru_anki_shared").doc(docId).delete();
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
  if (!confirm("「" + catName + "」の購読を解除しますか？\n\n※このフォルダーと中の問題がすべて削除されます。\n（学習成績も消えます）")) return;
  // ★【0.03.02】削除する前に docId を特定する（以前は削除後に探していたため見つからず、購読が残って次の同期で復活していた）
  const info = getCategoryShareInfo(catName);
  const docId = info.docId || (db.find(q => getAllSubcategories(catName).includes(q.category) && q.sharedDocId) || {}).sharedDocId || null;
  await leaveSharedCategory(docId, catName);
  alert("✅ 「" + catName + "」の購読を解除しました");
}

// 購読解除の共通処理：フォルダーと中身を削除記録つきで消し、購読リストからも外す
async function leaveSharedCategory(docId, catName) {
  const allTarget = getAllSubcategories(catName);
  const removedIds = db.filter(q => allTarget.includes(q.category) || (docId && q.sharedDocId === docId)).map(q => q.id);
  removedIds.forEach(id => { if (!deletedCards.includes(id)) deletedCards.push(id); });
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

async function loadPublicCategories() {
  const listDiv = document.getElementById('publicCategoriesList');
  if (!listDiv) return;
  listDiv.innerHTML = '<div style="text-align:center; color:var(--text2);">読み込み中...</div>';
  try {
    if (unsubscribePublicCategories) { unsubscribePublicCategories(); unsubscribePublicCategories = null; }
    unsubscribePublicCategories = firestore.collection("susuru_anki_shared").where('isPublic', '==', true).onSnapshot(
      snap => {
        publicCategoriesCache = [];
        snap.forEach(doc => { publicCategoriesCache.push({ id: doc.id, ...doc.data() }); });
        renderPublicCategories();
      },
      err => {
        console.error("公開カテゴリー読み込みエラー:", err);
        listDiv.innerHTML = `<div style="color:var(--danger); padding:20px; text-align:center;">公開カテゴリーの読み込みに失敗しました<br><span style="font-size:0.75rem; color:var(--text3);">${err.code || err.message}</span></div>`;
      }
    );
  } catch(e) {
    console.error("loadPublicCategories catch:", e);
    listDiv.innerHTML = `<div style="color:var(--danger); padding:20px; text-align:center;">公開カテゴリーの読み込みに失敗しました<br><span style="font-size:0.75rem; color:var(--text3);">${e.message}</span></div>`;
  }
}

function renderPublicCategories() {
  const listDiv = document.getElementById('publicCategoriesList'); const searchText = document.getElementById('searchPublicCategories').value.toLowerCase();
  const filtered = publicCategoriesCache.filter(cat => cat.catName.toLowerCase().includes(searchText) || (cat.ownerName || '').toLowerCase().includes(searchText));
  if (filtered.length === 0) { listDiv.innerHTML = '<div style="text-align:center; color:var(--text3); margin-top:40px;">公開カテゴリーがありません</div>'; return; }
  listDiv.innerHTML = '';
  filtered.forEach(cat => {
    const card = document.createElement('div'); card.className = 'card'; card.style.cursor = 'pointer'; card.style.position = 'relative';
    const isOwner = currentUser && cat.ownerId === currentUser.uid;
    const isSubscribed = subscribedDocs.includes(cat.id) && !isOwner;
    const subscribeBtn = isOwner
      ? ''
      : isSubscribed
        ? `<button class="btn" style="margin-top:8px; width:100%; background:var(--danger); color:#fff; border-color:var(--danger);" onclick="unsubscribePublicCategory('${cat.id}', '${escapeHtml(cat.catName)}')">🚫 購読を解除</button>`
        : `<button class="btn btn-success" style="margin-top:8px; width:100%;" onclick="importPublicCategory('${cat.id}', '${escapeHtml(cat.catName)}')">📥 購読してインポート</button>`;
    card.innerHTML = `
      <div class="q-card-text">${escapeHtml(cat.catName)}</div>
      <div style="font-size:0.85rem; color:var(--text2); margin-top:4px;">作成者: <span style="color:var(--text);">${escapeHtml(cat.ownerName || 'Unknown')}</span></div>
      <div style="font-size:0.8rem; color:var(--text3); margin-top:6px;">カード数: <span style="color:var(--primary); font-weight:bold;">${(cat.cards || []).length}問</span> 👥 利用者: <span style="color:var(--accent); font-weight:bold;">${(cat.subscriberUids || []).length}人</span></div>
      <button class="btn btn-secondary" style="margin-top:10px; width:100%;" onclick="openPage('pgShared'); listenToSharedDoc('${cat.id}')">🌐 詳細・共同編集者の管理</button>
      ${subscribeBtn}
      ${isOwner ? `<button class="btn btn-danger" style="margin-top:8px; width:100%;" onclick="deletePublicCategory('${cat.id}', '${escapeHtml(cat.catName)}')">🗑️ 削除</button>` : ''}`;
    listDiv.appendChild(card);
  });
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
    const snap = await firestore.collection('susuru_anki_shared').where('ownerId', '==', currentUser.uid).get();
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
             カード: ${(cat.cards || []).length}問 👥 ${(cat.subscriberUids || []).length}人
          </div>
        </div>
        <button class="btn btn-danger" style="width:auto; padding:6px 12px; font-size:0.8rem; margin-left:10px; flex-shrink:0;" onclick="deleteMyPublicCategory('${doc.id}', '${escapeHtml(cat.catName || '不明')}')">🗑️ 削除</button>`;
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
    await firestore.collection('susuru_anki_shared').doc(docId).delete();
    detachSharedDoc(docId);
    saveData(true);
    await loadMyPublicCategories();
    loadPublicCategories();
    alert(`✅ 「${catName}」をFirebaseから削除しました`);
  } catch(e) { alert('⚠️ 削除に失敗しました'); }
}

function filterPublicCategories() { renderPublicCategories(); }

async function importPublicCategory(docId, catName) {
  const cat = publicCategoriesCache.find(c => c.id === docId); if (!cat) return alert('カテゴリーが見つかりません');
  if (!confirm(`「${escapeHtml(catName)}」を購読しますか？\n（今後、作成者が問題を編集・追加すると自動で同期されます）`)) return;
  try {
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
        const cached = publicCategoriesCache.find(c => c.id === docId);
        if (cached) {
          if (!cached.subscriberUids) cached.subscriberUids = [];
          if (!cached.subscriberUids.includes(currentUser.uid)) cached.subscriberUids.push(currentUser.uid);
        }
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

// フォルダー構造の変更を共有ドキュメントへ反映する（旧API名。中身は pushSharedDocFromLocal）
async function syncSharedDocStructure(docId) { await pushSharedDocFromLocal(docId); }
async function syncNewCategoryToShared(parentCatName, newCatName) {
  if (!parentCatName) return;
  const docId = findEditableSharedDocForCat(parentCatName);
  if (docId) await pushSharedDocFromLocal(docId);
}
