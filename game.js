// ================================================================
// ★【0.04.53】🏆 ごほうび（ゲーム性）：続けるほど・解くほど・正解するほど、何かがもらえる
//  ・⭐ レベルと称号：経験値（XP）で上がる。XP は記録から毎回数え直す（どの端末でも同じになる）
//      解いた数×1 ＋ 正解×1 ＋ 学習した日×10 ＋ 卒業したカード×5 ＋ 今日のミッション（1つ20・全部で＋30）
//  ・🎯 今日のミッション：毎日3つ（解く・正解・連続正解）。日ごとに決まった目標
//  ・🏅 バッジ：連続記録・解いた数・正解数・卒業・学習した日・ミッション・コンボ・レベル
//  ・🛡️ お守り：7日続けるごとに1つ（2つまで）。1日休んでも、お守りが連続記録を守る（自動で使う）
//  ・🔥 炎の色：連続記録が長いほど変わる（30日 青・100日 紫・365日 虹）
// 記録：studyDays（解いた数）と gameDays（storage.js・同期：正解数・最大コンボ・お守りで守った日）
// ================================================================
const GAME_SEEN_KEY = 'susuru_anki_game_seen';
let _gameCombo = 0, _gameCheckTimer = null;

function gameToday() { return getTodayStr(); }
function gameDayObj(d) { if (!gameDays || typeof gameDays !== 'object') gameDays = {}; const v = gameDays[d]; return v && typeof v === 'object' ? v : {}; }
function gameSum(d, prefix) { return Object.entries(gameDayObj(d)).reduce((a, [k, n]) => a + (k.startsWith(prefix) ? (Number(n) || 0) : 0), 0); }
function gameMax(d, prefix) { return Object.entries(gameDayObj(d)).reduce((a, [k, n]) => k.startsWith(prefix) ? Math.max(a, Number(n) || 0) : a, 0); }
function gameAnswers(d) { return studyDayCount((studyDays || {})[d]); }
function gameCorrect(d) { return gameSum(d, 'c:'); }
function gameCombo(d) { return gameMax(d, 'k:'); }
function gameFrozen(d) { return !!gameDayObj(d).frz; }

// 1問答えるたびに（quiz.js の recordDailyLog から。クイズ・暗記テスト）
function gameOnAnswer(ok) {
  const d = gameToday();
  if (!gameDays || typeof gameDays !== 'object') gameDays = {};
  const o = Object.assign({}, gameDayObj(d));
  _gameCombo = ok ? _gameCombo + 1 : 0;
  if (ok) o['c:' + DEVICE_ID] = (Number(o['c:' + DEVICE_ID]) || 0) + 1;
  if (_gameCombo > (Number(o['k:' + DEVICE_ID]) || 0)) o['k:' + DEVICE_ID] = _gameCombo;
  gameDays[d] = o;
  clearTimeout(_gameCheckTimer);
  _gameCheckTimer = setTimeout(() => { gameCheck(true); renderGameBar(); }, 700);
}

