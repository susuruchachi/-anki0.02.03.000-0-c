// ----------------- JSON / CSV 管理 -----------------
function exportJSON() {
  const blob = new Blob([JSON.stringify({ app: 'susuru_anki', version: typeof APP_VERSION !== 'undefined' ? APP_VERSION : '', exportedAt: Date.now(), db, categories, categoryTree, catSubjects }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `susuru_anki_${Date.now()}.json`; a.click();
}
// ★【0.03.12】JSONの取り込みは「今のデータに追加（統合）」か「置き換え」を選ぶ（以前は確認なしで全部置き換えていた）
function importJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = ''; // 同じファイルをもう一度選べるように
  const r = new FileReader(); r.onload = function(evt) {
    let p;
    try { p = JSON.parse(evt.target.result); } catch (err) { alert("無効なJSONです。"); return; }
    if (!p || !Array.isArray(p.db)) { alert("すするankiのバックアップ（JSON）ではないようです。"); return; }
    const n = p.db.length, nc = (p.categories || []).filter(c => c !== '未分類').length;
    openContextMenu(`📦 JSONの取り込み（カード${n}枚・フォルダー${nc}個）`, [
      { html: '🔀 今のデータに追加する（統合・おすすめ）<br><span style="font-size:0.75rem; color:var(--text3);">今のカード・フォルダーは残したまま、バックアップの分を足します。同じカードは今のデータを優先します</span>', action: () => importBackupMerge(p) },
      { html: '♻️ 今のデータを消して置き換える<br><span style="font-size:0.75rem; color:var(--text3);">今のカード・フォルダーは消え、バックアップの内容だけになります（他の端末からも消えます）。共有・購読中のカテゴリーはそのまま残ります</span>', danger: true, action: () => {
          if (confirm(`今のカード${db.filter(q => !isLiveSharedCard(q)).length}枚・フォルダーを消して、バックアップの内容に置き換えます。よろしいですか？\n（共有・購読中のカテゴリーはそのまま残ります。消す前の状態は「復元ポイント」から戻せます）`)) importBackupReplace(p);
        } },
      { type: 'separator' },
      { html: 'キャンセル', action: () => {} }
    ]);
  }; r.readAsText(file);
}
// バックアップのカード・フォルダーを取り込める形にそろえる
function normalizeBackup(p) {
  const cats = (Array.isArray(p.categories) ? p.categories : []).filter(c => typeof c === 'string' && c.trim() && !invalidCategoryName(c));
  const tree = {};
  Object.keys(p.categoryTree || {}).forEach(k => { if (!invalidCategoryName(k) && Array.isArray(p.categoryTree[k])) tree[k] = p.categoryTree[k].filter(c => typeof c === 'string' && c.trim() && !invalidCategoryName(c)); });
  const ids = new Set();
  const cards = p.db.filter(q => q && typeof q === 'object' && q.question != null).map(q => {
    const c = Object.assign({}, q);
    if (!c.id || ids.has(c.id)) c.id = newCardId();
    ids.add(c.id);
    if (!c.category) c.category = '未分類';
    ['level', 'correct', 'incorrect', 'streak', 'wrongStreak', 'shikkariStreak'].forEach(k => { if (typeof c[k] !== 'number') c[k] = 0; });
    return c;
  });
  cards.forEach(c => { if (!cats.includes(c.category)) cats.push(c.category); });
  if (!cats.includes('未分類')) cats.push('未分類');
  return { db: cards, categories: cats, categoryTree: tree, catSubjects: (p.catSubjects && typeof p.catSubjects === 'object') ? p.catSubjects : {} };
}
// 統合：今のデータを残したまま足す（どちらかにあるカード・フォルダーは削除記録より優先して残す）
function importBackupMerge(p) {
  takeSnapshot('JSONの取り込み（統合）');
  const b = normalizeBackup(p);
  const localIds = new Set(db.map(q => q.id));
  const before = db.length;
  // 今の端末に無いカードは「今取り込んだ」ことにする（他の端末の削除記録で消されないように）
  b.db.forEach(c => { if (!localIds.has(c.id)) { touchCard(c); touchStats(c); } });
  let r = { db: b.db, categories: b.categories, categoryTree: b.categoryTree, catSubjects: b.catSubjects,
    deletedCards: [], deletedCardsAt: {}, deletedCats: [], catStamps: {}, docStamps: {}, subscribedDocs: [], ownedDocs: [] };
  r = reconcileUnionState(r);
  r.structAt = -1; // 親子関係・教科タグが食い違うときは今のデータを優先する
  mergeIntoLocal(r);
  structAt = Date.now(); _structHash = structFingerprint();
  autoMerge(true);
  saveData(true);
  if (typeof refreshVisibleViews === 'function') refreshVisibleViews(true);
  alert(`📦 取り込みました（統合）。\nカード: ${before}枚 → ${db.length}枚\nフォルダー: ${categories.length}個`);
  openPage('pgHome');
}
// 共有・購読中のカテゴリーのカード（置き換え・全消去の対象にしない。消すと共有している全員の手元から消えてしまうため）
function isLiveSharedCard(q) {
  return !!(q && q.sharedDocId && ((subscribedDocs || []).includes(q.sharedDocId) || (ownedDocs || []).includes(q.sharedDocId)));
}
function liveSharedFolders() {
  const set = new Set();
  Object.keys(sharedMeta || {}).forEach(id => {
    if (!(subscribedDocs || []).includes(id) && !(ownedDocs || []).includes(id)) return;
    const root = sharedMeta[id] && sharedMeta[id].root;
    if (root && categories.includes(root)) getAllSubcategories(root).forEach(c => set.add(c));
  });
  db.forEach(q => { if (isLiveSharedCard(q)) set.add(q.category); });
  return set;
}
// 置き換え：今のカード・フォルダーを削除記録つきで消してから、バックアップの内容にする（共有・購読中のカテゴリーは残す）
function importBackupReplace(p) {
  takeSnapshot('JSONの取り込み（置き換え）');
  const b = normalizeBackup(p);
  const sharedCards = db.filter(isLiveSharedCard);
  const sharedIds = new Set(sharedCards.map(q => q.id));
  const sharedCats = liveSharedFolders();
  b.db = b.db.filter(c => !sharedIds.has(c.id)); // 共有中のカードは今の方を使う
  const keepIds = new Set([...b.db.map(c => c.id), ...sharedIds]);
  tombstoneCards(db.filter(q => !keepIds.has(q.id)).map(q => q.id));
  const keepCats = new Set([...b.categories, ...Object.keys(b.categoryTree), ...Object.values(b.categoryTree).flat(), ...sharedCats]);
  markCatsDeleted(categories.filter(c => !keepCats.has(c)));
  b.db.forEach(c => { touchCard(c); touchStats(c); delete deletedCardsAt[c.id]; });
  deletedCards = deletedCards.filter(id => !keepIds.has(id));
  // 共有中のフォルダーの親子関係は今のまま残す
  const tree = Object.assign({}, b.categoryTree);
  Object.keys(categoryTree).forEach(par => {
    (categoryTree[par] || []).forEach(ch => {
      if (!sharedCats.has(ch)) return;
      Object.keys(tree).forEach(k => { tree[k] = tree[k].filter(x => x !== ch); });
      (tree[par] = tree[par] || []).push(ch);
    });
  });
  const cats = [...new Set([...b.categories, ...categories.filter(c => sharedCats.has(c)), ...Object.keys(tree).filter(k => sharedCats.has(k) || categories.includes(k))])];
  const subj = Object.assign({}, b.catSubjects);
  Object.keys(catSubjects || {}).forEach(k => { if (sharedCats.has(k) && subj[k] === undefined) subj[k] = catSubjects[k]; });
  db = [...b.db, ...sharedCards]; categories = cats; categoryTree = tree; catSubjects = subj;
  categories.forEach(c => markCatCreated(c));
  Object.keys(categoryTree).forEach(k => { markCatCreated(k); categoryTree[k].forEach(markCatCreated); });
  structAt = Date.now();
  ensureSystemSanity(); autoMerge(true);
  saveData(true);
  if (typeof refreshVisibleViews === 'function') refreshVisibleViews(true);
  alert(`📦 取り込みました（置き換え）。\nカード: ${db.length}枚`);
  openPage('pgHome');
}
function exportCSV() {
  let lines = [["問題", "答え", "フォルダー", "番号", "メモ", "選択肢", "形式", "星", "レベル", "正解数", "不正解数"]];
  sortCardsByNumber([...db]).forEach(q => lines.push([q.question, q.answer, getCategoryPathString(q.category), q.no || '', q.note || '', Array.isArray(q.choices) ? q.choices.join(' / ') : '', q.kind === 'test' ? 'テスト' : q.kind === 'cloze' ? '例文' : q.kind === 'self' ? '自己申告' : '', starsText(q.stars), q.level, q.correct, q.incorrect]));
  const csv = lines.map(l => l.map(t => `"${String(t === undefined || t === null ? '' : t).replace(/"/g, '""')}"`).join(",")).join("\n");
  const b = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `susuru_anki_${Date.now()}.csv`; a.click();
}
// 「親>子>孫」形式のフォルダーパス（CSVで書き出して、そのまま取り込み直せるように）
function getCategoryPathString(cat) {
  try { return getCategoryPath(cat).join('>'); } catch (e) { return cat; }
}
// ★【0.03.01】フォルダー欄に「親>子>孫」と書くと、入れ子のフォルダーを作ってその一番下に入れる
function ensureCategoryPath(path) {
  const parts = String(path || '').split('>').map(x => x.trim()).filter(x => x !== '');
  if (parts.length === 0) parts.push('未分類');
  for (let i = 0; i < parts.length; i++) { if (invalidCategoryName(parts[i])) parts[i] = parts[i].replace(/^__|__$/g, '_').slice(0, 100); }
  let parent = null;
  parts.forEach(name => {
    if (!categories.includes(name)) { markCatCreated(name); categories.push(name); }
    if (parent) {
      const alreadyChild = Object.keys(categoryTree).some(p => (categoryTree[p] || []).includes(name));
      if (!alreadyChild) {
        if (!categoryTree[parent]) categoryTree[parent] = [];
        categoryTree[parent].push(name);
      }
    }
    parent = name;
  });
  return parts[parts.length - 1];
}

// ★【0.03.02】CSVを正しく解析する（「"」で囲まれた欄の中の改行・カンマにも対応）
function parseCSVText(text) {
  const rows = []; let row = [], cur = '', inQ = false;
  text = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(x => x.trim() !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some(x => x.trim() !== '')) rows.push(row);
  return rows;
}
// 「a / b / c」形式の選択肢欄を配列にする
function parseChoicesCell(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const arr = s.split(/\s*[\/／|]\s*/).map(x => x.trim()).filter(x => x !== '');
  return arr.length >= 2 ? arr : null;
}

// ★【0.03.13】フォルダー欄の「親>子」から、作らずに一番下のフォルダー名だけを求める（確認前にフォルダーを作らないため）
function categoryPathLeaf(path) {
  const parts = String(path || '').split('>').map(x => x.trim()).filter(x => x !== '');
  if (!parts.length) return '未分類';
  let leaf = parts[parts.length - 1];
  if (invalidCategoryName(leaf)) leaf = leaf.replace(/^__|__$/g, '_').slice(0, 100);
  return leaf;
}
// ★【0.03.13】CSVの取り込み
//  ・まず取り込んだ結果を計算し、既にあるカードが書き換わる場合は「更新する／追加だけ」を選んでから反映する
//  ・メモ・選択肢・形式の欄が空のときは、手元のカードの内容を消さない（以前は、メモ欄が空のCSVを取り込むとクイズ中に書いたメモが消えていた）
//  ・閲覧専用の共有カテゴリーのカードは書き換えない（次の同期で元に戻るだけなので）
function importCSV(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  const r = new FileReader(); r.onload = function(evt) {
    let plan;
    try { plan = planCSVImport(parseCSVText(evt.target.result)); }
    catch (err) { console.error(err); alert("CSV解析に失敗しました。"); return; }
    if (!plan) return;
    const adds = plan.filter(x => x.type === 'add').length;
    const ups = plan.filter(x => x.type === 'update');
    if (!adds && !ups.length) { alert('📊 新しいカードも、変更のあるカードもありませんでした。'); return; }
    if (!ups.length) { applyCSVImport(plan, false); return; }
    const ansCh = ups.filter(x => x.changes.includes('答え') || x.changes.includes('問題')).length;
    const sample = ups.slice(0, 3).map(x => `・${escapeHtml(String(x.ex.question).slice(0, 18))}（${x.changes.join('・')}）`).join('<br>');
    openContextMenu(`📊 CSV：新しいカード ${adds}枚／既にあるカードの変更 ${ups.length}枚`, [
      { html: `🔄 追加して、既にあるカードも更新する<br><span style="font-size:0.75rem; color:var(--text3);">問題・答えが変わるカード ${ansCh}枚、メモ・選択肢などが変わるカード ${ups.length - ansCh}枚。成績はそのまま。CSVで空欄のメモは消しません<br>${sample}</span>`, action: () => applyCSVImport(plan, true) },
      { html: `➕ 新しいカードだけ追加する（既にあるカードは変えない）`, action: () => applyCSVImport(plan, false) },
      { type: 'separator' },
      { html: 'キャンセル', action: () => {} }
    ]);
  }; r.readAsText(file);
}

function planCSVImport(rows) {
  if (rows.length < 2) { alert("データがありません。"); return null; }
  const h = rows[0].map(x => x.trim());
  let iQ = h.indexOf("問題"), iA = h.indexOf("答え"), iC = h.indexOf("フォルダー");
  const iN = h.indexOf("メモ"), iCh = h.indexOf("選択肢"), iK = h.indexOf("形式"), iNo = h.indexOf("番号");
  const iSt = h.findIndex(x => /^(星|★|難易度|重要度)$/.test(x)); // ★【0.03.27】難易度の星
  if (iQ === -1) iQ = 0; if (iA === -1) iA = 1; if (iC === -1) iC = 2;
  const usedIds = new Set();
  const plan = [];
  const qKey = t => String(t).replace(/[（(][0-9０-９]+(?:つ|段階|種類|個)[）)]/g, '').trim();
  for (let i = 1; i < rows.length; i++) {
    const c = rows[i]; if (c.length <= Math.max(iQ, iA)) continue;
    let q = c[iQ]?.trim(); const a = c[iA]?.trim(); if (!q || !a) continue;
    // 星：「星」列、または問題の後ろの「★★」
    const qs = splitQuestionStars(q); q = qs.q;
    const stars = iSt !== -1 && String(c[iSt] || '').trim() ? parseStars(c[iSt]) : qs.stars;
    let catPath = (iC !== -1 && c[iC]) ? c[iC].trim() : "未分類"; if (!catPath) catPath = "未分類";
    const cat = categoryPathLeaf(catPath);
    const note = iN !== -1 ? String(c[iN] || '').trim() : '';
    const choices = iCh !== -1 ? parseChoicesCell(c[iCh]) : null;
    const kindRaw = iK !== -1 ? String(c[iK] || '').trim() : '';
    const kind = /テスト|test/i.test(kindRaw) ? 'test' : /例文|cloze/i.test(kindRaw) ? 'cloze' : /自己申告|self/i.test(kindRaw) ? 'self' : '';
    const noNum = iNo !== -1 ? parseInt(String(c[iNo] || '').replace(/[^0-9]/g, ''), 10) : NaN;
    const no = Number.isFinite(noNum) && noNum > 0 ? noNum : null;
    // 同じフォルダーに同じ問題があれば、重複させずに更新する（同じ問題・同じ答え → 同じ問題が1枚だけ → 「（2つ）」などの数だけ違う）
    let ex = db.find(d => d.category === cat && String(d.question).trim() === q && String(d.answer).trim() === a && !usedIds.has(d.id));
    if (!ex) {
      const sameQ = db.filter(d => d.category === cat && String(d.question).trim() === q);
      if (sameQ.length === 1 && !usedIds.has(sameQ[0].id)) ex = sameQ[0];
    }
    if (!ex) { const k = qKey(q); ex = db.find(d => d.category === cat && !usedIds.has(d.id) && String(d.answer).trim() === a && qKey(d.question) === k); }
    if (ex) {
      usedIds.add(ex.id);
      if (ex.sharedDocId && getSharedAccess(ex.sharedDocId).readOnly) { plan.push({ type: 'same' }); continue; }
      const upd = {};
      const changes = [];
      if (String(ex.question) !== q) { upd.question = q; changes.push('問題'); }
      if (String(ex.answer) !== a) { upd.answer = a; changes.push('答え'); }
      if (note && note !== (ex.note || '')) { upd.note = note; changes.push('メモ'); }
      if (choices && JSON.stringify(choices) !== JSON.stringify(ex.choices || null)) { upd.choices = choices; changes.push('選択肢'); }
      if (kind && kind !== (ex.kind || '')) { upd.kind = kind; changes.push('形式'); }
      if (no && no !== ex.no) { upd.no = no; changes.push('番号'); }
      if (stars && stars !== (ex.stars || 0)) { upd.stars = stars; changes.push('星'); }
      plan.push(changes.length ? { type: 'update', ex, upd, changes, cat } : { type: 'same' });
      continue;
    }
    plan.push({ type: 'add', q, a, catPath, note, choices, kind, no, stars });
  }
  return plan;
}

function applyCSVImport(plan, withUpdates) {
  if (withUpdates) takeSnapshot('CSVの取り込み（更新）');
  let added = 0, updated = 0;
  const touchedCats = new Set();
  plan.forEach(x => {
    if (x.type === 'update' && withUpdates) {
      const ex = db.find(d => d.id === x.ex.id); if (!ex) return;
      Object.assign(ex, x.upd); touchCard(ex); updated++; touchedCats.add(ex.category);
    } else if (x.type === 'add') {
      const cat = ensureCategoryPath(x.catPath);
      const card = { id: newCardId(), question: x.q, answer: x.a, category: cat, level: 0, correct: 0, incorrect: 0, streak: 0, wrongStreak: 0, shikkariStreak: 0 };
      if (x.note) card.note = x.note;
      if (x.choices) card.choices = x.choices;
      if (x.kind) card.kind = x.kind;
      if (x.no) card.no = x.no;
      if (x.stars) card.stars = x.stars;
      const info = getCategoryShareInfo(cat);
      if (info.shared && info.canEdit) card.sharedDocId = info.docId;
      touchCard(card);
      db.push(card); added++; touchedCats.add(cat);
    }
  });
  autoMerge();
  if (typeof pushSharedDocsForCategories === 'function') pushSharedDocsForCategories([...touchedCats]);
  alert(`📊 CSVを取り込みました。\n新規追加: ${added}件\n更新: ${updated}件`); openPage('pgHome');
}

window.resetScores = function resetScores() {
  if(!confirm("⚠️ すべてのカードの成績（正解数・誤答数・レベル）をリセットしますか？\n\nカテゴリーと問題文は保持されます。\n（リセット前の成績は「復元ポイント」から戻せます）")) return;
  takeSnapshot('成績のリセット');
  let resetCount = 0;
  db.forEach(q => {
    q.level = 0; q.correct = 0; q.incorrect = 0; q.streak = 0; q.wrongStreak = 0; q.shikkariStreak = 0; q.level5Correct = 0; delete q.senses; delete q.drillStats;
    touchStats(q); resetCount++;
  });
  saveData(true);
  alert("✅ 成績をリセットしました！");
  if (document.getElementById('pgStats') && document.getElementById('pgStats').classList.contains('active')) renderStatsAndCharts();
};

function factoryReset() { 
  if(!confirm("⚠️ 全消去します。よろしいですか？\n（ログイン中は、同期している他の端末やクラウドのデータも消えます）\n\n※自分が共有・公開しているカテゴリーは、購読している人の手元にはそのまま残ります\n※消す前の状態は、この端末の「復元ポイント」から戻せます")) return; 
  takeSnapshot('全消去');
  // ★【0.03.02】削除記録を残して消す（記録が無いと、他の端末との同期で元に戻ってしまう）
  tombstoneCards(db.map(q => q.id));
  markCatsDeleted(categories.filter(c => c !== '未分類'));
  // 購読をやめてから消す（共有カテゴリーへ「全部消えた」状態を書き戻さないように）
  [...subscribedDocs, ...ownedDocs].forEach(id => markDocLeft(id));
  Object.keys(sharedMeta || {}).forEach(id => { delete sharedMeta[id]; });
  if (typeof saveSharedMeta === 'function') saveSharedMeta();
  db = []; categories = ["未分類"]; categoryTree = {}; subscribedDocs = []; ownedDocs = []; catSubjects = {};
  saveData(true); alert("💥 初期化完了。"); openPage('pgHome'); 
}
function escapeHtml(s) { if(!s) return ''; return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"); }
