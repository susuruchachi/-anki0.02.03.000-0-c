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
// ★【0.03.30】上のフォルダーから出題するときに出さないフォルダー { フォルダー名: true }（false は「出す」を明示。同期で外せるように）
let catSkip = {};
// ★【0.03.96】印が無くても、名前が「例文」「チャンツ」で終わるフォルダー（テキストから作ったもの・共有カテゴリーから取り込んだもの）は、
// はじめから「上のフォルダーから出題しない」にする（印は自分のデータにしか無く、共有カテゴリーを取り込んだ人には付いていなかった）。
// 自分で外した（false）・付けた（true）ときはそちらを優先
const CAT_DEFAULT_SKIP_RE = /(例文|チャンツ)(（[^）]*）)?$/;
function isCatSkipped(cat) {
  const v = catSkip ? catSkip[cat] : undefined;
  if (v === true) return true;
  if (v === false) return false;
  return CAT_DEFAULT_SKIP_RE.test(String(cat || '').trim());
}
// 出題に使うフォルダー：自分と、その下のフォルダー（ただし「上から出題するときは出さない」フォルダーとその下は除く）
function getQuizSubcategories(cat, result = []) {
  if (result.includes(cat)) return result;
  result.push(cat);
  (categoryTree[cat] || []).forEach(c => { if (!isCatSkipped(c)) getQuizSubcategories(c, result); });
  return result;
}
// ★【0.03.62】連続記録：学習した日 { 'YYYY-MM-DD': その日に答えた数 }（同期では両方を残し、多い方の数）
let studyDays = {}; // ★【0.03.73】値は { 端末ID: その端末で答えた数 }（前の版は数だけ）。端末ごとに多い方を残して、合計を表示する
// ★【0.03.73】暗記テストの途中経過 { フォルダー: 途中の状態（at: 保存時刻, dev: 端末）| { deleted: true, at } } と、
// クイズの「番号順（前回の続きから）」の位置 { 出題範囲: { pos, at } } も同期する
let drillProgress = {};
let gameDays = {}; // ★【0.04.53】🏆 ごほうび（game.js）：{ 'YYYY-MM-DD': { 'c:端末ID': 正解数, 'k:端末ID': 最大コンボ, frz: 1（お守りで守った日） } }。日ごと・キーごとに大きい方を残して同期
let gameShop = {}; // ★【0.04.54】🛒 コインの交換・リーグのごほうび（game.js）：{ id: { item, cost, coins, d, at } }。id ごとに新しい方を残して同期
let cardProg = {}; // ★【0.04.30】🃏 カードモードの成績（cards.js）。{ カードID: { k:わかる, d:わからない, p:覚えた, at } }。いつもの成績・暗記テストとは別
let calEvents = {}; // ★【0.04.20】📅 カレンダーの予定（calendar.js）。{ id: 予定 }（消した予定は { deleted: true, at }）
let quizOrderPos = {};
// ★【0.03.82】読み上げの読み方の辞書 { 書き方: { r: 読み方, at } | { deleted: true, at } }（端末間で同期）
let ttsDict = {};
// ★【0.03.91】暗記テストで AI にした質問 { カードID: [{ q, a, at, model } | { at, del: true }] }（端末間で同期。前はこの端末だけ）
let drillQa = {};
function mergeDrillQa(a, b) {
  const o = {}, limit = Date.now() - 60 * 86400e3;
  [a || {}, b || {}].forEach(m => Object.entries(m).forEach(([id, list]) => {
    const cur = o[id] = o[id] || {};
    (list || []).forEach(x => { if (!x || !x.at) return; const k = String(x.at); if (x.del) cur[k] = { at: x.at, del: true, dt: Math.max(x.dt || 0, (cur[k] && cur[k].dt) || 0) || undefined }; else if (!cur[k] || !cur[k].del) cur[k] = x; });
  }));
  const out = {};
  Object.entries(o).forEach(([id, map]) => {
    const all = Object.values(map).sort((x, y) => x.at - y.at);
    const live = all.filter(x => !x.del).slice(-10), dead = all.filter(x => x.del && (x.dt || x.at) > limit); // 消した記録は、消した時刻から60日とっておく
    if (live.length || dead.length) out[id] = [...dead, ...live].sort((x, y) => x.at - y.at);
  });
  // 新しく使ったカードから150枚まで
  const ids = Object.keys(out).sort((x, y) => Math.max(...out[y].map(z => z.at)) - Math.max(...out[x].map(z => z.at)));
  ids.slice(150).forEach(id => delete out[id]);
  return out;
}
function studyDayCount(v) { return typeof v === 'number' ? v : v && typeof v === 'object' ? Object.values(v).reduce((a, n) => a + (Number(n) || 0), 0) : 0; }
function mergeStudyDays(a, b) {
  const asObj = v => typeof v === 'number' ? (v > 0 ? { _: v } : {}) : Object.assign({}, v || {});
  const o = {};
  [a || {}, b || {}].forEach(m => Object.entries(m).forEach(([d, v]) => { const x = asObj(v), cur = o[d] || {}; Object.entries(x).forEach(([k, n]) => { cur[k] = Math.max(cur[k] || 0, Number(n) || 0); }); o[d] = cur; }));
  return o;
}
function mergeStampedMap(a, b, keepDays) {
  const o = {}, limit = Date.now() - (keepDays || 60) * 86400000;
  [a || {}, b || {}].forEach(m => Object.entries(m).forEach(([k, v]) => { if (!v) return; if (!o[k] || (v.at || 0) > (o[k].at || 0)) o[k] = v; }));
  Object.keys(o).forEach(k => { if (o[k].deleted && (o[k].at || 0) < limit) delete o[k]; });
  return o;
}
let studyPlan = null; // ★【0.03.27】週間プラン（plan.js）。設定は新しく変えた方、達成の記録は両方を残す
// ★【0.03.33】週間プランは複数持てる：studyPlan = { v: 2, plans: { id: プラン } }（解除したプランは { deleted: true, planAt }）
function normalizeStudyPlans(x) {
  if (!x) return { v: 2, plans: {} };
  if (x.v === 2) return { v: 2, plans: Object.assign({}, x.plans || {}) };
  // 前の形（プラン1つ）
  if (x.root || x.weeks) return { v: 2, plans: { p1: Object.assign({ id: 'p1' }, x, x.enabled === false ? { deleted: true } : {}) } };
  return { v: 2, plans: x.planAt ? { p1: { id: 'p1', deleted: true, planAt: x.planAt } } : {} };
}
function mergeOnePlan(a, b) {
  if (!a) return b || null; if (!b) return a;
  const base = (a.planAt || 0) >= (b.planAt || 0) ? a : b, other = base === a ? b : a;
  if (base.deleted) return base;
  const log = {};
  [other.log || {}, base.log || {}].forEach(L => Object.keys(L).forEach(k => {
    const x = log[k] = log[k] || {};
    Object.keys(L[k] || {}).forEach(f => { const v = L[k][f]; x[f] = typeof v === 'number' && typeof x[f] === 'number' ? Math.min(x[f], v) : (x[f] === undefined ? v : x[f]); });
  }));
  return Object.assign({}, base, { log });
}
function mergeStudyPlans(a, b) {
  if (!a && !b) return null;
  const A = normalizeStudyPlans(a), B = normalizeStudyPlans(b);
  const plans = {};
  new Set([...Object.keys(A.plans), ...Object.keys(B.plans)]).forEach(id => { plans[id] = mergeOnePlan(A.plans[id], B.plans[id]); });
  return { v: 2, plans };
}
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
const CARD_STAT_FIELDS = ['level', 'correct', 'incorrect', 'streak', 'wrongStreak', 'shikkariStreak', 'level5Correct', 'senses', 'drillStats']; // drillStats：暗記テストだけの正解・不正解

