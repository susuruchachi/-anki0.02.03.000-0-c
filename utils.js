// ★ ユーティリティ関数

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ★【0.03.02】onclick="fn(...)" の引数に文字列を安全に埋め込む（名前に ' や \ が入っていてもスクリプトとして実行されない）
function jsArg(v) {
  return JSON.stringify(String(v == null ? '' : v)).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;');
}
// 属性値（src など）に埋め込む文字列をエスケープする
function escAttr(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;');
}

// ================================================================
// ★【0.03.03】番号順の並べ替え・卒業基準・ひらがな/カタカナの同一視
// ================================================================
// 「#9」「#10」「第2章」などの数字を数として比べる（追加した順ではなく番号順に並べる）
const _naturalCollator = (typeof Intl !== 'undefined' && Intl.Collator) ? new Intl.Collator('ja', { numeric: true, sensitivity: 'base' }) : null;
function naturalCompare(a, b) {
  a = String(a == null ? '' : a); b = String(b == null ? '' : b);
  return _naturalCollator ? _naturalCollator.compare(a, b) : (a < b ? -1 : a > b ? 1 : 0);
}
// フォルダー名を番号順に並べる（「未分類」は最後）
function sortCategoryNames(names) {
  return [...(names || [])].sort((a, b) => (a === '未分類') - (b === '未分類') || naturalCompare(a, b));
}
// 卒業認定正解数（設定で変更可。レベルの上がり下がりの回数もこれに比例して変わる）
function getGradThreshold() {
  let v = 5;
  try { v = parseInt(localStorage.getItem('susuru_anki_grad_threshold'), 10); } catch (e) {}
  return Number.isFinite(v) && v >= 1 && v <= 30 ? v : 5;
}
function isGraduated(q) { return !!q && q.level >= 5 && (q.level5Correct || 0) >= getGradThreshold(); }
function srsParams() {
  const f = getGradThreshold() / 5;
  return {
    upStreak: Math.max(1, Math.round(2 * f)),     // 連続正解でレベルアップ
    downEvery: Math.max(1, Math.round(2 * f)),    // 不正解この回数ごとにレベルダウン
    shikkariAt: Math.max(2, Math.round(4 * f)),   // 連続不正解でしっかり(Lv-1)
    recoverAt: Math.max(1, Math.round(5 * f)),    // しっかりから復帰する連続正解
    level5Down: Math.max(1, Math.round(2 * f)),   // Lv5未卒業がLv4に下がる連続不正解
    ungradAt: Math.max(1, Math.round(5 * f)),     // 卒業取り消しの連続不正解
    grad: getGradThreshold()
  };
}
// カタカナをひらがなにそろえる（採点でひらがな・カタカナを同一視するため）
function foldKana(s) {
  return String(s || '').replace(/[\u30A1-\u30F6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
    // ★【0.03.05】化学式の添字（H₂SO₄）・上付き・全角記号を、打ちやすい形（H2SO4）とそろえる
    .replace(/[\u2080-\u2089]/g, c => String(c.charCodeAt(0) - 0x2080))
    .replace(/[\u2070\u00B9\u00B2\u00B3\u2074-\u2079]/g, c => ({ '\u2070': '0', '\u00B9': '1', '\u00B2': '2', '\u00B3': '3' }[c] || String(c.charCodeAt(0) - 0x2070)))
    .replace(/[\u207A\uFF0B]/g, '+').replace(/[\u207B\u2212\uFF0D]/g, '-').replace(/\uFF08/g, '(').replace(/\uFF09/g, ')');
}

// ================================================================
// ★【0.03.04】メモの中の「答えになってしまう部分」を隠す
// ・答えが日本語のとき（英→日）：「…」で書かれた和訳と ①②… の訳語を隠す（語源の（変化する）〈否定〉などは残す）
// ・答えが英語のとき（日→英。入れ替え・例文など）：英単語・語根（in- / -able / spect など）を隠す
// ================================================================
const NOTE_JA_RE = /[぀-ヿ㐀-鿿]/;
// メモを [{t: 文字列, hide: 隠すかどうか}] に分ける
function splitNoteForHiding(note, answerIsLatin) {
  const s = String(note || '');
  const re = answerIsLatin
    ? /-?[A-Za-z][A-Za-z'’]*-?(?:[ \t]+(?:[A-Za-z][A-Za-z'’\-]*|\[[^\]\n]*\]|\.\.\.|…|[A-C](?![A-Za-z])))*/g
    : /「[^」\n]*」|[①-⑳][^①-⑳\s。、「」()（）\/]+/g;
  const parts = []; let last = 0, m;
  while ((m = re.exec(s)) !== null) {
    const txt = m[0];
    // 英→日では、日本語を含む「…」・①… だけを隠す（「= suggest」のような英語は残す）
    if (!answerIsLatin && !NOTE_JA_RE.test(txt)) continue;
    if (answerIsLatin && /^[A-C]$/.test(txt)) continue; // 「A」「B」のような置き換え記号は残す
    if (m.index > last) parts.push({ t: s.slice(last, m.index), hide: false });
    parts.push({ t: txt, hide: true });
    last = m.index + txt.length;
  }
  if (last < s.length) parts.push({ t: s.slice(last), hide: false });
  return parts;
}
function isLatinAnswer(answer) {
  const a = String(answer || '').replace(/\([^()]*\)/g, '');
  return /[A-Za-z]/.test(a) && !NOTE_JA_RE.test(a);
}
// ヒント用：隠す部分を伏せ字にした文字列
function hideNoteTranslations(note, answerIsLatin) {
  return splitNoteForHiding(note, answerIsLatin).map(p => {
    if (!p.hide) return p.t;
    if (!answerIsLatin && p.t.startsWith('「')) return '「〇〇」';
    if (!answerIsLatin && /^[①-⑳]/.test(p.t)) return p.t[0] + '〇〇';
    return '＿＿';
  }).join('');
}
// 一覧表示用：隠す部分をタップで表示できるHTMLにする
function noteToSpoilerHTML(note, answerIsLatin) {
  return splitNoteForHiding(note, answerIsLatin).map(p => p.hide
    ? `<span class="note-spoiler" onclick="event.stopPropagation(); this.classList.toggle('shown')">${escapeHtml(p.t)}</span>`
    : escapeHtml(p.t)).join('');
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
  // ★【0.03.00】漢文の送り仮名 (…) や構造式は消さないよう、埋め込みブロックをマスクしてから除去する
  const mk = maskRichBlocks(text);
  return mk.restore(mk.masked.replace(/\s*\([^()]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim());
}

// answerText が「/区切り全パートが先頭に(タグ)を持つ」構造化解答かどうかを判定し、
// 該当すれば [{label, text}, ...] を返す。該当しなければ null（＝今まで通りの単一解答として扱う）。
// ・2パート未満（「/」が無い）場合は、先頭のタグが品詞名（名詞・他動詞・熟語 など）のときだけ対象にする
//   （数式の "(a+b)^2" 等の誤検知防止のため。★【0.03.01】単語帳取込の「(形容詞)合理的な　理性的な」のような1品詞のカード用）
// ・ラベルはタグ内のテキストをそのまま連結したもの（自動整形はしない＝カードの書き方がそのまま反映される）
// ★【0.03.02】「/」「|」で解答を区切るとき、[ ]・( ) の中の「/」は区切りとみなさない
// 例: be reminded of A [that ... / to do] は1つの解答
function splitAnswerAlternatives(text, sepChars = '/|') {
  const mk = maskRichBlocks(String(text == null ? '' : text));
  const src = mk.masked;
  const out = []; let cur = '', depth = 0;
  for (const ch of src) {
    if ('[［(（'.includes(ch)) depth++;
    else if (']］)）'.includes(ch)) depth = Math.max(0, depth - 1);
    if (depth === 0 && sepChars.includes(ch)) { out.push(mk.restore(cur)); cur = ''; continue; }
    cur += ch;
  }
  out.push(mk.restore(cur));
  return out;
}
const KNOWN_POS_TAGS = ['名詞', '動詞', '他動詞', '自動詞', '形容詞', '副詞', '前置詞', '接続詞', '代名詞', '助動詞', '間投詞', '熟語', '句', '成句'];
function isKnownPosTag(label) {
  return KNOWN_POS_TAGS.includes(String(label || '').replace(/[①-⑳0-9０-９]/g, '').trim());
}
function parseStructuredAnswer(answerText) {
  if (!answerText) return null;
  const rawSegments = splitAnswerAlternatives(answerText, '/');
  if (rawSegments.length < 2) {
    const single = String(rawSegments[0] || '').match(/^\s*\(([^()]*)\)/);
    if (!single || !isKnownPosTag(single[1])) return null;
  }
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
// ★【0.03.01】「（～を）意識している」「～を（…と）みなす」のような単語帳の訳語でも採点できるよう、
// カッコ内の補足・「～」「…」は無視して比べる
function normalizeStructuredToken(str) {
  if (!str) return '';
  let s = foldKana(String(str).replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).toLowerCase().trim());
  s = s.replace(/擦/g, 'こす');
  s = s.replace(/\([^()]*\)|（[^（）]*）/g, '');
  s = s.replace(/[～〜~…]|\.\.\./g, '');
  s = s.replace(/[\[\]［］【】]/g, ''); // ★【0.03.06】［ ］などの記号は入力しなくてよい（中身は必要）
  s = s.replace(/\s+/g, '');
  return s;
}
// 「～を考慮する」なら「考慮する」「を考慮する」のどちらで答えても正解にする
function structuredTokenForms(str) {
  const base = String(str || '').replace(/\([^()]*\)|（[^（）]*）/g, '').trim();
  const forms = [normalizeStructuredToken(str), normalizeStructuredToken(String(str || '').replace(/[\[［][^\]］]*[\]］]/g, ''))]; // ［ ］の言い換え部分を省いた形も正解
  const m = base.match(/^[～〜~]\s*[をにのとがへでやも]/);
  if (m) forms.push(normalizeStructuredToken(base.slice(m[0].length)));
  return forms.filter(f => f !== '');
}
function isStructuredSegmentCorrect(input, correctText) {
  const mk = maskRichBlocks(correctText);
  const candidates = mk.masked.split(/[\u3000,、/|]+/).map(s => mk.restore(s).trim()).filter(s => s !== '');
  if (candidates.length === 0) return false;
  const forms = new Set(candidates.flatMap(c => structuredTokenForms(c)));
  const inNorm = normalizeStructuredToken(input);
  if (inNorm === '') return false;
  if (forms.has(inNorm)) return true;
  // ★【0.03.02】「野蛮な 残忍な」「野蛮な、残忍な」のように複数の訳を区切って書いた場合も、
  // 区切った一つ一つがすべて正解の訳なら正解にする（以前は全体を1語として比べていたため不正解になっていた）
  const parts = String(input).split(/[\s\u3000、,，・／/]+/).map(normalizeStructuredToken).filter(x => x !== '');
  return parts.length > 1 && parts.every(p => forms.has(p));
}

// 構造化解答を表示用HTML（ラベル：本文、を1行ずつ）に整形する。
// lblQuizQuestion / feedbackAnswerText / selfAnswerDisplay と同じく、中身は意図的にエスケープしない
// （画像タグやKaTeX記法をそのまま埋め込めるようにする、既存の出題表示の方針に合わせるため）
function formatStructuredAnswerHTML(segments) {
  return segments.map(seg => {
    const labelPart = seg.label ? `<div style="font-size:0.75rem; color:var(--primary); font-weight:700; margin-bottom:1px;">🏷️ ${escAttr(seg.label)}</div>` : '';
    return `<div style="margin-bottom:8px; text-align:left;">${labelPart}<div>${renderRichText(seg.text, { escape: true })}</div></div>`;
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

// ================================================================
// ★【0.03.01】📚 単語帳取込：テキスト → カード候補への変換
// ・取込形式（1行1語「見出し語<TAB>答え」または「見出し語,答え」）… AIに変換してもらった結果などをそのまま読み込む
// ・鉄壁形式（番号＋見出し語／□派生語、品詞マーク付きの訳語）… OCR結果を品詞タグ付きの答えに整形する
// ================================================================
const VOCAB_POS_MARKS = { '名': '名詞', '動': '動詞', '他': '他動詞', '自': '自動詞', '形': '形容詞', '副': '副詞', '前': '前置詞', '接': '接続詞', '句': '熟語', '熟': '熟語' };

// 品詞マーク（[形]【名】(他) や、後ろに空白・①・～ が続く 形 名 他 …）で訳語を区切り、
// 「(形容詞)訳1　訳2/(名詞①)…/(名詞②)…」の構造化解答にする。マークが見つからなければ訳語を並べるだけ。
function convertVocabMeanings(block) {
  const lines = String(block || '').split(/\r?\n/)
    .map(l => l.replace(/\[[^\]\u3040-\u30ff\u4e00-\u9fff]*\]/g, ' ')   // 発音記号 [rǽʃənl]
               .replace(/\s*[★☆▶►◆◇※].*$/, '')                          // 行の途中からの解説・例文・熟語
               .trim())
    .filter(l => l !== '');
  const kept = lines.filter(l => {
    if (/^[▶►▷>★☆◆◇●「『※]/.test(l)) return false;           // 例文・解説・熟語・コラム
    if (/→\s*p\.?\s*\d+/i.test(l)) return false;               // 他ページ参照の関連語
    if (/^\[[^\]]*\]$/.test(l)) return false;                   // 発音記号だけの行
    const ascii = (l.match(/[A-Za-z]/g) || []).length;
    if (ascii > 12 && ascii / l.length > 0.5) return false;       // 英文（例文）
    return true;
  });
  let text = kept.join(' ').replace(/\([^()]*[A-Za-z][^()]*\)/g, '').replace(/\(=[^)]*\)/g, '');
  const markRe = /(?:[\[【［(（]\s*([名動他自形副前接句熟])\s*[\]】］)）]|(?:^|[\s,，、;；])([名動他自形副前接句熟])(?=[\s①-⑳～〜(（]))\s*/g;
  const parts = [];
  let m, last = null;
  while ((m = markRe.exec(text)) !== null) {
    if (last) last.body = text.slice(last.end, m.index);
    last = { pos: VOCAB_POS_MARKS[m[1] || m[2]], end: m.index + m[0].length };
    parts.push(last);
  }
  if (last) last.body = text.slice(last.end);
  const tidy = (t) => t.replace(/^[\s:：]+|[\s,，、;；]+$/g, '').replace(/\s*[,，、;；]\s*/g, '　').replace(/[ \t]+/g, ' ').trim()
    .replace(/\(/g, '（').replace(/\)/g, '）').replace(/ *（ */g, '（').replace(/ *） */g, '）');
  if (parts.length === 0) return tidy(text);
  const segs = [];
  parts.forEach(p => {
    const nums = String(p.body).split(/(?=[①-⑳])/).map(x => x.trim()).filter(x => x !== '');
    const numbered = nums.length > 1 || /^[①-⑳]/.test(nums[0] || '');
    nums.forEach(n => {
      const num = numbered ? (n.match(/^[①-⑳]/) || [''])[0] : '';
      const body = tidy(n.replace(/^[①-⑳]/, ''));
      if (body) segs.push(`(${p.pos}${num})${body}`);
    });
  });
  return segs.join('/');
}

// 鉄壁形式：「番号 + 見出し語」に加えて、行頭の「□ 派生語」も1語として切り出す
function splitTeppekiEntries(rawText) {
  const lines = String(rawText || '').split(/\r?\n/);
  const numRe = /^\s*(\d{1,4})[^A-Za-z\d]{0,15}([A-Za-z][A-Za-z'\-]*(?:\s[A-Za-z][A-Za-z'\-]*){0,4})/;
  const boxRe = /^\s*[□口ロ☐◻▢]\s*([A-Za-z][A-Za-z'\-]*(?:\s[A-Za-z][A-Za-z'\-]*){0,4})/;
  const marks = [];
  lines.forEach((line, i) => {
    if (/→\s*p\.?\s*\d+/i.test(line)) return; // 他ページ参照の関連語は見出しにしない
    const m = line.match(numRe) || line.match(boxRe);
    if (m) marks.push({ lineIdx: i, headword: (m[2] || m[1]).trim() });
  });
  const entries = [];
  for (let i = 0; i < marks.length; i++) {
    const blockLines = lines.slice(marks[i].lineIdx, i + 1 < marks.length ? marks[i + 1].lineIdx : lines.length);
    const first = blockLines[0];
    const at = first.indexOf(marks[i].headword);
    const rest = [at !== -1 ? first.slice(at + marks[i].headword.length) : '', ...blockLines.slice(1)].join('\n');
    const answer = convertVocabMeanings(rest.replace(/[*＊⁑]+/g, ''));
    entries.push({ question: marks[i].headword, answer });
  }
  return entries.filter(e => e.question && e.answer);
}

