// ----------------- クイズ機能 -----------------

// ----------------- ネイティブ発音対応 TTSエンジン -----------------
const JA_CHAR_RE = /[　-ヿ㐀-鿿豈-﫿！-｠]/;
function isEnglishText(text) {
  if (!text) return false;
  const t = text.trim();
  // ★【0.03.02】日本語の文字が無く、アルファベットを含めば英語（[ ] / ～ などの記号が混ざっていても英語の声で読む）
  return /[A-Za-z]/.test(t) && !JA_CHAR_RE.test(t);
}

function getBestVoice(langPrefix) {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  let bestVoice = voices.find(v => 
    v.lang.toLowerCase().startsWith(langPrefix) && 
    (v.name.includes('Google') || v.name.includes('Premium') || v.name.includes('Natural'))
  );
  if (!bestVoice) {
    bestVoice = voices.find(v => v.lang.toLowerCase().startsWith(langPrefix));
  }
  return bestVoice;
}

// 読み上げ用に記号を整える（[to be] → to be、空欄 ( ) → 「ブランク」など）
function cleanTextForSpeech(text) {
  return String(text || '')
    .replace(/[\[\]［］]/g, ' ')
    .replace(/\(\s*\)|（\s*）|\(　+\)|（　+）|_{2,}|＿{2,}/g, ' blank ')
    .replace(/[～〜~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
// ★【0.03.02】英語と日本語が混ざった文は、英語の部分は英語の声、日本語の部分は日本語の声で順番に読む
function splitSpeechSegments(text) {
  const segs = [];
  const re = /[　-ヿ㐀-鿿豈-﫿！-｠]+/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segs.push({ ja: false, t: text.slice(last, m.index) });
    segs.push({ ja: true, t: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ ja: false, t: text.slice(last) });
  // アルファベットを含まない部分（数字・記号）は前の部分にくっつける
  const merged = [];
  segs.forEach(sg => {
    if (!sg.ja && !/[A-Za-z]/.test(sg.t)) { if (merged.length) merged[merged.length - 1].t += sg.t; else merged.push({ ja: true, t: sg.t }); }
    else if (merged.length && merged[merged.length - 1].ja === sg.ja) merged[merged.length - 1].t += sg.t;
    else merged.push({ ...sg });
  });
  return merged.filter(sg => sg.t.trim() !== '' && /[^\s.,。、・()（）\-]/.test(sg.t));
}

function speakText(text, options = {}) {
  if (!('speechSynthesis' in window) || localStorage.getItem('muteTTS') === 'true') return;
  window.speechSynthesis.cancel();
  if (!text || text.trim() === "") return;

  const div = document.createElement('div');
  // ★【0.03.00】漢文は書き下し文で、構造式は「構造式」と読み上げる
  div.innerHTML = typeof richTextToSpeech === 'function' ? richTextToSpeech(text) : text;
  const plainText = cleanTextForSpeech(div.textContent || div.innerText || "");
  if (!plainText) return;

  const segments = isEnglishText(plainText) ? [{ ja: false, t: plainText }] : splitSpeechSegments(plainText);
  const enVoice = getBestVoice('en'), jaVoice = getBestVoice('ja');
  segments.forEach(sg => {
    const utterance = new SpeechSynthesisUtterance(sg.t.trim());
    utterance.rate = options.rate || 1.0;
    utterance.pitch = options.pitch || 1.0;
    utterance.volume = options.volume || 1.0;
    const v = sg.ja ? jaVoice : enVoice;
    if (v) { utterance.voice = v; utterance.lang = v.lang; } else utterance.lang = sg.ja ? 'ja-JP' : 'en-US';
    utterance.onerror = (e) => console.error("TTSエラー:", e);
    window.speechSynthesis.speak(utterance);
  });
}

if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    getBestVoice('en'); getBestVoice('ja');
  };
}
// -----------------------------------------------------------

const SCOPE_STORAGE_KEY = 'susuru_anki_scope_path';
function saveScopePath() {
  try { localStorage.setItem(SCOPE_STORAGE_KEY, JSON.stringify(selectedScopePath)); } catch(e) {}
}
function loadScopePath() {
  try { const s = localStorage.getItem(SCOPE_STORAGE_KEY); if(s) selectedScopePath = JSON.parse(s); } catch(e) {}
}

// ★【0.03.07】教科で出題範囲を絞り込む
function getScopeSubject() { try { return localStorage.getItem('susuru_anki_scope_subject') || ''; } catch (e) { return ''; } }
function onScopeSubjectChange(v) {
  try { localStorage.setItem('susuru_anki_scope_subject', v); } catch (e) {}
  // 選んだ教科を含まないフォルダーが選ばれていたら、範囲を「全て」に戻す
  if (v && selectedScopePath.length && selectedScopePath[0] !== 'all' && !categoryHasSubject(selectedScopePath[selectedScopePath.length - 1], v)) { selectedScopePath = []; saveScopePath(); }
  buildQuizScopeDropdown();
}
function scopeVisible(cat) { const sb = getScopeSubject(); return !sb || categoryHasSubject(cat, sb); }
function renderScopeSubjectSelect() {
  const sel = document.getElementById('selScopeSubject'); if (!sel) return;
  const subs = usedSubjects();
  let cur = getScopeSubject();
  if (cur && !subs.includes(cur)) { cur = ''; try { localStorage.setItem('susuru_anki_scope_subject', ''); } catch (e) {} }
  sel.style.display = subs.length ? 'block' : 'none';
  sel.innerHTML = `<option value="">🏷️ 教科：すべて</option>` + subs.map(sb => `<option value="${escAttr(sb)}">🏷️ ${escapeHtml(sb)}</option>`).join('');
  sel.value = cur;
}

function buildQuizScopeDropdown() {
  const container = document.getElementById('scopeSelectors'); if(!container) return;
  loadScopePath();
  renderScopeSubjectSelect();
  // ★【0.03.02】保存されたパスを「全階層」復元する（以前は最上位しか復元されず、クイズ後にトップだけの表示に戻っていた）
  let path = [];
  if (selectedScopePath[0] === 'all') path = ['all'];
  else {
    for (let d = 0; d < selectedScopePath.length; d++) {
      const v = selectedScopePath[d];
      const ok = (d === 0 ? getTopLevelCategories().includes(v) : (categoryTree[path[d - 1]] || []).includes(v)) && scopeVisible(v);
      if (!ok) break;
      path.push(v);
    }
  }
  selectedScopePath = path;
  container.innerHTML = ''; createScopeSelect(0, getTopLevelCategories().filter(scopeVisible));
  if (path[0] === 'all') { const s0 = container.querySelector('select'); if (s0) s0.value = 'all'; return; }
  path.forEach((val, depth) => {
    const sel = container.querySelectorAll('select')[depth];
    if (!sel) return;
    sel.value = val;
    const children = getChildCategories(val).filter(scopeVisible);
    if (children.length > 0) createScopeSelect(depth + 1, children);
  });
}
function createScopeSelect(depth, categoriesToShow) {
  if (categoriesToShow.length === 0) return;
  const select = document.createElement('select'); select.className = 'form-control';
  if (depth === 0) { const optAll = document.createElement('option'); optAll.value = "all"; optAll.innerText = "🌐 全てから出題"; select.appendChild(optAll); }
  const optDefault = document.createElement('option'); optDefault.value = ""; optDefault.innerText = depth === 0 ? "📁 トップカテゴリー..." : "📂 サブカテゴリー..."; optDefault.disabled = true; optDefault.selected = true; select.appendChild(optDefault);
  categoriesToShow.forEach(cat => { const opt = document.createElement('option'); opt.value = cat; opt.innerText = depth === 0 ? `📁 ${cat}` : `📂 ${cat}`; select.appendChild(opt); });
  select.onchange = (e) => {
    const val = e.target.value; const container = document.getElementById('scopeSelectors');
    const selects = Array.from(container.querySelectorAll('select')); selects.forEach((sel, idx) => { if (idx > depth) sel.remove(); });
    if (val === "all") { selectedScopePath = ["all"]; saveScopePath(); return; }
    selectedScopePath[depth] = val; selectedScopePath = selectedScopePath.slice(0, depth + 1); saveScopePath();
    const children = getChildCategories(val).filter(scopeVisible); if (children.length > 0) createScopeSelect(depth + 1, children);
  };
  document.getElementById('scopeSelectors').appendChild(select);
}

// ★【0.02.63】このラウンドの構造化解答（品詞タグ付き複数解答）。null なら通常の単一解答。
let currentStructuredAnswer = null;
// ★【0.03.00】このラウンドで実際に使う出題モード（構造式・漢文が答えの問題は自己申告に切り替わることがある）
let currentRoundMode = 'desc';

// ★【0.03.00】クイズを途中でやめてホームに戻る（それまでの解答結果は保存済み）
function quitQuiz() {
  if (window.currentOnlineMatch) {
    if (!confirm('⚔️ 対戦中です。中断してホームに戻りますか？')) return;
  } else if (quizPhase === 'q' && quizIndex > 0 && !confirm('クイズを中断してホームに戻りますか？\n（ここまでの成績は保存されています）')) {
    return;
  }
  stopQuizTimer(); clearTimeout(autoNextTimeout);
  lastQuizScopePath = [...selectedScopePath];
  openPage('pgHome');
}

// ================================================================
// ★【0.03.03】問題番号順の出題・詳細設定の保存
// ================================================================
let currentQuizOrderScope = null;
// フォルダーの並び（番号順のツリー）→ カードの番号 の順に並べる
function sortCardsByNumber(arr) {
  const catIdx = getCategoryOrderIndex();
  return arr.sort((a, b) =>
    ((catIdx[a.category] ?? 1e9) - (catIdx[b.category] ?? 1e9)) ||
    ((a.no ?? 1e9) - (b.no ?? 1e9)) ||
    naturalCompare(a.question, b.question));
}
function quizOrderKey(scope) { return 'susuru_anki_order_pos_' + (scope || 'all'); }
function loadQuizOrderPosition(scope) { try { return localStorage.getItem(quizOrderKey(scope)); } catch (e) { return null; } }
// 番号順（続きから）で解いた最後のカードを覚えておく
function recordQuizOrderProgress(cur) {
  if (!currentQuizOrderScope || !cur || window.currentOnlineMatch) return;
  try { localStorage.setItem(quizOrderKey(currentQuizOrderScope), cur._sourceId || cur.id); } catch (e) {}
}

const QUIZ_PREF_KEY = 'susuru_anki_quiz_prefs';
const QUIZ_PREF_IDS = ['selQuizMode', 'selQuizSpeed', 'selHintMode', 'selQuizOrder', 'numQCount', 'numTimeLimit', 'numAutoNext', 'numGradThreshold', 'chkTTS', 'chkTimeAttack', 'chkIncludeGrad', 'chkSwapQA'];
function saveQuizPrefs() {
  const o = {};
  QUIZ_PREF_IDS.forEach(id => { const el = document.getElementById(id); if (el) o[id] = el.type === 'checkbox' ? el.checked : el.value; });
  try { localStorage.setItem(QUIZ_PREF_KEY, JSON.stringify(o)); } catch (e) {}
  // 卒業認定正解数は採点にも使うので別に保存する
  const g = parseInt((document.getElementById('numGradThreshold') || {}).value, 10);
  try { if (Number.isFinite(g) && g >= 1 && g <= 30) localStorage.setItem('susuru_anki_grad_threshold', String(g)); } catch (e) {}
  if (typeof updateHomeSummary === 'function') updateHomeSummary();
}
function loadQuizPrefs() {
  let o = {};
  try { o = JSON.parse(localStorage.getItem(QUIZ_PREF_KEY) || '{}') || {}; } catch (e) {}
  QUIZ_PREF_IDS.forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    if (o[id] !== undefined) { if (el.type === 'checkbox') el.checked = !!o[id]; else el.value = o[id]; }
    if (!el.dataset.prefBound) { el.addEventListener('change', saveQuizPrefs); el.dataset.prefBound = '1'; }
  });
  const g = document.getElementById('numGradThreshold'); if (g && !g.value) g.value = getGradThreshold();
}
// 数値の設定を読む（空欄なら null）
function getQuizPrefNumber(id) {
  const el = document.getElementById(id);
  if (!el || String(el.value).trim() === '') return null;
  const v = Number(el.value);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

// ★【0.03.02】問題と解答の入れ替え。例文・テスト（選択肢つき）のカードは入れ替えない
function swapQuizEntry(q) {
  if (q.kind || (Array.isArray(q.choices) && q.choices.length)) return q;
  return { ...q, question: q.answer, answer: q.question, questionImage: q.answerImage, answerImage: q.questionImage, _swapped: true };
}

const ANSWER_SYMBOL_RE = /[\[\]［］【】～〜~…]|\.\.\./g;
// ［ ］で囲んだ部分（言い換え）を省いた形
function dropBracketParts(str) { return String(str || '').replace(/[\[［][^\]］]*[\]］]/g, ' '); }
function normalizeAnswer(str) {
  if(!str) return '';
  let s = foldKana(String(str).replace(/[Ａ-Ｚａ-ｚ０-９]/g, c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).toLowerCase().trim());
  s = s.replace(/擦/g, 'こす');
  // ★【0.03.06】［ ］・～・… などの記号は入力しなくてよい（中身だけ合っていれば正解）
  s = s.replace(ANSWER_SYMBOL_RE, ' ');
  s = s.replace(/[、，＼＼ \u3000]+/g, ',');
  return s.split(',').map(x=>x.trim()).filter(x=>x!=='').sort().join(',');
}
function isAnswerCorrect(input, correctAnswer) {
  // ★【0.03.00】構造式(SMILESの「/」)や漢文ブロックを区切り文字として誤分割しないようにマスクしてから分割する
  // ［ ］の中身まで書いた答え・［ ］の部分を省いた答えのどちらでも正解
  const norms = splitAnswerAlternatives(correctAnswer).flatMap(a => [normalizeAnswer(a), normalizeAnswer(dropBracketParts(a))]).filter(x => x !== '');
  const inNorm = normalizeAnswer(input);
  return norms.includes(inNorm);
}

