// ----------------- JSON / CSV 管理 -----------------
function exportJSON() {
  const blob = new Blob([JSON.stringify({ app: 'susuru_anki', version: typeof APP_VERSION !== 'undefined' ? APP_VERSION : '', exportedAt: Date.now(), db, categories, categoryTree, catSubjects, ttsDict: vtxLiveDict() }, null, 2)], { type: 'application/json' });
  saveBlobFile(blob, `susuru_anki_${Date.now()}.json`);
}
// ★【0.04.37】読み上げの読み方（歴史的仮名づかい → 現代仮名づかい など。ttsDict）もバックアップに入れる（消したものは入れない）
function vtxLiveDict() {
  const o = {};
  Object.entries(typeof ttsDict === 'object' && ttsDict ? ttsDict : {}).forEach(([k, v]) => { if (v && !v.deleted && v.r) o[k] = { r: v.r, at: v.at || Date.now() }; });
  return o;
}
// バックアップの読み方を、今の読み方に混ぜる（同じ書き方は新しく登録した方）。混ぜた数を返す
function mergeBackupDict(d) {
  if (!d || typeof d !== 'object') return 0;
  let n = 0;
  Object.entries(d).forEach(([k, v]) => {
    if (!k || !v || !v.r) return;
    const cur = ttsDict[k];
    if (cur && !cur.deleted && cur.r === v.r) return;
    if (cur && (cur.at || 0) > (v.at || 0)) return;
    ttsDict[k] = { r: String(v.r), at: v.at || Date.now() }; n++;
  });
  return n;
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
  const nd = mergeBackupDict(p.ttsDict); // ★【0.04.37】読み方
  structAt = Date.now(); _structHash = structFingerprint();
  autoMerge(true);
  saveData(true);
  if (typeof refreshVisibleViews === 'function') refreshVisibleViews(true);
  alert(`📦 取り込みました（統合）。\nカード: ${before}枚 → ${db.length}枚\nフォルダー: ${categories.length}個${nd ? `\n読み方: ${nd}件` : ''}`);
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
  const nd = mergeBackupDict(p.ttsDict); // ★【0.04.37】読み方（置き換えでも、今の読み方は消さずに混ぜる）
  saveData(true);
  if (typeof refreshVisibleViews === 'function') refreshVisibleViews(true);
  alert(`📦 取り込みました（置き換え）。\nカード: ${db.length}枚${nd ? `\n読み方: ${nd}件` : ''}`);
  openPage('pgHome');
}
function exportCSV() {
  let lines = [["問題", "答え", "フォルダー", "番号", "メモ", "選択肢", "形式", "星", "レベル", "正解数", "不正解数"]];
  sortCardsByNumber([...db]).forEach(q => lines.push([q.question, q.answer, getCategoryPathString(q.category), q.no ? cardNoText(q.no) : '', q.note || '', Array.isArray(q.choices) ? q.choices.join(' / ') : '', q.kind === 'test' ? 'テスト' : q.kind === 'cloze' ? '例文' : q.kind === 'self' ? '自己申告' : q.kind === 'intro' ? '導入' : '', starsText(q.stars), q.level, q.correct, q.incorrect]));
  // ★【0.04.37】読み方（歴史的仮名づかい → 現代仮名づかい など）は、形式「読み方」の行で（問題＝書き方、答え＝読み）
  Object.entries(vtxLiveDict()).forEach(([k, v]) => lines.push([k, v.r, '', '', '', '', '読み方', '', '', '', '']));
  const csv = lines.map(l => l.map(t => `"${String(t === undefined || t === null ? '' : t).replace(/"/g, '""')}"`).join(",")).join("\n");
  const b = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' });
  saveBlobFile(b, `susuru_anki_${Date.now()}.csv`);
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
    // ★【0.04.62】章・小見出し・タグつきの暗記問題CSV（Anki 形式の「#columns:」見出しなど）は、別の取り込み方で
    if (studyCSVDetect(evt.target.result)) { studyCSVImportAsk(evt.target.result, file.name); return; }
    let plan;
    try { plan = planCSVImport(parseCSVText(evt.target.result)); }
    catch (err) { console.error(err); alert("CSV解析に失敗しました。"); return; }
    csvApplyPlanAsk(plan, 'CSV');
  }; r.readAsText(file);
}