// ---------------- 🎯 今日のミッション ----------------
// 日ごとに決まった目標（同じ日ならどの端末でも同じ）
function gameSeed(d) { let h = 2166136261; for (const ch of d) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function gameMissions(d) {
  const h = gameSeed(d || gameToday());
  const ans = [20, 30, 40, 50][h % 4], cor = [15, 20, 30, 40][(h >> 3) % 4], combo = [5, 8, 10, 15][(h >> 6) % 4];
  return [
    { id: 'ans', icon: '📝', text: `${ans}問 解く`, goal: ans, now: gameAnswers(d) },
    { id: 'cor', icon: '⭕', text: `${cor}問 正解する`, goal: cor, now: gameCorrect(d) },
    { id: 'combo', icon: '⚡', text: `${combo}問 続けて正解する`, goal: combo, now: gameCombo(d) },
  ].map(m => Object.assign(m, { done: m.now >= m.goal }));
}

// ---------------- 🛡️ お守り（記録から数え直す） ----------------
// 古い日から順に：解いた日が7日続くごとに +1（2つまで）、お守りで守った日は -1
function gameShieldInfo() {
  const keys = new Set([...Object.keys(studyDays || {}).filter(k => gameAnswers(k) > 0), ...Object.keys(gameDays || {}).filter(gameFrozen)]);
  const sorted = [...keys].sort();
  let held = 0, run = 0, earned = 0, prev = null;
  sorted.forEach(d => {
    if (prev && streakShift(prev, 1) !== d) run = 0; // 途切れた
    if (gameFrozen(d) && !(gameAnswers(d) > 0)) held = Math.max(0, held - 1);
    else { run++; if (run % 7 === 0) { earned++; held = Math.min(2, held + 1); } }
    prev = d;
  });
  return { held, earned };
}
// 休んだ日を、お守りで守る（アプリを開いたとき・日付が変わったとき）。足りなければ使わない
function gameUseShields() {
  const today = gameToday(), yest = streakShift(today, -1);
  if (gameAnswers(yest) > 0 || gameFrozen(yest)) return false;
  // いちばん最近の、続いていた日
  let last = null;
  for (let i = 2; i <= 4; i++) { const d = streakShift(today, -i); if (gameAnswers(d) > 0 || gameFrozen(d)) { last = d; break; } }
  if (!last) return false;
  const missed = []; for (let d = streakShift(last, 1); d < today; d = streakShift(d, 1)) missed.push(d);
  const { held } = gameShieldInfo();
  if (!missed.length || missed.length > held) return false;
  missed.forEach(d => { gameDays[d] = Object.assign({}, gameDayObj(d), { frz: 1 }); });
  try { saveData(); } catch (e) {}
  setTimeout(() => gameCelebrate('🛡️', `お守りが連続記録を守りました`, `${missed.length}日休んだ分を、お守り${missed.length}つで守りました。今日も1問解こう！`), 1200);
  return true;
}

// ---------------- ⭐ レベル・称号 ----------------
function gameStats() {
  let answers = 0, days = 0;
  Object.keys(studyDays || {}).forEach(k => { const n = gameAnswers(k); answers += n; if (n > 0) days++; });
  let correct = 0, missionDays = 0, missionDone = 0, maxCombo = 0;
  Object.keys(gameDays || {}).forEach(k => {
    correct += gameCorrect(k); maxCombo = Math.max(maxCombo, gameCombo(k));
  });
  // ミッション：記録のある日を全部見る（studyDays の日）
  Object.keys(studyDays || {}).forEach(k => { if (gameAnswers(k) <= 0) return; const ms = gameMissions(k), n = ms.filter(m => m.done).length; missionDone += n; if (n === ms.length) missionDays++; });
  const grad = typeof STATUS_TESTS !== 'undefined' && STATUS_TESTS.grad ? (db || []).filter(STATUS_TESTS.grad).length : 0;
  const s = getStreakInfo();
  const xp = answers + correct + days * 10 + grad * 5 + missionDone * 20 + missionDays * 30;
  return { answers, correct, days, grad, missionDone, missionDays, maxCombo, xp, streak: s.cur, best: s.best };
}
// レベル L → L+1 に要る XP は 50 + 20L（Lv1 から）
function gameLevelOf(xp) {
  let lv = 1, need = 70, base = 0;
  while (xp >= base + need && lv < 999) { base += need; lv++; need = 50 + 20 * lv; }
  return { lv, into: xp - base, need };
}
const GAME_TITLES = [[1, '🌱 見習い'], [5, '📗 駆け出し'], [10, '📘 一人前'], [15, '📙 熟練'], [20, '🎖️ 達人'], [25, '🥋 師範'], [30, '🧙 賢者'], [40, '👑 名人'], [50, '🌟 伝説'], [70, '🐉 神話']];
function gameTitle(lv) { let t = GAME_TITLES[0][1]; GAME_TITLES.forEach(([l, n]) => { if (lv >= l) t = n; }); return t; }
function gameNextTitle(lv) { const n = GAME_TITLES.find(([l]) => l > lv); return n ? { lv: n[0], name: n[1] } : null; }

// ---------------- 🔥 炎の色 ----------------
function gameFlame(streak) {
  if (streak >= 365) return { cls: 'flame-rainbow', name: '🌈 虹の炎' };
  if (streak >= 100) return { cls: 'flame-purple', name: '💜 紫の炎' };
  if (streak >= 30) return { cls: 'flame-blue', name: '💙 青い炎' };
  return { cls: '', name: '🔥 炎' };
}

// ---------------- 🏅 バッジ ----------------
function gameBadgeDefs() {
  const B = [];
  const add = (key, icon, name, list, val, unit) => list.forEach(n => B.push({ id: `${key}${n}`, icon, name: name.replace('N', n), need: n, val, unit }));
  add('st', '🔥', 'N日連続', [3, 7, 14, 30, 60, 100, 200, 365], s => s.best, '日');
  add('an', '📝', 'N問 解いた', [100, 500, 1000, 3000, 5000, 10000, 30000], s => s.answers, '問');
  add('co', '⭕', 'N問 正解', [100, 500, 1000, 3000, 10000], s => s.correct, '問');
  add('gr', '🎓', 'N枚 卒業', [10, 50, 100, 300, 1000], s => s.grad, '枚');
  add('dy', '📆', 'N日 学習', [10, 30, 100, 200, 365], s => s.days, '日');
  add('ms', '🎯', 'ミッション全部 N日', [1, 7, 30, 100], s => s.missionDays, '日');
  add('cb', '⚡', 'N問 連続正解', [10, 20, 50, 100], s => s.maxCombo, '問');
  add('lv', '⭐', 'レベル N', [5, 10, 20, 30, 50], s => gameLevelOf(s.xp).lv, '');
  return B;
}
function gameBadges(st) { st = st || gameStats(); return gameBadgeDefs().map(b => { const v = b.val(st); return Object.assign({}, b, { now: v, got: v >= b.need }); }); }

// ---------------- 知らせる（新しくもらったもの） ----------------
function gameSeen() { try { return JSON.parse(localStorage.getItem(GAME_SEEN_KEY) || 'null'); } catch (e) { return null; } }
function gameSaveSeen(o) { try { localStorage.setItem(GAME_SEEN_KEY, JSON.stringify(o)); } catch (e) {} }
function gameCheck(announce) {
  if (typeof db === 'undefined') return;
  const st = gameStats(), lv = gameLevelOf(st.xp).lv, badges = gameBadges(st).filter(b => b.got).map(b => b.id);
  const today = gameToday(), ms = gameMissions(today).filter(m => m.done).map(m => m.id), sh = gameShieldInfo().earned;
  const seen = gameSeen();
  const now = { lv, badges, day: today, missions: ms, shields: sh };
  if (!seen) { gameSaveSeen(now); return; } // はじめては、今までの分を知らせない
  if (!announce) { gameSaveSeen(Object.assign(now, { missions: seen.day === today ? [...new Set([...(seen.missions || []), ...ms])] : ms })); return; }
  const msgs = [];
  const prevMs = seen.day === today ? (seen.missions || []) : [];
  const allMs = gameMissions(today);
  ms.filter(id => !prevMs.includes(id)).forEach(id => { const m = allMs.find(x => x.id === id); if (m) msgs.push(['🎯', 'ミッション達成！', `${m.icon} ${m.text}（+20 XP）`]); });
  if (ms.length === allMs.length && prevMs.length < allMs.length) msgs.push(['🎁', '今日のミッション コンプリート！', 'ボーナス +30 XP。明日も新しいミッションがあります']);
  if (lv > (seen.lv || 1)) msgs.push(['⭐', `レベルアップ！ Lv.${lv}`, gameTitle(lv) !== gameTitle(seen.lv || 1) ? `新しい称号「${gameTitle(lv)}」になりました！` : `称号：${gameTitle(lv)}`]);
  badges.filter(id => !(seen.badges || []).includes(id)).forEach(id => { const b = gameBadgeDefs().find(x => x.id === id); if (b) msgs.push(['🏅', 'バッジを手に入れた！', `${b.icon} ${b.name}`]); });
  if (sh > (seen.shields || 0)) msgs.push(['🛡️', 'お守りを手に入れた！', '7日続けたので、お守りが1つ増えました（1日休んでも連続記録を守ります）']);
  gameSaveSeen(now);
  msgs.slice(0, 4).forEach((m, i) => setTimeout(() => gameCelebrate(...m), i * 1600));
}
function gameCelebrate(icon, title, body) {
  let el = document.getElementById('gameToast');
  if (!el) { el = document.createElement('div'); el.id = 'gameToast'; el.className = 'game-toast'; el.onclick = () => { el.classList.remove('show'); }; document.body.appendChild(el); }
  el.innerHTML = `<div class="game-toast-icon">${icon}</div><div><div class="game-toast-title">${escapeHtml(title)}</div><div class="game-toast-body">${escapeHtml(body || '')}</div></div>`;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 3800);
  try { if (navigator.vibrate) navigator.vibrate(30); } catch (e) {}
}

