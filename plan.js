// ================================================================
// ★【0.03.27】📅 週間プラン（単語帳を1週間に1つの範囲ずつ進める）
// 例：鉄壁。親フォルダー（鉄壁）の下のフォルダーを、1週に1つずつの範囲にする。
//  ・火〜木（期限の曜日の夜まで）：その週の範囲の単語を 🧠 暗記テストで全部〇にする
//  ・金曜から（単語が終わっていれば）：その週の範囲の例文・チャンツ
//  ・日曜：先週の範囲の復習（まだ卒業していない単語だけ／全部）
//  ・1か月前（4週前）の範囲の、星（難易度）の多い単語の復習
//  ・期限を守る仕掛け：ホームのお知らせ（残り時間・進み具合・期限切れ）、期限内に終わった週の連続記録、
//    その日にやることを通知（プッシュ通知の送信側にも渡す）
// 設定と達成の記録は studyPlan（storage.js）に入れて、端末間で同期する
// ★【0.03.33】プランは複数持てる。CP は「いま扱っているプラン」（planUse で切り替える）
// ================================================================
const PLAN_DAYS = ['日', '月', '火', '水', '木', '金', '土'];
const PLAN_EX_RE = /例文/i;
const PLAN_CHANT_RE = /チャンツ|chant/i; // ★【0.03.41】チャンツ（熟語・チャンク）は例文と別の課題
const DAY_MS = 86400000;

