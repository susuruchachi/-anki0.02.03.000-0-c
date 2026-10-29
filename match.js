// ================================================================
// ⚔️ オンライン対戦
// ★【0.03.10】作り直し
//  ・回答は1問につき1回だけ（連打・Enterとボタンの二重送信で1問飛ばして、相手と交互に待たされる不具合の修正）
//  ・「相手を待つ／次の問題へ進む」は、毎回ルームの最新の状態から判断する（どちらかがゴールしても止まらない）
//  ・ルームの監視が途切れたら自動でつなぎ直す。待機中は数秒ごとに状態を読み直す
//  ・相手の接続が切れたら表示し、戻ってきたら「復帰しました」と知らせる。再読み込みしても復帰できる
//  ・同時に探し始めた2人がそれぞれ部屋を作ってしまっても、古い方の部屋にまとめる
//  ・招待リンクはログインが終わるのを待ってから参加する
//  ・親フォルダー（大きいカテゴリー）でも対戦できる
// ================================================================
const MATCH_COL = 'susuru_anki_matches';
const MATCH_LAST_KEY = 'susuru_anki_last_match';
const MATCH_HEARTBEAT_MS = 8000;   // 自分が接続していることを知らせる間隔
const MATCH_STALE_MS = 30000;      // 相手の知らせがこれだけ途絶えたら「接続が切れた」とみなす
const MATCH_ROOM_STALE_MS = 60000; // 待機ルームの作成者からの知らせがこれだけ無ければ、その部屋には入らない

let currentMatchId = null;
let matchUnsubscribe = null;
let matchQuestions = [];
let matchCurrentIdx = 0;
let matchScore = 0;
let matchTimer = null;
let matchTimeLeft = 0;
let matchQuizFormat = 'desc';
let matchGameStarted = false;
let matchTimeLimitVal = 15;
let matchIsPlayer1 = true;
let matchOppName = '相手';
let matchLastOppProgress = 0;
let matchState = 'idle';      // idle / room(相手待ち) / answering / feedback / waitingOpp / finished / result / ended
let matchAnswerLocked = false;
let matchMyRole = null;
let matchLastData = null;
let matchHeartbeatTimer = null;
let matchWatchdogTimer = null;
let matchRoomTimer = null;    // 待機ルームにいる間、ほかの待機ルームを探し直す
let matchOppSeenValue = null, matchOppSeenChangedAt = 0;
let matchOppAway = false;
let matchCharPool = null;
let matchResuming = false;        // 再読み込み・招待リンクから対戦に戻るところ
let matchOppRejoinedValue = null;

function matchDocRef(id) { return firestore.collection(MATCH_COL).doc(id || currentMatchId); }
function myMatchName() { return (currentUser && currentUser.displayName) || '名無し'; }
function rememberMatch() { try { localStorage.setItem(MATCH_LAST_KEY, JSON.stringify({ matchId: currentMatchId, myRole: matchMyRole })); } catch (e) {} }
function forgetMatch() { try { localStorage.removeItem(MATCH_LAST_KEY); } catch (e) {} }
function primaryOf(answer) { return (typeof getPrimaryAnswer === 'function') ? getPrimaryAnswer(answer) : String(answer).split(/[/|]/)[0].trim(); }

// ----------------------------------------------------------------
// ロビー（カテゴリー選択）
// ----------------------------------------------------------------
// 共有カードを含むフォルダーと、その親フォルダー（大きいカテゴリー）を選べるようにする
function onlineMatchScopeOptions() {
  const direct = {};
  db.forEach(q => { if (q.sharedDocId) direct[q.category] = (direct[q.category] || 0) + 1; });
  const total = {};
  Object.keys(direct).forEach(cat => {
    const path = typeof getCategoryPath === 'function' ? getCategoryPath(cat) : [cat];
    path.forEach(c => { total[c] = (total[c] || 0) + direct[cat]; });
  });
  const out = [];
  const walk = (cat, depth) => {
    if (!total[cat]) return;
    out.push({ cat, depth, count: total[cat] });
    (typeof getChildCategories === 'function' ? getChildCategories(cat) : []).forEach(c => walk(c, depth + 1));
  };
  const tops = typeof getTopLevelCategories === 'function' ? getTopLevelCategories() : Object.keys(total);
  tops.forEach(c => walk(c, 0));
  // 構造から外れているフォルダーも漏らさない
  Object.keys(total).forEach(c => { if (!out.some(o => o.cat === c)) out.push({ cat: c, depth: 0, count: total[c] }); });
  return out;
}

function initOnlineMatchPage() {
  // ★ 対戦中にほかの画面から戻ってきたときは、対戦画面をそのまま表示する
  if (currentMatchId && matchGameStarted && matchState !== 'result' && matchState !== 'ended') {
    showOnlineGameView();
    return;
  }
  const container = document.getElementById('onlineMatchScopeSelectors');
  if (container) {
    container.innerHTML = '';
    const opts = onlineMatchScopeOptions();
    if (opts.length === 0) {
      container.innerHTML = '<div style="color:var(--danger); font-size:0.85rem; padding:10px; background:var(--bg3); border-radius:8px; border:1px solid rgba(255,79,106,0.3);">⚠️ 共有カテゴリーがありません。オンライン対戦は共有カテゴリーのみ出題可能です。まずは公開カテゴリーを購読するか、共有URLから追加してください。<button class="btn btn-secondary" style="margin-top:8px;" onclick="openPage(\'pgPublicCategories\')">🌐 公開カテゴリーを探す</button></div>';
      selectedScopePath = [];
    } else {
      // ★【0.03.49】フォルダーのツリーから選ぶ（picker.js）。共有カテゴリーのフォルダーだけ
      const keep = selectedScopePath && selectedScopePath.length === 1 && opts.some(o => o.cat === selectedScopePath[0]) ? selectedScopePath[0] : '';
      if (!keep) selectedScopePath = [];
      const o = opts.find(x => x.cat === keep);
      container.innerHTML = folderPickButtonHTML(keep, '共有カテゴリーを選んでください', 'pickOnlineMatchScope()', o ? `${o.count}問` : '');
    }
  }
  const gameView = document.getElementById('onlineGameView');
  if (gameView) gameView.style.display = 'none';
  updateOnlineWaitingCount();
}

function pickOnlineMatchScope() {
  const opts = onlineMatchScopeOptions(), cnt = {}; opts.forEach(o => { cnt[o.cat] = o.count; });
  openFolderPicker({ title: '📋 対戦するカテゴリー', current: selectedScopePath[0] || '',
    hint: '対戦で出せるのは共有・公開カテゴリーの問題だけです（相手も同じ問題を持っているため）',
    selectable: c => !!cnt[c], visible: c => !!cnt[c], count: c => cnt[c] || 0,
    onPick: c => { if (!c) return; selectedScopePath = [c]; initOnlineMatchPage(); } });
}
async function updateOnlineWaitingCount() {
  const el = document.getElementById('onlineWaitingCountBadge');
  if (!el) return;
  if (!selectedScopePath || selectedScopePath.length === 0 || selectedScopePath[0] === 'all' || selectedScopePath[0] === '') {
    el.textContent = '⚪ 共有カテゴリーを選択すると待機人数が表示されます';
    el.style.color = 'var(--text3)';
    return;
  }
  const scope = selectedScopePath[0];
  try {
    const snap = await firestore.collection(MATCH_COL).where('status', '==', 'waiting').where('scope', '==', scope).get();
    const now = Date.now();
    const count = snap.docs.filter(d => { const x = d.data(); return x.isPrivate === false && (!x.player1Seen || now - x.player1Seen < MATCH_ROOM_STALE_MS); }).length;
    el.textContent = count > 0 ? `🟢 このカテゴリーで ${count}人 が待機中` : '⚪ 現在このカテゴリーで待機中の人はいません';
    el.style.color = count > 0 ? 'var(--success)' : 'var(--text3)';
  } catch (e) {
    console.warn('待機人数取得エラー:', e);
    el.textContent = '';
  }
}

