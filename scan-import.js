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
  document.getElementById('scanImportTitle').innerText = `📚 単語帳取込: ${catName}`;
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

// ★【0.03.01】カード箱から開く場合は、表示中のフォルダー（無ければ未分類）に取り込む
function showScanImportFromBox() {
  const cat = (typeof currentViewContext === 'object' && currentViewContext.type === 'category') ? currentViewContext.value : '未分類';
  showScanImportModal(cat);
}

async function copyVocabAiPrompt() {
  try {
    await navigator.clipboard.writeText(VOCAB_TEXT_PROMPT);
    alert('📋 プロンプト（テキスト版）をコピーしました！\nAIに単語帳の写真やPDFと一緒に送って、返ってきたテキストをここに貼ってください。');
  } catch (e) {
    // クリップボードが使えない環境では、テキスト欄に入れて手動コピーしてもらう
    const ta = document.getElementById('txtScanRaw');
    ta.value = VOCAB_TEXT_PROMPT; ta.focus(); ta.select();
    alert('コピーできなかったので、テキスト欄にプロンプトを入れました。全選択してコピーしてください。\n（AIの結果を貼るときは、この内容を消してから貼り付けてください）');
  }
}

// ★【0.03.01】PDFは pdf.js で1ページずつ画像にしてからOCRにかける
async function pdfFileToImageDataURLs(file, onProgress) {
  if (typeof pdfjsLib === 'undefined') throw new Error('PDFライブラリを読み込めません');
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
  }
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const urls = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    if (onProgress) onProgress(n, pdf.numPages);
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(3, 1800 / Math.max(base.width, base.height)) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    urls.push(canvas.toDataURL('image/jpeg', 0.9));
  }
  return urls;
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
  if (!files || files.length === 0) { alert('画像またはPDFを選択してください。'); return; }
  if (typeof Tesseract === 'undefined') { alert('⚠️ OCRライブラリの読み込みに失敗しました。通信環境を確認して再度お試しください。'); return; }

  const progressEl = document.getElementById('scanImportProgress');
  const btn = document.getElementById('btnRunScanOcr');
  progressEl.style.display = 'block'; progressEl.innerText = '🔍 OCRエンジンを準備中...(初回は数十秒かかることがあります)';
  btn.disabled = true;

  try {
    const worker = await getScanOcrWorker();
    let combined = document.getElementById('txtScanRaw').value;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      let images;
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        images = await pdfFileToImageDataURLs(file, (n, total) => { progressEl.innerText = `📄 PDF ${i + 1}/${files.length}：ページ ${n}/${total} を画像に変換中...`; });
      } else {
        // ★ カード保存用の圧縮(640px)より高い解像度でOCRにかけ、細かい文字の認識精度を優先する
        images = [await compressImageToDataURL(file, 1800, 0.9)];
      }
      for (let j = 0; j < images.length; j++) {
        progressEl.innerText = `🔍 ファイル ${i + 1}/${files.length}` + (images.length > 1 ? ` のページ ${j + 1}/${images.length}` : '') + ' を文字認識中...';
        const { data: { text } } = await worker.recognize(images[j]);
        // ★【0.03.01】日本語OCRで入りがちな「文 字 の 間 の 空白」を詰める
        const tidied = text.trim().replace(/([\u3000-\u30ff\u4e00-\u9fff\uff00-\uffef]) +(?=[\u3000-\u30ff\u4e00-\u9fff\uff00-\uffef])/g, '$1');
        combined += (combined.trim() ? '\n\n----\n\n' : '') + tidied;
      }
    }
    document.getElementById('txtScanRaw').value = combined.trim();
    progressEl.innerText = '✅ 文字認識が完了しました。誤認識が多いことがあるので、内容を確認・修正してから「📑 カード候補を作る」を押してください。';
  } catch (e) {
    console.error('OCR error', e);
    progressEl.innerText = '⚠️ OCR処理中にエラーが発生しました。通信環境を確認するか、別の画像でお試しください。';
    scanImportOcrWorker = null; // 壊れたワーカーは破棄し、次回作り直す
  } finally {
    btn.disabled = false;
  }
}

// ★【0.03.15】AI で読み取る（PDF・写真を、単語帳の形「見出し語<TAB>答え」にしてもらう）
async function runScanAi() {
  const files = document.getElementById('scanImportFileInput').files;
  if (!files || files.length === 0) { alert('画像またはPDFを選択してください。'); return; }
  if (typeof aiAvailable !== 'function' || !aiAvailable()) { alert('AI のキーが設定されていません。\n⚙️ 設定 →「🤖 AI」でキーを入れるか、家族にキーを共有してもらってください。'); return; }
  const progressEl = document.getElementById('scanImportProgress');
  const btn = document.getElementById('btnRunScanAi');
  progressEl.style.display = 'block';
  btn.disabled = true;
  try {
    let combined = document.getElementById('txtScanRaw').value;
    for (let i = 0; i < files.length; i++) {
      const text = await aiReadVocabFile(files[i], msg => { progressEl.innerText = `(${i + 1}/${files.length}) ` + msg; });
      combined += (combined.trim() ? '\n' : '') + text;
    }
    document.getElementById('txtScanRaw').value = combined.trim();
    const sel = document.getElementById('selScanFormat'); if (sel) sel.value = isVocabTextFormat(combined) ? 'text' : 'delimited';
    progressEl.innerText = '✅ AIで読み取りました。内容を確認して「📑 カード候補を作る」を押してください。';
  } catch (e) {
    console.error('AI read error', e);
    progressEl.innerText = '⚠️ ' + e.message;
  } finally { btn.disabled = false; }
}