// ★【0.02.65】4択・みんはや・文字タップは「1つの答えを選ぶ/組み立てる」形式のため、
// 品詞タグ付き構造化解答(例: adapt の他動詞/自動詞)を持つカードは、
// タグ(意味)ごとに独立した単発の問題として連続で出題する。
// 生成される仮想エントリーは quizPool 内のみに存在し、db には反映されない。
function expandStructuredForChoiceModes(cards) {
  const result = [];
  cards.forEach(card => {
    const structured = parseStructuredAnswer(card.answer);
    if (structured) {
      structured.forEach(seg => {
        result.push({ ...card, answer: seg.text, _sourceId: card.id, _senseLabel: seg.label });
      });
    } else {
      result.push(card);
    }
  });
  return result;
}

async function startQuiz(modeType = 'normal') {
  currentCombo = 0; todayCorrectCount = 0;
  if (selectedScopePath.length === 0 && lastQuizScopePath.length > 0) selectedScopePath = [...lastQuizScopePath];
  let scope = "all";
  if (selectedScopePath.length > 0 && selectedScopePath[0] !== "all") scope = "cat:" + selectedScopePath[selectedScopePath.length - 1];
  
  const includeGrad = document.getElementById('chkIncludeGrad').checked;
  const limitCount = parseInt(document.getElementById('numQCount').value) || 10;

  let subset = [...db];
  if (modeType === 'tokkun') subset = subset.filter(q => q.level <= 0 || q.level === -1);
  else if (modeType === 'review') subset = subset.filter(q => isGraduated(q));
  else if (!includeGrad) subset = subset.filter(q => !(isGraduated(q)));

  if(scope.startsWith('cat:')) {
    const cName = scope.replace('cat:', '');
    const targets = getAllSubcategories(cName);
    subset = subset.filter(q => targets.includes(q.category));
  }
  // ★【0.03.07】教科で絞り込み中なら、その教科のフォルダーの問題だけ
  const scopeSubject = getScopeSubject();
  if (scopeSubject) { subset = subset.filter(q => getCategorySubject(q.category) === scopeSubject); scope = scope + '|' + scopeSubject; }

  // ★ オンライン対戦時はホスト（player1）が問題を生成して相手に共有する
  if (window.currentOnlineMatch) {
      if (window.currentOnlineMatch.myRole === 'player1') {
          if(subset.length === 0) { alert("⚠️ 問題が見つかりません。"); return; }
          for (let i = subset.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [subset[i], subset[j]] = [subset[j], subset[i]]; }
          quizPool = subset.slice(0, limitCount);
          if (document.getElementById('chkSwapQA').checked) quizPool = quizPool.map(swapQuizEntry);
          // ★【0.02.65】選択式モードは品詞タグごとに独立した問題として連続出題する
          if (['choice', 'minhaya', 'tap'].includes(document.getElementById('selQuizMode').value)) {
            quizPool = expandStructuredForChoiceModes(quizPool);
          }
          // ★【0.02.63】オンライン対戦は画像を含めずに同期する（Firestoreの1ドキュメント容量上限を超えて対戦が壊れるのを防ぐため）
          quizPool = quizPool.map(q => { const { questionImage, answerImage, ...rest } = q; return rest; });
          
          await firestore.collection('susuru_anki_match_rooms').doc(window.currentOnlineMatch.roomId).update({
              quizPool: quizPool
          });
          quizIndex = 0;
          openPage('pgQuizPlayer');
          loadQuizQuestion();
      } else {
          // ゲスト（player2）は問題が降ってくるまで待機する
          openPage('pgQuizPlayer');
          document.getElementById('lblQuizQuestion').innerText = "ホストが問題を作成・同期中...";
          document.getElementById('lblQuizProgress').innerText = "WAIT";
          quizPool = [];
          ['boxChoiceArea','boxDescArea','boxMinhayaArea','boxSelfArea', 'boxTapArea', 'btnQuizAction', 'btnQuizPass'].forEach(id => {
              const el = document.getElementById(id); if(el) el.style.display='none';
          });
      }
      return;
  }

  // 以下通常のソロプレイ処理
  if(subset.length === 0) return alert("⚠️ 条件に合致する問題が見つかりませんでした。");
  const order = modeType === 'review' ? 'srs' : (document.getElementById('selQuizOrder') ? document.getElementById('selQuizOrder').value : 'srs');
  if (order === 'number' || order === 'continue') {
    // ★【0.03.03】問題番号順に出題（フォルダーの番号順→カードの番号順）
    sortCardsByNumber(subset);
    let start = 0;
    if (order === 'continue') {
      const lastId = loadQuizOrderPosition(scope);
      const idx = lastId ? subset.findIndex(q => q.id === lastId) : -1;
      start = idx >= 0 ? (idx + 1) % subset.length : 0;
    }
    quizPool = [...subset.slice(start), ...subset.slice(0, start)].slice(0, limitCount);
    currentQuizOrderScope = scope;
  } else {
    // ★【0.03.03】優先度：しっかり(Lv-1) → 苦手(Lv0で実績あり) → 未着手 → その他（使い方ガイドの説明どおりに）
    const prioritize = (q) => {
      if (q.level === -1) return 1;
      if (q.level === 0 && (q.correct > 0 || q.incorrect > 0)) return 2;
      if (q.correct === 0 && q.incorrect === 0) return 3;
      return 4;
    };
    for (let i = subset.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [subset[i], subset[j]] = [subset[j], subset[i]]; }
    subset.sort((a, b) => prioritize(a) - prioritize(b));
    quizPool = subset.slice(0, limitCount);
    currentQuizOrderScope = null;
  }
  quizIndex = 0;

  if (document.getElementById('chkSwapQA').checked) quizPool = quizPool.map(swapQuizEntry);
  // ★【0.02.65】選択式モードは品詞タグごとに独立した問題として連続出題する
  if (['choice', 'minhaya', 'tap'].includes(document.getElementById('selQuizMode').value)) {
    quizPool = expandStructuredForChoiceModes(quizPool);
  }
  openPage('pgQuizPlayer'); loadQuizQuestion();
}