function planDateStr(d) { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function planParseDate(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); }
function planMonday(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; }
let CP = null;
function planIsValid(p) { return !!(p && !p.deleted && p.enabled && Array.isArray(p.weeks) && p.weeks.length && p.start); }
function planOk() { return planIsValid(CP); }
// 使っているプランの一覧（作った順）
function planList() {
  studyPlan = normalizeStudyPlans(studyPlan);
  return Object.keys(studyPlan.plans).map(id => Object.assign(studyPlan.plans[id], { id })).filter(planIsValid).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
function planUse(p) { CP = p || null; return CP; }
function planById(id) { return planList().find(p => p.id === id) || null; }

// その日が何週目か（0 始まり。範囲より前なら負）
function planWeekIndex(now = new Date()) { return Math.round((planMonday(now) - planParseDate(CP.start)) / (7 * DAY_MS)); }
function planWeekFolder(i) { const w = CP.weeks; return i >= 0 && i < w.length && categories.includes(w[i]) ? w[i] : null; }
function planWeekKey(i) { const d = planParseDate(CP.start); d.setDate(d.getDate() + i * 7); return planDateStr(d); }
function planLog(i) { CP.log = CP.log || {}; return CP.log[planWeekKey(i)] || {}; }
function planSetLog(i, field, value) {
  CP.log = CP.log || {};
  const k = planWeekKey(i);
  CP.log[k] = Object.assign({}, CP.log[k] || {}, { [field]: value });
  saveData();
}
// 単語の期限（その週の期限の曜日の 23:59）
function planWordsDeadline(i) { const d = planParseDate(planWeekKey(i)); d.setDate(d.getDate() + ((CP.wordsDue ?? 4) + 6) % 7); d.setHours(23, 59, 59, 999); return d; }

// 範囲のカード
function planCards(cat) { if (!cat) return []; const set = new Set(getAllSubcategories(cat)); return db.filter(q => set.has(q.category)); }
function planIsExampleCard(q) { return q.kind === 'cloze' || (PLAN_EX_RE.test(q.category) && q.kind !== 'test' && q.kind !== 'intro'); }
// チャンツ：熟語・チャンク（communicate with A など）と、チャンツのフォルダーのカード
function planIsChantCard(q) {
  if (planIsExampleCard(q) || q.kind || (Array.isArray(q.choices) && q.choices.length)) return false;
  return PLAN_CHANT_RE.test(q.category) || (typeof drillIsPhraseCard === 'function' && drillIsPhraseCard(q));
}
// 単語＝暗記テストに出るカード（熟語も含む。★【0.03.47】元の試作と同じ）
function planWordCards(cat) { const ok = new Set(typeof getQuizSubcategories === 'function' ? getQuizSubcategories(cat) : getAllSubcategories(cat)); return planCards(cat).filter(q => ok.has(q.category)).filter(q => !planIsExampleCard(q) && (typeof drillIsWordCard !== 'function' || drillIsWordCard(q))); }
function planExampleCards(cat) { return planCards(cat).filter(planIsExampleCard); }
function planChantCards(cat) { return sortCardsByNumber(planCards(cat).filter(planIsChantCard)); }
// その時刻より後に解いたカードの数
function planAnsweredSince(cards, t) { return cards.filter(q => (q.statsAt || 0) >= t).length; }
// その時刻より後に解いて、最後に正解したカード（合格）
function planPassedSince(cards, t) { return cards.filter(q => (q.statsAt || 0) >= t && (q.streak || 0) > 0).length; }
// チャンツのクイズ：まだ合格していないチャンツ ＋ その見出しの動詞（自動詞の意味→他動詞の意味→自他→熟語 の順に出すため）
function planChantQuizCards(cat, weekStart) {
  const ch = planChantCards(cat), left = ch.filter(q => !((q.statsAt || 0) >= weekStart && (q.streak || 0) > 0));
  const heads = new Set(left.map(q => String(q.question).trim().toLowerCase().split(/\s+/)[0]));
  const verbs = planCards(cat).filter(q => !ch.includes(q) && typeof verbAttrSegs === 'function' && verbAttrSegs(q) && heads.has(String(q.question).trim().toLowerCase()));
  return [...verbs, ...(left.length ? left : ch)];
}
// 日曜の復習・1か月前の復習の対象
function planSundayCards(cat) {
  const ws = planWordCards(cat);
  return CP.sunday === 'all' ? ws : ws.filter(q => !isGraduated(q));
}
function planMonthlyCards(cat) {
  const ws = planWordCards(cat), min = Number(CP.monthlyStars) || 2;
  const starred = ws.filter(q => (Number(q.stars) || 0) >= min);
  if (ws.some(q => q.stars)) return starred;
  // 星を付けていないときは、苦手なもの（レベル2以下・まだ卒業していない）
  return ws.filter(q => !isGraduated(q) && q.level <= 2);
}

// ---------------- 今日やること ----------------
// { key, title, sub, cards, done, due, overdue, action }
function planTasks(now = new Date()) {
  if (!planOk()) return [];
  const i = planWeekIndex(now), dow = now.getDay();
  const cur = planWeekFolder(i), prev = planWeekFolder(i - 1), month = planWeekFolder(i - 4);
  const L = planLog(i), weekStart = planParseDate(planWeekKey(i)).getTime();
  const from = CP.wordsFrom ?? 2, due = CP.wordsDue ?? 4;
  const tasks = [];
  const dayPos = (dow + 6) % 7, fromPos = (from + 6) % 7, duePos = (due + 6) % 7;
  if (cur) {
    const words = planWordCards(cur);
    const deadline = planWordsDeadline(i);
    const answered = planAnsweredSince(words, weekStart);
    if (dayPos >= fromPos || L.words) {
      tasks.push({ key: 'words', title: `🧠 単語：${cur}`, cards: words, done: !!L.words, deadline, overdue: !L.words && now > deadline,
        sub: L.words ? `✅ 終わりました${L.wordsOnTime === false ? '（期限後）' : ''}` : `暗記テストで全部〇に（${PLAN_DAYS[due]}曜の夜まで）・今週解いた単語 ${answered}/${words.length}`,
        progress: words.length ? answered / words.length : 0, action: `planStartTask(${jsArg(CP.id)}, 'words')` });
    } else tasks.push({ key: 'words', title: `🧠 単語：${cur}`, cards: words, done: false, upcoming: true, sub: `${PLAN_DAYS[from]}曜から（${PLAN_DAYS[due]}曜の夜まで）`, action: `planStartTask(${jsArg(CP.id)}, 'words')` });
    // ★【0.03.41】単語（暗記テスト）に合格 → チャンツ（通常のクイズで全部合格）→ 例文
    const ch = planChantCards(cur);
    let chDone = true;
    if (ch.length && (L.words || dayPos > duePos)) {
      const n = planPassedSince(ch, weekStart);
      chDone = !!L.chants || n >= ch.length;
      if (chDone && !L.chants) planSetLog(i, 'chants', Date.now());
      tasks.push({ key: 'chants', title: `🎵 チャンツ：${cur}`, cards: planChantQuizCards(cur, weekStart), done: chDone, locked: !L.words,
        sub: chDone ? '✅ 合格しました' : (!L.words ? '単語（暗記テスト）に合格すると始められます' : `クイズで全部〇に（動詞は自動詞・他動詞も）・合格 ${n}/${ch.length}`),
        progress: n / ch.length, action: `planStartQuizFor('chants', ${jsArg(CP.id)})` });
    } else if (ch.length) chDone = !!L.chants;
    const ex = planExampleCards(cur);
    if (ex.length && (L.words || dayPos > duePos)) {
      const exDone = !!L.examples || (ex.length && planAnsweredSince(ex, weekStart) >= ex.length);
      if (exDone && !L.examples) planSetLog(i, 'examples', Date.now());
      const lock = !L.words || !chDone;
      tasks.push({ key: 'examples', title: `📖 例文：${cur}`, cards: ex, done: exDone, locked: lock,
        sub: exDone ? '✅ 終わりました' : (!L.words ? '単語（暗記テスト）に合格すると始められます' : !chDone ? 'チャンツに合格すると始められます' : `今週やった ${planAnsweredSince(ex, weekStart)}/${ex.length}`),
        progress: planAnsweredSince(ex, weekStart) / ex.length, action: `planStartQuizFor('examples', ${jsArg(CP.id)})` });
    }
  }
  const reviewDay = CP.reviewDay ?? 0;
  if (prev && CP.sunday !== 'off' && dow === reviewDay) {
    const rc = planSundayCards(prev), dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const n = planAnsweredSince(rc, dayStart);
    const done = !!L.sunday || (rc.length > 0 && n >= rc.length) || rc.length === 0;
    if (done && !L.sunday) planSetLog(i, 'sunday', Date.now());
    tasks.push({ key: 'sunday', title: `🔁 先週の復習：${prev}`, cards: rc, done, sub: done ? '✅ 終わりました' : `${CP.sunday === 'all' ? '全部' : 'まだ卒業していない単語'} ${n}/${rc.length}`, progress: rc.length ? n / rc.length : 1, action: `planStartQuizFor('sunday', ${jsArg(CP.id)})` });
  }
  if (month && CP.monthly !== false && (dow === reviewDay || dow === 6)) {
    const mc = planMonthlyCards(month), n = planAnsweredSince(mc, weekStart);
    const done = !!L.monthly || mc.length === 0 || n >= mc.length;
    if (done && !L.monthly && mc.length) planSetLog(i, 'monthly', Date.now());
    tasks.push({ key: 'monthly', title: `🗓️ 1か月前の復習：${month}`, cards: mc, done, optional: true,
      sub: done ? '✅ 終わりました' : `${mc.some(q => q.stars) ? `★${CP.monthlyStars || 2}つ以上` : '苦手'}の単語 ${n}/${mc.length}（余裕があれば）`, progress: mc.length ? n / mc.length : 1, action: `planStartQuizFor('monthly', ${jsArg(CP.id)})` });
  }
  tasks.forEach(t => { t.planId = CP.id; });
  return tasks;
}
// 期限内に単語を終えた週が、何週続いているか
function planStreak() {
  if (!planOk()) return 0;
  let i = planWeekIndex() - 1, n = 0;
  if (planLog(planWeekIndex()).wordsOnTime) n++;
  for (; i >= 0; i--) { if (planLog(i).wordsOnTime) n++; else break; }
  return n;
}
function planLeftText(deadline, now = new Date()) {
  const ms = deadline - now;
  if (ms <= 0) return '期限を過ぎています';
  const h = Math.floor(ms / 3600000), d = Math.floor(h / 24);
  return d >= 1 ? `あと${d}日${h % 24}時間` : `あと${h}時間${Math.floor(ms / 60000) % 60}分`;
}

// ---------------- 始める ----------------
// ★【0.03.36】課題をそのまま始める（ボタン・通知・自動で開くで共通）。単語は暗記テスト（途中経過があれば続きから）
function planStartTask(id, key) {
  if (!planUse(planById(id))) return false;
  const t = planTasks().find(x => x.key === key);
  if (!t) return false;
  if (key === 'words') {
    const cur = planWeekFolder(planWeekIndex());
    if (!cur) return false;
    try { localStorage.setItem('susuru_anki_drill_cat', cur); } catch (e) {}
    if (typeof _drillActive !== 'undefined' && _drillActive && typeof DS !== 'undefined' && DS && DS.cat === cur) { openPage('pgDrill'); return true; } // もう解いている
    if (typeof _drillActive !== 'undefined' && _drillActive && typeof drillSave === 'function') drillSave(); // ほかの範囲を解いていたら保存して切り替える
    if (typeof drillSetActive === 'function') drillSetActive(false);
    openPage('pgDrill');
    if (typeof drillLoadAll === 'function' && drillLoadAll()[cur]) drillResume(cur);
    else if (typeof drillStart === 'function' && DG.length) drillStart();
    return true;
  }
  planStartQuizFor(key, id);
  return true;
}
// 通知から開いたとき（?plantask=プランID:課題）
function planHandleTaskParam(url) {
  let v = null;
  try { v = new URL(url || location.href).searchParams.get('plantask'); } catch (e) {}
  if (!v) return false;
  const [id, key] = v.split(':');
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  try { localStorage.setItem('susuru_anki_plan_autoopen', String(Date.now())); } catch (e) {} // このあと自動で開くのはやめる
  const ok = planStartTask(id, key);
  if (!ok && typeof showAppToast === 'function') showAppToast('📅 その課題はもう終わっているか、見つかりませんでした');
  return ok;
}
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'open-url') planHandleTaskParam(e.data.url); });
function planStartQuizFor(key, id) {
  if (id && !planUse(planById(id))) return;
  const t = planTasks().find(x => x.key === key);
  if (!t || !t.cards.length) return alert('出題するカードがありません。');
  planStartQuiz(t.cards, key === 'chants');
}
// 決まったカードでクイズを始める（いつものクイズ画面）。inOrder：登録順のまま（チャンツ）
function planStartQuiz(cards, inOrder, mode) {
  let subset = expandSenses(inOrder ? sortCardsByNumber(cards.slice()) : cards);
  if (!inOrder) {
    for (let i = subset.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [subset[i], subset[j]] = [subset[j], subset[i]]; }
    const pri = q => q.level === -1 ? 1 : (q.level === 0 && (q.correct > 0 || q.incorrect > 0)) ? 2 : (q.correct === 0 && q.incorrect === 0) ? 3 : 4;
    subset.sort((a, b) => pri(a) - pri(b));
  }
  currentCombo = 0; todayCorrectCount = 0; currentQuizOrderScope = null;
  _quizModeOverride = mode || null; // ★【0.03.44】ネットが無いときの4択の復習など
  quizPool = subset; quizIndex = 0;
  if (document.getElementById('chkSwapQA').checked) quizPool = quizPool.map(swapQuizEntry);
  quizPool = arrangeVerbFlow(quizPool);
  openPage('pgQuizPlayer'); loadQuizQuestion();
}
// 暗記テストで全部〇になったとき（drill.js から）
function planOnDrillPassed(cat) {
  if (!cat) return;
  planList().forEach(p => {
    planUse(p);
    const i = planWeekIndex(), cur = planWeekFolder(i);
    if (!cur) return;
    // その週の範囲そのもの、またはその範囲を含むフォルダーで合格したら
    if (cat === cur || getAllSubcategories(cat).includes(cur)) {
      if (!planLog(i).words) { planSetLog(i, 'words', Date.now()); planSetLog(i, 'wordsOnTime', Date.now() <= planWordsDeadline(i).getTime()); }
    }
  });
  renderPlanViews();
}
function planMarkDone(key, id) {
  if (!planUse(planById(id))) return;
  if (!confirm('今週のこの課題を「終わった」ことにしますか？（紙でやった場合など）')) return;
  const i = planWeekIndex();
  planSetLog(i, key, Date.now());
  if (key === 'words') planSetLog(i, 'wordsOnTime', Date.now() <= planWordsDeadline(i).getTime());
  renderPlanViews();
}

