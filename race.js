// ================================================================
// ★【0.03.42】⚔️ プランバトル（例：鉄壁バトル）
// 同じ単語帳（週間プランの親フォルダーの名前が同じ）のプランをしているフレンドと、今週の進み具合で競う。
//  ・点数（今週）：単語（暗記テスト）合格 30点（期限内なら +10）、チャンツ合格 20点、例文 20点、先週の復習 15点、
//    1か月前の復習 15点、暗記テストの正解 1問 1点（その単語帳の範囲だけ）
//  ・ハンデ：フレンドごとに「相手に +○点」「自分に +○点」を付けられる（この端末に保存）
//  ・成績共有がオンのときだけ、自分の今週の記録を susuru_anki_category_scores に mode:'race' で書く（ルールの変更なし）
//  ・煽り：順位と差から、ひとことを出す（プッシュ通知の送信側でも、フレンドのほうが進んでいたら知らせる）
// ================================================================
const RACE_COL = 'susuru_anki_category_scores';
const RACE_HC_KEY = 'susuru_anki_race_hc';
const RACE_PTS = { words: 30, onTime: 10, chants: 20, examples: 20, sunday: 15, monthly: 15 };

function raceWeekKey(now = new Date()) { return planDateStr(planMonday(now)); }
function raceDocId(uid, root) { return 'race_' + uid + '_' + String(root).replace(/[\/\s.#$\[\]]+/g, '_').slice(0, 80); }
function raceShareOn() { return typeof window.shareStats !== 'undefined' ? !!window.shareStats : localStorage.getItem('shareStats') === 'true'; }

// 暗記テストの今週の正解・不正解（drillRecord から）。card.drillStats に週ごとの数を持つ（カードの成績と一緒に同期）
function raceCountDrill(st, ok) {
  const wk = raceWeekKey();
  if (st.wk !== wk) { st.wk = wk; st.wc = 0; st.ww = 0; }
  if (ok) st.wc = (st.wc || 0) + 1; else st.ww = (st.ww || 0) + 1;
}

// 自分の今週の記録（プランごと）
function raceMine(p) {
  planUse(p);
  const i = planWeekIndex(), L = planLog(i), wk = raceWeekKey();
  const set = new Set(getAllSubcategories(p.root));
  let dc = 0, dw = 0;
  db.forEach(q => { const s = q.drillStats; if (s && s.wk === wk && set.has(q.category)) { dc += s.wc || 0; dw += s.ww || 0; } });
  const r = { root: p.root, week: wk, weekNo: i + 1, cur: planWeekFolder(i) || '', words: !!L.words, onTime: !!L.wordsOnTime, chants: !!L.chants, examples: !!L.examples, sunday: !!L.sunday, monthly: !!L.monthly, dc, dw };
  r.points = racePoints(r);
  return r;
}
function racePoints(r) {
  return (r.words ? RACE_PTS.words : 0) + (r.words && r.onTime ? RACE_PTS.onTime : 0) + (r.chants ? RACE_PTS.chants : 0) + (r.examples ? RACE_PTS.examples : 0)
    + (r.sunday ? RACE_PTS.sunday : 0) + (r.monthly ? RACE_PTS.monthly : 0) + (Number(r.dc) || 0);
}

// 自分の記録を書く（変わったときだけ。少し待ってまとめて）
let _raceTimer = null, _raceSent = {};
function raceSync() {
  clearTimeout(_raceTimer);
  _raceTimer = setTimeout(async () => {
    if (typeof currentUser === 'undefined' || !currentUser || !raceShareOn() || typeof planList !== 'function') return;
    for (const p of planList()) {
      const r = raceMine(p), id = raceDocId(currentUser.uid, p.root), key = JSON.stringify(r);
      if (_raceSent[id] === key) continue;
      _raceSent[id] = key;
      try { await firestore.collection(RACE_COL).doc(id).set(Object.assign({ mode: 'race', uid: currentUser.uid, name: currentUser.displayName || 'Anonymous', updatedAt: Date.now() }, r)); }
      catch (e) { delete _raceSent[id]; console.warn('プランバトルの記録の保存に失敗:', e.message); }
    }
  }, 3000);
}

// ハンデ（+ なら相手に、- なら自分に足す）
function raceHc() { try { return JSON.parse(localStorage.getItem(RACE_HC_KEY) || '{}') || {}; } catch (e) { return {}; } }
function raceSetHc(uid, v) { const h = raceHc(); h[uid] = Number(v) || 0; try { localStorage.setItem(RACE_HC_KEY, JSON.stringify(h)); } catch (e) {} renderRace(); }

// ---------------- 煽り ----------------
const RACE_PICK = a => a[Math.floor(Math.random() * a.length)];
function raceTaunt(me, rows) {
  const others = rows.filter(r => !r.me);
  if (!others.length) return '';
  const top = rows[0], name = r => escapeHtml(r.name);
  if (top.me) {
    const second = rows[1], d = top.score - second.score;
    if (d === 0) return RACE_PICK([`🤝 ${name(second)}さんと同点！ここで1問でも多く解いた方が勝ち`, `⚖️ ${name(second)}さんと横並び。今のうちに抜け出そう`]);
    return RACE_PICK([`😎 ${name(second)}さんに ${d}点リード！この調子で突き放そう`, `👑 いまトップ！${name(second)}さんが ${d}点差で追ってきてます`, `🏃 ${d}点差で首位。油断すると ${name(second)}さんに抜かれるかも…`]);
  }
  const d = top.score - me.score;
  const extra = top.words && !me.words ? `${name(top)}さんはもう単語に合格してます。` : top.chants && !me.chants ? `${name(top)}さんはチャンツまで終わってます。` : top.dc > me.dc ? `${name(top)}さんは今週 暗記テストで ${top.dc}問 正解。` : '';
  return RACE_PICK([`😤 ${name(top)}さんに ${d}点負けてます！${extra}`, `🔥 ${extra}${name(top)}さんとの差は ${d}点。今日で巻き返そう`, `💨 ${name(top)}さんが ${d}点先を走ってます。${extra}置いていかれるよ？`]);
}

// ---------------- 画面 ----------------
async function renderRace() {
  const boxes = [...document.querySelectorAll('.race-box')];
  if (!boxes.length) return;
  const set = html => boxes.forEach(b => { b.innerHTML = html; });
  const plans = typeof planList === 'function' ? planList() : [];
  if (!plans.length) return set('<div class="hint-small">週間プランを登録すると、同じ単語帳のプランをしているフレンドと今週の進み具合で競えます。</div>');
  if (typeof currentUser === 'undefined' || !currentUser) return set('<div class="hint-small">ログインすると、フレンドと競えます。</div>');
  let friends = [], docs = [];
  try {
    friends = await myFriendList();
    if (friends.length) docs = (await firestore.collection(RACE_COL).where('mode', '==', 'race').get()).docs.map(d => d.data()).filter(d => friends.includes(d.uid));
  } catch (e) { return set('<div class="hint-small drill-ng">フレンドの記録を読めませんでした。</div>'); }
  const wk = raceWeekKey(), hc = raceHc();
  const ck = (v, l) => `<span class="race-ck${v ? ' on' : ''}">${v ? '✅' : '⬜'}${l}</span>`;
  const html = plans.map(p => {
    const me = Object.assign(raceMine(p), { name: 'あなた', me: true, uid: currentUser.uid });
    const fr = docs.filter(d => d.root === p.root).map(d => Object.assign({}, d, d.week === wk ? {} : { words: false, onTime: false, chants: false, examples: false, sunday: false, monthly: false, dc: 0, dw: 0 }));
    fr.forEach(r => { r.points = racePoints(r); });
    const rows = [me, ...fr].map(r => {
      const h = r.me ? fr.reduce((s, f) => s + Math.max(0, -(Number(hc[f.uid]) || 0)), 0) : Math.max(0, Number(hc[r.uid]) || 0);
      return Object.assign(r, { hc: h, score: r.points + h });
    }).sort((a, b) => b.score - a.score || (a.me ? -1 : 1));
    const hcSel = r => `<select class="race-hc" onchange="raceSetHc(${jsArg(r.uid)}, this.value)" title="ハンデ">${[-50, -30, -20, -10, 0, 10, 20, 30, 50].map(v => `<option value="${v}" ${(Number(hc[r.uid]) || 0) === v ? 'selected' : ''}>${v === 0 ? 'ハンデなし' : v > 0 ? `相手に +${v}` : `自分に +${-v}`}</option>`).join('')}</select>`;
    const medal = i => ['🥇', '🥈', '🥉'][i] || `${i + 1}位`;
    return `<div class="race-plan"><div class="plan-head"><span>⚔️ ${escapeHtml(p.root)}バトル（今週）</span>${me.cur ? `<span class="hint-small">${escapeHtml(me.cur)}</span>` : ''}</div>
      ${fr.length ? `<div class="race-taunt">${raceTaunt(me, rows)}</div>` : `<div class="hint-small">「${escapeHtml(p.root)}」のプランをしているフレンドがまだいません（フレンドが同じ名前のフォルダーでプランを登録して、成績共有をオンにすると出ます）。</div>`}
      ${rows.map((r, i) => `<div class="race-row${r.me ? ' me' : ''}"><div class="race-name">${medal(i)} ${escapeHtml(r.name)}${r.me ? '' : ` <span class="hint-small">${escapeHtml(r.cur || '')}</span>`}</div>
        <div class="race-score"><b>${r.score}</b>点${r.hc ? `<span class="hint-small">（ハンデ +${r.hc}）</span>` : ''}</div>
        <div class="race-cks">${ck(r.words, '単語' + (r.words && r.onTime ? '⏰' : ''))}${ck(r.chants, 'チャンツ')}${ck(r.examples, '例文')}${ck(r.sunday, '先週')}${ck(r.monthly, '1か月前')}<span class="race-ck on">🧠${r.dc || 0}問</span></div>
        ${r.me ? '' : hcSel(r)}</div>`).join('')}
    </div>`;
  }).join('');
  set(html + `<div class="hint-small" style="margin-top:6px;">点数：単語合格 ${RACE_PTS.words}（期限内 +${RACE_PTS.onTime}）・チャンツ ${RACE_PTS.chants}・例文 ${RACE_PTS.examples}・先週の復習 ${RACE_PTS.sunday}・1か月前 ${RACE_PTS.monthly}・暗記テストの正解 1問1点。${raceShareOn() ? '' : '<br>⚠️ 成績共有がオフなので、フレンドからはあなたの記録が見えません（設定 → 👥 フレンド・ランキング）。'}</div>`);
}