function loadQuizQuestion() {
  quizPhase='q'; selectedChoiceIdx=null; window.currentSelfJudge=null;
  const cur = quizPool[quizIndex];

  // ★【0.02.63】品詞タグ付き構造化解答の判定（このラウンドで使い回すのでキャッシュしておく）
  // ・cur.answer が構造化解答 → 出題文からは (タグ) を省略して表示し、解答欄はタグごとの入力欄にする
  // ・cur.question 自体が構造化解答の形（逆引きモードでQ/Aが入れ替わった場合など）→ 出題文をラベル付きで整形表示する
  const aStructured = parseStructuredAnswer(cur.answer);
  const qStructuredSelf = parseStructuredAnswer(cur.question);
  currentStructuredAnswer = aStructured;

  document.getElementById('lblQuizProgress').innerText = `Q ${quizIndex+1}/${quizPool.length}`;
  const qEl = document.getElementById('lblQuizQuestion');
    let qDisplay = cur.question, qSpeech = cur.question;
    if (qStructuredSelf) { qDisplay = formatStructuredAnswerHTML(qStructuredSelf); qSpeech = qStructuredSelf.map(s => s.text).join('。'); }
    else if (aStructured) { qDisplay = stripParens(cur.question); qSpeech = qDisplay; }
    // 例文・テスト問題は、問題文（1行目の英文）だけを読み上げる
    if (cur.kind && /\n/.test(cur.question)) qSpeech = cur.question.split('\n')[0];
    // 構造化表示（formatStructuredAnswerHTML）は内部でエスケープ済み。それ以外は文字列をエスケープして表示する
    qEl.innerHTML = qStructuredSelf ? qDisplay : renderRichText(qDisplay, { escape: true, kanbunRows: 12 });
    if (cur._senseLabel) {
      const senseDiv = document.createElement('div');
      senseDiv.style.cssText = 'font-size:0.8rem; color:var(--primary); font-weight:700; margin-top:8px;';
      senseDiv.innerText = `🏷️ ${cur._senseLabel}`;
      qEl.appendChild(senseDiv);
    }
    if (cur.questionImage) {
      const qImg = document.createElement('img');
      qImg.src = cur.questionImage; qImg.alt = '問題画像';
      qImg.style.cssText = 'max-width:100%; height:auto; border-radius:8px; margin-top:12px; display:block;';
      qEl.appendChild(qImg);
    }
    hydrateRich(qEl, { chemScale: 1.6 });
  document.getElementById('quizFeedback').style.display = 'none';
  flushPendingNote(); // 前の問題のメモを保存してから切り替える
  const noteEl = document.getElementById('txtQuickNote');
  noteEl.value = cur.note || ''; autoResizeNote(noteEl);
  currentNoteCardId = cur._sourceId || cur.id;
  const noteHint = document.getElementById('lblNoteTyping'); if (noteHint) noteHint.style.display = 'none';

  if(document.getElementById('chkTTS').checked) {
    speakText(qSpeech);
  }
  // ★【0.03.02】テスト形式で選択肢があるカードは、記述式でも選択肢を問題文の下に表示する
  if (Array.isArray(cur.choices) && cur.choices.length) {
    const chDiv = document.createElement('div');
    chDiv.className = 'quiz-card-choices';
    chDiv.innerText = cur.choices.join(' ／ ');
    qEl.appendChild(chDiv);
  }

  let mode = document.getElementById('selQuizMode').value;
  // ★【0.03.00】答えが構造式・漢文ブロック・数式の場合は文字入力できないので、記述・みんはや・文字タップは自己申告で出題する
  const _primary = getPrimaryAnswer(cur.answer);
  const richAnswer = hasRichBlock(_primary) || /\$[^$]+\$/.test(_primary);
  if (richAnswer && ['desc', 'minhaya', 'tap'].includes(mode)) mode = 'self';
  // ★【0.03.05】「自己申告」形式のカード（答えが列挙などで文字入力に向かない）は、入力モードでは自己申告で出題する
  if (cur.kind === 'self' && ['desc', 'minhaya', 'tap'].includes(mode)) mode = 'self';
  currentRoundMode = mode;
  ['boxChoiceArea','boxDescArea','boxMinhayaArea','boxSelfArea', 'boxTapArea'].forEach(id=>document.getElementById(id).style.display='none');
  document.getElementById('btnQuizAction').style.display='inline-flex'; document.getElementById('btnQuizPass').style.display='inline-flex';
  document.getElementById('btnQuizAction').innerText='確定する';

  if(mode==='choice') { document.getElementById('boxChoiceArea').style.display='grid'; buildFourChoices(cur); }
  else if(mode==='minhaya') { document.getElementById('boxMinhayaArea').style.display='block'; buildMinhayaMode(cur); document.getElementById('btnQuizAction').style.display='none'; }
  else if(mode==='tap') { document.getElementById('boxTapArea').style.display='block'; buildTapChoices(cur); document.getElementById('btnQuizAction').style.display='none'; }
  else if(mode==='self') { document.getElementById('boxSelfArea').style.display='block'; buildSelfMode(cur); document.getElementById('btnQuizAction').style.display='none'; document.getElementById('btnQuizPass').style.display='none'; }
  else { setupDescAnswerArea(aStructured); }

  let base = 15;
  if (window.currentOnlineMatch && window.currentOnlineMatch.timeLimit) {
    base = window.currentOnlineMatch.timeLimit;
    // ★ オンライン対戦でも答えの文字数に応じて時間を延長
    if(cur.answer.length > 5) base += Math.min(15, (cur.answer.length - 5) * 1.5);
  } else {
    const speed = document.getElementById('selQuizSpeed').value;
    const customLimit = getQuizPrefNumber('numTimeLimit'); // ★【0.03.03】制限時間（秒）。空欄＝難易度どおり、0＝無制限
    if (customLimit !== null && customLimit > 0) base = customLimit;
    else {
      if(speed==='easy') base=25; else if(speed==='hard') base=10; else if(speed==='expert') base=5;
      if(cur.answer.length > 5) base += Math.min(15, (cur.answer.length - 5) * 1.5);
    }
    if(document.getElementById('chkTimeAttack').checked) base *= 0.5;
  }
  const unlimitedTime = !window.currentOnlineMatch && getQuizPrefNumber('numTimeLimit') === 0;

  // ★【0.02.65】記述式モードで構造化解答の場合、欄の数だけ制限時間を倍にする（実際のカウントダウンにも反映されるようbaseそのものを変更する）
  if (mode === 'desc' && aStructured) {
    base *= aStructured.length;
  }
  quizTimeLimit = unlimitedTime ? Infinity : base; quizTimeLeft = quizTimeLimit;
  stopQuizTimer(); updateTimerUI();
  
  // ★【0.03.02】解いている間にヒントを少しずつ出す
  //  ①メモ（語源など。答えの部分は伏せ字）→ ②先頭の文字と文字数 → ③半分の文字
  //  「💡ヒント」ボタンで次の段階をすぐに見ることもできる。対戦中はヒントなし
  const hb = document.getElementById('lblQuizHint');
  hb.style.display = 'none'; hb.innerHTML = '';
  const speed = document.getElementById('selQuizSpeed').value;
  // ★【0.03.08】ヒントのオン・オフ（自動＝「すごい」以外はオン）
  const hintsOn = hintsEnabled(speed);
  quizHintState = hintsOn ? buildHintStages(cur, mode, aStructured, richAnswer) : { stages: [], shown: 0 };
  const hintBtn = document.getElementById('btnQuizHint');
  if (hintBtn) hintBtn.style.display = (quizHintState.stages.length && !window.currentOnlineMatch) ? 'inline-flex' : 'none';
  const autoHintAt = speed === 'easy' ? [0.15, 0.35, 0.6] : [0.25, 0.55, 0.8];
  const _timerStart = Date.now();
  const _timerBase = base;
  quizTimer = setInterval(() => {
    if (unlimitedTime) {
      // 無制限：ヒントは「30秒で一巡」の速さで出す
      const el = (Date.now() - _timerStart) / 1000;
      updateTimerUI(el);
      while (quizHintState.shown < quizHintState.stages.length && autoHintAt[quizHintState.shown] !== undefined && el / 30 >= autoHintAt[quizHintState.shown]) showNextHint();
      return;
    }
    quizTimeLeft = Math.max(0, _timerBase - (Date.now() - _timerStart) / 1000);
    updateTimerUI();
    if (quizTimeLeft <= 0) {
      stopQuizTimer();
      evaluateRoundAnswer(false, "⏰ 時間切れ");
      return;
    }
    if (window.currentOnlineMatch) return;
    const elapsed = 1 - quizTimeLeft / quizTimeLimit;
    while (quizHintState.shown < quizHintState.stages.length && autoHintAt[quizHintState.shown] !== undefined && elapsed >= autoHintAt[quizHintState.shown]) {
      showNextHint();
    }
  }, 100);
}