function readOnlineMatchSettings() {
  if (!selectedScopePath || selectedScopePath.length === 0 || selectedScopePath[0] === 'all' || selectedScopePath[0] === '') {
    alert('⚠️ 対戦する共有カテゴリーを選択してください。');
    return null;
  }
  return {
    scope: selectedScopePath[0],
    qCount: parseInt(document.getElementById('onlineMatchQuestionCount').value) || 10,
    timeLimit: parseInt(document.getElementById('onlineMatchTimeLimit').value) || 15,
    quizFormat: document.getElementById('onlineMatchFormat').value || 'desc'
  };
}
function startOnlineMatching() {
  if (!currentUser) return alert('オンライン対戦にはログインが必要です。');
  const s = readOnlineMatchSettings(); if (!s) return;
  startOnlineMatch(s.scope, s.qCount, s.timeLimit, false, s.quizFormat);
}
function createQuickMatch() {
  if (!currentUser) return alert('招待リンク作成にはログインが必要です。');
  const s = readOnlineMatchSettings(); if (!s) return;
  startOnlineMatch(s.scope, s.qCount, s.timeLimit, true, s.quizFormat);
}

// 待機ルームに入る（同時に入ろうとした人がいても1人だけが入れるようにトランザクションで）
async function tryJoinMatchRoom(id) {
  const ref = matchDocRef(id);
  try {
    return await firestore.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const x = snap.data();
      if (x.status !== 'waiting' || x.player1 === currentUser.uid || (x.player2 && x.player2 !== currentUser.uid)) return false;
      tx.update(ref, { status: 'playing', player2: currentUser.uid, player2Name: myMatchName(), player2Seen: Date.now(), player2Disconnected: false, startedAt: Date.now() });
      return true;
    });
  } catch (e) { console.warn('ルーム参加エラー:', e); return false; }
}
// 条件の合う待機ルーム（古い順）
async function findWaitingRooms(scope, qCount, quizFormat, excludeId) {
  const snap = await firestore.collection(MATCH_COL).where('status', '==', 'waiting').where('scope', '==', scope).get();
  const now = Date.now();
  return snap.docs.map(d => ({ id: d.id, x: d.data() }))
    .filter(({ id, x }) => id !== excludeId && x.isPrivate === false && x.qCount === qCount && x.quizFormat === quizFormat &&
      x.player1 !== currentUser.uid && (!x.player1Seen || now - x.player1Seen < MATCH_ROOM_STALE_MS))
    .sort((a, b) => (a.x.createdAtMs || 0) - (b.x.createdAtMs || 0) || (a.id < b.id ? -1 : 1));
}

async function startOnlineMatch(scope, qCount, timeLimit, isPrivate, quizFormat = 'desc') {
  if (currentMatchId) { alert('⚠️ 対戦中のルームがあります。'); return; }
  showOnlineMatchOverlay('🔍 対戦相手を探しています...');
  try {
    if (!isPrivate) {
      const rooms = await findWaitingRooms(scope, qCount, quizFormat, null);
      for (const r of rooms) {
        if (await tryJoinMatchRoom(r.id)) { currentMatchId = r.id; listenToMatch(); return; }
      }
    }
    // 共有カードだけから出題する（親フォルダーを選んだ場合はサブフォルダーもすべて）
    const subCats = typeof getQuizSubcategories === 'function' ? getQuizSubcategories(scope) : [scope];
    const subSet = new Set(subCats);
    const pool = db.filter(q => subSet.has(q.category) && q.sharedDocId && q.kind !== 'intro');
    if (pool.length === 0) {
      removeOnlineMatchOverlay();
      return alert('⚠️ 出題できる問題カードがありません。先にカードを作成するか同期してください。');
    }
    pool.sort(() => Math.random() - 0.5);
    const selectedQuestions = pool.slice(0, qCount).map(q => {
      const o = { id: q.id, question: q.question, answer: q.answer };
      if (Array.isArray(q.choices) && q.choices.length) o.choices = q.choices;
      // ★【0.03.25】4択のダミーは、部屋を作った人がその問題と同じフォルダー（なければ1つ上のフォルダー）から選んで、2人で同じものを使う
      else if (typeof buildChoiceCandidates === 'function') o.dummies = buildChoiceCandidates(q, primaryOf(q.answer)).slice(0, 3);
      return o;
    });
    const matchData = {
      status: 'waiting',
      player1: currentUser.uid, player1Name: myMatchName(),
      player2: null, player2Name: null,
      scope, qCount, timeLimit, isPrivate, quizFormat,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdAtMs: Date.now(),
      questions: selectedQuestions,
      player1Score: 0, player2Score: 0,
      player1Finished: false, player2Finished: false,
      player1Progress: 0, player2Progress: 0,
      player1Seen: Date.now(), player2Seen: null,
      player1Disconnected: false, player2Disconnected: false
    };
    const ref = await firestore.collection(MATCH_COL).add(matchData);
    currentMatchId = ref.id;
    matchMyRole = 'player1';
    rememberMatch();
    if (isPrivate) {
      const inviteLink = `${window.location.origin}${window.location.pathname}?match_id=${currentMatchId}`;
      showOnlineMatchOverlay(`
        <span style="font-size:0.95rem; font-weight:bold; color:var(--warn);">📋 招待リンクが完成しました</span><br><br>
        <input type="text" value="${escapeHtml(inviteLink)}" id="inviteLinkInput" readonly style="width:100%; padding:8px; background:var(--bg3); color:var(--text); border:1px solid var(--border); border-radius:6px; text-align:center; font-size:0.8rem;"><br>
        <button class="btn" style="margin-top:10px; padding:6px 14px; font-size:0.8rem; width:auto;" onclick="copyInviteLink()">🔗 リンクをコピー</button><br><br>
        <span style="font-size:0.8rem; color:var(--text2);">相手が参加するまでこのままお待ちください...</span>
      `, true);
    } else {
      showOnlineMatchOverlay('🔍 対戦相手を待っています...<br><span style="font-size:0.8rem; color:var(--text2);">同じカテゴリー・問題数・形式で探している人と対戦します</span>');
    }
    matchState = 'room';
    listenToMatch();
    startRoomWatch({ scope, qCount, quizFormat, isPrivate });
  } catch (e) {
    console.error(e);
    removeOnlineMatchOverlay();
    currentMatchId = null;
    alert('対戦ルームの作成に失敗しました: ' + e.message);
  }
}