function scanSplitEntries() {
  const raw = document.getElementById('txtScanRaw').value;
  if (!raw.trim()) { alert('テキストがありません。'); return; }
  const format = (document.getElementById('selScanFormat') || {}).value || 'auto';
  // ★【0.03.50】テキスト版（■グループ・[No.]・意味：）なら、アプリが組み替える
  if (format === 'text' || (format === 'auto' && isVocabTextFormat(raw))) return scanFromVocabText(raw);
  const parsed = parseVocabText(raw, format);
  if (parsed.length === 0) { alert('カード候補が見つかりませんでした。\n・1行1語なら「見出し語（タブかカンマ）答え」の形にしてください\n・単語帳形式なら「247 complete …」のように行頭に見出し語番号が必要です'); return; }
  scanImportEntries = parsed.map((p, i) => ({ id: 'tmp_' + i + '_' + Date.now(), question: p.question, answer: p.answer, note: p.note || '', stars: p.stars || 0 }));
  renderScanReviewList();
  document.getElementById('scanRawArea').style.display = 'none';
  document.getElementById('scanReviewArea').style.display = 'block';
}

function scanFromVocabText(raw) {
  const vp = vtParse(raw);
  if (!vp.groups.length) { alert('テキスト版の書式（[No.…] と 意味：）が読み取れませんでした。'); return; }
  const n = vp.groups.length, hasExtra = vp.groups.some(g => g.intro || g.checks.length || g.items.some(w => w.exprs.length));
  // グループ・導入・例文・Check! があれば、「テキストから問題を作る」でフォルダーを分けて取り込むのがおすすめ
  if (n > 1 || hasExtra) {
    if (typeof _drillActive !== 'undefined' && _drillActive) { alert('暗記テストを解いている途中です。暗記タブで「🏁 やめる」を押してから、もう一度「📑 カード候補を作る」を押してください。'); return; }
    if (confirm(`グループ ${n} 個${hasExtra ? '・導入の文・熟語・例文・Check!' : ''} が読み取れました。\n\nOK：「📄 テキストから問題を作る」で、グループごとのフォルダー・例文・Check!・導入の文もまとめて取り込む（おすすめ）\nキャンセル：単語（派生語・熟語を含む）だけを「${scanImportTargetCategory}」に取り込む`)) {
      closeScanImport();
      _vt = { text: raw, name: vtSectionName(vp.title) || '', parent: scanImportTargetCategory };
      openPage('pgDrill'); vtOpen();
      setTimeout(() => { try { document.getElementById('vtParent').value = scanImportTargetCategory; vtPreview(); } catch (e) {} }, 50);
      return;
    }
  }
  const { cards } = vtCards(vp, vtSectionName(vp.title) || 'X');
  scanImportEntries = cards.filter(c => !c.kind).map((c, i) => ({ id: 'tmp_' + i + '_' + Date.now(), question: c.q, answer: c.a, note: c.note || '', stars: c.stars || 0 }));
  if (!scanImportEntries.length) { alert('カード候補が見つかりませんでした。'); return; }
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
    // ★【0.03.29】メモと星（AI の読み取り・タブ区切りの3・4列目）
    if (entry.note || entry.stars) {
      const extra = document.createElement('div'); extra.className = 'hint-small'; extra.style.margin = '4px 0';
      extra.textContent = (entry.stars ? '★'.repeat(entry.stars) + '　' : '') + (entry.note ? '📝 ' + entry.note : '');
      card.appendChild(extra);
    }
    card.appendChild(tagRow);
    card.appendChild(delBtn);
    container.appendChild(card);
  });
}

async function submitScanImport() {
  if (scanImportEntries.length === 0) { alert('追加する項目がありません。'); return; }

  // ★ 権限チェック（一括追加・単発追加と同じロジック）
  let targetSharedDocId = null;
  const shareInfo = getCategoryShareInfo(scanImportTargetCategory);
  if (shareInfo.shared) {
    if (shareInfo.readOnly) return alert("🔒 この共有/公開カテゴリーは閲覧専用のため、問題を追加できません。");
    targetSharedDocId = shareInfo.docId;
  }

  let count = 0;
  const addedCards = [];
  scanImportEntries.forEach(entry => {
    const q = entry.question.trim(), a = entry.answer.trim();
    if (!q || !a) return;
    const newCard = { id: newCardId(), question: q, answer: a, category: scanImportTargetCategory, level: 0, correct: 0, incorrect: 0, streak: 0, wrongStreak: 0, shikkariStreak: 0 };
    if (entry.note) newCard.note = entry.note;
    if (entry.stars) newCard.stars = entry.stars;
    touchCard(newCard);
    if (targetSharedDocId) newCard.sharedDocId = targetSharedDocId;
    db.push(newCard); addedCards.push(newCard); count++;
  });
  if (targetSharedDocId) addCardsToSharedDoc(targetSharedDocId, addedCards);

  saveData(true);
  if (typeof renderBox === 'function' && document.getElementById('pgBox').classList.contains('active')) renderBox();
  if (typeof renderTree === 'function' && document.getElementById('pgTree').classList.contains('active')) renderTree();
  closeScanImport();
  alert(`✅ ${count}件の問題を追加しました！`);
}
