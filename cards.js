// ================================================================
// ★【0.04.30】🃏 カードモード（めくって覚える）
// ・出す問題は暗記テストと同じ（drillBuild のグループ：単語・熟語と、グループの最後の Check!）
// ・グループの中を10問くらいずつの「まとまり」に分ける。100 と 100-1 のような同じ番号の仲間は分けない（101 の手前で区切る）
// ・カードをタップすると答え。右に振ったら「わかる」、左に振ったら「わからない」（ボタン・← → キーでも）
// ・「わかる」が3回になったカードは、次に出たときに記述のテスト（Check! は選択肢）。
//   正解なら「覚えた」（もう出さない）。間違えたら「わかる」を0に戻し、「わからない」を2回ぶん足す
// ・まとまりの中を、全部「覚えた」になるまで周回する。終わったら次のまとまりへ
// ・成績は cardProg（storage.js。端末間で同期）。いつもの成績（レベル・正解数）や暗記テストの記録とは別。
//   学習した日（連続記録）には数える
// ================================================================
const CARD_SESS_KEY = 'susuru_anki_cards_sess', CARD_CAT_KEY = 'susuru_anki_cards_cat';
const FC_CHUNK = 10, FC_KNOW = 3;
let fc = null; // { cat, chunks, ci, queue:[id], pass, cur:{u, mode, flipped, done, res}, st }

function fcCat() { try { const c = localStorage.getItem(CARD_CAT_KEY); if (c !== null) return c && categories.includes(c) ? c : ''; } catch (e) {} return typeof drillScopeCategory === 'function' ? drillScopeCategory() : ''; }
function fcSetCat(c) { try { localStorage.setItem(CARD_CAT_KEY, c || ''); } catch (e) {} fcHome(); }
function fcProg(id) { return (cardProg || {})[id] || { k: 0, d: 0, p: false }; }
function fcSetProg(id, o) { cardProg[id] = Object.assign({}, fcProg(id), o, { at: Date.now() }); try { saveData(); } catch (e) {} }

// 暗記テストと同じグループを作って、10問くらいずつに分ける（暗記テストの途中のデータはこわさない）
function fcChunks(cat) {
  const keep = [DG, DI, DCK];
  drillBuild(cat);
  const groups = DG;
  DG = keep[0]; DI = keep[1]; DCK = keep[2];
  const out = [];
  groups.forEach(g => {
    const fams = [];
    g.items.forEach(it => {
      const no = it.card && it.card.no, fam = no != null && Number.isFinite(Number(no)) ? 'n' + Math.floor(Number(no)) : 'x' + it.id;
      const u = { id: it.id, card: it.card, w: it.w, m: it.m, it };
      const last = fams[fams.length - 1];
      if (last && last.fam === fam) last.list.push(u); else fams.push({ fam, list: [u] });
    });
    const checks = g.chk.map(c => ({ id: c.card.id, card: c.card, w: c.q, m: c.ans, ck: c }));
    const n = g.items.length;
    if (!n && !checks.length) return;
    // まとまりの数を先に決めて、だいたい同じ大きさに（23問なら 8・8・7）。区切るのは番号の仲間の切れ目だけ
    const target = n ? Math.ceil(n / Math.max(1, Math.ceil(n / FC_CHUNK))) : FC_CHUNK;
    const parts = []; let cur = [];
    fams.forEach(f => { if (cur.length && cur.length + f.list.length > target) { parts.push(cur); cur = []; } cur.push(...f.list); });
    if (cur.length) parts.push(cur);
    if (!parts.length) parts.push([]);
    parts[parts.length - 1].push(...checks); // Check! はグループの最後に
    parts.forEach((items, i) => out.push({ name: g.name, part: i + 1, parts: parts.length, items }));
  });
  return out;
}
function fcRange(ch) {
  const nos = ch.items.map(u => u.card && u.card.no).filter(x => x != null && Number.isFinite(Number(x))).map(Number);
  return nos.length ? `No.${cardNoText(Math.min(...nos))}〜${cardNoText(Math.max(...nos))}` : `${ch.items.length}問`;
}
function fcCount(chunks) {
  const all = chunks.flatMap(c => c.items), s = { all: all.length, done: 0, learning: 0, fresh: 0 };
  all.forEach(u => { const p = fcProg(u.id); if (p.p) s.done++; else if (p.k || p.d) s.learning++; else s.fresh++; });
  return s;
}
function fcLoadSess() { try { return JSON.parse(localStorage.getItem(CARD_SESS_KEY) || 'null'); } catch (e) { return null; } }
function fcSaveSess() {
  if (!fc) return;
  try { localStorage.setItem(CARD_SESS_KEY, JSON.stringify({ cat: fc.cat, ci: fc.ci, queue: fc.queue, pass: fc.pass, cur: fc.cur && !fc.cur.done ? fc.cur.u.id : null, at: Date.now() })); } catch (e) {}
}

