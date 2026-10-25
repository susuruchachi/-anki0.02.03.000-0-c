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
const DRILL_SENSE_CACHE = 'susuru_anki_drill_senses';
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
function drillIsCheckCard(q) { return q.kind === 'test' || (Array.isArray(q.choices) && q.choices.length >= 2 && q.kind !== 'cloze'); }
function drillBuild(cat) {
  const order = getSortedCategoriesForMenu();
  const inScope = cat ? new Set(getAllSubcategories(cat)) : null;
  const cats = order.filter(c => !inScope || inScope.has(c));
  const byCat = {};
  db.forEach(q => { (byCat[q.category] = byCat[q.category] || []).push(q); });
  DG = []; let o = 0;
  const groupOf = {};
  cats.forEach(c => {
    const cards = sortCardsByNumber((byCat[c] || []).slice());
    const words = cards.filter(drillIsWordCard), checks = cards.filter(drillIsCheckCard);
    let g = null;
    if (words.length) { g = { name: c, items: [], checks: [] }; DG.push(g); }
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
    g.chk.forEach(c => { DCK[c.key] = c; });
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
    parts.forEach(x => { x = x.trim(); if (!x) return; const ws = splitAnswerMeanings(x); out.push({ p, t: (ws.length ? ws : [x]).join('，'), c }); });
  });
  return out;
}
function drillLoadSenseCache() { try { return JSON.parse(localStorage.getItem(DRILL_SENSE_CACHE) || '{}') || {}; } catch (e) { return {}; } }
function drillGetSn(it) { return DP[it.id] || (DP[it.id] = drillGroupSenses(it)); }
// 「，」でつないだ訳を、ニュアンスの違う意味ごとに AI に分けてもらう（結果は端末に保存して使い回す）
async function drillGroupSenses(it) {
  if (DS.sp && DS.sp[it.id]) return DS.sp[it.id];
  const cache = drillLoadSenseCache(), c = cache[it.id];
  if (c && c.a === it.m && Array.isArray(c.s)) return (DS.sp[it.id] = c.s);
  const b = drillSenses(it), cm = b.filter(x => /[，,]/.test(x.t));
  const save = out => { DS.sp[it.id] = out; if (out !== b) { cache[it.id] = { a: it.m, s: out }; const ks = Object.keys(cache); if (ks.length > 3000) delete cache[ks[0]]; try { localStorage.setItem(DRILL_SENSE_CACHE, JSON.stringify(cache)); } catch (e) {} } return out; };
  if (!cm.length || !drillAiOk()) return (DS.sp[it.id] = b);
  try {
    const r = await drillAi(`日本語訳の分類。各行の「，」で区切られた訳について、日本語としてニュアンスが異なり別の意味として覚えるべきものは別グループに、ほぼ同義の言い換えは同じグループにする。迷う場合は同じグループにする。\n${cm.map((x, i) => `${i}: ${x.t}`).join('\n')}\nJSONのみ。行ごとのグループ配列を並べる。例：{"r":[[["社交的な"],["愛想のいい"]],[["親しい","親密な"]]]}`);
    let k = 0; const out = [];
    b.forEach(x => {
      if (!cm.includes(x)) { out.push(x); return; }
      const gr = r.r && r.r[k++];
      if (Array.isArray(gr) && gr.length && gr.every(Array.isArray)) gr.forEach(g => out.push({ p: x.p, c: x.c, t: g.join('，') }));
      else out.push(x);
    });
    return save(out);
  } catch (e) { delete DP[it.id]; return b; }
}
// AI を使わずに分かる答え（単語帳の訳と同じ言葉だけ）。答えた言葉が全部どれかの意味に当たれば、その意味の番号
function drillLocalHits(v, sn) {
  const parts = String(v).split(/[、,，\s　・／/]+/).filter(p => normalizeStructuredToken(p) !== '');
  if (!parts.length) return null;
  const forms = sn.map(x => new Set(String(x.t).split(/[，,]/).flatMap(w => structuredTokenForms(w))));
  const hits = [];
  for (const p of parts) {
    const n = normalizeStructuredToken(p);
    const i = forms.findIndex(f => f.has(n));
    if (i < 0) return null;
    if (!hits.includes(i)) hits.push(i);
  }
  return hits;
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
function drillScopeCategory() {
  const p = (selectedScopePath && selectedScopePath.length ? selectedScopePath : lastQuizScopePath) || [];
  const c = p.length && p[0] !== 'all' ? p[p.length - 1] : '';
  return categories.includes(c) ? c : '';
}
function openDrill() { openPage('pgDrill'); drillHome(); }
function drillHome() {
  dlock = false;
  let d = null; try { d = JSON.parse(localStorage.getItem(DRILL_KEY)); } catch (e) {}
  const cat = drillScopeCategory();
  drillBuild(cat);
  const words = DG.reduce((n, g) => n + g.items.length, 0), checks = DG.reduce((n, g) => n + g.chk.length, 0);
  const A = document.getElementById('drillApp');
  A.innerHTML = (d ? `<div class="card"><b>途中経過が保存されています</b><div class="hint-small">📁 ${dE(d.cat || 'すべて')} ・ ${d.r}周目 ・ 残り${(d.Q || []).length}問</div><button class="btn btn-primary" style="margin-top:8px;" onclick="drillResume()">▶️ 続きから</button></div>` : '') +
    `<div class="card"><div class="setting-box-title">📝 暗記テスト</div>
      <div class="hint-small" style="margin-bottom:8px;">${d ? '最初からやり直す場合：' : ''}ホームの「出題範囲」で選んだフォルダーで始めます。</div>
      <div><b>📁 ${dE(cat || 'すべてのフォルダー')}</b></div>
      <div class="hint-small">グループ ${DG.length} ・ 単語 ${words} 語 ・ Check! ${checks} 問</div>
      ${drillAiOk() ? '' : '<div class="hint-small drill-ng" style="margin-top:6px;">⚠️ AI が使えないため、単語帳の訳と同じ言葉だけを正解にします（言い換えの判定・意味のまとめ・4択・解説・質問は使えません）。設定 → 🤖 AI でキーを入れると使えます。</div>'}
      <button class="btn btn-start" style="margin-top:10px;" onclick="drillStart()" ${words + checks ? '' : 'disabled'}>🚀 開始</button>
      <div class="hint-small" style="margin-top:8px;">・グループ（フォルダー）ごとに、単語の<b>全部の意味</b>を答えます（ほぼ同じ意味の訳は、どれか1つで OK）<br>・間違えたら、その場でもう一度出ます。グループの最後に、そのグループで間違えた単語と Check!（Review Test）<br>・1周目で間違えた問題を2周目で…と、全部〇になるまで続けます<br>・各周の1回目の答えだけ、いつものレベルに反映します</div>
    </div>`;
}
function drillStart() {
  if (!DG.length) return alert('この範囲に単語のカードがありません。');
  DS = { cat: drillScopeCategory(), r: 1, gi: 0, miss: new Map(), gm: [], rv: false, hdr: null, ct: {}, sp: {}, rec: {} };
  DQ = []; drillPop();
}
function drillSer(s) { return s.t === 'q' ? { t: 'q', id: s.it.id, retry: s.retry } : s.t === 'c' ? { t: 'c', key: s.ck.key, retry: s.retry } : s.t === 'msg' ? { t: 'msg', h: s.h } : { t: s.t, g: DG.indexOf(s.g) }; }
function drillDe(o) {
  if (o.t === 'q') return DI[o.id] ? { t: 'q', it: DI[o.id], retry: o.retry } : null;
  if (o.t === 'c') return DCK[o.key] ? { t: 'c', ck: DCK[o.key], retry: o.retry } : null;
  if (o.t === 'msg') return o;
  return DG[o.g] ? { t: o.t, g: DG[o.g] } : null;
}
function drillSave() {
  try { localStorage.setItem(DRILL_KEY, JSON.stringify({ cat: DS.cat, r: DS.r, gi: DS.gi, rv: DS.rv, gm: DS.gm.map(x => x.id), miss: [...DS.miss.values()].map(drillSer), ct: DS.ct, rec: DS.rec, Q: [dcur, ...DQ].filter(Boolean).map(drillSer), hg: DS.hdr ? DG.indexOf(DS.hdr) : -1 })); } catch (e) {}
}
function drillResume() {
  try {
    const d = JSON.parse(localStorage.getItem(DRILL_KEY));
    drillBuild(d.cat && categories.includes(d.cat) ? d.cat : '');
    DS = { cat: d.cat, r: d.r, gi: d.gi, rv: d.rv, miss: new Map(), gm: (d.gm || []).map(i => DI[i]).filter(Boolean), hdr: d.hg >= 0 ? DG[d.hg] : null, ct: d.ct || {}, sp: {}, rec: d.rec || {} };
    (d.miss || []).map(drillDe).filter(Boolean).forEach(x => DS.miss.set(dKey(x), x));
    DQ = (d.Q || []).map(drillDe).filter(Boolean);
    drillPop();
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
  if (dcur.t === 'c' && dcur.ck.choices) dst.op = dShuffle(dcur.ck.choices.slice());
  [dcur, ...DQ].filter(x => x.t === 'q').slice(0, 2).forEach(x => drillGetSn(x.it)); // 次の単語の意味のまとめを先に
  drillSave(); drillDraw();
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
    try { localStorage.removeItem(DRILL_KEY); } catch (e) {}
    A.innerHTML = `<div class="card"><b>🎉 ${DS.r}周目で全問〇になりました</b><p>【合格】おめでとうございます。</p><button class="btn btn-secondary" onclick="drillHome()">戻る</button></div>`;
    return;
  }
  const p = DS.r; DS.r++; DS.miss = new Map();
  DQ = [{ t: 'msg', h: `【${DS.r}周目開始】${p}周目で間違えた${L.length}問の復習に入ります。` }, ...L.map(s => s.it ? { t: 'q', it: s.it } : { t: 'c', ck: s.ck })];
  drillPop();
}

// ---------------- 画面 ----------------
function drillDraw() {
  if (DS.hdr) { dst.h = `<div class="card drill-group"><b>📁 ${dE(DS.hdr.name)}</b><div class="hint-small">${DS.hdr.items.length}語${DS.hdr.chk.length ? ` ・ Check! ${DS.hdr.chk.length}問` : ''}</div></div>`; DS.hdr = null; }
  const c = dcur; let b = '';
  const W = it => `<div class="drill-word">${dE(it.w)}</div>`;
  if (c.t === 'msg') b = `<div class="card">${dE(c.h)}<br><button class="btn btn-primary" style="margin-top:8px;" onclick="drillPop()">次</button></div>`;
  else if (dst.ph === 9) b = dst.res + drillQaHTML();
  else if (c.t === 'c' && c.ck.choices) b = `<div class="card"><div class="hint-small">Check!${c.retry ? ' ・ 再出題' : ''}</div><p class="drill-q">${dE(c.ck.q)}</p>${dst.op.map((o, i) => `<button class="btn btn-secondary drill-opt" onclick="drillPick(${i})">${'①②③④⑤⑥'[i] || ''} ${dE(o)}</button>`).join('')}<button class="btn btn-secondary drill-opt" onclick="drillDk()">わからない</button></div>`;
  else if (c.t === 'c' || dst.ph === 0) {
    const q = c.t === 'c';
    b = `<div class="card">${q ? `<div class="hint-small">Check!${c.retry ? ' ・ 再出題' : ''}</div><p class="drill-q">${dE(c.ck.q)}</p>${/^\d/.test(c.ck.ans) ? '<div class="hint-small">番号で答えてください（複数なら「1,2」のように）</div>' : ''}`
      : `${W(c.it)}<div class="hint-small">${c.retry ? '再出題' : ''}</div><p>${dst.msg ? dE(dst.msg) : (dst.ans.length ? '他にどのような意味（訳）がありますか？' : '和訳は？')}</p>${dst.cv && dst.cv.length && dst.sn ? `<div class="hint-small">⭕ ${dst.cv.map(i => dE(String(dst.sn[i].t).split('，')[0])).join('、')}　（あと${dst.sn.length - dst.cv.length}つ）</div>` : ''}`}
      <input id="drillInput" class="form-control" autocomplete="off" onkeydown="if(event.key==='Enter'&&!event.isComposing)drillSubmit()">
      <div class="drill-btns"><button class="btn btn-primary" onclick="drillSubmit()">回答</button><button class="btn btn-secondary" onclick="drillDk()">わからない</button></div></div>`;
  }
  else if (dst.ph === 3) { const x = dst.vk[dst.vi]; b = `<div class="card">${W(c.it)}<p>「${dE(x.t.join('，'))}」の意味のとき、自動詞？他動詞？</p><button class="btn btn-secondary drill-opt" onclick="drillAt2(1)">① 自動詞</button><button class="btn btn-secondary drill-opt" onclick="drillAt2(2)">② 他動詞</button></div>`; }
  else if (dst.ph === 1) b = `<div class="card">${W(c.it)}<p>この動詞は次のどれですか？${dst.extra && dst.extra.length ? '<br><b>単語帳に載っている意味についての質問です。</b>' : ''}</p><button class="btn btn-secondary drill-opt" onclick="drillAt(1)">① 自動詞</button><button class="btn btn-secondary drill-opt" onclick="drillAt(2)">② 他動詞</button><button class="btn btn-secondary drill-opt" onclick="drillAt(3)">③ 自動詞・他動詞の両方</button></div>`;
  else if (dst.ph === 2) b = `<div class="card">${W(c.it)}<p>【${dE(dst.z.k)}】この単語の${dE(dst.z.k)}として正しいものを選んでください。</p>${dst.op.map((o, i) => `<button class="btn btn-secondary drill-opt" onclick="drillCh(${i})">${'①②③④'[i]} ${dE(o)}</button>`).join('')}</div>`;
  const A = document.getElementById('drillApp');
  A.innerHTML = `<div class="drill-top"><span class="hint-small">${DS.r}周目 ・ 残り${DQ.length}問</span><button class="chip" onclick="drillQuit()">✕ 中断</button></div>${dst.h || ''}${b}`;
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
    // もう答えた意味だけをくり返したときは、×にせずに聞き直す
    if (local && dst.cv.length && local.every(i => dst.cv.includes(i))) {
      dlock = false; dst.ans.pop(); dst.msg = 'その意味はもう答えました。他の意味を答えてください。'; dst.ph = 0; drillDraw(); return;
    }
    let r;
    if (local) r = { hit: local.map(i => ({ i, exact: true })), extra: [], wrong: false, form: false, mention: 'none' };
    else if (!drillAiOk()) r = { hit: [], extra: [], wrong: true, form: false, mention: 'none' };
    else {
      const rem = dst.sn.map((x, i) => dst.cv.includes(i) ? '' : `${i}: ${x.p} ${x.t}`).filter(Boolean).join('\n');
      const done = dst.sn.filter((x, i) => dst.cv.includes(i)).map(x => x.t).join('、') || 'なし';
      r = await drillAi(`英単語「${it.w}」の和訳テストの採点。\n【未回答の正解の意味（番号: 品詞 訳）】\n${rem}\n【回答済みの意味】${done}\n【生徒の最新の回答】「${v}」\n規則:\n- hit: 未回答リストの意味に当たる語句。{i:番号, exact:真偽}。exact=true は、単語帳の訳と同じ語（送り仮名・括弧・「〜」の違いは可）、またはほぼ同義で日本語のニュアンスが変わらない言い換え。exact=false は、意味は合うが単語帳の訳とニュアンスの違う別の言葉（例：単語帳が「社会の」で生徒が「社交的な」）。\n- 品詞形：名=名詞の形（社会、同情 など）、自/他/動=動詞形（〜する、〜を…する、〜に耐える）、形=「〜な」「〜い」「〜の」「〜的な」、副=「〜に」「〜く」「〜と」。意味が合っていても形がズレていれば form=true（hitに入れない）。\n- extra: 回答のうち、リストにも回答済みにも無いが、その英単語の辞書的に正しい意味（品詞は問わない。例：他動詞の「社会化する」）の語句の配列。\n- wrong: 上のどれにも当たらない誤った語句が含まれるか。\n- mention: 生徒が自動詞・他動詞に言及したか（none / ji / ta）。\nJSONのみ：{"hit":[{"i":0,"exact":true}],"extra":[],"wrong":false,"form":false,"mention":"none"}`);
    }
    dlock = false;
    if (r.mention === 'ji' || r.mention === 'ta') { const a = drillAttr(it), j = /自動詞/.test(a), t = /他動詞/.test(a), ex = j && t ? 3 : j ? 1 : 2; dst.mn = (r.mention === 'ji' ? 1 : 2) === ex ? 'ok' : 'bad'; }
    const hs = (Array.isArray(r.hit) ? r.hit : []).filter(h => dst.sn[+h.i] && !dst.cv.includes(+h.i));
    hs.forEach(h => { const i = +h.i; if (h.exact) { if (!dst.cv.includes(i)) dst.cv.push(i); } else { dst.at[i] = (dst.at[i] || 0) + 1; (dst.alt = dst.alt || []).push({ i, said: v }); } });
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
function drillArrowWords(src, w) {
  const out = []; const re = /↔\s*([A-Za-z][A-Za-z \-'.]*[A-Za-z])/g; let m;
  while ((m = re.exec(src))) {
    const left = src.slice(0, m.index).split('\n').pop().replace(/「[^」]*」/g, '').replace(/^.*[。、；;（(]/, '').trim();
    if (!left || left.toLowerCase().endsWith(String(w).toLowerCase())) out.push(m[1].trim());
  }
  return out;
}
function drillRelQs(it) {
  const z = [], note = String(it.card.note || ''), src = it.m + '\n' + note;
  const ants = drillArrowWords(src, it.w);
  if (ants.length) z.push({ k: '対義語', a: ants[0], all: ants.join(', ') });
  if (note.length <= 60 && /比べ|に対し|否定的|ニュアンス/.test(note)) z.push({ k: 'ニュアンス・特徴', a: note });
  const sy = src.match(/(?:^|[\n（(。、；;]\s*)[=＝≒]\s*([A-Za-z][A-Za-z \-']*[A-Za-z])/);
  if (sy) z.push({ k: '類義語', a: sy[1].trim(), all: sy[1].trim() });
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
function drillRecord(card, ok) {
  const k = DS.r + ':' + card.id;
  if (DS.rec[k]) return; DS.rec[k] = 1;
  const m = db.find(q => q.id === card.id); if (!m || typeof applySrsResult !== 'function') return;
  const W = srsSpeedWeights((document.getElementById('selQuizSpeed') || {}).value || 'normal');
  const list = typeof cardSenseList === 'function' ? cardSenseList(m) : null;
  if (list && list.length && ensureSenseStats(m)) list.forEach((sn, i) => { if (m.senses[sn.key]) applySrsResult(m, sn.key, ok, { gain: W.up, loss: W.down, noCategory: i > 0 }); });
  else applySrsResult(m, null, ok, { gain: W.up, loss: W.down });
  if (typeof recordDailyLog === 'function') recordDailyLog(ok);
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
  dst.res = `<div class="card ${ok ? 'drill-ok-card' : 'drill-ng-card'}">${c.it ? `<div class="drill-word">${dE(c.it.w)}</div>` : `<p class="drill-q">${dE(c.ck.q)}</p>`}
    <p>【判定】 <b class="${ok ? 'drill-ok' : 'drill-ng'}">${ok ? '〇' : '×'}</b>${!ok ? '<span class="hint-small">（あとでもう一度出ます）</span>' : ''}</p>
    <div>【公式の答え】 ${official}</div>
    ${ns.length ? `<p>【解説・注意点】<br>${ns.map(dE).join('<br>')}</p>` : ''}
    <div class="drill-btns"><button class="btn btn-primary" onclick="drillPop()">次</button>${drillAiOk() ? '<button class="btn btn-secondary" onclick="drillQo()">💬 質問する</button>' : ''}</div></div>`;
  drillSave(); drillDraw();
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