// 待機ルームにいる間：自分がいることを知らせつつ、同時に探し始めた人の古い部屋があればそちらに入る
function startRoomWatch(opt) {
  clearInterval(matchRoomTimer);
  const myId = currentMatchId;
  let busy = false;
  matchRoomTimer = setInterval(async () => {
    if (currentMatchId !== myId || matchState !== 'room') { clearInterval(matchRoomTimer); return; }
    if (busy) return; busy = true;
    try {
      matchDocRef(myId).update({ player1Seen: Date.now() }).catch(() => {});
      if (opt.isPrivate) return;
      const mine = matchLastData || {};
      const rooms = await findWaitingRooms(opt.scope, opt.qCount, opt.quizFormat, myId);
      const older = rooms.filter(r => (r.x.createdAtMs || 0) < (mine.createdAtMs || Date.now()) || ((r.x.createdAtMs || 0) === (mine.createdAtMs || 0) && r.id < myId));
      if (!older.length) return;
      // 自分の部屋をいったん閉じる（その間に誰かが入っていたら、そのまま自分の部屋で対戦する）
      const closed = await firestore.runTransaction(async tx => {
        const s = await tx.get(matchDocRef(myId));
        if (!s.exists || s.data().status !== 'waiting') return false;
        tx.update(matchDocRef(myId), { status: 'cancelled' });
        return true;
      }).catch(() => false);
      if (!closed || currentMatchId !== myId) return;
      for (const r of older) {
        if (await tryJoinMatchRoom(r.id)) {
          clearInterval(matchRoomTimer);
          if (matchUnsubscribe) { matchUnsubscribe(); matchUnsubscribe = null; }
          matchDocRef(myId).delete().catch(() => {});
          currentMatchId = r.id; matchMyRole = 'player2'; matchLastData = null;
          listenToMatch();
          return;
        }
      }
      // 入れなかったので自分の部屋を開け直す
      await matchDocRef(myId).update({ status: 'waiting', player1Seen: Date.now() }).catch(() => {});
    } catch (e) { console.warn(e); }
    finally { busy = false; }
  }, 3000);
}

window.copyInviteLink = function () {
  const input = document.getElementById('inviteLinkInput');
  if (!input) return;
  const text = input.value;
  const done = () => alert('✅ 招待リンクをコピーしました！友達に共有してください。');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => { input.select(); document.execCommand('copy'); done(); });
  else { input.select(); document.execCommand('copy'); done(); }
};

// ----------------------------------------------------------------
// ルームの監視
// ----------------------------------------------------------------
function listenToMatch() {
  if (matchUnsubscribe) { matchUnsubscribe(); matchUnsubscribe = null; }
  const id = currentMatchId;
  if (!id) return;
  matchUnsubscribe = matchDocRef(id).onSnapshot(doc => {
    if (currentMatchId !== id) return;
    handleMatchSnapshot(doc);
  }, err => {
    console.warn('対戦の監視エラー（つなぎ直します）:', err);
    matchUnsubscribe = null;
    setTimeout(() => { if (currentMatchId === id && !matchUnsubscribe) listenToMatch(); }, 2000);
  });
  startMatchTimers();
}

function startMatchTimers() {
  clearInterval(matchHeartbeatTimer); clearInterval(matchWatchdogTimer);
  // 自分が接続していることを知らせる
  matchHeartbeatTimer = setInterval(() => {
    if (!currentMatchId || !matchMyRole || matchState === 'room' || matchState === 'result' || matchState === 'ended') return;
    matchDocRef().update({ [`${matchMyRole}Seen`]: Date.now(), [`${matchMyRole}Disconnected`]: false }).catch(() => {});
  }, MATCH_HEARTBEAT_MS);
  // 監視が止まっていても進めるように、待っている間は状態を読み直す。相手の接続も確かめる
  matchWatchdogTimer = setInterval(() => {
    if (!currentMatchId) { clearInterval(matchWatchdogTimer); clearInterval(matchHeartbeatTimer); return; }
    if (matchState === 'result' || matchState === 'ended') return;
    if (!matchUnsubscribe) listenToMatch();
    if (matchState === 'waitingOpp' || matchState === 'finished' || matchState === 'room') {
      const id = currentMatchId;
      matchDocRef(id).get().then(doc => { if (currentMatchId === id) handleMatchSnapshot(doc); }).catch(() => {});
    }
    updateOppPresence();
  }, 4000);
}
function stopMatchTimers() {
  clearInterval(matchHeartbeatTimer); clearInterval(matchWatchdogTimer); clearInterval(matchRoomTimer); clearInterval(matchTimer);
  matchHeartbeatTimer = matchWatchdogTimer = matchRoomTimer = null;
}

function handleMatchSnapshot(doc) {
  if (!doc.exists) {
    if (currentMatchId && matchState !== 'result' && matchState !== 'ended') {
      endMatchLocally();
      alert('❌ ルームが解散されました。');
    }
    return;
  }
  const data = doc.data();
  matchLastData = data;
  if (!currentUser) return;
  const myRole = data.player1 === currentUser.uid ? 'player1' : (data.player2 === currentUser.uid ? 'player2' : null);
  if (!myRole) {
    if (data.status !== 'waiting' && data.status !== 'cancelled') { endMatchLocally(); alert('⚠️ この対戦はすでに満員か終了しています。'); }
    return;
  }
  matchMyRole = myRole; window.myMatchRole = myRole;
  const oppRole = myRole === 'player1' ? 'player2' : 'player1';
  rememberMatch();

  if (data.status === 'waiting' || data.status === 'cancelled') return; // 相手待ち

  if (data.status === 'ended' || data[`${oppRole}Left`]) {
    if (matchState !== 'result' && matchState !== 'ended') {
      const name = data[`${oppRole}Name`] || '相手';
      endMatchLocally();
      alert(`❌ ${name} が対戦をやめました。対戦を終了します。`);
    }
    return;
  }

  const qLen = (data.questions || []).length;
  const oppFinished = !!data[`${oppRole}Finished`];
  const myFinished = !!data[`${myRole}Finished`];
  matchLastOppProgress = oppFinished ? qLen : (data[`${oppRole}Progress`] || 0);
  // 相手の接続：相手の「知らせ」の値が変わった時刻を自分の時計で記録する（端末の時計のずれに左右されないように）
  const seen = data[`${oppRole}Seen`] || null;
  if (seen !== matchOppSeenValue) { matchOppSeenValue = seen; matchOppSeenChangedAt = Date.now(); }

  if (!matchGameStarted) {
    matchGameStarted = true;
    clearInterval(matchRoomTimer);
    matchIsPlayer1 = myRole === 'player1';
    matchOppName = data[`${oppRole}Name`] || '相手';
    matchQuestions = data.questions || [];
    matchCurrentIdx = Math.min(data[`${myRole}Progress`] || 0, qLen);
    matchScore = data[`${myRole}Score`] || 0;
    matchQuizFormat = data.quizFormat || 'choice';
    matchTimeLimitVal = data.timeLimit || 15;
    matchCharPool = null;
    matchOppSeenChangedAt = Date.now();
    // 再読み込みなどで戻ってきたことを相手に知らせる
    const upd = { [`${myRole}Seen`]: Date.now(), [`${myRole}Disconnected`]: false };
    if (matchResuming) upd[`${myRole}Rejoined`] = Date.now();
    matchResuming = false;
    matchOppRejoinedValue = data[`${oppRole}Rejoined`] || null;
    matchDocRef().update(upd).catch(() => {});
    if ((data[`${myRole}Progress`] || 0) > 0 || myFinished) showOnlineToast('🔁 対戦に復帰しました');
    removeOnlineMatchOverlay();
    showOnlineGameView();
    if (myFinished) { matchState = 'finished'; renderOnlineFinished(); }
    else goToCurrentQuestionOrWait();
  } else {
    // 相手が再読み込みなどから戻ってきた
    const rj = data[`${oppRole}Rejoined`] || null;
    if (rj && rj !== matchOppRejoinedValue) { matchOppRejoinedValue = rj; if (!matchOppAway) showOnlineToast(`🔁 ${matchOppName} が復帰しました`); }
    if (matchState === 'waitingOpp') goToCurrentQuestionOrWait();
  }

  updateOppPresence();

  if (data.player1Finished && data.player2Finished) {
    if (matchState !== 'result') showMatchResult(data);
  } else if (matchState === 'finished') {
    updateGameWaitingStatus(data);
  } else if (oppFinished) {
    showOppFinishedIndicator();
  }
}

