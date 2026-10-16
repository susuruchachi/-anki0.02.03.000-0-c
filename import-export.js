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
      { html: '♻️ 今のデータを消して置き換える<br><span style="font-size:0.75rem; color:var(--text3);">今のカード・フォルダーはすべて消え、バックアップの内容だけになります（他の端末からも消えます）</span>', danger: true, action: () => {
          if (confirm(`今のカード${db.length}枚・フォルダーをすべて消して、バックアップの内容に置き換えます。よろしいですか？`)) importBackupReplace(p);
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
// 置き換え：今のカード・フォルダーを削除記録つきで消してから、バックアップの内容にする
function importBackupReplace(p) {
  const b = normalizeBackup(p);
  const keepIds = new Set(b.db.map(c => c.id));
  tombstoneCards(db.filter(q => !keepIds.has(q.id)).map(q => q.id));
  const keepCats = new Set([...b.categories, ...Object.keys(b.categoryTree), ...Object.values(b.categoryTree).flat()]);
  markCatsDeleted(categories.filter(c => !keepCats.has(c)));
  b.db.forEach(c => { touchCard(c); touchStats(c); delete deletedCardsAt[c.id]; });
  deletedCards = deletedCards.filter(id => !keepIds.has(id));
  db = b.db; categories = b.categories; categoryTree = b.categoryTree; catSubjects = b.catSubjects;
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
  let lines = [["問題", "答え", "フォルダー", "番号", "メモ", "選択肢", "形式", "レベル", "正解数", "不正解数"]];
  sortCardsByNumber([...db]).forEach(q => lines.push([q.question, q.answer, getCategoryPathString(q.category), q.no || '', q.note || '', Array.isArray(q.choices) ? q.choices.join(' / ') : '', q.kind === 'test' ? 'テスト' : q.kind === 'cloze' ? '例文' : q.kind === 'self' ? '自己申告' : '', q.level, q.correct, q.incorrect]));
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

function importCSV(e) {
  if(!e.target.files[0]) return;
  const r = new FileReader(); r.onload = function(evt) {
    try {
      const rows = parseCSVText(evt.target.result);
      if(rows.length < 2) return alert("データがありません。");
      const h = rows[0].map(x=>x.trim());
      let iQ = h.indexOf("問題"), iA = h.indexOf("答え"), iC = h.indexOf("フォルダー");
      const iN = h.indexOf("メモ"), iCh = h.indexOf("選択肢"), iK = h.indexOf("形式"), iNo = h.indexOf("番号");
      if(iQ===-1) iQ=0; if(iA===-1) iA=1; if(iC===-1) iC=2;
      let added = 0, updated = 0;
      const touchedCats = new Set();
      const usedIds = new Set();
      for(let i=1; i<rows.length; i++) {
        const c = rows[i]; if(c.length <= Math.max(iQ, iA)) continue;
        const q = c[iQ]?.trim(), a = c[iA]?.trim(); if(!q || !a) continue;
        let cat = (iC !== -1 && c[iC]) ? c[iC].trim() : "未分類"; if(!cat) cat="未分類";
        cat = ensureCategoryPath(cat);
        const note = iN !== -1 ? String(c[iN] || '').trim() : '';
        const choices = iCh !== -1 ? parseChoicesCell(c[iCh]) : null;
        const kindRaw = iK !== -1 ? String(c[iK] || '').trim() : '';
        const kind = /テスト|test/i.test(kindRaw) ? 'test' : /例文|cloze/i.test(kindRaw) ? 'cloze' : /自己申告|self/i.test(kindRaw) ? 'self' : '';
        const noNum = iNo !== -1 ? parseInt(String(c[iNo] || '').replace(/[^0-9]/g, ''), 10) : NaN;
        const no = Number.isFinite(noNum) && noNum > 0 ? noNum : null;
        // ★【0.03.02】同じフォルダーに同じ問題があれば、重複させずに答え・メモ等を更新する（成績はそのまま）
        // 同じ問題・同じ答え → それを更新。答えが違う場合は、同じ問題のカードが1枚だけで、この取込でまだ使っていなければ更新
        let ex = db.find(d => d.category === cat && String(d.question).trim() === q && String(d.answer).trim() === a && !usedIds.has(d.id));
        if (!ex) {
          const sameQ = db.filter(d => d.category === cat && String(d.question).trim() === q);
          if (sameQ.length === 1 && !usedIds.has(sameQ[0].id)) ex = sameQ[0];
        }
        if (!ex) {
          // ★【0.03.08】問題文の「（2つ）」のような数の書き方だけが違うなら、同じカードとして問題文も更新する
          const qKey = t => String(t).replace(/[（(][0-9０-９]+(?:つ|段階|種類|個)[）)]/g, '').trim();
          const k = qKey(q);
          ex = db.find(d => d.category === cat && !usedIds.has(d.id) && String(d.answer).trim() === a && qKey(d.question) === k);
        }
        if (ex) usedIds.add(ex.id);
        if (ex) {
          const before = JSON.stringify([ex.question, ex.answer, ex.note, ex.choices, ex.kind, ex.no]);
          ex.question = q;
          ex.answer = a;
          if (iN !== -1) { if (note) ex.note = note; else delete ex.note; }
          if (iCh !== -1) { if (choices) ex.choices = choices; else delete ex.choices; }
          if (iK !== -1) { if (kind) ex.kind = kind; else delete ex.kind; }
          if (no) ex.no = no;
          if (JSON.stringify([ex.question, ex.answer, ex.note, ex.choices, ex.kind, ex.no]) !== before) { touchCard(ex); updated++; touchedCats.add(cat); }
          continue;
        }
        const card = { id: newCardId(), question: q, answer: a, category: cat, level: 0, correct: 0, incorrect: 0, streak: 0, wrongStreak: 0, shikkariStreak: 0 };
        if (note) card.note = note;
        if (choices) card.choices = choices;
        if (kind) card.kind = kind;
        if (no) card.no = no;
        const info = getCategoryShareInfo(cat);
        if (info.shared && info.canEdit) card.sharedDocId = info.docId;
        touchCard(card);
        db.push(card); usedIds.add(card.id); added++; touchedCats.add(cat);
      }
      autoMerge();
      if (typeof pushSharedDocsForCategories === 'function') pushSharedDocsForCategories([...touchedCats]);
      alert(`📊 CSVを取り込みました。\n新規追加: ${added}件\n更新（メモ・答えなど）: ${updated}件`); openPage('pgHome');
    } catch(err) { console.error(err); alert("CSV解析に失敗しました。"); }
  }; r.readAsText(e.target.files[0]);
}

window.resetScores = function resetScores() {
  if(!confirm("⚠️ すべてのカードの成績（正解数・誤答数・レベル）をリセットしますか？\n\nカテゴリーと問題文は保持されます。")) return;
  let resetCount = 0;
  db.forEach(q => {
    q.level = 0; q.correct = 0; q.incorrect = 0; q.streak = 0; q.wrongStreak = 0; q.shikkariStreak = 0; q.level5Correct = 0;
    touchStats(q); resetCount++;
  });
  saveData(true);
  alert("✅ 成績をリセットしました！");
  if (document.getElementById('pgStats') && document.getElementById('pgStats').classList.contains('active')) renderStatsAndCharts();
};

function factoryReset() { 
  if(!confirm("⚠️ 全消去します。よろしいですか？\n（ログイン中は、同期している他の端末やクラウドのデータも消えます）")) return; 
  // ★【0.03.02】削除記録を残して消す（記録が無いと、他の端末との同期で元に戻ってしまう）
  tombstoneCards(db.map(q => q.id));
  markCatsDeleted(categories.filter(c => c !== '未分類'));
  [...subscribedDocs, ...ownedDocs].forEach(id => markDocLeft(id));
  db = []; categories = ["未分類"]; categoryTree = {}; subscribedDocs = []; ownedDocs = []; catSubjects = {};
  saveData(true); alert("💥 初期化完了。"); openPage('pgHome'); 
}
function escapeHtml(s) { if(!s) return ''; return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"); }