// ---------------- 画面 ----------------
function planTaskHTML(t) {
  const pct = Math.round((t.progress || 0) * 100);
  const cls = t.done ? 'done' : t.overdue ? 'overdue' : t.upcoming ? 'upcoming' : '';
  const dl = t.deadline && !t.done ? `<div class="plan-deadline${t.overdue ? ' over' : ''}">⏰ ${t.overdue ? '期限を過ぎています。今日中に終わらせましょう' : planLeftText(t.deadline)}</div>` : '';
  return `<div class="plan-task ${cls}">
    <div class="plan-task-title">${escapeHtml(t.title)}${t.optional ? ' <span class="hint-small">（余裕があれば）</span>' : ''}</div>
    <div class="hint-small">${escapeHtml(t.sub || '')}</div>${dl}
    ${!t.done && !t.upcoming && t.progress !== undefined ? `<div class="plan-bar"><div style="width:${pct}%"></div></div>` : ''}
    ${!t.done && !t.locked ? `<div class="plan-btns"><button class="btn btn-primary" onclick="${t.action}">${t.upcoming ? '先にやる' : '▶️ 始める'}</button>${['words', 'chants', 'examples'].includes(t.key) ? `<button class="btn btn-secondary" onclick="planMarkDone('${t.key}', ${jsArg(t.planId)})">✅ 済にする</button>` : ''}</div>` : ''}
  </div>`;
}
function planSectionHTML(p, withTitle) {
  planUse(p);
  const i = planWeekIndex(), cur = planWeekFolder(i);
  const st = planStreak();
  const head = `<div class="plan-head"><span>📚 ${escapeHtml(p.root)}${cur ? `（${i + 1}週目）` : ''}</span>${st ? `<span class="plan-streak">🔥 ${st}週連続で期限内</span>` : ''}</div>`;
  if (!cur && i >= p.weeks.length) return (withTitle ? head : '') + `<div class="hint-small">🎉 このプランの範囲は全部終わりました（${p.weeks.length}週）。</div>`;
  return (withTitle ? head : '') + (cur ? '' : `<div class="hint-small">${escapeHtml(p.start)} の週から始まります。</div>`) + planTasks().map(planTaskHTML).join('');
}
function planCompactHTML(p) {
  planUse(p);
  const i = planWeekIndex(), cur = planWeekFolder(i), st = planStreak();
  const head = `<div class="plan-c-head">📚 ${escapeHtml(p.root)}${cur ? `（${i + 1}週目：${escapeHtml(cur)}）` : ''}${st ? ` <span class="plan-streak">🔥${st}</span>` : ''}</div>`;
  if (!cur) return head + `<div class="hint-small">${i >= p.weeks.length ? '🎉 全部終わりました' : `${escapeHtml(p.start)} の週から`}</div>`;
  return head + planTasks().map(t => {
    const pct = Math.round((t.progress || 0) * 100);
    const name = t.title.split('：')[0];
    const state = t.done ? '✅' : t.locked ? '🔒' : t.upcoming ? '⏳' : t.overdue ? '⏰' : '';
    const sub = t.done ? '終わりました' : t.locked ? (t.sub || '') : t.deadline ? planLeftText(t.deadline) : (t.sub || '');
    return `<div class="plan-c-row${t.done ? ' done' : ''}${t.overdue ? ' over' : ''}"><div class="plan-c-main"><div class="plan-c-t">${state} ${escapeHtml(name)}${t.optional ? ' <span class="hint-small">（余裕があれば）</span>' : ''}</div><div class="hint-small">${escapeHtml(sub)}</div>${!t.done && !t.upcoming && !t.locked && t.progress !== undefined ? `<div class="plan-bar"><div style="width:${pct}%"></div></div>` : ''}</div>${!t.done && !t.locked ? `<button class="chip plan-c-go" onclick="${t.action}">▶️</button>` : ''}</div>`;
  }).join('');
}
function renderPlanHome() {
  const box = document.getElementById('planHomeCard');
  if (!box) return;
  const list = planList();
  if (!list.length) { box.style.display = 'none'; return; }
  box.style.display = 'block';
  const u = planUrgentTask();
  // ★【0.03.41】まだ終わっていない今週の課題を、いちばん上に目立たせる（押すとそのまま始める）
  const alertHTML = u ? `<div class="plan-alert${u.overdue ? ' over' : ''}" onclick="planStartTask(${jsArg(u.planId)}, ${jsArg(u.key)})">${planUrgentText(u)}<span class="plan-alert-go">▶️ 始める</span></div>` : '';
  // ★【0.03.49】ホームでは短く（1課題1行）。くわしくは暗記タブで
  box.innerHTML = `<div class="setting-box-title" style="display:flex; justify-content:space-between; align-items:center;">📅 今週のプラン<button class="chip" onclick="openDrill()">くわしく ›</button></div>` + alertHTML + list.map(p => planCompactHTML(p)).join('');
}
function renderPlanSettings() {
  const box = document.getElementById('planSettings');
  if (!box) return;
  const list = planList();
  const editing = _planEditId === 'new' ? null : (planById(_planEditId) || null);
  if (!editing && _planEditId !== 'new') {
    // プランの一覧（編集・解除・追加）
    box.innerHTML = (list.length ? list.map(p => `<div class="plan-row"><div style="min-width:0;"><b>📚 ${escapeHtml(p.root)}</b><div class="hint-small">${p.weeks.length}週・${escapeHtml(p.start)} の週から・単語は${PLAN_DAYS[p.wordsFrom ?? 2]}〜${PLAN_DAYS[p.wordsDue ?? 4]}曜</div></div>
        <div style="display:flex; gap:6px; flex-shrink:0;"><button class="chip" onclick="planEdit(${jsArg(p.id)})">✏️ 編集</button><button class="chip" onclick="stopStudyPlan(${jsArg(p.id)})">🗑️ 解除</button></div></div>`).join('')
      : '<div class="hint-small">まだプランはありません。</div>') +
      `<button class="btn btn-secondary" style="margin-top:8px;" onclick="planEdit('new')">＋ 新しいプランを登録</button>`;
    return;
  }
  const p = editing || {};
  planUse(editing);
  // ★【0.03.30】どの階層のフォルダーでも選べる。1週の範囲は「直下」「2つ下」…「いちばん下」から選ぶ
  const roots = getSortedCategoriesForMenu().filter(c => planUnitFolders(c, 'leaves').length >= 1);
  const root = [_planDraftRoot, p.root, roots[0]].find(c => c && categories.includes(c)) || '';

  const unit = _planDraftUnit || p.unit || 'leaves';
  const children = root ? planUnitFolders(root, unit) : [];
  const curIdx = planOk() && root === p.root && unit === (p.unit || 'leaves') ? Math.max(0, Math.min(children.length - 1, planWeekIndex())) : 0;
  const depth = root ? planMaxDepth(root) : 1;
  // ★【0.03.49】1週の範囲は「何を1週にするか」を例つきで
  const ex = u => { const f = root ? planUnitFolders(root, u) : []; return f.length ? `${f.length}週：${f.slice(0, 2).join('、')}${f.length > 2 ? ' …' : ''}` : '0週'; };
  const unitOpts = [['leaves', '単語が入っているフォルダーごと'], ['children', `「${root}」のすぐ下のフォルダーごと`]].concat(Array.from({ length: Math.max(0, depth - 1) }, (_, k) => ['d' + (k + 2), `${k + 2}つ下のフォルダーごと`]));
  const daySel = (id, v) => `<select id="${id}" class="form-control">${PLAN_DAYS.map((d, i) => `<option value="${i}" ${Number(v) === i ? 'selected' : ''}>${d}曜</option>`).join('')}</select>`;
  box.innerHTML = `
    <div class="hint-small" style="margin-bottom:8px;">${editing ? `✏️ ${escapeHtml(p.root)} のプランを編集` : '＋ 新しいプラン：1週間に1つのフォルダーずつ進めます（いくつでも登録できます）'}</div>
    <div class="plan-step"><span class="plan-step-no">1</span>📚 単語帳（全体のフォルダー）</div>
    ${folderPickButtonHTML(root, '単語帳のフォルダーを選ぶ', 'planPickRoot()', root ? `${planUnitFolders(root, unit).length}週分` : '')}
    <input type="hidden" id="planRoot" value="${escapeHtml(root)}">
    <div class="plan-step"><span class="plan-step-no">2</span>📏 1週間でやる範囲</div>
    <select id="planUnit" class="form-control" onchange="studyPlanDraftUnit(this.value)">${unitOpts.map(([v, l]) => `<option value="${v}" ${v === unit ? 'selected' : ''}>${escapeHtml(l)}（${escapeHtml(ex(v))}）</option>`).join('')}</select>
    <div class="hint-small">フォルダーの並び順に、1週に1つずつ進めます。例文・Review Test など「上から出題しない」フォルダーは数えません。</div>
    ${children.length ? `<div class="plan-weeks">${children.slice(0, 12).map((c, k) => `<span class="plan-week${k === curIdx ? ' cur' : ''}">${k + 1}. ${escapeHtml(c)}</span>`).join('')}${children.length > 12 ? `<span class="plan-week">… 全${children.length}週</span>` : ''}</div>` : ''}
    <div class="plan-step"><span class="plan-step-no">3</span>📍 今週はどこ？</div>
    <select id="planCurrent" class="form-control">${children.map((c, k) => `<option value="${k}" ${k === curIdx ? 'selected' : ''}>${k + 1}週目：${escapeHtml(c)}</option>`).join('')}</select>
    <div class="plan-step"><span class="plan-step-no">4</span>🗓️ 曜日と復習</div>
    <div class="form-row" style="align-items:center;">
      <div style="flex:1;"><label class="section-label" style="font-weight:500;">🧠 単語を始める日</label>${daySel('planFrom', p.wordsFrom ?? 2)}</div>
      <div style="flex:1;"><label class="section-label" style="font-weight:500;">⏰ 単語の期限（夜まで）</label>${daySel('planDue', p.wordsDue ?? 4)}</div>
    </div>
    <div class="form-row" style="margin-top:8px; align-items:center;">
      <div style="flex:1;"><label class="section-label" style="font-weight:500;">🔁 先週の復習の日</label>${daySel('planReviewDay', p.reviewDay ?? 0)}</div>
      <div style="flex:1;"><label class="section-label" style="font-weight:500;">復習する単語</label><select id="planSunday" class="form-control">
        <option value="weak" ${p.sunday !== 'all' && p.sunday !== 'off' ? 'selected' : ''}>まだ卒業していない単語</option><option value="all" ${p.sunday === 'all' ? 'selected' : ''}>全部</option><option value="off" ${p.sunday === 'off' ? 'selected' : ''}>しない</option></select></div>
    </div>
    <label class="section-label" style="font-weight:500; margin-top:8px;">🗓️ 1か月前（4週前）の範囲の復習</label>
    <select id="planMonthly" class="form-control">
      <option value="2" ${p.monthly !== false && (p.monthlyStars || 2) === 2 ? 'selected' : ''}>★★ 以上の単語（星が無ければ苦手な単語）</option>
      <option value="1" ${p.monthly !== false && p.monthlyStars === 1 ? 'selected' : ''}>★ 以上の単語</option>
      <option value="3" ${p.monthly !== false && p.monthlyStars === 3 ? 'selected' : ''}>★★★ の単語</option>
      <option value="off" ${p.monthly === false ? 'selected' : ''}>しない</option></select>
    <label class="toggle-pill" style="margin-top:8px; display:flex; align-items:center; gap:8px;"><input type="checkbox" id="planAutoOpen" ${p.autoOpen === false ? '' : 'checked'}>▶️ アプリを開いたら、残っている課題を自動で開く</label>
    <div class="plan-btns" style="margin-top:10px;"><button class="btn btn-primary" onclick="saveStudyPlan()" ${children.length ? '' : 'disabled'}>💾 ${editing ? '更新' : '登録'}</button><button class="btn btn-secondary" onclick="planEdit(null)">戻る</button></div>
    ${roots.length ? '' : '<div class="hint-small drill-ng">単語のカードが入っているフォルダーがありません。</div>'}`;
}
let _planDraftRoot = null, _planDraftUnit = null, _planEditId = null;
function planEdit(id) { _planEditId = id; _planDraftRoot = null; _planDraftUnit = null; renderPlanSettings(); }
function planPickRoot() {
  const cur = (document.getElementById('planRoot') || {}).value || '';
  openFolderPicker({ title: '📚 単語帳のフォルダーを選ぶ', current: cur,
    hint: '単語帳全体のフォルダー（例：鉄壁）を選びます。中のフォルダーを1週に1つずつ進めます',
    selectable: c => planUnitFolders(c, 'leaves').length > 0,
    note: c => { const n = planUnitFolders(c, 'leaves').length; return n ? `${n}週` : ''; },
    onPick: c => { if (c) studyPlanDraftRoot(c); } });
}
function studyPlanDraftRoot(r) {
  // 週の範囲が作れないフォルダー（中のフォルダーから選ぶ）なら、作れる最初の下のフォルダーへ
  if (r && !planUnitFolders(r, 'leaves').length) { const d = getAllSubcategories(r).find(c => c !== r && planUnitFolders(c, 'leaves').length); if (d) r = d; }
  _planDraftRoot = r; renderPlanSettings();
}
function studyPlanDraftUnit(u) { _planDraftUnit = u; renderPlanSettings(); }
// 1週の範囲にするフォルダー（「上から出題しない」フォルダーとその下は数えない）
function planUnitFolders(root, unit) {
  if (!root || !categories.includes(root)) return [];
  const kids = c => getChildCategories(c).filter(x => !(typeof isCatSkipped === 'function' && isCatSkipped(x)));
  if (unit === 'leaves') {
    // いちばん下＝単語のカードが直接入っているフォルダー（例文・チャンツのフォルダーは除く）
    const hasWords = new Set(db.filter(q => !planIsExampleCard(q) && (typeof drillIsWordCard !== 'function' || drillIsWordCard(q))).map(q => q.category));
    const out = [];
    const walk = c => { if (c !== root && hasWords.has(c) && !PLAN_EX_RE.test(c)) out.push(c); kids(c).forEach(walk); };
    walk(root);
    if (!out.length && hasWords.has(root)) out.push(root); // 単語が直接入っているフォルダーだけなら、そのフォルダーで1週
    return out;
  }
  const n = unit === 'children' ? 1 : Number(String(unit).replace(/\D/g, '')) || 1;
  let level = [root];
  for (let i = 0; i < n; i++) level = level.flatMap(kids);
  return level;
}
function planMaxDepth(root) { const kids = c => getChildCategories(c).filter(x => !isCatSkipped(x)); const d = c => { const k = kids(c); return k.length ? 1 + Math.max(...k.map(d)) : 0; }; return d(root); }
function saveStudyPlan() {
  const root = document.getElementById('planRoot').value;
  const unit = document.getElementById('planUnit').value || 'leaves';
  const weeks = planUnitFolders(root, unit);
  if (!weeks.length) return alert('フォルダーを選んでください。');
  const idx = Number(document.getElementById('planCurrent').value) || 0;
  const mon = planMonday(new Date()); mon.setDate(mon.getDate() - idx * 7);
  const m = document.getElementById('planMonthly').value;
  const old = _planEditId && _planEditId !== 'new' ? planById(_planEditId) : null;
  if (!old && planList().some(p => p.root === root) && !confirm(`「${root}」のプランはもうあります。もう1つ登録しますか？`)) return;
  const id = old ? old.id : 'p' + Date.now().toString(36);
  const plan = {
    id, enabled: true, root, unit, weeks, start: planDateStr(mon),
    wordsFrom: Number(document.getElementById('planFrom').value), wordsDue: Number(document.getElementById('planDue').value),
    reviewDay: Number(document.getElementById('planReviewDay').value), sunday: document.getElementById('planSunday').value,
    monthly: m !== 'off', monthlyStars: m === 'off' ? 2 : Number(m), log: old && old.root === root ? old.log || {} : {},
    autoOpen: !!(document.getElementById('planAutoOpen') || { checked: true }).checked,
    createdAt: old ? (old.createdAt || 0) : Date.now(), planAt: Date.now()
  };
  studyPlan = normalizeStudyPlans(studyPlan);
  studyPlan.plans[id] = plan;
  _planDraftRoot = null; _planDraftUnit = null; _planEditId = null;
  saveData(true);
  renderPlanViews();
  alert(`📅 プランを${old ? '更新' : '登録'}しました。「${root}」の今週は「${weeks[idx]}」です。`);
}
function stopStudyPlan(id) {
  const p = planById(id); if (!p) return;
  if (!confirm(`「${p.root}」の週間プランを解除しますか？（このプランの達成の記録も消えます）`)) return;
  studyPlan = normalizeStudyPlans(studyPlan);
  studyPlan.plans[id] = { id, deleted: true, planAt: Date.now() };
  _planEditId = null;
  saveData(true); renderPlanViews();
}
function renderPlanViews() {
  renderPlanHome();
  const dp = document.getElementById('drillPlanBox');
  if (dp) { const list = planList(); dp.innerHTML = list.length ? list.map(p => `<div class="plan-section">${planSectionHTML(p, list.length > 1)}</div>`).join('') : '<div class="hint-small">プランはまだありません。下の「⚙️ 週間プランの設定」から登録できます。</div>'; }
  renderPlanSettings();
  planSyncNotice();
  if (typeof raceSync === 'function') raceSync();
}