// 相手の接続状態を表示する（切れたら知らせ、戻ったら「復帰しました」）
function updateOppPresence() {
  if (!matchGameStarted || !matchLastData || matchState === 'result' || matchState === 'ended') return;
  const oppRole = matchMyRole === 'player1' ? 'player2' : 'player1';
  const oppFinished = !!matchLastData[`${oppRole}Finished`];
  const away = !oppFinished && (matchLastData[`${oppRole}Disconnected`] === true || Date.now() - matchOppSeenChangedAt > MATCH_STALE_MS);
  let bar = document.getElementById('onlineOppAwayBar');
  if (away) {
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'onlineOppAwayBar';
      bar.style.cssText = 'position:fixed; top:60px; left:0; right:0; background:var(--warn); color:#111; text-align:center; font-size:0.82rem; padding:6px 8px; z-index:998;';
      document.body.appendChild(bar);
    }
    bar.innerHTML = `📡 ${escapeHtml(matchOppName)} の接続が切れています。戻ってくるのを待っています… <button class="btn btn-secondary" style="width:auto; padding:2px 10px; font-size:0.75rem; margin-left:6px;" onclick="abandonOnlineMatch()">対戦をやめる</button>`;
  } else if (bar) {
    bar.remove();
    if (matchOppAway) showOnlineToast(`🔁 ${matchOppName} が復帰しました`);
  }
  matchOppAway = away;
}

