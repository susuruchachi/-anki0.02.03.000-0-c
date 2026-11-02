// ================================================================
// ★【0.03.57】🎧 聞き流しモード
// 選んだ出題範囲のカードを、問題 →（少し間）→ 答え（→ 解説）の順に読み上げ続ける。
//  ・選択肢つきの問題：問題 → 選択肢 →（間）→ 答えだけ
//  ・例文・空欄補充の問題：空欄に答えを入れた文と訳を、そのまま流す（間をあけない）
//  ・導入の文は読まない。設定（解説・間・順番・速さ・くり返し）はこの端末に保存
//  ・画面を消さない（Wake Lock）。ロック画面・イヤホンの再生／一時停止／次へにも対応（Media Session）
// ================================================================
const LISTEN_PREFS_KEY = 'susuru_anki_listen_prefs';
let _ls = null; // { list, i, playing, token, phase }
function listenPrefs() {
  let p = {}; try { p = JSON.parse(localStorage.getItem(LISTEN_PREFS_KEY) || '{}') || {}; } catch (e) {}
  return Object.assign({ note: false, gap: 2, order: 'number', rate: 1, loop: false, grad: true }, p);
}
function listenSavePrefs(p) { try { localStorage.setItem(LISTEN_PREFS_KEY, JSON.stringify(p)); } catch (e) {} }
function listenScopeCat() { return selectedScopePath.length && selectedScopePath[0] !== 'all' ? selectedScopePath[selectedScopePath.length - 1] : ''; }

// 出題範囲のカード（クイズと同じ：「上から出題しない」フォルダー・教科の絞り込み）
function listenCards() {
  const p = listenPrefs(), cat = listenScopeCat();
  let list = db.filter(q => q.kind !== 'intro');
  if (cat) { const set = new Set(getQuizSubcategories(cat)); list = list.filter(q => set.has(q.category)); }
  const sb = typeof getScopeSubject === 'function' ? getScopeSubject() : '';
  if (sb) list = list.filter(q => getCategorySubject(q.category) === sb);
  if (!p.grad) list = list.filter(q => !isGraduated(q));
  list = sortCardsByNumber(list.slice());
  if (p.order === 'random') list = list.map(x => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  return list;
}

// ---------------- 読み上げ（終わるまで待てる） ----------------
function listenSpeak(text, token) {
  if (typeof applyTtsAudioSession === 'function') applyTtsAudioSession();
  // ★【0.03.75】iPhone・iPad で音楽と一緒に流す設定なら AI の声で（使えなければいつもの読み上げ）
  if (text && typeof ttsUseAi === 'function' && ttsUseAi()) {
    if (!_ls || _ls.token !== token) return Promise.resolve();
    return ttsSpeakAi(text, { rate: listenPrefs().rate || 1 }).catch(() => { if (typeof ttsNoticeFallback === 'function') ttsNoticeFallback(); if (typeof ttsPrepareNative === 'function') ttsPrepareNative(); return listenSpeakNative(text, token); });
  }
  return listenSpeakNative(text, token);
}
function listenSpeakNative(text, token) {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window) || !text || !_ls || _ls.token !== token) return resolve();
    const div = document.createElement('div');
    div.innerHTML = typeof richTextToSpeech === 'function' ? richTextToSpeech(text) : escapeHtml(text);
    const plain = cleanTextForSpeech(div.textContent || '');
    if (!plain) return resolve();
    const segs = isEnglishText(plain) ? [{ ja: false, t: plain }] : splitSpeechSegments(plain);
    if (!segs.length) return resolve();
    const en = getBestVoice('en'), ja = getBestVoice('ja'), rate = listenPrefs().rate || 1;
    let left = segs.length, done = false;
    const finish = () => { if (!done) { done = true; clearTimeout(guard); resolve(); } };
    // onend が来ない端末のための保険（文字数から長さを見積もる）
    const guard = setTimeout(finish, (plain.length * 220) / rate + 4000);
    segs.forEach(sg => {
      const u = new SpeechSynthesisUtterance(sg.t.trim());
      u.rate = rate; const v = sg.ja ? ja : en;
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = sg.ja ? 'ja-JP' : 'en-US';
      u.onend = u.onerror = () => { if (--left <= 0) finish(); };
      speechSynthesis.speak(u);
    });
  });
}
const listenWait = (ms, token) => new Promise(r => { const t0 = Date.now(); const tick = () => { if (!_ls || _ls.token !== token || Date.now() - t0 >= ms) r(); else setTimeout(tick, 100); }; tick(); });

