// ----------------- 実績とグラフ -----------------
// ★【0.03.24】ランク分布をフォルダーごとに見られるようにする（空＝すべて）
let statsCategory = (() => { try { return localStorage.getItem('susuru_anki_stats_cat') || ''; } catch (e) { return ''; } })();
function setStatsCategory(cat) { statsCategory = cat || ''; try { localStorage.setItem('susuru_anki_stats_cat', statsCategory); } catch (e) {} renderStatsAndCharts(); }
// 選んだフォルダー（と、その下のフォルダー）のカード
function statsCards(cat) {
  if (!cat || !categories.includes(cat)) return db;
  const set = new Set(getAllSubcategories(cat));
  return db.filter(q => set.has(q.category));
}
// カードのランク（卒業・得意・普通・苦手・しっかり・未着手）。一覧の絞り込みと同じ決め方
// ★【0.04.14】暗記テストで答えたカードも「答えたことがある」に数える（前は、暗記テストだけで覚えたカードが「未着手」にも数えられていた）
function cardAnswered(q) { const d = q.drillStats || {}; return (q.correct || 0) + (q.incorrect || 0) > 0 || (d.c || 0) + (d.w || 0) > 0; }
const STATUS_TESTS = {
  grad: q => isGraduated(q),
  master: q => !isGraduated(q) && q.level >= 3,
  normal: q => !isGraduated(q) && q.level >= 1 && q.level <= 2,
  weak: q => !isGraduated(q) && q.level === 0 && cardAnswered(q),
  shikkari: q => !isGraduated(q) && q.level === -1,
  unseen: q => !isGraduated(q) && q.level === 0 && !cardAnswered(q)
};
const STATUS_NAMES = { grad: '🎓 卒業', master: '⚡ 得意', normal: '☕ 普通', weak: '⚠️ 苦手', shikkari: '🧱 しっかり', unseen: '💤 未着手' };
function renderStatsAndCharts() {
  if (statsCategory && !categories.includes(statsCategory)) statsCategory = '';
  // ★【0.03.81】フォルダーはフォルダーを選ぶ画面で
  const pk = document.getElementById('statsCatPick');
  if (pk) pk.innerHTML = folderPickFieldHTML('selStatsCategory', statsCategory, { title: '🥧 ランク分布のフォルダー', allLabel: '📚 すべてのフォルダー', hint: '選んだフォルダー（下のフォルダーも含む）だけの分布にします', onChange: v => setStatsCategory(v) });
  const cards = statsCards(statsCategory);
  const t = cards.length;
  document.getElementById('statTotal').innerText = t;
  const cnt = k => cards.filter(STATUS_TESTS[k]).length;
  const cG = cnt('grad'), cM = cnt('master'), cN = cnt('normal'), cW = cnt('weak'), cS = cnt('shikkari'), cU = cnt('unseen');

  document.getElementById('cntGrad').innerText = cG;
  document.getElementById('cntMaster').innerText = cM;
  document.getElementById('cntNormal').innerText = cN;
  document.getElementById('cntWeak').innerText = cW;
  document.getElementById('cntShikkari').innerText = cS;
  document.getElementById('cntUnseen').innerText = cU;
  document.getElementById('statGradRatio').innerText = t > 0 ? `${Math.round((cG/t)*100)}%` : '0%';
  const lbl = document.getElementById('lblStatsScope'); if (lbl) lbl.innerText = statsCategory ? `📁 ${statsCategory}（下のフォルダーも含む）` : '';

  if(chartInstance) chartInstance.destroy();
  const ctx = document.getElementById('rankPieChart').getContext('2d');
  Chart.defaults.color = document.body.classList.contains('light-mode') ? '#4b5563' : '#e8edf5';
  chartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: ['卒業','得意','普通','苦手','しっかり'], datasets: [{ data: [cG,cM,cN,cW,cS], backgroundColor: ['#22c77a','#4f7cff','#f5a623','#ff4f6a','#9aa0a6'], borderWidth:0 }] },
    options: { plugins: { legend: { position: 'bottom' } }, cutout: '70%',
      // グラフの色をタップすると、そのランクの問題一覧を開く
      onClick: (e, els) => { if (els && els.length) filterBoxByStatus(['grad', 'master', 'normal', 'weak', 'shikkari'][els[0].index]); } }
  });

  renderStatsFriends(); // ★【0.04.14】フレンドと比べる
  if (typeof renderGamePanel === 'function') try { renderGamePanel(); } catch (e) {} // ★【0.04.53】🏆 ごほうび
  renderStudyHeatmap(); // ★【0.03.62】学習した日の記録（studyDays）から。以前は過去の日がでたらめだった
}


