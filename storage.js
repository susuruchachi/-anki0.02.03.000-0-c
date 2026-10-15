// ----------------- データ管理 -----------------
let deletedCards = [];
let deletedCats = [];

// ================================================================
// ★【0.03.02】同期システムの見直し
// ・カードごとに「内容の更新時刻(updatedAt)」と「成績の更新時刻(statsAt)」を持たせ、
//   端末間で食い違ったときは新しい方を採用する（古い端末のデータで上書きされない）
// ・フォルダーの作成/削除は「時刻つきの記録(catStamps)」で管理し、削除したフォルダーが復活しない
//   ／いったん削除した名前で作り直したフォルダーが消されない、ようにする
// ・同じ内容の重複カードをまとめるとき、正解数・誤答数を「足し算」していたため、
//   同期のたびに数が膨らんでいた（数万になる不具合）。足し算をやめ、大きい方を採用する
// ・クラウドへの保存は「丸ごと上書き」だけにせず、他の端末の変更を検知したら取り込んでから保存する
// ================================================================
let catStamps = {};   // { フォルダー名: { a: 作成(復活)時刻, d: 削除時刻 } }
let docStamps = {};   // { 共有docId: { a: 購読時刻, d: 解除時刻 } }
let structAt = 0;     // フォルダー構造・購読状態を最後に変更した時刻
let _structHash = null;
let cloudReady = false;           // 起動後の最初の同期が終わるまでクラウドへは書き込まない
let cloudUnsubscribe = null;      // 自分のデータのリアルタイム監視
let _myWriteIds = [];             // 自分が書き込んだ writeId（自分の書き込みの「こだま」を無視するため）
let _lastSeenWriteId = null;

const DEVICE_ID = (() => {
  try {
    let id = localStorage.getItem('susuru_anki_device_id');
    if (!id) { id = 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('susuru_anki_device_id', id); }
    return id;
  } catch (e) { return 'dev_' + Math.random().toString(36).slice(2); }
})();

const CARD_CONTENT_FIELDS = ['question', 'answer', 'category', 'note', 'questionImage', 'answerImage', 'choices', 'kind', 'sharedDocId'];
const CARD_STAT_FIELDS = ['level', 'correct', 'incorrect', 'streak', 'wrongStreak', 'shikkariStreak', 'level5Correct'];

