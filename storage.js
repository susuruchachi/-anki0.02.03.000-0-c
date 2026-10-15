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
let catSubjects = {}; // ★【0.03.07】フォルダーの教科タグ { フォルダー名: '英語' }（'' は「なし（親から引き継がない）」）
let deletedCardsAt = {}; // { カードID: 削除時刻 }（削除後に取り込み直したカードは updatedAt が新しいので復活できる）
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

const CARD_CONTENT_FIELDS = ['question', 'answer', 'category', 'note', 'questionImage', 'answerImage', 'choices', 'kind', 'sharedDocId', 'no'];
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
// カードを削除したことを記録する
function tombstoneCards(ids) {
  const now = Date.now();
  (ids || []).forEach(id => {
    if (!id) return;
    deletedCardsAt[id] = Math.max(deletedCardsAt[id] || 0, now);
    if (!deletedCards.includes(id)) deletedCards.push(id);
  });
}
// 削除済みのIDのカードを取り込み直すとき（再購読など）に呼ぶ。カードの updatedAt を削除時刻より新しくする
function reviveCard(card) {
  if (!card) return;
  deletedCards = deletedCards.filter(id => id !== card.id);
  card.updatedAt = Math.max(Date.now(), (deletedCardsAt[card.id] || 0) + 1);
}
// フォルダー名として使えない名前（Firestoreの予約名・区切り文字）
function invalidCategoryName(n) {
  if (!n) return 'フォルダー名を入力してください。';
  if (n.includes('>')) return 'フォルダー名に「>」は使えません。';
  if (/^__.*__$/.test(n)) return '「__」で始まり「__」で終わる名前は使えません。';
  if (n.length > 100) return 'フォルダー名が長すぎます（100文字まで）。';
  return '';
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

let _resolveDataLoaded;
const dataLoaded = new Promise(r => { _resolveDataLoaded = r; });
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
      if(p.catSubjects) catSubjects=p.catSubjects;
      if(p.deletedCardsAt) deletedCardsAt=p.deletedCardsAt;
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
  _resolveDataLoaded();
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
  const now = Date.now();
  deletedCards.forEach(id => { if (!deletedCardsAt[id]) deletedCardsAt[id] = now; });
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
  const subj = {};
  Object.keys(catSubjects || {}).sort().forEach(k => { subj[k] = catSubjects[k]; });
  return JSON.stringify([categories, tree, [...(subscribedDocs || [])].sort(), [...(ownedDocs || [])].sort(), subj]);
}
// フォルダー構造が変わっていれば変更時刻を更新する（クラウドから取り込んだ変更では呼ばない）
function updateStructStamp() {
  const h = structFingerprint();
  if (_structHash !== null && h !== _structHash) structAt = Date.now();
  _structHash = h;
}

function buildSyncPayload() {
  return { db, categories, categoryTree, subscribedDocs, ownedDocs, deletedCards, deletedCardsAt, deletedCats, catStamps, docStamps, structAt, catSubjects };
}

let _quotaWarned = false;
function writeLocal() {
  const payload = buildSyncPayload();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); }
  catch (e) {
    console.error('ローカル保存に失敗:', e);
    if (!_quotaWarned) { _quotaWarned = true; setTimeout(() => alert('⚠️ 端末の保存容量がいっぱいで保存できませんでした。\n画像付きのカードを減らすか、JSONでバックアップしてから不要なデータを削除してください。'), 0); }
  }
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