// ---------------- はじめの画面 ----------------
function openCardMode() { openPage('pgCards'); }
function fcOnOpen() { if (fc && fc.cur) fcDraw(); else fcHome(); }
function fcHome() {
  fc = null;
  const box = document.getElementById('cardApp'); if (!box) return;
  const cat = fcCat(), chunks = fcChunks(cat), s = fcCount(chunks);
  const sess = fcLoadSess(), resume = sess && sess.cat === cat && sess.ci < chunks.length;
  const next = chunks.findIndex(c => c.items.some(u => !fcProg(u.id).p));
  const pct = s.all ? Math.round(s.done / s.all * 100) : 0;
  box.innerHTML = `<div class="card drill-main"><div class="setting-box-title">🃏 カードモード</div>
    <label class="section-label" style="font-weight:500;">🎯 出題範囲（暗記テストと同じ問題）</label>
    ${folderPickButtonHTML(cat, 'すべてのフォルダー', 'fcPickScope()', `${chunks.length}まとまり ・ ${s.all}問`)}
    <div class="fc-stat"><div class="fc-bar"><span style="width:${pct}%"></span></div>
      <div class="hint-small">✅ 覚えた ${s.done} ・ 📖 覚えている途中 ${s.learning} ・ 🆕 まだ ${s.fresh}</div></div>
    ${next >= 0 ? `<div class="hint-small" style="margin-top:6px;">${resume ? '▶️ 続き' : '次'}：${escapeHtml(chunks[resume ? sess.ci : next].name)}（${fcRange(chunks[resume ? sess.ci : next])}）</div>` : ''}
    <button class="btn btn-start" style="margin-top:10px;" onclick="fcStart(${resume ? 'true' : 'false'})" ${s.all && (next >= 0 || resume) ? '' : 'disabled'}>${resume ? '▶️ 続きから' : '🚀 はじめる'}</button>
    ${s.all && next < 0 ? '<div class="hint-small" style="margin-top:6px; color:var(--success);">🎉 この範囲は全部覚えました！</div>' : ''}
    <details class="drill-howto"><summary>ℹ️ カードモードの進み方</summary>
      <div class="hint-small">・カードを<b>タップ</b>すると答えが出ます。<b>右に振る</b>と「わかる」、<b>左に振る</b>と「わからない」（下のボタンや ← → キーでも）。<br>
      ・「わかる」が${FC_KNOW}回になったカードは、次に出たときに<b>記述のテスト</b>になります。正解なら「覚えた」になって、もう出ません。間違えたら「わかる」が0に戻り、「わからない」を2回ぶん足します。<br>
      ・10問くらいのまとまり（番号の仲間は分けません）を、全部覚えるまで周回します。終わったら次のまとまりへ。<br>
      ・成績は、いつものクイズの成績・暗記テストとは別に記録します（学習した日には数えます）。</div></details>
    ${s.done + s.learning ? `<button class="chip" style="margin-top:8px;" onclick="fcReset()">🔄 この範囲のカードモードの記録をリセット</button>` : ''}
  </div>`;
}
function fcPickScope() {
  openFolderPicker({ title: '🎯 カードモードの出題範囲', current: fcCat(), allLabel: '📚 すべてのフォルダー',
    hint: '暗記テストと同じ問題を、グループの中で10問くらいずつ出します', onPick: c => fcSetCat(c) });
}
function fcReset() {
  const cat = fcCat(), chunks = fcChunks(cat);
  if (!confirm(`「${cat || 'すべてのフォルダー'}」のカードモードの記録（わかる・わからない・覚えた）を消して、最初からにしますか？\n（いつものクイズの成績・暗記テストの記録は消えません）`)) return;
  const now = Date.now();
  chunks.forEach(c => c.items.forEach(u => { if (cardProg[u.id]) cardProg[u.id] = { k: 0, d: 0, p: false, at: now }; }));
  try { localStorage.removeItem(CARD_SESS_KEY); } catch (e) {}
  saveData(true); fcHome();
}

