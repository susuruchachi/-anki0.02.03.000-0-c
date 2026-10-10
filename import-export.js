// ----------------- JSON / CSV 管理 -----------------
function exportJSON() {
  const blob = new Blob([JSON.stringify({ db, categories, categoryTree }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `susuru_anki_${Date.now()}.json`; a.click();
}
function importJSON(e) {
  if(!e.target.files[0]) return;
  const r = new FileReader(); r.onload = function(evt) {
    try {
      const p = JSON.parse(evt.target.result); if(p.db) db = p.db; if(p.categories) categories = p.categories; if(p.categoryTree) categoryTree = p.categoryTree;
      autoMerge(); alert("📦 インポート成功！"); openPage('pgHome');
    } catch(err) { alert("無効なJSONです。"); }
  }; r.readAsText(e.target.files[0]);
}
function exportCSV() {
  let lines = [["問題", "答え", "フォルダー", "レベル", "正解数", "不正解数"]];
  db.forEach(q => lines.push([q.question, q.answer, q.category, q.level, q.correct, q.incorrect]));
  const csv = lines.map(l => l.map(t => `"${String(t).replace(/"/g, '""')}"`).join(",")).join("\n");
  const b = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `susuru_anki_${Date.now()}.csv`; a.click();
}
// ★【0.03.01】フォルダー欄に「親>子>孫」と書くと、入れ子のフォルダーを作ってその一番下に入れる
function ensureCategoryPath(path) {
  const parts = String(path || '').split('>').map(x => x.trim()).filter(x => x !== '');
  if (parts.length === 0) parts.push('未分類');
  let parent = null;
  parts.forEach(name => {
    if (!categories.includes(name)) categories.push(name);
    if (typeof deletedCats !== 'undefined') deletedCats = deletedCats.filter(c => c !== name);
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

function importCSV(e) {
  if(!e.target.files[0]) return;
  const r = new FileReader(); r.onload = function(evt) {
    try {
      const lines = evt.target.result.split(/\r?\n/).filter(l => l.trim() !== "");
      if(lines.length < 2) return alert("データがありません。");
      const parse = (text) => {
        let f=[], cur="", inQ=false;
        for(let i=0; i<text.length; i++) { let c = text.charAt(i); if(c === '"') { if(inQ && text.charAt(i+1)==='"') { cur+='"'; i++; } else inQ = !inQ; } else if(c === ',' && !inQ) { f.push(cur); cur = ""; } else cur += c; }
        f.push(cur); return f;
      };
      const h = parse(lines[0]).map(x=>x.trim()); let iQ = h.indexOf("問題"), iA = h.indexOf("答え"), iC = h.indexOf("フォルダー");
      if(iQ===-1) iQ=0; if(iA===-1) iA=1; if(iC===-1) iC=2; let count = 0;
      for(let i=1; i<lines.length; i++) {
        const c = parse(lines[i]); if(c.length <= Math.max(iQ, iA)) continue;
        const q = c[iQ]?.trim(), a = c[iA]?.trim(); if(!q || !a) continue;
        let cat = (iC !== -1 && c[iC]) ? c[iC].trim() : "未分類"; if(!cat) cat="未分類";
        cat = ensureCategoryPath(cat);
        db.push({ id: 'id_'+Math.random().toString(36).slice(2)+Date.now().toString(36), question: q, answer: a, category: cat, level: 0, correct: 0, incorrect: 0, streak: 0, wrongStreak: 0, shikkariStreak: 0 }); count++;
      }
      autoMerge(); alert(`📊 ${count}件インポートしました。`); openPage('pgHome');
    } catch(err) { alert("CSV解析に失敗しました。"); }
  }; r.readAsText(e.target.files[0]);
}

window.resetScores = function resetScores() {
  if(!confirm("⚠️ すべてのカードの成績（正解数・誤答数・レベル）をリセットしますか？\n\nカテゴリーと問題文は保持されます。")) return;
  let resetCount = 0;
  db.forEach(q => {
    q.level = 0; q.correct = 0; q.incorrect = 0; q.streak = 0; q.wrongStreak = 0; q.shikkariStreak = 0;
    resetCount++;
  });
  saveData(true);
  alert("✅ 成績をリセットしました！");
  if (document.getElementById('pgStats') && document.getElementById('pgStats').classList.contains('active')) renderStatsAndCharts();
};

function factoryReset() { 
  if(!confirm("⚠️ 全消去します。よろしいですか？")) return; 
  localStorage.removeItem(STORAGE_KEY); 
  db = []; categories = ["未分類"]; categoryTree = {}; deletedCards = []; deletedCats = []; 
  saveData(true); alert("💥 初期化完了。"); openPage('pgHome'); 
}
function escapeHtml(s) { if(!s) return ''; return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"); }
