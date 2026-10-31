// ================================================================
// ★【0.03.62】🔥 連続記録（Duolingo風）
// studyDays（storage.js・同期される）= { 'YYYY-MM-DD': その日に答えた数 }
// 今日まだ解いていなくても、昨日まで続いていれば記録は途切れていない（今日解けば +1）
// ================================================================
function streakDateStr(d) { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().split('T')[0]; }
function streakShift(ymd, days) { const d = new Date(ymd + 'T12:00:00'); d.setDate(d.getDate() + days); return streakDateStr(d); }

let _streakSaveDay = null;
// 1問答えるたびに呼ぶ（quiz.js の recordDailyLog から）
function markStudyDay() {
  const t = getTodayStr();
  if (!studyDays || typeof studyDays !== 'object') studyDays = {};
  const first = !studyDayCount(studyDays[t]);
  // ★【0.03.73】端末ごとに数える（同期で端末ごとに多い方を残し、合計を表示する）
  const v = studyDays[t], o = typeof v === 'number' ? (v > 0 ? { _: v } : {}) : Object.assign({}, v || {});
  o[DEVICE_ID] = (o[DEVICE_ID] || 0) + 1; studyDays[t] = o;
  // 今日はじめての1問はすぐ保存（同期）。それ以降はほかの保存についでに乗る
  if (first && _streakSaveDay !== t) { _streakSaveDay = t; try { saveData(); } catch (e) {} }
  else { try { if (!_localWriteTimer) _localWriteTimer = setTimeout(writeLocal, 400); } catch (e) {} }
  if (first) { renderStreakCard(); if (typeof updateAppBadge === 'function') updateAppBadge(); }
}

function getStreakInfo() {
  const days = {}; Object.entries(studyDays || {}).forEach(([k, v]) => { days[k] = studyDayCount(v); });
  const today = getTodayStr();
  const doneToday = (days[today] || 0) > 0;
  let cur = 0, d = doneToday ? today : streakShift(today, -1);
  while ((days[d] || 0) > 0) { cur++; d = streakShift(d, -1); }
  // 最長記録
  const keys = Object.keys(days).filter(k => days[k] > 0).sort();
  let best = 0, run = 0, prev = null;
  keys.forEach(k => { run = (prev && streakShift(prev, 1) === k) ? run + 1 : 1; if (run > best) best = run; prev = k; });
  const total = keys.length;
  return { cur, best: Math.max(best, cur), doneToday, total, todayCount: days[today] || 0 };
}

function renderStreakCard() {
  const el = document.getElementById('streakCard'); if (!el) return;
  const s = getStreakInfo();
  // 直近7日の丸
  const today = getTodayStr(), wd = ['日', '月', '火', '水', '木', '金', '土'];
  let dots = '';
  for (let i = 6; i >= 0; i--) {
    const k = streakShift(today, -i), on = studyDayCount((studyDays || {})[k]) > 0;
    dots += `<div class="streak-day${on ? ' on' : ''}${i === 0 ? ' today' : ''}"><div class="streak-dot">${on ? '🔥' : ''}</div><div class="streak-wd">${wd[new Date(k + 'T12:00:00').getDay()]}</div></div>`;
  }
  const msg = s.doneToday ? `今日は ${s.todayCount}問 解きました` : (s.cur > 0 ? `⚠️ 今日1問解かないと ${s.cur}日の記録が途切れます` : '今日1問解いて記録をはじめよう');
  el.className = 'streak-card' + (s.doneToday ? ' done' : (s.cur > 0 ? ' risk' : ''));
  el.innerHTML = `<div class="streak-main"><div class="streak-fire">${s.doneToday ? '🔥' : '🕯️'}</div>
      <div style="flex:1; min-width:0;"><div class="streak-num">${s.cur}<span>日連続</span></div><div class="streak-msg">${msg}</div></div>
      <div class="streak-best">最長<b>${s.best}</b>日</div></div>
    <div class="streak-week">${dots}</div>`;
}

// 学習ヒートマップ（実績ページ・過去12週）
function renderStudyHeatmap() {
  const hc = document.getElementById('heatmapContainer'); if (!hc) return;
  const today = getTodayStr(), days = {}; Object.entries(studyDays || {}).forEach(([k, v]) => { days[k] = studyDayCount(v); });
  const weeks = 12;
  // 今週の土曜日まで並べる（列＝週、行＝曜日）
  const endOffset = 6 - new Date(today + 'T12:00:00').getDay();
  const start = streakShift(today, endOffset - (weeks * 7 - 1));
  let html = '';
  for (let w = 0; w < weeks; w++) {
    html += '<div class="heatmap-col">';
    for (let r = 0; r < 7; r++) {
      const k = streakShift(start, w * 7 + r), n = days[k] || 0;
      const lvl = k > today ? -1 : n >= 50 ? 4 : n >= 20 ? 3 : n >= 5 ? 2 : n > 0 ? 1 : 0;
      html += `<div class="heatmap-cell"${lvl < 0 ? ' style="visibility:hidden"' : ''} data-level="${Math.max(lvl, 0)}" title="${k}：${n}問"></div>`;
    }
    html += '</div>';
  }
  const s = getStreakInfo();
  hc.innerHTML = `<div class="heatmap-weeks">${html}</div>
    <div class="hint-small" style="margin-top:8px; text-align:center;">🔥 ${s.cur}日連続 ・ 最長 ${s.best}日 ・ 学習した日 合計 ${s.total}日</div>`;
}

// ★【0.03.62】アプリのアイコンのバッジ：今日の週間プランの残り（対応している端末だけ）。
// 今日まだ1問も解いていなくてプランも無いときは「1」を付けて連続記録を守るよう促す
function updateAppBadge() {
  if (!('setAppBadge' in navigator)) return;
  let n = 0;
  try { if (typeof planTodayRemaining === 'function') n = planTodayRemaining(); } catch (e) {}
  if (!n && !getStreakInfo().doneToday && getStreakInfo().cur > 0) n = 1;
  try { if (n > 0) navigator.setAppBadge(n); else navigator.clearAppBadge(); } catch (e) {}
}

// 連続記録を始める前の分：毎日の学習ログ（クラウド・本人の分）から過去60日をいちどだけ読み込む
async function streakBackfill() {
  if (!currentUser || typeof firestore === 'undefined') return;
  const key = 'susuru_anki_streak_backfill_' + currentUser.uid;
  try { if (localStorage.getItem(key)) return; } catch (e) { return; }
  const today = getTodayStr(), found = {};
  try {
    const ids = Array.from({ length: 60 }, (_, i) => streakShift(today, -i));
    for (let i = 0; i < ids.length; i += 15) {
      await Promise.all(ids.slice(i, i + 15).map(async d => {
        const s = await firestore.collection('susuru_anki_logs').doc(`${d}_${currentUser.uid}`).get();
        if (s.exists) { const n = Number((s.data() || {}).answered) || 0; if (n > 0) found[d] = n; }
      }));
    }
  } catch (e) { return; } // オフラインなど：次の起動でもう一度
  if (!studyDays || typeof studyDays !== 'object') studyDays = {};
  let changed = false;
  // ログはアカウント全体の数。記録がまったく無い日（今日を除く）にだけ「_log」として入れる（端末ごとの数と二重に数えないように）
  Object.entries(found).forEach(([d, n]) => { if (d !== today && !studyDayCount(studyDays[d])) { studyDays[d] = { _log: n }; changed = true; } });
  try { localStorage.setItem(key, '1'); } catch (e) {}
  if (changed) { try { saveData(); } catch (e) {} }
  renderStreakCard(); updateAppBadge();
}