// 取込形式：1行1語「見出し語<TAB>答え」（タブが無ければ最初の半角カンマで区切る）。
// AIの出力にありがちなコードブロックの ``` や見出し行は読み飛ばす。
function parseDelimitedVocab(rawText) {
  const entries = [];
  String(rawText || '').split(/\r?\n/).forEach(line => {
    const l = line.trim();
    if (!l || /^```/.test(l)) return;
    let idx = l.indexOf('\t');
    if (idx === -1) idx = l.indexOf(',');
    if (idx === -1) return;
    const q = l.slice(0, idx).trim().replace(/^"|"$/g, '');
    const a = l.slice(idx + 1).trim().replace(/^"|"$/g, '');
    if (!q || !a || (q === '問題' || q === '見出し語')) return;
    entries.push({ question: q, answer: a });
  });
  return entries;
}

// format: 'auto' | 'delimited' | 'teppeki'
function parseVocabText(rawText, format = 'auto') {
  if (format === 'delimited') return parseDelimitedVocab(rawText);
  if (format === 'teppeki') return splitTeppekiEntries(rawText);
  const lines = String(rawText || '').split(/\r?\n/).filter(l => l.trim() !== '' && !/^```/.test(l.trim()));
  const tabbed = lines.filter(l => l.includes('\t')).length;
  if (lines.length && tabbed / lines.length >= 0.6) return parseDelimitedVocab(rawText);
  const teppeki = splitTeppekiEntries(rawText);
  return teppeki.length ? teppeki : parseDelimitedVocab(rawText);
}

// AIに変換を頼むときのプロンプト（📚 単語帳取込の「プロンプトをコピー」で使う）
const VOCAB_AI_PROMPT = [
  '添付した単語帳のページを、暗記アプリ「すするanki」に取り込める形式に変換してください。',
  '',
  '【出力形式】',
  '・1行に1語、「見出し語<TAB>答え」のタブ区切り。変換結果だけをコードブロックで出力してください。',
  '',
  '【答えの書き方】',
  '・品詞ごとに「(品詞)訳語」と書く。品詞は 名詞／動詞／他動詞／自動詞／形容詞／副詞／前置詞／接続詞／熟語 のどれか。',
  '・品詞が複数あるとき、または①②で意味が分かれているときは半角「/」で区切る。同じ品詞の①②は (名詞①)(名詞②) のように番号を付ける。',
  '　例: reason<TAB>(名詞①)理由　根拠/(名詞②)理性/(自動詞)論理的に考える',
  '・同じ意味の言い換えは全角スペースで区切る。　例: rational<TAB>(形容詞)合理的な　理性的な',
  '・「（～を）」のような補足は全角カッコで書く。答えの中で半角「/」は区切り以外に使わない（必要なら全角「／」）。',
  '・番号の無い派生語も1語として含める。◆の熟語・成句は、その英語表現を見出し語にして「(熟語)訳」で1行にする。',
  '・例文（▶）、解説（★）、他ページ参照（→p.○○）の語、Check!、Review Test は含めない。'
].join('\n');

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
