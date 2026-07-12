// ----------------- 一括追加 -----------------
let targetBulkCategory = "";
function showBulkAddModal(catName) {
  targetBulkCategory = catName; document.getElementById('bulkAddTitle').innerText = `一括追加: ${catName}`;
  document.getElementById('txtBulkAdd').value = ''; document.getElementById('bulkAddOverlay').style.display = 'flex';
}
function closeBulkAdd() { document.getElementById('bulkAddOverlay').style.display = 'none'; }

function submitBulkAdd() {
  const text = document.getElementById('txtBulkAdd').value.trim();
  if(!text) { closeBulkAdd(); return; }
  
  // ★ 権限チェック
  let targetSharedDocId = null;
  const existingCard = db.find(q => q.category === targetBulkCategory && q.sharedDocId);
  if (existingCard) {
    targetSharedDocId = existingCard.sharedDocId;
    const perm = sharedDocPermissions[targetSharedDocId];
    if (!perm || !perm.canEdit) { closeBulkAdd(); return alert("🔒 この共有/公開カテゴリーは閲覧専用のため、問題を追加できません。"); }
  }
  
  let count = 0;
  // 空行を除外して行の配列を作成
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l !== "");
  
  // 1行の中に「,（半角カンマ）」または「タブ」が含まれているかチェック
  // （※「、」は日本語の文章で使われるため区切り文字から除外！）
  const isCsvFormat = lines.some(line => line.includes(',') || line.includes('\t'));

  if (isCsvFormat) {
    // 【カンマ・タブ区切り方式】1行＝1カード
    lines.forEach(line => {
      let idx = line.indexOf('\t'); 
      if(idx === -1) idx = line.indexOf(',');
      if(idx !== -1) {
        const q = line.substring(0, idx).trim(), a = line.substring(idx + 1).trim();
        if(q && a) {
          const newCard = { id: 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36), question: q, answer: a, category: targetBulkCategory, level: 0, correct: 0, incorrect: 0, streak: 0, wrongStreak: 0, shikkariStreak: 0 };
          if (targetSharedDocId) { newCard.sharedDocId = targetSharedDocId; updateCardInSharedDoc(targetSharedDocId, newCard, 'add'); }
          db.push(newCard); count++;
        }
      }
    });
  } else {
    // 【改行方式】奇数行が問題、偶数行が答え
    for (let i = 0; i < lines.length - 1; i += 2) {
      const q = lines[i];
      const a = lines[i+1];
      if (q && a) {
        const newCard = { id: 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36), question: q, answer: a, category: targetBulkCategory, level: 0, correct: 0, incorrect: 0, streak: 0, wrongStreak: 0, shikkariStreak: 0 };
        if (targetSharedDocId) { newCard.sharedDocId = targetSharedDocId; updateCardInSharedDoc(targetSharedDocId, newCard, 'add'); }
        db.push(newCard); count++;
      }
    }
  }
  
  saveData(true); 
  if (typeof renderBox === 'function' && document.getElementById('pgBox').classList.contains('active')) renderBox(); 
  if (typeof renderTree === 'function' && document.getElementById('pgTree').classList.contains('active')) renderTree();
  closeBulkAdd(); 
  alert(`✅ ${count}件の問題を追加しました！`);
}