// ---------------- 通知 ----------------
// 今週の単語の予定（始める日・期限・終わったか）を通知の設定に渡す。アプリを開かない日も、プッシュ通知の送信側が
// 「あと何日で期限」「期限を過ぎています」を知らせられるように
let _planNoticeKey = '';
function planSyncNotice() {
  if (typeof currentUser === 'undefined' || !currentUser || typeof firestore === 'undefined') return;
  const infos = [];
  planList().forEach(p => {
    planUse(p);
    const i = planWeekIndex(), cur = planWeekFolder(i);
    if (!cur) return;
    const from = planParseDate(planWeekKey(i)); from.setDate(from.getDate() + ((CP.wordsFrom ?? 2) + 6) % 7);
    const L = planLog(i), ex = planExampleCards(cur), ch = planChantCards(cur);
    infos.push({ chants: ch.length > 0, chantsDone: !!L.chants, planId: p.id, prevCat: planWeekFolder(i - 1) || '', cat: cur, week: planWeekKey(i), from: from.getTime(), due: planWordsDeadline(i).getTime(), wordsDone: !!L.words,
      examples: ex.length > 0, examplesDone: !!L.examples, sunday: CP.sunday !== 'off' && !!planWeekFolder(i - 1), sundayDone: !!L.sunday, reviewDay: CP.reviewDay ?? 0 });
  });
  const key = JSON.stringify(infos);
  if (key === _planNoticeKey) return;
  let token = null; try { token = localStorage.getItem('susuru_anki_push_token'); } catch (e) {}
  if (!token) return; // 通知をオンにしていない
  _planNoticeKey = key;
  firestore.collection('susuru_anki_push').doc(currentUser.uid).set({ plans: infos, plan: infos[0] || null }, { merge: true }).catch(e => { _planNoticeKey = ''; console.warn('プランの通知の保存に失敗:', e.message); });
}

