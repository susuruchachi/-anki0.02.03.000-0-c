// ================================================================
// ★【0.02.64】📷 スキャン取込
// 単語帳のページ写真 → OCR(Tesseract.js) → 「番号+見出し語」で自動分割 → レビュー・修正 → 一括追加
// 鉄壁のような「品詞タグ付き多義語」形式の単語帳に最適化（quiz.jsの構造化解答機能と連動）
// ================================================================

let scanImportTargetCategory = "";
let scanImportEntries = []; // レビュー中のエントリー配列 [{id, question, answer}]
let scanImportOcrWorker = null; // Tesseractワーカーはセッション中使い回す（言語データの再ダウンロードを避けるため）

function showScanImportModal(catName) {
  scanImportTargetCategory = catName;
  document.getElementById('scanImportTitle').innerText = `📷 スキャン取込: ${catName}`;
  document.getElementById('scanImportFileInput').value = '';
  document.getElementById('txtScanRaw').value = '';
  const progressEl = document.getElementById('scanImportProgress');
  progressEl.style.display = 'none'; progressEl.innerText = '';
  document.getElementById('scanReviewList').innerHTML = '';
  scanImportEntries = [];
  document.getElementById('scanReviewArea').style.display = 'none';
  document.getElementById('scanRawArea').style.display = 'block';
  document.getElementById('scanImportOverlay').style.display = 'flex';
}

function closeScanImport() {
  document.getElementById('scanImportOverlay').style.display = 'none';
}

function translateOcrStatus(status) {
  const map = {
    'loading tesseract core': 'コア読み込み中',
    'initializing tesseract': '初期化中',
    'loading language traineddata': '言語データ読み込み中(初回は時間がかかります)',
    'initializing api': '準備中',
    'recognizing text': '文字認識中'
  };
  return map[status] || status || '処理中';
}

async function getScanOcrWorker() {
  if (scanImportOcrWorker) return scanImportOcrWorker;
  const progressEl = document.getElementById('scanImportProgress');
  const worker = Tesseract.createWorker({
    logger: m => {
      if (m && m.status) {
        const pct = typeof m.progress === 'number' ? ` ${Math.round(m.progress * 100)}%` : '';
        progressEl.innerText = `🔍 ${translateOcrStatus(m.status)}${pct}`;
      }
    }
  });
  await worker.load();
  await worker.loadLanguage('jpn+eng');
  await worker.initialize('jpn+eng');
  scanImportOcrWorker = worker;
  return worker;
}

async function runScanOcr() {
  const files = document.getElementById('scanImportFileInput').files;
  if (!files || files.length === 0) { alert('画像を選択してください。'); return; }
  if (typeof Tesseract === 'undefined') { alert('⚠️ OCRライブラリの読み込みに失敗しました。通信環境を確認して再度お試しください。'); return; }

  const progressEl = document.getElementById('scanImportProgress');
  const btn = document.getElementById('btnRunScanOcr');
  progressEl.style.display = 'block'; progressEl.innerText = '🔍 OCRエンジンを準備中...(初回は数十秒かかることがあります)';
  btn.disabled = true;

  try {
    const worker = await getScanOcrWorker();
    let combined = document.getElementById('txtScanRaw').value;
    for (let i = 0; i < files.length; i++) {
      progressEl.innerText = `🔍 画像 ${i + 1}/${files.length} を処理中...`;
      // ★ カード保存用の圧縮(640px)より高い解像度でOCRにかけ、細かい文字の認識精度を優先する
      const prepared = await compressImageToDataURL(files[i], 1800, 0.9);
      const { data: { text } } = await worker.recognize(prepared);
      combined += (combined.trim() ? '\n\n----\n\n' : '') + text.trim();
    }
    document.getElementById('txtScanRaw').value = combined.trim();
    progressEl.innerText = '✅ 文字認識が完了しました。内容を確認・修正してから「単語ごとに分割」を押してください。';
  } catch (e) {
    console.error('OCR error', e);
    progressEl.innerText = '⚠️ OCR処理中にエラーが発生しました。通信環境を確認するか、別の画像でお試しください。';
    scanImportOcrWorker = null; // 壊れたワーカーは破棄し、次回作り直す
  } finally {
    btn.disabled = false;
  }
}

