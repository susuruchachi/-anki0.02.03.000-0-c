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
// ★【0.03.66】1文字だけの大文字（be worth A の A など）は、端末によって「capital A」と読まれるので、文字の名前で読ませる。
// 文の始めの冠詞の A（A man came.）は小文字に、I（私）はそのまま
const SPEECH_LETTER_NAMES = { A: 'ay', B: 'bee', C: 'see', D: 'dee', E: 'ee', F: 'eff', G: 'gee', H: 'aitch', J: 'jay', K: 'kay', L: 'el', M: 'em', N: 'en', O: 'oh', P: 'pee', Q: 'cue', R: 'ar', S: 'ess', T: 'tee', U: 'you', V: 'vee', W: 'double you', X: 'ex', Y: 'why', Z: 'zee' };
function speechLetters(text) {
  return String(text || '').replace(/(^|[^A-Za-z0-9.])([A-Z])(?![A-Za-z0-9]|\.[A-Za-z])/g, (m, pre, L, off, all) => {
    if (L === 'I') return m;
    if (L === 'A') {
      const before = all.slice(0, off + pre.length), after = all.slice(off + m.length);
      // 文の始めで、すぐ後ろに小文字の単語が続くなら冠詞
      if (/(^|[.!?。！？「『"“]\s*)$/.test(before.replace(/\s+$/, '')) && /^\s+[a-z]/.test(after) && !/^\s+(or|and|to|with|of|in|on|at|for|from|as|than|by|into|is|are|was|were|and|nor)\b/.test(after)) return pre + 'a';
    }
    return pre + SPEECH_LETTER_NAMES[L];
  });
}
function cleanTextForSpeech(text) {
  return speechLetters(String(text || ''))
    .replace(/[\[\]［］]/g, ' ')
    .replace(/\(\s*\)|（\s*）|\(　+\)|（　+）|_{2,}|＿{2,}/g, (m, off, all) => /[\u3040-\u30ff\u4e00-\u9fff]/.test(all.slice(Math.max(0, off - 2), off) + all.slice(off + m.length, off + m.length + 2)) ? '、空欄、' : ' blank ') // ★【0.03.69】日本語の文の空欄は「空欄」と読む
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

// ★【0.03.65】アクセント・発音の問題は、問題文を読み上げると答え（読み方）が分かってしまうので、英語の部分を「この語」と読む
// （英語だけの問題文なら読み上げない）。答えは答え合わせのあとに読むのでそのまま
const SOUND_QUESTION_RE = /アクセント|発音|強勢|音節|accent|stress|pronunciation|syllable/i;
function isSoundQuestion(q) { return SOUND_QUESTION_RE.test(String(q || '')); }
function spoilerSafeSpeech(text) {
  const t = String(text || '');
  if (!isSoundQuestion(t)) return t;
  if (!/[\u3040-\u30ff\u4e00-\u9fff]/.test(t)) return '';
  return t.replace(/[（(][^）)]*[A-Za-z][^）)]*[）)]/g, '').replace(/[A-Za-z\u00c0-\u024f][A-Za-z\u00c0-\u024f\u0300-\u036f'’\-]*(?:[ \t]+[A-Za-z\u00c0-\u024f][A-Za-z\u00c0-\u024f\u0300-\u036f'’\-]*)*/g, 'この語');
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
  // ★【0.03.02】保存されたパスを「全階層」復元する
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
  // ★【0.03.49】段々のプルダウンをやめて、フォルダーのツリーから選ぶ（picker.js）
  const cur = path.length && path[0] !== 'all' ? path[path.length - 1] : '';
  container.innerHTML = folderPickButtonHTML(cur, 'すべてのフォルダーから出題', 'pickQuizScope()', cur ? `${(fpCardCounts()[cur] || 0)}問` : `${db.filter(q => q.kind !== 'intro').length}問`);
}
function pickQuizScope() {
  const cur = selectedScopePath.length && selectedScopePath[0] !== 'all' ? selectedScopePath[selectedScopePath.length - 1] : '';
  openFolderPicker({ title: '🎯 出題範囲を選ぶ', current: cur, allLabel: '🌐 すべてのフォルダーから出題', selectable: scopeVisible,
    hint: 'フォルダーを選ぶと、その下のフォルダーの問題も出題します（「上から出題しない」にしたフォルダーは除く）',
    onPick: c => { selectedScopePath = c ? getCategoryPath(c) : ['all']; saveScopePath(); buildQuizScopeDropdown(); } });
}

// ★【0.02.63】このラウンドの構造化解答（品詞タグ付き複数解答）。null なら通常の単一解答。
let currentStructuredAnswer = null;
// ★【0.03.00】このラウンドで実際に使う出題モード（構造式・漢文が答えの問題は自己申告に切り替わることがある）
let currentRoundMode = 'desc';

// ★【0.03.00】クイズを途中でやめてホームに戻る（それまでの解答結果は保存済み）
// ================================================================
// ★【0.03.37】クイズの結果の画面（解いた問題ごとに、正誤・レベルの変化・今のランク）
// ================================================================
let _quizSession = { results: [], startedAt: 0 };
let _quizOrigin = null, _quizSessionCarry = null; // ★【0.03.64】どこから始めたか（{k:'home', m} / {k:'plan'}）・間違い直しでも元の問題を覚えておく
const SRS_STATUS = { grad: { n: '🎓 卒業', c: 'var(--success)' }, master: { n: '⚡ 得意', c: 'var(--primary)' }, normal: { n: '☕ 普通', c: 'var(--warn)' }, weak: { n: '⚠️ 苦手', c: 'var(--danger)' }, shikkari: { n: '🧱 しっかり', c: '#9aa0a6' }, unseen: { n: '💤 未着手', c: 'var(--text3)' } };
function srsStatusOf(t) {
  if (!t) return 'unseen';
  if (isGraduated(t)) return 'grad';
  if (t.level === -1) return 'shikkari';
  if (t.level >= 3) return 'master';
  if (t.level >= 1) return 'normal';
  return (t.correct || 0) + (t.incorrect || 0) > 0 ? 'weak' : 'unseen';
}
function recordQuizSessionResult(cur, isCorrect, isPass, regrade, m, senseKey, before) {
  if (window.currentOnlineMatch || !cur) return;
  const t = m ? (senseKey ? m.senses[senseKey] : m) : null;
  const key = (cur._sourceId || cur.id) + '\u0001' + (cur._senseKey || '') + '\u0001' + (cur._swapped ? 's' : '');
  const list = _quizSession.results;
  const r = { key, id: cur._sourceId || cur.id, q: cur.question, a: getPrimaryAnswer(cur.answer), label: cur._senseLabel || '', swapped: !!cur._swapped,
    correct: !!isCorrect, pass: !!isPass, stars: m ? m.stars || 0 : 0,
    before: before || (t ? { level: t.level, status: srsStatusOf(t) } : null), after: t ? { level: t.level, status: srsStatusOf(t), l5: t.level5Correct || 0 } : null };
  // 採点のやり直しは、同じ問題の記録を置き換える（変化の前は最初の記録のまま）
  if (regrade && list.length && list[list.length - 1].key === key) { r.before = list[list.length - 1].before; list[list.length - 1] = r; }
  else list.push(r);
}
function lvText(x) { return !x ? '—' : x.status === 'grad' ? '🎓' : x.level === -1 ? 'しっかり' : 'Lv' + (Number(x.level) || 0); }
function showQuizResults() {
  const res = _quizSession.results;
  openPage('pgQuizResult');
  const box = document.getElementById('quizResultBox');
  if (!res.length) { box.innerHTML = '<div class="card"><div class="hint-small">解いた問題はありません。</div></div>'; return; }
  const n = res.filter(r => !r.pass).length, ok = res.filter(r => r.correct).length;
  const up = res.filter(r => r.before && r.after && (r.after.level > r.before.level || (r.after.status === 'grad' && r.before.status !== 'grad'))).length;
  const down = res.filter(r => r.before && r.after && r.after.level < r.before.level).length;
  const grad = res.filter(r => r.after && r.after.status === 'grad' && r.before && r.before.status !== 'grad').length;
  const secs = Math.round((Date.now() - (_quizSession.startedAt || Date.now())) / 1000);
  const statusCount = {}; res.forEach(r => { if (r.after) statusCount[r.after.status] = (statusCount[r.after.status] || 0) + 1; });
  const chip = s => `<span class="res-chip" style="--c:${SRS_STATUS[s].c}">${SRS_STATUS[s].n}</span>`;
  box.innerHTML = `
    <div class="card res-summary">
      <div class="res-score">${ok}<span>/ ${n} 問正解</span></div>
      <div class="hint-small">正答率 ${n ? Math.round(ok / n * 100) : 0}% ・ ${Math.floor(secs / 60)}分${secs % 60}秒</div>
      <div class="res-stats"><div><b style="color:var(--success);">⬆ ${up}</b><span>レベルアップ</span></div><div><b style="color:var(--danger);">⬇ ${down}</b><span>レベルダウン</span></div><div><b style="color:var(--success);">🎓 ${grad}</b><span>卒業</span></div></div>
      <div class="res-status">${Object.keys(SRS_STATUS).filter(s => statusCount[s]).map(s => `${chip(s)} ${statusCount[s]}`).join('　')}</div>
    </div>
    <div class="res-filter"><button class="chip" id="resSpeakAll" onclick="speakQuizResults()">🔊 読み上げ</button><button class="chip active" data-f="all">すべて ${res.length}</button><button class="chip" data-f="ng">✕ 間違い ${res.filter(r => !r.correct).length}</button><button class="chip" data-f="chg">↕ 変化あり ${res.filter(r => r.before && r.after && r.before.level !== r.after.level || (r.after && r.before && r.after.status !== r.before.status)).length}</button></div>
    <div id="quizResultList">${res.map((r, i) => {
      const changed = r.before && r.after && (r.before.level !== r.after.level || r.before.status !== r.after.status);
      const arrow = !r.before || !r.after ? '' : r.after.level > r.before.level || (r.after.status === 'grad' && r.before.status !== 'grad') ? '<b class="res-up">⬆</b>' : r.after.level < r.before.level ? '<b class="res-down">⬇</b>' : '<span class="res-same">→</span>';
      return `<div class="res-row ${r.correct ? 'ok' : 'ng'}" data-i="${i}" data-ng="${r.correct ? 0 : 1}" data-chg="${changed ? 1 : 0}">
        <div class="res-mark">${r.pass ? '🏳️' : r.correct ? '⭕' : '✕'}</div>
        <div class="res-body"><div class="res-q">${renderRichText(r.q, { escape: true })}${r.label ? ` <span class="res-label">[${escapeHtml(r.label)}]</span>` : ''}${r.stars ? ` <span class="card-stars">${starsText(r.stars)}</span>` : ''}</div>
          <div class="res-a">${renderRichText(r.a, { escape: true })}</div></div>
        <button class="chip res-speak" onclick="speakQuizResult(${i})" title="問題と答えを読み上げる">🔊</button>
        <div class="res-lv">${r.after ? `<div>${lvText(r.before)} ${arrow} <b>${lvText(r.after)}</b></div>${chip(r.after.status)}${r.after.status !== 'grad' && r.after.level >= 5 ? `<div class="hint-small">卒業まで ${Math.max(0, Math.ceil(getGradThreshold() - r.after.l5))}</div>` : ''}` : ''}</div>
      </div>`; }).join('')}</div>
    <div class="res-actions">
      ${res.some(r => !r.correct) ? '<button class="btn btn-accent" onclick="retryQuizMistakes()">🔁 間違えた問題をもう一度</button>' : ''}
      ${(_quizSession.pool || []).length ? `<button class="btn btn-secondary" onclick="replayQuizSession()">🔄 同じ範囲をもう一回（${_quizSession.pool.length}問）</button>` : ''}
      ${quizNextLabel() ? `<button class="btn btn-primary" onclick="startNextQuiz()">${quizNextLabel()}</button>` : ''}
      <button class="btn btn-secondary" onclick="openPage(\'pgHome\')">🏠 ホーム</button>
      <button class="btn btn-secondary" onclick="openPage(\'pgStats\')">📊 実績を見る</button>
    </div>`;
  hydrateRich(box);
  box.querySelectorAll('.res-filter .chip').forEach(b => b.onclick = () => {
    box.querySelectorAll('.res-filter .chip').forEach(x => x.classList.toggle('active', x === b));
    const f = b.dataset.f;
    box.querySelectorAll('.res-row').forEach(row => { row.style.display = f === 'all' || (f === 'ng' && row.dataset.ng === '1') || (f === 'chg' && row.dataset.chg === '1') ? '' : 'none'; });
  });
}
// ★【0.03.64】振り返りの読み上げ：1問ずつ（問題 → 答え）／表示している問題を全部
function quizResultSpeech(r) { return `${r.q}。${r.label ? r.label + '。' : ''}${r.a}。`; }
function speakQuizResult(i) { const r = _quizSession.results[i]; if (r && typeof speakText === 'function') speakText(quizResultSpeech(r)); }
function speakQuizResults() {
  const b = document.getElementById('resSpeakAll');
  if ('speechSynthesis' in window && speechSynthesis.speaking) { speechSynthesis.cancel(); if (b) b.textContent = '🔊 読み上げ'; return; }
  const rows = [...document.querySelectorAll('#quizResultList .res-row')].filter(x => x.style.display !== 'none');
  const txt = rows.map(x => quizResultSpeech(_quizSession.results[Number(x.dataset.i)])).join('\n');
  if (!txt || typeof speakText !== 'function') return;
  speakText(txt);
  if (b) { b.textContent = '⏹ 止める'; const t = setInterval(() => { if (!speechSynthesis.speaking) { clearInterval(t); b.textContent = '🔊 読み上げ'; } }, 500); }
}
// ★【0.03.64】同じ問題をもう一回（成績は今のものから作り直す）
function quizRebuildEntry(e) {
  if (e._attrQ) return e;
  const card = db.find(q => q.id === (e._sourceId || e.id)); if (!card) return null;
  let x = card;
  if (e._senseKey) x = expandSenses([card]).find(y => y._senseKey === e._senseKey) || card;
  return e._swapped ? swapQuizEntry(x) : x;
}
function replayQuizSession() {
  const pool = (_quizSession.pool || []).map(quizRebuildEntry).filter(Boolean);
  if (!pool.length) return alert('もう一度出せる問題がありません。');
  currentCombo = 0; todayCorrectCount = 0; currentQuizOrderScope = null;
  _quizSessionCarry = { pool: _quizSession.pool, mode: _quizSession.mode, origin: _quizSession.origin };
  _quizModeOverride = _quizSession.mode || null;
  quizPool = pool; quizIndex = 0;
  openPage('pgQuizPlayer'); loadQuizQuestion();
}
// 次を始める：ホームから始めたら同じ設定で次の問題（番号順なら続きから）、週間プランからなら残っている次の課題
function quizNextTarget() {
  const o = _quizSession.origin;
  if (!o) return null;
  if (o.k === 'home') return { label: '▶️ 次の問題を始める', go: () => startQuiz(o.m, { next: true }) };
  if (o.k === 'plan' && typeof planUrgentTask === 'function') {
    const t = planUrgentTask();
    if (t) return { label: `▶️ 次の課題：${t.title.split('：')[0]}`, go: () => planStartTask(t.planId, t.key) };
  }
  return null;
}
function quizNextLabel() { const t = quizNextTarget(); return t ? escapeHtml(t.label) : ''; }
function startNextQuiz() { const t = quizNextTarget(); if (t) t.go(); }
// 間違えた問題だけでもう一度
function retryQuizMistakes() {
  const wrong = _quizSession.results.filter(r => !r.correct);
  const pool = [];
  wrong.forEach(r => {
    const card = db.find(q => q.id === r.id); if (!card) return;
    let e = card;
    if (r.label || /\u0001.+\u0001/.test(r.key)) { const sk = r.key.split('\u0001')[1]; const ex = expandSenses([card]).find(x => x._senseKey === sk); if (ex) e = ex; }
    if (r.swapped) e = swapQuizEntry(e);
    pool.push(e);
  });
  if (!pool.length) return alert('もう一度出せる問題がありません。');
  currentCombo = 0; todayCorrectCount = 0; currentQuizOrderScope = null;
  _quizSessionCarry = { pool: _quizSession.pool, mode: _quizSession.mode, origin: _quizSession.origin };
  _quizModeOverride = _quizSession.mode || null;
  quizPool = pool; quizIndex = 0;
  openPage('pgQuizPlayer'); loadQuizQuestion();
}

function quitQuiz() {
  if (window.currentOnlineMatch) {
    if (!confirm('⚔️ 対戦中です。中断してホームに戻りますか？')) return;
  } else if (quizPhase === 'q' && quizIndex > 0 && !confirm('クイズを中断してホームに戻りますか？\n（ここまでの成績は保存されています）')) {
    return;
  }
  stopQuizTimer(); clearTimeout(autoNextTimeout);
  lastQuizScopePath = [...selectedScopePath];
  // ★【0.03.37】途中でやめても、解いた問題があれば結果を見せる
  if (!window.currentOnlineMatch && _quizSession.results.length) showQuizResults();
  else openPage('pgHome');
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
// ★【0.03.73】「前回の続きから」の位置は quizOrderPos（storage.js）に持ち、端末間で同期する
function loadQuizOrderPosition(scope) {
  const k = scope || 'all', e = (quizOrderPos || {})[k];
  let legacy = null; try { legacy = localStorage.getItem(quizOrderKey(scope)); } catch (er) {}
  if (legacy && !e) { quizOrderPos[k] = { pos: legacy, at: 1 }; try { localStorage.removeItem(quizOrderKey(scope)); } catch (er) {} return legacy; }
  return e ? e.pos : legacy;
}
// 番号順（続きから）で解いた最後のカードを覚えておく
function recordQuizOrderProgress(cur) {
  if (!currentQuizOrderScope || !cur || window.currentOnlineMatch) return;
  // ★【0.03.17】意味ごとの問題なら、どの意味まで解いたかも覚える（「カードID\u0001意味」）
  const pos = (cur._sourceId || cur.id) + (cur._senseKey ? '\u0001' + cur._senseKey : '');
  quizOrderPos[currentQuizOrderScope || 'all'] = { pos, at: Date.now() }; // 保存は解答の保存（saveData）と一緒に
}

const QUIZ_PREF_KEY = 'susuru_anki_quiz_prefs';
const QUIZ_PREF_IDS = ['selQuizMode', 'selQuizSpeed', 'selHintMode', 'chkFocusMode', 'selQuizOrder', 'numQCount', 'numTimeLimit', 'numAutoNext', 'numGradThreshold', 'chkTTS', 'chkTimeAttack', 'chkIncludeGrad', 'chkSwapQA', 'chkVerbAttr'];
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
// ★【0.03.69】「・」も区切り（「過去・詠嘆」は「詠嘆、過去」でも正解）。◯（活用の無い形）を含む答え（活用表）は並び順も見る
function normalizeAnswer(str, keepOrder) {
  if(!str) return '';
  let s = foldKana(String(str).replace(/[Ａ-Ｚａ-ｚ０-９]/g, c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).toLowerCase().trim());
  s = s.replace(/擦/g, 'こす');
  // ★【0.03.06】［ ］・～・… などの記号は入力しなくてよい（中身だけ合っていれば正解）
  s = s.replace(ANSWER_SYMBOL_RE, ' ');
  s = s.replace(/[◯○〇⚪]/g, '○');
  s = s.replace(/[①-⑨]/g, c => String(c.charCodeAt(0) - 0x245F)); // ★【0.03.72】①は「1」と書いても正解
  s = s.replace(/[、，＼＼ \u3000・]+/g, ',');
  const parts = s.split(',').map(x=>x.trim()).filter(x=>x!=='');
  return (keepOrder ? parts : parts.sort()).join(',');
}
function isAnswerCorrect(input, correctAnswer) {
  // ★【0.03.00】構造式(SMILESの「/」)や漢文ブロックを区切り文字として誤分割しないようにマスクしてから分割する
  // ［ ］の中身まで書いた答え・［ ］の部分を省いた答えのどちらでも正解
  // ★【0.03.58】先頭の品詞タグ「(名詞)」などを外した形も正解（4択の選択肢はタグを外して出すので、正しいものを選んでも×になっていた）
  const untag = a => String(a).replace(/^\s*(?:\([^()]*\)\s*)+/, '');
  const ord = normalizeAnswer(correctAnswer, true).split(',').includes('○'); // 「（せ）・◯・き・し…」のように ◯ が1つの項目になっている活用表
  const noParen = a => String(a).replace(/[（）]/g, ''); // ★【0.03.69】（せ）の（ ）は書かなくてもよい
  const norms = splitAnswerAlternatives(correctAnswer).flatMap(a => [normalizeAnswer(a, ord), normalizeAnswer(dropBracketParts(a), ord), normalizeAnswer(untag(a), ord), normalizeAnswer(dropBracketParts(untag(a)), ord), normalizeAnswer(noParen(a), ord)]).filter(x => x !== '');
  const inNorm = normalizeAnswer(input, ord);
  if (ord && norms.includes(normalizeAnswer(noParen(input), true))) return true;
  return norms.includes(inNorm);
}

// ★【0.02.65】4択・みんはや・文字タップは「1つの答えを選ぶ/組み立てる」形式のため、
// 品詞タグ付き構造化解答(例: adapt の他動詞/自動詞)を持つカードは、
// タグ(意味)ごとに独立した単発の問題として連続で出題する。
// 生成される仮想エントリーは quizPool 内のみに存在し、db には反映されない。
// ★【0.03.17】意味（品詞タグ）ごとに独立した問題にする（全部の形式で）。意味ごとの成績を問題に写して、優先順位・卒業の判定に使う
function expandSenses(cards) {
  const result = [];
  cards.forEach(card => {
    if (card.kind === 'intro') return; // ★【0.03.44】導入の文は問題にしない
    const list = cardSenseList(card);
    if (!list) { result.push(card); return; }
    const view = senseStatsView(card, list);
    list.forEach(sn => {
      const st = view[sn.key] || {};
      const e = { ...card, answer: sn.text, _sourceId: card.id, _senseKey: sn.key, _senseLabel: sn.label };
      SENSE_STAT_FIELDS.forEach(f => { e[f] = Number(st[f]) || 0; });
      delete e.senses;
      result.push(e);
    });
  });
  return result;
}

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

async function startQuiz(modeType = 'normal', opts = {}) {
  currentCombo = 0; todayCorrectCount = 0; _quizModeOverride = null;
  _quizOrigin = window.currentOnlineMatch ? null : { k: 'home', m: modeType };
  if (selectedScopePath.length === 0 && lastQuizScopePath.length > 0) selectedScopePath = [...lastQuizScopePath];
  let scope = "all";
  if (selectedScopePath.length > 0 && selectedScopePath[0] !== "all") scope = "cat:" + selectedScopePath[selectedScopePath.length - 1];
  
  const includeGrad = document.getElementById('chkIncludeGrad').checked;
  const limitCount = parseInt(document.getElementById('numQCount').value) || 10;

  // ★【0.03.17】意味ごとに分けてから選ぶ（覚えた意味は出にくく、覚えていない意味が出やすくなる）
  let subset = window.currentOnlineMatch ? db.filter(q => q.kind !== 'intro') : expandSenses(db);
  if (modeType === 'tokkun') subset = subset.filter(q => q.level <= 0 || q.level === -1);
  else if (modeType === 'review') subset = subset.filter(q => isGraduated(q));
  else if (!includeGrad) subset = subset.filter(q => !(isGraduated(q)));

  if(scope.startsWith('cat:')) {
    const cName = scope.replace('cat:', '');
    const targets = getQuizSubcategories(cName); // ★【0.03.30】「上から出題するときは出さない」フォルダーを除く
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
  let order = modeType === 'review' ? 'srs' : (document.getElementById('selQuizOrder') ? document.getElementById('selQuizOrder').value : 'srs');
  if (opts.next && order === 'number') order = 'continue'; // ★【0.03.64】結果の画面の「次の問題を始める」は、番号順なら続きから
  if (order === 'number' || order === 'continue') {
    // ★【0.03.03】問題番号順に出題（フォルダーの番号順→カードの番号順）
    sortCardsByNumber(subset);
    let start = 0;
    if (order === 'continue') {
      const lastId = loadQuizOrderPosition(scope);
      // 最後に解いた問題（意味ごとの問題なら、その意味）の次から。意味が分からないときは、そのカードの最後の意味の次から
      const [lastCard, lastSense] = String(lastId || '').split('\u0001');
      let idx = -1;
      if (lastCard && lastSense) idx = subset.findIndex(q => q.id === lastCard && q._senseKey === lastSense);
      if (lastCard && idx < 0) for (let i = subset.length - 1; i >= 0; i--) { if (subset[i].id === lastCard) { idx = i; break; } }
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

  // 問題と答えの入れ替え（意味ごとに分けたあとなので「意味 → 見出し語」になる）
  if (document.getElementById('chkSwapQA').checked) quizPool = quizPool.map(swapQuizEntry);
  quizPool = arrangeVerbFlow(quizPool);
  openPage('pgQuizPlayer'); loadQuizQuestion();
}

// ★【0.03.40】動詞（自動詞・他動詞のタグがあるカード）は、自動詞の意味 → 他動詞の意味 → 「自動詞？他動詞？自他両用？」→
//  （両方あるとき）意味ごとに「自動詞？他動詞？」→ その動詞の熟語・チャンク（communicate with A など。登録順）の順に続けて出す。
//  自動詞・他動詞を聞く問題は、どの形式でも選択式。レベルは動かさない（正解数・学習記録には入る）
function verbAttrSegs(card) {
  const st = parseStructuredAnswer(card && card.answer);
  if (!st || st.some(s => /句動詞|熟語|成句/.test(s.label))) return null;
  const segs = st.filter(s => /自動詞|他動詞/.test(s.label));
  return segs.length ? segs : null;
}
function verbAttrEntries(card) {
  const segs = verbAttrSegs(card); if (!segs) return [];
  const ji = segs.some(s => /自動詞/.test(s.label)), ta = segs.some(s => /他動詞/.test(s.label));
  const base = { category: card.category, note: card.note, _sourceId: card.id, _attrQ: true, level: 0, correct: 0, incorrect: 0 };
  const out = [{ ...base, id: card.id + '#attr', question: `${card.question}\nこの動詞は？`, answer: ji && ta ? '自他両用' : ji ? '自動詞' : '他動詞', choices: ['自動詞', '他動詞', '自他両用'], _senseKey: '#attr' }];
  if (ji && ta) segs.forEach((s, i) => out.push({ ...base, id: card.id + '#attr' + i, question: `${card.question}\n「${stripParens(s.text).replace(/\s+/g, ' ').trim()}」の意味のときは？`, answer: /自動詞/.test(s.label) ? '自動詞' : '他動詞', choices: ['自動詞', '他動詞'], _senseKey: '#attr' + i }));
  return out;
}
function arrangeVerbFlow(pool) {
  if (window.currentOnlineMatch || !pool.length) return pool;
  const el = document.getElementById('chkVerbAttr'); if (el && !el.checked) return pool;
  const byId = new Map(db.map(q => [q.id, q]));
  const src = e => byId.get(e._sourceId || e.id);
  const verbs = new Map(); // 動詞の見出し語（小文字）→ カード
  pool.forEach(e => { const c = src(e); if (c && !e._attrQ && verbAttrSegs(c) && /^[A-Za-z][A-Za-z'-]*$/.test(String(c.question).trim())) verbs.set(String(c.question).trim().toLowerCase(), c); });
  if (!verbs.size) return pool;
  const verbOfPhrase = e => { const c = src(e); if (!c || verbs.has(String(c.question).trim().toLowerCase())) return null; const w = String(c.question).trim().toLowerCase().split(/\s+/); return w.length > 1 && verbs.has(w[0]) ? verbs.get(w[0]) : null; };
  const groups = new Map(); const out = [];
  pool.forEach(e => {
    const c = src(e); const v = c && verbs.get(String(c.question).trim().toLowerCase()) === c ? c : verbOfPhrase(e);
    if (!v) { out.push(e); return; }
    let g = groups.get(v.id);
    if (!g) { g = { v, senses: [], phrases: [] }; groups.set(v.id, g); out.push(g); }
    (v === c ? g.senses : g.phrases).push(e);
  });
  const ord = sortCardsByNumber(db.slice()); const pos = new Map(ord.map((q, i) => [q.id, i]));
  const jiFirst = e => /自動詞/.test(e._senseLabel || '') ? 0 : /他動詞/.test(e._senseLabel || '') ? 1 : 2;
  return out.flatMap(x => {
    if (!x.v) return [x];
    const senses = x.senses.slice().sort((a, b) => jiFirst(a) - jiFirst(b));
    const phrases = x.phrases.slice().sort((a, b) => (pos.get(a._sourceId || a.id) || 0) - (pos.get(b._sourceId || b.id) || 0));
    return [...senses, ...(senses.length ? verbAttrEntries(x.v) : []), ...phrases];
  });
}

let _quizModeOverride = null; // ★【0.03.44】このクイズだけ形式を決める（planStartQuiz から）
function loadQuizQuestion() {
  if (quizIndex === 0) { // ★【0.03.37】結果の画面用。★【0.03.64】もう一回・次を始める用に、出した問題と始め方も覚える
    const carry = _quizSessionCarry; _quizSessionCarry = null;
    _quizSession = { results: [], startedAt: Date.now(), pool: carry ? carry.pool : quizPool.slice(), mode: carry ? carry.mode : _quizModeOverride, origin: carry ? carry.origin : _quizOrigin };
    _quizOrigin = null;
  }
  quizPhase='q'; selectedChoiceIdx=null; window.currentSelfJudge=null;
  _focus = { attempts: 0 }; // ★【0.03.18】重点モードの答え直しの回数
  _multi = null; // ★【0.03.21】意味の聞き直し
  const _fs = document.getElementById('lblFocusStatus'); if (_fs) { _fs.style.display = 'none'; _fs.textContent = ''; _fs.classList.remove('multi'); }
  const cur = quizPool[quizIndex];

  // ★【0.02.63】品詞タグ付き構造化解答の判定（このラウンドで使い回すのでキャッシュしておく）
  // ・cur.answer が構造化解答 → 出題文からは (タグ) を省略して表示し、解答欄はタグごとの入力欄にする
  // ・cur.question 自体が構造化解答の形（逆引きモードでQ/Aが入れ替わった場合など）→ 出題文をラベル付きで整形表示する
  const aStructured = parseStructuredAnswer(cur.answer);
  const qStructuredSelf = parseStructuredAnswer(cur.question);
  currentStructuredAnswer = aStructured;

  document.getElementById('lblQuizProgress').innerText = `Q ${quizIndex+1}/${quizPool.length}`;
  { // ★【0.03.68】解いているときも問題番号を出す
    const nEl = document.getElementById('lblQuizCardNo'), src = cur && (db.find(q => q.id === (cur._sourceId || cur.id)) || cur);
    if (nEl) { const on = src && showsCardNo(src); nEl.style.display = on ? '' : 'none'; nEl.textContent = on ? `No.${cardNoText(src.no)}` : ''; }
  }
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
    speakText(spoilerSafeSpeech(qSpeech));
  }
  // ★【0.03.02】テスト形式で選択肢があるカードは、記述式でも選択肢を問題文の下に表示する
  // ★【0.03.72】長い問題文（例文を並べた選択問題など）は左寄せ・少し小さく。①②③… だけの選択肢は問題文の中にあるので下に並べない
  qEl.classList.toggle('q-long', String(cur.question || '').length > 60 && /\n/.test(String(cur.question || '')));
  if (Array.isArray(cur.choices) && cur.choices.length && !cur._attrQ && !cur.choices.every(o => /^\s*[①-⑳0-9０-９]\s*$/.test(o))) {
    const chDiv = document.createElement('div');
    chDiv.className = 'quiz-card-choices';
    chDiv.innerText = cur.choices.join(' ／ ');
    qEl.appendChild(chDiv);
  }

  let mode = _quizModeOverride || document.getElementById('selQuizMode').value;
  // ★【0.03.00】答えが構造式・漢文ブロック・数式の場合は文字入力できないので、記述・みんはや・文字タップは自己申告で出題する
  const _primary = getPrimaryAnswer(cur.answer);
  const richAnswer = hasRichBlock(_primary) || /\$[^$]+\$/.test(_primary);
  if (richAnswer && ['desc', 'minhaya', 'tap'].includes(mode)) mode = 'self';
  // ★【0.03.05】「自己申告」形式のカード（答えが列挙などで文字入力に向かない）は、入力モードでは自己申告で出題する
  if (cur.kind === 'self' && ['desc', 'minhaya', 'tap'].includes(mode)) mode = 'self';
  if (cur._attrQ) mode = 'choice'; // ★【0.03.40】自動詞・他動詞を聞く問題は、どの形式でも選択式
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
  const hintsOn = hintsEnabled(speed) && !cur._attrQ;
  quizHintState = hintsOn ? buildHintStages(cur, mode, aStructured, richAnswer) : { stages: [], shown: 0 };
  const hintBtn = document.getElementById('btnQuizHint');
  if (hintBtn) hintBtn.style.display = (quizHintState.stages.length && !window.currentOnlineMatch) ? 'inline-flex' : 'none';
  // ★【0.03.15】AI ヒント（ヒントがオンで、AI が使えるとき）
  const aiHintBtn = document.getElementById('btnQuizAiHint');
  if (aiHintBtn) {
    const showAi = hintsOn && !window.currentOnlineMatch && typeof aiAvailable === 'function' && aiAvailable() && getAiPrefs().hint && !richAnswer && !isBinaryCard(cur);
    aiHintBtn.style.display = showAi ? 'inline-flex' : 'none'; aiHintBtn.disabled = false; aiHintBtn.innerText = '🤖 AIヒント';
  }
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
      // ★【0.03.18】重点モードなら、時間切れも「答えられなかった」としてヒントを出して答え直す
      if (focusEnabled(quizPool[quizIndex])) { const c = quizPool[quizIndex]; concludeAttempt(c, false, { typed: currentRoundMode === 'desc', given: '', kind: 'blank', choice: currentRoundMode === 'choice', structuredWrong: currentStructuredAnswer ? currentStructuredAnswer.map((x, i) => i) : undefined }); return; }
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
// ★【0.03.23】もともと選択肢から選ぶ問題（Same/Opposite・Yes/No・選択肢つきのテスト）。
//  記述式で出しても、頭文字や文字数のヒントは答えそのものになるので出さない
const BINARY_ANSWER_RE = /^(yes|no|true|false|same|opposite|similar|different|correct|incorrect|right|wrong|t|f|○|×|〇|✕|はい|いいえ|正しい|誤り|正|誤|同じ|反対|同意|反意|同義|反義)$/i;
function isChoiceCard(cur) { return !!cur && Array.isArray(cur.choices) && cur.choices.length >= 2; }
function isBinaryCard(cur) {
  if (!cur) return false;
  if (Array.isArray(cur.choices) && cur.choices.length === 2) return true;
  return BINARY_ANSWER_RE.test(String(cur.answer || '').trim());
}
function buildHintStages(cur, mode, structured, richAnswer) {
  const stages = [];
  const note = String(cur.note || '').trim();
  // メモの和訳（答えが英語なら英単語・語根）を隠してから、さらに答えそのものも伏せ字にする
  // ★【0.03.08】和訳・英単語を隠すのは英語（または教科なし）のフォルダーだけ。化学などでは化学式を隠さない
  const hidden = noteHidingApplies(cur.category) ? hideNoteTranslations(note, isLatinAnswer(getPrimaryAnswer(cur.answer))) : note;
  if (note) stages.push({ memo: true, html: '📝 ' + escapeHtml(maskAnswerInText(hidden, cur.answer)).replace(/\n/g, '<br>') });
  // ★【0.03.18】何度も必要になった AI のヒント（この端末に覚えたもの）
  if (typeof aiMemoryHintsFor === 'function' && !window.currentOnlineMatch && !isBinaryCard(cur)) {
    const mh = aiMemoryHintsFor(cur, 2);
    if (mh.length) stages.push({ ai: true, html: mh.map(it => '🤖 ' + escapeHtml(it.h)).join('<br>') });
  }
  if (richAnswer || mode !== 'desc' || isChoiceCard(cur) || isBinaryCard(cur)) return { stages, shown: 0 };
  if (structured) {
    stages.push({ structured: structured.map(seg => seg.text.charAt(0)) });
  } else {
    // 意味ごとの問題は、全角スペース・読点で区切った言い換えの最初のものでヒントを出す
    const ans = (cur._senseKey && !cur._swapped) ? (String(cur.answer).split(/[\u3000、，,|]/)[0].trim() || getPrimaryAnswer(cur.answer)) : getPrimaryAnswer(cur.answer);
    stages.push(...letterHintStages(ans));
  }
  return { stages, shown: 0 };
}
function letterHintStages(ans) {
  const chars = [...String(ans || '')];
  if (!chars.length) return [];
  const out = [{ html: `🔤 先頭は「 ${escapeHtml(chars[0] || '')} 」 （全 ${chars.length} 文字）` }];
  if (chars.length >= 4) {
    const n = Math.ceil(chars.length / 2);
    out.push({ html: `🔤 ${escapeHtml(chars.map((c, i) => i < n || /[\s　]/.test(c) ? c : '＿').join(''))}` });
  }
  return out;
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
  // ★【0.03.25】ダミーは、同じフォルダー → 1つ上のフォルダー（の下）から選ぶ。足りないときだけほかのフォルダーから
  const cat = cur.category || (db.find(q => q.id === (cur._sourceId || cur.id)) || {}).category;
  const parent = cat && typeof getCategoryParent === 'function' ? getCategoryParent(cat) : null;
  const near = new Set(parent ? getAllSubcategories(parent) : (cat ? [cat] : []));
  db.forEach(q => {
    if (q.id === cur.id || q.id === cur._sourceId) return;
    if (Array.isArray(q.choices) && q.choices.length) return; // テスト問題の Yes/No 等は混ぜない
    if (q.kind === 'intro') return; // 導入の文
    const info = choiceInfoOf(q, swapped);
    const t = info.t;
    if (!t) return;
    const n = info.n;
    if (seen.has(n)) return; // 正解と同じ
    const sh = info.sh;
    let score = 0;
    if (sh.latin === want.latin) score += 8;           // 英語なら英語、日本語なら日本語
    if (sh.rich === want.rich) score += 6;             // 構造式つきの答えには構造式つきの選択肢
    if (sh.ph === want.ph) score += 3;                 // 「A」「～」入りの熟語なら熟語どうし
    if (Math.abs(sh.words - want.words) <= 1) score += 2;
    if (q.kind === cur.kind) score += 1;
    const tier = q.category === cat ? 0 : near.has(q.category) ? 1 : 2;
    // ★【0.03.72】同じ答えのカードがいくつもあるときは、近いフォルダーのものを使う（前は先に見つかった遠いフォルダーのものになり、近いフォルダーの選択肢が出なかった）
    const it = { n, t, tier, score: score + (tier === 0 ? 3 : 0) + Math.random() * 1.5 };
    const prev = pool.find(p => p.n === n);
    if (!prev) pool.push(it); else if (it.tier < prev.tier || (it.tier === prev.tier && it.score > prev.score)) Object.assign(prev, it);
  });
  const nearPool = pool.filter(p => p.tier < 2).sort((a, b) => b.score - a.score);
  const far = pool.filter(p => p.tier === 2).sort((a, b) => b.score - a.score);
  return nearPool.concat(far).map(p => p.t);
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
  // ★【0.03.72】①②③… だけの選択肢（問題文に並べた文を番号で選ぶ）も、決まった順のまま
  if (!cur._attrQ && !options.every(o => /^\s*[①-⑳0-9０-９ア-ンa-zA-Z]\s*$/.test(o))) options.sort(() => Math.random() - 0.5); // 自動詞・他動詞は決まった順
  // ★【0.03.58】正解の選択肢は作ったときに覚えておく（選んだ文字を答えと比べ直すと、タグや記号の違いで×になることがあった）
  const nc = normalizeAnswer(correctPrimary);
  area._correctText = options.find(o => o === correctPrimary) || options.find(o => normalizeAnswer(o) === nc) || correctPrimary;
  options.forEach((text, i) => {
    const btn = document.createElement('button'); btn.className = 'choice-btn';
    btn.innerHTML = `<div class="choice-idx">${i+1}</div><div style="flex:1;">${renderRichText(text, { escape: true, kanbunRows: 8 })}</div>`;
    hydrateRich(btn, { chemScale: 1.1 });
    btn._choiceText = text;
    btn.onclick = () => {
      if(quizPhase !== 'q' || btn.disabled) return;
      document.querySelectorAll('.choice-btn').forEach(b => { if (!b.disabled) b.style.borderColor = 'var(--border)'; });
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

// 文字の種類（みんはや・文字タップのダミーをそろえる）
function charClassOf(c) {
  if (/[a-z]/.test(c)) return 'lower'; if (/[A-Z]/.test(c)) return 'upper'; if (/[0-9０-９]/.test(c)) return 'digit';
  if (/[ぁ-ゖ]/.test(c)) return 'hira'; if (/[ァ-ヺー]/.test(c)) return 'kata'; if (/[一-鿿々〆]/.test(c)) return 'kanji';
  return 'other';
}
const CHAR_FALLBACK = { lower: 'abcdefghijklmnopqrstuvwxyz', upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', digit: '0123456789', hira: 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん', kata: 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモラリルレロ', kanji: '日月火水木金土山川田人口目耳手足力学校年時間国語文字', other: '' };
// 正解の文字 c と同じ種類のダミーを n 個（近いフォルダーの答え → ほかの答え → 決まった文字の順に探す）
function pickSameClassChars(cur, c, exclude, n) {
  const cls = charClassOf(c), out = [], ex = new Set(exclude || []);
  const take = s => { for (const ch of [...String(s || '').replace(RICH_BLOCK_RE, '')].sort(() => Math.random() - 0.5)) { if (out.length >= n) return; if (ch !== c && !ex.has(ch) && !out.includes(ch) && charClassOf(ch) === cls) out.push(ch); } };
  try { buildChoiceCandidates(cur, getPrimaryAnswer(cur.answer)).slice(0, 12).forEach(take); } catch (e) {}
  if (out.length < n) sideCharsPool(cur).sort(() => Math.random() - 0.5).slice(0, 300).forEach(take);
  if (out.length < n) take(CHAR_FALLBACK[cls] || CHAR_FALLBACK.hira);
  return out.slice(0, n);
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
  const targetChars = minhayaTarget.split('');
  // ★【0.03.59】ダミーの文字は正解の文字と同じ種類（英字・ひらがな・カタカナ・漢字・数字）から、4択と同じく近いフォルダーの答えを先に使う
  let choices = [correctChar];
  pickSameClassChars(cur, correctChar, targetChars, 3).forEach(c => { if (choices.length < 4 && !choices.includes(c)) choices.push(c); });
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
  // ★【0.03.59】ダミーは答えの中の文字と同じ種類から（英語なら英字、日本語なら同じかな・漢字）
  const letters = chars.filter(c => charClassOf(c) !== 'other');
  for (let i = 0; i < 2 && letters.length; i++) { const base = letters[Math.floor(Math.random() * letters.length)]; const d = pickSameClassChars(cur, base, chars, 1)[0]; if (d) chars.push(d); }
  chars.sort(() => Math.random() - 0.5);
  
  chars.forEach((c, idx) => {
    const btn = document.createElement('button'); btn.className = 'btn btn-secondary'; btn.style.cssText = 'width:48px; height:48px; padding:0; font-size:1.3rem;'; btn.innerText = c; btn.id = 'tap_btn_' + idx;
    btn.onclick = () => {
      if (quizPhase !== 'q') return;
      currentTapInput.push({ char: c, id: btn.id }); btn.style.display = 'none'; renderTapInput();
      // ★【0.03.59】全部そろって正しければすぐ〇。違っていたら、ドラッグで並べ替えてから「確定する」
      if (currentTapInput.length === currentTapTarget.length && currentTapInput.map(x => x.char).join('') === currentTapTarget) submitTapAnswer();
    };
    chArea.appendChild(btn);
  });
}
function submitTapAnswer() {
  if (quizPhase !== 'q') return;
  stopQuizTimer();
  const inputStr = currentTapInput.map(x => x.char).join('');
  const ok = inputStr === currentTapTarget;
  evaluateRoundAnswer(ok, ok ? "🎉 正解！" : "❌ 不正解");
}
function renderTapInput() {
  const inArea = document.getElementById('tapInputArea'); inArea.innerHTML = '';
  const full = currentTapInput.length === currentTapTarget.length;
  const act = document.getElementById('btnQuizAction'); if (act && currentRoundMode === 'tap') act.style.display = full ? 'inline-flex' : 'none';
  if (currentTapInput.length === 0) { inArea.innerHTML = '<span style="color:var(--text3); font-size:0.85rem;">順番にタップしてください</span>'; return; }
  currentTapInput.forEach((item, index) => {
    const box = document.createElement('div');
    box.className = 'tap-tile';
    box.innerText = item.char;
    // ★【0.03.59】タップで取り消し、ドラッグで並べ替え（1文字飛ばしたときに、正しい位置へずらせる）
    box.addEventListener('pointerdown', e => tapDragStart(e, index, box));
    box.onclick = (e) => {
      e.stopPropagation(); if (quizPhase !== 'q' || box._dragged) return;
      const removed = currentTapInput.splice(index, 1)[0]; document.getElementById(removed.id).style.display = 'inline-flex'; renderTapInput();
    };
    inArea.appendChild(box);
  });
  if (full) inArea.insertAdjacentHTML('beforeend', '<div class="hint-small" style="width:100%; text-align:center; margin-top:4px;">文字をドラッグして並べ替えられます。よければ「確定する」</div>');
}
// ドラッグ：指の位置にいちばん近い文字の場所へ移す
function tapDragStart(e, index, box) {
  if (quizPhase !== 'q') return;
  const sx = e.clientX, sy = e.clientY; let moved = false, to = index;
  const tiles = () => [...document.querySelectorAll('#tapInputArea .tap-tile')];
  const move = ev => {
    if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return;
    moved = true; box._dragged = true; ev.preventDefault();
    box.style.transform = `translate(${ev.clientX - sx}px, ${ev.clientY - sy}px)`; box.style.zIndex = 5; box.style.opacity = '.85';
    let best = index, bd = Infinity;
    tiles().forEach((t, i) => { const r = t.getBoundingClientRect(); const d = Math.hypot(ev.clientX - (r.left + r.width / 2), ev.clientY - (r.top + r.height / 2)); if (d < bd) { bd = d; best = i; } });
    to = best;
    tiles().forEach((t, i) => t.classList.toggle('tap-target', moved && i === to && i !== index));
  };
  const up = () => {
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up);
    if (!moved) return;
    window._tapDraggedAt = Date.now(); // ドラッグの直後のクリックで1文字消さないように
    const [it] = currentTapInput.splice(index, 1); currentTapInput.splice(to, 0, it);
    renderTapInput();
    if (currentTapInput.length === currentTapTarget.length && currentTapInput.map(x => x.char).join('') === currentTapTarget) submitTapAnswer();
  };
  document.addEventListener('pointermove', move, { passive: false }); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
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
  if (_aiJudging || _focusBusy) return;
  // ★【0.03.21】意味の聞き直しの途中でパスしたら、答えられた分は「一部正解」
  if (_multi && _multi.found.length && quizPhase === 'q') {
    const fs = document.getElementById('lblFocusStatus'); if (fs) fs.style.display = 'none';
    return finishPartialMeanings(multiFoundNames(), _focus.attempts + 1, { typed: true, given: multiFoundNames().join('、') });
  }
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
          showQuizResults(); // ★【0.03.37】解いた問題ごとの結果
      }
    }
    return;
  }
  
  if (_aiJudging || _focusBusy) return; // AI の判定中・ヒントの用意中
  stopQuizTimer();
  const cur = quizPool[quizIndex];
  const mode = currentRoundMode;
  if (mode === 'tap') { if (currentTapInput.length === currentTapTarget.length) submitTapAnswer(); return; }
  if (mode === 'choice') {
    if (!selectedChoiceIdx) return;
    const given = selectedChoiceIdx;
    const area = document.getElementById('boxChoiceArea');
    const ok = (area && area._correctText !== undefined && given === area._correctText) || isAnswerCorrect(given, cur.answer);
    return concludeAttempt(cur, ok, { given, kind: 'wrong', choice: true });
  }
  // ★【0.03.21】意味をいくつも並べた答え（地域社会、共同体 など）で、一部だけ答えたら、ほかの意味も聞き直す
  if (handleMultiMeaning(cur)) return;
  if (currentStructuredAnswer) {
    const ok = gradeStructuredAnswer(currentStructuredAnswer);
    const vals = currentStructuredAnswer.map((seg, i) => (document.getElementById('structAns_' + i) || {}).value || '');
    const givenAll = vals.join(' / ');
    const wrong = currentStructuredAnswer.map((seg, i) => ({ i, seg, given: vals[i] })).filter(x => !isStructuredSegmentCorrect(x.given, x.seg.text));
    // ★【0.03.15】完全一致しなかった欄は、意味が同じかを AI に確かめる
    if (!ok && aiJudgeEnabled() && wrong.every(x => x.given.trim())) {
      aiJudgeItems(cur, wrong.map(x => ({ label: x.seg.label, expected: x.seg.text, given: x.given }))).then(r => {
        if (quizPool[quizIndex] !== cur || quizPhase === 'a' || !document.getElementById('pgQuizPlayer').classList.contains('active')) return;
        const stillWrong = [];
        wrong.forEach((x, k) => {
          const rr = r && r.results && r.results[k];
          const input = document.getElementById('structAns_' + x.i);
          if (rr && rr.correct) { if (input) { input.style.borderColor = 'var(--success)'; input.style.background = 'rgba(34,199,122,0.1)'; } }
          else stillWrong.push(x.i);
        });
        if ((stillWrong.length === 0 || aiVerdictKind(r) === 'partial') && startAiPartialReask(cur, givenAll, stillWrong.length === 0, r)) return;
        concludeAttempt(cur, stillWrong.length === 0, { typed: true, given: givenAll, ai: r, kind: aiVerdictKind(r), hint: aiFirstHint(r), structuredWrong: stillWrong });
      });
      return;
    }
    return concludeAttempt(cur, ok, { typed: true, given: givenAll, kind: vals.every(v => !v.trim()) ? 'blank' : 'wrong', structuredWrong: wrong.map(x => x.i) });
  }
  const given = document.getElementById('txtDescAnswer').value;
  // 意味ごとの問題は、全角スペース・読点で区切った言い換えのどれか1つで正解
  const ok = (cur._senseKey && !cur._swapped) ? isStructuredSegmentCorrect(given, cur.answer) : isAnswerCorrect(given, cur.answer);
  // ★【0.03.15】完全一致しなくても、意味が同じなら正解にする（AI に確かめる）
  if (!ok && given.trim() && aiJudgeEnabled() && !isChoiceCard(cur) && !isBinaryCard(cur)) { // 選択肢から選ぶ問題は、言い換えを認めない
    aiJudgeItems(cur, [{ label: cur._senseLabel && !cur._swapped ? cur._senseLabel : '', expected: cur.answer, given }]).then(r => {
      if (quizPool[quizIndex] !== cur || quizPhase === 'a' || !document.getElementById('pgQuizPlayer').classList.contains('active')) return;
      const allOk = !!(r && r.results && r.results.length && r.results.every(x => x.correct));
      // 意味をいくつも並べた答えに、言い換えで一部だけ答えた → ほかの意味を聞き直す
      if ((aiVerdictKind(r) === 'partial' || allOk) && startAiPartialReask(cur, given, allOk, r)) return;
      concludeAttempt(cur, allOk, { typed: true, given, ai: r, kind: aiVerdictKind(r), hint: aiFirstHint(r) });
    });
    return;
  }
  concludeAttempt(cur, ok, { typed: true, given, kind: given.trim() ? 'wrong' : 'blank' });
}

// ================================================================
// ★【0.03.18】重点モード：間違えた・足りなかった・答えられなかったら、ヒントを見て答え直す
//  1回目で正解 → 普通の正解
//  ヒントを1回見てから正解 → ヒントを見た正解（レベルは上がりにくい）
//  ヒントを2回以上見てから正解 → 正解にはせず、不正解寄りとして記録（不正解よりは軽い）
// ================================================================
const FOCUS_MAX_RETRY = 3; // 答え直せる回数（これを超えたら答えを表示）
let _focus = { attempts: 0 };
let _focusBusy = false;
function focusEnabled(cur) {
  const el = document.getElementById('chkFocusMode');
  // 2択の問題は、間違えたらもう片方が答えなので、答え直しはしない
  return !!(el && el.checked) && !window.currentOnlineMatch && ['desc', 'choice'].includes(currentRoundMode) && !(cur && cur.kind === 'self') && !isBinaryCard(cur);
}
function aiVerdictKind(r) {
  if (!r || !r.results) return 'wrong';
  return r.results.some(x => x.verdict === 'wrong') ? 'wrong' : r.results.some(x => x.verdict === 'partial') ? 'partial' : 'wrong';
}
// ★【0.03.22】AI が見つけた誤りの種類（スペルミス・品詞の誤り）
function aiIssueOf(r) { const x = r && r.results && r.results.find(y => !y.correct && (y.issue === 'spelling' || y.issue === 'pos')); return x ? x.issue : ''; }
const AI_ISSUE_LABEL = { spelling: '✏️ スペルミス・誤字', pos: '🏷️ 品詞の誤り' };
function aiFirstHint(r) { const x = r && r.results && r.results.find(y => !y.correct && y.hint); return x ? x.hint : ''; }

// 1回の解答の結果を決める（重点モードなら、間違いのときは答え直しへ）
function concludeAttempt(cur, ok, info) {
  const attempt = _focus.attempts + 1;
  if (!ok && focusEnabled(cur) && _focus.attempts < FOCUS_MAX_RETRY) { startFocusRetry(cur, info); return; }
  const fs = document.getElementById('lblFocusStatus'); if (fs) fs.style.display = 'none';
  // 普通のモードでも、AI が出した「答え直すためのヒント」は覚えておく
  if (!ok && info.hint && typeof rememberAiHint === 'function') rememberAiHint(cur, info.kind, info.given, info.hint);
  const opts = { typed: !!info.typed, given: info.given || '', ai: info.ai || null };
  if (!ok && info.partialFound && info.partialFound.length) return finishPartialMeanings(info.partialFound, attempt, opts);
  if (ok) {
    if (attempt === 1) return evaluateRoundAnswer(true, info.label || (info.ai && info.ai.results ? '🤖 正解（同じ意味）' : '🎉 正解！'), opts);
    if (attempt === 2) { quizHintState.aiUsed = true; return evaluateRoundAnswer(true, '🎯 ヒントのあとで正解', opts); }
    return evaluateRoundAnswer(false, `△ ヒント${attempt - 1}回のあとで正解（不正解寄りとして記録）`, Object.assign(opts, { softWrong: true, focusLate: true }));
  }
  const issue = aiIssueOf(info.ai);
  evaluateRoundAnswer(false, issue ? `❌ ${AI_ISSUE_LABEL[issue]}` + (attempt > 1 ? `（ヒント${attempt - 1}回）` : '') : info.kind === 'partial' ? '△ 解答不足' : (attempt > 1 ? `❌ 不正解（ヒント${attempt - 1}回）` : '❌ 不正解'), opts);
}

// ================================================================
// ★【0.03.21】意味をいくつも並べた答えの聞き直し
//  例：community → 地域社会、共同体。「地域社会」だけ答えたら ⭕ にして「ほかの意味は？」と聞き直す
//  全部答えられたら正解。答えられなかったら「一部正解」（ヒントを見た正解と同じ扱い。重点モードで答え直したあとなら不正解寄り）
// ================================================================
let _multi = null; // { key, meanings, found: [番号], aiGiven: [AI が一部の意味と認めた答え] }
function multiMeaningTarget(cur) {
  if (currentRoundMode !== 'desc' || window.currentOnlineMatch || !cur) return null;
  let text, inputId;
  if (currentStructuredAnswer) {
    if (currentStructuredAnswer.length !== 1) return null; // 欄が複数あるときは、欄ごとの採点のまま
    text = currentStructuredAnswer[0].text; inputId = 'structAns_0';
  } else { text = cur.answer; inputId = 'txtDescAnswer'; }
  const meanings = splitAnswerMeanings(text);
  return meanings.length >= 2 ? { key: text, meanings, inputId } : null;
}
// 聞き直しの処理をしたら true（いつもの採点はしない）
function handleMultiMeaning(cur) {
  const mt = multiMeaningTarget(cur);
  if (!mt) return false;
  if (!_multi || _multi.key !== mt.key) _multi = { key: mt.key, meanings: mt.meanings, found: [], aiGiven: [] };
  const input = document.getElementById(mt.inputId);
  const given = input ? input.value : '';
  const hit = matchAnswerMeanings(given, mt.meanings);
  if (hit && hit.length) {
    const before = _multi.found.length + _multi.aiGiven.length;
    const beforeFound = _multi.found.length;
    hit.forEach(i => { if (!_multi.found.includes(i)) _multi.found.push(i); });
    if (_multi.found.length + _multi.aiGiven.length >= mt.meanings.length) {
      concludeAttempt(cur, true, { typed: true, given: multiFoundNames().join('、'), label: before ? '🎉 全部の意味を正解！' : '🎉 正解！' });
      return true;
    }
    askOtherMeanings(cur, mt, _multi.found.length === beforeFound);
    return true;
  }
  if (!_multi.found.length && !_multi.aiGiven.length) return false; // 1つも当たっていない → いつもの採点（AI の判定を含む）
  // 聞き直しで、残りの意味に当たらなかった（空欄・違う答え）→ AI に、これまでの答えと合わせて全部の意味がそろったか確かめる
  const rest = _multi.aiGiven.length ? mt.meanings : mt.meanings.filter((m, i) => !_multi.found.includes(i));
  const miss = r => concludeAttempt(cur, false, { typed: true, given: multiFoundNames().join('、'), kind: 'partial', partialFound: multiFoundNames(), ai: r || null, hint: aiFirstHint(r), structuredWrong: currentStructuredAnswer ? [0] : undefined });
  if (given.trim() && aiJudgeEnabled()) {
    aiJudgeItems(cur, [{ label: '', expected: rest.join('、'), given: _multi.aiGiven.length ? multiFoundNames().concat(given).join('、') : given }]).then(r => {
      if (quizPool[quizIndex] !== cur || quizPhase === 'a' || !document.getElementById('pgQuizPlayer').classList.contains('active')) return;
      const x = r && r.results && r.results[0];
      if (x && x.correct) { _multi.found = mt.meanings.map((m, i) => i); concludeAttempt(cur, true, { typed: true, given: multiFoundNames().join('、'), ai: r, label: '🤖 全部の意味を正解！（同じ意味）' }); }
      else miss(r);
    });
    return true;
  }
  miss(null);
  return true;
}
function multiFoundNames() { return _multi ? _multi.found.map(i => _multi.meanings[i]).concat(_multi.aiGiven || []) : []; }
// AI が「意味の一部（解答不足）」と判定した言い換えの答えから、聞き直しを始める
//  AI が「正解」と判定しても、並べた意味の数より少ない言葉しか答えていなければ聞き直す（例：地域社会、共同体 に「コミュニティ」）
function startAiPartialReask(cur, given, aiSaidCorrect, r) {
  const mt = multiMeaningTarget(cur);
  if (!mt || !String(given || '').trim()) return false;
  if (aiSaidCorrect) {
    const parts = String(given).split(/[\s\u3000、,，・／/]+/).filter(p => normalizeStructuredToken(p) !== '');
    if (parts.length >= mt.meanings.length) return false;
  }
  _multi = { key: mt.key, meanings: mt.meanings, found: [], aiGiven: [String(given).trim()] };
  askOtherMeanings(cur, mt, false);
  const st = document.getElementById('lblFocusStatus');
  if (st) st.textContent = st.textContent.replace('⭕ ', aiSaidCorrect ? '⭕（🤖 同じ意味）' : '△（🤖 意味の一部）');
  return true;
}
function askOtherMeanings(cur, mt, again) {
  const left = Math.max(1, mt.meanings.length - _multi.found.length - _multi.aiGiven.length);
  const st = document.getElementById('lblFocusStatus');
  if (st) {
    st.style.display = 'block'; st.classList.add('multi');
    st.textContent = `⭕ ${multiFoundNames().join('、')}${again ? '（もう答えました）' : ''}　ほかの意味もあります。答えてください（あと${left}つ）`;
  }
  const timerText = document.getElementById('lblQuizTimerText'); if (timerText) timerText.innerText = '🔁';
  // 文字のヒントは、まだ答えていない意味のものにする
  const hs = quizHintState;
  if (hs && hs.stages && hs.stages.some(x => !x.memo && !x.ai) && currentRoundMode === 'desc') {
    const restText = mt.meanings.find((m, i) => !_multi.found.includes(i)) || '';
    const keep = hs.stages.filter(x => x.memo || x.ai);
    const shownKeep = Math.min(hs.shown, keep.length);
    hs.stages = keep.concat(letterHintStages(getPrimaryAnswer(restText).replace(/\([^()]*\)|（[^（）]*）/g, '').trim()));
    hs.shown = shownKeep; hs.aiUsed = hs.aiUsed || false;
    document.querySelectorAll('#lblQuizHint .hint-letter, [id^=structHint_]').forEach(el => { if (el.id) el.style.display = 'none'; else el.remove(); });
    const hb = document.getElementById('btnQuizHint'); if (hb && hs.shown < hs.stages.length) hb.style.display = '';
  }
  const input = document.getElementById(mt.inputId);
  if (input) { input.disabled = false; input.value = ''; input.style.borderColor = ''; input.style.background = ''; input.focus(); }
}
// 一部の意味だけ答えられたときの記録
function finishPartialMeanings(found, attempt, opts) {
  const names = found.join('、');
  if (attempt === 1) { quizHintState.aiUsed = true; return evaluateRoundAnswer(true, `△ 一部正解（${names}）`, opts); }
  return evaluateRoundAnswer(false, `△ 一部だけ正解（${names}）・不正解寄りとして記録`, Object.assign(opts, { softWrong: true, focusLate: true }));
}

async function startFocusRetry(cur, info) {
  _focus.attempts++;
  _focusBusy = true;
  const btn = document.getElementById('btnQuizAction');
  const prevText = btn ? btn.innerText : '';
  if (btn) { btn.disabled = true; btn.innerText = '🎯 ヒントを用意中...'; }
  const kind = info.kind || 'wrong', given = info.given || '';
  let hint = typeof recallAiHint === 'function' ? recallAiHint(cur, kind, given) : null; // 前に同じ状況で出したヒント
  if (!hint && info.hint) { hint = typeof maskAnswerInText === 'function' ? maskAnswerInText(info.hint, cur.answer) : info.hint; rememberAiHint(cur, kind, given, info.hint); }
  if (!hint && typeof aiAvailable === 'function' && aiAvailable() && navigator.onLine !== false) {
    try { hint = await aiRetryHint(cur, kind, given); if (hint) rememberAiHint(cur, kind, given, hint); } catch (e) { console.warn(e); }
  }
  _focusBusy = false;
  if (btn) { btn.disabled = false; btn.innerText = prevText || '確定する'; }
  if (quizPool[quizIndex] !== cur || quizPhase === 'a' || !document.getElementById('pgQuizPlayer').classList.contains('active')) return;
  const hb = document.getElementById('lblQuizHint');
  // 同じヒントがもう出ているときは、重ねて出さずに、いつものヒントを1段階進める
  const already = hint && [...hb.querySelectorAll('.hint-focus, .hint-ai')].some(el => el.textContent.replace(/^\S+\s/, '') === hint);
  if (hint && !already) {
    const line = document.createElement('div'); line.className = 'hint-focus'; line.textContent = `🎯 ${hint}`;
    hb.appendChild(line); hb.style.display = 'block';
  } else {
    // AI が使えないときは、いつものヒントを1段階（ヒントをオフにしていても、重点モードでは出す）
    if (!quizHintState.stages.length && !quizHintState.aiUsed) {
      const built = buildHintStages(cur, currentRoundMode, currentStructuredAnswer, false);
      quizHintState.stages = built.stages; quizHintState.shown = 0;
    }
    // 覚えたヒントの段階が、いま出したものと同じなら飛ばす
    const st = quizHintState, shownText = hb.innerText;
    while (st.shown < st.stages.length && st.stages[st.shown].ai && st.stages[st.shown].html.split('<br>').every(h => shownText.includes(h.replace(/^\S+\s/, '').replace(/&[a-z]+;/g, '')))) st.shown++;
    if (st.shown < st.stages.length) showNextHint();
  }
  const issue = aiIssueOf(info.ai);
  const label = issue === 'spelling' ? 'つづり・字が違います' : issue === 'pos' ? '品詞が違います' : ({ blank: '答えが空欄です', partial: '足りない部分があります', wrong: '違います' }[kind] || '違います');
  const st = document.getElementById('lblFocusStatus');
  if (st) { st.style.display = 'block'; st.classList.remove('multi'); st.textContent = `🔁 ${label}。ヒントを見て、もう一度答えてください（あと${FOCUS_MAX_RETRY - _focus.attempts + 1}回）`; }
  // 答え直せるようにする（制限時間は止めたまま）
  const timerText = document.getElementById('lblQuizTimerText'); if (timerText) timerText.innerText = '🎯';
  if (info.choice) {
    document.querySelectorAll('.choice-btn').forEach(b => {
      if (b._choiceText === given) { b.disabled = true; b.style.opacity = '0.45'; b.style.borderColor = 'var(--danger)'; }
      else if (!b.disabled) b.style.borderColor = 'var(--border)';
    });
    selectedChoiceIdx = null;
  } else if (currentStructuredAnswer) {
    (info.structuredWrong || []).forEach(i => { const input = document.getElementById('structAns_' + i); if (input) { input.disabled = false; input.value = ''; input.style.borderColor = ''; input.style.background = ''; } });
    const first = document.getElementById('structAns_' + ((info.structuredWrong || [])[0] || 0)); if (first) first.focus();
  } else {
    const inp = document.getElementById('txtDescAnswer'); if (inp) { inp.disabled = false; inp.value = ''; inp.focus(); }
  }
}

// ================================================================
// ★【0.03.15】AI：意味で採点・判定の取り消し・解説・ヒント
// ================================================================
let _aiJudging = false;
let _lastEval = null;    // 直前の採点の前の成績（「やっぱり不正解」「正解にする」で戻すため）
let _aiExplainHold = false;
function aiJudgeEnabled() {
  return typeof aiAvailable === 'function' && aiAvailable() && getAiPrefs().judge && !window.currentOnlineMatch && navigator.onLine !== false;
}
async function aiJudgeItems(cur, items) {
  _aiJudging = true;
  const btn = document.getElementById('btnQuizAction');
  const prevText = btn ? btn.innerText : '';
  if (btn) { btn.innerText = '🤖 AIが意味を確認中...'; btn.disabled = true; }
  const locked = [...document.querySelectorAll('#txtDescAnswer, #boxDescStructuredArea input')].filter(el => !el.disabled);
  locked.forEach(el => { el.disabled = true; });
  let r;
  try { r = await aiJudgeAnswers(cur.question, items, cur.note); }
  catch (e) { r = { error: e.message }; }
  _aiJudging = false;
  if (btn) { btn.disabled = false; btn.innerText = prevText; }
  document.querySelectorAll('#txtDescAnswer').forEach(el => { el.disabled = false; });
  return r;
}

// 採点をやり直す（AI の判定や、表記ちがいの答えを自分で直す）
function regradeLastAnswer(newCorrect) {
  if (quizPhase !== 'a' || !_lastEval) return;
  const m = db.find(q => q.id === _lastEval.id);
  if (m) { const st = Object.assign({}, _lastEval.stats); if (st.senses) st.senses = JSON.parse(JSON.stringify(st.senses)); else delete st.senses; Object.assign(m, st); }
  currentCombo = _lastEval.combo; todayCorrectCount = _lastEval.today;
  clearTimeout(autoNextTimeout);
  const prev = _lastEval;
  quizPhase = 'q';
  evaluateRoundAnswer(newCorrect, newCorrect ? '🙆 正解にしました' : '🙅 不正解にしました', { regrade: true, typed: prev.typed, given: prev.given, ai: prev.ai ? Object.assign({}, prev.ai, { overridden: true }) : null });
}

// 答えを見た後の AI の欄（理由・解説・覚え方と、採点の直しボタン）
function renderAiFeedbackBox(cur, isCorrect, opts) {
  let box = document.getElementById('aiFeedbackBox');
  if (!box) {
    box = document.createElement('div'); box.id = 'aiFeedbackBox'; box.className = 'ai-feedback';
    document.getElementById('feedbackAnswerText').insertAdjacentElement('afterend', box);
  }
  _aiExplainHold = false;
  const ai = opts.ai || null;
  const parts = [];
  if (ai && ai.results && ai.results.length) {
    const reasons = ai.results.map(r => r.reason).filter(Boolean);
    if (reasons.length) parts.push(`<div>🤖 ${escapeHtml(reasons.join(' ／ '))}</div>`);
  } else if (ai && ai.error) parts.push(`<div class="ai-muted">🤖 AI の判定は使えませんでした（${escapeHtml(ai.error)}）</div>`);
  if (!isCorrect && ai && ai.tip) { parts.push(`<div>💡 ${escapeHtml(ai.tip)}</div>`); _aiExplainHold = true; }
  // ★【0.03.18】足りない・違うときの手がかり（次に同じ問題で迷ったときにも出す）
  const aiHint = !isCorrect && typeof aiFirstHint === 'function' ? aiFirstHint(ai) : '';
  if (aiHint) parts.push(`<div>🎯 ${escapeHtml(maskAnswerInText(aiHint, cur.answer))}</div>`);
  const btns = [];
  if (isCorrect && ai && ai.results && !ai.overridden) btns.push(`<button type="button" class="chip" onclick="regradeLastAnswer(false)">🙅 やっぱり不正解</button>`);
  if (!isCorrect && opts.typed && !opts.focusLate && String(opts.given || '').trim()) btns.push(`<button type="button" class="chip" onclick="regradeLastAnswer(true)">🙆 合っているので正解にする</button>`);
  const canExplain = !isCorrect && !opts.pass && typeof aiAvailable === 'function' && aiAvailable() && getAiPrefs().hint && !window.currentOnlineMatch && !(ai && ai.tip);
  if (canExplain) btns.push(`<button type="button" class="chip" id="btnAiExplain" onclick="showAiExplanation()">🤖 AIの解説</button>`);
  box.innerHTML = parts.join('') + (btns.length ? `<div class="ai-btns">${btns.join('')}</div>` : '') + '<div id="aiExplainArea"></div>';
  box.style.display = (parts.length || btns.length) ? 'block' : 'none';
  if (canExplain && getAiPrefs().explainAuto) showAiExplanation();
}
async function showAiExplanation() {
  const cur = quizPool[quizIndex]; if (!cur) return;
  const area = document.getElementById('aiExplainArea'); if (!area) return;
  const btn = document.getElementById('btnAiExplain'); if (btn) btn.remove();
  _aiExplainHold = true; // 読み終わるまで自動で次へ進まない
  area.innerHTML = '<div class="ai-muted">🤖 解説を考えています...</div>';
  try {
    const given = _lastEval && _lastEval.given;
    const r = await aiExplainMistake({ question: cur.question + (cur._senseLabel ? `（${cur._senseLabel}）` : ''), answer: cur.answer, note: cur.note }, given);
    // ★【0.03.18】次に同じ問題で迷ったときのヒントとして覚えておく
    if (r.hint && typeof rememberAiHint === 'function') rememberAiHint(cur, String(given || '').trim() ? 'wrong' : 'blank', given, r.hint);
    if (quizPool[quizIndex] !== cur) return;
    area.innerHTML = (r.explain ? `<div>🤖 ${escapeHtml(r.explain)}</div>` : '') + (r.tip ? `<div>💡 ${escapeHtml(r.tip)}</div>` : '');
  } catch (e) { area.innerHTML = `<div class="ai-muted">⚠️ ${escapeHtml(e.message)}</div>`; }
}
// 解いている途中の AI ヒント
async function showAiHint() {
  const cur = quizPool[quizIndex]; if (!cur || quizPhase !== 'q') return;
  const btn = document.getElementById('btnQuizAiHint');
  if (btn) { btn.disabled = true; btn.innerText = '🤖 考え中...'; }
  try {
    let h = typeof recallAiHint === 'function' ? recallAiHint(cur, 'hint', '') : null;
    if (!h) { h = await aiHintFor({ id: (cur._swapped ? 'swap:' : '') + (cur._sourceId || cur.id) + (cur._senseLabel ? ':' + cur._senseLabel : ''), question: cur.question + (cur._senseLabel ? `（${cur._senseLabel}）` : ''), answer: getPrimaryAnswer(cur.answer), note: cur.note }); rememberAiHint(cur, 'hint', '', h); }
    if (quizPool[quizIndex] !== cur || quizPhase !== 'q') return;
    quizHintState.aiUsed = true; // ヒントを見たのでレベルは上がりにくくなる
    const hb = document.getElementById('lblQuizHint');
    const line = document.createElement('div'); line.className = 'hint-ai'; line.textContent = '🤖 ' + h;
    hb.appendChild(line); hb.style.display = 'block';
    if (btn) btn.style.display = 'none';
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerText = '🤖 AIヒント'; }
    alert('⚠️ ' + e.message);
  }
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

// ★【0.03.24】1回の結果でカード（または意味）の成績・レベルを動かす（クイズと暗記テストで共通）
// o: { multiplier, gain, loss, regrade, keepStreak, noCategory }。レベルが変わったら { type, level } を返す
function applySrsResult(m, senseKey, isCorrect, o = {}) {
  let levelChange = null;
  const t = senseKey ? m.senses[senseKey] : m; // 成績を動かす相手
  if(t.wrongStreak === undefined) t.wrongStreak = 0; if(t.shikkariStreak === undefined) t.shikkariStreak = 0;
  const multiplier = o.multiplier || 1;
  // ★【0.03.03】設定の「卒業認定正解数」に比例して、レベルの上がり下がりの回数も変わる
  const P = srsParams();
  const gain = o.gain === undefined ? 1 : o.gain, loss = o.loss === undefined ? 1 : o.loss, regrade = !!o.regrade;
  if(t.level5Correct === undefined) t.level5Correct = 0;
  const isGrad = isGraduated(t);
  const beforeLevel = t.level;

  if(isCorrect) {
    t.correct++; if (!regrade && !o.noCategory) recordCategoryScore(m.category, true);
    if (o.keepStreak) t.wrongStreak = 0;
    else { t.streak = roundStat((t.streak || 0) + gain); t.wrongStreak = 0; }
    
    if (t.level === -1) {
      t.shikkariStreak = roundStat(t.shikkariStreak + gain);
      if (t.shikkariStreak >= P.recoverAt * multiplier) { t.level = 0; t.shikkariStreak = 0; t.streak = 0; }
    } else if (isGrad) {
      // 卒業済み：何もしない
    } else if (t.level >= 5) {
      // レベル5で未卒業：正解を積む
      t.level5Correct = roundStat(t.level5Correct + gain);
      if (isGraduated(t)) levelChange = { type: 'grad' };
    } else {
      if (t.streak >= P.upStreak * multiplier - 1e-9 && t.level < 5) {
        t.level++;
        if (t.level === 5) t.level5Correct = 0;
        t.streak = 0;
      }
    }
  } else {
    t.incorrect++; t.streak = 0; t.shikkariStreak = 0;
    const prevWrong = t.wrongStreak || 0;
    t.wrongStreak = roundStat(prevWrong + loss);
    if (!regrade && !o.noCategory) recordCategoryScore(m.category, false);
    const crossed = (every) => Math.floor(t.wrongStreak / every + 1e-9) > Math.floor(prevWrong / every + 1e-9);

    if (isGrad) {
      // 卒業済みで不正解：続けて間違えると卒業取り消し（レベル5に留まる）
      if (t.wrongStreak >= P.ungradAt * multiplier - 1e-9) { t.level5Correct = 0; t.wrongStreak = 0; levelChange = { type: 'ungrad' }; }
    } else if (t.level >= 5) {
      // レベル5・未卒業で不正解：続けて間違えるとレベル4に下がる
      if (t.wrongStreak >= P.level5Down * multiplier - 1e-9) { t.level = 4; t.level5Correct = 0; t.wrongStreak = 0; }
    } else {
      if (t.level !== -1) {
        if (t.wrongStreak >= P.shikkariAt * multiplier - 1e-9) { t.level = -1; t.wrongStreak = 0; t.correct = 0; } 
        else if (crossed(P.downEvery * multiplier) && t.level > 0) t.level--;
      }
    }
  }
  if (!levelChange && t.level !== beforeLevel) levelChange = { type: t.level > beforeLevel ? 'up' : 'down', level: t.level };
  if (senseKey) recomputeCardFromSenses(m);
  touchStats(m);
  saveData();
  return levelChange;
}

function evaluateRoundAnswer(isCorrect, head, opts = {}) {
  if (quizPhase === 'a') return; // 二重呼び出し防止
  quizPhase = 'a'; const cur = quizPool[quizIndex];
  const isPass = !!opts.pass; // ★【0.03.03】パスは不正解として記録しない（答えを見るだけ）
  const regrade = !!opts.regrade; // ★【0.03.15】採点のやり直し（記録は数え直さない）
  if (!isPass && !regrade) recordQuizOrderProgress(cur);
  const prevCombo = currentCombo, prevToday = todayCorrectCount;
  if (regrade) recordDailyLogAdjust(isCorrect ? 1 : -1);
  
  if (isPass) {
    // 成績・コンボ・連続記録はそのまま
  } else if(isCorrect) {
    currentCombo++; todayCorrectCount++; showComboAnim(); if (!regrade) recordDailyLog(true);
    // ★ オンライン対戦なら自分のスコアをFirebaseに送信（即時反映）
    if (window.currentOnlineMatch) {
      firestore.collection('susuru_anki_match_rooms').doc(window.currentOnlineMatch.roomId)
        .update({ [window.currentOnlineMatch.myRole + '.score']: firebase.firestore.FieldValue.increment(1) })
        .catch(e => console.warn("スコア送信エラー:", e));
    }
  } else {
    currentCombo = 0; if (!regrade) recordDailyLog(false);
  }

  // ローカル学習記録の更新 (自分が持っている問題の場合のみ)
  let m = isPass ? null : db.find(q => q.id === cur.id);
  let levelChange = null; // ★【0.03.08】LEVEL UP!/level down… の表示用
  // ★【0.03.17】意味ごとの問題なら、その意味の成績を動かす（カード全体の成績はあとで意味ごとの成績から決め直す）
  const senseKey = (m && cur._senseKey && ensureSenseStats(m) && m.senses[cur._senseKey]) ? cur._senseKey : null;
  if (!isPass) {
    const snap = {}; if (m) { CARD_STAT_FIELDS.forEach(f => { snap[f] = f === 'senses' ? (m.senses ? JSON.parse(JSON.stringify(m.senses)) : undefined) : m[f]; }); snap.statsAt = m.statsAt; }
    _lastEval = { id: m ? m.id : null, stats: snap, combo: prevCombo, today: prevToday, correct: isCorrect, typed: !!opts.typed, given: opts.given || '', ai: opts.ai || null };
  }
  // ★【0.03.37】この問題のレベル・ランクの変化を記録する（クイズの結果の画面）
  const _tb = m ? (senseKey ? m.senses[senseKey] : m) : null;
  const _before = _tb ? { level: _tb.level, status: srsStatusOf(_tb) } : null;
  if(m) {
    const mode = currentRoundMode;
    // ★【0.03.08】難易度とヒントで1回の重みを変える（対戦中は難易度どおり・ヒントなし）
    const W = srsSpeedWeights(window.currentOnlineMatch ? 'normal' : document.getElementById('selQuizSpeed').value);
    const hs = quizHintState || { stages: [], shown: 0 };
    const memoShown = hs.shown > 0 && hs.stages[0] && hs.stages[0].memo;
    const letterStages = Math.max(0, hs.shown - (hs.stages[0] && hs.stages[0].memo ? 1 : 0)) + (hs.aiUsed ? 1 : 0);
    levelChange = applySrsResult(m, senseKey, isCorrect, {
      multiplier: (mode === 'choice' || mode === 'tap' || mode === 'minhaya') ? 2 : 1,
      gain: W.up * srsHintFactor(memoShown, letterStages),
      loss: W.down * (opts.softWrong ? 0.5 : 1), // ★【0.03.18】重点モードでヒント2回以上のあとの正解は、不正解より軽く
      regrade, keepStreak: mode === 'self' && window.currentSelfJudge === 'good'
    });
    if (levelChange && senseKey) levelChange.label = cur._senseLabel;
  }
  recordQuizSessionResult(cur, isCorrect, isPass, regrade, m, senseKey, _before);
  if (levelChange) showLevelAnim(levelChange);
  const _hintBtn = document.getElementById('btnQuizHint'); if (_hintBtn) _hintBtn.style.display = 'none';
  const _aiHintBtn = document.getElementById('btnQuizAiHint'); if (_aiHintBtn) _aiHintBtn.style.display = 'none';
  
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
  renderAiFeedbackBox(cur, isCorrect, opts); // ★【0.03.15】AI の理由・解説と、採点の直しボタン
  if (!regrade) speakText(getPrimaryAnswer(cur.answer));
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
    let advanceDelay = currentStructuredAnswer ? Math.min(baseDelay + 12000, baseDelay + currentStructuredAnswer.length * 2000) : baseDelay;
    if (opts.ai && opts.ai.results) advanceDelay += 4000; // AI の判定理由を読んで、直せる時間を取る
    // ★【0.03.02】クイックメモを入力中は自動で次へ進まない（入力が終わるまで待つ）
    const scheduleAdvance = (delay) => {
      autoNextTimeout = setTimeout(() => {
        if (quizPhase !== 'a') return;
        const ae = document.activeElement;
        if (ae && ae.id === 'txtQuickNote') { scheduleAdvance(1500); return; }
        if (_aiExplainHold) return; // ★【0.03.15】AI の解説を読んでいる間は自動で進まない（「次の問題へ」で進む）
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
  el.innerText = ch.label ? `${txt}\n${ch.label}` : txt; // 意味ごとの問題なら、どの意味かも el.className = 'level-display ' + cls;
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

// ★【0.03.15】採点をやり直したとき、今日の正解数を1つ増減する
async function recordDailyLogAdjust(delta) {
  if (!currentUser || !delta) return;
  const d = getTodayStr();
  try {
    await firestore.collection('susuru_anki_logs').doc(`${d}_${currentUser.uid}`).set({ correct: firebase.firestore.FieldValue.increment(delta) }, { merge: true });
    await firestore.collection('susuru_anki_daily_scores').doc(`${d}_${currentUser.uid}`).set({ score: firebase.firestore.FieldValue.increment(delta) }, { merge: true });
  } catch (e) {}
}
// ★【0.03.39】opts.drill：暗記テストの答え（ランキングの正解数は暗記テストの分を別に数える：drillScore）
async function recordDailyLog(isCorrect, opts = {}) {
  if (typeof notifyMarkStudied === 'function') notifyMarkStudied(); // ★【0.03.14】今日は学習済み（催促しない）
  if (typeof markStudyDay === 'function') markStudyDay(); // ★【0.03.62】連続記録
  if(!currentUser) return;
  const d = getTodayStr(); 
  const inc = firebase.firestore.FieldValue.increment;
  const lRef = firestore.collection('susuru_anki_logs').doc(`${d}_${currentUser.uid}`);
  const sRef = firestore.collection('susuru_anki_daily_scores').doc(`${d}_${currentUser.uid}`);
  try {
    if (opts.drill) {
      await lRef.set({ date:d, uid:currentUser.uid, name:currentUser.displayName, answered:inc(1), correct:inc(isCorrect?1:0), drillAnswered:inc(1), drillCorrect:inc(isCorrect?1:0) }, {merge:true});
      await sRef.set({ date:d, uid:currentUser.uid, name:currentUser.displayName, drillScore:inc(isCorrect?1:0), drillTotal:inc(1) }, {merge:true});
      return;
    }
    await lRef.set({ date:d, uid:currentUser.uid, name:currentUser.displayName, answered:inc(1), correct:inc(isCorrect?1:0) }, {merge:true});
    if(isCorrect) await sRef.set({ date:d, uid:currentUser.uid, name:currentUser.displayName, score:inc(1) }, {merge:true});
  } catch(e){}
}

// ★【0.03.02】文字タップモード：入力欄をタップすると最後の1文字を取り消す（以前は関数が無くエラーになっていた）
function removeLastTap() {
  if (quizPhase !== 'q' || currentTapInput.length === 0) return;
  if (Date.now() - (window._tapDraggedAt || 0) < 500) return;
  const removed = currentTapInput.pop();
  const btn = document.getElementById(removed.id);
  if (btn) btn.style.display = 'inline-flex';
  renderTapInput();
}