// ★【0.03.17】意味（品詞タグ）ごとの成績
//  答えが「(他動詞)…/(自動詞)…」のように2つ以上の意味に分かれているカードは、意味ごとに成績（レベル・正誤数・連続記録）を持つ。
//  card.senses = { 意味の名前: { level, correct, incorrect, streak, wrongStreak, shikkariStreak, level5Correct } }
//  カード全体の成績は意味ごとの成績から決める（レベル＝いちばん低い意味のレベル、正誤数＝合計、全部の意味が卒業したら卒業）
const SENSE_STAT_FIELDS = ['level', 'correct', 'incorrect', 'streak', 'wrongStreak', 'shikkariStreak', 'level5Correct'];
function cardSenseList(card) {
  if (!card || typeof parseStructuredAnswer !== 'function') return null;
  const st = parseStructuredAnswer(card.answer);
  if (!st || st.length < 2) return null;
  const seen = {};
  return st.map((seg, i) => {
    let key = seg.tagKey || seg.label || ('#' + (i + 1)); // ★【0.03.44】キーは前の版と同じ（成績を引き継ぐ）
    seen[key] = (seen[key] || 0) + 1;
    if (seen[key] > 1) key += '#' + seen[key];
    return { key, label: seg.label, text: seg.text };
  });
}
// 意味ごとの成績を読む（保存はしない）。まだ意味ごとの成績が無いカードは、今までのカードの成績を引き継いだものとして扱う
function senseStatsView(card, list) {
  list = list || cardSenseList(card);
  if (!list) return null;
  const out = {};
  const n = list.length;
  list.forEach((s, i) => {
    if (card.senses && card.senses[s.key]) { out[s.key] = card.senses[s.key]; return; }
    if (card.senses) { out[s.key] = { level: 0, correct: 0, incorrect: 0, streak: 0, wrongStreak: 0, shikkariStreak: 0, level5Correct: 0 }; return; } // 後から増えた意味
    const o = {};
    SENSE_STAT_FIELDS.forEach(f => { o[f] = Number(card[f]) || 0; });
    // 正誤数は、合計が変わらないように分ける
    ['correct', 'incorrect'].forEach(f => { const total = Math.max(0, Math.floor(Number(card[f]) || 0)); o[f] = Math.floor(total / n) + (i < total % n ? 1 : 0); });
    out[s.key] = o;
  });
  return out;
}
// 意味ごとの成績をカードに保存できる形にする（その意味を解いたときだけ呼ぶ。データを無駄に増やさないため）
function ensureSenseStats(card) {
  const list = cardSenseList(card);
  if (!list) return null;
  const view = senseStatsView(card, list);
  card.senses = Object.assign({}, card.senses || {});
  list.forEach(s => { card.senses[s.key] = Object.assign({}, view[s.key]); });
  return list;
}
function recomputeCardFromSenses(card) {
  const list = cardSenseList(card);
  if (!list || !card.senses) return;
  const ss = list.map(s => card.senses[s.key]).filter(Boolean);
  if (!ss.length) return;
  const num = (s, f) => Number(s[f]) || 0;
  card.level = Math.min(...ss.map(s => num(s, 'level')));
  card.correct = ss.reduce((a, s) => a + num(s, 'correct'), 0);
  card.incorrect = ss.reduce((a, s) => a + num(s, 'incorrect'), 0);
  card.level5Correct = card.level >= 5 ? Math.min(...ss.map(s => num(s, 'level5Correct'))) : 0;
  card.streak = Math.min(...ss.map(s => num(s, 'streak')));
  card.wrongStreak = Math.max(...ss.map(s => num(s, 'wrongStreak')));
  card.shikkariStreak = Math.min(...ss.map(s => num(s, 'shikkariStreak')));
}

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
      if(p.catSkip) catSkip=p.catSkip;
      if(p.studyPlan) studyPlan=p.studyPlan;
      if(p.studyDays) studyDays=p.studyDays;
      if(p.drillProgress) drillProgress=p.drillProgress;
      if(p.calEvents) calEvents=p.calEvents;
      if(p.cardProg) cardProg=p.cardProg;
      if(p.gameDays) gameDays=p.gameDays;
      if(p.gameShop) gameShop=p.gameShop;
      if(p.quizOrderPos) quizOrderPos=p.quizOrderPos;
      if(p.ttsDict) ttsDict=p.ttsDict;
      if(p.drillQa) drillQa=p.drillQa;
      if(p.deletedCardsAt) deletedCardsAt=p.deletedCardsAt;
      if(p.docStamps) docStamps=p.docStamps;
      if(p.structAt) structAt=p.structAt;
    }
  } catch(e){
    // ★【0.03.13】保存データが壊れていて読めなかったときは、上書きして失う前に別の場所へ退避する
    console.error('保存データを読めませんでした:', e);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw && !localStorage.getItem(STORAGE_KEY + '_unreadable')) localStorage.setItem(STORAGE_KEY + '_unreadable', raw);
    } catch (e2) {}
    setTimeout(() => alert('⚠️ この端末の保存データを読み込めませんでした。\n読めなかったデータは別の場所に退避してあります。ログインしているならクラウドから復元されます。'), 0);
  }
  migrateSyncMeta();
  try { shareStats = localStorage.getItem('shareStats') !== 'false'; } catch(e){}
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
      q.correct = 0; q.incorrect = 0; delete q.senses; touchStats(q); fixed++;
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
  const skip = {};
  Object.keys(catSkip || {}).sort().forEach(k => { skip[k] = catSkip[k]; });
  return JSON.stringify([categories, tree, [...(subscribedDocs || [])].sort(), [...(ownedDocs || [])].sort(), subj, skip]);
}
// フォルダー構造が変わっていれば変更時刻を更新する（クラウドから取り込んだ変更では呼ばない）
function updateStructStamp() {
  const h = structFingerprint();
  if (_structHash !== null && h !== _structHash) structAt = Date.now();
  _structHash = h;
}