// 取り込んだ結果を見せて、「追加して更新」か「追加だけ」を選んでから入れる（CSV・テキストで共通）
function csvApplyPlanAsk(plan, label) {
    if (!plan) return;
    const adds = plan.filter(x => x.type === 'add').length;
    const ups = plan.filter(x => x.type === 'update');
    const rds = plan.filter(x => x.type === 'reading').length;
    if (!adds && !ups.length && !rds) { alert('📊 新しいカードも、変更のあるカードも、新しい読み方もありませんでした。'); return; }
    if (!ups.length) { applyCSVImport(plan, false); return; }
    const ansCh = ups.filter(x => x.changes.includes('答え') || x.changes.includes('問題')).length;
    const sample = ups.slice(0, 3).map(x => `・${escapeHtml(String(x.ex.question).slice(0, 18))}（${x.changes.join('・')}）`).join('<br>');
    openContextMenu(`📊 ${label}：新しいカード ${adds}枚／既にあるカードの変更 ${ups.length}枚`, [
      { html: `🔄 追加して、既にあるカードも更新する<br><span style="font-size:0.75rem; color:var(--text3);">問題・答えが変わるカード ${ansCh}枚、メモ・選択肢などが変わるカード ${ups.length - ansCh}枚。成績はそのまま。CSVで空欄のメモは消しません<br>${sample}</span>`, action: () => applyCSVImport(plan, true) },
      { html: `➕ 新しいカードだけ追加する（既にあるカードは変えない）`, action: () => applyCSVImport(plan, false) },
      { type: 'separator' },
      { html: 'キャンセル', action: () => {} }
    ]);
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
    // ★【0.04.37】形式「読み方」の行は、カードではなく読み上げの読み方
    if (iK !== -1 && /^(読み方|読み|reading)$/i.test(String(c[iK] || '').trim())) {
      const cur = ttsDict[q];
      if (!cur || cur.deleted || cur.r !== a) plan.push({ type: 'reading', s: q, r: a });
      continue;
    }
    // 星：「星」列、または問題の後ろの「★★」
    const qs = splitQuestionStars(q); q = qs.q;
    const stars = iSt !== -1 && String(c[iSt] || '').trim() ? parseStars(c[iSt]) : qs.stars;
    let catPath = (iC !== -1 && c[iC]) ? c[iC].trim() : "未分類"; if (!catPath) catPath = "未分類";
    const cat = categoryPathLeaf(catPath);
    const note = iN !== -1 ? String(c[iN] || '').trim() : '';
    const choices = iCh !== -1 ? parseChoicesCell(c[iCh]) : null;
    const kindRaw = iK !== -1 ? String(c[iK] || '').trim() : '';
    const kind = /テスト|test/i.test(kindRaw) ? 'test' : /例文|cloze/i.test(kindRaw) ? 'cloze' : /自己申告|self/i.test(kindRaw) ? 'self' : /導入|intro/i.test(kindRaw) ? 'intro' : '';
    // ★【0.03.45】派生語の「1000-1」も読む（1000.01 として持つ）
    const noM = iNo !== -1 ? String(c[iNo] || '').replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xFEE0)).match(/(\d+)(?:\s*-\s*(\d+))?(?:\s*-\s*(\d+))?/) : null;
    const noNum = noM ? Number(noM[1]) + (noM[2] ? Number(noM[2]) / 100 : 0) + (noM[3] ? Number(noM[3]) / 10000 : 0) : NaN; // 1000-1-1 まで
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
  let readings = 0;
  plan.forEach(x => {
    if (x.type === 'reading') { ttsDict[x.s] = { r: x.r, at: Date.now() }; readings++; return; } // ★【0.04.37】読み方
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
  if (readings) { try { saveData(true); } catch (e) {} }
  alert(`📊 CSVを取り込みました。\n新規追加: ${added}件\n更新: ${updated}件${readings ? `\n読み方: ${readings}件` : ''}`); openPage('pgHome');
}

// ================================================================
// ★【0.04.62】章・小見出し・タグつきの暗記問題CSV（例：「問題,解答,補足,章,小見出し,タグ」）
//  ・先頭の「#separator:」「#html:」「#columns:」の行（Anki の書き方）を読む。区切りはカンマ・タブ・セミコロン・縦棒
//  ・フォルダーは「親(ファイル名など)>章>…」。章の「◆…◆」「■…■」は下のフォルダーに分け、
//    「熟語 1 …」「口語 1 …」のように頭の語が同じ章が2つ以上あれば、その語を間のフォルダーにする。章に「>」があればそのまま
//  ・問題番号は行の順（小見出しが「No.12」なら 12・12-1・12-2…）。補足・小見出し・印はメモに
//  ・印（超頻出!・頻出!・◆・＊）は★に、「例文空所」は形式「例文」に、長い答えは「自己申告」に（選べる）
//  ・取り込みは今の CSV と同じ（planCSVImport・csvApplyPlanAsk。同じ問題は増やさずに更新するか選べる）
//  ・今あるフォルダーと名前がぶつかって別の場所に入ってしまう章は「名前（親）」にする（今のフォルダーは変えない）
// ================================================================
const STUDY_CSV_COLS = {
  q: ['問題', '表', 'Front', 'front', 'Question', 'question'],
  a: ['解答', '答え', '裏', 'Back', 'back', 'Answer', 'answer'],
  note: ['補足', 'メモ', '解説', 'Note', 'note'],
  chap: ['章', '講', 'Chapter', 'chapter'],
  sub: ['小見出し', '見出し', 'Section', 'section'],
  tag: ['タグ', '印', 'Tags', 'tags']
};
function studyCSVParse(text) {
  text = String(text || '').replace(/^﻿/, '');
  const dir = {};
  // 先頭の「#…」の行（Anki の見出し）
  let pos = 0;
  while (pos < text.length && text[pos] === '#') {
    let end = text.indexOf('\n', pos); if (end === -1) end = text.length;
    const line = text.slice(pos, end).replace(/\r$/, '');
    const m = line.match(/^#\s*([A-Za-z ]+?)\s*:(.*)$/);
    if (m) dir[m[1].toLowerCase().replace(/\s+/g, '')] = m[2];
    pos = end + 1;
  }
  const sepName = String(dir.separator || '').trim().toLowerCase();
  const sep = { tab: '\t', semicolon: ';', pipe: '|', comma: ',' }[sepName] || (sepName.length === 1 ? sepName : ',');
  const body = text.slice(pos);
  const rows = []; let row = [], cur = '', inQ = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inQ) {
      if (c === '"') { if (body[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"' && cur === '') inQ = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && body[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(x => x.trim() !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some(x => x.trim() !== '')) rows.push(row);
  let header = dir.columns != null ? String(dir.columns).split(sep).map(x => x.trim()) : null;
  if (!header) header = (rows.shift() || []).map(x => String(x).trim());
  const col = k => header.findIndex(h => STUDY_CSV_COLS[k].includes(h));
  return { header, rows, dir, idx: { q: col('q'), a: col('a'), note: col('note'), chap: col('chap'), sub: col('sub'), tag: col('tag') } };
}
// 章・小見出し・タグの列がある（フォルダーの列は無い）CSV か、Anki の「#columns:」がある CSV
function studyCSVDetect(text) {
  const head = String(text || '').replace(/^﻿/, '').slice(0, 2000);
  const hasDir = /^#\s*columns\s*:/im.test(head);
  let p; try { p = studyCSVParse(head.split(/\r?\n/).slice(0, 6).join('\n')); } catch (e) { return false; }
  if (p.header.includes('フォルダー')) return false;
  const special = p.idx.chap !== -1 || p.idx.sub !== -1 || p.idx.tag !== -1 || p.header.includes('解答') || p.header.includes('補足');
  return (hasDir || special) && p.idx.q !== -1 && p.idx.a !== -1;
}
// 章 → フォルダーの並び（「◆…◆」「■…■」は下のフォルダーに、「A>B」はそのまま）
function studyCSVChapterParts(chap) {
  const s = String(chap || '').trim();
  if (!s) return [];
  if (s.includes('>')) return s.split('>').map(x => x.trim()).filter(Boolean);
  const m = s.match(/^(.*?)\s*[◆■]\s*(.+?)\s*[◆■]?\s*$/);
  if (m && m[1].trim() && m[2].trim()) return [m[1].trim(), m[2].trim()];
  return [s];
}
function studyCSVTagStars(tag) {
  let n = 0;
  String(tag || '').split(/\s+/).forEach(t => {
    if (/^超頻出[!！]?$/.test(t)) n = Math.max(n, 3);
    else if (/^頻出[!！]?$/.test(t) || t === '◆') n = Math.max(n, 2);
    else if (t === '＊' || t === '*') n = Math.max(n, 1);
  });
  return n;
}
// 取り込む内容を作る（planCSVImport に渡す行の形）
function studyCSVBuild(p, root, opt) {
  const { idx } = p;
  const get = (r, i) => i === -1 ? '' : String(r[i] == null ? '' : r[i]).trim();
  const items = p.rows.map(r => ({ q: get(r, idx.q), a: get(r, idx.a), note: get(r, idx.note), chap: get(r, idx.chap), sub: get(r, idx.sub), tag: get(r, idx.tag) })).filter(x => x.q && x.a);
  // 章を分ける
  items.forEach(x => { x.parts = studyCSVChapterParts(x.chap); });
  const tokRest = {};
  items.forEach(x => {
    if (x.chap.includes('>') || !x.parts.length) return;
    const m = x.parts[0].match(/^(\S{1,6})\s+(.+)$/);
    if (!m || /\d/.test(m[1])) return;
    (tokRest[m[1]] = tokRest[m[1]] || new Set()).add(m[2]);
  });
  items.forEach(x => {
    if (x.chap.includes('>') || !x.parts.length) return;
    const m = x.parts[0].match(/^(\S{1,6})\s+(.+)$/);
    if (m && tokRest[m[1]] && tokRest[m[1]].size >= 2) x.parts = [m[1], m[2], ...x.parts.slice(1)];
  });
  // フォルダー名：使えない名前を直し、今あるフォルダー（または今回の別の場所）とぶつかるときは「名前（親）」に
  const fixed = {}, planned = {};
  const fixName = n => (invalidCategoryName(n) ? n.replace(/>/g, '＞').replace(/^__|__$/g, '_').slice(0, 100) : n) || '未分類';
  // ★【0.04.63】親は「河合英語サブテキ>文法」のように「>」で何段でも（いちばん上はそのまま使う）
  const rootParts = String(root || '').split('>').map(t => t.trim()).filter(Boolean);
  const rootName = fixName(rootParts[0] || '未分類');
  items.forEach(x => {
    const path = [rootName]; let parent = rootName;
    [...rootParts.slice(1), ...x.parts].forEach(raw => {
      const key = parent + '\u0000' + raw;
      if (!fixed[key]) {
        let name = fixName(raw), k = 1;
        const clash = nm => (categories.includes(nm) && getCategoryParent(nm) !== parent) || (planned[nm] !== undefined && planned[nm] !== parent) || nm === rootName;
        while (clash(name)) { name = fixName(`${raw}（${rootName}${k > 1 ? k : ''}）`); k++; if (k > 50) break; }
        fixed[key] = name; planned[name] = parent;
      }
      path.push(fixed[key]); parent = fixed[key];
    });
    x.path = path.join('>');
  });
  // 問題番号（フォルダーごとに行の順。小見出しがすべて「No.12」なら 12・12-1・12-2…）
  const byPath = {};
  items.forEach(x => { (byPath[x.path] = byPath[x.path] || []).push(x); });
  Object.values(byPath).forEach(list => {
    const useSub = list.every(x => /^No\.?\s*\d+$/i.test(x.sub));
    if (useSub) {
      const seen = {};
      list.forEach(x => { const n = x.sub.match(/\d+/)[0]; seen[n] = (seen[n] || 0) + 1; x.no = seen[n] === 1 ? n : `${n}-${seen[n] - 1}`; x.subUsed = true; });
    } else list.forEach((x, i) => { x.no = String(i + 1); });
  });
  let starN = 0, selfN = 0, clozeN = 0;
  const rows = [['問題', '答え', 'フォルダー', '番号', 'メモ', '形式', '星']];
  items.forEach(x => {
    const memo = [];
    if (x.note) memo.push(x.note);
    if (x.sub && !x.subUsed) memo.push(`［${x.sub.replace(/^●/, '')}］`);
    if (x.tag) memo.push(`タグ：${x.tag}`);
    const stars = opt.stars ? studyCSVTagStars(x.tag) : 0;
    let kind = '';
    if (/例文空所/.test(x.tag)) kind = '例文';
    else if (opt.self && (x.a.length > 40 || /\n/.test(x.a))) kind = '自己申告';
    if (stars) starN++; if (kind === '自己申告') selfN++; if (kind === '例文') clozeN++;
    rows.push([x.q, x.a, x.path, x.no, memo.join('\n'), kind, stars ? '★'.repeat(stars) : '']);
  });
  return { rows, items, count: items.length, folders: Object.keys(byPath).length, starN, selfN, clozeN, rootName };
}
// ★【0.04.63】前に「今までのCSVの取り込み方」で入れてしまったカードを探す
//  今までの取り込み方では、3列目（補足）がフォルダーとして読まれ、補足ごとにフォルダーができていた（補足が空なら「未分類」）。
//  問題と答えが同じで、その「補足のフォルダー」にあるカードだけを、正しいフォルダーへ移す（成績はそのまま）。
//  見出しの行（#columns:…）から1枚だけできたカードは消す。移したあと空になった「補足のフォルダー」は片づける（未分類は残す）
function studyCSVOldParts(note) {
  const parts = String(note || '').split('>').map(t => t.trim()).filter(t => t !== '');
  if (!parts.length) parts.push('未分類');
  return parts.map(t => invalidCategoryName(t) ? t.replace(/^__|__$/g, '_').slice(0, 100) : t);
}
function studyCSVFindOld(items) {
  const used = new Set(), moves = [], oldCats = new Set();
  const ro = d => d.sharedDocId && getSharedAccess(d.sharedDocId).readOnly;
  const byKey = new Map();
  db.forEach(d => { const k = `${d.category}\u0000${String(d.question).trim()}\u0000${String(d.answer).trim()}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(d); });
  items.forEach(x => {
    const parts = studyCSVOldParts(x.note);
    const oldCat = parts[parts.length - 1];
    const leaf = x.path.split('>').pop();
    if (oldCat === leaf) return;
    const list = byKey.get(`${oldCat}\u0000${x.q}\u0000${x.a}`) || [];
    const d = list.find(c => !used.has(c.id) && !ro(c));
    if (!d) return;
    used.add(d.id); moves.push({ card: d, path: x.path });
    parts.forEach(t => oldCats.add(t));
  });
  const junk = db.filter(d => /^#\s*columns\s*:/i.test(String(d.question)) && !ro(d));
  junk.forEach(d => oldCats.add(d.category));
  oldCats.delete('未分類');
  // 片づけられるフォルダー（移す・消すカードしか入っていない／中のフォルダーも片づけられる）
  const leaving = new Set([...moves.map(m => m.card.id), ...junk.map(d => d.id)]);
  const planned = new Set(); items.forEach(x => x.path.split('>').forEach(t => planned.add(t)));
  const canGo = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    oldCats.forEach(c => {
      if (canGo.has(c) || planned.has(c) || !categories.includes(c)) return;
      if (db.some(d => d.category === c && !leaving.has(d.id))) return;
      if ((categoryTree[c] || []).some(ch => !canGo.has(ch))) return;
      canGo.add(c); changed = true;
    });
  }
  return { moves, junk, folders: [...canGo] };
}
function studyCSVApplyOld(old) {
  old.moves.forEach(m => { m.card.category = ensureCategoryPath(m.path); touchCard(m.card); });
  if (old.junk.length) { const ids = new Set(old.junk.map(d => d.id)); tombstoneCards([...ids]); db = db.filter(d => !ids.has(d.id)); }
  const del = old.folders.filter(c => !db.some(d => d.category === c));
  if (del.length) {
    const ds = new Set(del);
    categories = categories.filter(c => !ds.has(c));
    for (const k in categoryTree) { if (ds.has(k)) delete categoryTree[k]; else if (categoryTree[k]) categoryTree[k] = categoryTree[k].filter(c => !ds.has(c)); }
    markCatsDeleted(del);
  }
  return del.length;
}
function studyCSVImportAsk(text, fileName) {
  let p;
  try { p = studyCSVParse(text); } catch (err) { console.error(err); alert('CSV解析に失敗しました。'); return; }
  if (p.idx.q === -1 || p.idx.a === -1) { alert('「問題」と「解答（答え）」の列が見つかりませんでした。'); return; }
  // ★【0.04.63】CSV に「#deck:河合英語サブテキ::文法」があれば、それを親のフォルダーにする（「::」は「>」）
  const deck = String(p.dir.deck || '').split('::').map(t => t.trim()).filter(Boolean).join('>');
  const base = deck || String(fileName || '').replace(/\.(csv|tsv|txt)$/i, '').trim() || '暗記問題';
  const root = (prompt('📚 章つきの暗記問題CSVです。\n入れる親のフォルダー（この下に章ごとのフォルダーを作ります。「河合英語サブテキ>文法」のように「>」で区切ると何段でも。同じ名前のフォルダーがあれば、その中に入れて、同じ問題は増やさずに更新できます）', base) || '').trim();
  if (!root) return;
  const rp = root.split('>').map(t => t.trim()).filter(Boolean);
  if (!rp.length) return;
  for (const t of rp) { const bad = invalidCategoryName(t); if (bad) { alert(bad); return; } }
  const go = opt => {
    const b = studyCSVBuild(p, root, opt);
    if (!b.count) { alert('問題と解答のそろった行がありませんでした。'); return; }
    const old = studyCSVFindOld(b.items);
    if (old.moves.length || old.junk.length) {
      // 前に入れたカードを移してから、番号・メモ・★・形式を付け直す（成績はそのまま。元に戻せるように復元ポイントを作る）
      takeSnapshot('暗記問題CSVの取り込み（前に入れたカードの整理）');
      const removed = studyCSVApplyOld(old);
      let plan;
      try { plan = planCSVImport(b.rows); } catch (err) { console.error(err); alert('CSV解析に失敗しました。'); return; }
      applyCSVImport(plan, true);
      if (typeof afterCategoryChange === 'function') { try { afterCategoryChange(); } catch (e) {} }
      alert(`🧹 前に取り込んだカード ${old.moves.length}枚を「${rp[0]}」の中の章ごとのフォルダーへ移しました（成績はそのまま）。\n空になったフォルダー ${removed}個を片づけました${old.junk.length ? `\n見出しの行からできたカード ${old.junk.length}枚を消しました` : ''}。\n（元に戻すときは、設定の「🛟 復元ポイント」から）`);
      return;
    }
    let plan;
    try { plan = planCSVImport(b.rows); } catch (err) { console.error(err); alert('CSV解析に失敗しました。'); return; }
    csvApplyPlanAsk(plan, `章つきCSV（${b.count}問・${b.folders}フォルダー）`);
  };
  const pre = studyCSVBuild(p, root, { stars: true, self: true });
  const preOld = studyCSVFindOld(pre.items);
  const opt = (title, t) => `<span style="display:block; text-align:left;">${title}<br><span style="font-size:0.75rem; color:var(--text3);">${t}</span></span>`;
  const oldMsg = preOld.moves.length || preOld.junk.length ? `<br>🧹 前に取り込んだカード ${preOld.moves.length}枚を見つけました。成績はそのままで章ごとのフォルダーへ移し、空になるフォルダー ${preOld.folders.length}個を片づけます` : '';
  openContextMenu(`📚 ${root}：${pre.count}問を ${pre.folders}個のフォルダーへ`, [
    { html: opt('✅ おすすめで取り込む', `印を★に（超頻出!★★★・頻出!/◆★★・＊★）：${pre.starN}問／長い答え（41字以上・改行あり）は自己申告：${pre.selfN}問／例文空所は形式「例文」：${pre.clozeN}問。補足・小見出し・タグはメモに入ります${oldMsg}`), action: () => go({ stars: true, self: true }) },
    { html: opt('★を付けずに取り込む', `印はメモにだけ残します${oldMsg}`), action: () => go({ stars: false, self: true }) },
    { html: opt('自己申告にせずに取り込む', `長い答えも、記述・4択などふつうに答えます（AI の意味で採点が使えます）${oldMsg}`), action: () => go({ stars: true, self: false }) },
    { type: 'separator' },
    { html: 'キャンセル', action: () => {} }
  ]);
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

// ================================================================
// ★【0.04.26】📝 テキストで書き出す・取り込む（フォルダーの「一括追加」と同じ形）
// ・1行に「問題<タブ>答え」。「## 親>子」の行の下は、そのフォルダーのカード。「#」で始まる行は説明（読まない）
// ・問題・答えの中の改行は \n（文字）、タブは空白にして書く（取り込むときに改行に戻す）
// ・フォルダーを選んで書き出せる。「2行ずつ（問題の行・答えの行）」の形も選べる
// ・取り込みは CSV と同じ（同じフォルダーに同じ問題があれば、増やさずに更新するか選べる）
// ================================================================
// 「\」は「\\」、改行は「\n」、タブは「\t」にする（数式の \neq などがこわれないように、\ も書きかえる）
//  行の先頭の「#」は「\#」（説明・フォルダーの行と見分けるため）
function textEsc(t) { return String(t == null ? '' : t).replace(/\r/g, '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/^#/, '\\#'); }
function textUnesc(t) { return String(t || '').replace(/\\([\\nt#])/g, (m, c) => c === 'n' ? '\n' : c === 't' ? '\t' : c); }
const TEXT_EXPORT_MARK = '# すするanki テキスト書き出し';
function textOverlay(html) {
  let ov = document.getElementById('textIoOverlay');
  if (!ov) { ov = document.createElement('div'); ov.id = 'textIoOverlay'; ov.className = 'ctx-overlay'; ov.style.zIndex = '1060'; ov.onclick = () => { ov.style.display = 'none'; }; document.body.appendChild(ov); }
  ov.innerHTML = `<div class="menu-card editor-card cal-editor" onclick="event.stopPropagation()">${html}</div>`;
  ov.style.display = 'flex';
}
function textCloseOverlay() { const ov = document.getElementById('textIoOverlay'); if (ov) ov.style.display = 'none'; }
function textCats() { return getSortedCategoriesForMenu().filter(c => !/^__.*__$/.test(c)); }
function exportTextOpen() {
  const depth = c => { try { return getCategoryPath(c).length - 1; } catch (e) { return 0; } };
  const count = c => db.filter(q => q.category === c).length;
  const total = c => { const set = new Set(getAllSubcategories(c)); return db.filter(q => set.has(q.category)).length; };
  textOverlay(`<div class="cat-edit-title">📝 テキストで書き出す</div>
    <div class="hint-small" style="margin:6px 0;">書き出すフォルダーを選んでください（親を選ぶと、中のフォルダーも選ばれます）。</div>
    <div style="display:flex; gap:6px; margin-bottom:6px;"><button class="chip" onclick="textPickAll(true)">すべて</button><button class="chip" onclick="textPickAll(false)">なし</button></div>
    <div style="max-height:40vh; overflow-y:auto; border:1px solid var(--border); border-radius:8px; padding:4px 8px;">
      ${textCats().map(c => `<label class="bulkdel-row" style="padding-left:${depth(c) * 16}px;"><input type="checkbox" class="txtExpCat" value="${escAttr(c)}" onchange="textPickChildren(this)"><div>${escapeHtml(c)} <span class="hint-small">${count(c)}${total(c) !== count(c) ? `／中も合わせて ${total(c)}` : ''}枚</span></div></label>`).join('')}
    </div>
    <label class="section-label" style="margin-top:8px;">形</label>
    <select id="txtExpFormat" class="form-control" onchange="textFmtHint()"><option value="vt">📄 単語帳の形（暗記の「テキストから問題を作る」で読める。番号・派生語・熟語・例文・Check!・導入の文もそのまま）</option><option value="tab">1行に「問題 タブ 答え」（フォルダーの一括追加と同じ）</option><option value="lines">2行ずつ（問題の行・答えの行）</option></select>
    <div id="txtFmtHint" class="hint-small" style="margin-top:4px;"></div>
    <div class="plan-btns" style="margin-top:10px; flex-wrap:wrap;"><button class="btn btn-primary" onclick="exportTextDo('file')">💾 保存</button><button class="btn btn-secondary" onclick="exportTextDo('copy')">📋 コピー</button><button class="btn btn-secondary" onclick="textCloseOverlay()">やめる</button></div>`);
  textFmtHint();
}
function textPickAll(on) { document.querySelectorAll('.txtExpCat').forEach(x => { x.checked = on; }); }
function textPickChildren(el) {
  const kids = new Set(getAllSubcategories(el.value));
  document.querySelectorAll('.txtExpCat').forEach(x => { if (kids.has(x.value)) x.checked = el.checked; });
}
function exportTextBuild(cats, fmt) {
  const sortFn = typeof sortCardsByNumber === 'function' ? sortCardsByNumber : (x => x);
  const L = [`${TEXT_EXPORT_MARK}（${new Date().toLocaleDateString('ja-JP')}）`,
    `# 「## フォルダー」の下は、そのフォルダーのカード。${fmt === 'lines' ? '2行ずつ（問題の行・答えの行）' : '1行に「問題<タブ>答え」（フォルダーの一括追加と同じ形）'}。問題・答えの中の改行は \\n、\\ は \\\\ と書いています`];
  let n = 0;
  cats.forEach(c => {
    const cards = sortFn(db.filter(q => q.category === c && q.question && q.answer));
    if (!cards.length) return;
    L.push('', '## ' + getCategoryPathString(c));
    cards.forEach(q => { if (fmt === 'lines') L.push(textEsc(q.question), textEsc(q.answer)); else L.push(textEsc(q.question) + '\t' + textEsc(q.answer)); n++; });
  });
  return { text: L.join('\n') + '\n', n };
}
function textFmtHint() {
  const el = document.getElementById('txtFmtHint'), f = (document.getElementById('txtExpFormat') || {}).value; if (!el) return;
  el.textContent = f === 'vt' ? 'セクションのフォルダー（例：鉄壁 › #28 産業）ごとに書き出します。「🧠 暗記」→「📄 テキストから問題を作る」に貼ると、同じカードになります（成績は書き出しません）。'
    : 'カードの問題と答えだけを書き出します（メモ・選択肢・番号は書きません）。設定の「📝 テキスト入力」やフォルダーの「一括追加」で戻せます。';
}
async function exportTextDo(how) {
  const cats = [...document.querySelectorAll('.txtExpCat:checked')].map(x => x.value);
  if (!cats.length) return alert('フォルダーを選んでください。');
  const fmt = document.getElementById('txtExpFormat').value;
  if (fmt === 'vt') {
    // ★【0.04.32】単語帳の形：書いたテキストを読み直して、元のカードと同じになるか確かめてから
    const r = vtxExport(cats);
    if (!r.n) return alert('選んだフォルダーにカードがありません。');
    const bad = r.checks.filter(x => !x.v.same);
    if (bad.length) {
      const lines = bad.flatMap(x => x.v.diffs).slice(0, 8).join('\n'), cnt = bad.reduce((s, x) => s + x.v.diffs.length, 0);
      if (!confirm(`⚠️ 読み込み直したときに、元と同じにならないカードが ${cnt}枚あります（単語帳の形で表せない形のカード）：\n${lines}${cnt > 8 ? '\n…' : ''}\n\nこのまま書き出しますか？`)) return;
    }
    if (how === 'copy') { try { await navigator.clipboard.writeText(r.text); alert(`📋 ${r.secs.length}セクション（${r.n}枚）をコピーしました。`); } catch (e) { alert('⚠️ コピーできませんでした。「保存」を使ってください。'); } return; }
    const name = r.secs.length === 1 ? r.secs[0].replace(/[\\/:*?"<>|#]/g, '_').trim() : 'すするanki-単語帳';
    saveBlobFile(new Blob([r.text], { type: 'text/plain;charset=utf-8' }), `${name}-${new Date().toISOString().slice(0, 10)}.txt`);
    textCloseOverlay();
    return;
  }
  const { text, n } = exportTextBuild(cats, fmt);
  if (!n) return alert('選んだフォルダーにカードがありません。');
  if (how === 'copy') {
    try { await navigator.clipboard.writeText(text); alert(`📋 ${n}枚のカードをコピーしました。`); } catch (e) { alert('⚠️ コピーできませんでした。「ファイルに保存」を使ってください。'); }
    return;
  }
  const name = cats.length === 1 ? cats[0].replace(/[\\/:*?"<>|]/g, '_') : 'すするanki';
  saveBlobFile(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${name}-${new Date().toISOString().slice(0, 10)}.txt`);
  textCloseOverlay();
}
// 取り込み：貼り付けるか、ファイルを選ぶ
function importTextOpen() {
  textOverlay(`<div class="cat-edit-title">📝 テキストから取り込む</div>
    <div class="hint-small" style="margin:6px 0;">「📝 テキスト出力」で書き出した形（「## フォルダー」と、1行に「問題 タブ 答え」、または2行ずつ）を読みます。「## フォルダー」が無い部分は、下で選んだフォルダーに入れます。</div>
    <textarea id="txtImpText" class="form-control" rows="8" placeholder="ここに貼り付けるか、ファイルを選んでください" style="font-family:'JetBrains Mono', monospace; font-size:0.78rem;"></textarea>
    <button class="btn btn-secondary" style="margin-top:6px;" onclick="document.getElementById('fileTextImp').click()">📂 ファイルを選ぶ（.txt）</button>
    <input type="file" id="fileTextImp" accept=".txt,text/plain" style="display:none;" onchange="textReadFile(this)">
    <label class="section-label" style="margin-top:8px;">「## フォルダー」が無い部分の入れ先</label>
    <select id="txtImpDefault" class="form-control">${textCats().map(c => `<option value="${escAttr(getCategoryPathString(c))}" ${c === '未分類' ? 'selected' : ''}>${escapeHtml(getCategoryPathString(c))}</option>`).join('')}</select>
    <div class="plan-btns" style="margin-top:10px;"><button class="btn btn-primary" onclick="importTextDo()">📥 取り込む</button><button class="btn btn-secondary" onclick="textCloseOverlay()">やめる</button></div>`);
}
function textReadFile(inp) {
  const f = inp.files && inp.files[0]; if (!f) return;
  const r = new FileReader(); r.onload = () => { document.getElementById('txtImpText').value = r.result; }; r.readAsText(f); inp.value = '';
}
function parseTextImport(text, defPath) {
  const rows = [['問題', '答え', 'フォルダー']];
  let cur = { path: defPath || '未分類', lines: [] }; const blocks = [cur];
  String(text || '').replace(/\r/g, '').split('\n').forEach(raw => {
    const l = raw.trim(); let m;
    if ((m = l.match(/^##\s*(.+)$/))) { cur = { path: m[1].trim(), lines: [] }; blocks.push(cur); return; }
    if (!l || l.startsWith('#')) return;
    cur.lines.push(l);
  });
  const tabMode = blocks.some(b => b.lines.some(l => l.includes('\t')));
  blocks.forEach(b => {
    if (tabMode) b.lines.forEach(l => { const i = l.indexOf('\t'); if (i > 0) rows.push([textUnesc(l.slice(0, i).trim()), textUnesc(l.slice(i + 1).trim()), b.path]); });
    else for (let i = 0; i + 1 < b.lines.length; i += 2) rows.push([textUnesc(b.lines[i]), textUnesc(b.lines[i + 1]), b.path]);
  });
  return rows;
}
function importTextDo() {
  const text = document.getElementById('txtImpText').value;
  if (!text.trim()) return alert('テキストを貼り付けるか、ファイルを選んでください。');
  const rows = parseTextImport(text, document.getElementById('txtImpDefault').value);
  if (rows.length < 2) return alert('⚠️ カードが見つかりませんでした（1行に「問題 タブ 答え」、または2行ずつの形にしてください）。');
  textCloseOverlay();
  csvApplyPlanAsk(planCSVImport(rows), 'テキスト');
}