// ================================================================
// ★【0.04.14】👥 フレンドと比べる（実績の画面）
// 自分の成績のまとめ（連続記録・問題数・ランク分布）を、成績共有がオンのとき susuru_anki_category_scores に
// mode:'summary' で1つだけ書き、フレンドの分を読んで並べる
// ================================================================
function statsSummary() {
  const s = getStreakInfo(), days = {}; Object.entries(studyDays || {}).forEach(([k, v]) => { days[k] = studyDayCount(v); });
  const today = getTodayStr(), d0 = new Date(today + 'T12:00:00');
  const mon = streakShift(today, -((d0.getDay() + 6) % 7)), first = today.slice(0, 8) + '01';
  let week = 0, month = 0; Object.entries(days).forEach(([k, n]) => { if (k >= mon && k <= today) week += n; if (k >= first && k <= today) month += n; });
  const c = k => db.filter(STATUS_TESTS[k]).length;
  return { streak: s.cur, best: s.best, today: s.todayCount, week, month, daysTotal: s.total,
    grad: c('grad'), master: c('master'), normal: c('normal'), weak: c('weak') + c('shikkari'), unseen: c('unseen'), cards: db.length, date: today,
    lv: typeof gameStats === 'function' ? (() => { try { return gameLevelOf(gameStats().xp).lv; } catch (e) { return 0; } })() : 0, // ★【0.04.53】⭐ レベル
    ...(typeof gameLeagueMine === 'function' ? (() => { try { return gameLeagueMine(); } catch (e) { return {}; } })() : {}) }; // ★【0.04.54】週間リーグ（wk・wxp・lwxp）
}
// ★【0.04.17】解いたら数秒後に送る（前は2分に1回までだったので、フレンドの画面になかなか出なかった）
let _sumSent = '', _sumTimer = null;
function publishStatsSummary(force) {
  if (typeof currentUser === 'undefined' || !currentUser || typeof raceShareOn !== 'function' || !raceShareOn()) return;
  clearTimeout(_sumTimer);
  _sumTimer = setTimeout(() => {
    const sum = statsSummary(), key = JSON.stringify(sum);
    if (key === _sumSent) return;
    _sumSent = key;
    firestore.collection('susuru_anki_category_scores').doc('summary_' + currentUser.uid)
      .set(Object.assign({ mode: 'summary', uid: currentUser.uid, name: currentUser.displayName || 'Anonymous', updatedAt: Date.now() }, sum))
      .catch(() => { _sumSent = ''; });
  }, force ? 0 : 4000);
}
async function renderStatsFriends() {
  const box = document.getElementById('statsFriendBox'); if (!box) return;
  if (typeof currentUser === 'undefined' || !currentUser) { box.innerHTML = 'ログインすると、フレンドと成績を比べられます。'; return; }
  publishStatsSummary(true);
  if (typeof startFriendLiveWatch === 'function') startFriendLiveWatch();
  let friends = [], docs = [];
  try {
    friends = await myFriendList();
    if (friends.length) docs = (await firestore.collection('susuru_anki_category_scores').where('mode', '==', 'summary').get()).docs.map(d => d.data()).filter(d => friends.includes(d.uid));
  } catch (e) { box.innerHTML = '<span class="drill-ng">フレンドの成績を読めませんでした。</span>'; return; }
  if (!friends.length) { box.innerHTML = 'フレンドを追加すると、ここで成績を比べられます（「👥 フレンド」の画面から）。'; return; }
  const today = getTodayStr();
  // 前の日の記録の「今日」は0、別の週・月なら今週・今月も0にして比べる
  const fix = d => { const x = Object.assign({}, d); if (x.date !== today) { x.today = 0; const mon = streakShift(today, -((new Date(today + 'T12:00:00').getDay() + 6) % 7)); if (!(x.date >= mon)) x.week = 0; if (String(x.date).slice(0, 7) !== today.slice(0, 7)) x.month = 0; if (x.date < streakShift(today, -1)) x.streak = 0; } return x; };
  const me = Object.assign({ name: 'あなた', me: true }, statsSummary());
  // ★【0.04.17】まだまとめが無いフレンドも列に出す（「—」。前は出なかったので、比べられないように見えた）
  const have = new Set(docs.map(d => d.uid)), noSum = friends.filter(u => !have.has(u)).slice(0, 10);
  const noNames = await Promise.all(noSum.map(u => (typeof friendNameOf === 'function' ? friendNameOf(u) : Promise.resolve('フレンド')).catch(() => 'フレンド')));
  const cols = [me, ...docs.map(fix).sort((a, b) => (b.week || 0) - (a.week || 0)), ...noSum.map((u, i) => ({ name: noNames[i], none: true }))];
  const rows = [['⭐ レベル', 'lv'], ['🔥 連続記録（日）', 'streak'], ['🏆 最長（日）', 'best'], ['📝 今日の問題数', 'today'], ['📅 今週の問題数', 'week'], ['🗓️ 今月の問題数', 'month'], ['📆 学習した日（合計）', 'daysTotal'],
    ['🎓 卒業', 'grad'], ['⚡ 得意', 'master'], ['⚠️ 苦手・しっかり', 'weak', true], ['🃏 カードの数', 'cards']];
  const best = (k, low) => { const v = cols.filter(c => !c.none).map(c => Number(c[k]) || 0); return low ? null : Math.max(...v); };
  const missing = friends.length - docs.length;
  box.innerHTML = `<div class="stats-cmp-wrap"><table class="stats-cmp"><tr><th></th>${cols.map(c => `<th>${escapeHtml(c.name)}</th>`).join('')}</tr>
    ${rows.map(([l, k, low]) => { const b = best(k, low); return `<tr><th>${l}</th>${cols.map(c => { if (c.none) return '<td class="hint-small">—</td>'; const v = Number(c[k]) || 0; return `<td class="${!low && b > 0 && v === b ? 'top' : ''}">${v}</td>`; }).join('')}</tr>`; }).join('')}
    <tr><th>🕒 記録</th>${cols.map(c => `<td class="hint-small">${c.me ? '今' : c.none ? 'まだ無し' : escapeHtml(String(c.date || '').slice(5).replace('-', '/'))}</td>`).join('')}</tr></table></div>
    ${missing > 0 ? `<div class="hint-small" style="margin-top:6px;">「—」のフレンドは、成績共有がオフか、まだ新しい版のアプリで問題を解いていないため、成績がまだ届いていません。</div>` : ''}
    ${typeof raceShareOn === 'function' && !raceShareOn() ? '<div class="hint-small" style="margin-top:6px;">⚠️ あなたの成績共有がオフなので、フレンドからはあなたの成績が見えません（設定の「👥 フレンド・ランキング」でオンにできます）。</div>' : ''}
    <button class="btn btn-secondary" style="margin-top:8px;" onclick="openPage('pgCompareStats')">📈 正答率の推移・暗記テストの進み具合を詳しく比べる</button>`;
}