function buildSyncPayload() {
  return { db, categories, categoryTree, subscribedDocs, ownedDocs, deletedCards, deletedCardsAt, deletedCats, catStamps, docStamps, structAt, catSubjects, catSkip, studyPlan, studyDays, drillProgress, quizOrderPos, ttsDict, drillQa, calEvents, cardProg, gameDays, gameShop };
}

let _quotaWarned = false;
let _localWriteTimer = null;
function writeLocal() {
  if (_localWriteTimer) { clearTimeout(_localWriteTimer); _localWriteTimer = null; }
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

// ★【0.03.09】カードが多いと保存（全データの書き出し）が重いので、続けて保存するときは少し待ってまとめて書く
function flushLocalWrite() { if (_localWriteTimer) writeLocal(); }
function flushPendingSaves() {
  flushLocalWrite();
  if (syncTimeout && currentUser && cloudReady) { clearTimeout(syncTimeout); syncTimeout = null; backgroundCloudSave(); }
}
function saveData(immediate = false) {
  ensureSystemSanity();
  updateStructStamp();
  if (immediate) writeLocal();
  else if (!_localWriteTimer) _localWriteTimer = setTimeout(writeLocal, 400);
  if (currentUser && cloudReady) {
    clearTimeout(syncTimeout);
    setSyncStatus('saving', '🔄 保存中...');
    // クイズ中は解くたびにクラウドへ送ると重いので、間隔を空けてまとめて送る（画面を閉じる時・クイズ終了時にはすぐ送る）
    const delay = document.body && document.body.classList.contains('in-quiz') ? 8000 : 1500;
    if (immediate) { syncTimeout = null; backgroundCloudSave(); }
    else syncTimeout = setTimeout(() => { syncTimeout = null; backgroundCloudSave(); }, delay);
  }
  if (typeof updateHomeSummary === 'function') { try { updateHomeSummary(); } catch (e) {} }
}

function setSyncStatus(state, text) {
  const el = document.getElementById('cloudSyncStatus');
  if(!el) return;
  el.className = `sync-status ${state}`;
  el.innerText = text;
  clearTimeout(el._hideT);
  // ★【0.04.61】うまく読み込めなかったときは、押せば読み込み直せるように長めに出しておく
  if (state === 'success' || state === 'error') el._hideT = setTimeout(() => el.classList.add('hidden'), 3000);
  if (String(state).includes('retry')) el._hideT = setTimeout(() => el.classList.add('hidden'), 15000);
}

function userDocRef() { return firestore.collection("susuru_anki_users").doc(currentUser.uid); }

// ================================================================
// ★【0.03.04】クラウド保存の圧縮
// Firestoreは1ドキュメント1MBまで。カードが3000枚ほどになるとそのままでは保存できず同期エラーになっていたため、
// カード一覧(db)をgzipで圧縮してバイナリ(Blob)で保存する（だいたい1/5になる）。
// フォルダー構造などの小さい情報は今まで通りそのまま保存する（旧バージョンの端末がフォルダーを消してしまわないように）
// ================================================================
let _cloudForceParts = false; // ★【0.04.66】Firestore に大きすぎると断られたら、次からは分けて保存する
const CLOUD_DOC_LIMIT = 1000000; // 余裕を見て約1MB未満に収める（Firestore の上限は 1,048,576 バイト）
class CloudTooLargeError extends Error {}
// ★【0.04.66】Firestore と同じ数え方で、ドキュメントの大きさを見積もる（文字は UTF-8＋1、数は8、真偽・null は1、
//  バイナリはそのバイト数、地図は「項目名（UTF-8＋1）＋値」の合計、配列は値の合計、ドキュメントに＋32）。
//  前は JSON の文字数で見積もっていたので、数がたくさんある記録（日ごとの数・カードモードの成績など）で小さく見積もりすぎ、
//  1MB ぎりぎりのときに Firestore に「大きすぎる」（invalid-argument）と断られていた
function fsSize(v) {
  if (v === null || v === undefined) return 1;
  const t = typeof v;
  if (t === 'string') return utf8Bytes(v) + 1;
  if (t === 'number') return 8;
  if (t === 'boolean') return 1;
  if (v instanceof Uint8Array) return v.length;
  if (typeof v.toUint8Array === 'function') return v.toUint8Array().length; // Firestore の Blob
  if (typeof v._methodName === 'string' || (v.constructor && /FieldValue/.test(v.constructor.name || ''))) return 8; // serverTimestamp など
  if (Array.isArray(v)) return v.reduce((a, x) => a + fsSize(x), 0);
  if (t === 'object') { let n = 0; for (const k in v) { if (v[k] === undefined) continue; n += utf8Bytes(k) + 1 + fsSize(v[k]); } return n; }
  return 8;
}
// 本体に付ける項目（version・writer・writeId・lastSync）と、ドキュメントの名前の分
const CLOUD_DOC_EXTRA = 400;
function utf8Bytes(str) { return (typeof TextEncoder !== 'undefined') ? new TextEncoder().encode(str).length : unescape(encodeURIComponent(str)).length; }
function encodeCloudBody(payload) {
  // カード一覧の書き出しは1回だけにする（undefined は JSON.stringify で消える）
  const dbJson = JSON.stringify(payload.db || []);
  const body = JSON.parse(JSON.stringify(Object.assign({}, payload, { db: undefined })));
  let size;
  if (typeof pako !== 'undefined' && firebase.firestore && firebase.firestore.Blob) {
    const gz = pako.gzip(dbJson);
    delete body.db;
    body.dbFormat = 'gzip-json-v1';
    // ★【0.03.73】暗記テストの途中経過も圧縮して入れる
    let dp = null;
    if (body.drillProgress && Object.keys(body.drillProgress).length) { dp = pako.gzip(JSON.stringify(body.drillProgress)); delete body.drillProgress; }
    let qa = null; // ★【0.03.91】暗記テストの質問も縮めて入れる
    if (body.drillQa && Object.keys(body.drillQa).length) { qa = pako.gzip(JSON.stringify(body.drillQa)); delete body.drillQa; }
    size = fsSize(body) + gz.length + 8 + (dp ? dp.length + 8 : 0) + (qa ? qa.length + 8 : 0) + CLOUD_DOC_EXTRA + 32; // ★【0.04.66】Firestore と同じ数え方
    body.dbGz = firebase.firestore.Blob.fromUint8Array(gz);
    if (dp) body.dpGz = firebase.firestore.Blob.fromUint8Array(dp);
    if (qa) body.qaGz = firebase.firestore.Blob.fromUint8Array(qa);
  } else {
    body.db = JSON.parse(dbJson);
    size = fsSize(body) + CLOUD_DOC_EXTRA + 32;
  }
  if (size > CLOUD_DOC_LIMIT || _cloudForceParts) {
    // ★【0.04.64】1MB に収まらないときは、カード・暗記テストの途中経過・質問をまとめて圧縮し、900KB ずつに分けて
    //  susuru_anki_users/{uid}/parts/p0, p1, … に置く（最大9つ＝約8MB）。本体には小さい情報と、分けた数だけを入れる
    if (typeof pako === 'undefined' || !(firebase.firestore && firebase.firestore.Blob)) { const err = new CloudTooLargeError('too_large'); err.size = size; throw err; }
    // ★【0.04.66】フォルダーの構造など前の版の端末が使う小さいもの（CLOUD_KEEP_PLAIN）だけを本体に残し、ほかは全部まとめて分ける。
    //  それでも本体が大きいときは、それも分ける
    const clean = JSON.parse(JSON.stringify(payload));
    let plainKeys = CLOUD_KEEP_PLAIN.filter(k => clean[k] !== undefined);
    if (fsSize(Object.fromEntries(plainKeys.map(k => [k, clean[k]]))) > CLOUD_DOC_LIMIT / 2) plainKeys = [];
    const bundleObj = {}, small = {};
    Object.keys(clean).forEach(k => { if (plainKeys.includes(k)) small[k] = clean[k]; else bundleObj[k] = clean[k]; });
    const bundle = pako.gzip(JSON.stringify(bundleObj));
    const parts = [];
    for (let i = 0; i < bundle.length; i += CLOUD_PART_SIZE) parts.push(bundle.subarray(i, i + CLOUD_PART_SIZE));
    small.dbFormat = 'parts-v2'; small.parts = parts.length; small.partsLen = bundle.length;
    const total = bundle.length + fsSize(small);
    if (parts.length > CLOUD_MAX_PARTS || fsSize(small) + CLOUD_DOC_EXTRA + 32 > CLOUD_DOC_LIMIT) { const err = new CloudTooLargeError('too_large'); err.size = total; err.parts = true; throw err; }
    Object.defineProperty(small, '_parts', { value: parts, enumerable: false });
    return small;
  }
  return body;
}
const CLOUD_PART_SIZE = 900000, CLOUD_MAX_PARTS = 9;
// 分けて保存するときも本体に残すもの（前の版の端末がフォルダーを消さないように）
const CLOUD_KEEP_PLAIN = ['categories', 'categoryTree', 'deletedCats', 'catStamps', 'subscribedDocs', 'ownedDocs', 'structAt', 'docStamps', 'catSubjects', 'catSkip'];
function cloudPartRef(i) { return userDocRef().collection('parts').doc('p' + i); }
function blobBytes(b) { return typeof b.toUint8Array === 'function' ? b.toUint8Array() : b; }
// ★【0.04.64】分けて置いたデータも読み戻す。getPart(i) は p◯ の snapshot を返す関数（ふつうの get でも、トランザクションの get でも）
//  分けた部分の writeId が本体と違う（読んでいるあいだに別の端末が書いた）ときは、読み直す
async function decodeCloudDocFull(r, getPart) {
  if (!r || (r.dbFormat !== 'parts-v1' && r.dbFormat !== 'parts-v2')) return decodeCloudDoc(r);
  if (typeof pako === 'undefined') throw new Error('圧縮データを読むためのライブラリ(pako)を読み込めませんでした。通信状態を確認して再読み込みしてください。');
  const n = Number(r.parts) || 0, snaps = await Promise.all(Array.from({ length: n }, (_, i) => getPart(i)));
  const arrs = snaps.map((sn, i) => { const d = sn && sn.exists ? sn.data() : null; if (!d || !d.d || d.writeId !== r.writeId) { const e = new Error('parts_mismatch'); e.code = 'parts_mismatch'; throw e; } return blobBytes(d.d); });
  const len = arrs.reduce((a, x) => a + x.length, 0), all = new Uint8Array(len); let off = 0; arrs.forEach(x => { all.set(x, off); off += x.length; });
  const big = JSON.parse(pako.ungzip(all, { to: 'string' }));
  const out = Object.assign({}, r, big, { db: big.db || [], drillProgress: big.drillProgress || {}, drillQa: big.drillQa || {} }); // ★【0.04.66】parts-v2 は、ほかの記録もまとめて入っている
  delete out.parts; delete out.partsLen; delete out.dbFormat;
  return out;
}
// 普通に読む（分けた部分が途中で書きかわっていたら、少し待って3回まで読み直す）
async function readCloudDocFull(raw) {
  for (let k = 0; ; k++) {
    try { return await decodeCloudDocFull(raw, i => withTimeout(cloudPartRef(i).get(), 25000, 'クラウドからの読み込み')); }
    catch (e) {
      if (e.code !== 'parts_mismatch' || k >= 2) throw e;
      await new Promise(r => setTimeout(r, 1200));
      const sn = await withTimeout(userDocRef().get(), 25000, 'クラウドからの読み込み'); raw = sn.data() || {};
    }
  }
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
    if (r.qaGz) { try { const b3 = typeof r.qaGz.toUint8Array === 'function' ? r.qaGz.toUint8Array() : r.qaGz; out.drillQa = JSON.parse(pako.ungzip(b3, { to: 'string' })); } catch (e) { console.warn(e); } delete out.qaGz; }
    if (r.dpGz) { try { const b2 = typeof r.dpGz.toUint8Array === 'function' ? r.dpGz.toUint8Array() : r.dpGz; out.drillProgress = JSON.parse(pako.ungzip(b2, { to: 'string' })); } catch (e) { console.warn(e); } delete out.dpGz; }
    return out;
  }
  return r;
}
let _tooLargeWarned = false;
function reportCloudSaveError(err) {
  console.warn('クラウド保存エラー:', err);
  // ★【0.04.66】見積もりより大きくて断られた（invalid-argument）：分けて保存し直す（1回だけ）
  if (err && err.code === 'invalid-argument' && !_cloudForceParts) {
    _cloudForceParts = true;
    setSyncStatus('saving', '☁️ 分けて保存し直しています…');
    setTimeout(() => backgroundCloudSave(), 800);
    return;
  }
  if (err instanceof CloudTooLargeError) {
    setSyncStatus('error', '⚠️ 容量オーバーで保存できません');
    if (!_tooLargeWarned) {
      _tooLargeWarned = true;
      alert(`⚠️ データが大きすぎてクラウドに保存できません（圧縮して約${Math.round(err.size / 1024)}KB / 上限 約8MB）。\n\nカードに添付した画像が容量の大部分を占めていることが多いです。画像付きのカードを減らすか、不要なカードを削除してください。\n（この端末には保存されています）`);
    }
  } else {
    setSyncStatus('error', `⚠️ 保存エラー: ${err && (err.code || err.message) || ''}`.slice(0, 60));
    // ★【0.04.64】分けて置く場所（parts）は Firestore のルールに足してある。ルールを公開し直していないと書けない
    if (err && err.code === 'permission-denied' && !_partsRuleWarned) { _partsRuleWarned = true; alert('⚠️ クラウドに保存できませんでした（権限がありません）。\nデータが1MBを超えたので、分けて保存する場所を使います。管理者の方は、Firebase のコンソールで Firestore のルール（docs/firestore.rules）を公開し直してください。\n（この端末には保存されています）'); }
  }
}
let _partsRuleWarned = false;

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
      let prevParts = 0;
      if (snap.exists) {
        // 自分が最後に書いた内容のままなら、展開（重い）せずにそのまま上書きする
        const raw = snap.data() || {};
        prevParts = /^parts-v/.test(raw.dbFormat || '') ? Number(raw.parts) || 0 : 0;
        if (!raw.writeId || (raw.writeId !== _lastSeenWriteId && !_myWriteIds.includes(raw.writeId))) { mergeIntoLocal(await decodeCloudDocFull(raw, i => tx.get(cloudPartRef(i)))); merged = true; }
      }
      writeId = newWriteId();
      // undefined を含むとFirestoreが拒否するので、JSONを通して取り除く。カード一覧は圧縮する（大きいときは分ける）
      const body = encodeCloudBody(buildSyncPayload());
      const parts = body._parts || [];
      tx.set(ref, {
        ...body,
        version: typeof APP_VERSION !== 'undefined' ? APP_VERSION : "unknown",
        writer: DEVICE_ID, writeId,
        lastSync: firebase.firestore.FieldValue.serverTimestamp()
      });
      parts.forEach((u8, i) => tx.set(cloudPartRef(i), { d: firebase.firestore.Blob.fromUint8Array(u8), writeId, i, n: parts.length }));
      for (let i = parts.length; i < prevParts; i++) tx.delete(cloudPartRef(i)); // 前より少なくなった分を消す
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
    catSkip: (() => { const o = Object.assign({}, older.catSkip || {}, newer.catSkip || {}); Object.keys(o).forEach(k => { if (!aliveSet.has(k)) delete o[k]; }); return o; })(),
    structAt: Math.max(L.structAt || 0, C.structAt || 0),
    studyPlan: mergeStudyPlans(L.studyPlan, C.studyPlan),
    studyDays: mergeStudyDays(L.studyDays, C.studyDays),
    drillProgress: mergeStampedMap(L.drillProgress, C.drillProgress, 30),
    quizOrderPos: mergeStampedMap(L.quizOrderPos, C.quizOrderPos, 365),
    ttsDict: mergeStampedMap(L.ttsDict, C.ttsDict, 365),
    drillQa: mergeDrillQa(L.drillQa, C.drillQa),
    calEvents: mergeStampedMap(L.calEvents, C.calEvents, 120),
    cardProg: mergeStampedMap(L.cardProg, C.cardProg, 365),
    gameDays: mergeStudyDays(L.gameDays, C.gameDays),
    gameShop: mergeStampedMap(L.gameShop, C.gameShop, 3650),
    subscribedDocs: subs, ownedDocs: owned
  };
}