function newCardId() { return 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
// カードの内容（問題・答え・フォルダー・メモ等）を変更したら呼ぶ
function touchCard(card) { if (card) card.updatedAt = Date.now(); }
// カードの成績を変更したら呼ぶ
function touchStats(card) { if (card) card.statsAt = Date.now(); }

// フォルダーを作成（または削除済みの名前で作り直し）したことを記録する
function markCatCreated(name) {
  if (!name) return;
  const s = catStamps[name] || {};
  s.a = Math.max(Date.now(), (s.d || 0) + 1);
  catStamps[name] = s;
  deletedCats = deletedCats.filter(c => c !== name);
}
// フォルダーを削除（名前の変更・統合で消えた場合も含む）したことを記録する
function markCatsDeleted(names) {
  (names || []).forEach(n => {
    if (!n || n === '未分類') return;
    const s = catStamps[n] || {};
    s.d = Math.max(Date.now(), (s.a || 0) + 1);
    catStamps[n] = s;
    if (!deletedCats.includes(n)) deletedCats.push(n);
  });
}
function markDocJoined(docId) {
  if (!docId) return;
  const s = docStamps[docId] || {}; s.a = Math.max(Date.now(), (s.d || 0) + 1); docStamps[docId] = s;
}
function markDocLeft(docId) {
  if (!docId) return;
  const s = docStamps[docId] || {}; s.d = Math.max(Date.now(), (s.a || 0) + 1); docStamps[docId] = s;
}
function stampAlive(s) { return !s || !(s.d > 0) || (s.a || 0) > s.d; }

function loadData() {
  try {
    const raw=localStorage.getItem(STORAGE_KEY);
    if(raw){
      const p=JSON.parse(raw);
      if(p.db) db=p.db;
      if(p.categories) categories=p.categories;
      if(p.categoryTree) categoryTree=p.categoryTree;
      if(p.subscribedDocs) subscribedDocs=p.subscribedDocs;
      if(p.ownedDocs) ownedDocs=p.ownedDocs;
      if(p.deletedCards) deletedCards=p.deletedCards;
      if(p.deletedCats) deletedCats=p.deletedCats;
      if(p.catStamps) catStamps=p.catStamps;
      if(p.docStamps) docStamps=p.docStamps;
      if(p.structAt) structAt=p.structAt;
    }
  } catch(e){}
  migrateSyncMeta();
  try { shareStats = localStorage.getItem('shareStats') === 'true'; } catch(e){}
  // ★【0.02.58-g】カテゴリー選択と最終ページを復元
  try {
    const savedScope = localStorage.getItem(STORAGE_KEY + '_scopePath');
    if (savedScope) lastQuizScopePath = JSON.parse(savedScope);
  } catch(e){}
  _structHash = structFingerprint();
}

// ★【0.03.02】旧バージョンのデータに同期用の情報を付け足す（端末ごとに1回だけ）
function migrateSyncMeta() {
  const FLAG = 'susuru_anki_sync_meta_0302';
  let done = false;
  try { done = localStorage.getItem(FLAG) === '1'; } catch (e) {}
  if (done) return;
  // 削除記録と「今あるフォルダー」が矛盾している（＝削除後に同じ名前で作り直した）ものは、今あるフォルダーを優先する
  categories.forEach(c => {
    if (!catStamps[c]) catStamps[c] = {};
    if (!(catStamps[c].a > 0)) catStamps[c].a = 2; // 旧データの削除記録(=1扱い)より新しい
  });
  deletedCats = deletedCats.filter(c => !categories.includes(c));
  // ★ 重複カードの「足し算」で膨らんだ正解数・誤答数を修復する
  const fixed = repairInflatedStats(true);
  try { localStorage.setItem(FLAG, '1'); } catch (e) {}
  if (fixed > 0) {
    setTimeout(() => alert(`🩹 同期の不具合で異常に大きくなっていた成績（正解数・誤答数）を ${fixed} 件のカードで修復しました。\n（該当カードの正解数・誤答数を0に戻しました。レベルはそのままです）`), 800);
  }
}

// 1枚のカードで正解数・誤答数が1000回以上は、同期の重複加算による異常値とみなす
const INFLATED_STATS_LIMIT = 1000;
function repairInflatedStats(silent = false) {
  let fixed = 0;
  db.forEach(q => {
    if ((Number(q.correct) || 0) >= INFLATED_STATS_LIMIT || (Number(q.incorrect) || 0) >= INFLATED_STATS_LIMIT) {
      q.correct = 0; q.incorrect = 0; touchStats(q); fixed++;
    }
  });
  if (!silent) {
    if (fixed > 0) { saveData(true); alert(`🩹 ${fixed} 件のカードの異常な成績を修復しました。`); }
    else alert('✅ 異常な成績のカードは見つかりませんでした。');
  }
  return fixed;
}

function structFingerprint() {
  const tree = {};
  Object.keys(categoryTree || {}).sort().forEach(k => { tree[k] = categoryTree[k]; });
  return JSON.stringify([categories, tree, [...(subscribedDocs || [])].sort(), [...(ownedDocs || [])].sort()]);
}
// フォルダー構造が変わっていれば変更時刻を更新する（クラウドから取り込んだ変更では呼ばない）
function updateStructStamp() {
  const h = structFingerprint();
  if (_structHash !== null && h !== _structHash) structAt = Date.now();
  _structHash = h;
}

function buildSyncPayload() {
  return { db, categories, categoryTree, subscribedDocs, ownedDocs, deletedCards, deletedCats, catStamps, docStamps, structAt };
}

function writeLocal() {
  const payload = buildSyncPayload();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  // ★【0.02.58-g】カテゴリー選択を保存
  try { localStorage.setItem(STORAGE_KEY + '_scopePath', JSON.stringify(lastQuizScopePath)); } catch(e){}
  return payload;
}

function saveData(immediate = false) {
  ensureSystemSanity();
  updateStructStamp();
  writeLocal();
  if (currentUser && cloudReady) {
    clearTimeout(syncTimeout);
    setSyncStatus('saving', '🔄 保存中...');
    if (immediate) backgroundCloudSave();
    else syncTimeout = setTimeout(() => backgroundCloudSave(), 1000);
  }
  if (typeof updateHomeSummary === 'function') { try { updateHomeSummary(); } catch (e) {} }
}

function setSyncStatus(state, text) {
  const el = document.getElementById('cloudSyncStatus');
  if(!el) return;
  el.className = `sync-status ${state}`;
  el.innerText = text;
  if (state === 'success' || state === 'error') setTimeout(() => el.classList.add('hidden'), 3000);
}

function userDocRef() { return firestore.collection("susuru_anki_users").doc(currentUser.uid); }

async function backgroundCloudSave() {
  if (!currentUser || !cloudReady) return;
  try {
    const writeId = DEVICE_ID + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    _myWriteIds.push(writeId); if (_myWriteIds.length > 20) _myWriteIds.shift();
    // undefined を含むとFirestoreが拒否するので、JSONを通して取り除く
    const body = JSON.parse(JSON.stringify(buildSyncPayload()));
    await userDocRef().set({
      ...body,
      version: typeof APP_VERSION !== 'undefined' ? APP_VERSION : "unknown",
      writer: DEVICE_ID, writeId,
      lastSync: firebase.firestore.FieldValue.serverTimestamp()
    });
    _lastSeenWriteId = writeId;
    setSyncStatus('success', '✅ 保存完了');
  } catch (err) { setSyncStatus('error', '⚠️ 保存エラー'); }
}

// ----------------------------------------------------------------
// 端末間マージ（純粋関数：引数を書き換えずに結果を返す）
// L = この端末のデータ, C = クラウドのデータ
// ----------------------------------------------------------------
function mergeStampMaps(a, b) {
  const out = {};
  [a || {}, b || {}].forEach(m => {
    Object.keys(m).forEach(k => {
      const s = m[k] || {}; const o = out[k] || (out[k] = {});
      if (s.a > 0) o.a = Math.max(o.a || 0, s.a);
      if (s.d > 0) o.d = Math.max(o.d || 0, s.d);
    });
  });
  return out;
}
function cardAnswerCount(c) { return (Number(c.correct) || 0) + (Number(c.incorrect) || 0); }
function mergeCardPair(l, c) {
  const out = Object.assign({}, c, l);
  const contentSrc = (l.updatedAt || 0) > (c.updatedAt || 0) ? l : c;
  CARD_CONTENT_FIELDS.forEach(f => { if (contentSrc[f] !== undefined) out[f] = contentSrc[f]; else delete out[f]; });
  let statSrc;
  if ((l.statsAt || 0) !== (c.statsAt || 0)) statSrc = (l.statsAt || 0) > (c.statsAt || 0) ? l : c;
  else statSrc = cardAnswerCount(l) > cardAnswerCount(c) ? l : c;
  CARD_STAT_FIELDS.forEach(f => { if (statSrc[f] !== undefined) out[f] = statSrc[f]; else delete out[f]; });
  const ua = Math.max(l.updatedAt || 0, c.updatedAt || 0); if (ua) out.updatedAt = ua; else delete out.updatedAt;
  const sa = Math.max(l.statsAt || 0, c.statsAt || 0); if (sa) out.statsAt = sa; else delete out.statsAt;
  return out;
}

function mergeSyncStates(L, C) {
  const delCards = [...new Set([...(L.deletedCards || []), ...(C.deletedCards || [])])];
  const delSet = new Set(delCards);

  // フォルダーの作成・削除記録（旧データの削除記録は時刻が無いので「1」として扱う）
  const cs = mergeStampMaps(L.catStamps, C.catStamps);
  [L, C].forEach(s => (s.deletedCats || []).forEach(n => { if (!cs[n]) cs[n] = {}; if (!(cs[n].d > 0)) cs[n].d = 1; }));
  const catAlive = n => stampAlive(cs[n]);

  // カード
  const map = new Map();
  (C.db || []).forEach(c => { if (c && c.id) map.set(c.id, c); });
  (L.db || []).forEach(l => {
    if (!l || !l.id) return;
    const c = map.get(l.id);
    map.set(l.id, c ? mergeCardPair(l, c) : l);
  });
  const mergedDb = [...map.values()].filter(q => !delSet.has(q.id)).map(q => Object.assign({}, q));

  // フォルダー構造：名前は両方の和集合（削除記録のあるものを除く）、親子関係は新しく変更した側を優先
  const newer = (L.structAt || 0) > (C.structAt || 0) ? L : C;
  const older = newer === L ? C : L;
  const names = [];
  const addName = n => { if (n && typeof n === 'string' && n.trim() !== '' && !names.includes(n)) names.push(n); };
  [newer, older].forEach(s => {
    (s.categories || []).forEach(addName);
    Object.keys(s.categoryTree || {}).forEach(p => { addName(p); (s.categoryTree[p] || []).forEach(addName); });
  });
  addName('未分類');
  const aliveNames = names.filter(n => n === '未分類' || catAlive(n));
  const aliveSet = new Set(aliveNames);
  const parentOf = {};
  const tree = {};
  const isAncestor = (anc, node) => { let x = node, g = 0; while (x !== undefined && g++ < 10000) { if (x === anc) return true; x = parentOf[x]; } return false; };
  [newer, older].forEach(s => {
    const t = s.categoryTree || {};
    Object.keys(t).forEach(p => {
      if (!aliveSet.has(p)) return;
      (t[p] || []).forEach(ch => {
        if (!aliveSet.has(ch) || ch === p || parentOf[ch] !== undefined) return;
        if (isAncestor(ch, p)) return; // 循環になる親子関係は採用しない
        parentOf[ch] = p;
        (tree[p] || (tree[p] = [])).push(ch);
      });
    });
  });

  // 購読・所有している共有ドキュメント
  const ds = mergeStampMaps(L.docStamps, C.docStamps);
  const docAlive = id => stampAlive(ds[id]);
  const subs = [...new Set([...(newer.subscribedDocs || []), ...(older.subscribedDocs || [])])].filter(docAlive);
  const owned = [...new Set([...(newer.ownedDocs || []), ...(older.ownedDocs || [])])].filter(docAlive);

  const deadCats = Object.keys(cs).filter(n => !catAlive(n));
  return {
    db: mergedDb, categories: aliveNames, categoryTree: tree,
    deletedCards: delCards, deletedCats: deadCats, catStamps: cs, docStamps: ds,
    structAt: Math.max(L.structAt || 0, C.structAt || 0),
    subscribedDocs: subs, ownedDocs: owned
  };
}

// クラウドから届いた状態をこの端末に取り込む。取り込み後、クラウドと内容が違えば（この端末にしかない変更があれば）書き戻す
function applyCloudState(r, { forcePush = false } = {}) {
  const merged = mergeSyncStates(buildSyncPayload(), r);
  db = merged.db; categories = merged.categories; categoryTree = merged.categoryTree;
  deletedCards = merged.deletedCards; deletedCats = merged.deletedCats;
  catStamps = merged.catStamps; docStamps = merged.docStamps; structAt = merged.structAt;
  subscribedDocs = merged.subscribedDocs; ownedDocs = merged.ownedDocs;
  ensureSystemSanity();
  autoMerge(true);
  _structHash = structFingerprint(); // 取り込みによる構造の変化では変更時刻を進めない（端末間で押し付け合いにならないように）
  writeLocal();
  const differs = forcePush || syncFingerprint(buildSyncPayload()) !== syncFingerprint(r);
  if (differs && currentUser && cloudReady) backgroundCloudSave();
  refreshVisibleViews();
}

function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}
function syncFingerprint(p) {
  const dbSorted = [...(p.db || [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return stableStringify({
    db: dbSorted, categories: [...(p.categories || [])].sort(), categoryTree: p.categoryTree || {},
    deletedCards: [...(p.deletedCards || [])].sort(), deletedCats: [...(p.deletedCats || [])].sort(),
    catStamps: p.catStamps || {}, docStamps: p.docStamps || {}, structAt: p.structAt || 0,
    subscribedDocs: [...(p.subscribedDocs || [])].sort(), ownedDocs: [...(p.ownedDocs || [])].sort()
  });
}

function refreshVisibleViews() {
  const isActive = id => { const el = document.getElementById(id); return el && el.classList.contains('active'); };
  try {
    if (isActive('pgTree') && typeof renderTree === 'function') renderTree();
    if (isActive('pgBox') && typeof renderBox === 'function') renderBox();
    if (isActive('pgHome')) { if (typeof buildQuizScopeDropdown === 'function') buildQuizScopeDropdown(); }
    if (typeof updateHomeSummary === 'function') updateHomeSummary();
  } catch (e) { console.warn(e); }
}

// 他の端末での変更をリアルタイムに取り込む
function startCloudListener() {
  if (!currentUser) return;
  if (cloudUnsubscribe) { cloudUnsubscribe(); cloudUnsubscribe = null; }
  cloudUnsubscribe = userDocRef().onSnapshot(snap => {
    if (!snap.exists || (snap.metadata && snap.metadata.hasPendingWrites)) return;
    const r = snap.data() || {};
    if (r.writeId && (_myWriteIds.includes(r.writeId) || r.writeId === _lastSeenWriteId)) return;
    _lastSeenWriteId = r.writeId || null;
    applyCloudState(r);
  }, err => console.warn('クラウド監視エラー:', err));
}
function stopCloudListener() {
  if (cloudUnsubscribe) { cloudUnsubscribe(); cloudUnsubscribe = null; }
  cloudReady = false;
}

function ensureSystemSanity() {
  const dead = new Set(deletedCats.filter(c => c !== '未分類'));
  // 削除済みフォルダーを構造から取り除き、親子関係を整える
  for (const p in categoryTree) {
    if (dead.has(p) || !p) { delete categoryTree[p]; continue; }
    categoryTree[p] = [...new Set((categoryTree[p] || []).filter(c => c && !dead.has(c) && c !== p))];
  }
  for (const p in categoryTree) {
    if (!categories.includes(p)) categories.push(p);
    categoryTree[p].forEach(c => { if (!categories.includes(c)) categories.push(c); });
  }
  if (!categories.includes("未分類")) categories.push("未分類");
  categories = [...new Set(categories.filter(c => c && String(c).trim() !== "" && !dead.has(c)))];
  // 1つのフォルダーが複数の親に入っていたり、親子が循環していたら直す
  const seen = new Set();
  for (const p in categoryTree) {
    categoryTree[p] = categoryTree[p].filter(c => { if (seen.has(c)) return false; seen.add(c); return true; });
  }
  const parentOf = {};
  for (const p in categoryTree) categoryTree[p].forEach(c => { parentOf[c] = p; });
  Object.keys(parentOf).forEach(c => {
    let x = parentOf[c], g = 0;
    while (x !== undefined && g++ < 10000) {
      if (x === c) { const p = parentOf[c]; categoryTree[p] = categoryTree[p].filter(y => y !== c); delete parentOf[c]; break; }
      x = parentOf[x];
    }
  });
  for (const p in categoryTree) { if (categoryTree[p].length === 0) delete categoryTree[p]; }

  const knownDocs = new Set([...(subscribedDocs || []), ...(ownedDocs || [])]);
  const delSet = new Set(deletedCards);
  db = db.filter(i => i && i.question && i.question.toString().trim() !== "" && i.answer && i.answer.toString().trim() !== "" && !delSet.has(i.id));
  db.forEach(item => {
    if(!item.id) item.id = newCardId();
    if(!item.category || !categories.includes(item.category)) {
      item.category = item.group && categories.includes(item.group) ? item.group : "未分類";
    }
    // ★【0.03.02】公開・共有をやめたドキュメントの印が残っていると「閲覧専用」扱いのまま編集できなくなるので外す
    if (item.sharedDocId && !knownDocs.has(item.sharedDocId)) delete item.sharedDocId;
    if(item.level === undefined) item.level = 0;
    if(item.correct === undefined) item.correct = 0;
    if(item.incorrect === undefined) item.incorrect = 0;
    if(item.streak === undefined) item.streak = 0;
    if(item.wrongStreak === undefined) item.wrongStreak = 0;
    if(item.shikkariStreak === undefined) item.shikkariStreak = 0;
    if(item.level5Correct === undefined) item.level5Correct = 0;
  });
}

// 同じフォルダー・同じ問題・同じ答えの重複カードを1枚にまとめる
// ★【0.03.02】以前は成績を「足し算」していたため、同期のたびに正解数が膨らんでいた。大きい方を採用する
function autoMerge(skipSave = false) {
  const groups = new Map();
  db.forEach(item => {
    const safeCat = item.category ? String(item.category).trim() : "未分類";
    const key = `${safeCat}\u0000${String(item.question).trim()}\u0000${String(item.answer).trim()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  const result = [];
  groups.forEach(items => {
    if (items.length === 1) { result.push(items[0]); return; }
    // 残す1枚を決める（どの端末でも同じ結果になるように決定的に選ぶ）
    const sorted = [...items].sort((a, b) =>
      (b.sharedDocId ? 1 : 0) - (a.sharedDocId ? 1 : 0) ||
      cardAnswerCount(b) - cardAnswerCount(a) ||
      String(a.id).localeCompare(String(b.id)));
    const keep = Object.assign({}, sorted[0]);
    sorted.slice(1).forEach(dup => {
      CARD_STAT_FIELDS.forEach(f => { keep[f] = Math.max(Number(keep[f]) || 0, Number(dup[f]) || 0); });
      if (!keep.note && dup.note) keep.note = dup.note;
      if (!keep.choices && dup.choices) keep.choices = dup.choices;
      if (!keep.kind && dup.kind) keep.kind = dup.kind;
      keep.updatedAt = Math.max(keep.updatedAt || 0, dup.updatedAt || 0) || undefined;
      keep.statsAt = Math.max(keep.statsAt || 0, dup.statsAt || 0) || undefined;
      if (!dup.sharedDocId && !deletedCards.includes(dup.id)) deletedCards.push(dup.id);
    });
    if (keep.updatedAt === undefined) delete keep.updatedAt;
    if (keep.statsAt === undefined) delete keep.statsAt;
    result.push(keep);
  });
  db = result;
  if (!skipSave) saveData();
}

async function syncToCloud(isSilent = false) {
  if (!currentUser) { if (!isSilent) alert("Googleアカウントでログインしてください。"); return; }
  try {
    const snap = await userDocRef().get();
    // 最初の同期が終わるまではクラウドに書かない（古いデータでクラウドを上書きしないため）
    cloudReady = true;
    if (snap.exists) {
      const r = snap.data() || {};
      _lastSeenWriteId = r.writeId || null;
      applyCloudState(r, { forcePush: true });
    } else {
      ensureSystemSanity(); autoMerge(true); writeLocal();
      await backgroundCloudSave();
    }
    startCloudListener();
    refreshVisibleViews();
    if (typeof syncSubscriptions === 'function') await syncSubscriptions();
    if (!isSilent) { alert(`☁️ 同期完了！`); openPage('pgHome'); }
  } catch (err) { if (!isSilent) alert(`⚠️ 同期エラー: ${err.message}\n(Firebaseのルール設定などを確認してください)`); }
}