// ---------------- 進める ----------------
function fcStart(resume) {
  const cat = fcCat(), chunks = fcChunks(cat), sess = resume ? fcLoadSess() : null;
  fc = { cat, chunks, ci: 0, queue: [], pass: 1, cur: null };
  if (sess && sess.cat === cat && sess.ci < chunks.length) {
    fc.ci = sess.ci; fc.pass = sess.pass || 1;
    const ids = new Set(chunks[fc.ci].items.map(u => u.id));
    fc.queue = (sess.queue || []).filter(id => ids.has(id) && !fcProg(id).p);
    if (sess.cur && ids.has(sess.cur) && !fcProg(sess.cur).p) fc.queue.unshift(sess.cur);
    if (!fc.queue.length) fcBeginChunk(fc.ci); else fcNext();
  } else {
    const i = chunks.findIndex(c => c.items.some(u => !fcProg(u.id).p));
    if (i < 0) return fcHome();
    fcBeginChunk(i);
  }
}
function fcBeginChunk(ci) {
  while (ci < fc.chunks.length && !fc.chunks[ci].items.some(u => !fcProg(u.id).p)) ci++;
  if (ci >= fc.chunks.length) { fc.cur = null; fcSaveSess(); return fcAllDone(); }
  fc.ci = ci; fc.pass = 1;
  fc.queue = fc.chunks[ci].items.filter(u => !fcProg(u.id).p).map(u => u.id);
  fcNext();
}
function fcUnit(id) { return fc.chunks[fc.ci].items.find(u => u.id === id); }
function fcNext() {
  const ch = fc.chunks[fc.ci];
  if (!fc.queue.length) {
    const left = ch.items.filter(u => !fcProg(u.id).p);
    if (!left.length) { fc.cur = null; fcSaveSess(); return fcChunkDone(); }
    // まだ覚えていないカードで、もう1周（順番を変える）
    fc.pass++;
    fc.queue = dShuffle(left.map(u => u.id));
  }
  const id = fc.queue.shift(), u = fcUnit(id);
  if (!u) return fcNext();
  fc.cur = { u, mode: fcProg(id).k >= FC_KNOW ? 'test' : 'flip', flipped: false, done: false };
  fcSaveSess();
  fcDraw();
  if (typeof drillTtsOn === 'function' && drillTtsOn()) setTimeout(fcSpeakQ, 250);
}
// わかる
function fcKnow() {
  if (!fc || !fc.cur || fc.cur.mode !== 'flip') return;
  const id = fc.cur.u.id, p = fcProg(id);
  fcSetProg(id, { k: Math.min(FC_KNOW, (p.k || 0) + 1) });
  if (typeof sfxPlay === 'function') sfxPlay('ok'); // ★【0.04.71】わかる：ピンポーン
  fcMark();
  fcFly('right', fcNext);
}
// わからない：このまとまりの後ろにもう一度
function fcDont() {
  if (!fc || !fc.cur || fc.cur.mode !== 'flip') return;
  const id = fc.cur.u.id, p = fcProg(id);
  fcSetProg(id, { d: (p.d || 0) + 1 });
  if (typeof sfxPlay === 'function') sfxPlay('ng'); // ★【0.04.71】わからない：ブッブー
  fc.queue.push(id);
  fcMark();
  fcFly('left', fcNext);
}
function fcMark() { if (typeof markStudyDay === 'function') try { markStudyDay(); } catch (e) {} }
function fcFlip() {
  if (!fc || !fc.cur || fc.cur.mode !== 'flip') return;
  fc.cur.flipped = !fc.cur.flipped;
  const el = document.getElementById('fcCard'); if (el) el.classList.toggle('flipped', fc.cur.flipped);
  const h = el && el.querySelector('.fc-hint'); if (h) h.textContent = fc.cur.flipped ? '→ わかる ／ ← わからない' : 'タップで答え';
  const fb = document.getElementById('fcFlipBtn'); if (fb) fb.textContent = fc.cur.flipped ? '🔄 問題' : '👀 答え';
  if (fc.cur.flipped && el) fcHydrate(el); // 答えが見えてから、長い漢文を幅に合わせる
  if (fc.cur.flipped && typeof drillTtsOn === 'function' && drillTtsOn()) fcSpeakA();
}
function fcFly(dir, then) {
  const el = document.getElementById('fcCard');
  if (!el) return then();
  el.style.transition = 'transform .22s ease-in, opacity .22s ease-in';
  el.style.transform = `translateX(${dir === 'right' ? 130 : -130}%) rotate(${dir === 'right' ? 18 : -18}deg)`;
  el.style.opacity = '0';
  setTimeout(then, 200);
}

