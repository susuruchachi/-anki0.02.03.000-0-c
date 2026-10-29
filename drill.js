// ================================================================
// ★【0.03.24】📝 暗記テスト（AI）
// 単語帳を「グループ（フォルダー）ごとに、全部の意味を答える → 間違えたらその場で言い直し →
// グループの最後に、そのグループで間違えた単語の復習と Check!（Review Test）→ 全部〇になるまで周回」で仕上げるテスト。
// 試作の「鉄壁 暗記テスト」（テキストを貼って使う HTML）を、すするanki のカード・フォルダー・AI 呼び出しで動くようにしたもの。
//  ・グループ＝カードが入っているフォルダー（選んだフォルダーの下を、ツリーの順に）
//  ・単語＝ふつうのカード（例文・自己申告は出さない）
//  ・Check!＝選択肢つきのテストのカード（Review Test フォルダーなど。上のフォルダーのグループの最後に出す）
//  ・意味：答えの品詞タグ（(他動詞) など）と、全角スペース・読点で並べた訳。ほぼ同じ意味の訳は AI がまとめる（どれか1つ答えればよい）
//  ・成績：各周の1回目の答えだけを、いつものレベルに反映する（言い直し・復習の分は数えない）
// ================================================================
const DRILL_KEY = 'susuru_anki_drill';
let DG = [], DS = {}, DQ = [], dcur = null, dst = {}, dlock = false, DI = {}, DCK = {}, DP = {};
const dE = s => escapeHtml(String(s == null ? '' : s));
const dShuffle = a => a.map(x => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(x => x[1]);
const dOrd = s => s.it ? s.it.o : s.ck.o;
const dKey = s => s.it ? s.it.id : 'c:' + s.ck.key;

// ---------------- カードからグループを作る ----------------
function drillIsWordCard(q) {
  return !q.kind && !(Array.isArray(q.choices) && q.choices.length) && String(q.question || '').trim() && String(q.answer || '').trim()
    && !(typeof hasRichBlock === 'function' && hasRichBlock(q.answer));
}
// 熟語・チャンク（communicate with A など）か。★【0.03.47】元の試作と同じく、暗記テストにも出す（週間プランのチャンツにも入る）
function drillIsPhraseCard(q) {
  const w = String(q.question || '').trim();
  if (/^[\x00-\x7F’]+$/.test(w) && /\s/.test(w)) return true; // 英語の2語以上
  const st = parseStructuredAnswer(q.answer);
  return !!(st && st.every(s => /熟語|成句|チャンク|句動詞|^句$/.test(s.label)));
}
function drillIsCheckCard(q) { return q.kind === 'test' || (Array.isArray(q.choices) && q.choices.length >= 2 && q.kind !== 'cloze'); }
function drillBuild(cat) {
  const order = getSortedCategoriesForMenu();
  const inScope = cat ? new Set(getAllSubcategories(cat)) : null;
  const cats = order.filter(c => !inScope || inScope.has(c));
  const byCat = {};
  db.forEach(q => { (byCat[q.category] = byCat[q.category] || []).push(q); });
  DG = []; let o = 0;
  const groupOf = {};
  // ★【0.03.30】「上のフォルダーから出題するときは出さない」フォルダーの単語は出さない（選んだフォルダーそのものは出す）。
  //  Check!（選択肢つきのテスト）は、グループの最後の確認として、そのフォルダーからも出す
  const skipped = c => { for (let x = c; x && x !== cat; x = getCategoryParent(x)) { if (isCatSkipped(x)) return true; } return false; };
  cats.forEach(c => {
    const cards = sortCardsByNumber((byCat[c] || []).slice());
    const words = skipped(c) ? [] : cards.filter(drillIsWordCard), checks = cards.filter(drillIsCheckCard);
    let g = null;
    if (words.length) { g = { name: c, items: [], checks: [], intro: (byCat[c] || []).filter(q => q.kind === 'intro').map(q => String(q.answer || '').trim())[0] || '' }; DG.push(g); }
    else if (checks.length) {
      // テストだけのフォルダー（Review Test など）は、上のフォルダーのグループの最後に出す
      let p = getCategoryParent(c);
      while (p && !groupOf[p] && (!inScope || inScope.has(p))) p = getCategoryParent(p);
      g = p && groupOf[p] ? groupOf[p] : null;
      if (!g) { g = { name: c, items: [], checks: [] }; DG.push(g); }
    }
    if (!g) return;
    groupOf[c] = g;
    words.forEach(q => g.items.push({ id: q.id, w: q.question, m: q.answer, card: q, o: o++ }));
    checks.forEach(q => g.checks.push(q));
  });
  DI = {}; DCK = {};
  DG.forEach((g, gi) => {
    const last = g.items.length ? g.items[g.items.length - 1].o : o;
    g.chk = g.checks.map((q, i) => ({ key: q.id, q: q.question, ans: q.answer, choices: Array.isArray(q.choices) ? q.choices : null, card: q, o: last + 0.5 + i / 1000 }));
    g.items.forEach(x => { DI[x.id] = x; x.gi = gi; });
    g.chk.forEach(c => { DCK[c.key] = c; c.gi = gi; });
  });
}

// ---------------- 意味・品詞 ----------------
function drillSegs(it) { return parseStructuredAnswer(it.m) || [{ label: '', text: it.m }]; }
function drillPos(label) {
  const l = String(label || '');
  if (/自動詞/.test(l)) return '自'; if (/他動詞/.test(l)) return '他'; if (/名詞/.test(l)) return '名';
  if (/形容詞/.test(l)) return '形'; if (/副詞/.test(l)) return '副'; if (/熟語|成句|句/.test(l)) return '句';
  if (/動詞/.test(l)) return '動'; return '';
}
function drillAttr(it) { return [...new Set(drillSegs(it).map(s => (String(s.label).match(/自動詞|他動詞/) || [''])[0]).filter(Boolean))].join('・'); }
function drillIsVerb(it) { return /自動詞|他動詞/.test(drillAttr(it)) && !drillSegs(it).some(s => /句動詞/.test(s.label)); }
// 答えを「覚える意味」に分ける：{ p: 品詞, t: 訳（ほぼ同じ意味の言い換えは「，」でつなぐ）, c: 品詞のまとまりの番号 }
function drillSenses(it) {
  const out = [];
  drillSegs(it).forEach((seg, c) => {
    const p = drillPos(seg.label);
    const ch = String(seg.text).replace(/\s*[（(]\s*[=＝↔][^)）]*[)）]/g, '').trim();
    const parts = /[①②③④⑤⑥]/.test(ch) ? ch.split(/[①②③④⑤⑥]/) : ch.split(/[；;]/);
    // ★【0.03.47】元の試作と同じく、①②・；で分けた1つの意味の中に並べた訳は「，」でつないでおき、AI がまとめる（drillGroupSenses）
    parts.forEach(x => { x = x.trim(); if (!x) return; const ws = splitAnswerMeanings(x); out.push({ p, t: (ws.length ? ws : [x]).join('，'), c }); });
  });
  return out;
}
function drillGetSn(it) { return DP[it.id] || (DP[it.id] = drillGroupSenses(it)); }
// 「，」でつないだ訳を、ニュアンスの違う意味ごとに AI に分けてもらう（元の試作と同じ指示。結果は端末に保存して使い回す）。
//  AI が使えないときは、並べた訳をそれぞれ別の意味として全部答える
const DRILL_SENSE_CACHE = 'susuru_anki_drill_senses_v3';
function drillLoadSenseCache() { try { return JSON.parse(localStorage.getItem(DRILL_SENSE_CACHE) || '{}') || {}; } catch (e) { return {}; } }
function drillSplitAll(b) { return b.flatMap(x => String(x.t).split('，').map(t => ({ p: x.p, c: x.c, t }))); }
async function drillGroupSenses(it) {
  if (DS.sp && DS.sp[it.id]) return DS.sp[it.id];
  const cache = drillLoadSenseCache(), c = cache[it.id];
  if (c && c.a === it.m && Array.isArray(c.s)) return (DS.sp[it.id] = c.s);
  const b = drillSenses(it), cm = b.filter(x => /[，,]/.test(x.t));
  if (!cm.length) return (DS.sp[it.id] = b);
  if (!drillAiOk()) return (DS.sp[it.id] = drillSplitAll(b));
  try {
    const r = await drillAi(`日本語訳の分類。各行の「，」で区切られた訳について、日本語としてニュアンスが異なり別の意味として覚えるべきものは別グループに、ほぼ同義の言い換えは同じグループにする。迷う場合は同じグループにする。\n${cm.map((x, i) => `${i}: ${x.t}`).join('\n')}\nJSONのみ。行ごとのグループ配列を並べる。例：{"r":[[["社交的な"],["愛想のいい"]],[["親しい","親密な"]]]}`);
    let k = 0; const out = [];
    b.forEach(x => {
      if (!cm.includes(x)) { out.push(x); return; }
      const gr = r.r && r.r[k++];
      if (Array.isArray(gr) && gr.length && gr.every(Array.isArray)) gr.forEach(g => out.push({ p: x.p, c: x.c, t: g.join('，') }));
      else out.push(x);
    });
    DS.sp[it.id] = out;
    cache[it.id] = { a: it.m, s: out }; const ks = Object.keys(cache); if (ks.length > 3000) delete cache[ks[0]];
    try { localStorage.setItem(DRILL_SENSE_CACHE, JSON.stringify(cache)); } catch (e) {}
    return out;
  } catch (e) { delete DP[it.id]; return drillSplitAll(b); }
}
// ★【0.03.27】もう答えた意味の言い換え・語形の違い（「意思疎通」のあとの「意思疎通すること」など）か
try { localStorage.removeItem('susuru_anki_drill_senses_v2'); } catch (e) {} // 前の版の AI のまとめ（指示が違う）
const DRILL_ENDINGS_RE = /(すること|させること|されること|すること|させる|される|すること|こと|する|的な|的|な|の|に|だ|である)$/;
function drillStem(w) { let n = normalizeStructuredToken(w); for (let i = 0; i < 2; i++) n = n.replace(DRILL_ENDINGS_RE, ''); return n; }
function drillIsRepeat(v, sn, cv) {
  if (!cv.length) return false;
  const done = cv.flatMap(i => String(sn[i].t).split(/[，,]/)).map(drillStem).filter(w => w.length >= 2);
  const rest = sn.map((x, i) => cv.includes(i) ? [] : String(x.t).split(/[，,]/)).flat().map(drillStem).filter(Boolean);
  const parts = String(v).split(/[、,，\s\u3000・／/]+/).map(drillStem).filter(Boolean);
  if (!parts.length) return false;
  return parts.every(p => !rest.includes(p) && done.some(d => p === d || p.includes(d) || (p.length >= 2 && d.includes(p))));
}
// AI を使わずに分かる答え（単語帳の訳と同じ言葉だけ）。答えた言葉が全部どれかの意味に当たれば、その意味の番号
function drillLocalHits(v, sn) {
  const r = drillPartHits(v, sn);
  return r && !r.unknown.length ? r.hits : null;
}
// ★【0.03.43】答えを区切った語句ごとに、単語帳の訳と同じものはその意味の番号に（hits）、それ以外は unknown に分ける。
//  単語帳の訳と同じ言葉は AI に回さず、必ず〇にする（AI が取り違えて「単語帳に無い」「意味が違う」にすることがあったため）
function drillPartHits(v, sn) {
  const whole = normalizeStructuredToken(v);
  const parts = String(v).split(/[、,，\s　・／/]+/).filter(p => normalizeStructuredToken(p) !== '');
  if (!parts.length) return null;
  const forms = sn.map(x => new Set(String(x.t).split(/[，,]/).flatMap(w => structuredTokenForms(w))));
  const wi = forms.findIndex(f => f.has(whole)); // 区切りを含む訳（「現在の伝聞、婉曲」など）をそのまま書いたとき
  if (wi >= 0) return { hits: [wi], unknown: [] };
  const hits = [], unknown = [];
  for (const p of parts) {
    const n = normalizeStructuredToken(p);
    const i = forms.findIndex(f => f.has(n));
    const is = i >= 0 ? [i] : drillSplitJoined(n, forms);
    if (!is) { unknown.push(p); continue; }
    is.forEach(k => { if (!hits.includes(k)) hits.push(k); });
  }
  return { hits, unknown };
}
// ★【0.03.40】区切らずに続けて書いた答え（「完了存続」）を、単語帳の訳の並びに分ける。分けられなければ null
function drillSplitJoined(n, forms) {
  const all = []; forms.forEach((f, i) => f.forEach(w => { if (w.length >= 2) all.push([w, i]); }));
  const memo = new Map();
  const go = s => {
    if (!s) return [];
    if (memo.has(s)) return memo.get(s);
    let r = null;
    for (const [w, i] of all) { if (s.startsWith(w)) { const rest = go(s.slice(w.length)); if (rest) { r = [i, ...rest]; break; } } }
    memo.set(s, r); return r;
  };
  const r = go(n);
  return r && r.length > 1 ? r : null;
}