// クラウドの状態をこの端末に取り込む（書き戻しはしない）
function mergeIntoLocal(r) {
  const merged = mergeSyncStates(buildSyncPayload(), r);
  db = merged.db; categories = merged.categories; categoryTree = merged.categoryTree;
  deletedCards = merged.deletedCards; deletedCardsAt = merged.deletedCardsAt; deletedCats = merged.deletedCats;
  catStamps = merged.catStamps; docStamps = merged.docStamps; structAt = merged.structAt; catSubjects = merged.catSubjects || {}; catSkip = merged.catSkip || {}; studyPlan = merged.studyPlan || null; studyDays = merged.studyDays || {}; drillProgress = merged.drillProgress || {}; quizOrderPos = merged.quizOrderPos || {}; ttsDict = merged.ttsDict || {}; drillQa = merged.drillQa || {}; calEvents = merged.calEvents || {}; cardProg = merged.cardProg || {}; gameDays = merged.gameDays || {}; gameShop = merged.gameShop || {};
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
    catStamps: p.catStamps || {}, docStamps: p.docStamps || {}, structAt: p.structAt || 0, catSubjects: p.catSubjects || {}, catSkip: p.catSkip || {}, studyPlan: p.studyPlan || null, studyDays: p.studyDays || {}, drillProgress: p.drillProgress || {}, quizOrderPos: p.quizOrderPos || {}, ttsDict: p.ttsDict || {}, drillQa: p.drillQa || {}, calEvents: p.calEvents || {}, cardProg: p.cardProg || {}, gameDays: p.gameDays || {}, gameShop: p.gameShop || {},
    subscribedDocs: [...(p.subscribedDocs || [])].sort(), ownedDocs: [...(p.ownedDocs || [])].sort()
  });
}

