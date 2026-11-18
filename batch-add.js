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
  const shareInfo = getCategoryShareInfo(targetBulkCategory);
  if (shareInfo.shared) {
    if (shareInfo.readOnly) { closeBulkAdd(); return alert("🔒 この共有/公開カテゴリーは閲覧専用のため、問題を追加できません。"); }
    targetSharedDocId = shareInfo.docId;
  }
  const addedCards = [];
  
  let count = 0;
  // 空行を除外して行の配列を作成
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l !== "");
  
  // 1行の中に「,（半角カンマ）」または「タブ」が含まれているかチェック
  // （※「、」は日本語の文章で使われるため区切り文字から除外！）
  const fromExport = typeof TEXT_EXPORT_MARK !== 'undefined' && lines.some(l => l.startsWith(TEXT_EXPORT_MARK));
  // テキスト出力のときは、タブがあれば1行1カード、無ければ2行ずつ（答えの「,」で区切らない）
  const isCsvFormat = fromExport ? lines.some(l => !l.startsWith('#') && l.includes('\t')) : lines.some(line => line.includes(',') || line.includes('\t'));

  if (isCsvFormat) {
    // 【カンマ・タブ区切り方式】1行＝1カード
    lines.forEach(line => {
      if (fromExport && /^#/.test(line)) return; // ★【0.04.26】テキスト出力の説明・フォルダーの行は読まない
      let idx = line.indexOf('\t'); 
      if(idx === -1 && !fromExport) idx = line.indexOf(',');
      if(idx !== -1) {
        // ★【0.04.26】このアプリの「テキスト出力」を貼ったときだけ、\n（改行）などを戻す（ふつうの貼り付けの数式 \neq などはそのまま）
        const un = fromExport && typeof textUnesc === 'function' ? textUnesc : (x => x);
        const q = un(line.substring(0, idx).trim()), a = un(line.substring(idx + 1).trim());
        if(q && a) {
          const newCard = { id: newCardId(), question: q, answer: a, category: targetBulkCategory, level: 0, correct: 0, incorrect: 0, streak: 0, wrongStreak: 0, shikkariStreak: 0 };
          touchCard(newCard);
          if (targetSharedDocId) newCard.sharedDocId = targetSharedDocId;
          db.push(newCard); addedCards.push(newCard); count++;
        }
      }
    });
  } else {
    // 【改行方式】奇数行が問題、偶数行が答え（テキスト出力の説明・フォルダーの行は除く）
    if (fromExport) { const keep = lines.filter(l => !/^#/.test(l)); lines.length = 0; lines.push(...keep.map(textUnesc)); }
    for (let i = 0; i < lines.length - 1; i += 2) {
      const q = lines[i];
      const a = lines[i+1];
      if (q && a) {
        const newCard = { id: newCardId(), question: q, answer: a, category: targetBulkCategory, level: 0, correct: 0, incorrect: 0, streak: 0, wrongStreak: 0, shikkariStreak: 0 };
        touchCard(newCard);
        if (targetSharedDocId) newCard.sharedDocId = targetSharedDocId;
        db.push(newCard); addedCards.push(newCard); count++;
      }
    }
  }
  
  if (targetSharedDocId) addCardsToSharedDoc(targetSharedDocId, addedCards);
  saveData(true); 
  if (typeof renderBox === 'function' && document.getElementById('pgBox').classList.contains('active')) renderBox(); 
  if (typeof renderTree === 'function' && document.getElementById('pgTree').classList.contains('active')) renderTree();
  closeBulkAdd(); 
  alert(`✅ ${count}件の問題を追加しました！`);
}