function showOnlineToast(text, color = 'var(--accent)') {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed; top:70px; left:50%; transform:translateX(-50%); background:${color}; color:#fff; padding:8px 16px; border-radius:10px; font-size:0.9rem; font-weight:bold; z-index:1000; text-align:center; max-width:320px;`;
  t.innerText = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// ----------------------------------------------------------------
// 進行
// ----------------------------------------------------------------
function showOnlineGameView() {
  const pg = document.getElementById('pgOnlineMatch');
  if (!pg) return;
  Array.from(pg.children).forEach(child => { if (child.id !== 'onlineGameView') child.style.display = 'none'; });
  let gameView = document.getElementById('onlineGameView');
  if (!gameView) {
    gameView = document.createElement('div');
    gameView.id = 'onlineGameView';
    gameView.style.cssText = 'width:100%; flex:1; display:flex; flex-direction:column; padding:16px;';
    pg.appendChild(gameView);
  }
  gameView.style.display = 'flex';
}

// 今の問題を出すか、相手がその前の問題を解き終わるのを待つ
function goToCurrentQuestionOrWait() {
  if (matchCurrentIdx >= matchQuestions.length) { finishOnlineGame(); return; }
  if (matchLastOppProgress >= matchCurrentIdx) {
    if (matchState !== 'answering') renderOnlineQuestion(matchTimeLimitVal);
  } else if (matchState !== 'waitingOpp') {
    showOnlineWaitingForOpp(matchCurrentIdx, matchOppName);
  } else {
    const el = document.getElementById('onlineOppQNo');
    if (el) el.innerText = Math.min(matchLastOppProgress + 1, matchQuestions.length);
  }
}

// 1問の回答を確定する（どの形式からもここを通る。1問につき1回だけ）
function onlineAnswered(isOk, correctText) {
  if (matchAnswerLocked || matchState !== 'answering') return;
  matchAnswerLocked = true;
  clearInterval(matchTimer);
  matchState = 'feedback';
  document.querySelectorAll('#onlineGameView button, #onlineGameView input').forEach(el => { el.disabled = true; });
  if (isOk) matchScore++;
  matchCurrentIdx++;
  // 進み具合と得点をすぐ保存する（再読み込みしても続きから・得点もそのまま）
  const idx = matchCurrentIdx;
  if (currentMatchId && matchMyRole) {
    matchDocRef().update({ [`${matchMyRole}Progress`]: idx, [`${matchMyRole}Score`]: matchScore, [`${matchMyRole}Seen`]: Date.now() })
      .catch(e => console.warn('進行の保存エラー:', e));
  }
  showOnlineFeedback(isOk, correctText, () => {
    if (matchState !== 'feedback' || matchCurrentIdx !== idx) return;
    matchState = 'next';
    goToCurrentQuestionOrWait();
  });
}

function showOnlineFeedback(isCorrect, correctAnswer, onNext) {
  const color = isCorrect ? 'var(--success)' : 'var(--danger)';
  const icon = isCorrect ? '⭕' : '❌';
  const feedbackDiv = document.createElement('div');
  feedbackDiv.style.cssText = `position:fixed; bottom:80px; left:50%; transform:translateX(-50%); background:${color}; color:#fff; padding:10px 20px; border-radius:10px; font-size:0.95rem; font-weight:bold; z-index:999; text-align:center; max-width:320px;`;
  feedbackDiv.innerHTML = `${icon} 正解: ${renderRichText(correctAnswer, { escape: true, kanbunRows: 6 })}`;
  document.body.appendChild(feedbackDiv);
  hydrateRich(feedbackDiv, { chemScale: 0.9 });
  setTimeout(() => { feedbackDiv.remove(); onNext(); }, 1100);
}

function showOnlineWaitingForOpp(waitingForIdx, oppName) {
  const gameView = document.getElementById('onlineGameView');
  if (!gameView) return;
  matchState = 'waitingOpp';
  clearInterval(matchTimer);
  gameView.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.8rem; color:var(--text2); margin-bottom:12px;">
      <span>⚔️ オンライン対戦中</span>
      <span>🎯 問題: ${waitingForIdx + 1} / ${matchQuestions.length}</span>
    </div>
    <div style="flex:1; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; padding:24px; gap:16px;">
      <div style="font-size:2rem;">⏳</div>
      <div style="font-size:1rem; font-weight:bold; color:var(--text);">次の問題を準備中...</div>
      <div style="font-size:0.9rem; color:var(--text2);">🔄 ${escapeHtml(oppName)} が回答中です（<span id="onlineOppQNo">${Math.min(matchLastOppProgress + 1, matchQuestions.length)}</span>問目）</div>
      <div style="background:var(--bg3); border:1px solid var(--border); border-radius:8px; padding:12px; width:100%; font-size:0.85rem; color:var(--text2); text-align:center;">
        両者が解答し終えたら次の問題へ進みます
      </div>
    </div>
  `;
}

function renderOnlineQuestion(timeLimit) {
  const gameView = document.getElementById('onlineGameView');
  if (!gameView) return;
  if (matchCurrentIdx >= matchQuestions.length) { finishOnlineGame(); return; }
  matchState = 'answering';
  matchAnswerLocked = false;

  const q = matchQuestions[matchCurrentIdx];
  const fmt = matchQuizFormat || 'choice';
  const headerHtml = `
    <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.8rem; color:var(--text2); margin-bottom:12px;">
      <span>⚔️ オンライン対戦中</span>
      <span>🎯 問題: ${matchCurrentIdx + 1} / ${matchQuestions.length}</span>
    </div>
    <div style="background:var(--bg3); border:1px solid var(--border); border-radius:8px; height:6px; width:100%; margin-bottom:20px; overflow:hidden;">
      <div id="onlineTimerBar" style="background:var(--accent); height:100%; width:100%; transition: width 1s linear;"></div>
    </div>
    <div style="flex:1; display:flex; flex-direction:column; justify-content:center; align-items:center; background:var(--bg2); border:1px solid var(--border); border-radius:12px; padding:24px; min-height:140px; margin-bottom:20px; text-align:center;">
      <div id="onlineQuestionText" style="font-size:1.15rem; font-weight:bold; word-break:break-all; white-space:pre-wrap;">${renderRichText(q.question, { escape: true, kanbunRows: 12 })}</div>
    </div>
  `;

  if (fmt === 'choice') {
    const correctPrimary = primaryOf(q.answer);
    let choices;
    if (Array.isArray(q.choices) && q.choices.length >= 2) {
      choices = [...q.choices];
      if (!choices.includes(correctPrimary)) choices.push(correctPrimary);
    } else {
      const dummys = Array.isArray(q.dummies) && q.dummies.length >= 3 ? q.dummies : buildChoiceCandidates(q, correctPrimary);
      choices = [correctPrimary];
      for (let i = 0; i < 3; i++) choices.push(dummys[i] || `ダミー候補 ${i + 1}`);
    }
    choices.sort(() => Math.random() - 0.5);
    gameView.innerHTML = headerHtml + `
      <div style="display:grid; grid-template-columns:1fr; gap:10px; margin-bottom:20px;">
        ${choices.map((c, i) => `<button class="btn btn-secondary online-choice-btn" style="justify-content:center; padding:12px; font-size:0.9rem; text-align:center; word-break:break-all;" id="onlineChoiceBtn_${i}">${renderRichText(c, { escape: true, kanbunRows: 8 })}</button>`).join('')}
      </div>
    `;
    hydrateRich(gameView, { chemScale: 1.1 });
    choices.forEach((c, i) => {
      const btn = document.getElementById('onlineChoiceBtn_' + i);
      if (btn) btn.onclick = () => submitOnlineAnswer(c, correctPrimary);
    });
  } else if (fmt === 'desc') {
    gameView.innerHTML = headerHtml + `
      <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:20px;">
        <input type="text" id="onlineDescInput" class="form-control" placeholder="答えを入力..." style="font-size:1rem;" autocomplete="off">
        <button class="btn btn-accent" style="width:100%;" onclick="submitOnlineDescAnswer()">✅ 送信</button>
      </div>
    `;
    const inp = document.getElementById('onlineDescInput');
    if (inp) {
      inp.focus();
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submitOnlineDescAnswer(); } });
    }
  } else if (fmt === 'minhaya') {
    gameView.innerHTML = headerHtml + `<div id="onlineMinhayaArea"></div>`;
    renderOnlineMinhaya(q, timeLimit);
  } else if (fmt === 'tap') {
    gameView.innerHTML = headerHtml + `
      <div style="margin-bottom:20px;">
        <div id="onlineTapInput" style="min-height:40px; background:var(--bg3); border:1px solid var(--border); border-radius:8px; padding:8px; text-align:center; font-size:1.1rem; font-weight:bold; margin-bottom:10px; letter-spacing:2px;"></div>
        <div id="onlineTapChoices" style="display:flex; flex-wrap:wrap; gap:8px; justify-content:center;"></div>
        <button class="btn btn-secondary" style="width:100%; margin-top:10px;" onclick="submitOnlineTapAnswer()">✅ 送信</button>
      </div>
    `;
    renderOnlineTap(q);
  } else if (fmt === 'self') {
    gameView.innerHTML = headerHtml + `
      <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:20px; align-items:center;">
        <div id="onlineSelfAnswerDisplay" style="display:none; background:var(--bg3); border:1px solid var(--border); border-radius:8px; padding:12px; width:100%; text-align:center; font-size:1rem; font-weight:bold; color:var(--success);"></div>
        <button class="btn btn-secondary" style="width:100%;" id="onlineSelfShowBtn" onclick="showOnlineSelfAnswer()">💡 答えを見る</button>
        <div id="onlineSelfJudge" style="display:none; width:100%; flex-direction:column; gap:8px;">
          <div style="text-align:center; font-size:0.85rem; color:var(--text2);">自己採点：</div>
          <div style="display:flex; gap:8px;">
            <button class="btn" style="flex:1; background:var(--success); color:#fff;" onclick="submitOnlineSelfAnswer(true)">⭕ 正解</button>
            <button class="btn" style="flex:1; background:var(--danger); color:#fff;" onclick="submitOnlineSelfAnswer(false)">❌ 不正解</button>
          </div>
        </div>
      </div>
    `;
  }
  if (fmt !== 'choice') hydrateRich(document.getElementById('onlineQuestionText'), { chemScale: 1.4 });

  clearInterval(matchTimer);
  if (fmt !== 'self') {
    const startedAt = Date.now();
    const bar = document.getElementById('onlineTimerBar');
    matchTimeLeft = timeLimit;
    matchTimer = setInterval(() => {
      // 画面を離れていても正しく時間が進むように、経過時間から計算する
      matchTimeLeft = Math.max(0, timeLimit - (Date.now() - startedAt) / 1000);
      if (bar) bar.style.width = `${(matchTimeLeft / timeLimit) * 100}%`;
      if (matchTimeLeft <= 0) {
        clearInterval(matchTimer);
        onlineAnswered(false, primaryOf(q.answer));
      }
    }, 250);
  }
}

window.submitOnlineDescAnswer = function () {
  if (matchAnswerLocked || matchState !== 'answering') return;
  const inp = document.getElementById('onlineDescInput');
  if (!inp) return;
  const val = inp.value.trim();
  const q = matchQuestions[matchCurrentIdx];
  const correct = primaryOf(q.answer);
  let isOk = false;
  if (typeof isAnswerCorrect === 'function') isOk = isAnswerCorrect(val, q.answer);
  else { const n = s => s.toLowerCase().replace(/[\s　]/g, ''); isOk = n(val) === n(correct); }
  onlineAnswered(isOk, correct);
};

let onlineMinhayaTarget = '';
let onlineMinhayaPos = 0;

// みんはや・文字タップのダミー文字（対戦の問題と手元のカードの答えから。毎回全カードを調べないように覚えておく）
function onlineCharPool() {
  if (matchCharPool) return matchCharPool;
  const texts = matchQuestions.map(q => primaryOf(q.answer));
  for (let i = 0; i < db.length && i < 400; i++) texts.push(primaryOf(db[i].answer));
  matchCharPool = [...new Set(texts.join('').split(''))].filter(c => c && !/[\s　]/.test(c));
  return matchCharPool;
}

function renderOnlineMinhaya(q, timeLimit) {
  onlineMinhayaTarget = primaryOf(q.answer);
  onlineMinhayaPos = 0;
  renderOnlineMinhayaDisplay(q, timeLimit);
}

function renderOnlineMinhayaDisplay(q, timeLimit) {
  const area = document.getElementById('onlineMinhayaArea');
  if (!area) return;
  const target = [...onlineMinhayaTarget];
  // 区切り（スペース・記号など）は自動で埋める
  const skip = /[\s　、。,.・（）()［］\[\]～〜~…\/／\-]/;
  while (onlineMinhayaPos < target.length && skip.test(target[onlineMinhayaPos])) onlineMinhayaPos++;
  const pos = onlineMinhayaPos;

  let slotsHtml = '<div style="display:flex; flex-wrap:wrap; gap:4px; justify-content:center; margin-bottom:12px;">';
  for (let i = 0; i < target.length; i++) {
    const filled = i < pos;
    const current = i === pos;
    const bg = filled ? 'var(--success)' : (current ? 'var(--accent)' : 'var(--bg3)');
    const txt = filled ? escapeHtml(target[i]) : (current ? '?' : '＿');
    slotsHtml += `<div style="width:36px; height:36px; display:flex; align-items:center; justify-content:center; background:${bg}; border:1px solid var(--border); border-radius:6px; font-weight:bold; font-size:1.1rem;">${txt}</div>`;
  }
  slotsHtml += '</div>';

  if (pos >= target.length) {
    area.innerHTML = slotsHtml;
    onlineAnswered(true, onlineMinhayaTarget);
    return;
  }

  const correctChar = target[pos];
  const allChars = onlineCharPool().filter(c => c !== correctChar);
  allChars.sort(() => Math.random() - 0.5);
  const charChoices = [correctChar];
  for (let i = 0; i < 3; i++) charChoices.push(allChars[i] || `？${i}`);
  charChoices.sort(() => Math.random() - 0.5);

  let btnsHtml = '<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10px;">';
  charChoices.forEach((ch, i) => {
    btnsHtml += `<button class="btn btn-secondary online-minhaya-btn" style="font-size:1.3rem; font-weight:bold; justify-content:center;" id="onlineMinhayaBtn_${i}">${escapeHtml(ch)}</button>`;
  });
  btnsHtml += '</div>';
  area.innerHTML = slotsHtml + btnsHtml;
  charChoices.forEach((ch, i) => {
    const btn = document.getElementById('onlineMinhayaBtn_' + i);
    if (btn) btn.onclick = () => submitOnlineMinhayaChar(ch, correctChar, timeLimit);
  });
}

window.submitOnlineMinhayaChar = function (chosen, correct, timeLimit) {
  if (matchAnswerLocked || matchState !== 'answering') return;
  if (chosen === correct) {
    onlineMinhayaPos++;
    renderOnlineMinhayaDisplay(matchQuestions[matchCurrentIdx], timeLimit);
  } else {
    onlineAnswered(false, onlineMinhayaTarget);
  }
};

let onlineTapTarget = [];
let onlineTapInput = [];

function renderOnlineTap(q) {
  const primary = primaryOf(q.answer);
  onlineTapTarget = [...primary];
  onlineTapInput = [];
  const choicesEl = document.getElementById('onlineTapChoices');
  if (!choicesEl) return;
  const targetSet = new Set(onlineTapTarget);
  const allChars = onlineCharPool().filter(c => !targetSet.has(c));
  allChars.sort(() => Math.random() - 0.5);
  const pool = [...onlineTapTarget];
  const extra = Math.min(4, allChars.length);
  for (let i = 0; i < extra; i++) pool.push(allChars[i]);
  pool.sort(() => Math.random() - 0.5);
  choicesEl.innerHTML = '';
  pool.forEach((ch, idx) => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.style.cssText = 'width:48px; height:48px; padding:0; font-size:1.3rem; justify-content:center;';
    btn.id = 'onlineTapBtn_' + idx;
    btn.innerText = ch;
    btn.onclick = () => onlineTapChar(ch, idx);
    choicesEl.appendChild(btn);
  });
  updateOnlineTapInput();
}

function onlineTapChar(ch, btnIdx) {
  if (matchState !== 'answering') return;
  onlineTapInput.push(ch);
  const btn = document.getElementById('onlineTapBtn_' + btnIdx);
  if (btn) btn.disabled = true;
  updateOnlineTapInput();
}

function updateOnlineTapInput() {
  const el = document.getElementById('onlineTapInput');
  if (el) el.innerText = onlineTapInput.join('');
}

window.submitOnlineTapAnswer = function () {
  if (matchAnswerLocked || matchState !== 'answering') return;
  const inputStr = onlineTapInput.join('');
  const q = matchQuestions[matchCurrentIdx];
  const primary = primaryOf(q.answer);
  onlineAnswered(inputStr === primary, primary);
};

window.showOnlineSelfAnswer = function () {
  const q = matchQuestions[matchCurrentIdx];
  const ansEl = document.getElementById('onlineSelfAnswerDisplay');
  const judgeEl = document.getElementById('onlineSelfJudge');
  const showBtn = document.getElementById('onlineSelfShowBtn');
  if (ansEl) { ansEl.style.display = 'block'; setRichContent(ansEl, 'A: ' + primaryOf(q.answer), { escape: true, chemScale: 1.3 }); }
  if (judgeEl) judgeEl.style.display = 'flex';
  if (showBtn) showBtn.style.display = 'none';
};

window.submitOnlineSelfAnswer = function (isCorrect) {
  if (matchAnswerLocked || matchState !== 'answering') return;
  onlineAnswered(!!isCorrect, primaryOf(matchQuestions[matchCurrentIdx].answer));
};

window.submitOnlineAnswer = function (chosen, correct) {
  if (matchAnswerLocked || matchState !== 'answering') return;
  onlineAnswered(chosen === correct, correct);
};

// ----------------------------------------------------------------
// ゴール・結果
// ----------------------------------------------------------------
function renderOnlineFinished() {
  const gameView = document.getElementById('onlineGameView');
  if (!gameView) return;
  gameView.innerHTML = `
    <div style="flex:1; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; padding:24px;">
      <div style="font-size:2rem; margin-bottom:12px;">🏁</div>
      <div style="font-size:1.2rem; font-weight:bold; margin-bottom:6px;">あなたの解答が完了しました！</div>
      <div style="font-size:1.1rem; color:var(--success); font-weight:bold; margin-bottom:20px;">スコア: ${matchScore} / ${matchQuestions.length}</div>
      <div id="matchWaitStatus" style="font-size:0.85rem; color:var(--text2);">🔄 対戦相手の完了を待っています...</div>
    </div>
  `;
  if (matchLastData) updateGameWaitingStatus(matchLastData);
}

async function finishOnlineGame() {
  clearInterval(matchTimer);
  if (matchState === 'finished' || matchState === 'result') return;
  matchState = 'finished';
  renderOnlineFinished();
  if (!currentMatchId || !matchMyRole) return;
  const role = matchMyRole;
  // ゴールした瞬間に、自分の進み具合を最後（問題数）にする
  const write = () => matchDocRef().update({
    [`${role}Score`]: matchScore, [`${role}Finished`]: true, [`${role}Progress`]: matchQuestions.length, [`${role}Seen`]: Date.now()
  });
  try { await write(); }
  catch (e) {
    console.error(e);
    setTimeout(() => { if (currentMatchId && matchState === 'finished') write().catch(() => {}); }, 3000);
  }
}

function updateGameWaitingStatus(data) {
  const oppRole = matchMyRole === 'player1' ? 'player2' : 'player1';
  const oppName = data[`${oppRole}Name`] || '相手';
  const oppFinished = !!data[`${oppRole}Finished`];
  const oppProgress = data[`${oppRole}Progress`] || 0;
  const statusDiv = document.getElementById('matchWaitStatus');
  if (statusDiv) {
    statusDiv.innerText = oppFinished ? `💡 ${oppName} は解き終わっています。結果集計中...`
      : `🔄 ${oppName} の解答を待っています...（${Math.min(oppProgress + 1, (data.questions || []).length)}問目）`;
  }
}

function showOppFinishedIndicator() {
  let ind = document.getElementById('onlineOppFinishedIndicator');
  if (!ind) {
    ind = document.createElement('div');
    ind.id = 'onlineOppFinishedIndicator';
    ind.style.cssText = 'position:fixed; top:60px; left:0; right:0; background:var(--accent); color:#fff; text-align:center; font-size:0.8rem; padding:4px 8px; z-index:997;';
    document.body.appendChild(ind);
  }
  ind.innerText = `✅ ${matchOppName} は解答済み！あなたも頑張って！`;
}

function clearMatchIndicators() {
  ['onlineOppFinishedIndicator', 'onlineOppAwayBar'].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); });
}

async function showMatchResult(data) {
  matchState = 'result';
  stopMatchTimers();
  if (matchUnsubscribe) { matchUnsubscribe(); matchUnsubscribe = null; }
  forgetMatch();
  clearMatchIndicators();
  showOnlineGameView();
  const gameView = document.getElementById('onlineGameView');
  if (!gameView) return;

  const isPlayer1 = data.player1 === currentUser.uid;
  const myScore = (isPlayer1 ? data.player1Score : data.player2Score) || 0;
  const oppScore = (isPlayer1 ? data.player2Score : data.player1Score) || 0;
  const oppName = isPlayer1 ? (data.player2Name || '相手') : (data.player1Name || '相手');

  let title = '引き分け 🤔'; let color = 'var(--warn)';
  if (myScore > oppScore) { title = 'あなたの勝ち！ 🎉'; color = 'var(--success)'; }
  else if (myScore < oppScore) { title = 'あなたの負け... 😢'; color = 'var(--danger)'; }

  const oppUid = isPlayer1 ? data.player2 : data.player1;
  saveMatchHistory({ oppUid, oppName, myScore, oppScore, total: (data.questions || matchQuestions).length, date: getTodayStr(), matchId: currentMatchId });

  let isFriendAlready = false;
  try {
    const myProf = await firestore.collection('susuru_anki_profiles').doc(currentUser.uid).get();
    isFriendAlready = (myProf.exists && (myProf.data().friends || []).includes(oppUid));
  } catch (e) {}

  const friendBtnHtml = (!isFriendAlready && oppUid) ? `<button class="btn btn-secondary" style="width:100%; max-width:180px; margin-top:8px;" onclick="sendFriendRequestFromMatch(${jsArg(oppUid)}, ${jsArg(oppName)})">👤 フレンド申請</button>` : '';

  gameView.innerHTML = `
    <div style="flex:1; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; padding:16px;">
      <div style="font-size:1.5rem; font-weight:bold; color:${color}; margin-bottom:20px;">${title}</div>
      <div style="background:var(--bg3); border:1px solid var(--border); border-radius:10px; padding:16px; width:100%; max-width:300px; margin-bottom:24px; display:flex; flex-direction:column; gap:10px;">
        <div style="display:flex; justify-content:space-between; font-size:0.95rem;">
          <span style="font-weight:bold; color:var(--accent);">あなた:</span><span>${myScore} 問正解</span>
        </div>
        <div style="border-top:1px solid var(--border); padding-top:10px; display:flex; justify-content:space-between; font-size:0.95rem;">
          <span style="color:var(--text2); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:140px;">${escapeHtml(oppName)}:</span><span>${oppScore} 問正解</span>
        </div>
      </div>
      ${friendBtnHtml}
      <button class="btn" style="width:100%; max-width:180px; margin-top:8px;" onclick="quitOnlineMatchUI()">ロビーに戻る</button>
    </div>
  `;
}

// この端末の対戦の状態を片付ける（ルーム自体は消さない）
function endMatchLocally() {
  matchState = 'ended';
  stopMatchTimers();
  if (matchUnsubscribe) { matchUnsubscribe(); matchUnsubscribe = null; }
  removeOnlineMatchOverlay();
  clearMatchIndicators();
  forgetMatch();
  currentMatchId = null;
  matchGameStarted = false;
  matchLastData = null;
  matchMyRole = null;
  matchLastOppProgress = 0;
  matchAnswerLocked = false;
  matchOppAway = false;
  const gameView = document.getElementById('onlineGameView');
  if (gameView) { gameView.style.display = 'none'; gameView.innerHTML = ''; }
  const pg = document.getElementById('pgOnlineMatch');
  if (pg) Array.from(pg.children).forEach(child => { if (child.id !== 'onlineGameView') child.style.display = ''; });
  matchState = 'idle';
  if (document.getElementById('pgOnlineMatch') && document.getElementById('pgOnlineMatch').classList.contains('active')) initOnlineMatchPage();
}

window.quitOnlineMatchUI = function () { endMatchLocally(); };

// 対戦を途中でやめる（相手には「やめました」と伝わる）
window.abandonOnlineMatch = async function () {
  if (!currentMatchId) return;
  if (!confirm('対戦をやめますか？')) return;
  const id = currentMatchId, role = matchMyRole;
  endMatchLocally();
  try { if (role) await matchDocRef(id).update({ [`${role}Left`]: true, status: 'ended' }); } catch (e) { console.warn(e); }
};

function showOnlineMatchOverlay(htmlContent, showCancel = true) {
  let overlay = document.getElementById('onlineMatchOverlayZone');
  if (!overlay) {
    overlay = document.createElement('div'); overlay.id = 'onlineMatchOverlayZone';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(8,12,20,0.95); z-index:9999; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:20px; color:var(--text); font-family:sans-serif;';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div style="background:var(--bg2); border:1px solid var(--border); border-radius:12px; padding:20px; width:100%; max-width:360px; text-align:center; box-shadow:0 8px 24px rgba(0,0,0,0.5);">
      <div style="margin-bottom:16px; font-size:1rem; line-height:1.5;">${htmlContent}</div>
      ${showCancel ? `<button class="btn btn-secondary" style="width:100%;" onclick="cancelOnlineMatch()">キャンセル</button>` : ''}
    </div>
  `;
}

function removeOnlineMatchOverlay() {
  const overlay = document.getElementById('onlineMatchOverlayZone');
  if (overlay) overlay.remove();
}

window.cancelOnlineMatch = async function () {
  const id = currentMatchId;
  const started = matchGameStarted;
  removeOnlineMatchOverlay();
  if (started) return; // 対戦が始まっていたら何もしない
  endMatchLocally();
  if (id) {
    try {
      await firestore.runTransaction(async tx => {
        const s = await tx.get(matchDocRef(id));
        if (!s.exists) return;
        const x = s.data();
        if (x.status === 'waiting' || x.status === 'cancelled') tx.delete(matchDocRef(id));
        // ちょうど相手が入ってきていたら、相手が待ち続けないように「やめた」と伝える
        else if (x.status === 'playing') {
          const role = x.player1 === currentUser.uid ? 'player1' : (x.player2 === currentUser.uid ? 'player2' : null);
          if (role) tx.update(matchDocRef(id), { [`${role}Left`]: true, status: 'ended' });
        }
      });
    } catch (e) { console.error(e); }
  }
};

// ----------------------------------------------------------------
// 招待リンク・再読み込みからの復帰（ログインが終わってから呼ぶ）
// ----------------------------------------------------------------
let _matchBootDone = false;
async function onMatchAuthReady() {
  if (_matchBootDone || !currentUser) return;
  _matchBootDone = true;
  const urlParams = new URLSearchParams(window.location.search);
  const inviteId = urlParams.get('match_id');
  if (inviteId) {
    // 再読み込みでもう一度参加しようとしないよう、URLから外す
    try { urlParams.delete('match_id'); const qs = urlParams.toString(); history.replaceState(history.state, '', window.location.pathname + (qs ? '?' + qs : '')); } catch (e) {}
    await joinMatchByInvite(inviteId);
    return;
  }
  await checkMatchRejoin();
}

async function joinMatchByInvite(matchId) {
  if (typeof openPage === 'function') openPage('pgOnlineMatch');
  showOnlineMatchOverlay('⚡ 対戦ルームへ接続中...', false);
  try {
    const doc = await matchDocRef(matchId).get();
    if (!doc.exists) { removeOnlineMatchOverlay(); return alert('⚠️ 対戦ルームが見つかりません。'); }
    const data = doc.data();
    if (data.player1 === currentUser.uid || data.player2 === currentUser.uid) {
      currentMatchId = doc.id; matchResuming = data.status === 'playing'; listenToMatch(); return;
    }
    if (await tryJoinMatchRoom(matchId)) { currentMatchId = matchId; matchMyRole = 'player2'; rememberMatch(); listenToMatch(); return; }
    removeOnlineMatchOverlay(); alert('⚠️ この対戦はすでに満員か終了しています。');
  } catch (e) { console.error(e); removeOnlineMatchOverlay(); alert('⚠️ 対戦ルームに接続できませんでした。'); }
}

async function checkMatchRejoin() {
  let last = null;
  try { last = JSON.parse(localStorage.getItem(MATCH_LAST_KEY) || 'null'); } catch (e) {}
  if (!last || !last.matchId) return;
  try {
    const doc = await matchDocRef(last.matchId).get();
    if (!doc.exists) { forgetMatch(); return; }
    const data = doc.data();
    const role = data.player1 === currentUser.uid ? 'player1' : (data.player2 === currentUser.uid ? 'player2' : null);
    if (!role) { forgetMatch(); return; }
    if (data.status === 'waiting') {
      // 相手待ちのまま閉じた部屋は片付ける
      matchDocRef(last.matchId).delete().catch(() => {});
      forgetMatch(); return;
    }
    if (data.status !== 'playing' || (data.player1Finished && data.player2Finished)) { forgetMatch(); return; }
    if (confirm('⚔️ 対戦の途中です。復帰しますか？\n（「キャンセル」で対戦をやめます）')) {
      currentMatchId = last.matchId; matchMyRole = role; matchResuming = true;
      if (typeof openPage === 'function') openPage('pgOnlineMatch');
      listenToMatch();
    } else {
      forgetMatch();
      matchDocRef(last.matchId).update({ [`${role}Left`]: true, status: 'ended' }).catch(() => {});
    }
  } catch (e) { console.warn(e); }
}

// 画面を閉じる・再読み込みするときは、相手に「接続が切れた」ことを伝える（戻ってきたら解除）
function notifyMatchDisconnect() {
  if (!currentMatchId || !matchMyRole || !matchGameStarted || matchState === 'result' || matchState === 'ended') return;
  rememberMatch();
  try { matchDocRef().update({ [`${matchMyRole}Disconnected`]: true }); } catch (e) {}
}
window.addEventListener('pagehide', notifyMatchDisconnect);
window.addEventListener('beforeunload', notifyMatchDisconnect);
document.addEventListener('visibilitychange', () => {
  if (!currentMatchId || !matchMyRole || !matchGameStarted || matchState === 'result' || matchState === 'ended') return;
  if (document.visibilityState === 'visible') {
    matchDocRef().update({ [`${matchMyRole}Disconnected`]: false, [`${matchMyRole}Seen`]: Date.now() }).catch(() => {});
    if (!matchUnsubscribe) listenToMatch();
    const id = currentMatchId;
    matchDocRef(id).get().then(doc => { if (currentMatchId === id) handleMatchSnapshot(doc); }).catch(() => {});
  }
});

// ----------------------------------------------------------------
// 対戦履歴・フレンド申請
// ----------------------------------------------------------------
const MATCH_HISTORY_KEY = 'susuru_anki_match_history';

function saveMatchHistory(entry) {
  try {
    const hist = getMatchHistory();
    hist.unshift(entry); // 新しい順
    if (hist.length > 50) hist.length = 50; // 最大50件
    localStorage.setItem(MATCH_HISTORY_KEY, JSON.stringify(hist));
  } catch(e) {}
}

function getMatchHistory() {
  try {
    const raw = localStorage.getItem(MATCH_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch(e) { return []; }
}

function renderMatchHistory() {
  const area = document.getElementById('matchHistoryArea');
  if (!area) return;
  const hist = getMatchHistory();
  if (hist.length === 0) {
    area.innerHTML = '<div style="text-align:center; color:var(--text3); padding:30px 0;">対戦履歴がありません</div>';
    return;
  }
  area.innerHTML = '';
  hist.forEach(entry => {
    const result = entry.myScore > entry.oppScore ? '勝ち 🎉' : entry.myScore < entry.oppScore ? '負け 😢' : '引き分け 🤔';
    const col = entry.myScore > entry.oppScore ? 'var(--success)' : entry.myScore < entry.oppScore ? 'var(--danger)' : 'var(--warn)';
    const div = document.createElement('div');
    div.style.cssText = 'background:var(--bg3); border:1px solid var(--border); border-radius:10px; padding:12px 14px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; gap:10px;';
    div.innerHTML = `
      <div style="flex:1; min-width:0;">
        <div style="font-size:0.85rem; font-weight:bold; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(entry.oppName || '不明')}</div>
        <div style="font-size:0.75rem; color:var(--text2); margin-top:2px;">${entry.date || ''}</div>
        <div style="font-size:0.8rem; color:var(--text2); margin-top:2px;">あなた ${entry.myScore} - ${entry.oppScore} 相手 / ${entry.total}問</div>
      </div>
      <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
        <div style="font-size:0.85rem; font-weight:bold; color:${col};">${result}</div>
        ${entry.oppUid ? `<button class="btn btn-secondary" style="font-size:0.75rem; padding:4px 10px; white-space:nowrap;" onclick="sendFriendRequestFromMatch(${jsArg(entry.oppUid)}, ${jsArg(entry.oppName || '')})">👤 フレンド申請</button>` : ''}
      </div>
    `;
    area.appendChild(div);
  });
}

async function sendFriendRequestFromMatch(uid, name) { return sendFriendRequest(uid, name); } // ★【0.03.25】承認制のフレンド申請（social.js）