function refreshVisibleViews(contentChanged = true) {
  const isActive = id => { const el = document.getElementById(id); return el && el.classList.contains('active'); };
  try {
    if (contentChanged) {
      if (isActive('pgTree') && typeof renderTree === 'function') renderTree();
      if (isActive('pgBox') && typeof renderBox === 'function') renderBox();
      if (isActive('pgHome') || isActive('pgQuiz')) { if (typeof buildQuizScopeDropdown === 'function') buildQuizScopeDropdown(); if (typeof renderPlanHome === 'function') renderPlanHome(); }
    }
    if (typeof updateHomeSummary === 'function') updateHomeSummary();
    if (isActive('pgDrill') && typeof _drillActive !== 'undefined' && !_drillActive && typeof drillHome === 'function') drillHome(); // ほかの端末の途中経過
  } catch (e) { console.warn(e); }
}

// 他の端末での変更をリアルタイムに取り込む
function startCloudListener() {
  if (!currentUser) return;
  if (cloudUnsubscribe) { cloudUnsubscribe(); cloudUnsubscribe = null; }
  cloudUnsubscribe = userDocRef().onSnapshot(async snap => {
    if (!snap.exists || (snap.metadata && snap.metadata.hasPendingWrites)) return;
    const raw = snap.data() || {};
    if (raw.writeId && (_myWriteIds.includes(raw.writeId) || raw.writeId === _lastSeenWriteId)) return;
    let r;
    try { r = await readCloudDocFull(raw); } catch (e) { console.warn(e); setSyncStatus('error', '⚠️ 同期データを読めませんでした'); return; }
    if (r.writeId && (r.writeId === _lastSeenWriteId || _myWriteIds.includes(r.writeId))) return; // 読み直したら自分の書いたものだった
    _lastSeenWriteId = r.writeId || raw.writeId || null;
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
  Object.keys(catSkip || {}).forEach(k => { if (!categories.includes(k)) delete catSkip[k]; });

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
    if (q.kind === 'intro') { if (q.no !== undefined) delete q.no; return; } // ★【0.03.55】導入の文は番号なし
    if (q.no !== undefined && q.no !== null && q.no !== '') {
      const n = Number(q.no);
      // ★【0.03.45】派生語・熟語の 1000.01 / 1000.0001 のような小数の番号はそのまま（「1000-1」と表示）
      if (Number.isFinite(n) && n > 0) { q.no = Math.round(n * 10000) / 10000; maxNo[q.category] = Math.max(maxNo[q.category] || 0, Math.floor(q.no)); }
      else delete q.no;
    }
  });
  db.forEach(q => {
    if (q.kind === 'intro' || q.kind === 'test') return; // ★【0.03.55】導入の文・Check! には番号を振らない（ほかのフォルダーの番号と重なって見えていた）
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
      CARD_STAT_FIELDS.forEach(f => { if (f === 'senses' || f === 'drillStats') { if (!keep[f] && dup[f]) keep[f] = dup[f]; return; } keep[f] = Math.max(Number(keep[f]) || 0, Number(dup[f]) || 0); });
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
let _accountMergePending = false; // 別アカウントのデータを今のアカウントに統合するところ
// ★【0.03.02】この端末のデータが別のアカウントのものだった場合の扱いを決める
function resolveAccountSwitch() {
  let owner = null;
  try { owner = localStorage.getItem(OWNER_UID_KEY); } catch (e) {}
  const hasLocal = db.length > 0 || categories.length > 1;
  if (owner && owner !== currentUser.uid && hasLocal) {
    const merge = confirm('この端末には、別のGoogleアカウントで使っていたデータがあります。\n\nOK：この端末のデータを今のアカウントに統合する（カード・フォルダー・教科タグ・購読をすべて両方残します）\nキャンセル：この端末のデータを今のアカウントのデータに置き換える（統合しない。この端末のデータは「復元ポイント」に保存されます）');
    if (!merge) {
      takeSnapshot('アカウント変更（置き換え）');
      db = []; categories = ['未分類']; categoryTree = {}; subscribedDocs = []; ownedDocs = [];
      deletedCards = []; deletedCardsAt = {}; deletedCats = []; catStamps = {}; docStamps = {}; structAt = 0; catSubjects = {}; catSkip = {}; studyPlan = null; studyDays = {}; drillProgress = {}; quizOrderPos = {}; ttsDict = {}; drillQa = {}; calEvents = {}; cardProg = {}; gameDays = {}; gameShop = {};
      sharedDocPermissions = {};
      _structHash = structFingerprint(); writeLocal();
    } else {
      // 統合は、クラウドのデータを読んでから行う（同期が成功するまでは「前のアカウントのデータ」のまま）
      _accountMergePending = true;
      return;
    }
  }
  try { localStorage.setItem(OWNER_UID_KEY, currentUser.uid); } catch (e) {}
}

// ★【0.03.11】アカウントを変えて統合するときは、両方のデータをすべて残す
// 通常の同期は「削除の記録」も同期するため、そのままだと片方のアカウントで昔消したフォルダー・カードが
// もう一方のデータまで消してしまう。統合のときは、どちらかに今あるものの削除記録を取り消してから合わせる。
// フォルダーの親子関係が食い違うものは今のアカウント（クラウド）側を優先し、片方にしか無いフォルダーはその親の下に入れる。
// r（取り込む側）と今の端末のデータの、どちらかに今あるものの削除記録を取り消す（JSONの統合取り込みでも使う）
function reconcileUnionState(r) {
  const now = Date.now();
  r = Object.assign({}, r);
  const namesOf = (cats, tree) => {
    const set = new Set((cats || []).filter(Boolean));
    Object.keys(tree || {}).forEach(p => { set.add(p); (tree[p] || []).forEach(c => set.add(c)); });
    return set;
  };
  // カード：どちらかにあるカードの削除記録は消す
  const localIds = new Set(db.map(q => q.id));
  const cloudIds = new Set((r.db || []).map(q => q && q.id).filter(Boolean));
  r.deletedCardsAt = Object.assign({}, r.deletedCardsAt || {});
  localIds.forEach(id => { delete r.deletedCardsAt[id]; });
  r.deletedCards = (r.deletedCards || []).filter(id => !localIds.has(id));
  cloudIds.forEach(id => { delete deletedCardsAt[id]; });
  deletedCards = deletedCards.filter(id => !cloudIds.has(id));
  // フォルダー：どちらかにあるフォルダーは「今作った」ことにする（削除記録より新しくなる）
  const aliveNames = new Set([...namesOf(categories, categoryTree), ...namesOf(r.categories, r.categoryTree)]);
  r.catStamps = Object.assign({}, r.catStamps || {});
  aliveNames.forEach(n => {
    r.catStamps[n] = Object.assign({}, r.catStamps[n] || {}, { a: now });
    catStamps[n] = Object.assign({}, catStamps[n] || {}, { a: now });
  });
  r.deletedCats = (r.deletedCats || []).filter(n => !aliveNames.has(n));
  deletedCats = deletedCats.filter(n => !aliveNames.has(n));
  // 購読・所有している共有カテゴリー
  const aliveDocs = new Set([...(subscribedDocs || []), ...(ownedDocs || []), ...(r.subscribedDocs || []), ...(r.ownedDocs || [])]);
  r.docStamps = Object.assign({}, r.docStamps || {});
  aliveDocs.forEach(id => {
    r.docStamps[id] = Object.assign({}, r.docStamps[id] || {}, { a: now });
    docStamps[id] = Object.assign({}, docStamps[id] || {}, { a: now });
  });
  return r;
}
function prepareAccountMerge(r) {
  r = reconcileUnionState(r);
  // 親子関係・教科タグはクラウド（今のアカウント）を優先する
  structAt = 0;
  r.structAt = Math.max(1, r.structAt || 0);
  return r;
}
function finishAccountMerge(beforeLocal) {
  _accountMergePending = false;
  structAt = Date.now(); // 統合した構造を、このアカウントの他の端末にも反映させる
  _structHash = structFingerprint();
  try { localStorage.setItem(OWNER_UID_KEY, currentUser.uid); } catch (e) {}
  saveData(true);
  setTimeout(() => alert(`🔀 前のアカウントのデータを統合しました。\nカード: ${beforeLocal.cards}枚 ＋ ${beforeLocal.cloudCards}枚 → ${db.length}枚\nフォルダー: ${categories.length}個`), 0);
}

let _syncing = false, _syncStartedAt = 0, _syncRetryTimer = null, _syncFails = 0;
// ★【0.04.61】読み込みに制限時間を付ける（回線が悪いと、クラウドからの読み込みがいつまでも終わらず、同期中のまま止まっていた）
function withTimeout(promise, ms, label) {
  let t; return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => { const e = new Error((label || '読み込み') + 'に時間がかかりすぎました'); e.code = 'timeout'; rej(e); }, ms); })]).finally(() => clearTimeout(t));
}
// 読み込めなかったら、少しずつ間をあけて自動でやり直す（10秒・30秒・1分・2分…）
function scheduleSyncRetry() {
  clearTimeout(_syncRetryTimer);
  const wait = [10, 30, 60, 120, 300][Math.min(_syncFails - 1, 4)] * 1000;
  _syncRetryTimer = setTimeout(() => { if (currentUser && !cloudReady) syncToCloud(true); }, wait);
}
async function syncToCloud(isSilent = false) {
  if (!currentUser) { if (!isSilent) alert("Googleアカウントでログインしてください。"); return; }
  await dataLoaded; // 端末のデータを読み込む前にクラウドと合わせない
  if (_syncing && Date.now() - _syncStartedAt < 45000) return; // 45秒たっても終わらない同期は、止まったとみなしてやり直す
  _syncing = true; _syncStartedAt = Date.now();
  clearTimeout(_syncRetryTimer);
  try {
    resolveAccountSwitch();
    setSyncStatus('saving', '☁️ 読み込み中…');
    const snap = await withTimeout(userDocRef().get(), 25000, 'クラウドからの読み込み');
    // 最初の同期が終わるまではクラウドに書かない（古いデータでクラウドを上書きしないため）
    cloudReady = true;
    const merging = _accountMergePending;
    const mergeInfo = { cards: db.length, cloudCards: 0 };
    if (snap.exists) {
      let r = await readCloudDocFull(snap.data() || {}); // ★【0.04.64】分けて置いたデータも
      _lastSeenWriteId = r.writeId || null;
      if (merging) { mergeInfo.cloudCards = (r.db || []).length; r = prepareAccountMerge(r); }
      applyCloudState(r, { forcePush: true });
    } else {
      ensureSystemSanity(); autoMerge(true); writeLocal();
      await backgroundCloudSave();
    }
    if (merging) finishAccountMerge(mergeInfo);
    startCloudListener();
    refreshVisibleViews();
    _syncFails = 0;
    setSyncStatus('success', '☁️ 同期しました');
    if (typeof syncSubscriptions === 'function') await syncSubscriptions();
    if (!isSilent) { alert(`☁️ 同期完了！`); openPage('pgHome'); }
  } catch (err) {
    console.warn('同期エラー:', err);
    cloudReady = false;
    _syncFails++;
    scheduleSyncRetry();
    setSyncStatus('error retry', err && err.code === 'timeout' ? '⚠️ 読み込みに時間がかかっています（押すと再読み込み）' : `⚠️ 同期エラー（押すと再読み込み）: ${err && (err.code || err.message) || ''}`.slice(0, 70));
    if (!isSilent) alert(`⚠️ 同期エラー: ${err.message}\n(通信状態やFirebaseのルール設定などを確認してください)`);
  }
  finally { _syncing = false; }
}

// ★【0.03.02】オフラインで起動した・通信が切れた場合は、つながったときに同期をやり直す
if (typeof window !== 'undefined' && window.addEventListener) {
  const retrySync = () => { if (currentUser && !cloudReady) syncToCloud(true); };
  window.addEventListener('online', retrySync);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') retrySync(); else flushPendingSaves(); });
  window.addEventListener('pagehide', flushPendingSaves);
}