let quizHintState = { stages: [], shown: 0 };
function hintsEnabled(speed) {
  const v = (document.getElementById('selHintMode') || {}).value || 'auto';
  if (v === 'on') return true;
  if (v === 'off') return false;
  return speed !== 'expert';
}
let currentNoteCardId = null;

// 答え（と、その言い換え）をメモから伏せ字にする
function answerTokensForMask(answer) {
  const mk = maskRichBlocks(String(answer || ''));
  return mk.masked.split(/[\/|、,，\u3000]+/).map(t => mk.restore(t))
    .map(t => t.replace(/\([^()]*\)|（[^（）]*）|[［\[][^\]］]*[\]］]/g, ' ').replace(/[～〜~…]/g, ' ').trim())
    .flatMap(t => /[A-Za-z]/.test(t) ? t.split(/\s+/) : [t.replace(/\s+/g, '')])
    .map(t => t.trim())
    .filter(t => t && !/^[A-Ca-c]$/.test(t) && !/^(to|of|in|on|at|for|with|the|a|an|be|do|one's|oneself|that)$/i.test(t) && t.length >= (/[A-Za-z]/.test(t) ? 3 : 2));
}
function maskAnswerInText(text, answer) {
  let out = String(text || '');
  const toks = [...new Set(answerTokensForMask(answer))].sort((a, b) => b.length - a.length);
  toks.forEach(t => {
    if (/[A-Za-z]/.test(t)) {
      const stem = t.length > 5 ? t.slice(0, Math.max(4, t.length - 3)) : t;
      const re = new RegExp('\\b' + stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[A-Za-z]*', 'gi');
      out = out.replace(re, m => m[0] + '＿'.repeat(Math.min(6, m.length - 1)));
    } else {
      out = out.split(t).join('〇'.repeat(Math.min(4, t.length)));
    }
  });
  return out;
}
function buildHintStages(cur, mode, structured, richAnswer) {
  const stages = [];
  const note = String(cur.note || '').trim();
  // メモの和訳（答えが英語なら英単語・語根）を隠してから、さらに答えそのものも伏せ字にする
  // ★【0.03.08】和訳・英単語を隠すのは英語（または教科なし）のフォルダーだけ。化学などでは化学式を隠さない
  const hidden = noteHidingApplies(cur.category) ? hideNoteTranslations(note, isLatinAnswer(getPrimaryAnswer(cur.answer))) : note;
  if (note) stages.push({ memo: true, html: '📝 ' + escapeHtml(maskAnswerInText(hidden, cur.answer)).replace(/\n/g, '<br>') });
  if (richAnswer || mode !== 'desc') return { stages, shown: 0 };
  if (structured) {
    stages.push({ structured: structured.map(seg => seg.text.charAt(0)) });
  } else {
    const ans = getPrimaryAnswer(cur.answer);
    const chars = [...ans];
    stages.push({ html: `🔤 先頭は「 ${escapeHtml(chars[0] || '')} 」 （全 ${chars.length} 文字）` });
    if (chars.length >= 4) {
      const n = Math.ceil(chars.length / 2);
      const shown = chars.map((c, i) => i < n || /[\s　]/.test(c) ? c : '＿').join('');
      stages.push({ html: `🔤 ${escapeHtml(shown)}` });
    }
  }
  return { stages, shown: 0 };
}
function showNextHint() {
  if (quizPhase !== 'q' || window.currentOnlineMatch) return;
  const st = quizHintState;
  if (st.shown >= st.stages.length) return;
  const stage = st.stages[st.shown++];
  if (stage.structured) {
    stage.structured.forEach((c, i) => {
      const el = document.getElementById('structHint_' + i);
      if (el) { el.innerHTML = `先頭:「${escapeHtml(c)}」`; el.style.display = 'inline'; }
    });
  } else {
    const hb = document.getElementById('lblQuizHint');
    // 文字ヒントは最新のものだけ、メモは残す
    hb.querySelectorAll('.hint-letter').forEach(e => e.remove());
    const line = document.createElement('div');
    if (stage.html.startsWith('🔤')) line.className = 'hint-letter';
    line.innerHTML = stage.html;
    hb.appendChild(line);
    hb.style.display = 'block';
  }
  const btn = document.getElementById('btnQuizHint');
  if (btn && st.shown >= st.stages.length) btn.style.display = 'none';
}

function updateTimerUI(elapsedUnlimited) {
  if (!Number.isFinite(quizTimeLimit)) {
    const bar = document.getElementById('barTimerFill'); bar.style.width = '100%'; bar.className = 'timer-bar-fill';
    document.getElementById('lblQuizTimerText').innerText = `∞ ${Math.floor(elapsedUnlimited || 0)}s`;
    return;
  }
  const pct = (quizTimeLeft/quizTimeLimit)*100;
  const bar = document.getElementById('barTimerFill'); bar.style.width=`${pct}%`;
  bar.className = `timer-bar-fill ${pct<30?'warning':''}`;
  document.getElementById('lblQuizTimerText').innerText = `${Math.max(0, quizTimeLeft).toFixed(1)}s`;
}


// ★ タイマーを確実に止めるヘルパー（quizTimer = null まで行う）
function stopQuizTimer() {
  if (quizTimer) { clearInterval(quizTimer); quizTimer = null; }
}

function getPrimaryAnswer(ans) {
  const first = splitAnswerAlternatives(ans)[0].trim();
  // ★【0.02.63】先頭が (タグ) から始まる場合はタグを除いた本文側を代表解答として使う
  // （4択・みんはや・文字タップ・自己申告モードや、ヒント表示等で使われる）
  const m = first.match(/^(?:\([^()]*\)\s*)+([\s\S]*)$/);
  return m && m[1].trim() ? m[1].trim() : first;
}

// ★【0.02.63】記述式入力モードの解答欄を構築する。
// structured が非nullなら「タグごとの入力欄」を、nullなら従来通りの単一入力欄を表示する。
function setupDescAnswerArea(structured) {
  document.getElementById('boxDescArea').style.display = 'block';
  const txt = document.getElementById('txtDescAnswer');
  const structWrap = document.getElementById('boxDescStructuredArea');
  if (structured && structured.length > 0) {
    txt.style.display = 'none';
    txt.value = '';
    structWrap.style.display = 'block';
    structWrap.innerHTML = '';
    structured.forEach((seg, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'margin-bottom:12px; text-align:left;';
      const labelRow = document.createElement('div');
      labelRow.style.cssText = 'display:flex; justify-content:space-between; align-items:baseline; margin-bottom:5px;';
      const label = document.createElement('div');
      label.style.cssText = 'font-size:0.78rem; color:var(--text2); font-weight:700;';
      label.innerText = `🏷️ ${seg.label || ('解答 ' + (i + 1))}`;
      const hintSpan = document.createElement('span');
      hintSpan.id = 'structHint_' + i;
      hintSpan.style.cssText = 'font-size:0.72rem; color:var(--warn); font-weight:700; display:none;';
      labelRow.appendChild(label); labelRow.appendChild(hintSpan);
      const input = document.createElement('input');
      input.type = 'text'; input.className = 'form-control'; input.id = 'structAns_' + i;
      input.autocomplete = 'off'; input.placeholder = '答えを入力...';
      input.onkeydown = (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const next = document.getElementById('structAns_' + (i + 1));
        if (next) next.focus(); else submitQuizAction();
      };
      row.appendChild(labelRow); row.appendChild(input);
      structWrap.appendChild(row);
    });
    const first = document.getElementById('structAns_0');
    if (first) first.focus();
  } else {
    txt.style.display = 'block';
    structWrap.style.display = 'none'; structWrap.innerHTML = '';
    txt.value = ''; txt.disabled = false; txt.focus();
  }
}

// ★【0.03.02】選択肢の候補は「正解と同じ側」から取る
// （問題と解答を入れ替えたときに、正解だけ英語・ほかは日本語、のように一目で分かってしまう不具合の修正）
function choiceSideText(q, swapped) {
  return swapped ? getPrimaryAnswer(stripParens(q.question) || q.question) : getPrimaryAnswer(q.answer);
}
function choiceShape(t) {
  const s = String(t || '');
  return {
    latin: /[A-Za-z]/.test(s) && !JA_CHAR_RE.test(s),
    ph: /(^|[\s(（])[A-C](?=$|[\s)）.,])|[～〜~]|\.\.\./.test(s),
    words: s.trim().split(/\s+/).length,
    rich: hasRichBlock(s) || /\$[^$]+\$/.test(s)
  };
}
// ★【0.03.09】カードが多いと毎問すべてのカードを調べ直すのが重いので、カードごとの計算結果を覚えておく
const _choiceInfoCache = new Map();
function choiceInfoOf(q, swapped) {
  const src = swapped ? q.question : q.answer;
  const key = (swapped ? 's|' : 'a|') + q.id;
  let c = _choiceInfoCache.get(key);
  if (!c || c.src !== src) {
    const t = choiceSideText(q, swapped);
    c = { src, t, n: t ? normalizeAnswer(t) : '', sh: t ? choiceShape(t) : null };
    _choiceInfoCache.set(key, c);
  }
  return c;
}
function buildChoiceCandidates(cur, correctPrimary) {
  const swapped = !!cur._swapped;
  const want = choiceShape(correctPrimary);
  const normCorrect = normalizeAnswer(correctPrimary);
  const seen = new Set([normCorrect]);
  const pool = [];
  db.forEach(q => {
    if (q.id === cur.id || q.id === cur._sourceId) return;
    if (Array.isArray(q.choices) && q.choices.length) return; // テスト問題の Yes/No 等は混ぜない
    const info = choiceInfoOf(q, swapped);
    const t = info.t;
    if (!t) return;
    const n = info.n;
    if (seen.has(n)) return; seen.add(n);
    const sh = info.sh;
    let score = 0;
    if (sh.latin === want.latin) score += 8;           // 英語なら英語、日本語なら日本語
    if (sh.rich === want.rich) score += 6;             // 構造式つきの答えには構造式つきの選択肢
    if (sh.ph === want.ph) score += 3;                 // 「A」「～」入りの熟語なら熟語どうし
    if (Math.abs(sh.words - want.words) <= 1) score += 2;
    if (q.category === cur.category) score += 2;
    if (q.kind === cur.kind) score += 1;
    pool.push({ t, score: score + Math.random() * 1.5 });
  });
  pool.sort((a, b) => b.score - a.score);
  return pool.map(p => p.t);
}

function buildFourChoices(cur) {
  const area = document.getElementById('boxChoiceArea'); area.innerHTML = '';
  const correctPrimary = getPrimaryAnswer(cur.answer);
  let options;
  if (Array.isArray(cur.choices) && cur.choices.length >= 2) {
    // ★【0.03.02】カードに選択肢が決まっている（テスト問題など）場合はそれを使う
    options = [...cur.choices];
    if (!options.some(o => normalizeAnswer(o) === normalizeAnswer(correctPrimary))) options.push(correctPrimary);
  } else {
    options = [correctPrimary, ...buildChoiceCandidates(cur, correctPrimary).slice(0, 3)];
    while (options.length < 4) options.push(`選択肢_${Math.floor(Math.random()*1000)}`);
  }
  options.sort(() => Math.random() - 0.5);

  options.forEach((text, i) => {
    const btn = document.createElement('button'); btn.className = 'choice-btn';
    btn.innerHTML = `<div class="choice-idx">${i+1}</div><div style="flex:1;">${renderRichText(text, { escape: true, kanbunRows: 8 })}</div>`;
    hydrateRich(btn, { chemScale: 1.1 });
    btn.onclick = () => {
      if(quizPhase !== 'q') return;
      document.querySelectorAll('.choice-btn').forEach(b => b.style.borderColor = 'var(--border)');
      btn.style.borderColor = 'var(--primary)'; selectedChoiceIdx = text;
    };
    area.appendChild(btn);
  });
}

// みんはや・文字タップのダミー文字も、正解と同じ側（入れ替え時は問題側）の文字から取る
function sideCharsPool(cur) {
  const swapped = !!cur._swapped;
  return db.map(q => choiceSideText(q, swapped).replace(RICH_BLOCK_RE, ''));
}

let minhayaTarget = ""; let minhayaPos = 0;
// ★【0.03.03】みんはや：スペース・読点・スラッシュ・カッコなどの区切り文字は自動で埋めて飛ばす
const MINHAYA_SKIP_RE = /[\s\u3000、，,・／/()（）～〜~\[\]［］【】…]/;
function skipMinhayaSeparators() { while (minhayaPos < minhayaTarget.length && MINHAYA_SKIP_RE.test(minhayaTarget[minhayaPos])) minhayaPos++; }
function buildMinhayaMode(cur) {
  minhayaTarget = getPrimaryAnswer(cur.answer); minhayaPos = 0; skipMinhayaSeparators(); renderMinhayaDisplay(cur);
}
function renderMinhayaDisplay(cur) {
  const area = document.getElementById('boxMinhayaArea'); area.innerHTML = '';
  let hintType = '';
  if(/^[ぁ-ん]+$/.test(minhayaTarget)) hintType = `【${minhayaTarget.length}文字】(ひらがなのみ)`;
  else if(/^[ァ-ヶ]+$/.test(minhayaTarget)) hintType = `【${minhayaTarget.length}文字】(カタカナのみ)`;
  else if(/^[a-zA-Z]+$/.test(minhayaTarget)) hintType = `【${minhayaTarget.length}文字】(アルファベット)`;
  else hintType = `【${minhayaTarget.length}文字】(漢字など含む)`;
  
  const hintDiv = document.createElement('div');
  hintDiv.style.cssText = 'text-align:center; font-size:0.75rem; color:var(--warn); margin-bottom:10px; font-weight:bold;';
  hintDiv.innerText = `💡 ヒント: ${hintType}`;
  area.appendChild(hintDiv);

  const slotsDiv = document.createElement('div');
  slotsDiv.style.cssText = 'display:flex; flex-wrap:wrap; justify-content:center; gap:6px; margin-bottom:18px;';
  for (let i = 0; i < minhayaTarget.length; i++) {
    const slot = document.createElement('div'); const filled = i < minhayaPos; const current = i === minhayaPos;
    slot.style.cssText = `min-width:42px; height:46px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:1.3rem; font-weight:bold; padding:0 6px; border:2px solid ${filled ? 'var(--success)' : current ? 'var(--primary)' : 'var(--border)'}; background:${filled ? 'rgba(34,199,122,0.12)' : current ? 'rgba(79,124,255,0.1)' : 'var(--bg3)'}; color:${filled ? 'var(--success)' : current ? 'var(--primary)' : 'var(--text3)'};`;
    slot.innerText = (filled || MINHAYA_SKIP_RE.test(minhayaTarget[i])) ? minhayaTarget[i] : (current ? '?' : '＿');
    slotsDiv.appendChild(slot);
  }
  area.appendChild(slotsDiv);
  if (minhayaPos >= minhayaTarget.length) return;

  // ★ みんはや重複防止の完全版
  const correctChar = minhayaTarget[minhayaPos];
  let distChars = [];
  const targetChars = minhayaTarget.split('');
  
  // ★【0.03.00】構造式・漢文などの埋め込みブロックの記号を選択肢の文字に混ぜない
  sideCharsPool(cur).forEach(t => t.split('').forEach(c => { 
    if (!/[\s,、，。・/|]/.test(c) && !targetChars.includes(c)) distChars.push(c); 
  }));
  distChars = [...new Set(distChars)].sort(() => Math.random() - 0.5);
  
  let choices = [correctChar];
  for (let c of distChars) {
      if (choices.length < 4 && !choices.includes(c)) choices.push(c);
  }
  const fallbacks = 'あいうえおかきくけこさしすせそ'.split('').sort(() => Math.random() - 0.5);
  for (let c of fallbacks) {
      if (choices.length < 4 && !targetChars.includes(c) && !choices.includes(c)) choices.push(c);
  }
  choices.sort(() => Math.random() - 0.5);

  const choicesDiv = document.createElement('div'); choicesDiv.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:10px;';
  choices.forEach(c => {
    const btn = document.createElement('button'); btn.className = 'choice-btn'; btn.style.cssText = 'justify-content:center; font-size:1.6rem; font-weight:bold; height:60px;'; btn.innerText = c;
    btn.onclick = () => {
      if (quizPhase !== 'q') return;
      if (c === correctChar) {
        minhayaPos++; skipMinhayaSeparators();
        if (minhayaPos >= minhayaTarget.length) { stopQuizTimer(); evaluateRoundAnswer(true, "🎉 正解！"); } else renderMinhayaDisplay(cur);
      } else {
        stopQuizTimer(); btn.style.background = 'rgba(255,79,106,0.3)'; btn.style.borderColor = 'var(--danger)';
        setTimeout(() => evaluateRoundAnswer(false, "❌ 不正解"), 300);
      }
    };
    choicesDiv.appendChild(btn);
  });
  area.appendChild(choicesDiv);
}

let currentTapTarget = ""; let currentTapInput = [];
function buildTapChoices(cur) {
  currentTapTarget = getPrimaryAnswer(cur.answer); currentTapInput = [];
  const inArea = document.getElementById('tapInputArea'); const chArea = document.getElementById('tapChoiceArea');
  inArea.innerHTML = ''; chArea.innerHTML = '';
  
  let chars = currentTapTarget.split('');
  const latinTarget = /[A-Za-z]/.test(currentTapTarget) && !JA_CHAR_RE.test(currentTapTarget);
  let allChars = sideCharsPool(cur).join('').replace(latinTarget ? /[^A-Za-z]/g : /[、，／/ \u3000,\da-zA-Z|]/g, '').split('');
  if(allChars.length===0) allChars=(latinTarget ? 'abcdefghijklmnopqrstuvwxyz' : 'あいうえおかきくけこ').split('');
  for(let i=0;i<2;i++) chars.push(allChars[Math.floor(Math.random()*allChars.length)]);
  chars.sort(() => Math.random() - 0.5);
  
  chars.forEach((c, idx) => {
    const btn = document.createElement('button'); btn.className = 'btn btn-secondary'; btn.style.cssText = 'width:48px; height:48px; padding:0; font-size:1.3rem;'; btn.innerText = c; btn.id = 'tap_btn_' + idx;
    btn.onclick = () => {
      if (quizPhase !== 'q') return;
      currentTapInput.push({ char: c, id: btn.id }); btn.style.display = 'none'; renderTapInput();
      if (currentTapInput.length === currentTapTarget.length) {
        stopQuizTimer();
        const inputStr = currentTapInput.map(x => x.char).join('');
        evaluateRoundAnswer(inputStr === currentTapTarget, inputStr === currentTapTarget ? "🎉 正解！" : "❌ 不正解");
      }
    };
    chArea.appendChild(btn);
  });
}
function renderTapInput() {
  const inArea = document.getElementById('tapInputArea'); inArea.innerHTML = '';
  if (currentTapInput.length === 0) { inArea.innerHTML = '<span style="color:var(--text3); font-size:0.85rem;">順番にタップしてください</span>'; return; }
  currentTapInput.forEach((item, index) => {
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--primary); color:#fff; width:36px; height:36px; border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:1.2rem; font-weight:bold; cursor:pointer;';
    box.innerText = item.char;
    box.onclick = (e) => {
      e.stopPropagation(); if (quizPhase !== 'q') return;
      const removed = currentTapInput.splice(index, 1)[0]; document.getElementById(removed.id).style.display = 'inline-flex'; renderTapInput();
    };
    inArea.appendChild(box);
  });
}

function buildSelfMode(cur) { document.getElementById('btnShowAnswer').style.display = 'inline-flex'; document.getElementById('selfJudgeArea').style.display = 'none'; }
function showSelfAnswer() {
  stopQuizTimer(); document.getElementById('btnShowAnswer').style.display = 'none';
  const saEl = document.getElementById('selfAnswerDisplay');
    const _cur = quizPool[quizIndex];
    if (currentStructuredAnswer) { saEl.innerHTML = `<div style="margin-bottom:4px;">A:</div>` + formatStructuredAnswerHTML(currentStructuredAnswer); }
    else { saEl.innerHTML = `A: ${renderRichText(getPrimaryAnswer(_cur.answer), { escape: true })}`; }
    if (_cur.answerImage) {
      const aImg = document.createElement('img');
      aImg.src = _cur.answerImage; aImg.alt = '解答画像';
      aImg.style.cssText = 'max-width:100%; height:auto; border-radius:8px; margin-top:10px; display:block;';
      saEl.appendChild(aImg);
    }
    hydrateRich(saEl, { chemScale: 1.4 });
    speakText(getPrimaryAnswer(_cur.answer));
  document.getElementById('selfJudgeArea').style.display = 'block';
}
function submitSelfMode(judge) {
  window.currentSelfJudge = judge;
  evaluateRoundAnswer(judge !== 'miss', judge === 'perfect' ? "🎉 完璧！" : judge === 'good' ? "👍 普通" : "❌ ミス");
}

function passQuizQuestion() {
  stopQuizTimer();
  // ★【0.03.06】パスは不正解として記録する
  evaluateRoundAnswer(false, "🏳️ パスしました（不正解として記録）");
}

function submitQuizAction() {
  if (quizPhase === 'a') {
    clearTimeout(autoNextTimeout); 
    quizIndex++;
    if(quizIndex < quizPool.length) {
      loadQuizQuestion();
    } else {
      lastQuizScopePath = [...selectedScopePath];
      // ★ 対戦時は相手の終了を待つ処理
      if (window.currentOnlineMatch) {
          document.getElementById('lblQuizQuestion').innerText = "対戦相手が終了するのを待っています...";
          document.getElementById('lblQuizProgress').innerText = "FIN";
          ['boxChoiceArea','boxDescArea','boxMinhayaArea','boxSelfArea', 'boxTapArea', 'btnQuizAction', 'btnQuizPass'].forEach(id => {
              const el = document.getElementById(id); if(el) el.style.display='none';
          });
          document.getElementById('quizFeedback').style.display = 'none';

          // 全問解き終わったことを相手に通知
          firestore.collection('susuru_anki_match_rooms').doc(window.currentOnlineMatch.roomId).update({
              [window.currentOnlineMatch.myRole + '.finished']: true
          }).catch(()=>{});
      } else {
          alert("🏁 クイズ終了！実績を確認しましょう。");
          openPage('pgStats');
      }
    }
    return;
  }
  
  stopQuizTimer();
  const cur = quizPool[quizIndex]; let isCorrect = false;
  const mode = currentRoundMode;
  if (mode === 'choice') { if(!selectedChoiceIdx) return; isCorrect = isAnswerCorrect(selectedChoiceIdx, cur.answer); } 
  else if (currentStructuredAnswer) { isCorrect = gradeStructuredAnswer(currentStructuredAnswer); }
  else { isCorrect = isAnswerCorrect(document.getElementById('txtDescAnswer').value, cur.answer); }
  evaluateRoundAnswer(isCorrect, isCorrect ? "🎉 正解！" : "❌ 不正解");
}

// ★【0.02.63】タグごとの入力欄を採点する。全欄正解の場合のみ true。
// 各欄は結果に応じて枠線の色を変え、以後編集できないようロックする。
function gradeStructuredAnswer(structured) {
  let allCorrect = true;
  structured.forEach((seg, i) => {
    const input = document.getElementById('structAns_' + i);
    if (!input) { allCorrect = false; return; }
    const ok = isStructuredSegmentCorrect(input.value, seg.text);
    if (!ok) allCorrect = false;
    input.disabled = true;
    input.style.borderColor = ok ? 'var(--success)' : 'var(--danger)';
    input.style.background = ok ? 'rgba(34,199,122,0.1)' : 'rgba(255,79,106,0.1)';
  });
  return allCorrect;
}

function evaluateRoundAnswer(isCorrect, head, opts = {}) {
  if (quizPhase === 'a') return; // 二重呼び出し防止
  quizPhase = 'a'; const cur = quizPool[quizIndex];
  const isPass = !!opts.pass; // ★【0.03.03】パスは不正解として記録しない（答えを見るだけ）
  if (!isPass) recordQuizOrderProgress(cur);
  
  if (isPass) {
    // 成績・コンボ・連続記録はそのまま
  } else if(isCorrect) {
    currentCombo++; todayCorrectCount++; showComboAnim(); recordDailyLog(true);
    // ★ オンライン対戦なら自分のスコアをFirebaseに送信（即時反映）
    if (window.currentOnlineMatch) {
      firestore.collection('susuru_anki_match_rooms').doc(window.currentOnlineMatch.roomId)
        .update({ [window.currentOnlineMatch.myRole + '.score']: firebase.firestore.FieldValue.increment(1) })
        .catch(e => console.warn("スコア送信エラー:", e));
    }
  } else {
    currentCombo = 0; recordDailyLog(false);
  }

  // ローカル学習記録の更新 (自分が持っている問題の場合のみ)
  let m = isPass ? null : db.find(q => q.id === cur.id);
  let levelChange = null; // ★【0.03.08】LEVEL UP!/level down… の表示用
  if(m) {
    if(m.wrongStreak === undefined) m.wrongStreak = 0; if(m.shikkariStreak === undefined) m.shikkariStreak = 0;
    const mode = currentRoundMode;
    const multiplier = (mode === 'choice' || mode === 'tap' || mode === 'minhaya') ? 2 : 1; 
    // ★【0.03.03】設定の「卒業認定正解数」に比例して、レベルの上がり下がりの回数も変わる
    const P = srsParams();
    // ★【0.03.08】難易度とヒントで1回の重みを変える（対戦中は難易度どおり・ヒントなし）
    const W = srsSpeedWeights(window.currentOnlineMatch ? 'normal' : document.getElementById('selQuizSpeed').value);
    const hs = quizHintState || { stages: [], shown: 0 };
    const memoShown = hs.shown > 0 && hs.stages[0] && hs.stages[0].memo;
    const letterStages = Math.max(0, hs.shown - (hs.stages[0] && hs.stages[0].memo ? 1 : 0));
    const gain = W.up * srsHintFactor(memoShown, letterStages);
    const loss = W.down;

    if(m.level5Correct === undefined) m.level5Correct = 0;
    const isGrad = isGraduated(m);
    const beforeLevel = m.level;

    if(isCorrect) {
      m.correct++; recordCategoryScore(m.category, true);
      if (mode === 'self' && window.currentSelfJudge === 'good') m.wrongStreak = 0;
      else { m.streak = roundStat((m.streak || 0) + gain); m.wrongStreak = 0; }
      
      if (m.level === -1) {
        m.shikkariStreak = roundStat(m.shikkariStreak + gain);
        if (m.shikkariStreak >= P.recoverAt * multiplier) { m.level = 0; m.shikkariStreak = 0; m.streak = 0; }
      } else if (isGrad) {
        // 卒業済み：何もしない
      } else if (m.level >= 5) {
        // レベル5で未卒業：正解を積む
        m.level5Correct = roundStat(m.level5Correct + gain);
        if (isGraduated(m)) levelChange = { type: 'grad' };
      } else {
        if (m.streak >= P.upStreak * multiplier - 1e-9 && m.level < 5) {
          m.level++;
          if (m.level === 5) m.level5Correct = 0;
          m.streak = 0;
        }
      }
    } else {
      m.incorrect++; m.streak = 0; m.shikkariStreak = 0;
      const prevWrong = m.wrongStreak || 0;
      m.wrongStreak = roundStat(prevWrong + loss);
      recordCategoryScore(m.category, false);
      const crossed = (every) => Math.floor(m.wrongStreak / every + 1e-9) > Math.floor(prevWrong / every + 1e-9);

      if (isGrad) {
        // 卒業済みで不正解：続けて間違えると卒業取り消し（レベル5に留まる）
        if (m.wrongStreak >= P.ungradAt * multiplier - 1e-9) { m.level5Correct = 0; m.wrongStreak = 0; levelChange = { type: 'ungrad' }; }
      } else if (m.level >= 5) {
        // レベル5・未卒業で不正解：続けて間違えるとレベル4に下がる
        if (m.wrongStreak >= P.level5Down * multiplier - 1e-9) { m.level = 4; m.level5Correct = 0; m.wrongStreak = 0; }
      } else {
        if (m.level !== -1) {
          if (m.wrongStreak >= P.shikkariAt * multiplier - 1e-9) { m.level = -1; m.wrongStreak = 0; m.correct = 0; } 
          else if (crossed(P.downEvery * multiplier) && m.level > 0) m.level--;
        }
      }
    }
    if (!levelChange && m.level !== beforeLevel) levelChange = { type: m.level > beforeLevel ? 'up' : 'down', level: m.level };
    touchStats(m);
    saveData();
  }
  if (levelChange) showLevelAnim(levelChange);
  const _hintBtn = document.getElementById('btnQuizHint'); if (_hintBtn) _hintBtn.style.display = 'none';
  
  const fb = document.getElementById('quizFeedback');
  document.getElementById('feedbackResultText').innerText = head;
  const fbAnsEl = document.getElementById('feedbackAnswerText');
  if (currentStructuredAnswer) {
    fbAnsEl.innerHTML = `<div style="font-weight:700; margin-bottom:6px;">正解:</div>` + formatStructuredAnswerHTML(currentStructuredAnswer);
  } else {
    const senseLabelPrefix = cur._senseLabel ? `<span style="color:var(--primary); font-weight:700;">[${escapeHtml(cur._senseLabel)}]</span> ` : '';
    fbAnsEl.innerHTML = `正解: ${senseLabelPrefix}${renderRichText(getPrimaryAnswer(cur.answer), { escape: true })}`;
  }
  if (cur.answerImage) {
    const aImg = document.createElement('img');
    aImg.src = cur.answerImage; aImg.alt = '解答画像';
    aImg.style.cssText = 'max-width:100%; height:auto; border-radius:8px; margin-top:10px; display:block;';
    fbAnsEl.appendChild(aImg);
  }
  hydrateRich(fbAnsEl, { chemScale: 1.3 });
  speakText(getPrimaryAnswer(cur.answer));
  fb.className = `feedback-area ${isCorrect ? 'correct' : isPass ? 'pass' : 'incorrect'}`; fb.style.display = 'flex';
  
  document.getElementById('btnQuizPass').style.display = 'none';
  document.getElementById('btnQuizAction').style.display = 'inline-flex';
  document.getElementById('btnQuizAction').innerText = '次の問題へ';

  // ★ 答えを表示後、3秒経過で自動的に次の問題へ進む (全モード対応)
  // iOS Safari対応: Date.now()ベースで3秒を計測
  const mode = document.getElementById('selQuizMode').value;
  if (['choice', 'tap', 'self', 'minhaya', 'desc'].includes(mode)) {
    clearTimeout(autoNextTimeout);
    // ★【0.02.63】構造化解答は読む量が多いので、センス数に応じて自動送りまでの時間を延長する
    // ★【0.03.03】自動進行（秒）。0＝自動で進まない
    const autoSec = getQuizPrefNumber('numAutoNext');
    const baseDelay = autoSec === null ? 3000 : autoSec * 1000;
    const advanceDelay = currentStructuredAnswer ? Math.min(baseDelay + 12000, baseDelay + currentStructuredAnswer.length * 2000) : baseDelay;
    // ★【0.03.02】クイックメモを入力中は自動で次へ進まない（入力が終わるまで待つ）
    const scheduleAdvance = (delay) => {
      autoNextTimeout = setTimeout(() => {
        if (quizPhase !== 'a') return;
        const ae = document.activeElement;
        if (ae && ae.id === 'txtQuickNote') { scheduleAdvance(1500); return; }
        submitQuizAction();
      }, delay);
    };
    if (baseDelay > 0 || window.currentOnlineMatch) scheduleAdvance(Math.max(advanceDelay, window.currentOnlineMatch ? 3000 : 0));
  }
}

// ★【0.03.08】レベルが変わったら COMBO とは別に表示する
function showLevelAnim(ch) {
  const el = document.getElementById('levelDisplay'); if (!el) return;
  const lv = ch.level === -1 ? 'しっかり' : 'Lv.' + ch.level;
  const map = {
    up: ['LEVEL UP! (' + lv + ')', 'up'], down: ['level down… (' + lv + ')', 'down'],
    grad: ['🎓 GRADUATED!', 'up'], ungrad: ['卒業取り消し… (Lv.5)', 'down']
  };
  const [txt, cls] = map[ch.type] || map.up;
  el.innerText = txt; el.className = 'level-display ' + cls;
  void el.offsetWidth; el.classList.add('pop');
}

function showComboAnim() {
  if(currentCombo < 2) return;
  const cd = document.getElementById('comboDisplay'); cd.innerText = `${currentCombo} COMBO!`;
  cd.classList.remove('pop'); void cd.offsetWidth; cd.classList.add('pop');
}

// ★【0.03.02】クイックメモは入力するたびに保存する（どのカードのメモかは出題時に記録したIDで決める）
let _noteSaveTimer = null;
function saveQuickNote(val, cardId) {
  const id = cardId || currentNoteCardId || (quizPool[quizIndex] && (quizPool[quizIndex]._sourceId || quizPool[quizIndex].id));
  const m = db.find(q => q.id === id);
  if (!m) return;
  const v = String(val || '').trim();
  if ((m.note || '') === v) return;
  if (v) m.note = v; else delete m.note;
  quizPool.forEach(q => { if (q.id === id || q._sourceId === id) { if (v) q.note = v; else delete q.note; } });
  touchCard(m); saveData();
}
let _pendingNote = null; // 入力途中で、まだ保存していないメモ { id, value }
function onQuickNoteInput(el) {
  autoResizeNote(el);
  clearTimeout(_noteSaveTimer);
  // どのカードのメモかは「入力した時点」で決める（保存前に次の問題へ進んでも、別のカードに書き込まないように）
  _pendingNote = { id: currentNoteCardId, value: el.value };
  _noteSaveTimer = setTimeout(flushPendingNote, 600);
}
function flushPendingNote() {
  clearTimeout(_noteSaveTimer);
  if (!_pendingNote) return;
  const p = _pendingNote; _pendingNote = null;
  saveQuickNote(p.value, p.id);
}
function onQuickNoteFocus() {
  const lbl = document.getElementById('lblNoteTyping'); if (lbl) lbl.style.display = 'inline';
}
function onQuickNoteBlur(el) {
  flushPendingNote();
  const lbl = document.getElementById('lblNoteTyping'); if (lbl) lbl.style.display = 'none';
}
function autoResizeNote(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(160, Math.max(38, el.scrollHeight + 2)) + 'px';
}

async function recordDailyLog(isCorrect) {
  if(!currentUser) return;
  const d = getTodayStr(); 
  const lRef = firestore.collection('susuru_anki_logs').doc(`${d}_${currentUser.uid}`);
  const sRef = firestore.collection('susuru_anki_daily_scores').doc(`${d}_${currentUser.uid}`);
  try {
    await lRef.set({ date:d, uid:currentUser.uid, name:currentUser.displayName, answered:firebase.firestore.FieldValue.increment(1), correct:firebase.firestore.FieldValue.increment(isCorrect?1:0) }, {merge:true});
    if(isCorrect) await sRef.set({ date:d, uid:currentUser.uid, name:currentUser.displayName, score:firebase.firestore.FieldValue.increment(1) }, {merge:true});
  } catch(e){}
}

// ★【0.03.02】文字タップモード：入力欄をタップすると最後の1文字を取り消す（以前は関数が無くエラーになっていた）
function removeLastTap() {
  if (quizPhase !== 'q' || currentTapInput.length === 0) return;
  const removed = currentTapInput.pop();
  const btn = document.getElementById(removed.id);
  if (btn) btn.style.display = 'inline-flex';
  renderTapInput();
}
