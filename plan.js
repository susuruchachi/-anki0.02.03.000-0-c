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
// ================================================================
const PLAN_DAYS = ['日', '月', '火', '水', '木', '金', '土'];
const PLAN_EX_RE = /例文|チャンツ|chant/i;
const DAY_MS = 86400000;

function planDateStr(d) { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function planParseDate(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); }
function planMonday(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; }
function planOk() { return !!(studyPlan && studyPlan.enabled && Array.isArray(studyPlan.weeks) && studyPlan.weeks.length && studyPlan.start); }

// その日が何週目か（0 始まり。範囲より前なら負）
function planWeekIndex(now = new Date()) { return Math.round((planMonday(now) - planParseDate(studyPlan.start)) / (7 * DAY_MS)); }
function planWeekFolder(i) { const w = studyPlan.weeks; return i >= 0 && i < w.length && categories.includes(w[i]) ? w[i] : null; }
function planWeekKey(i) { const d = planParseDate(studyPlan.start); d.setDate(d.getDate() + i * 7); return planDateStr(d); }
function planLog(i) { studyPlan.log = studyPlan.log || {}; return studyPlan.log[planWeekKey(i)] || {}; }
function planSetLog(i, field, value) {
  studyPlan.log = studyPlan.log || {};
  const k = planWeekKey(i);
  studyPlan.log[k] = Object.assign({}, studyPlan.log[k] || {}, { [field]: value });
  saveData();
}
// 単語の期限（その週の期限の曜日の 23:59）
function planWordsDeadline(i) { const d = planParseDate(planWeekKey(i)); d.setDate(d.getDate() + ((studyPlan.wordsDue ?? 4) + 6) % 7); d.setHours(23, 59, 59, 999); return d; }