// ---------------- 表示 ----------------
// ホーム（連続記録の下）：レベル・XP・お守り・今日のミッション
function renderGameBar() {
  const el = document.getElementById('gameBar'); if (!el || typeof db === 'undefined') return;
  const st = gameStats(), L = gameLevelOf(st.xp), sh = gameShieldInfo().held, ms = gameMissions(gameToday());
  el.innerHTML = `<div class="game-row"><b class="game-lv">Lv.${L.lv}</b><span class="game-title">${gameTitle(L.lv)}</span>
      <span class="game-shield" title="お守り">${sh ? '🛡️'.repeat(sh) : '<span style="opacity:.35">🛡️</span>'}</span></div>
    <div class="game-xp"><div class="game-xp-fill" style="width:${Math.min(100, Math.round(L.into / L.need * 100))}%"></div></div>
    <div class="game-xp-text">あと ${L.need - L.into} XP で Lv.${L.lv + 1}</div>
    <div class="game-ms">${ms.map(m => `<div class="game-m${m.done ? ' done' : ''}"><span>${m.done ? '✅' : m.icon}</span><span class="game-m-t">${m.text}</span><b>${Math.min(m.now, m.goal)}/${m.goal}</b></div>`).join('')}</div>`;
}
// 実績の画面：レベル・ミッション・お守り・炎・バッジの一覧
function renderGamePanel() {
  const el = document.getElementById('gamePanel'); if (!el || typeof db === 'undefined') return;
  const st = gameStats(), L = gameLevelOf(st.xp), sh = gameShieldInfo(), next = gameNextTitle(L.lv), fl = gameFlame(st.streak);
  const bs = gameBadges(st), got = bs.filter(b => b.got).length;
  const groups = {}; bs.forEach(b => { const k = b.id.replace(/\d+$/, ''); (groups[k] = groups[k] || []).push(b); });
  el.innerHTML = `<div class="game-big"><div class="game-big-lv">Lv.${L.lv}</div><div><div class="game-big-title">${gameTitle(L.lv)}</div>
      <div class="hint-small">${st.xp.toLocaleString()} XP ・ あと ${L.need - L.into} XP で Lv.${L.lv + 1}${next ? `（Lv.${next.lv} で「${next.name}」）` : ''}</div></div></div>
    <div class="game-xp"><div class="game-xp-fill" style="width:${Math.min(100, Math.round(L.into / L.need * 100))}%"></div></div>
    <div class="hint-small" style="margin-top:6px;">XP：解いた数×1・正解×1・学習した日×10・卒業×5・ミッション1つ20（全部で＋30）</div>
    <div class="setting-box-title" style="margin-top:12px;">🎯 今日のミッション</div>
    <div class="game-ms">${gameMissions(gameToday()).map(m => `<div class="game-m${m.done ? ' done' : ''}"><span>${m.done ? '✅' : m.icon}</span><span class="game-m-t">${m.text}</span><b>${Math.min(m.now, m.goal)}/${m.goal}</b></div>`).join('')}</div>
    <div class="hint-small">毎日かわります。1つ +20 XP、3つ全部で +30 XP。</div>
    <div class="setting-box-title" style="margin-top:12px;">🛡️ お守り ${sh.held ? '🛡️'.repeat(sh.held) : '（0）'}</div>
    <div class="hint-small">7日続けるごとに1つもらえます（2つまで持てます）。1日休んでも、次の日にお守りが自動で連続記録を守ります（休んだ日の数だけ使います）。</div>
    <div class="setting-box-title" style="margin-top:12px;">🔥 炎の色：${fl.name}</div>
    <div class="hint-small">連続記録 30日で 💙 青い炎、100日で 💜 紫の炎、365日で 🌈 虹の炎になります。</div>
    <div class="setting-box-title" style="margin-top:12px;">🏅 バッジ（${got} / ${bs.length}）</div>
    ${Object.values(groups).map(list => `<div class="game-badges">${list.map(b => `<div class="game-badge${b.got ? ' got' : ''}" title="${escAttr(b.name)}"><div class="game-badge-i">${b.got ? b.icon : '🔒'}</div><div class="game-badge-n">${escapeHtml(b.name)}</div>${b.got ? '' : `<div class="game-badge-p">${Math.min(b.now, b.need).toLocaleString()}/${b.need.toLocaleString()}</div>`}</div>`).join('')}</div>`).join('')}`;
}

// 起動・日付が変わったとき
function gameInit() {
  try { gameUseShields(); } catch (e) {}
  try { gameCheck(false); } catch (e) {}
  renderGameBar();
}
window.addEventListener('load', () => setTimeout(gameInit, 1500));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(() => { try { gameUseShields(); } catch (e) {} renderGameBar(); }, 800); });
