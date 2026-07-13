// ★ ユーティリティ関数

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function toggleLightMode(forceOn = false) {
  const isLight = forceOn || !document.body.classList.contains('light-mode');
  if(isLight) document.body.classList.add('light-mode'); else document.body.classList.remove('light-mode');
  localStorage.setItem('theme_light', isLight);
  if(chartInstance) renderStatsAndCharts();
}

// ================================================================
// ★【0.02.63】品詞タグ付き複数解答（構造化解答）関連ユーティリティ
// 例：A. (他動詞)(SVO1 to O2)O1をO2に適合させる　合わせる/(自動詞)(SV to O)Oに適応する　慣れる
// のように、「/」区切りの各パートが先頭に (タグ) を1つ以上持つ場合、
// クイズ出題時に「タグごとの入力欄」として出題できるようにする。
// ================================================================

// 文字列中の (…) を丸ごと除去する（ネストなし前提）。出題文からタグ注記を隠すために使う。
function stripParens(text) {
  if (!text) return text;
  return String(text).replace(/\s*\([^()]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

// answerText が「/区切り全パートが先頭に(タグ)を持つ」構造化解答かどうかを判定し、
// 該当すれば [{label, text}, ...] を返す。該当しなければ null（＝今まで通りの単一解答として扱う）。
// ・2パート未満（「/」が無い）場合は対象外（数式の "(a+b)^2" 等の誤検知防止のため）
// ・ラベルはタグ内のテキストをそのまま連結したもの（自動整形はしない＝カードの書き方がそのまま反映される）
function parseStructuredAnswer(answerText) {
  if (!answerText) return null;
  const rawSegments = String(answerText).split('/');
  if (rawSegments.length < 2) return null;
  const segTagRe = /^\s*((?:\([^()]*\)\s*)+)([\s\S]*)$/;
  const result = [];
  for (const raw of rawSegments) {
    const m = raw.match(segTagRe);
    if (!m) return null; // タグの無いパートが1つでもあれば「通常の複数候補解答」として扱う
    const rest = m[2].trim();
    if (!rest) return null; // タグしかない壊れたパートは対象外
    const tagInnerRe = /\(([^()]*)\)/g;
    let labels = [], tm;
    while ((tm = tagInnerRe.exec(m[1])) !== null) { const t = tm[1].trim(); if (t !== '') labels.push(t); }
    result.push({ label: labels.join(' '), text: rest });
  }
  return result.length > 0 ? result : null;
}

// 構造化解答セグメント内の正解文字列を「全角スペース/読点/「/」/「|」区切りのどれか一つで正解」として判定する。
// （通常の normalizeAnswer は空白区切りを「すべて必須」として扱うため、辞書的な言い換え列挙の採点には使えない）
function normalizeStructuredToken(str) {
  if (!str) return '';
  let s = String(str).replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).toLowerCase().trim();
  s = s.replace(/擦/g, 'こす');
  s = s.replace(/\s+/g, '');
  return s;
}
function isStructuredSegmentCorrect(input, correctText) {
  const candidates = String(correctText).split(/[\u3000,、/|]+/).map(s => s.trim()).filter(s => s !== '');
  if (candidates.length === 0) return false;
  const inNorm = normalizeStructuredToken(input);
  if (inNorm === '') return false;
  return candidates.some(c => normalizeStructuredToken(c) === inNorm);
}

// 構造化解答を表示用HTML（ラベル：本文、を1行ずつ）に整形する。
// lblQuizQuestion / feedbackAnswerText / selfAnswerDisplay と同じく、中身は意図的にエスケープしない
// （画像タグやKaTeX記法をそのまま埋め込めるようにする、既存の出題表示の方針に合わせるため）
function formatStructuredAnswerHTML(segments) {
  return segments.map(seg => {
    const labelPart = seg.label ? `<div style="font-size:0.75rem; color:var(--primary); font-weight:700; margin-bottom:1px;">🏷️ ${seg.label}</div>` : '';
    return `<div style="margin-bottom:8px; text-align:left;">${labelPart}<div>${seg.text}</div></div>`;
  }).join('');
}

// ================================================================
// ★【0.02.63】問題・解答への画像添付ユーティリティ
// Firestoreの1ドキュメント上限（約1MB）とlocalStorageの容量を圧迫しないよう、
// アップロード画像はcanvasで縮小・JPEG圧縮してからdata URLとして保存する。
// ================================================================
// ================================================================
// ★【0.02.64】スキャン取込（OCR結果の鉄壁形式スマート分割）関連ユーティリティ
// ================================================================

// OCR結果の余分な空白・改行を軽く整える（過度な加工はしない＝ユーザーの確認前提）
function cleanOcrBlock(text) {
  return String(text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// 「行頭の数字（見出し語番号）+ 英単語」を新しい単語エントリーの開始とみなし、
// OCRテキストを単語ごとのブロックに分割する。派生語（completion等）は行頭に番号が
// 無いのでエントリーとして分離されず、直前の見出し語のブロックに含まれる。
// 戻り値: [{question: 見出し語, answer: 残りのブロック(未整形)}, ...]
function splitOcrIntoEntries(rawText) {
  const text = String(rawText || '');
  const lines = text.split(/\r?\n/);
  // 数字の直後に多少OCRノイズ（記号など）が挟まっても英単語を拾えるように寛容にする
  const boundaryRe = /^\s*(\d{1,4})[^A-Za-z]{0,15}([A-Za-z][A-Za-z'\-]*(?:\s[A-Za-z][A-Za-z'\-]*){0,3})/;
  const marks = [];
  lines.forEach((line, i) => {
    const m = line.match(boundaryRe);
    if (m) marks.push({ lineIdx: i, headword: m[2].trim() });
  });
  if (marks.length === 0) return [];
  const entries = [];
  for (let i = 0; i < marks.length; i++) {
    const startLine = marks[i].lineIdx;
    const endLine = i + 1 < marks.length ? marks[i + 1].lineIdx : lines.length;
    const blockLines = lines.slice(startLine, endLine);
    const headword = marks[i].headword;
    const firstLine = blockLines[0];
    const afterIdx = firstLine.indexOf(headword);
    const restOfFirstLine = afterIdx !== -1 ? firstLine.slice(afterIdx + headword.length) : '';
    const restBlock = [restOfFirstLine, ...blockLines.slice(1)].join('\n');
    entries.push({ question: headword, answer: cleanOcrBlock(restBlock) });
  }
  return entries.filter(e => e.question && e.answer);
}

// テキストエリア/inputのカーソル位置に文字列を挿入する（品詞タグのワンタップ挿入用）
function insertAtCursor(fieldEl, insertText) {
  if (!fieldEl) return;
  const start = fieldEl.selectionStart != null ? fieldEl.selectionStart : fieldEl.value.length;
  const end = fieldEl.selectionEnd != null ? fieldEl.selectionEnd : fieldEl.value.length;
  fieldEl.value = fieldEl.value.slice(0, start) + insertText + fieldEl.value.slice(end);
  const newPos = start + insertText.length;
  fieldEl.focus();
  if (fieldEl.setSelectionRange) fieldEl.setSelectionRange(newPos, newPos);
}

// 品詞タグのワンタップ挿入チップ行を生成する（レビュー一覧など動的生成箇所で使用）
const TAG_CHIP_LABELS = ['他動詞', '自動詞', '名詞', '形容詞', '副詞', '前置詞', '接続詞', '/'];
function buildTagChipRow(textareaEl) {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex; flex-wrap:wrap; gap:4px; margin:6px 0;';
  TAG_CHIP_LABELS.forEach(tag => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.innerText = tag === '/' ? '／区切り' : tag;
    chip.style.cssText = 'font-size:0.7rem; padding:4px 9px; border-radius:12px; border:1px solid var(--border); background:var(--bg4); color:var(--text2); cursor:pointer;';
    chip.onclick = () => { insertAtCursor(textareaEl, tag === '/' ? '/' : `(${tag})`); };
    row.appendChild(chip);
  });
  return row;
}

function compressImageToDataURL(file, maxDim = 640, quality = 0.6) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith('image/')) { reject(new Error('画像ファイルではありません')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
          else { width = Math.round(width * (maxDim / height)); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height); // 透過PNG→JPEG時に背景を白で塗る
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
