// ----------------- クイズ機能 -----------------

// ----------------- ネイティブ発音対応 TTSエンジン -----------------
function isEnglishText(text) {
  if (!text) return false;
  const cleanText = text.trim();
  // 英語のアルファベットや一般的な記号だけで構成されているか（日本語が含まれていないか）
  return /^[A-Za-z0-9\s,.:;?!"'\-()]+$/.test(cleanText);
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

function speakText(text, options = {}) {
  if (!('speechSynthesis' in window) || localStorage.getItem('muteTTS') === 'true') return;
  window.speechSynthesis.cancel();
  if (!text || text.trim() === "") return;

  const div = document.createElement('div');
  div.innerHTML = text;
  const plainText = div.textContent || div.innerText || "";

  const utterance = new SpeechSynthesisUtterance(plainText);
  utterance.rate = options.rate || 1.0;
  utterance.pitch = options.pitch || 1.0;
  utterance.volume = options.volume || 1.0;

  if (isEnglishText(plainText)) {
    const enVoice = getBestVoice('en');
    if (enVoice) { utterance.voice = enVoice; utterance.lang = enVoice.lang; }
    else { utterance.lang = 'en-US'; }
  } else {
    const jaVoice = getBestVoice('ja');
    if (jaVoice) { utterance.voice = jaVoice; utterance.lang = jaVoice.lang; }
    else { utterance.lang = 'ja-JP'; }
  }
  
  utterance.onerror = (e) => console.error("TTSエラー:", e);
  window.speechSynthesis.speak(utterance);
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

function buildQuizScopeDropdown() {
  const container = document.getElementById('scopeSelectors'); if(!container) return;
  loadScopePath();
  container.innerHTML = ''; createScopeSelect(0, getTopLevelCategories());
  // 保存されたパスを選択状態に復元
  if (selectedScopePath.length > 0) {
    const selects = container.querySelectorAll('select');
    if (selectedScopePath[0] === 'all' && selects[0]) { selects[0].value = 'all'; }
    else {
      selectedScopePath.forEach((val, depth) => {
        const sel = container.querySelectorAll('select')[depth];
        if (sel) {
          sel.value = val;
          const children = categoryTree[val] || [];
          if (children.length > 0 && depth === selectedScopePath.length - 1) createScopeSelect(depth + 1, children);
        }
      });
    }
  }
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
    const children = categoryTree[val] || []; if (children.length > 0) createScopeSelect(depth + 1, children);
  };
  document.getElementById('scopeSelectors').appendChild(select);
}

// ★【0.02.63】このラウンドの構造化解答（品詞タグ付き複数解答）。null なら通常の単一解答。
let currentStructuredAnswer = null;

function normalizeAnswer(str) {
  if(!str) return '';
  let s = String(str).replace(/[Ａ-Ｚａ-ｚ０-９]/g, c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).toLowerCase().trim();
  s = s.replace(/擦/g, 'こす');
  s = s.replace(/[、，＼＼ \u3000]+/g, ',');
  return s.split(',').map(x=>x.trim()).filter(x=>x!=='').sort().join(',');
}
function isAnswerCorrect(input, correctAnswer) {
  const norms = correctAnswer.split(/[/|]/).map(a => normalizeAnswer(a));
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
  else if (modeType === 'review') subset = subset.filter(q => q.level >= 5 && (q.level5Correct || 0) >= 5);
  else if (!includeGrad) subset = subset.filter(q => !(q.level >= 5 && (q.level5Correct || 0) >= 5));

  if(scope.startsWith('cat:')) {
    const cName = scope.replace('cat:', '');
    const targets = getAllSubcategories(cName);
    subset = subset.filter(q => targets.includes(q.category));
  }

  // ★ オンライン対戦時はホスト（player1）が問題を生成して相手に共有する
  if (window.currentOnlineMatch) {
      if (window.currentOnlineMatch.myRole === 'player1') {
          if(subset.length === 0) { alert("⚠️ 問題が見つかりません。"); return; }
          for (let i = subset.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [subset[i], subset[j]] = [subset[j], subset[i]]; }
          quizPool = subset.slice(0, limitCount);
          if (document.getElementById('chkSwapQA').checked) quizPool = quizPool.map(q => ({ ...q, question: q.answer, answer: q.question, questionImage: q.answerImage, answerImage: q.questionImage }));
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
  const prioritize = (q) => {
    if (q.level === 0 && (q.correct > 0 || q.incorrect > 0)) return 1;
    if (q.level === -1) return 2;
    if (q.correct === 0 && q.incorrect === 0) return 3;
    return 4;
  };

  for (let i = subset.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [subset[i], subset[j]] = [subset[j], subset[i]]; }
  subset.sort((a, b) => prioritize(a) - prioritize(b));
  quizPool = subset.slice(0, limitCount); quizIndex = 0;

  if (document.getElementById('chkSwapQA').checked) quizPool = quizPool.map(q => ({ ...q, question: q.answer, answer: q.question, questionImage: q.answerImage, answerImage: q.questionImage }));
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
    qEl.innerHTML = qDisplay;
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
    if (typeof renderMathInElement === 'function') {
      renderMathInElement(qEl, {
        delimiters: [
          {left: '$$', right: '$$', display: true},
          {left: '$', right: '$', display: false}
        ]
      });
    }
  document.getElementById('quizFeedback').style.display = 'none';
  document.getElementById('txtQuickNote').value = cur.note || '';

  if(document.getElementById('chkTTS').checked) {
    speakText(qSpeech);
  }

  const mode = document.getElementById('selQuizMode').value;
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
    if(speed==='easy') base=25; else if(speed==='hard') base=10; else if(speed==='expert') base=5;
    if(cur.answer.length > 5) base += Math.min(15, (cur.answer.length - 5) * 1.5);
    if(document.getElementById('chkTimeAttack').checked) base *= 0.5;
  }

  // ★【0.02.65】記述式モードで構造化解答の場合、欄の数だけ制限時間を倍にする（実際のカウントダウンにも反映されるようbaseそのものを変更する）
  if (mode === 'desc' && aStructured) {
    base *= aStructured.length;
  }
  quizTimeLimit = base; quizTimeLeft = base;
  stopQuizTimer(); updateTimerUI();
  
  let hintShown = false; document.getElementById('lblQuizHint').style.display = 'none';
  const speed = document.getElementById('selQuizSpeed').value;
  const _timerStart = Date.now();
  const _timerBase = base;
  quizTimer = setInterval(() => {
    quizTimeLeft = Math.max(0, _timerBase - (Date.now() - _timerStart) / 1000);
    updateTimerUI();
    if (quizTimeLeft <= 0) {
      stopQuizTimer();
      evaluateRoundAnswer(false, "⏰ 時間切れ");
      return;
    }
    if (speed !== 'expert' && !hintShown && quizTimeLeft < (quizTimeLimit * (speed === 'easy' ? 0.7 : 0.4))) {
      hintShown = true;
      // ★【0.02.65】記述式モードで解答欄が複数に分かれている場合、欄ごとに1文字目のヒントを出す
      if (mode === 'desc' && aStructured) {
        aStructured.forEach((seg, i) => {
          const hb = document.getElementById('structHint_' + i);
          if (hb) { hb.innerHTML = `先頭:「${escapeHtml(seg.text.charAt(0))}」`; hb.style.display = 'inline'; }
        });
      } else {
        const hb = document.getElementById('lblQuizHint');
        const ans1 = getPrimaryAnswer(cur.answer);
        hb.innerText = `ヒント: 先頭は「 ${ans1.charAt(0)} 」 ${ans1.length>3?`(全 ${ans1.length} 文字)`:''}`;
        hb.style.display = 'inline-block';
      }
    }
  }, 100);
}

function updateTimerUI() {
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
  const first = ans.split(/[/|]/)[0].trim();
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
      label.innerHTML = `🏷️ ${seg.label || ('解答 ' + (i + 1))}`;
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

function buildFourChoices(cur) {
  const area = document.getElementById('boxChoiceArea'); area.innerHTML = '';
  const correctPrimary = getPrimaryAnswer(cur.answer);
  
  let altCandidates = [];
  // ★【0.02.65】センス分割された仮想エントリーの場合、元カード(_sourceId)自身は候補から除外する
  const catAnswers = db.filter(q => q.category === cur.category && q.id !== cur._sourceId && getPrimaryAnswer(q.answer) !== correctPrimary).map(q => getPrimaryAnswer(q.answer));
  altCandidates = [...new Set(catAnswers)];
  if(altCandidates.length < 3) {
    const globalAnswers = db.filter(q => q.id !== cur._sourceId && getPrimaryAnswer(q.answer) !== correctPrimary).map(q => getPrimaryAnswer(q.answer));
    altCandidates = [...new Set([...altCandidates, ...globalAnswers])];
  }
  altCandidates.sort(() => Math.random() - 0.5);
  let finalFour = [correctPrimary, ...altCandidates.slice(0, 3)];
  while (finalFour.length < 4) finalFour.push(`選択肢_${Math.floor(Math.random()*1000)}`);
  finalFour.sort(() => Math.random() - 0.5);

  finalFour.forEach((text, i) => {
    const btn = document.createElement('button'); btn.className = 'choice-btn';
    btn.innerHTML = `<div class="choice-idx">${i+1}</div><div style="flex:1;">${escapeHtml(text)}</div>`;
    btn.onclick = () => {
      if(quizPhase !== 'q') return;
      document.querySelectorAll('.choice-btn').forEach(b => b.style.borderColor = 'var(--border)');
      btn.style.borderColor = 'var(--primary)'; selectedChoiceIdx = text;
    };
    area.appendChild(btn);
  });
}

let minhayaTarget = ""; let minhayaPos = 0;
function buildMinhayaMode(cur) {
  minhayaTarget = getPrimaryAnswer(cur.answer); minhayaPos = 0; renderMinhayaDisplay(cur);
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
    slot.innerText = filled ? minhayaTarget[i] : (current ? '?' : '＿');
    slotsDiv.appendChild(slot);
  }
  area.appendChild(slotsDiv);
  if (minhayaPos >= minhayaTarget.length) return;

  // ★ みんはや重複防止の完全版
  const correctChar = minhayaTarget[minhayaPos];
  let distChars = [];
  const targetChars = minhayaTarget.split('');
  
  db.forEach(q => getPrimaryAnswer(q.answer).split('').forEach(c => { 
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
        minhayaPos++;
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
  let allChars = db.map(q => getPrimaryAnswer(q.answer)).join('').replace(/[、，／/ \u3000,\da-zA-Z|]/g, '').split('');
  if(allChars.length===0) allChars='あいうえおかきくけこ'.split('');
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
    else { saEl.innerHTML = `A: ${getPrimaryAnswer(_cur.answer)}`; }
    if (_cur.answerImage) {
      const aImg = document.createElement('img');
      aImg.src = _cur.answerImage; aImg.alt = '解答画像';
      aImg.style.cssText = 'max-width:100%; height:auto; border-radius:8px; margin-top:10px; display:block;';
      saEl.appendChild(aImg);
    }
    if (typeof renderMathInElement === 'function') {
      renderMathInElement(saEl, { delimiters: [{left: '$$', right: '$$', display: true}, {left: '$', right: '$', display: false}] });
    }
    speakText(getPrimaryAnswer(_cur.answer));
  document.getElementById('selfJudgeArea').style.display = 'block';
}
function submitSelfMode(judge) {
  window.currentSelfJudge = judge;
  evaluateRoundAnswer(judge !== 'miss', judge === 'perfect' ? "🎉 完璧！" : judge === 'good' ? "👍 普通" : "❌ ミス");
}

function passQuizQuestion() {
  stopQuizTimer();
  evaluateRoundAnswer(false, "🏳️ パスしました");
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
  const mode = document.getElementById('selQuizMode').value;
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

function evaluateRoundAnswer(isCorrect, head) {
  if (quizPhase === 'a') return; // 二重呼び出し防止
  quizPhase = 'a'; const cur = quizPool[quizIndex];
  
  if(isCorrect) {
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
  let m = db.find(q => q.id === cur.id);
  if(m) {
    if(m.wrongStreak === undefined) m.wrongStreak = 0; if(m.shikkariStreak === undefined) m.shikkariStreak = 0;
    const mode = document.getElementById('selQuizMode').value;
    const multiplier = (mode === 'choice' || mode === 'tap' || mode === 'minhaya') ? 2 : 1; 
    const th = currentQuestionGradThreshold;

    if(m.level5Correct === undefined) m.level5Correct = 0;
    const isGraduated = m.level >= 5 && m.level5Correct >= 5;

    if(isCorrect) {
      m.correct++; recordCategoryScore(m.category, true);
      if (mode === 'self' && window.currentSelfJudge === 'good') m.wrongStreak = 0;
      else { m.streak++; m.wrongStreak = 0; }
      
      if (m.level === -1) {
        m.shikkariStreak++;
        if (m.shikkariStreak >= 5 * multiplier) { m.level = 0; m.shikkariStreak = 0; m.streak = 0; }
      } else if (isGraduated) {
        // 卒業済み：何もしない
      } else if (m.level >= 5) {
        // レベル5で未卒業：正解を積む
        m.level5Correct++;
      } else {
        if (m.streak >= 2 * multiplier && m.level < 5) {
          m.level++;
          if (m.level === 5) m.level5Correct = 0;
          m.streak = 0;
        }
      }
    } else {
      m.incorrect++; m.wrongStreak++; m.streak = 0; m.shikkariStreak = 0;
      recordCategoryScore(m.category, false);

      if (isGraduated) {
        // 卒業済みで不正解：5回で卒業取り消し（レベル5に留まる）
        if (m.wrongStreak >= 5 * multiplier) { m.level5Correct = 0; m.wrongStreak = 0; }
      } else if (m.level >= 5) {
        // レベル5・未卒業で不正解：2回でレベル4に下がる
        if (m.wrongStreak >= 2 * multiplier) { m.level = 4; m.level5Correct = 0; m.wrongStreak = 0; }
      } else {
        if (m.level !== -1) {
          if (m.wrongStreak >= 4 * multiplier) { m.level = -1; m.wrongStreak = 0; m.correct = 0; } 
          else if (m.wrongStreak > 0 && m.wrongStreak % (2 * multiplier) === 0 && m.level > 0) m.level--;
        }
      }
    }
    saveData();
  }
  
  const fb = document.getElementById('quizFeedback');
  document.getElementById('feedbackResultText').innerText = head;
  const fbAnsEl = document.getElementById('feedbackAnswerText');
  if (currentStructuredAnswer) {
    fbAnsEl.innerHTML = `<div style="font-weight:700; margin-bottom:6px;">正解:</div>` + formatStructuredAnswerHTML(currentStructuredAnswer);
  } else {
    const senseLabelPrefix = cur._senseLabel ? `<span style="color:var(--primary); font-weight:700;">[${cur._senseLabel}]</span> ` : '';
    fbAnsEl.innerHTML = `正解: ${senseLabelPrefix}${getPrimaryAnswer(cur.answer)}`;
  }
  if (cur.answerImage) {
    const aImg = document.createElement('img');
    aImg.src = cur.answerImage; aImg.alt = '解答画像';
    aImg.style.cssText = 'max-width:100%; height:auto; border-radius:8px; margin-top:10px; display:block;';
    fbAnsEl.appendChild(aImg);
  }
  if (typeof renderMathInElement === 'function') {
    renderMathInElement(fbAnsEl, { delimiters: [{left: '$$', right: '$$', display: true}, {left: '$', right: '$', display: false}] });
  }
  speakText(getPrimaryAnswer(cur.answer));
  fb.className = `feedback-area ${isCorrect ? 'correct':'incorrect'}`; fb.style.display = 'flex';
  
  document.getElementById('btnQuizPass').style.display = 'none';
  document.getElementById('btnQuizAction').style.display = 'inline-flex';
  document.getElementById('btnQuizAction').innerText = '次の問題へ';

  // ★ 答えを表示後、3秒経過で自動的に次の問題へ進む (全モード対応)
  // iOS Safari対応: Date.now()ベースで3秒を計測
  const mode = document.getElementById('selQuizMode').value;
  if (['choice', 'tap', 'self', 'minhaya', 'desc'].includes(mode)) {
    clearTimeout(autoNextTimeout);
    // ★【0.02.63】構造化解答は読む量が多いので、センス数に応じて自動送りまでの時間を延長する
    const advanceDelay = currentStructuredAnswer ? Math.min(15000, 3000 + currentStructuredAnswer.length * 2000) : 3000;
    autoNextTimeout = setTimeout(() => {
      if (quizPhase === 'a') submitQuizAction();
    }, advanceDelay);
  }
}

function showComboAnim() {
  if(currentCombo < 2) return;
  const cd = document.getElementById('comboDisplay'); cd.innerText = `${currentCombo} COMBO!`;
  cd.classList.remove('pop'); void cd.offsetWidth; cd.classList.add('pop');
}

function saveQuickNote(val) {
  const m = db.find(q=>q.id === quizPool[quizIndex].id); if(m) { m.note = val; saveData(); }
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