// ================================================================
// ★【0.03.04】クラウド保存の圧縮
// Firestoreは1ドキュメント1MBまで。カードが3000枚ほどになるとそのままでは保存できず同期エラーになっていたため、
// カード一覧(db)をgzipで圧縮してバイナリ(Blob)で保存する（だいたい1/5になる）。
// フォルダー構造などの小さい情報は今まで通りそのまま保存する（旧バージョンの端末がフォルダーを消してしまわないように）
// ================================================================
const CLOUD_DOC_LIMIT = 1000000; // 余裕を見て約1MB未満に収める
class CloudTooLargeError extends Error {}
function utf8Bytes(str) { return (typeof TextEncoder !== 'undefined') ? new TextEncoder().encode(str).length : unescape(encodeURIComponent(str)).length; }
function encodeCloudBody(payload) {
  const body = JSON.parse(JSON.stringify(payload));
  const dbJson = JSON.stringify(body.db || []);
  let size;
  if (typeof pako !== 'undefined' && firebase.firestore && firebase.firestore.Blob) {
    const gz = pako.gzip(dbJson);
    delete body.db;
    body.dbFormat = 'gzip-json-v1';
    size = gz.length + utf8Bytes(JSON.stringify(body)) + 2000; // 圧縮データ以外の部分＋圧縮データの大きさ
    body.dbGz = firebase.firestore.Blob.fromUint8Array(gz);
  } else {
    size = utf8Bytes(JSON.stringify(body)) + 2000;
  }
  if (size > CLOUD_DOC_LIMIT) {
    const err = new CloudTooLargeError('too_large'); err.size = size; throw err;
  }
  return body;
}
// クラウドのドキュメントを読み、圧縮されたカード一覧を元に戻す（旧形式の db もそのまま読める）
function decodeCloudDoc(r) {
  if (!r) return r;
  if (r.dbGz) {
    if (typeof pako === 'undefined') throw new Error('圧縮データを読むためのライブラリ(pako)を読み込めませんでした。通信状態を確認して再読み込みしてください。');
    const bytes = typeof r.dbGz.toUint8Array === 'function' ? r.dbGz.toUint8Array() : r.dbGz;
    const out = Object.assign({}, r);
    out.db = JSON.parse(pako.ungzip(bytes, { to: 'string' }));
    delete out.dbGz;
    return out;
  }
  return r;
}
let _tooLargeWarned = false;
function reportCloudSaveError(err) {
  console.warn('クラウド保存エラー:', err);
  if (err instanceof CloudTooLargeError) {
    setSyncStatus('error', '⚠️ 容量オーバーで保存できません');
    if (!_tooLargeWarned) {
      _tooLargeWarned = true;
      alert(`⚠️ データが大きすぎてクラウドに保存できません（約${Math.round(err.size / 1024)}KB / 上限 約1MB）。\n\nカードに添付した画像が容量の大部分を占めていることが多いです。画像付きのカードを減らすか、不要なカードを削除してください。\n（この端末には保存されています）`);
    }
  } else {
    setSyncStatus('error', `⚠️ 保存エラー: ${err && (err.code || err.message) || ''}`.slice(0, 60));
  }
}

