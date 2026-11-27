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
  // ★【0.04.58】🦉 夜（22時〜朝4時）に解いた数（称号「夜ふかし学者」）
  const hr = new Date().getHours(); if (hr >= 22 || hr < 4) o['n:' + DEVICE_ID] = (Number(o['n:' + DEVICE_ID]) || 0) + 1;
  if (_gameCombo > (Number(o['k:' + DEVICE_ID]) || 0)) o['k:' + DEVICE_ID] = _gameCombo;
  // ★【0.04.56】⚡ XP 2倍のあいだは、もう1回分（解いた1＋正解1）を b: に足す
  if (typeof gameBoostLeft === 'function' && gameBoostLeft() > 0) o['b:' + DEVICE_ID] = (Number(o['b:' + DEVICE_ID]) || 0) + 1 + (ok ? 1 : 0);
  gameDays[d] = o;
  clearTimeout(_gameCheckTimer);
  _gameCheckTimer = setTimeout(() => { gameCheck(true); renderGameBar(); }, 700);
}

// ---------------- 🎯 今日のミッション ----------------
// 日ごとに決まった目標（同じ日ならどの端末でも同じ）
function gameSeed(d) { let h = 2166136261; for (const ch of d) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function gameMissions(d) {
  const h = gameSeed(d || gameToday());
  // ★【0.04.69】>>> で（前は >> で、日付によっては負の数になり、目標が NaN になっていた）
  const ans = [20, 30, 40, 50][h % 4], cor = [15, 20, 30, 40][(h >>> 3) % 4], combo = [5, 8, 10, 15][(h >>> 6) % 4];
  // ★【0.04.56】🔄 入れかえ券を使ったミッションは、目標が半分のやさしいものになる
  const rr = new Set(typeof gameShopList === 'function' ? gameShopList().filter(x => x.item === 'reroll' && x.d === d).map(x => x.slot) : []);
  const half = (id, n) => rr.has(id) ? Math.max(3, Math.round(n / 2)) : n;
  const A = half('ans', ans), C = half('cor', cor), K = half('combo', combo);
  return [
    { id: 'ans', icon: '📝', text: `${A}問 解く`, goal: A, now: gameAnswers(d) },
    { id: 'cor', icon: '⭕', text: `${C}問 正解する`, goal: C, now: gameCorrect(d) },
    { id: 'combo', icon: '⚡', text: `${K}問 続けて正解する`, goal: K, now: gameCombo(d) },
  ].map(m => Object.assign(m, { done: m.now >= m.goal, rr: rr.has(m.id) }));
}

// ---------------- 🛡️ お守り（記録から数え直す） ----------------
// 古い日から順に：解いた日が7日続くごとに +1（2つまで）、ショップで買うと +1、お守りで守った日（frz:1）は -1
//  ★【0.04.54】記録の復活（ショップ）で守った日は frz:2（お守りは減らない）
function gameShopList() { return Object.entries(gameShop && typeof gameShop === 'object' ? gameShop : {}).filter(([, v]) => v && !v.deleted).map(([id, v]) => Object.assign({ id }, v)); }
function gameShieldInfo() {
  const buys = {}; gameShopList().filter(x => x.item === 'shield').forEach(x => { buys[x.d] = (buys[x.d] || 0) + 1; });
  const streakDays = new Set([...Object.keys(studyDays || {}).filter(k => gameAnswers(k) > 0), ...Object.keys(gameDays || {}).filter(gameFrozen)]);
  const sorted = [...new Set([...streakDays, ...Object.keys(buys)])].sort();
  let held = 0, run = 0, earned = 0, bought = 0, prev = null;
  sorted.forEach(d => {
    if (buys[d]) { held = Math.min(GAME_SHIELD_MAX, held + buys[d]); bought += buys[d]; }
    if (!streakDays.has(d)) return;
    if (prev && streakShift(prev, 1) !== d) run = 0; // 途切れた
    const fz = gameDayObj(d).frz;
    if (fz && !(gameAnswers(d) > 0)) { if (Number(fz) === 1) held = Math.max(0, held - 1); }
    else { run++; if (run % 7 === 0) { earned++; held = Math.min(GAME_SHIELD_MAX, held + 1); } }
    prev = d;
  });
  return { held, earned, bought };
}
const GAME_SHIELD_MAX = 2;
// 途切れた連続記録（休んだ日が1〜2日・お守りが足りない）：記録の復活で戻せるか
function gameRepairInfo() {
  const today = gameToday(), yest = streakShift(today, -1);
  if (gameAnswers(yest) > 0 || gameFrozen(yest)) return null;
  let last = null;
  for (let i = 2; i <= 3; i++) { const d = streakShift(today, -i); if (gameAnswers(d) > 0 || gameFrozen(d)) { last = d; break; } }
  if (!last) return null;
  const missed = []; for (let d = streakShift(last, 1); d < today; d = streakShift(d, 1)) missed.push(d);
  // 戻したら何日連続になるか
  let n = 0, d = last; while (n < 5000 && (gameAnswers(d) > 0 || gameFrozen(d))) { if (gameAnswers(d) > 0) n++; d = streakShift(d, -1); }
  return { missed, streak: n, cost: GAME_REPAIR_COST * missed.length };
}
const GAME_REPAIR_COST = 300;

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
  missed.forEach(d => { gameDays[d] = Object.assign({}, gameDayObj(d), { frz: Math.max(1, Number(gameDayObj(d).frz) || 0) }); });
  try { saveData(); } catch (e) {}
  setTimeout(() => gameCelebrate('🛡️', `お守りが連続記録を守りました`, `${missed.length}日休んだ分を、お守り${missed.length}つで守りました。今日も1問解こう！`), 1200);
  return true;
}