// ---------------- AI ----------------
function drillAiOk() { return typeof aiAvailable === 'function' && aiAvailable() && navigator.onLine !== false; }
async function drillAi(p) {
  const text = await aiRequest('あなたは英単語・暗記テストの採点と出題の係です。指示どおりに、JSONだけを出力します。', [{ text: p }], { json: true, maxTokens: 700, timeout: 15000, totalTimeout: 30000 });
  return parseAiJson(text);
}
function drillBusy() { dlock = true; const a = document.getElementById('drillApp'); if (a) a.insertAdjacentHTML('beforeend', '<p class="hint-small drill-busy">🤖 AI処理中…</p>'); }
function drillErr(e) { dlock = false; drillDraw(); document.getElementById('drillApp').insertAdjacentHTML('beforeend', `<p class="drill-ng">エラー：${dE(e.message || '通信失敗')}。もう一度押してください。</p>`); }

// ---------------- 始める・続きから ----------------
// ★【0.03.29】出題範囲は暗記タブで選ぶ（ホームの出題範囲とは別。初めはホームの範囲）
const DRILL_CAT_KEY = 'susuru_anki_drill_cat';
function drillScopeCategory() {
  try { const c = localStorage.getItem(DRILL_CAT_KEY); if (c !== null) return c === '' || categories.includes(c) ? c : ''; } catch (e) {}
  const p = (selectedScopePath && selectedScopePath.length ? selectedScopePath : lastQuizScopePath) || [];
  const c = p.length && p[0] !== 'all' ? p[p.length - 1] : '';
  return categories.includes(c) ? c : '';
}
function drillSetCategory(c) { try { localStorage.setItem(DRILL_CAT_KEY, c || ''); } catch (e) {} if (!_drillActive) drillHome(); }
// ★【0.03.29】途中経過はフォルダーごとに保存する { フォルダー名（すべては ''）: 状態 }
function drillLoadAll() {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(DRILL_KEY + '_v2') || '{}') || {}; } catch (e) {}
  try { const old = JSON.parse(localStorage.getItem(DRILL_KEY)); if (old && !all[old.cat || '']) { all[old.cat || ''] = old; localStorage.setItem(DRILL_KEY + '_v2', JSON.stringify(all)); } localStorage.removeItem(DRILL_KEY); } catch (e) {}
  return all;
}
function drillStoreAll(all) { try { localStorage.setItem(DRILL_KEY + '_v2', JSON.stringify(all)); } catch (e) {} }
// ★【0.03.27】暗記テストは専用のタブ。ほかの画面に行っても（一時離脱）、タブに戻るとその問題から続く
let _drillActive = false;
function openDrill() { openPage('pgDrill'); }
function drillOnOpen() { if (_drillActive && dcur) drillDraw(); else drillHome(); if (typeof renderRace === 'function') renderRace(); }
function drillSetActive(on) {
  _drillActive = on;
  document.querySelectorAll('.drill-active-dot').forEach(el => { el.style.display = on ? 'inline-flex' : 'none'; });
  const pw = document.getElementById('drillPlanWrap'); if (pw) pw.style.display = on ? 'none' : ''; // 解いている間はプランを隠す
}
function drillPause() { if (dlock) return; drillSave(); openPage('pgHome'); }
function drillHome() {
  dlock = false; drillSetActive(false);
  const all = drillLoadAll();
  const cat = drillScopeCategory();
  const d = all[cat] || null;
  drillBuild(cat);
  const words = DG.reduce((n, g) => n + g.items.length, 0), checks = DG.reduce((n, g) => n + g.chk.length, 0);
  const left = x => (x.Q || []).filter(y => y.t === 'q' || y.t === 'c').length;
  const others = Object.keys(all).filter(k => k !== cat && (k === '' || categories.includes(k)));
  const A = document.getElementById('drillApp');
  // ★【0.03.49】画面を整理：出題範囲（フォルダーのツリーから選ぶ）→ 開始 → 途中経過 → そのほか。説明はたたむ
  A.innerHTML = `<div class="card drill-main"><div class="setting-box-title">🧠 暗記テスト</div>
      <label class="section-label" style="font-weight:500;">🎯 出題範囲</label>
      ${folderPickButtonHTML(cat, 'すべてのフォルダー', 'drillPickScope()', `グループ ${DG.length} ・ 単語 ${words}語 ・ Check! ${checks}問`)}
      ${d ? `<div class="drill-saved"><b>▶️ 途中経過があります</b><div class="hint-small">${d.r}周目 ・ 残り${left(d)}問</div><div class="drill-btns"><button class="btn btn-primary" onclick="drillResume(${jsArg(cat)})">続きから</button><button class="btn btn-secondary" onclick="drillDiscard(${jsArg(cat)})">途中経過を消す</button></div></div>` : ''}
      <button class="btn btn-start" style="margin-top:10px;" onclick="drillStart()" ${words + checks ? '' : 'disabled'}>🚀 ${d ? '最初から始める' : '開始'}</button>
      ${drillAiOk() ? '' : '<div class="drill-warn">⚠️ AI が使えないため、単語帳の訳と同じ言葉だけを正解にします（設定 → 🤖 AI でキーを入れると、言い換えの判定・4択・解説・質問が使えます）</div>'}
      ${others.length ? `<div class="hint-small" style="margin-top:10px;">ほかのフォルダーの途中経過：</div><div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:4px;">${others.map(k => `<button class="chip" onclick="drillSetCategory(${jsArg(k)})">📁 ${dE(k || 'すべて')}（${all[k].r}周目・残り${left(all[k])}）</button>`).join('')}</div>` : ''}
      <div class="drill-sub"><button class="chip" onclick="vtOpen()">📄 テキストから問題を作る</button></div>
      <details class="drill-howto"><summary>ℹ️ 暗記テストの進み方</summary>
        <div class="hint-small">・グループ（フォルダー）ごとに、単語の<b>全部の意味</b>を答えます（言い換えても意味が変わらない訳は、どれか1つで OK。「完了、存続」「完了存続」のようにまとめて答えても OK）<br>・動詞は、自動詞か他動詞かも聞きます<br>・間違えたら、その場でもう一度出ます。グループの最後に、そのグループで間違えた単語と Check!（Review Test）<br>・1周目で間違えた問題を2周目で…と、全部〇になるまで続けます。2周目はグループの切れ目に導入の文<br>・正解・不正解の回数は、暗記テストだけで数えます（いつものレベル・成績とは別）</div>
      </details>
    </div>`;
}
function drillPickScope() {
  openFolderPicker({ title: '🎯 暗記テストの出題範囲', current: drillScopeCategory(), allLabel: '📚 すべてのフォルダー',
    hint: 'フォルダーを選ぶと、その下のフォルダーもグループとして順に出題します',
    onPick: c => drillSetCategory(c) });
}
function drillDiscard(cat) {
  if (!confirm('このフォルダーの途中経過を消しますか？')) return;
  const all = drillLoadAll(); delete all[cat]; drillStoreAll(all); drillHome();
}
// ★【0.03.44】ネットにつながっていないときは、始める前に確かめる（そのまま続ける／4択で先週・1か月前の範囲の復習）
function drillOfflineGate(go) {
  if (navigator.onLine !== false || !(typeof aiAvailable === 'function' && aiAvailable())) return go();
  const opts = [];
  if (typeof planList === 'function') planList().forEach(p => {
    planUse(p); const i = planWeekIndex(), prev = planWeekFolder(i - 1), month = planWeekFolder(i - 4);
    if (prev) { const cs = planSundayCards(prev); if (cs.length) opts.push({ label: `🔁 4択で先週の範囲（${prev}）を復習（${cs.length}問）`, cards: cs }); }
    if (month) { const cs = planMonthlyCards(month); if (cs.length) opts.push({ label: `🗓️ 4択で1か月前の範囲（${month}）を復習（${cs.length}問）`, cards: cs }); }
  });
  const here = DG.flatMap(g => g.items.map(x => x.card));
  if (here.length) opts.push({ label: `🎯 4択でこの範囲をクイズ（${here.length}問）`, cards: here });
  window._drillOffline = { go, opts };
  drillSetActive(false);
  document.getElementById('drillApp').innerHTML = `<div class="card drill-offline"><div class="setting-box-title">📡 ネットにつながっていません</div>
    <p>ネット接続がないか不安定です。このまま続けると、<b>単語帳の訳と同じ答えだけが正解</b>になり、言い換えの判定・4択・解説・質問も使えません。</p>
    <div class="drill-btns" style="flex-direction:column;"><button class="btn btn-primary" onclick="drillOfflineGo(-1)">このまま続ける</button>
    ${opts.map((o, k) => `<button class="btn btn-secondary" onclick="drillOfflineGo(${k})">${dE(o.label)}</button>`).join('')}
    <button class="btn btn-secondary" onclick="drillHome()">やめる</button></div>
    <div class="hint-small" style="margin-top:6px;">ネットにつながったらお知らせします。</div></div>`;
}
function drillOfflineGo(k) {
  const o = window._drillOffline; window._drillOffline = null; if (!o) return drillHome();
  if (k < 0) return o.go();
  if (typeof planStartQuiz === 'function') planStartQuiz(o.opts[k].cards, false, 'choice');
}
// ネットが切れた・つながったときのお知らせ（暗記テストを解いているとき・暗記タブを開いているとき）
function drillNetNotice(on) {
  const onDrill = _drillActive || ((document.querySelector('.screen.active') || {}).id === 'pgDrill');
  if (!onDrill || !(typeof aiAvailable === 'function' && aiAvailable())) return;
  const msg = on ? '🌐 ネットにつながりました。AI の判定・質問が使えます' : '📡 ネットが切れました。単語帳の訳と同じ答えだけが正解になります';
  if (typeof showAppToast === 'function') showAppToast(msg);
  if (on && document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted' && navigator.serviceWorker) navigator.serviceWorker.ready.then(r => r.showNotification('すするanki', { body: msg, tag: 'net' })).catch(() => {});
  if (on && !_drillActive && document.querySelector('.drill-offline')) drillHome();
}
window.addEventListener('online', () => drillNetNotice(true));
window.addEventListener('offline', () => drillNetNotice(false));
function drillStart() { drillOfflineGate(drillStartNow); }
function drillStartNow() {
  if (!DG.length) return alert('この範囲に単語のカードがありません。');
  const cat = drillScopeCategory();
  const all = drillLoadAll();
  if (all[cat] && !confirm('このフォルダーの途中経過を消して、最初から始めますか？')) return;
  DS = { cat, r: 1, gi: 0, miss: new Map(), gm: [], rv: false, hdr: null, ct: {}, sp: {}, rec: {} };
  DQ = []; drillSetActive(true); drillPop();
}
function drillSer(s) { return s.t === 'q' ? { t: 'q', id: s.it.id, retry: s.retry } : s.t === 'c' ? { t: 'c', key: s.ck.key, retry: s.retry } : s.t === 'msg' ? { t: 'msg', h: s.h } : { t: s.t, g: DG.indexOf(s.g) }; }
function drillDe(o) {
  if (o.t === 'q') return DI[o.id] ? { t: 'q', it: DI[o.id], retry: o.retry } : null;
  if (o.t === 'c') return DCK[o.key] ? { t: 'c', ck: DCK[o.key], retry: o.retry } : null;
  if (o.t === 'msg') return o;
  return DG[o.g] ? { t: o.t, g: DG[o.g] } : null;
}
function drillSave() {
  if (!DS || DS.r === undefined) return;
  const all = drillLoadAll();
  all[DS.cat || ''] = { cat: DS.cat, r: DS.r, gi: DS.gi, rv: DS.rv, gm: DS.gm.map(x => x.id), miss: [...DS.miss.values()].map(drillSer), ct: DS.ct, rec: DS.rec, Q: [dst.ph === 9 ? null : dcur, ...DQ].filter(Boolean).map(drillSer), hg: DS.hdr ? DG.indexOf(DS.hdr) : -1, at: Date.now() };
  drillStoreAll(all);
}
function drillResume(cat) { drillBuild(cat && categories.includes(cat) ? cat : ''); drillOfflineGate(() => drillResumeNow(cat)); }
function drillResumeNow(cat) {
  try {
    const d = drillLoadAll()[cat || ''];
    if (!d) return drillHome();
    drillBuild(d.cat && categories.includes(d.cat) ? d.cat : '');
    DS = { cat: d.cat || '', r: d.r, gi: d.gi, rv: d.rv, miss: new Map(), gm: (d.gm || []).map(i => DI[i]).filter(Boolean), hdr: d.hg >= 0 ? DG[d.hg] : null, ct: d.ct || {}, sp: {}, rec: d.rec || {} };
    (d.miss || []).map(drillDe).filter(Boolean).forEach(x => DS.miss.set(dKey(x), x));
    DQ = (d.Q || []).map(drillDe).filter(Boolean);
    drillSetActive(true); drillPop();
  } catch (e) { alert('保存データを読み込めませんでした'); drillHome(); }
}

// ---------------- 出題の順番 ----------------
function drillPop() {
  if (!DQ.length) return drillRefill();
  dcur = DQ.shift(); dst = { ans: [], ph: 0 };
  if (dcur.t === 'intro') { DS.hdr = dcur.g; return drillPop(); }
  if (dcur.t === 'gend') {
    // グループの最後：このグループで間違えた単語の復習 → Check!
    const g = dcur.g; DS.rv = true; DS.gi++;
    DQ = [...DS.gm.map(it => ({ t: 'q', it })), ...g.chk.map(ck => ({ t: 'c', ck }))]; DS.gm = [];
    return drillPop();
  }
  if (dcur.t === 'gread') { dst.ph = 'gq'; drillSave(); return drillGread(); }
  if (dcur.t === 'c' && dcur.ck.choices) dst.op = dShuffle(dcur.ck.choices.slice());
  [dcur, ...DQ].filter(x => x.t === 'q').slice(0, 2).forEach(x => drillGetSn(x.it)); // 次の単語の意味のまとめを先に
  drillSave(); drillDraw();
  if (drillTtsOn()) drillSpeakQ();
}
function drillRefill() {
  if (DS.r > 1 || DS.gi >= DG.length) return drillEndRound();
  const g = DG[DS.gi]; DS.rv = false;
  DQ = [{ t: 'intro', g }, ...g.items.map(it => ({ t: 'q', it })), { t: 'gend', g }];
  drillPop();
}
function drillEndRound() {
  const L = [...DS.miss.values()].sort((a, b) => dOrd(a) - dOrd(b));
  const A = document.getElementById('drillApp');
  if (!L.length) {
    { const all = drillLoadAll(); delete all[DS.cat || '']; drillStoreAll(all); }
    drillSetActive(false);
    if (typeof planOnDrillPassed === 'function') planOnDrillPassed(DS.cat); // ★【0.03.27】週間プランの「単語」達成
    A.innerHTML = `<div class="card"><b>🎉 ${DS.r}周目で全問〇になりました</b><p>【合格】おめでとうございます。</p><button class="btn btn-secondary" onclick="drillHome()">戻る</button></div>`;
    return;
  }
  const p = DS.r; DS.r++; DS.miss = new Map();
  // ★【0.03.44】2周目は、グループの切れ目ごとに導入の文（AI があればその文からの4択 → 読む）
  const seq = []; let lastG = -1;
  L.forEach(s => {
    const gi = s.it ? s.it.gi : s.ck.gi;
    if (DS.r === 2 && gi !== lastG && DG[gi] && DG[gi].intro) seq.push({ t: 'gread', g: DG[gi] });
    lastG = gi;
    seq.push(s.it ? { t: 'q', it: s.it } : { t: 'c', ck: s.ck });
  });
  DQ = [{ t: 'msg', h: `【${DS.r}周目開始】${p}周目で間違えた${L.length}問の復習に入ります。` }, ...seq];
  drillPop();
}

// ---------------- 導入の文（2周目のグループの切れ目） ----------------
async function drillGread() {
  const g = dcur.g; DS.giq = DS.giq || {};
  if (!drillAiOk()) { dst.ph = 'gr'; return drillDraw(); }
  drillDraw();
  if (!DS.giq[g.name]) {
    try {
      const r = await drillAi(`次の文章（単語帳のグループのはじめの「導入の文」）の内容を確かめる、やさしい4択問題を1問作る。文章に書いてあることだけで答えられ、正解がはっきり1つのもの。問題文・選択肢は日本語で短く。\n文章:\n${g.intro.slice(0, 2500)}\nJSONのみ：{"q":"","options":["","","",""],"answer":0}`);
      if (r && r.q && Array.isArray(r.options) && r.options.length >= 3 && r.options[r.answer] !== undefined) DS.giq[g.name] = { q: String(r.q), options: r.options.map(String), answer: Number(r.answer) };
    } catch (e) {}
  }
  if (dcur.t !== 'gread' || dcur.g !== g) return;
  dst.giq = DS.giq[g.name] || null;
  if (!dst.giq) dst.ph = 'gr';
  drillDraw();
}
function drillGiPick(i) { if (dst.ph !== 'gq' || !dst.giq) return; dst.gpick = i; dst.ph = 'gr'; drillSave(); drillDraw(); }

// ---------------- 読み上げ ----------------
// ★【0.03.28】問題（単語・Check! の問題文）は出たときに、答えは結果の画面で読み上げる。🔊 でもう一度
function drillTtsOn() { try { return localStorage.getItem('susuru_anki_drill_tts') !== 'off'; } catch (e) { return true; } }
function drillToggleTts() { try { localStorage.setItem('susuru_anki_drill_tts', drillTtsOn() ? 'off' : 'on'); } catch (e) {} if (!drillTtsOn() && 'speechSynthesis' in window) speechSynthesis.cancel(); drillDraw(); }
function drillQText(c) { return c.it ? c.it.w : c.ck.q; }
function drillAText(c) {
  if (c.ck) return c.ck.ans;
  const seg = parseStructuredAnswer(c.it.m);
  return seg ? seg.map(x => x.text).join('。') : c.it.m;
}
function drillSpeakQ() { if (dcur && (dcur.it || dcur.ck) && typeof speakText === 'function') speakText(drillQText(dcur)); }
function drillSpeakA() { if (dcur && (dcur.it || dcur.ck) && typeof speakText === 'function') speakText(drillAText(dcur)); }

// ---------------- 画面 ----------------
function drillDraw() {
  if (DS.hdr) { dst.h = `<div class="card drill-group"><b>📁 ${dE(DS.hdr.name)}</b><div class="hint-small">${DS.hdr.items.length}語${DS.hdr.chk.length ? ` ・ Check! ${DS.hdr.chk.length}問` : ''}</div>${DS.hdr.intro && DS.r === 1 ? `<div class="drill-intro hint-small">📖 ${dE(DS.hdr.intro).replace(/\n/g, '<br>')}</div>` : ''}</div>`; DS.hdr = null; }
  const c = dcur; let b = '';
  const W = it => `<div class="drill-word">${dE(it.w)} <button class="chip" style="vertical-align:middle;" onclick="drillSpeakQ()" title="読み上げる">🔊</button></div>`;
  if (c.t === 'gread') {
    const q = dst.giq, intro = `<div class="drill-intro">${dE(c.g.intro).replace(/\n/g, '<br>')}</div>`;
    if (dst.ph === 'gq' && !q) b = `<div class="card"><b>📖 ${dE(c.g.name)}：導入の文</b><p class="hint-small">🤖 導入の文から問題を作っています…</p></div>`;
    else if (dst.ph === 'gq') b = `<div class="card"><div class="hint-small">📖 ${dE(c.g.name)}：導入の文から</div><p class="drill-q">${dE(q.q)}</p>${q.options.map((o, i) => `<button class="btn btn-secondary drill-opt" onclick="drillGiPick(${i})">${'①②③④⑤'[i] || ''} ${dE(o)}</button>`).join('')}</div>`;
    else b = `<div class="card">${q && dst.gpick !== undefined ? `<p>【判定】 <b class="${dst.gpick === q.answer ? 'drill-ok' : 'drill-ng'}">${dst.gpick === q.answer ? '〇' : '×'}</b> 正解：${dE(q.options[q.answer])}</p>` : ''}<b>📖 ${dE(c.g.name)}：導入の文を読みましょう</b>${intro}<button class="btn btn-primary" style="margin-top:8px;" onclick="drillPop()">読んだ → 次</button></div>`;
  }
  else if (c.t === 'msg') b = `<div class="card">${dE(c.h)}<br><button class="btn btn-primary" style="margin-top:8px;" onclick="drillPop()">次</button></div>`;
  else if (dst.ph === 9) b = dst.res + drillQaHTML();
  else if (c.t === 'c' && c.ck.choices) b = `<div class="card"><div class="hint-small">Check!${c.retry ? ' ・ 再出題' : ''}</div><p class="drill-q">${dE(c.ck.q)} <button class="chip" onclick="drillSpeakQ()">🔊</button></p>${dst.op.map((o, i) => `<button class="btn btn-secondary drill-opt" onclick="drillPick(${i})">${'①②③④⑤⑥'[i] || ''} ${dE(o)}</button>`).join('')}<button class="btn btn-secondary drill-opt" onclick="drillDk()">わからない</button></div>`;
  else if (c.t === 'c' || dst.ph === 0) {
    const q = c.t === 'c';
    b = `<div class="card">${q ? `<div class="hint-small">Check!${c.retry ? ' ・ 再出題' : ''}</div><p class="drill-q">${dE(c.ck.q)} <button class="chip" onclick="drillSpeakQ()">🔊</button></p>${/^\d/.test(c.ck.ans) ? '<div class="hint-small">番号で答えてください（複数なら「1,2」のように）</div>' : ''}`
      : `${W(c.it)}<div class="hint-small">${c.retry ? '再出題 ・ ' : ''}<span class="card-stars">${starsText(c.it.card.stars)}</span></div><p>${dst.msg ? dE(dst.msg) : (dst.ans.length ? '他にどのような意味（訳）がありますか？' : '和訳は？')}</p>${dst.cv && dst.cv.length && dst.sn ? `<div class="hint-small">⭕ ${dst.cv.map(i => dE(String(dst.sn[i].t).split('，')[0])).join('、')}　（あと${dst.sn.length - dst.cv.length}つ）</div>` : ''}`}
      <input id="drillInput" class="form-control" autocomplete="off" onkeydown="if(event.key==='Enter'&&!event.isComposing)drillSubmit()">
      <div class="drill-btns"><button class="btn btn-primary" onclick="drillSubmit()">回答</button><button class="btn btn-secondary" onclick="drillDk()">わからない</button></div></div>`;
  }
  else if (dst.ph === 3) { const x = dst.vk[dst.vi]; b = `<div class="card">${W(c.it)}<p>「${dE(x.t.join('，'))}」の意味のとき、自動詞？他動詞？</p><button class="btn btn-secondary drill-opt" onclick="drillAt2(1)">① 自動詞</button><button class="btn btn-secondary drill-opt" onclick="drillAt2(2)">② 他動詞</button></div>`; }
  else if (dst.ph === 1) b = `<div class="card">${W(c.it)}<p>この動詞は次のどれですか？${dst.extra && dst.extra.length ? '<br><b>単語帳に載っている意味についての質問です。</b>' : ''}</p><button class="btn btn-secondary drill-opt" onclick="drillAt(1)">① 自動詞</button><button class="btn btn-secondary drill-opt" onclick="drillAt(2)">② 他動詞</button><button class="btn btn-secondary drill-opt" onclick="drillAt(3)">③ 自動詞・他動詞の両方</button></div>`;
  else if (dst.ph === 2) b = `<div class="card">${W(c.it)}<p>【${dE(dst.z.k)}】この単語の${dE(dst.z.k)}として正しいものを選んでください。</p>${dst.op.map((o, i) => `<button class="btn btn-secondary drill-opt" onclick="drillCh(${i})">${'①②③④'[i]} ${dE(o)}</button>`).join('')}</div>`;
  const A = document.getElementById('drillApp');
  A.innerHTML = `<div class="drill-top"><span class="hint-small">${DS.r}周目 ・ 残り${DQ.length}問</span><span style="display:flex; gap:6px;"><button class="chip" onclick="drillToggleTts()" title="読み上げのオン・オフ">${drillTtsOn() ? '🔊' : '🔇'}</button><button class="chip" onclick="drillPause()">⏸ 一時離脱</button><button class="chip" onclick="drillQuit()">🏁 やめる</button></span></div>${dst.h || ''}${b}`;
  const i = document.getElementById('drillInput') || document.getElementById('drillQaInput'); if (i) i.focus();
}
function drillQuit() { drillSave(); drillHome(); }

// ---------------- 単語：和訳 ----------------
function drillSubmit() {
  if (dlock) return;
  const el = document.getElementById('drillInput'); const v = el ? el.value.trim() : ''; if (!v) return;
  if (/^(わから(な|ん)い|分から(な|ん)い|不明|知らない|しらない|パス|pass)$/i.test(v)) return drillDk();
  if (dcur.t === 'c') return drillChk(v);
  dst.ans.push(v); return drillJudge(v);
}
async function drillJudge(v) {
  const it = dcur.it; dst.cv = dst.cv || []; dst.mn = dst.mn || ''; dst.at = dst.at || {}; dst.msg = '';
  drillBusy();
  try {
    dst.sn = dst.sn || await drillGetSn(it);
    const local = drillLocalHits(v, dst.sn);
    // もう答えた意味だけをくり返したとき（言い換え・語形の違いを含む）は、×にせずに聞き直す
    if ((local && dst.cv.length && local.every(i => dst.cv.includes(i))) || (!local && drillIsRepeat(v, dst.sn, dst.cv))) {
      dlock = false; dst.ans.pop(); dst.msg = 'その意味はもう答えました。他の意味を答えてください。'; dst.ph = 0; drillDraw(); return;
    }
    let r;
    const ph = local ? null : drillPartHits(v, dst.sn); // 一部だけ単語帳の訳と同じとき
    const known = ph ? ph.hits.filter(i => !dst.cv.includes(i)) : [];
    const ask = ph && ph.unknown.length ? ph.unknown.join('、') : v;
    if (local) r = { hit: local.map(i => ({ i, exact: true })), extra: [], wrong: false, form: false, mention: 'none' };
    else if (!drillAiOk()) r = { hit: [], extra: [], wrong: true, form: false, mention: 'none' };
    else {
      const en = /^[\x00-\x7F’]+$/.test(it.w);
      const rem = dst.sn.map((x, i) => dst.cv.includes(i) || known.includes(i) ? '' : `${i}: ${x.p} ${x.t}`).filter(Boolean).join('\n');
      const done = dst.sn.filter((x, i) => dst.cv.includes(i) || known.includes(i)).map(x => x.t).join('、') || 'なし';
      r = await drillAi(`${en ? '英単語' : '語句（古文・漢文などを含む）'}「${it.w}」の${en ? '和訳' : '意味'}テストの採点。\n【未回答の正解の意味（番号: 品詞 訳）】\n${rem || 'なし'}\n【回答済みの意味】${done}\n【生徒の最新の回答】「${ask}」${en ? '' : '\n※英単語ではないので、品詞形の判定はしない（form は常に false）。単語帳の訳と同じ言葉は必ず hit（exact=true）にする。'}\n規則:\n- hit: 未回答リストの意味に当たる語句。{i:番号, exact:真偽}。exact=true は、単語帳の訳と同じ語（送り仮名・括弧・「〜」の違いは可）、またはほぼ同義で日本語のニュアンスが変わらない言い換え。exact=false は、意味は合うが単語帳の訳とニュアンスの違う別の言葉（例：単語帳が「社会の」で生徒が「社交的な」）。\n- 品詞形：名=名詞の形（社会、同情 など）、自/他/動=動詞形（〜する、〜を…する、〜に耐える）、形=「〜な」「〜い」「〜の」「〜的な」、副=「〜に」「〜く」「〜と」。意味が合っていても形がズレていれば form=true（hitに入れない）。\n- extra: 回答のうち、リストにも回答済みにも無いが、その英単語の辞書的に正しい意味（品詞は問わない。例：他動詞の「社会化する」）の語句の配列。\n- 厳しく判定する：hit は、未回答リストのその番号の意味そのものを答えているときだけ。回答済みの意味の言い換え・語形を変えたもの（例：回答済み「意思疎通」に対して「意思疎通すること」「意思を通じ合うこと」）を、未回答の別の意味（例：「通信」）に当てはめてはいけない。そういう回答は hit にも extra にも入れず repeat=true にする。迷ったら hit にしない。\n- repeat: 回答が、回答済みの意味をくり返しただけ（言い換え・語形の違いを含む）か。\n- wrong: 上のどれにも当たらない誤った語句が含まれるか。\n- mention: 生徒が自動詞・他動詞に言及したか（none / ji / ta）。\nJSONのみ：{"hit":[{"i":0,"exact":true}],"extra":[],"repeat":false,"wrong":false,"form":false,"mention":"none"}`);
    }
    dlock = false;
    if (known.length) { r.hit = [...known.map(i => ({ i, exact: true })), ...(Array.isArray(r.hit) ? r.hit : []).filter(h => !known.includes(+h.i))]; r.repeat = false; }
    if (r.repeat && !(Array.isArray(r.hit) && r.hit.length)) { dst.ans.pop(); dst.msg = 'その意味はもう答えました。他の意味を答えてください。'; dst.ph = 0; drillDraw(); return; }
    if (r.mention === 'ji' || r.mention === 'ta') { const a = drillAttr(it), j = /自動詞/.test(a), t = /他動詞/.test(a), ex = j && t ? 3 : j ? 1 : 2; dst.mn = (r.mention === 'ji' ? 1 : 2) === ex ? 'ok' : 'bad'; }
    const hs = (Array.isArray(r.hit) ? r.hit : []).filter(h => dst.sn[+h.i] && !dst.cv.includes(+h.i));
    hs.forEach(h => { const i = +h.i; if (h.exact) { if (!dst.cv.includes(i)) dst.cv.push(i); } else { dst.at[i] = (dst.at[i] || 0) + 1; (dst.alt = dst.alt || []).push({ i, said: ask }); } });
    // 「単語帳に載っていない意味」から、実は単語帳の訳と同じ言葉を除く（AI が取り違えることがあるため）
    if (Array.isArray(r.extra)) r.extra = r.extra.filter(x => String(x || '').trim() && !drillLocalHits(x, dst.sn));
    if (r.extra && r.extra.length) dst.extra = [...new Set((dst.extra || []).concat(r.extra))];
    const ex = !!(dst.extra && dst.extra.length), many = Object.values(dst.at).some(n => n >= 3);
    const none = !hs.length && !(r.extra && r.extra.length);
    if (r.form || r.wrong || many || none || (dst.mn === 'bad' && !ex)) {
      dst.tip = r.form ? '品詞（語尾）の形が合っていません。' : r.wrong ? (drillAiOk() ? '意味が違います。' : '単語帳の訳と違います（AI が使えないため、言い換えは判定できません）。') : none ? '他の意味を答えられませんでした。' : many ? '単語帳の訳を思い出せませんでした。' : '自動詞・他動詞の言及が違います。';
      return drillFin(false);
    }
    if (dst.cv.length < dst.sn.length) {
      dst.msg = hs.some(h => !h.exact) ? '意味は合っています。単語帳に載っている訳で答えてください。' : ex && !hs.length ? '辞書的には正しい意味ですが、単語帳には載っていません。単語帳に載っている意味を答えてください。' : '';
      dst.ph = 0; drillDraw(); return;
    }
    // ★【0.03.47】元の試作と同じく、動詞は「自動詞？他動詞？両方？」→（両方なら）意味ごとに自動詞か他動詞か
    if (drillIsVerb(it) && !(dst.mn === 'ok' && !ex)) { dst.ph = 1; drillDraw(); return; }
    drillQuiz();
  } catch (e) { dst.ans.pop(); drillErr(e); }
}
// 意味は合うが単語帳の訳と違う言葉で答えたとき、そのニュアンスの違いを解説（似た単語があれば、その単語にも注意を残す）
async function drillExpl(it) {
  const seen = {}, al = dst.alt.filter(a => !seen[a.i] && (seen[a.i] = 1));
  const cands = DG[it.gi].items.filter(x => x !== it).map(x => `${x.id}: ${x.w} ${x.m}`).join('\n');
  return Promise.all(al.map(async a => {
    const r = await drillAi(`英単語「${it.w}」の単語帳の訳は「${dst.sn[a.i].t}」。生徒は「${a.said}」と答えた（意味は合っている）。\n同じグループの語:\n${cands}\n次をJSONで出力:\nexp: 単語帳の訳と生徒の言葉のニュアンスの違いを日本語で60字以内で解説。英単語・語名は絶対に書かない。\nlike: 生徒の言葉が単語帳の訳に近い、上記の語のid（なければnull）。\ndiff: ${it.w} とその語の違いを日本語で80字以内で簡潔に（英単語はこの2語のみ使用可）。likeがnullなら空文字。\n{"exp":"","like":null,"diff":""}`);
    if (r.like && DI[r.like] && r.diff) { const t = `【${it.w} との違い】${r.diff}`, l = DS.ct[r.like] = DS.ct[r.like] || []; if (!l.includes(t)) l.push(t); }
    return { said: a.said, exp: r.exp || '' };
  }));
}
function drillDk() {
  if (dlock) return;
  if (dcur.t === 'c') drillFin(false, dcur.ck.ans, '');
  else { dst.tip = '「わからない」のため×です。'; drillFin(false); }
}

// ---------------- Check!（Review Test） ----------------
function drillPick(i) { if (dlock) return; drillFin(isAnswerCorrect(dst.op[i], dcur.ck.ans), dcur.ck.ans, ''); }
async function drillChk(v) {
  const k = dcur.ck, n = x => x.toLowerCase().replace(/[\s.．。、,，\/／・]/g, ''), sp = x => x.split(/[\/／,、]/).map(n).filter(Boolean).sort().join('|');
  if (/^\d\.?(\s*[\/,]\s*\d\.?)*$/.test(k.ans)) return drillFin(v.replace(/\D/g, '') === k.ans.replace(/\D/g, ''), k.ans, '');
  if (/^[A-Za-z0-9.\s\/'’-]+$/.test(k.ans)) return drillFin(sp(v) === sp(k.ans), k.ans, '');
  if (n(v) === n(k.ans) || sp(v) === sp(k.ans) || isAnswerCorrect(v, k.ans)) return drillFin(true, k.ans, '');
  if (!drillAiOk()) return drillFin(false, k.ans, '');
  drillBusy();
  try { const r = await drillAi(`問題:${k.q}\n正解:${k.ans}\n生徒の答え:${v}\n意味が同じなら ok。順序の違い・表記の軽微な違いは許容。JSONのみ：{"v":"ok|x"}`); dlock = false; drillFin(r.v === 'ok', k.ans, ''); }
  catch (e) { drillErr(e); }
}

// ---------------- 自動詞・他動詞 ----------------
function drillAt(n) {
  if (dlock) return;
  const a = drillAttr(dcur.it), j = /自動詞/.test(a), t = /他動詞/.test(a), ex = j && t ? 3 : j ? 1 : 2;
  if (n !== ex) { dst.tip = '自動詞・他動詞の属性が違います。'; return drillFin(false); }
  const m = new Map();
  dst.sn.forEach(x => { if (x.p === '自' || x.p === '他') { const o = m.get(x.c) || { p: x.p, t: [] }; o.t.push(x.t); m.set(x.c, o); } });
  dst.vk = [...m.values()];
  if (ex === 3 && new Set(dst.vk.map(x => x.p)).size > 1) { dst.vi = 0; dst.ph = 3; drillDraw(); } else drillQuiz();
}
function drillAt2(n) {
  if (dlock) return;
  const x = dst.vk[dst.vi];
  if (n !== (x.p === '自' ? 1 : 2)) { dst.tip = `「${x.t.join('，')}」の意味のときは${x.p}動詞です。`; return drillFin(false); }
  dst.vi++; dst.vi < dst.vk.length ? drillDraw() : drillQuiz();
}

// ---------------- 対義語・類義語・ニュアンスの4択 ----------------
// メモ・答えの「↔ 単語」「= 単語」から（語源の「rive = river」や、例として並べた「regular ↔ irregular」は使わない）
// ★【0.03.44】記号の左にある語句（その行の、句読点・カッコのあとから。「X (= Y)」の形なら X）
function drillRelLeft(src, idx) {
  let s = src.slice(0, idx).split('\n').pop().replace(/\s+$/, '');
  if (/[(（]$/.test(s)) s = s.slice(0, -1);
  const l = s.replace(/「[^」]*」/g, '').replace(/^.*[。、；;（(／/:：]/, '').trim();
  return /[A-Za-z]/.test(l) ? l : ''; // 訳（日本語）の中の「（＝treasure）」は見出し語についてのもの
}
const drillSameWord = (a, w) => String(a).trim().toLowerCase() === String(w).trim().toLowerCase();
function drillArrowWords(src, w) {
  const out = []; const re = /[↔⇔]\s*([A-Za-z][A-Za-z \-'.]*[A-Za-z])/g; let m;
  while ((m = re.exec(src))) {
    const left = drillRelLeft(src, m.index), right = m[1].trim();
    // 「normal ↔ abnormal」「↔ abnormal」は normal の対義語。「abnormal ↔ normal」なら左が対義語（abnormal は normal で終わるが別の語）
    if (drillSameWord(right, w)) { const l = (left.match(/([A-Za-z][A-Za-z\-']*)$/) || [])[1]; if (l && !drillSameWord(l, w)) out.push(l); }
    else if (!left || drillSameWord(left, w)) out.push(right);
  }
  return [...new Set(out)];
}
// 類義語：「= 単語」が、その見出し語そのものについてのもの（「by accident (= accidentally)」は by accident の言い換えなので使わない）。
//  見出し語の派生語（accident と accidentally など）は類義語にしない
function drillSynWords(src, w) {
  const out = []; const re = /[=＝≒]\s*([A-Za-z][A-Za-z ,\-']*[A-Za-z])/g; let m;
  const lw = String(w).toLowerCase(), stem = lw.slice(0, Math.max(4, lw.length - 2));
  while ((m = re.exec(src))) {
    const left = drillRelLeft(src, m.index);
    if (left && !drillSameWord(left, w)) continue;
    m[1].split(',').map(x => x.trim()).filter(Boolean).forEach(s => {
      const ls = s.toLowerCase();
      if (ls === lw || ls.startsWith(stem) || lw.startsWith(ls.slice(0, Math.max(4, ls.length - 2)))) return;
      if (!out.includes(s)) out.push(s);
    });
  }
  return out;
}
function drillRelQs(it) {
  const z = [], note = String(it.card.note || ''), src = it.m + '\n' + note;
  const ants = drillArrowWords(src, it.w);
  const ants2 = ants.filter(a => !drillSameWord(a, it.w));
  if (ants2.length) z.push({ k: '対義語', a: ants2[0], all: ants2.join(', ') });
  // ★【0.03.46】元の試作と同じく、補足（メモの1行目）に「比べ・より・に対し・否定的」があればニュアンスの4択
  const n1 = note.split('\n')[0].trim();
  if (n1 && n1.length <= 120 && /比べ|より|に対し|否定的|ニュアンス/.test(n1)) z.push({ k: 'ニュアンス・特徴', a: n1 });
  const sy = drillSynWords(src, it.w);
  if (sy.length) z.push({ k: '類義語', a: sy[0], all: sy.join(', ') });
  return z;
}
function drillQuiz() { dst.z0 = drillAiOk() ? drillRelQs(dcur.it) : []; dst.qi = 0; drillNq(); }
async function drillNq() {
  if (dst.qi >= dst.z0.length) return drillFin(true);
  const z = dst.z0[dst.qi], it = dcur.it;
  drillBusy();
  try {
    const r = await drillAi(`英単語「${it.w}」（${it.m}）の「${z.k}」を問う4択問題の不正解選択肢を3つ作れ。正解:「${z.a}」${z.all ? `（${z.all}はいずれも正解なので不正解に含めない）` : ''}。紛らわしいが明確に誤りのもの（類義語と対義語の入れ替え、似た単語の特徴、逆の意味など）で、正解と同じ形式・同程度の長さにする。JSONのみ：{"wrong":["","",""]}`);
    // 正解（と、正解として認めるもの）と同じ選択肢・重なった選択肢は除く
    const nz = x => String(x || '').toLowerCase().replace(/[\s　。、,，.・]/g, '');
    const ok = new Set([z.a, ...String(z.all || '').split(/[,、]/)].map(nz).filter(Boolean));
    const wrong = [];
    (Array.isArray(r.wrong) ? r.wrong : []).forEach(w => { const n = nz(w); if (n && !ok.has(n) && !wrong.some(x => nz(x) === n)) wrong.push(String(w).trim()); });
    dlock = false;
    if (wrong.length < 2) { dst.qi++; return drillNq(); } // 選択肢が作れなかったら、この問題は飛ばす
    dst.z = z; dst.op = dShuffle([z.a, ...wrong.slice(0, 3)]); dst.ci = dst.op.indexOf(z.a); dst.ph = 2; drillDraw();
  } catch (e) { dlock = false; dst.qi = 99; drillFin(true); }
}
function drillCh(i) { if (dlock) return; i === dst.ci ? (dst.qi++, drillNq()) : drillFin(false, `${dst.z.k}：${dst.z.a}`); }

// ---------------- 結果 ----------------
// 各周の1回目の答えだけ、いつものレベルに反映する
// ★【0.03.29】正解・不正解の回数は、暗記テストだけで数える（いつものレベル・成績は動かさない）。各周の1回目の答えだけ
// card.drillStats = { c: 正解, w: 不正解, at: 最後に答えた時刻 }（カードの成績と一緒に同期する）
function drillRecord(card, ok) {
  const k = DS.r + ':' + card.id;
  if (DS.rec[k]) return; DS.rec[k] = 1;
  const m = db.find(q => q.id === card.id); if (!m) return;
  const st = Object.assign({ c: 0, w: 0 }, m.drillStats || {});
  if (ok) st.c++; else st.w++;
  st.at = Date.now();
  if (typeof raceCountDrill === 'function') raceCountDrill(st, ok); // ★【0.03.42】今週の正解数（プランバトル）
  m.drillStats = st;
  touchStats(m); saveData();
  // 学習した記録（ヒートマップ・催促）には入れる。ランキング・フレンドとの比較は暗記テストの分として別に数える
  if (typeof recordDailyLog === 'function') recordDailyLog(ok, { drill: true });
  if (typeof recordCategoryScore === 'function') recordCategoryScore(m.category, ok, 'drill');
  if (typeof raceSync === 'function') raceSync();
}
async function drillFin(ok, ans, tip) {
  if (dst.fl) return; dst.fl = 1;
  const c = dcur, k = dKey(c);
  drillRecord(c.it ? c.it.card : c.ck.card, ok);
  if (!ok) {
    if (!DS.miss.has(k)) { DS.miss.set(k, c); if (DS.r === 1 && !DS.rv && c.it) DS.gm.push(c.it); }
    DQ.unshift(c.it ? { t: 'q', it: c.it, retry: true } : { t: 'c', ck: c.ck, retry: true });
  }
  if (c.it && dst.alt && dst.alt.length && drillAiOk()) { drillBusy(); try { dst.ex = await drillExpl(c.it); } catch (e) { dst.ex = []; } dlock = false; }
  let official;
  if (ans) official = dE(ans);
  else { const seg = parseStructuredAnswer(c.it.m); official = seg ? formatStructuredAnswerHTML(seg) : dE(c.it.m); }
  const ns = [];
  if (tip !== undefined) { if (tip) ns.push(tip); }
  else { if (dst.tip) ns.push(dst.tip); if (c.it && c.it.card.note) ns.push(c.it.card.note); }
  if (dst.extra && dst.extra.length) ns.push(`「${dst.extra.join('」「')}」は辞書的には正しい意味ですが、単語帳には載っていません。`);
  (dst.ex || []).forEach(x => ns.push(`「${x.said}」について：${x.exp}`));
  ((c.it && DS.ct[c.it.id]) || []).forEach(t => ns.push(t));
  dst.ph = 9;
  if (drillTtsOn()) drillSpeakA();
  dst.res = `<div class="card ${ok ? 'drill-ok-card' : 'drill-ng-card'}">${c.it ? `<div class="drill-word">${dE(c.it.w)}</div>` : `<p class="drill-q">${dE(c.ck.q)}</p>`}
    <p>【判定】 <b class="${ok ? 'drill-ok' : 'drill-ng'}">${ok ? '〇' : '×'}</b>${!ok ? '<span class="hint-small">（あとでもう一度出ます）</span>' : ''}${drillStatsText(c)}</p>
    <div>【公式の答え】 <button class="chip" onclick="drillSpeakA()" title="答えを読み上げる">🔊</button> ${official}</div>
    ${ns.length ? `<p>【解説・注意点】<br>${ns.map(dE).join('<br>')}</p>` : ''}
    <div class="drill-btns"><button class="btn btn-primary" onclick="drillPop()">次</button>${drillAiOk() ? '<button class="btn btn-secondary" onclick="drillQo()">💬 質問する</button>' : ''}</div></div>`;
  drillSave(); drillDraw();
}
function drillStatsText(c) {
  const m = db.find(q => q.id === (c.it ? c.it.card.id : c.ck.card.id));
  const st = m && m.drillStats;
  return st ? ` <span class="hint-small">（暗記テスト通算 〇${st.c} ×${st.w}）</span>` : '';
}
// AI に質問する
function drillQaHTML() {
  return (dst.qa || []).map(x => `<div class="card"><div class="hint-small">Q：${dE(x.q)}</div>${dE(x.a).replace(/\n/g, '<br>')}</div>`).join('') +
    (dst.qo ? `<div class="card"><input id="drillQaInput" class="form-control" placeholder="質問を入力" onkeydown="if(event.key==='Enter'&&!event.isComposing)drillAsk()"><button class="btn btn-primary" style="margin-top:6px;" onclick="drillAsk()">送信</button></div>` : '');
}
function drillQo() { dst.qo = !dst.qo; drillDraw(); }
async function drillAsk() {
  if (dlock) return;
  const q = (document.getElementById('drillQaInput') || {}).value; if (!q || !q.trim()) return;
  drillBusy();
  const c = dcur;
  const ctx = c.it ? `単語:${c.it.w}／意味:${c.it.m}／属性:${drillAttr(c.it)}／補足:${c.it.card.note || ''}` : `Check問題:${c.ck.q}／正解:${c.ck.ans}`;
  try {
    const a = await aiRequest('あなたは英単語の家庭教師です。', [{ text: `${ctx}\n生徒の質問:${q.trim()}\n簡潔に（200字程度）日本語で答える。` }], { maxTokens: 600, timeout: 20000, totalTimeout: 30000 });
    (dst.qa = dst.qa || []).push({ q: q.trim(), a: cleanAiHintText(String(a).replace(/\*\*|`/g, '')) }); dst.qo = false; dlock = false; drillDraw();
  } catch (e) { drillErr(e); }
}