// ---------------- 残っている課題のお知らせ ----------------
// いちばん急ぐ課題（期限切れ → 単語 → チャンツ → 例文 → 復習。余裕があればの課題は除く）
function planUrgentTask(now = new Date()) {
  const all = [];
  planList().forEach(p => { planUse(p); planTasks(now).forEach(t => { if (!t.done && !t.upcoming && !t.locked && !t.optional) all.push(t); }); });
  const rank = t => (t.overdue ? 0 : 10) + ['words', 'chants', 'examples', 'sunday'].indexOf(t.key);
  return all.sort((a, b) => rank(a) - rank(b))[0] || null;
}
function planUrgentText(t) {
  const name = t.title.split('：').slice(1).join('：') || t.title;
  if (t.key === 'words') return t.overdue ? `⏰ ${escapeHtml(name)}：単語の期限を過ぎています！今日中に終わらせよう` : `🧠 ${escapeHtml(name)}：今週の単語がまだです（${planLeftText(t.deadline)}）`;
  if (t.key === 'chants') return `🎵 ${escapeHtml(name)}：チャンツがまだです`;
  if (t.key === 'examples') return `📖 ${escapeHtml(name)}：例文がまだです`;
  return `🔁 ${escapeHtml(name)}：今日は先週の範囲の復習の日です`;
}
// アプリを開いたとき（自動で開かなかったとき）、残っている課題をお知らせ。押すとその課題へ
function planLaunchNotice() {
  const t = planUrgentTask(); if (!t || typeof showAppToast !== 'function') return;
  const div = document.createElement('div'); div.innerHTML = planUrgentText(t);
  showAppToast(div.textContent + '　👉 タップで始める', () => planStartTask(t.planId, t.key));
}