// カードの読み上げ方
function listenIsCloze(q) { return q.kind === 'cloze' || (q.kind !== 'test' && Array.isArray(q.choices) === false) && /（\s*　*\s*）|\(\s*\)|_{2,}|＿{2,}/.test(String(q.question || '')); }
function listenAnswerSpeech(ans) {
  const st = parseStructuredAnswer(ans);
  if (!st) return String(ans).replace(/\//g, '、');
  // (名詞①)価値/(名詞②)価値観/(他動詞)～を重んじる → 名詞、価値、価値観。他動詞、を重んじる
  const groups = [];
  st.forEach(s => { const lb = String(s.label || '').replace(/[①-⑳0-9]/g, '').trim(); const g = groups.find(x => x.lb === lb); if (g) g.t.push(s.text); else groups.push({ lb, t: [s.text] }); });
  return groups.map(g => (g.lb ? g.lb + '、' : '') + g.t.join('、')).join('。');
}
function listenClozeText(q) {
  const lines = String(q.question || '').split('\n');
  const filled = lines[0].replace(/（\s*　*\s*）|\(\s*\)|_{2,}|＿{2,}/, getPrimaryAnswer(q.answer));
  return [filled, ...lines.slice(1)];
}
async function listenPlayCard(q, token) {
  if (typeof ttsSetShareCard === 'function') ttsSetShareCard(q);
  const p = listenPrefs(), gap = (Number(p.gap) || 0) * 1000;
  const say = t => listenSpeak(t, token);
  if (listenIsCloze(q)) { _ls.phase = 'a'; listenDraw(); for (const l of listenClozeText(q)) await say(l); return; }
  _ls.phase = 'q'; listenDraw();
  // ★【0.03.65】アクセント・発音の問題は、英語の部分を読まない（読むと答えが分かる）。選択肢も読まない
  const sound = typeof isSoundQuestion === 'function' && isSoundQuestion(q.question);
  const qs = String(q.question || '').replace(/\n/g, '。');
  if (sound) { const t = spoilerSafeSpeech(qs); if (t) await say(t); } else await say(qs);
  if (!sound && Array.isArray(q.choices) && q.choices.length >= 2) {
    for (let k = 0; k < q.choices.length && _ls && _ls.token === token; k++) await say(`${k + 1}、${q.choices[k]}`);
  }
  await listenWait(gap, token);
  if (!_ls || _ls.token !== token) return;
  _ls.phase = 'a'; listenDraw();
  await say(Array.isArray(q.choices) && q.choices.length >= 2 ? `答え、${getPrimaryAnswer(q.answer)}` : listenAnswerSpeech(q.answer));
  if (p.note && q.note) { _ls.phase = 'n'; listenDraw(); await listenWait(500, token); await say(String(q.note).replace(/\n/g, '。')); }
}
async function listenLoop(token) {
  while (_ls && _ls.token === token && _ls.playing) {
    if (_ls.i >= _ls.list.length) {
      if (!listenPrefs().loop) { listenStop(true); return; }
      _ls.list = listenCards(); _ls.i = 0;
    }
    const q = _ls.list[_ls.i];
    listenMedia(q);
    // ★【0.03.75】AI の声のときは、次のカードの声を先に作っておく
    const nx = _ls.list[_ls.i + 1];
    if (nx && typeof ttsPrefetch === 'function') ttsPrefetch(listenIsCloze(nx) ? listenClozeText(nx) : [String(nx.question || '').replace(/\n/g, '。'), Array.isArray(nx.choices) && nx.choices.length >= 2 ? `答え、${getPrimaryAnswer(nx.answer)}` : listenAnswerSpeech(nx.answer)]);
    await listenPlayCard(q, token);
    if (!_ls || _ls.token !== token || !_ls.playing) return;
    await listenWait(Math.max(800, (Number(listenPrefs().gap) || 0) * 500), token);
    if (!_ls || _ls.token !== token || !_ls.playing) return;
    _ls.i++;
  }
}

// ---------------- 操作 ----------------
function listenStart() {
  const list = listenCards();
  if (!list.length) return alert('この出題範囲に読み上げるカードがありません。');
  if (!('speechSynthesis' in window)) return alert('この端末・ブラウザは読み上げに対応していません。');
  _ls = { list, i: 0, playing: false, token: 0, phase: 'q' };
  listenPlay();
}
function listenPlay() {
  if (!_ls) return listenStart();
  if (typeof ttsStopAll === 'function') ttsStopAll(); else speechSynthesis.cancel();
  _ls.playing = true; _ls.token++;
  listenWakeLock(true);
  listenDraw();
  listenLoop(_ls.token);
}
function listenPause() {
  if (!_ls) return;
  _ls.playing = false; _ls.token++;
  if (typeof ttsStopAll === 'function') ttsStopAll(); else speechSynthesis.cancel(); listenWakeLock(false); listenDraw();
}
// ★【0.03.77】AI の声が読み間違えていたら、そのカードの声を消して作り直す（保存したままにしない）
function listenRedoVoice() {
  if (!_ls || typeof ttsForget !== 'function') return;
  const q = _ls.list[_ls.i]; if (!q) return;
  ttsForget(listenIsCloze(q) ? listenClozeText(q) : [String(q.question || '').replace(/\n/g, '。'), Array.isArray(q.choices) && q.choices.length >= 2 ? `答え、${getPrimaryAnswer(q.answer)}` : listenAnswerSpeech(q.answer), q.note ? String(q.note).replace(/\n/g, '。') : ''].concat(Array.isArray(q.choices) ? q.choices.map((c, k) => `${k + 1}、${c}`) : []));
  if (typeof showAppToast === 'function') showAppToast('🔁 このカードの声を作り直します');
  listenPlay();
}
function listenCardTexts(q) { return listenIsCloze(q) ? listenClozeText(q) : [String(q.question || '').replace(/\n/g, '。'), Array.isArray(q.choices) && q.choices.length >= 2 ? `答え、${getPrimaryAnswer(q.answer)}` : listenAnswerSpeech(q.answer), q.note && listenPrefs().note ? String(q.note).replace(/\n/g, '。') : ''].filter(Boolean); }
function listenFixReading() { if (!_ls) return; const q = _ls.list[_ls.i]; if (!q) return; listenPause(); if (typeof ttsOpenFixDialog === 'function') ttsOpenFixDialog(listenCardTexts(q)); }
// ★【0.03.85】範囲のカードの AI の声を、先に作っておく（1つずつ。無料回数がなくなったら止める）
let _lpb = null;
async function listenPrebuild() {
  if (_lpb) { _lpb.stop = true; return; }
  const st = () => document.getElementById('listenPrebuildStatus');
  const list = listenCards(); _lpb = { stop: false };
  let made = 0, have = 0, fail = 0;
  for (let i = 0; i < list.length && !_lpb.stop; i++) {
    if (typeof ttsSetShareCard === 'function') ttsSetShareCard(list[i]);
    const texts = listenCardTexts(list[i]).concat(Array.isArray(list[i].choices) && list[i].choices.length >= 2 && !listenIsCloze(list[i]) ? list[i].choices.map((c, k) => `${k + 1}、${c}`) : []);
    for (const t of texts) {
      for (let tryN = 0; tryN < 3 && !_lpb.stop; tryN++) {
        try { const r = await ttsBuildText(t); made += r.made; have += r.have; break; }
        catch (e) {
          if (typeof _ttsQuotaHit !== 'undefined' && _ttsQuotaHit) { fail++; _lpb.stop = true; break; }
          // ★【0.03.90】1分あたりの上限：使えるようになるまで待ってから続ける（すぐ頼み直さない）
          const w = typeof ttsNextReadyIn === 'function' ? ttsNextReadyIn() : 0;
          if (w > 0 && w <= 5 * 60e3) { const el = st(); if (el) el.innerHTML = `⏳ 1分あたりの回数の上限です。${Math.ceil(w / 1000)}秒待ってから続けます…　<button class="chip" onclick="listenPrebuild()">止める</button>`; await new Promise(r => setTimeout(r, w + 1000)); continue; }
          fail++; break;
        }
      }
      if (_lpb.stop) break;
    }
    const el = st(); if (el) el.innerHTML = `📥 ${i + 1} / ${list.length}枚 ・ 作った声 ${made} ・ 作ってあった声 ${have}${fail ? ` ・ 作れなかった ${fail}` : ''}　<button class="chip" onclick="listenPrebuild()">止める</button>`;
  }
  const el = st(); if (el) el.innerHTML += typeof _ttsQuotaHit !== 'undefined' && _ttsQuotaHit ? '<br>⚠️ 今日の AI の声の回数を使い切りました。続きは明日また押してください（作った分はとってあります）' : '<br>✅ 終わりました';
  _lpb = null;
}
function listenToggle() { if (_ls && _ls.playing) listenPause(); else listenPlay(); }
function listenSkip(d) {
  if (!_ls) return;
  _ls.i = Math.max(0, Math.min(_ls.list.length - 1, _ls.i + d));
  if (_ls.playing) listenPlay(); else listenDraw();
}
function listenStop(finished) {
  if (_ls) { _ls.token++; _ls.playing = false; }
  try { if (typeof ttsStopAll === 'function') ttsStopAll(); else speechSynthesis.cancel(); } catch (e) {}
  listenWakeLock(false);
  _ls = null;
  renderListenPage();
  if (finished && typeof showAppToast === 'function') showAppToast('🎧 最後まで読み上げました');
}
let _listenLock = null;
async function listenWakeLock(on) {
  try {
    if (on && navigator.wakeLock && !_listenLock) { _listenLock = await navigator.wakeLock.request('screen'); _listenLock.addEventListener('release', () => { _listenLock = null; }); }
    if (!on && _listenLock) { await _listenLock.release(); _listenLock = null; }
  } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && _ls && _ls.playing) listenWakeLock(true); });