function scanSplitEntries() {
  const raw = document.getElementById('txtScanRaw').value;
  if (!raw.trim()) { alert('テキストがありません。'); return; }
  const parsed = splitOcrIntoEntries(raw);
  if (parsed.length === 0) { alert('「番号 + 英単語」のパターンが見つかりませんでした。\n(例: 「247 complete ...」のように行頭に見出し語番号が必要です)\nテキストを確認するか、直接カード追加をご利用ください。'); return; }
  scanImportEntries = parsed.map((p, i) => ({ id: 'tmp_' + i + '_' + Date.now(), question: p.question, answer: p.answer }));
  renderScanReviewList();
  document.getElementById('scanRawArea').style.display = 'none';
  document.getElementById('scanReviewArea').style.display = 'block';
}

function scanBackToRaw() {
  document.getElementById('scanReviewArea').style.display = 'none';
  document.getElementById('scanRawArea').style.display = 'block';
}

function renderScanReviewList() {
  const container = document.getElementById('scanReviewList');
  container.innerHTML = '';
  document.getElementById('scanReviewCount').innerText = scanImportEntries.length;

  scanImportEntries.forEach(entry => {
    const card = document.createElement('div');
    card.style.cssText = 'background:var(--bg3); border:1px solid var(--border); border-radius:10px; padding:12px; margin-bottom:10px;';

    const qInput = document.createElement('input');
    qInput.type = 'text'; qInput.className = 'form-control'; qInput.value = entry.question;
    qInput.placeholder = '見出し語';
    qInput.style.cssText = 'margin-bottom:6px; font-weight:700;';
    qInput.oninput = () => { entry.question = qInput.value; };

    const aTextarea = document.createElement('textarea');
    aTextarea.className = 'form-control'; aTextarea.value = entry.answer;
    aTextarea.placeholder = '答え（下のタグをタップして (品詞) を挿入できます）';
    aTextarea.style.cssText = 'height:70px; font-size:0.82rem;';
    aTextarea.oninput = () => { entry.answer = aTextarea.value; };

    const tagRow = buildTagChipRow(aTextarea);

    const delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.innerText = '🗑️ この項目を除外';
    delBtn.style.cssText = 'font-size:0.72rem; padding:5px 10px; border-radius:8px; border:none; background:rgba(255,79,106,0.15); color:var(--danger); cursor:pointer;';
    delBtn.onclick = () => { scanImportEntries = scanImportEntries.filter(e => e.id !== entry.id); renderScanReviewList(); };

    card.appendChild(qInput);
    card.appendChild(aTextarea);
    card.appendChild(tagRow);
    card.appendChild(delBtn);
    container.appendChild(card);
  });
}

async function submitScanImport() {
  if (scanImportEntries.length === 0) { alert('追加する項目がありません。'); return; }

  // ★ 権限チェック（一括追加・単発追加と同じロジック）
  let targetSharedDocId = null;
  const existingCard = db.find(q => q.category === scanImportTargetCategory && q.sharedDocId);
  if (existingCard) {
    targetSharedDocId = existingCard.sharedDocId;
    const perm = sharedDocPermissions[targetSharedDocId];
    if (!perm || !perm.canEdit) return alert("🔒 この共有/公開カテゴリーは閲覧専用のため、問題を追加できません。");
  }

  let count = 0;
  scanImportEntries.forEach(entry => {
    const q = entry.question.trim(), a = entry.answer.trim();
    if (!q || !a) return;
    const newCard = { id: 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36), question: q, answer: a, category: scanImportTargetCategory, level: 0, correct: 0, incorrect: 0, streak: 0, wrongStreak: 0, shikkariStreak: 0 };
    if (targetSharedDocId) { newCard.sharedDocId = targetSharedDocId; updateCardInSharedDoc(targetSharedDocId, newCard, 'add'); }
    db.push(newCard); count++;
  });

  saveData(true);
  if (typeof renderBox === 'function' && document.getElementById('pgBox').classList.contains('active')) renderBox();
  if (typeof renderTree === 'function' && document.getElementById('pgTree').classList.contains('active')) renderTree();
  closeScanImport();
  alert(`✅ ${count}件の問題を追加しました！`);
}