// ---------------- テスト（「わかる」が3回になったカード） ----------------
async function fcTestSubmit(choice) {
  if (!fc || !fc.cur || fc.cur.mode !== 'test' || fc.cur.done || fc.cur.busy) return;
  const u = fc.cur.u;
  let ok;
  if (u.ck && u.ck.choices && choice !== undefined) ok = String(choice) === String(u.ck.ans) || (typeof isAnswerCorrect === 'function' && isAnswerCorrect(String(choice), u.ck.ans));
  else if (u.ck) {
    // ★【0.04.32】選択肢のない Check!（● …の意味は？ など）：書いた答えを、暗記テストと同じ判定で（決まらなければ AI）
    const inp = document.getElementById('fcAns'), v = String(inp && inp.value || '').trim();
    if (!v) return;
    fc.cur.given = v;
    const lc = drillCheckLocal(v, u.ck.ans);
    if (lc.decided) ok = lc.ok;
    else if (typeof drillAiOk === 'function' && drillAiOk()) {
      fc.cur.busy = true;
      const btn = document.getElementById('fcJudgeBtn'); if (btn) { btn.disabled = true; btn.textContent = '🤖 確認中…'; }
      try {
        const r = await drillAi(`問題:${u.ck.q}\n正解:${u.ck.ans}\n生徒の答え:${v}\n正解の中の（ ）は、省略してよい語か言い換え（「根本的（劇的）な変化」なら「根本的な変化」「劇的な変化」どちらも ok）。意味が同じなら ok。順序の違い・表記の軽微な違いは許容。JSONのみ：{"v":"ok|x"}`);
        ok = r && r.v === 'ok';
      } catch (e) { ok = typeof isAnswerCorrect === 'function' && isAnswerCorrect(v, u.ck.ans); }
      fc.cur.busy = false;
      if (!fc || !fc.cur || fc.cur.u !== u) return;
    } else ok = false;
  } else {
    const inp = document.getElementById('fcAns'), v = String(inp && inp.value || '').trim();
    if (!v) return;
    fc.cur.st = fc.cur.st || {}; fc.cur.busy = true;
    const btn = document.getElementById('fcJudgeBtn'); if (btn) { btn.disabled = true; btn.textContent = '🤖 確認中…'; }
    let res;
    try { fc.cur.sn = fc.cur.sn || await drillGetSn(u.it); res = await drillJudgeCore(u.it, fc.cur.sn, fc.cur.st, v); } catch (e) { res = { status: 'error' }; }
    fc.cur.busy = false;
    if (!fc || !fc.cur || fc.cur.u !== u) return;
    // ★【0.04.31】まちがいではないもの（意味が足りない・同じ意味のくり返し・語尾（品詞の形）がちがう・単語帳と違う言い方）は、もう一度聞く
    if (res.status === 'repeat' || res.status === 'more' || (res.status === 'wrong' && res.form)) {
      const got = (fc.cur.st.cv || []).map(i => String((fc.cur.sn[i] || {}).t || '').split('，')[0]).filter(Boolean);
      const left = Math.max(1, fc.cur.sn.length - (fc.cur.st.cv || []).length);
      const why = res.status === 'repeat' ? 'その意味はもう答えました。ほかの意味を答えてください。'
        : res.form ? '意味は合っていますが、品詞（語尾）の形がちがいます。形を直して、もう一度答えてください。'
        : `${res.msg || ''}${got.length ? `ほかの意味もあります（あと${left}つ）。` : 'もう一度答えてください。'}`;
      fc.cur.msg = `${got.length ? '⭕ ' + got.join('、') + '　' : ''}${why}`;
      if (typeof sfxPlay === 'function') sfxPlay('retry'); // ★【0.04.71】聞き直す：ブッブッ
      fcDraw(); const i2 = document.getElementById('fcAns'); if (i2) { i2.value = ''; i2.focus(); }
      return;
    }
    ok = res.status === 'done' || (res.status === 'error' && typeof isAnswerCorrect === 'function' && isAnswerCorrect(v, u.m));
    fc.cur.given = v;
    if (!ok && res.tip) fc.cur.tip = res.tip;
  }
  fc.cur.done = true; fc.cur.ok = ok;
  if (typeof sfxPlay === 'function') sfxPlay(ok ? 'ok' : 'ng'); // ★【0.04.71】🔔 効果音
  if (ok) fcSetProg(u.id, { p: true, k: FC_KNOW });
  else { const p = fcProg(u.id); fcSetProg(u.id, { k: 0, d: (p.d || 0) + 2 }); fc.queue.push(u.id); }
  fcMark();
  fcSaveSess();
  fcDraw();
  if (typeof drillTtsOn === 'function' && drillTtsOn()) fcSpeakA();
}