function listenMedia(q) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: String(q.question || '').split('\n')[0].slice(0, 60), artist: 'すするanki 聞き流し', album: listenScopeCat() || 'すべて' });
    navigator.mediaSession.setActionHandler('play', listenPlay);
    navigator.mediaSession.setActionHandler('pause', listenPause);
    navigator.mediaSession.setActionHandler('nexttrack', () => listenSkip(1));
    navigator.mediaSession.setActionHandler('previoustrack', () => listenSkip(-1));
  } catch (e) {}
}

// ---------------- 画面 ----------------
function openListen() { openPage('pgListen'); }
function listenSetPref(k, v) { const p = listenPrefs(); p[k] = v; listenSavePrefs(p); if (!_ls) renderListenPage(); }
function listenPickScope() {
  openFolderPicker({ title: '🎧 聞き流す範囲', current: listenScopeCat(), allLabel: '🌐 すべてのフォルダー', selectable: scopeVisible,
    onPick: c => { selectedScopePath = c ? getCategoryPath(c) : ['all']; saveScopePath(); if (typeof buildQuizScopeDropdown === 'function') buildQuizScopeDropdown(); renderListenPage(); } });
}
function renderListenPage() {
  const box = document.getElementById('listenApp'); if (!box) return;
  if (_ls) return listenDraw();
  const p = listenPrefs(), n = listenCards().length, cat = listenScopeCat();
  const sel = (k, opts) => `<select class="form-control" onchange="listenSetPref('${k}', ${k === 'gap' || k === 'rate' ? 'Number(this.value)' : 'this.value'})">${opts.map(([v, l]) => `<option value="${v}" ${String(p[k]) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  box.innerHTML = `<div class="card"><div class="setting-box-title">🎧 聞き流し</div>
      <label class="section-label" style="font-weight:500;">範囲（ホームの出題範囲と同じ）</label>
      ${folderPickButtonHTML(cat, 'すべてのフォルダー', 'listenPickScope()', `${n}枚`)}
      <div class="form-row" style="margin-top:10px;">
        <div style="flex:1;"><label class="section-label" style="font-weight:500;">答えまでの間</label>${sel('gap', [[1, '1秒'], [2, '2秒'], [3, '3秒'], [5, '5秒'], [8, '8秒']])}</div>
        <div style="flex:1;"><label class="section-label" style="font-weight:500;">速さ</label>${sel('rate', [[0.8, 'ゆっくり'], [1, 'ふつう'], [1.2, '少し速く'], [1.5, '速く']])}</div>
      </div>
      <div class="form-row" style="margin-top:8px;">
        <div style="flex:1;"><label class="section-label" style="font-weight:500;">順番</label>${sel('order', [['number', '番号順'], ['random', 'ランダム']])}</div>
        <div style="flex:1;"><label class="section-label" style="font-weight:500;">解説（メモ）</label>${sel('note', [['', 'なし'], ['1', 'あり']].map(([v, l]) => [v, l]))}</div>
      </div>
      <div class="toggle-grid" style="margin-top:10px;">
        <label class="toggle-pill"><input type="checkbox" ${p.loop ? 'checked' : ''} onchange="listenSetPref('loop', this.checked)">🔁 最後まで行ったらくり返す</label>
        <label class="toggle-pill"><input type="checkbox" ${p.grad ? 'checked' : ''} onchange="listenSetPref('grad', this.checked)">🎓 卒業済みも読む</label>
      </div>
      <button class="btn btn-start" style="margin-top:12px;" onclick="listenStart()" ${n ? '' : 'disabled'}>▶️ 聞き流しを始める</button>
      ${typeof ttsUseAi === 'function' && ttsUseAi() && n ? `<button class="btn btn-secondary" style="margin-top:8px;" onclick="listenPrebuild()">📥 この範囲の AI の声を先に作っておく</button><div id="listenPrebuildStatus" class="hint-small" style="margin-top:4px;">AI の声は1日に作れる数が少ないので、回数のある日に先に作っておくと、あとは回数を使わずに音楽と一緒に流せます（作ってある声は1年とっておきます）</div>` : ''}
      <details class="drill-howto"><summary>ℹ️ 読み方</summary><div class="hint-small">・ふつうの問題：問題 →（間）→ 答え（解説ありならメモも）<br>・選択肢つきの問題：問題 → 選択肢 →（間）→ 答えだけ<br>・例文・空欄補充：空欄に答えを入れた文と訳を、そのまま流します<br>・成績は動きません。画面は消えないようにします（端末によっては、画面を消すと止まります）</div></details>
    </div>`;
  const ns = box.querySelectorAll('select')[3]; if (ns) ns.value = p.note ? '1' : '';
}
function listenDraw() {
  const box = document.getElementById('listenApp'); if (!box || !_ls) return;
  const q = _ls.list[_ls.i]; if (!q) return;
  const cloze = listenIsCloze(q), ph = _ls.phase;
  const ans = cloze ? listenClozeText(q).join('\n') : Array.isArray(q.choices) && q.choices.length >= 2 ? getPrimaryAnswer(q.answer) : listenAnswerSpeech(q.answer);
  box.innerHTML = `<div class="card listen-card">
      <div class="hint-small">${_ls.i + 1} / ${_ls.list.length} ・ 📁 ${escapeHtml(q.category)}</div>
      ${cloze ? '' : `<div class="listen-q">${escapeHtml(String(q.question || '')).replace(/\n/g, '<br>')}</div>`}
      ${!cloze && Array.isArray(q.choices) && q.choices.length >= 2 ? `<div class="hint-small">${q.choices.map((c, k) => `${k + 1}. ${escapeHtml(c)}`).join('　')}</div>` : ''}
      <div class="listen-a${ph === 'q' ? ' hidden' : ''}">${escapeHtml(ans).replace(/\n/g, '<br>')}</div>
      ${listenPrefs().note && q.note && ph === 'n' ? `<div class="hint-small listen-n">📝 ${escapeHtml(q.note).replace(/\n/g, '<br>')}</div>` : ''}
      <div class="listen-ctrl">
        <button class="chip" onclick="listenSkip(-1)" title="前へ">⏮</button>
        <button class="btn btn-primary listen-play" onclick="listenToggle()">${_ls.playing ? '⏸ 一時停止' : '▶️ 再生'}</button>
        <button class="chip" onclick="listenSkip(1)" title="次へ">⏭</button>
      </div>
      <button class="chip" style="margin-top:8px;" onclick="listenFixReading()">🗣️ 読み間違い：読み方を直す</button>
      <button class="btn btn-secondary" style="margin-top:8px;" onclick="listenStop()">⏹ やめる</button>
    </div>`;
}