let _cloudSaving = false, _cloudSaveAgain = false;
function newWriteId() {
  const id = DEVICE_ID + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  _myWriteIds.push(id); if (_myWriteIds.length > 30) _myWriteIds.shift();
  return id;
}
// ★【0.03.02】クラウドへの保存は「読む→（他の端末の変更があれば取り込む）→書く」をトランザクションで行う
// （丸ごと上書きすると、まだ取り込んでいない他の端末の変更を消してしまうため）
async function backgroundCloudSave() {
  if (!currentUser || !cloudReady) return;
  if (_cloudSaving) { _cloudSaveAgain = true; return; }
  _cloudSaving = true;
  try {
    const ref = userDocRef();
    let writeId = null, merged = false;
    await firestore.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        const r = decodeCloudDoc(snap.data() || {});
        if (!r.writeId || (r.writeId !== _lastSeenWriteId && !_myWriteIds.includes(r.writeId))) { mergeIntoLocal(r); merged = true; }
      }
      writeId = newWriteId();
      // undefined を含むとFirestoreが拒否するので、JSONを通して取り除く。カード一覧は圧縮する
      const body = encodeCloudBody(buildSyncPayload());
      tx.set(ref, {
        ...body,
        version: typeof APP_VERSION !== 'undefined' ? APP_VERSION : "unknown",
        writer: DEVICE_ID, writeId,
        lastSync: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
    _lastSeenWriteId = writeId;
    if (merged) refreshVisibleViews(true);
    setSyncStatus('success', '✅ 保存完了');
  } catch (err) {
    reportCloudSaveError(err);
  } finally {
    _cloudSaving = false;
    if (_cloudSaveAgain) { _cloudSaveAgain = false; backgroundCloudSave(); }
  }
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
  // カードの削除記録（時刻つき）。時刻の無い旧データの記録は「1」として扱う
  const delAt = {};
  [L, C].forEach(s => {
    Object.keys(s.deletedCardsAt || {}).forEach(id => { delAt[id] = Math.max(delAt[id] || 0, s.deletedCardsAt[id] || 0); });
    (s.deletedCards || []).forEach(id => { if (!(delAt[id] > 0)) delAt[id] = 1; });
  });

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
  // 削除より後に（再購読などで）取り込み直されたカードは残す
  const mergedDb = [...map.values()].filter(q => !(delAt[q.id] > 0) || (q.updatedAt || 0) > delAt[q.id]).map(q => Object.assign({}, q));
  const aliveIds = new Set(mergedDb.map(q => q.id));
  const delCards = Object.keys(delAt).filter(id => !aliveIds.has(id));

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
  // 新しい側が知っているフォルダーは、新しい側の親子関係（一番上の階層なら親なし）だけを採用する
  const newerKnows = new Set([...(newer.categories || []), ...Object.keys(newer.categoryTree || {}), ...Object.values(newer.categoryTree || {}).flat()]);
  [newer, older].forEach(s => {
    const t = s.categoryTree || {};
    Object.keys(t).forEach(p => {
      if (!aliveSet.has(p)) return;
      (t[p] || []).forEach(ch => {
        if (!aliveSet.has(ch) || ch === p || parentOf[ch] !== undefined) return;
        if (s === older && newerKnows.has(ch)) return;
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
    deletedCards: delCards, deletedCardsAt: delAt, deletedCats: deadCats, catStamps: cs, docStamps: ds,
    // 教科タグ：フォルダー構造を新しく変更した側を優先し、もう一方にしか無いものは足す
    catSubjects: (() => { const o = Object.assign({}, older.catSubjects || {}, newer.catSubjects || {}); Object.keys(o).forEach(k => { if (!aliveSet.has(k)) delete o[k]; }); return o; })(),
    structAt: Math.max(L.structAt || 0, C.structAt || 0),
    subscribedDocs: subs, ownedDocs: owned
  };
}

// クラウドの状態をこの端末に取り込む（書き戻しはしない）
function mergeIntoLocal(r) {
  const merged = mergeSyncStates(buildSyncPayload(), r);
  db = merged.db; categories = merged.categories; categoryTree = merged.categoryTree;
  deletedCards = merged.deletedCards; deletedCardsAt = merged.deletedCardsAt; deletedCats = merged.deletedCats;
  catStamps = merged.catStamps; docStamps = merged.docStamps; structAt = merged.structAt; catSubjects = merged.catSubjects || {};
  subscribedDocs = merged.subscribedDocs; ownedDocs = merged.ownedDocs;
  ensureSystemSanity();
  autoMerge(true);
  _structHash = structFingerprint(); // 取り込みによる構造の変化では変更時刻を進めない（端末間で押し付け合いにならないように）
  writeLocal();
}
// クラウドから届いた状態をこの端末に取り込む。取り込み後、クラウドと内容が違えば（この端末にしかない変更があれば）書き戻す
function applyCloudState(r, { forcePush = false } = {}) {
  const before = viewFingerprint();
  mergeIntoLocal(r);
  const differs = forcePush || syncFingerprint(buildSyncPayload()) !== syncFingerprint(r);
  if (differs && currentUser && cloudReady) backgroundCloudSave();
  refreshVisibleViews(viewFingerprint() !== before);
}
// 画面の表示に関係する部分だけの指紋（成績だけの変化では一覧を描き直さない）
function viewFingerprint() {
  return JSON.stringify([categories, categoryTree, db.length, db.map(q => q.id + '\u0001' + q.category + '\u0001' + q.question + '\u0001' + q.answer + '\u0001' + (q.note || '')).join('\u0002')]);
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
    deletedCards: [...(p.deletedCards || [])].sort(), deletedCardsAt: p.deletedCardsAt || {}, deletedCats: [...(p.deletedCats || [])].sort(),
    catStamps: p.catStamps || {}, docStamps: p.docStamps || {}, structAt: p.structAt || 0, catSubjects: p.catSubjects || {},
    subscribedDocs: [...(p.subscribedDocs || [])].sort(), ownedDocs: [...(p.ownedDocs || [])].sort()
  });
}

function refreshVisibleViews(contentChanged = true) {
  const isActive = id => { const el = document.getElementById(id); return el && el.classList.contains('active'); };
  try {
    if (contentChanged) {
      if (isActive('pgTree') && typeof renderTree === 'function') renderTree();
      if (isActive('pgBox') && typeof renderBox === 'function') renderBox();
      if (isActive('pgHome')) { if (typeof buildQuizScopeDropdown === 'function') buildQuizScopeDropdown(); }
    }
    if (typeof updateHomeSummary === 'function') updateHomeSummary();
  } catch (e) { console.warn(e); }
}

// 他の端末での変更をリアルタイムに取り込む
function startCloudListener() {
  if (!currentUser) return;
  if (cloudUnsubscribe) { cloudUnsubscribe(); cloudUnsubscribe = null; }
  cloudUnsubscribe = userDocRef().onSnapshot(snap => {
    if (!snap.exists || (snap.metadata && snap.metadata.hasPendingWrites)) return;
    const raw = snap.data() || {};
    if (raw.writeId && (_myWriteIds.includes(raw.writeId) || raw.writeId === _lastSeenWriteId)) return;
    let r;
    try { r = decodeCloudDoc(raw); } catch (e) { console.warn(e); setSyncStatus('error', '⚠️ 同期データを読めませんでした'); return; }
    _lastSeenWriteId = raw.writeId || null;
    applyCloudState(r);
  }, err => { console.warn('クラウド監視エラー:', err); cloudReady = false; cloudUnsubscribe = null; });
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
  Object.keys(catSubjects || {}).forEach(k => { if (!categories.includes(k)) delete catSubjects[k]; });

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
  assignCardNumbers();
}

// ★【0.03.03】問題番号：フォルダーごとに 1,2,3… の番号を振る（番号が無いカードには、そのフォルダーの最後の番号の次を振る）
function assignCardNumbers() {
  const maxNo = {};
  db.forEach(q => {
    if (q.no !== undefined && q.no !== null && q.no !== '') {
      const n = Number(q.no);
      if (Number.isFinite(n) && n > 0) { q.no = Math.floor(n); maxNo[q.category] = Math.max(maxNo[q.category] || 0, q.no); }
      else delete q.no;
    }
  });
  db.forEach(q => {
    if (q.no === undefined || q.no === null || q.no === '') { q.no = (maxNo[q.category] || 0) + 1; maxNo[q.category] = q.no; }
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
      if (!dup.sharedDocId) tombstoneCards([dup.id]);
    });
    if (keep.updatedAt === undefined) delete keep.updatedAt;
    if (keep.statsAt === undefined) delete keep.statsAt;
    result.push(keep);
  });
  db = result;
  if (!skipSave) saveData();
}

const OWNER_UID_KEY = 'susuru_anki_owner_uid';
// ★【0.03.02】この端末のデータが別のアカウントのものだった場合の扱いを決める
function resolveAccountSwitch() {
  let owner = null;
  try { owner = localStorage.getItem(OWNER_UID_KEY); } catch (e) {}
  const hasLocal = db.length > 0 || categories.length > 1;
  if (owner && owner !== currentUser.uid && hasLocal) {
    const merge = confirm('この端末には、別のGoogleアカウントで使っていたデータがあります。\n\nOK：この端末のデータを今のアカウントに統合する\nキャンセル：この端末のデータを今のアカウントのデータに置き換える（統合しない）');
    if (!merge) {
      db = []; categories = ['未分類']; categoryTree = {}; subscribedDocs = []; ownedDocs = [];
      deletedCards = []; deletedCardsAt = {}; deletedCats = []; catStamps = {}; docStamps = {}; structAt = 0; catSubjects = {};
      sharedDocPermissions = {};
      _structHash = structFingerprint(); writeLocal();
    }
  }
  try { localStorage.setItem(OWNER_UID_KEY, currentUser.uid); } catch (e) {}
}

let _syncing = false;
async function syncToCloud(isSilent = false) {
  if (!currentUser) { if (!isSilent) alert("Googleアカウントでログインしてください。"); return; }
  await dataLoaded; // 端末のデータを読み込む前にクラウドと合わせない
  if (_syncing) return;
  _syncing = true;
  try {
    resolveAccountSwitch();
    const snap = await userDocRef().get();
    // 最初の同期が終わるまではクラウドに書かない（古いデータでクラウドを上書きしないため）
    cloudReady = true;
    if (snap.exists) {
      const r = decodeCloudDoc(snap.data() || {});
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
  } catch (err) {
    console.warn('同期エラー:', err);
    cloudReady = false;
    setSyncStatus('error', `⚠️ 同期エラー: ${err && (err.code || err.message) || ''}`.slice(0, 60));
    if (!isSilent) alert(`⚠️ 同期エラー: ${err.message}\n(通信状態やFirebaseのルール設定などを確認してください)`);
  }
  finally { _syncing = false; }
}

// ★【0.03.02】オフラインで起動した・通信が切れた場合は、つながったときに同期をやり直す
if (typeof window !== 'undefined' && window.addEventListener) {
  const retrySync = () => { if (currentUser && !cloudReady) syncToCloud(true); };
  window.addEventListener('online', retrySync);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') retrySync(); });
}