// 範囲のカード
function planCards(cat) { if (!cat) return []; const set = new Set(getAllSubcategories(cat)); return db.filter(q => set.has(q.category)); }
function planIsExampleCard(q) { return q.kind === 'cloze' || (PLAN_EX_RE.test(q.category) && q.kind !== 'test'); }
function planWordCards(cat) { const ok = new Set(typeof getQuizSubcategories === 'function' ? getQuizSubcategories(cat) : getAllSubcategories(cat)); return planCards(cat).filter(q => ok.has(q.category)).filter(q => !planIsExampleCard(q) && (typeof drillIsWordCard !== 'function' || drillIsWordCard(q))); }
function planExampleCards(cat) { return planCards(cat).filter(planIsExampleCard); }
// その時刻より後に解いたカードの数
function planAnsweredSince(cards, t) { return cards.filter(q => (q.statsAt || 0) >= t).length; }
// 日曜の復習・1か月前の復習の対象
function planSundayCards(cat) {
  const ws = planWordCards(cat);
  return studyPlan.sunday === 'all' ? ws : ws.filter(q => !isGraduated(q));
}
function planMonthlyCards(cat) {
  const ws = planWordCards(cat), min = Number(studyPlan.monthlyStars) || 2;
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
  const from = studyPlan.wordsFrom ?? 2, due = studyPlan.wordsDue ?? 4;
  const tasks = [];
  const dayPos = (dow + 6) % 7, fromPos = (from + 6) % 7, duePos = (due + 6) % 7;
  if (cur) {
    const words = planWordCards(cur);
    const deadline = planWordsDeadline(i);
    const answered = planAnsweredSince(words, weekStart);
    if (dayPos >= fromPos || L.words) {
      tasks.push({ key: 'words', title: `🧠 単語：${cur}`, cards: words, done: !!L.words, deadline, overdue: !L.words && now > deadline,
        sub: L.words ? `✅ 終わりました${L.wordsOnTime === false ? '（期限後）' : ''}` : `暗記テストで全部〇に（${PLAN_DAYS[due]}曜の夜まで）・今週解いた単語 ${answered}/${words.length}`,
        progress: words.length ? answered / words.length : 0, action: `planStartWords(${jsArg(cur)})` });
    } else tasks.push({ key: 'words', title: `🧠 単語：${cur}`, cards: words, done: false, upcoming: true, sub: `${PLAN_DAYS[from]}曜から（${PLAN_DAYS[due]}曜の夜まで）`, action: `planStartWords(${jsArg(cur)})` });
    const ex = planExampleCards(cur);
    if (ex.length && (L.words || dayPos > duePos)) {
      const exDone = !!L.examples || (ex.length && planAnsweredSince(ex, weekStart) >= ex.length);
      if (exDone && !L.examples) planSetLog(i, 'examples', Date.now());
      tasks.push({ key: 'examples', title: `📖 例文・チャンツ：${cur}`, cards: ex, done: exDone, locked: !L.words,
        sub: exDone ? '✅ 終わりました' : (!L.words ? '先に単語を終わらせましょう' : `今週やった ${planAnsweredSince(ex, weekStart)}/${ex.length}`),
        progress: planAnsweredSince(ex, weekStart) / ex.length, action: `planStartQuizFor('examples')` });
    }
  }
  const reviewDay = studyPlan.reviewDay ?? 0;
  if (prev && studyPlan.sunday !== 'off' && dow === reviewDay) {
    const rc = planSundayCards(prev), dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const n = planAnsweredSince(rc, dayStart);
    const done = !!L.sunday || (rc.length > 0 && n >= rc.length) || rc.length === 0;
    if (done && !L.sunday) planSetLog(i, 'sunday', Date.now());
    tasks.push({ key: 'sunday', title: `🔁 先週の復習：${prev}`, cards: rc, done, sub: done ? '✅ 終わりました' : `${studyPlan.sunday === 'all' ? '全部' : 'まだ卒業していない単語'} ${n}/${rc.length}`, progress: rc.length ? n / rc.length : 1, action: `planStartQuizFor('sunday')` });
  }
  if (month && studyPlan.monthly !== false && (dow === reviewDay || dow === 6)) {
    const mc = planMonthlyCards(month), n = planAnsweredSince(mc, weekStart);
    const done = !!L.monthly || mc.length === 0 || n >= mc.length;
    if (done && !L.monthly && mc.length) planSetLog(i, 'monthly', Date.now());
    tasks.push({ key: 'monthly', title: `🗓️ 1か月前の復習：${month}`, cards: mc, done, optional: true,
      sub: done ? '✅ 終わりました' : `${mc.some(q => q.stars) ? `★${studyPlan.monthlyStars || 2}つ以上` : '苦手'}の単語 ${n}/${mc.length}（余裕があれば）`, progress: mc.length ? n / mc.length : 1, action: `planStartQuizFor('monthly')` });
  }
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
function planStartWords(cat) {
  try { localStorage.setItem('susuru_anki_drill_cat', cat); } catch (e) {} // 暗記タブの出題範囲をその週の範囲に
  openPage('pgDrill');
}
function planStartQuizFor(key) {
  const t = planTasks().find(x => x.key === key);
  if (!t || !t.cards.length) return alert('出題するカードがありません。');
  planStartQuiz(t.cards);
}
// 決まったカードでクイズを始める（いつものクイズ画面）
function planStartQuiz(cards) {
  let subset = expandSenses(cards);
  for (let i = subset.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [subset[i], subset[j]] = [subset[j], subset[i]]; }
  const pri = q => q.level === -1 ? 1 : (q.level === 0 && (q.correct > 0 || q.incorrect > 0)) ? 2 : (q.correct === 0 && q.incorrect === 0) ? 3 : 4;
  subset.sort((a, b) => pri(a) - pri(b));
  currentCombo = 0; todayCorrectCount = 0; currentQuizOrderScope = null;
  quizPool = subset; quizIndex = 0;
  if (document.getElementById('chkSwapQA').checked) quizPool = quizPool.map(swapQuizEntry);
  openPage('pgQuizPlayer'); loadQuizQuestion();
}
// 暗記テストで全部〇になったとき（drill.js から）
function planOnDrillPassed(cat) {
  if (!planOk() || !cat) return;
  const i = planWeekIndex(), cur = planWeekFolder(i);
  if (!cur) return;
  // その週の範囲そのもの、またはその範囲を含むフォルダーで合格したら
  if (cat === cur || getAllSubcategories(cat).includes(cur)) {
    if (!planLog(i).words) { planSetLog(i, 'words', Date.now()); planSetLog(i, 'wordsOnTime', Date.now() <= planWordsDeadline(i).getTime()); }
  }
  renderPlanViews();
}
function planMarkDone(key) {
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
    ${!t.done && !t.locked ? `<div class="plan-btns"><button class="btn btn-primary" onclick="${t.action}">${t.upcoming ? '先にやる' : '▶️ 始める'}</button>${t.key === 'words' || t.key === 'examples' ? `<button class="btn btn-secondary" onclick="planMarkDone('${t.key}')">✅ 済にする</button>` : ''}</div>` : ''}
  </div>`;
}
function renderPlanHome() {
  const box = document.getElementById('planHomeCard');
  if (!box) return;
  if (!planOk()) { box.style.display = 'none'; return; }
  const i = planWeekIndex(), cur = planWeekFolder(i);
  const tasks = planTasks();
  const st = planStreak();
  box.style.display = 'block';
  if (!cur && i >= studyPlan.weeks.length) { box.innerHTML = `<div class="setting-box-title">📅 週間プラン</div><div class="hint-small">🎉 プランの範囲は全部終わりました（${studyPlan.weeks.length}週）。暗記タブの「📅 週間プラン」で次のプランを作れます。</div>`; return; }
  box.innerHTML = `<div class="setting-box-title" style="display:flex; justify-content:space-between; align-items:center;"><span>📅 今週のプラン${cur ? `（${i + 1}週目）` : ''}</span>${st ? `<span class="plan-streak">🔥 ${st}週連続で期限内</span>` : ''}</div>
    ${cur ? '' : `<div class="hint-small">プランは ${escapeHtml(studyPlan.start)} の週から始まります。</div>`}
    ${tasks.map(planTaskHTML).join('')}`;
}
function renderPlanSettings() {
  const box = document.getElementById('planSettings');
  if (!box) return;
  const p = studyPlan || {};
  // ★【0.03.30】どの階層のフォルダーでも選べる。1週の範囲は「直下」「2つ下」…「いちばん下」から選ぶ
  const roots = getSortedCategoriesForMenu().filter(c => planUnitFolders(c, 'leaves').length >= 2);
  const root = [_planDraftRoot, p.root, roots[0]].find(c => c && categories.includes(c)) || '';
  const unit = _planDraftUnit || p.unit || 'leaves';
  const children = root ? planUnitFolders(root, unit) : [];
  const curIdx = planOk() && root === p.root && unit === (p.unit || 'leaves') ? Math.max(0, Math.min(children.length - 1, planWeekIndex())) : 0;
  const depth = root ? planMaxDepth(root) : 1;
  const unitOpts = [['leaves', '単語が入っているいちばん下のフォルダー'], ['children', '直下のフォルダー']].concat(Array.from({ length: Math.max(0, depth - 1) }, (_, k) => ['d' + (k + 2), `${k + 2}つ下のフォルダー`]));
  const daySel = (id, v) => `<select id="${id}" class="form-control">${PLAN_DAYS.map((d, i) => `<option value="${i}" ${Number(v) === i ? 'selected' : ''}>${d}曜</option>`).join('')}</select>`;
  box.innerHTML = `
    ${planOk() ? `<div class="hint-small" style="margin-bottom:8px;">✅ 使っています：${escapeHtml(p.root)}（${p.weeks.length}週・${escapeHtml(p.start)} の週から）</div>` : '<div class="hint-small" style="margin-bottom:8px;">1週間に1つのフォルダーずつ進めるプランを作ります。</div>'}
    <label class="section-label" style="font-weight:500;">📚 単語帳（親フォルダー）</label>
    <select id="planRoot" class="form-control" onchange="studyPlanDraftRoot(this.value)">${roots.map(c => { const d = getCategoryPath(c).length - 1; return `<option value="${escapeHtml(c)}" ${c === root ? 'selected' : ''}>${'　'.repeat(d)}${d ? '└ ' : ''}${escapeHtml(c)}</option>`; }).join('')}</select>
    <label class="section-label" style="font-weight:500; margin-top:8px;">📏 1週の範囲</label>
    <select id="planUnit" class="form-control" onchange="studyPlanDraftUnit(this.value)">${unitOpts.map(([v, l]) => `<option value="${v}" ${v === unit ? 'selected' : ''}>${l}（${root ? planUnitFolders(root, v).length : 0}週）</option>`).join('')}</select>
    <label class="section-label" style="font-weight:500; margin-top:8px;">📍 今週の範囲</label>
    <select id="planCurrent" class="form-control">${children.map((c, k) => `<option value="${k}" ${k === curIdx ? 'selected' : ''}>${k + 1}週目：${escapeHtml(c)}</option>`).join('')}</select>
    <div class="hint-small">選んだ階層のフォルダーを、上から1週に1つずつ進めます（フォルダーの並び順で）。「上のフォルダーから出題しない」にしたフォルダー（例文・Review Test など）は週に数えません。</div>
    <div class="form-row" style="margin-top:8px; align-items:center;">
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
    <div class="plan-btns" style="margin-top:10px;"><button class="btn btn-primary" onclick="saveStudyPlan()" ${children.length ? '' : 'disabled'}>💾 ${planOk() ? '更新' : 'プランを作る'}</button>${planOk() ? '<button class="btn btn-secondary" onclick="stopStudyPlan()">やめる</button>' : ''}</div>
    ${roots.length ? '' : '<div class="hint-small drill-ng">サブフォルダーが2つ以上あるフォルダーがありません（例：鉄壁 の下に #1, #2 …）。</div>'}`;
}
let _planDraftRoot = null, _planDraftUnit = null;
function studyPlanDraftRoot(r) { _planDraftRoot = r; renderPlanSettings(); }
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
    walk(root); return out;
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
  const keepLog = studyPlan && studyPlan.root === root ? studyPlan.log || {} : {};
  studyPlan = {
    enabled: true, root, weeks, start: planDateStr(mon),
    wordsFrom: Number(document.getElementById('planFrom').value), wordsDue: Number(document.getElementById('planDue').value),
    reviewDay: Number(document.getElementById('planReviewDay').value), sunday: document.getElementById('planSunday').value,
    monthly: m !== 'off', monthlyStars: m === 'off' ? 2 : Number(m), log: keepLog, planAt: Date.now()
  };
  _planDraftRoot = null; _planDraftUnit = null;
  studyPlan.unit = unit;
  saveData(true);
  renderPlanViews();
  alert(`📅 プランを作りました。今週は「${weeks[idx]}」です。`);
}
function stopStudyPlan() {
  if (!confirm('週間プランをやめますか？（達成の記録は消えます）')) return;
  studyPlan = { enabled: false, planAt: Date.now() };
  saveData(true); renderPlanViews();
}
function renderPlanViews() {
  renderPlanHome();
  const dp = document.getElementById('drillPlanBox');
  if (dp) dp.innerHTML = planOk() ? planTasks().map(planTaskHTML).join('') : '';
  renderPlanSettings();
  planSyncNotice();
}

// ---------------- 通知 ----------------
// 今週の単語の予定（始める日・期限・終わったか）を通知の設定に渡す。アプリを開かない日も、プッシュ通知の送信側が
// 「あと何日で期限」「期限を過ぎています」を知らせられるように
let _planNoticeKey = '';
function planSyncNotice() {
  if (typeof currentUser === 'undefined' || !currentUser || typeof firestore === 'undefined') return;
  let info = null;
  if (planOk()) {
    const i = planWeekIndex(), cur = planWeekFolder(i);
    if (cur) {
      const from = planParseDate(planWeekKey(i)); from.setDate(from.getDate() + ((studyPlan.wordsFrom ?? 2) + 6) % 7);
      const L = planLog(i), ex = planExampleCards(cur);
      info = { cat: cur, week: planWeekKey(i), from: from.getTime(), due: planWordsDeadline(i).getTime(), wordsDone: !!L.words,
        examples: ex.length > 0, examplesDone: !!L.examples, sunday: studyPlan.sunday !== 'off' && !!planWeekFolder(i - 1), sundayDone: !!L.sunday, reviewDay: studyPlan.reviewDay ?? 0 };
    }
  }
  const key = JSON.stringify(info);
  if (key === _planNoticeKey) return;
  let token = null; try { token = localStorage.getItem('susuru_anki_push_token'); } catch (e) {}
  if (!token) return; // 通知をオンにしていない
  _planNoticeKey = key;
  firestore.collection('susuru_anki_push').doc(currentUser.uid).set({ plan: info }, { merge: true }).catch(e => { _planNoticeKey = ''; console.warn('プランの通知の保存に失敗:', e.message); });
}