// ---------------- 表示 ----------------
function fcAnsHTML(u) {
  if (u.ck) return `<div class="fc-seg">${dE(u.ck.ans)}</div>`;
  const seg = parseStructuredAnswer(u.m);
  const body = seg ? seg.map(x => `<div class="fc-seg">${x.label ? `<span class="fc-pos">${escapeHtml(x.label)}</span>` : ''}${dE(x.text)}</div>`).join('') : `<div class="fc-seg">${dE(u.m).replace(/\n/g, '<br>')}</div>`;
  const note = u.card && u.card.note ? `<div class="fc-note">${dE(u.card.note).replace(/\n/g, '<br>')}</div>` : '';
  const fig = typeof drillFigHTML === 'function' ? drillFigHTML(u.card) : ''; // ★【0.04.38】答えの漢文の図・構造式
  return body + fig + note;
}
// ★【0.04.38】問題の漢文の図・構造式も描く（Check! はそのまま）
function fcQHTML(u) { return !u.ck && u.it && typeof drillWordHTML === 'function' ? drillWordHTML(u.it) : dE(u.w); }
function fcHydrate(box) { if (typeof hydrateRich === 'function') { try { hydrateRich(box); } catch (e) {} } }
function fcDots(id) { const p = fcProg(id); return '●'.repeat(Math.min(FC_KNOW, p.k || 0)) + '○'.repeat(Math.max(0, FC_KNOW - (p.k || 0))); }
function fcHeadHTML() {
  const ch = fc.chunks[fc.ci], done = ch.items.filter(u => fcProg(u.id).p).length;
  return `<div class="fc-head"><button class="chip" onclick="fcQuit()">⏸ やめる</button>
    <div class="fc-head-t"><b>${escapeHtml(ch.name)}${ch.parts > 1 ? ` <span class="hint-small">${ch.part}/${ch.parts}</span>` : ''}</b><div class="hint-small">${fcRange(ch)} ・ ${fc.pass}周目 ・ 覚えた ${done}/${ch.items.length}</div></div>
    <button class="chip" onclick="drillToggleTts(); fcDraw();" title="読み上げ">${typeof drillTtsOn === 'function' && drillTtsOn() ? '🔊' : '🔇'}</button></div>
    <div class="fc-bar"><span style="width:${ch.items.length ? Math.round(done / ch.items.length * 100) : 0}%"></span></div>`;
}
function fcDraw() {
  const box = document.getElementById('cardApp'); if (!box || !fc || !fc.cur) return;
  const c = fc.cur, u = c.u, no = u.card && u.card.no != null && typeof showsCardNo === 'function' && showsCardNo(u.card) ? `<span class="fc-no">No.${cardNoText(u.card.no)}</span>` : '';
  const p = fcProg(u.id);
  if (c.mode === 'flip') {
    box.innerHTML = fcHeadHTML() + `
      <div class="fc-stage">
        <div id="fcCard" class="fc-card${c.flipped ? ' flipped' : ''}">
          <div class="fc-tag fc-tag-ok">わかる</div><div class="fc-tag fc-tag-ng">わからない</div>
          <div class="fc-top">${no}<span class="fc-dots" title="わかる ${p.k || 0}/${FC_KNOW}">${fcDots(u.id)}</span></div>
          <div class="fc-q">${fcQHTML(u)}</div>
          ${u.ck && u.ck.choices ? `<div class="fc-choices">${u.ck.choices.map((x, i) => `<div>${'①②③④⑤⑥⑦⑧⑨'[i] || '・'} ${dE(x)}</div>`).join('')}</div>` : ''}
          <div class="fc-a">${fcAnsHTML(u)}</div>
          <div class="fc-hint">${c.flipped ? '→ わかる ／ ← わからない' : 'タップで答え'}</div>
        </div>
      </div>
      <div class="fc-btns"><button class="btn fc-ng" onclick="fcDont()">← わからない</button><button id="fcFlipBtn" class="btn btn-secondary" onclick="fcFlip()">${c.flipped ? '🔄 問題' : '👀 答え'}</button><button class="btn fc-ok" onclick="fcKnow()">わかる →</button></div>
      <div class="hint-small" style="text-align:center; margin-top:6px;">わかる ${p.k || 0}/${FC_KNOW}（${FC_KNOW}回で記述のテスト）・わからない ${p.d || 0}回</div>`;
    fcHydrate(box);
    fcBindSwipe();
    return;
  }
  // テスト
  const choices = u.ck && u.ck.choices;
  box.innerHTML = fcHeadHTML() + `
    <div class="fc-stage"><div class="fc-card fc-test">
      <div class="fc-top">${no}<span class="fc-badge">✍️ テスト</span></div>
      <div class="fc-q">${fcQHTML(u)}</div>
      ${c.done ? `<div class="fc-result ${c.ok ? 'ok' : 'ng'}">${c.ok ? '🎉 正解！「覚えた」になりました' : `✕ ちがいます${c.tip ? `（${escapeHtml(c.tip)}）` : ''}<div class="hint-small">「わかる」を0に戻して、「わからない」を2回ぶん足しました。</div>`}</div>
        ${c.given ? `<div class="hint-small">あなたの答え：${escapeHtml(c.given)}</div>` : ''}
        <div class="fc-a fc-a-show">${fcAnsHTML(u)}</div>`
      : choices ? `<div class="fc-choice-btns">${choices.map((x, i) => `<button class="btn btn-secondary" onclick="fcTestSubmit(${jsArg(x)})">${'①②③④⑤⑥⑦⑧⑨'[i] || ''} ${dE(x)}</button>`).join('')}</div>`
      : `${c.msg ? `<div class="hint-small fc-msg">${escapeHtml(c.msg)}</div>` : ''}
        <input type="text" id="fcAns" class="form-control" placeholder="意味を書いてください（全部の意味）" autocomplete="off" onkeydown="if(event.key==='Enter'){event.preventDefault(); fcTestSubmit();}">
        <button id="fcJudgeBtn" class="btn btn-primary" style="margin-top:8px;" onclick="fcTestSubmit()">✔ 判定</button>
        ${typeof drillAiOk === 'function' && !drillAiOk() ? '<div class="hint-small" style="margin-top:6px;">⚠️ AI が使えないため、単語帳の訳と同じ言葉だけを正解にします（設定 → 🤖 AI でキーを入れると、暗記テストと同じく言い換えも判定します）</div>' : ''}`}
    </div></div>
    ${c.done ? `<div class="fc-btns"><button class="btn btn-primary" onclick="fcNext()">次へ →</button></div>` : ''}`;
  fcHydrate(box);
  if (!c.done && !choices) setTimeout(() => { const i = document.getElementById('fcAns'); if (i) i.focus(); }, 50);
}
function fcSpeakQ() { if (fc && fc.cur && typeof speakText === 'function') speakText(typeof spoilerSafeSpeech === 'function' ? spoilerSafeSpeech(fc.cur.u.w) : fc.cur.u.w); }
function fcSpeakA() {
  if (!fc || !fc.cur || typeof speakText !== 'function') return;
  const u = fc.cur.u, seg = u.ck ? null : parseStructuredAnswer(u.m);
  speakText(u.ck ? u.ck.ans : seg ? seg.map(x => x.text).join('\n') : u.m);
}
// 横に振る
function fcBindSwipe() {
  const el = document.getElementById('fcCard'); if (!el) return;
  let x0 = null, y0 = 0, dx = 0, moved = false, pid = null;
  const reset = () => { el.style.transition = 'transform .18s'; el.style.transform = ''; el.classList.remove('to-ok', 'to-ng'); };
  el.addEventListener('pointerdown', e => { x0 = e.clientX; y0 = e.clientY; dx = 0; moved = false; pid = e.pointerId; el.style.transition = 'none'; });
  el.addEventListener('pointermove', e => {
    if (x0 === null || e.pointerId !== pid) return;
    dx = e.clientX - x0; const dy = e.clientY - y0;
    if (!moved && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { moved = true; try { el.setPointerCapture(pid); } catch (er) {} }
    if (!moved) return;
    el.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
    el.classList.toggle('to-ok', dx > 40); el.classList.toggle('to-ng', dx < -40);
  });
  const end = e => {
    if (x0 === null) return;
    const wasMoved = moved; x0 = null;
    if (!wasMoved) { reset(); if (e.type === 'pointerup') fcFlip(); return; }
    if (dx > 90) return fcKnow();
    if (dx < -90) return fcDont();
    reset();
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
document.addEventListener('keydown', e => {
  const pg = document.getElementById('pgCards');
  if (!pg || !pg.classList.contains('active') || !fc || !fc.cur || fc.cur.mode !== 'flip') return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '')) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); fcKnow(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); fcDont(); }
  else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); fcFlip(); }
});
function fcChunkDone() {
  const box = document.getElementById('cardApp'), ch = fc.chunks[fc.ci];
  const more = fc.chunks.slice(fc.ci + 1).some(c => c.items.some(u => !fcProg(u.id).p));
  box.innerHTML = `<div class="card drill-main" style="text-align:center;"><div style="font-size:2.4rem;">🎉</div>
    <div class="setting-box-title" style="justify-content:center;">このまとまりを全部覚えました</div>
    <div class="hint-small">${escapeHtml(ch.name)}（${fcRange(ch)}）・${fc.pass}周</div>
    ${more ? `<button class="btn btn-start" style="margin-top:12px;" onclick="fcBeginChunk(${fc.ci + 1})">次のまとまりへ →</button>` : '<div class="hint-small" style="margin-top:8px; color:var(--success);">この範囲は全部覚えました！</div>'}
    <button class="btn btn-secondary" style="margin-top:8px;" onclick="fcQuit()">やめる</button></div>`;
  try { localStorage.setItem(CARD_SESS_KEY, JSON.stringify({ cat: fc.cat, ci: fc.ci + 1, queue: [], pass: 1, at: Date.now() })); } catch (e) {}
}
function fcAllDone() {
  const box = document.getElementById('cardApp');
  box.innerHTML = `<div class="card drill-main" style="text-align:center;"><div style="font-size:2.4rem;">🏆</div><div class="setting-box-title" style="justify-content:center;">この範囲は全部覚えました！</div>
    <button class="btn btn-secondary" style="margin-top:10px;" onclick="fcQuit()">はじめの画面へ</button></div>`;
  try { localStorage.removeItem(CARD_SESS_KEY); } catch (e) {}
}
function fcQuit() { fcSaveSess(); fc = null; fcHome(); }