// ---------------- 自動で開く ----------------
// ★【0.03.32】アプリを開いたとき、今日の課題が残っていれば、そこから始める（2時間に1回まで。設定で止められる）
function planAutoOpen() {
  const plans = planList().filter(p => p.autoOpen !== false);
  if (!plans.length) return planLaunchNotice();
  const active = (document.querySelector('.screen.active') || {}).id || '';
  if (['pgShared', 'pgQuizPlayer', 'pgOnlineMatch', 'pgMatchHistory'].includes(active)) return;
  if (document.querySelector('.modal-overlay[style*="flex"], #catEditOverlay[style*="flex"]')) return;
  try { const last = Number(localStorage.getItem('susuru_anki_plan_autoopen')) || 0; if (Date.now() - last < 2 * 3600 * 1000) return planLaunchNotice(); } catch (e) {}
  let t = null;
  for (const p of plans) { planUse(p); t = planTasks().find(x => !x.done && !x.upcoming && !x.locked && !x.optional); if (t) break; }
  if (!t) return;
  try { localStorage.setItem('susuru_anki_plan_autoopen', String(Date.now())); } catch (e) {}
  planStartTask(t.planId, t.key);
  if (typeof showAppToast === 'function') showAppToast(`📅 今週のプラン「${t.title.replace(/^\S+\s/, '')}」から始めます（${t.key === 'words' ? '⏸ 一時離脱' : '✕ 中断'}でほかの画面へ）`);
}