// ---------------- ⭐ レベル・称号 ----------------
function gameStats() {
  let answers = 0, days = 0;
  Object.keys(studyDays || {}).forEach(k => { const n = gameAnswers(k); answers += n; if (n > 0) days++; });
  let correct = 0, missionDays = 0, missionDone = 0, maxCombo = 0, boost = 0;
  Object.keys(gameDays || {}).forEach(k => {
    correct += gameCorrect(k); maxCombo = Math.max(maxCombo, gameCombo(k)); boost += gameSum(k, 'b:');
  });
  // ミッション：記録のある日を全部見る（studyDays の日）
  Object.keys(studyDays || {}).forEach(k => { if (gameAnswers(k) <= 0) return; const ms = gameMissions(k), n = ms.filter(m => m.done).length; missionDone += n; if (n === ms.length) missionDays++; });
  const grad = typeof STATUS_TESTS !== 'undefined' && STATUS_TESTS.grad ? (db || []).filter(STATUS_TESTS.grad).length : 0;
  const s = getStreakInfo();
  const xp = answers + correct + days * 10 + grad * 5 + missionDone * 20 + missionDays * 30 + boost;
  return { answers, correct, days, grad, missionDone, missionDays, maxCombo, xp, boost, streak: s.cur, best: s.best };
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
  const titles = gameSpTitles(st).filter(t => t.got).map(t => t.id);
  const seen = gameSeen();
  const now = { lv, badges, day: today, missions: ms, shields: sh, titles };
  if (!seen) { gameSaveSeen(now); return; } // はじめては、今までの分を知らせない
  if (!announce) { gameSaveSeen(Object.assign(now, { missions: seen.day === today ? [...new Set([...(seen.missions || []), ...ms])] : ms })); return; }
  const msgs = [];
  const prevMs = seen.day === today ? (seen.missions || []) : [];
  const allMs = gameMissions(today);
  ms.filter(id => !prevMs.includes(id)).forEach(id => { const m = allMs.find(x => x.id === id); if (m) msgs.push(['🎯', 'ミッション達成！', `${m.icon} ${m.text}（+20 XP）`]); });
  if (ms.length === allMs.length && prevMs.length < allMs.length) msgs.push(['🎁', '今日のミッション コンプリート！', 'ボーナス +30 XP。明日も新しいミッションがあります']);
  if (lv > (seen.lv || 1)) msgs.push(['⭐', `レベルアップ！ Lv.${lv}`, gameTitle(lv) !== gameTitle(seen.lv || 1) ? `新しい称号「${gameTitle(lv)}」になりました！` : `称号：${gameTitle(lv)}`]);
  badges.filter(id => !(seen.badges || []).includes(id)).forEach(id => { const b = gameBadgeDefs().find(x => x.id === id); if (b) msgs.push(['🏅', 'バッジを手に入れた！', `${b.icon} ${b.name}`]); });
  if (seen.titles) titles.filter(id => !seen.titles.includes(id)).forEach(id => { const t = GAME_SP_TITLES.find(x => x.id === id); if (t) msgs.push(['🏷️', '特別な称号を手に入れた！', `${t.name}（実績の画面で、名前の横に付けられます）`]); });
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

// ---------------- 💰 コイン ----------------
// もらう：正解×1・ミッション1つ10（全部の日は＋20）・バッジ1つ30・レベルが1上がるごと20・週間リーグのごほうび
// 使う：ショップで交換した分（gameShop）。どちらも記録から数え直す（どの端末でも同じ）
function gameCoins(st) {
  st = st || gameStats();
  const badges = gameBadges(st).filter(b => b.got).length, lv = gameLevelOf(st.xp).lv;
  const list = gameShopList();
  const league = list.filter(x => x.item === 'league').reduce((a, x) => a + (Number(x.coins) || 0), 0);
  const spent = list.reduce((a, x) => a + (Number(x.cost) || 0), 0);
  const earned = st.correct + st.missionDone * 10 + st.missionDays * 20 + badges * 30 + (lv - 1) * 20 + league;
  return { earned, spent, have: Math.max(0, earned - spent) };
}

// ---------------- 🛒 ショップ ----------------
const GAME_SHIELD_COST = 150;
function gameOwned(item) { return gameShopList().some(x => x.item === item); }
function gameBuy(item, arg) {
  const c = gameCoins(), today = gameToday(), id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  let cost = 0, what = '';
  if (item === 'shield') {
    if (gameShieldInfo().held >= GAME_SHIELD_MAX) return alert(`お守りは${GAME_SHIELD_MAX}つまでしか持てません。`);
    cost = GAME_SHIELD_COST; what = '🛡️ お守り';
  } else if (item === 'repair') {
    const r = gameRepairInfo(); if (!r) return alert('今は、戻せる連続記録がありません。');
    cost = r.cost; what = `🔧 記録の復活（${r.streak}日連続に戻す）`;
  } else if (item === 'reroll') { // ★【0.04.56】🔄 ミッションの入れかえ券
    const m = gameMissions(today).find(x => x.id === arg); if (!m || m.done || m.rr) return;
    cost = GAME_REROLL_COST; what = `🔄 入れかえ券（「${m.text}」をやさしく）`;
  } else if (item === 'boost') { // ⚡ XP 2倍
    if (gameBoostLeft() > 0) return alert('もう XP 2倍の最中です。');
    cost = GAME_BOOST_COST; what = '⚡ XP 2倍（15分）';
  } else if (item.startsWith('theme_') || item.startsWith('ship_')) { // テーマ・船の飾り
    const it = gameItemDef(item); if (!it || gameOwned(item)) return;
    cost = it.cost; what = it.name;
  } else return;
  if (c.have < cost) return alert(`💰 コインが足りません（${what}：${cost}コイン・今 ${c.have}コイン）。\n正解・ミッション・バッジ・週間リーグでたまります。`);
  if (!confirm(`${what} を ${cost}コインで交換しますか？\n（今 ${c.have}コイン → ${c.have - cost}コイン）`)) return;
  if (!gameShop || typeof gameShop !== 'object') gameShop = {};
  gameShop[id] = Object.assign({ item, cost, d: today, at: Date.now() }, item === 'reroll' ? { slot: arg } : item === 'boost' ? { until: Date.now() + 15 * 60000 } : {});
  if (item.startsWith('theme_')) { gameShop.sel_theme = { item: 'sel', val: item.slice(6), at: Date.now() }; gameApplyTheme(); }
  if (item === 'repair') gameRepairInfo().missed.forEach(d => { gameDays[d] = Object.assign({}, gameDayObj(d), { frz: 2 }); });
  try { saveData(); } catch (e) {}
  gameCelebrate(item === 'repair' ? '🔧' : item === 'shield' ? '🛡️' : item === 'boost' ? '⚡' : item === 'reroll' ? '🔄' : '🎁', '交換しました！', item === 'repair' ? `連続記録が ${getStreakInfo().cur}日に戻りました。今日も1問解こう！` : what);
  try { renderStreakCard(); } catch (e) {}
  renderGameBar(); renderGamePanel(); renderShopPanel();
}
const GAME_REROLL_COST = 40, GAME_BOOST_COST = 100; // ★【0.04.65】半分に（前は 80・200）
// ⚡ XP 2倍の残り（ms）
function gameBoostLeft() { const u = Math.max(0, ...gameShopList().filter(x => x.item === 'boost').map(x => Number(x.until) || 0)); return Math.max(0, u - Date.now()); }
function gameSel(key) { const x = (gameShop || {})[key]; return x && !x.deleted && x.val ? x.val : ''; }
function gameSetSel(key, val) {
  if (!gameShop || typeof gameShop !== 'object') gameShop = {};
  gameShop[key] = { item: 'sel', val, at: Date.now() };
  try { saveData(); } catch (e) {}
  if (key === 'sel_theme') gameApplyTheme();
  if (typeof publishStatsSummary === 'function') publishStatsSummary(false);
  renderGameBar(); renderGamePanel(); renderShopPanel();
}

// ---------------- 🏷️ 称号（名前の横に出す） ----------------
// ★【0.04.58】特別な称号は、コインで交換するのではなく、条件を満たすと手に入る（prog：[今, 目標]）
const GAME_SP_TITLES = [
  { id: 't_owl', name: '🦉 夜ふかし学者', cond: '夜（22時〜朝4時）に解いた日 10日', prog: x => [x.nightDays, 10] },
  { id: 't_book', name: '📚 本の虫', cond: '1日に100問以上解いた日 10日', prog: x => [x.bigDays, 10] },
  { id: 't_hunter', name: '🏹 単語ハンター', cond: 'カードを 300枚 卒業', prog: x => [x.grad, 300] },
  { id: 't_rocket', name: '🚀 急成長中', cond: '1週間（月〜日）で 1500 XP', prog: x => [x.bestWeekXp, 1500] },
  { id: 't_captain', name: '⚓ すする船長', cond: '船の飾り（集めるもの）を全部そろえる', prog: x => [x.shipParts, x.shipAll] },
  { id: 't_master', name: '👑 すするマスター', cond: 'バッジを 30個', prog: x => [x.badgeN, 30] },
];
// 称号の条件に使う数（gameStats とは別に。夜の日・100問の日・いちばん多い週の XP・船の飾り・バッジの数）
function gameTitleStats(st) {
  st = st || gameStats();
  let nightDays = 0, bigDays = 0; const weeks = {};
  Object.keys(studyDays || {}).forEach(k => { if (gameAnswers(k) >= 100) bigDays++; const m = gameMonday(k); weeks[m] = (weeks[m] || 0) + gameDayXp(k); });
  Object.keys(gameDays || {}).forEach(k => { if (gameSum(k, 'n:') > 0) nightDays++; });
  const shipAll = GAME_SHIP_PARTS.length, shipParts = GAME_SHIP_PARTS.filter(p => p.ok(st)).length;
  return Object.assign({}, st, { nightDays, bigDays, bestWeekXp: Math.max(0, ...Object.values(weeks)), shipParts, shipAll, badgeN: gameBadges(st).filter(b => b.got).length });
}
function gameSpTitles(st) { const x = gameTitleStats(st); return GAME_SP_TITLES.map(t => { const [now, need] = t.prog(x); return Object.assign({}, t, { now, need, got: now >= need }); }); }
// 選べる称号：レベルの称号・手に入れたバッジ・交換した称号
function gameTitleChoices(st) {
  st = st || gameStats();
  const out = [{ val: '', name: gameTitle(gameLevelOf(st.xp).lv) + '（レベル）' }];
  gameBadges(st).filter(b => b.got).forEach(b => out.push({ val: 'b:' + b.id, name: `${b.icon} ${b.name}` }));
  gameSpTitles(st).filter(t => t.got).forEach(t => out.push({ val: t.id, name: t.name }));
  return out;
}
function gameMyTitle(st) {
  const v = gameSel('sel_title');
  if (v.startsWith('b:')) { const b = gameBadgeDefs().find(x => x.id === v.slice(2)); if (b && gameBadges(st).find(x => x.id === b.id && x.got)) return `${b.icon} ${b.name}`; }
  if (v.startsWith('t_')) { const t = gameSpTitles(st).find(x => x.id === v); if (t && t.got) return t.name; }
  return gameTitle(gameLevelOf((st || gameStats()).xp).lv);
}

// ---------------- 🎨 テーマの色 ----------------
const GAME_THEMES = [
  { id: 'sakura', bg: '#261621', name: '🌸 桜', p: '#ff6fa8', p2: '#e0508c', a: '#ff9ec7', cost: 300 },
  { id: 'ocean', bg: '#0b2030', name: '🌊 海', p: '#14b8d4', p2: '#0e98b0', a: '#3b82f6', cost: 300 },
  { id: 'forest', bg: '#112016', name: '🌲 森', p: '#22a55a', p2: '#1a8a49', a: '#84cc16', cost: 300 },
  { id: 'sunset', bg: '#24130c', name: '🌇 夕焼け', p: '#f97316', p2: '#dc5f0c', a: '#ef4444', cost: 500 },
  { id: 'night', bg: '#14102e', name: '🌌 夜空', p: '#8b5cf6', p2: '#7140e0', a: '#ec4899', cost: 500 },
  { id: 'gold', bg: '#1e190a', name: '🏆 金', p: '#d4a017', p2: '#b8890f', a: '#f59e0b', cost: 1000 },
];
function gameApplyTheme() {
  // ★【0.04.59】背景・カード・枠・文字の色までまとめて変える（index.html の body.theme-◯◯。明るい表示にも、それぞれの色がある）
  const id = gameSel('sel_theme'), t = GAME_THEMES.find(x => x.id === id && gameOwned('theme_' + x.id)), cl = document.body.classList;
  GAME_THEMES.forEach(x => cl.remove('theme-' + x.id));
  if (t) cl.add('theme-' + t.id);
  try { localStorage.setItem('susuru_anki_theme', t ? t.id : ''); } catch (e) {}
  const r = document.documentElement.style; r.removeProperty('--primary'); r.removeProperty('--primary2'); r.removeProperty('--accent'); // 前の版の付け方を消す
}
// 開いたときすぐに（データを読む前に）前のテーマにする（ちらつかないように）
try { const t0 = localStorage.getItem('susuru_anki_theme'); if (t0) document.body.classList.add('theme-' + t0); } catch (e) {}

// ---------------- ⛵ わたしの船（育てる） ----------------
const GAME_SHIP_PARTS = [
  { id: 'flag', icon: '🚩', name: '旗', cond: '最長 7日連続', ok: s => s.best >= 7 },
  { id: 'compass', icon: '🧭', name: '羅針盤', cond: '30日 学習', ok: s => s.days >= 30 },
  { id: 'scope', icon: '🔭', name: '望遠鏡', cond: '500問 正解', ok: s => s.correct >= 500 },
  { id: 'cargo', icon: '📦', name: '積み荷', cond: '卒業25枚ごとに1つ（6つまで）', ok: s => s.grad >= 25, n: s => Math.min(6, Math.floor(s.grad / 25)) },
  { id: 'gull', icon: '🕊️', name: 'カモメ', cond: 'ミッション全部の日 5日ごとに1羽（4羽まで）', ok: s => s.missionDays >= 5, n: s => Math.min(4, Math.floor(s.missionDays / 5)) },
  { id: 'light', icon: '🗼', name: '灯台', cond: '最長 30日連続', ok: s => s.best >= 30 },
  { id: 'island', icon: '🏝️', name: '島', cond: '100日 学習', ok: s => s.days >= 100 },
  { id: 'stars', icon: '✨', name: '星空', cond: 'レベル 20', ok: s => gameLevelOf(s.xp).lv >= 20 },
  { id: 'whale', icon: '🐋', name: 'クジラ', cond: '10000問 解く', ok: s => s.answers >= 10000 },
];
const GAME_SHIP_SHOP = [
  { id: 'ship_parrot', icon: '🦜', name: '🦜 オウム', cost: 400 }, { id: 'ship_dolphin', icon: '🐬', name: '🐬 イルカ', cost: 600 },
  { id: 'ship_rainbow', icon: '🌈', name: '🌈 虹', cost: 800 }, { id: 'ship_fireworks', icon: '🎆', name: '🎆 花火', cost: 1200 },
  { id: 'ship_dragon', icon: '🐉', name: '🐉 竜', cost: 2000 },
];
function gameShipOf(lv) { return lv >= 30 ? ['🚢', '大型船'] : lv >= 15 ? ['🛳️', '客船'] : lv >= 5 ? ['⛵', '帆船'] : ['🛶', '小舟']; }
function gameItemDef(item) { return [...GAME_THEMES.map(t => Object.assign({}, t, { id: 'theme_' + t.id })), ...GAME_SHIP_SHOP].find(x => x.id === item); }
function gameShipHTML(st) {
  const lv = gameLevelOf(st.xp).lv, [ship, shipName] = gameShipOf(lv), has = p => p.ok(st), own = id => gameOwned(id);
  const night = GAME_SHIP_PARTS.find(p => p.id === 'stars').ok(st);
  const pos = { flag: 'left:54%;top:16%', compass: 'left:8%;bottom:8%', scope: 'left:36%;top:22%', light: 'right:6%;top:24%', island: 'right:4%;bottom:20%', whale: 'left:6%;bottom:30%',
    ship_parrot: 'left:60%;top:30%', ship_dolphin: 'left:24%;bottom:12%', ship_rainbow: 'left:30%;top:4%', ship_fireworks: 'right:30%;top:6%', ship_dragon: 'left:20%;top:40%' };
  let deco = '';
  GAME_SHIP_PARTS.forEach(p => {
    if (!has(p) || p.id === 'stars') return;
    if (p.id === 'cargo') deco += `<span class="ship-deco" style="left:42%;bottom:36%">${'📦'.repeat(p.n(st))}</span>`;
    else if (p.id === 'gull') for (let i = 0; i < p.n(st); i++) deco += `<span class="ship-deco gull" style="left:${12 + i * 18}%;top:${8 + (i % 2) * 8}%">🕊️</span>`;
    else deco += `<span class="ship-deco" style="${pos[p.id]}">${p.icon}</span>`;
  });
  GAME_SHIP_SHOP.forEach(p => { if (own(p.id)) deco += `<span class="ship-deco" style="${pos[p.id]}">${p.icon}</span>`; });
  const got = GAME_SHIP_PARTS.filter(has).length + GAME_SHIP_SHOP.filter(p => own(p.id)).length, all = GAME_SHIP_PARTS.length + GAME_SHIP_SHOP.length;
  return `<div class="ship-scene${night ? ' night' : ''}">${night ? '<span class="ship-deco" style="left:70%;top:6%">🌙</span><span class="ship-deco star" style="left:15%;top:6%">⭐</span><span class="ship-deco star" style="left:85%;top:14%">✨</span>' : '<span class="ship-deco" style="right:8%;top:6%">☀️</span>'}
      ${deco}<div class="ship-sea"></div><span class="ship-main">${ship}</span></div>
    <div class="hint-small" style="margin-top:6px;">${shipName}（Lv.${lv}${lv < 30 ? `・${lv < 5 ? 5 : lv < 15 ? 15 : 30} で大きくなる` : ''}）・飾り ${got}/${all}</div>
    <div class="ship-parts">${GAME_SHIP_PARTS.map(p => `<div class="game-badge${has(p) ? ' got' : ''}"><div class="game-badge-i">${has(p) ? p.icon : '🔒'}</div><div class="game-badge-n">${p.name}</div><div class="game-badge-p">${p.cond}</div></div>`).join('')}</div>
    <div class="hint-small" style="margin-top:8px;">🦜 オウム・🐬 イルカ・🌈 虹・🎆 花火・🐉 竜の特別な飾りは <a href="#" onclick="event.preventDefault(); openPage('pgShop')">🛒 ショップ</a> で交換できます。</div>`;
}

// ---------------- 📖 図鑑（フォルダーごとのスタンプ） ----------------
// 10問以上あるフォルダー（直接入っているカード）の卒業の割合：50% 🥉・80% 🥈・100% 🥇
function gameStamps() {
  const by = {}; (db || []).forEach(q => { (by[q.category] = by[q.category] || []).push(q); });
  const isG = typeof STATUS_TESTS !== 'undefined' && STATUS_TESTS.grad ? STATUS_TESTS.grad : () => false;
  return Object.entries(by).filter(([, l]) => l.length >= 10).map(([c, l]) => { const g = l.filter(isG).length, r = g / l.length; return { cat: c, n: l.length, g, r, tier: r >= 1 ? 3 : r >= 0.8 ? 2 : r >= 0.5 ? 1 : 0 }; })
    .sort((a, b) => b.tier - a.tier || b.r - a.r || a.cat.localeCompare(b.cat));
}
function gameStampsHTML() {
  const list = gameStamps(), icon = ['📄', '🥉', '🥈', '🥇'];
  if (!list.length) return '<div class="hint-small">10問以上あるフォルダーで、カードを卒業させるとスタンプがもらえます。</div>';
  const cnt = t => list.filter(x => x.tier >= t).length;
  return `<div class="hint-small">フォルダーのカードの 50% を卒業で 🥉、80% で 🥈、ぜんぶで 🥇（10問以上のフォルダー）。🥇 ${cnt(3)}・🥈 ${cnt(2)}・🥉 ${cnt(1)} / ${list.length}</div>
    <div class="stamp-list">${list.slice(0, 60).map(x => `<div class="stamp-row${x.tier ? ' got' : ''}"><span class="stamp-i">${icon[x.tier]}</span><span class="stamp-n">${escapeHtml(x.cat)}</span><span class="stamp-bar"><i style="width:${Math.round(x.r * 100)}%"></i></span><b>${x.g}/${x.n}</b></div>`).join('')}</div>`;
}

// ---------------- 🏆 リーグの段位 ----------------
const GAME_TIERS = ['🥉 ブロンズ', '🥈 シルバー', '🥇 ゴールド', '💎 プラチナ', '👑 ダイヤ'];
// 週ごとの結果から：1位で昇格、3人以上で最下位なら降格
function gameTier() {
  let t = 0;
  gameShopList().filter(x => x.item === 'league').sort((a, b) => String(a.wk || a.id).localeCompare(String(b.wk || b.id))).forEach(x => {
    if (x.rank === 1) t = Math.min(GAME_TIERS.length - 1, t + 1);
    else if ((x.n || 0) >= 3 && x.rank === x.n) t = Math.max(0, t - 1);
  });
  return { tier: t, name: GAME_TIERS[t] };
}

// ---------------- 📣 応援スタンプ（フレンドのチャットに送る） ----------------
const GAME_CHEERS = ['🔥 がんばれ！', '👏 すごい！', '💪 負けないぞ！', '🎉 おめでとう！', '📚 一緒に勉強しよう', '🌙 おつかれさま'];
const GAME_CHEER_COST = 10;
function gameCheerMenu(uid, name) {
  if (typeof currentUser === 'undefined' || !currentUser) return;
  let ov = document.getElementById('gameCheerOverlay');
  if (!ov) { ov = document.createElement('div'); ov.id = 'gameCheerOverlay'; ov.className = 'ctx-overlay'; ov.style.zIndex = '1090'; ov.onclick = () => { ov.style.display = 'none'; }; document.body.appendChild(ov); }
  ov.innerHTML = `<div class="menu-card editor-card" onclick="event.stopPropagation()"><div class="cat-edit-title">📣 ${escapeHtml(name)} さんに応援スタンプ</div>
    <div class="hint-small">1つ ${GAME_CHEER_COST}コイン（今 ${gameCoins().have}コイン）。チャットに届きます。</div>
    <div class="cheer-grid">${GAME_CHEERS.map((c, i) => `<button class="chip" onclick="gameSendCheer(${jsArg(uid)}, ${i})">${escapeHtml(c)}</button>`).join('')}</div>
    <button class="btn btn-secondary" style="margin-top:10px;" onclick="document.getElementById('gameCheerOverlay').style.display='none'">閉じる</button></div>`;
  ov.style.display = 'flex';
}
async function gameSendCheer(uid, i) {
  const c = gameCoins(); if (c.have < GAME_CHEER_COST) return alert('💰 コインが足りません。');
  const text = `📣 応援スタンプ：${GAME_CHEERS[i]}`;
  try {
    await firestore.collection('susuru_anki_chats').doc(getChatId(currentUser.uid, uid)).collection('messages').add({ text, senderId: currentUser.uid, timestamp: firebase.firestore.FieldValue.serverTimestamp() });
    if (typeof chatNoteSent === 'function') chatNoteSent(uid, text); // ★【0.04.73】相手に通知
  } catch (e) { return alert('⚠️ 送れませんでした（' + (e.code || e.message || '') + '）'); }
  gameShop['p' + Date.now().toString(36)] = { item: 'cheer', cost: GAME_CHEER_COST, to: uid, d: gameToday(), at: Date.now() };
  try { saveData(); } catch (e) {}
  const ov = document.getElementById('gameCheerOverlay'); if (ov) ov.style.display = 'none';
  gameCelebrate('📣', '応援スタンプを送りました', GAME_CHEERS[i]);
  renderGameBar(); renderGamePanel(); renderShopPanel();
}

// ---------------- 🏆 週間リーグ（フレンドと、今週の XP で競う） ----------------
// 週は月曜から日曜。今週の XP ＝ その週の日の（解いた数＋正解＋学習した日10＋ミッション1つ20・全部30）
// 成績のまとめ（stats.js の statsSummary：wk 今週の月曜・wxp 今週・lwxp 先週）で、フレンドと比べる
// 週が変わったら、先週の順位でコインのごほうび（1位 150・2位 100・3位 60・ほか参加 20）。id は league_先週の月曜（どの端末でも1回だけ）
function gameMonday(d) { const x = new Date((d || gameToday()) + 'T12:00:00'); return streakShift(d || gameToday(), -((x.getDay() + 6) % 7)); }
function gameDayXp(d) {
  const a = gameAnswers(d); if (a <= 0 && !gameCorrect(d)) return 0;
  const ms = gameMissions(d), n = ms.filter(m => m.done).length;
  return a + gameCorrect(d) + (a > 0 ? 10 : 0) + n * 20 + (n === ms.length ? 30 : 0) + gameSum(d, 'b:');
}
function gameWeekXp(mon) { let x = 0; for (let i = 0; i < 7; i++) x += gameDayXp(streakShift(mon, i)); return x; }
function gameLeagueMine() { const mon = gameMonday(); return { wk: mon, wxp: gameWeekXp(mon), lwxp: gameWeekXp(streakShift(mon, -7)) }; }
const GAME_LEAGUE_PRIZE = [150, 100, 60];
let _gameLeague = null, _gameLeagueBusy = false;
async function gameLoadLeague(force) {
  if (_gameLeagueBusy || typeof currentUser === 'undefined' || !currentUser || typeof myFriendList !== 'function') return _gameLeague;
  if (!force && _gameLeague && Date.now() - _gameLeague.at < 120000) return _gameLeague;
  _gameLeagueBusy = true;
  try {
    const friends = await myFriendList();
    let docs = [];
    if (friends.length) docs = (await firestore.collection('susuru_anki_category_scores').where('mode', '==', 'summary').get()).docs.map(d => d.data()).filter(d => friends.includes(d.uid));
    const mon = gameMonday(), last = streakShift(mon, -7), mine = gameLeagueMine();
    const val = (s, week) => week === mon ? (s.wk === mon ? Number(s.wxp) || 0 : 0) : (s.wk === mon ? Number(s.lwxp) || 0 : s.wk === last ? Number(s.wxp) || 0 : 0);
    const rows = w => [{ name: 'あなた', me: true, xp: w === mon ? mine.wxp : mine.lwxp, ttl: gameMyTitle(), tier: gameTier().tier }, ...docs.map(s => ({ name: s.name || 'フレンド', uid: s.uid, xp: val(s, w), lv: s.lv, ttl: s.ttl || '', tier: Number(s.tier) || 0 }))].sort((a, b) => b.xp - a.xp || (a.me ? -1 : b.me ? 1 : 0));
    _gameLeague = { at: Date.now(), mon, now: rows(mon), last: rows(last), friends: friends.length };
    gameClaimLeague();
  } catch (e) { console.warn('リーグを読めませんでした', e); }
  _gameLeagueBusy = false;
  return _gameLeague;
}
// 先週のごほうびを受け取る（フレンドが1人以上いて、自分が先週 XP を取っていたら）
function gameClaimLeague() {
  const L = _gameLeague; if (!L || !L.friends) return;
  const last = streakShift(L.mon, -7), id = 'league_' + last;
  if ((gameShop || {})[id]) return;
  const rows = L.last.filter(r => r.xp > 0), i = rows.findIndex(r => r.me);
  if (i < 0 || rows.length < 2) return;
  const tier = gameTier().tier, coins = Math.round((i < GAME_LEAGUE_PRIZE.length ? GAME_LEAGUE_PRIZE[i] : 20) * (1 + 0.25 * tier));
  if (!gameShop || typeof gameShop !== 'object') gameShop = {};
  gameShop[id] = { item: 'league', coins, rank: i + 1, n: rows.length, wk: last, d: gameToday(), at: Date.now() };
  try { saveData(); } catch (e) {}
  setTimeout(() => gameCelebrate(i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '🏅', `先週の週間リーグ ${i + 1}位！`, `ごほうび 💰 ${coins}コイン`), 600);
  renderGameBar(); renderGamePanel(); renderShopPanel();
}

// ---------------- 表示 ----------------
function gameMsHTML(ms, buy) {
  return `<div class="game-ms">${ms.map(m => `<div class="game-m${m.done ? ' done' : ''}"><span>${m.done ? '✅' : m.icon}</span><span class="game-m-t">${m.text}${m.rr ? ' <small>🔄</small>' : ''}</span><b>${Math.min(m.now, m.goal)}/${m.goal}</b>${buy && !m.done && !m.rr ? `<button class="chip game-rr" title="入れかえ券（${GAME_REROLL_COST}コイン）：目標を半分に" onclick="event.stopPropagation(); gameBuy('reroll', '${m.id}')">🔄</button>` : ''}</div>`).join('')}</div>`;
}
// ホーム（連続記録の下）：レベル・称号・コイン・お守り・リーグ・今日のミッション
function renderGameBar() {
  const el = document.getElementById('gameBar'); if (!el || typeof db === 'undefined') return;
  try { gameApplyTheme(); } catch (e) {} // ほかの端末で選んだテーマも
  const st = gameStats(), L = gameLevelOf(st.xp), sh = gameShieldInfo().held, ms = gameMissions(gameToday()), bl = gameBoostLeft();
  const lg = _gameLeague && _gameLeague.friends ? (() => { const i = _gameLeague.now.findIndex(r => r.me); return `<div class="game-league-line">🏆 ${gameTier().name}リーグ ${i + 1}位 / ${_gameLeague.now.length}人（${_gameLeague.now[i].xp} XP）</div>`; })() : '';
  el.innerHTML = `<div class="game-row"><b class="game-lv">Lv.${L.lv}</b><span class="game-title">${escapeHtml(gameMyTitle(st))}</span>
      <span class="game-coin">💰 ${gameCoins(st).have.toLocaleString()}</span>
      <span class="game-shield" title="お守り">${sh ? '🛡️'.repeat(sh) : '<span style="opacity:.35">🛡️</span>'}</span></div>
    ${lg}${bl > 0 ? `<div class="game-boost">⚡ XP 2倍 あと${Math.ceil(bl / 60000)}分</div>` : ''}
    <div class="game-xp"><div class="game-xp-fill" style="width:${Math.min(100, Math.round(L.into / L.need * 100))}%"></div></div>
    <div class="game-xp-text">あと ${L.need - L.into} XP で Lv.${L.lv + 1}</div>
    ${gameMsHTML(ms, false)}`;
  const hg = document.getElementById('homeGoCoins'); if (hg) hg.textContent = `💰 ${gameCoins(st).have.toLocaleString()}コイン`;
  if (bl > 0) { clearTimeout(renderGameBar._t); renderGameBar._t = setTimeout(renderGameBar, Math.min(60000, bl + 500)); }
}
// 実績の画面：タブ（ごほうび・ショップ・船・図鑑・リーグ）
let _gameTab = 'top';
function gameSetTab(t) { _gameTab = t; renderGamePanel(); }
function renderGamePanel() {
  const el = document.getElementById('gamePanel'); if (!el || typeof db === 'undefined') return;
  const st = gameStats(), L = gameLevelOf(st.xp), c = gameCoins(st);
  if (_gameTab === 'shop') _gameTab = 'top';
  const tabs = [['top', '⭐ ごほうび'], ['ship', '⛵ 船'], ['book', '📖 図鑑'], ['league', '🏆 リーグ']];
  let body = '';
  if (_gameTab === 'top') {
    const sh = gameShieldInfo(), next = gameNextTitle(L.lv), fl = gameFlame(st.streak), bs = gameBadges(st), got = bs.filter(b => b.got).length;
    const groups = {}; bs.forEach(b => { const k = b.id.replace(/\d+$/, ''); (groups[k] = groups[k] || []).push(b); });
    const choices = gameTitleChoices(st), cur = gameSel('sel_title');
    body = `<div class="game-big"><div class="game-big-lv">Lv.${L.lv}</div><div><div class="game-big-title">${escapeHtml(gameMyTitle(st))}</div>
        <div class="hint-small">${st.xp.toLocaleString()} XP ・ あと ${L.need - L.into} XP で Lv.${L.lv + 1}${next ? `（Lv.${next.lv} で「${next.name}」）` : ''}</div></div></div>
      <div class="game-xp"><div class="game-xp-fill" style="width:${Math.min(100, Math.round(L.into / L.need * 100))}%"></div></div>
      <div class="hint-small" style="margin-top:6px;">XP：解いた数×1・正解×1・学習した日×10・卒業×5・ミッション1つ20（全部で＋30）</div>
      <div class="setting-box-title" style="margin-top:12px;">🏷️ 名前の横の称号</div>
      <select class="form-control" onchange="gameSetSel('sel_title', this.value)">${choices.map(x => `<option value="${escAttr(x.val)}" ${x.val === cur ? 'selected' : ''}>${escapeHtml(x.name)}</option>`).join('')}</select>
      <div class="hint-small">フレンドと比べる表・週間リーグで、名前の横に出ます。バッジや下の特別な称号を手に入れると、選べる称号が増えます。</div>
      <div class="setting-box-title" style="margin-top:12px;">🏷️ 特別な称号（条件を満たすと手に入る）</div>
      <div class="game-shop">${gameSpTitles(st).map(t => `<div class="game-shop-item${t.got ? ' sp-got' : ''}"><div class="game-shop-i">${t.got ? '🏷️' : '🔒'}</div><div style="flex:1; min-width:0;"><div class="game-shop-n">${t.name}</div><div class="hint-small">${t.cond}</div>${t.got ? '' : `<div class="stamp-bar" style="width:100%; margin-top:4px;"><i style="width:${Math.min(100, Math.round(t.now / t.need * 100))}%"></i></div>`}</div><b class="hint-small">${t.got ? (gameSel('sel_title') === t.id ? '✅ 付けています' : `<button class="chip" onclick="gameSetSel('sel_title', '${t.id}')">付ける</button>`) : `${Math.min(t.now, t.need).toLocaleString()}/${t.need.toLocaleString()}`}</b></div>`).join('')}</div>
      <div class="setting-box-title" style="margin-top:12px;">🎯 今日のミッション</div>
      ${gameMsHTML(gameMissions(gameToday()), true)}
      <div class="hint-small">毎日かわります。1つ +20 XP、3つ全部で +30 XP。🔄 で目標を半分にできます（入れかえ券 ${GAME_REROLL_COST}コイン）。</div>
      <div class="setting-box-title" style="margin-top:12px;">🛡️ お守り ${sh.held ? '🛡️'.repeat(sh.held) : '（0）'}</div>
      <div class="hint-small">7日続けるごとに1つもらえます（2つまで持てます。ショップでも交換できます）。1日休んでも、次の日にお守りが自動で連続記録を守ります。</div>
      <div class="setting-box-title" style="margin-top:12px;">🔥 炎の色：${fl.name}</div>
      <div class="hint-small">連続記録 30日で 💙 青い炎、100日で 💜 紫の炎、365日で 🌈 虹の炎になります。</div>
      <div class="setting-box-title" style="margin-top:12px;">🏅 バッジ（${got} / ${bs.length}）</div>
      ${Object.values(groups).map(list => `<div class="game-badges">${list.map(b => `<div class="game-badge${b.got ? ' got' : ''}" title="${escAttr(b.name)}"><div class="game-badge-i">${b.got ? b.icon : '🔒'}</div><div class="game-badge-n">${escapeHtml(b.name)}</div>${b.got ? '' : `<div class="game-badge-p">${Math.min(b.now, b.need).toLocaleString()}/${b.need.toLocaleString()}</div>`}</div>`).join('')}</div>`).join('')}`;
  } else if (_gameTab === 'ship') body = gameShipHTML(st);
  else if (_gameTab === 'book') body = gameStampsHTML();
  else body = `<div id="gameLeagueBox">${gameLeagueHTML()}</div>`;
  el.innerHTML = `<div class="game-coinline">💰 <b>${c.have.toLocaleString()}</b> コイン<span class="hint-small">（正解1・ミッション10・バッジ30・レベル20・リーグ）</span></div>
    <div class="game-tabs">${tabs.map(([k, n]) => `<button class="chip${_gameTab === k ? ' active' : ''}" onclick="gameSetTab('${k}')">${n}</button>`).join('')}<button class="chip" onclick="openPage('pgShop')">🛒 ショップへ</button></div>${body}`;
}
function gameLeagueHTML() {
  if (typeof currentUser === 'undefined' || !currentUser) return '<div class="hint-small">ログインしてフレンドを追加すると、毎週フレンドと XP を競えます。</div>';
  const L = _gameLeague;
  if (!L) { setTimeout(() => gameLoadLeague().then(() => { const b = document.getElementById('gameLeagueBox'); if (b) b.innerHTML = gameLeagueHTML(); renderGameBar(); }), 50); return '<div class="hint-small">読み込み中…</div>'; }
  if (!L.friends) return '<div class="hint-small">フレンドを追加すると、毎週フレンドと XP を競えます（「👥 フレンド」の画面から）。</div>';
  const T = gameTier(), sun = streakShift(L.mon, 6), left = Math.round((new Date(sun + 'T12:00:00') - new Date(gameToday() + 'T12:00:00')) / 86400000);
  const medal = ['🥇', '🥈', '🥉'], mult = 1 + 0.25 * T.tier;
  return `<div class="game-tier">${T.name} リーグ${T.tier < GAME_TIERS.length - 1 ? `<span class="hint-small">（1位で ${GAME_TIERS[T.tier + 1]} に昇格）</span>` : ''}</div>
    <div class="game-league">${L.now.map((r, i) => `<div class="game-lg-row${r.me ? ' me' : ''}"><span class="game-lg-r">${i < 3 && r.xp > 0 ? medal[i] : i + 1}</span><span class="game-lg-n">${escapeHtml(r.name)}${r.lv ? ` <small>Lv.${r.lv}</small>` : ''}${r.ttl ? `<br><small>${escapeHtml(r.ttl)}${r.tier ? '・' + GAME_TIERS[r.tier] : ''}</small>` : ''}</span><b>${r.xp.toLocaleString()} XP</b>${i < 3 ? `<span class="game-lg-p">💰${Math.round(GAME_LEAGUE_PRIZE[i] * mult)}</span>` : ''}${r.me ? '' : `<button class="chip" title="応援スタンプ（${GAME_CHEER_COST}コイン）" onclick="gameCheerMenu(${jsArg(r.uid)}, ${jsArg(r.name)})">📣</button>`}</div>`).join('')}</div>
    <div class="hint-small" style="margin-top:4px;">${left > 0 ? `日曜の夜まで、あと${left}日` : '今日（日曜）まで'}。週が変わると、順位でコインがもらえます（上の段位ほど多い。1人で解いた週は無し）。1位で昇格、3人以上で最下位だと降格します。📣 で応援スタンプを送れます。まだ新しい版にしていないフレンドは 0 XP に見えます。</div>`;
}
// ★【0.04.57】🛒 ショップのタブ（下のナビ）
function renderShopPanel() {
  const el = document.getElementById('shopPanel'); if (!el || typeof db === 'undefined') return;
  const st = gameStats(), c = gameCoins(st);
  el.innerHTML = `<div class="game-coinline">💰 <b>${c.have.toLocaleString()}</b> コイン</div>
    <div class="hint-small" style="margin-bottom:8px;">正解1問 1・ミッション1つ 10（全部の日は＋20）・バッジ1つ 30・レベル1つ 20・週間リーグでたまります。</div>${gameShopHTML(st)}`;
}
function gameShopRow(icon, name, desc, item, cost, btn) {
  const c = gameCoins();
  return `<div class="game-shop-item"><div class="game-shop-i">${icon}</div><div style="flex:1; min-width:0;"><div class="game-shop-n">${name}</div><div class="hint-small">${desc}</div></div>${btn != null ? btn : `<button class="chip${c.have >= cost ? ' active' : ''}" onclick="event.stopPropagation(); gameBuy('${item}')">💰${cost}</button>`}</div>`;
}
function gameShopHTML(st) {
  const sh = gameShieldInfo(), r = gameRepairInfo(), bl = gameBoostLeft(), selT = gameSel('sel_theme');
  let h = '<div class="setting-box-title">🛡️ 連続記録を守る</div><div class="game-shop">';
  h += gameShopRow('🛡️', `お守り（今 ${sh.held}/${GAME_SHIELD_MAX}）`, '1日休んでも、連続記録を自動で守ります', 'shield', GAME_SHIELD_COST, sh.held >= GAME_SHIELD_MAX ? '<span class="hint-small">いっぱい</span>' : null);
  h += r ? gameShopRow('🔧', `記録の復活（${r.streak}日連続に戻す）`, `${r.missed.length}日休んで途切れた連続記録を、元に戻します`, 'repair', r.cost)
    : gameShopRow('🔧', '記録の復活', `1〜2日休んで連続記録が途切れたときに、ここに出ます（休んだ日1日につき ${GAME_REPAIR_COST}コイン）`, 'repair', 0, '<span class="hint-small">—</span>');
  h += '</div><div class="setting-box-title" style="margin-top:10px;">⚡ 勉強の道具</div><div class="game-shop">';
  h += gameShopRow('⚡', 'XP 2倍（15分）', bl > 0 ? `使っています：あと${Math.ceil(bl / 60000)}分` : 'リーグで追い上げたいときに。15分のあいだ、解いた・正解の XP が2倍', 'boost', GAME_BOOST_COST, bl > 0 ? '<span class="hint-small">使用中</span>' : null);
  h += gameShopRow('🔄', 'ミッションの入れかえ券', `今日のミッションの目標を半分にします（ミッションの横の 🔄 から・${GAME_REROLL_COST}コイン）`, 'reroll', GAME_REROLL_COST, `<button class="chip" onclick="_gameTab = 'top'; openPage('pgStats')">ミッションへ</button>`);
  h += '</div><div class="setting-box-title" style="margin-top:10px;">🎨 アプリのテーマの色</div><div class="game-shop">';
  GAME_THEMES.forEach(t => { const own = gameOwned('theme_' + t.id), on = selT === t.id; h += gameShopRow(`<span class="theme-dot" style="background:linear-gradient(135deg, ${t.bg || t.p} 0 45%, ${t.p} 45% 75%, ${t.a} 75%)"></span>`, t.name, own ? (on ? '使っています' : '交換ずみ') : '背景・カード・文字・ボタンの色がまとめて変わります（明るい表示にも）', 'theme_' + t.id, t.cost, own ? (on ? `<button class="chip" onclick="gameSetSel('sel_theme', '')">もとに戻す</button>` : `<button class="chip" onclick="gameSetSel('sel_theme', '${t.id}')">使う</button>`) : null); });
  h += '</div><div class="setting-box-title" style="margin-top:10px;">⛵ 船の特別な飾り</div><div class="game-shop">';
  GAME_SHIP_SHOP.forEach(p => { const own = gameOwned(p.id); h += gameShopRow(p.icon, p.name, own ? '船に乗っています（実績 → ⛵ 船）' : '「わたしの船」のまわりに出ます', p.id, p.cost, own ? '<span class="hint-small">✅</span>' : null); });
  return h + '</div>';
}

// ★【0.04.55】炎の色はショップで交換しない（連続記録の長さだけ）：交換した分は取り消して、コインを返す
// ★【0.04.69】目標が NaN になっていた日のミッションに使った入れかえ券は、取り消してコインを返す
function gameRefundBrokenRerolls() {
  let n = 0;
  Object.entries(gameShop || {}).forEach(([id, v]) => {
    if (!v || v.deleted || v.item !== 'reroll' || !v.d) return;
    const h = gameSeed(v.d), broken = (v.slot === 'cor' && ((h >> 3) % 4) < 0) || (v.slot === 'combo' && ((h >> 6) % 4) < 0);
    if (broken) { gameShop[id] = { deleted: true, at: Date.now() }; n += Number(v.cost) || 0; }
  });
  if (n) { try { saveData(); } catch (e) {} setTimeout(() => gameCelebrate('💰', `${n}コインを返しました`, 'ミッションの目標がおかしかった（NaN）日に使った入れかえ券を取り消しました'), 3000); }
}
function gameRefundFlames() {
  let n = 0;
  Object.entries(gameShop || {}).forEach(([id, v]) => {
    if (v && !v.deleted && (String(v.item || '').startsWith('flame_') || String(v.item || '').startsWith('t_') || id === 'sel_flame')) { gameShop[id] = { deleted: true, at: Date.now() }; n += Number(v.cost) || 0; }
  });
  if (n || Object.keys(gameShop || {}).some(k => k === 'sel_flame' && !gameShop[k].deleted)) { try { saveData(); } catch (e) {} }
  if (n) setTimeout(() => gameCelebrate('💰', `${n}コインを返しました`, '炎の色・特別な称号はコインで交換しないようにしたので、交換した分を取り消しました（特別な称号は、条件を満たすと手に入ります）'), 2500);
}

// 起動・日付が変わったとき
function gameInit() {
  try { gameRefundFlames(); } catch (e) {}
  try { gameRefundBrokenRerolls(); } catch (e) {}
  try { gameApplyTheme(); } catch (e) {}
  try { gameUseShields(); } catch (e) {}
  try { gameCheck(false); } catch (e) {}
  renderGameBar();
  setTimeout(() => gameLoadLeague().then(renderGameBar).catch(() => {}), 4000); // 先週のごほうびを受け取る
}
window.addEventListener('load', () => dataLoaded.then(() => setTimeout(gameInit, 1500)));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(() => { try { gameUseShields(); } catch (e) {} renderGameBar(); }, 800); });
