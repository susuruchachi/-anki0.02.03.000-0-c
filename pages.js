// ----------------- 画面遷移とメニュー制御 -----------------
function openMenu() {
  document.getElementById('sideMenu').classList.add('open');
  document.getElementById('menuOverlay').classList.add('open');
}

function closeMenu() {
  const sm = document.getElementById('sideMenu');
  const mo = document.getElementById('menuOverlay');
  if(sm) sm.classList.remove('open');
  if(mo) mo.classList.remove('open');
}

function openPage(pageId) { executePageTransition(pageId, false); }

// ★【0.03.00】ホーム画面上部の学習状況サマリー
function updateHomeSummary() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
  const isGrad = isGraduated;
  set('homeSumTotal', db.length);
  set('homeSumWeak', db.filter(q => !isGrad(q) && ((q.level === 0 && (q.correct + q.incorrect) > 0) || q.level === -1)).length);
  set('homeSumUnseen', db.filter(q => q.correct === 0 && q.incorrect === 0 && q.level >= 0).length);
  set('homeSumGrad', db.filter(isGrad).length);
}

async function fetchAndRenderTutorial() {
  const container = document.getElementById('tutorialContent');
  if (!container || container.getAttribute('data-loaded') === 'true') return; 
  try {
    const res = await fetch('RULES.md');
    if (!res.ok) throw new Error('Failed to load');
    const text = await res.text();
    if (typeof marked !== 'undefined') {
      container.innerHTML = marked.parse(text);
    } else {
      container.innerHTML = `<pre style="white-space:pre-wrap; font-family:inherit;">${escapeHtml(text)}</pre>`;
    }
    container.setAttribute('data-loaded', 'true');
  } catch (e) {
    container.innerHTML = '<p style="color:var(--danger); text-align:center;">ガイドの読み込みに失敗しました。</p>';
  }
}

function executePageTransition(pageId, isBackAction) {
  // ★【0.03.10】対戦中にほかの画面へ移っても対戦は続く（戻ると対戦画面に戻る）。接続切れの扱いは match.js
  stopQuizTimer(); clearTimeout(autoNextTimeout);
  const activeScreen = document.querySelector('.screen.active');
  const currentId = activeScreen ? activeScreen.id : 'pgHome';
  
  if (!isBackAction && currentId !== pageId) {
    pageHistory.push(currentId);
    history.pushState({ page: pageId }, '', '');
  }
  // ★【0.02.58-g】最終ページを保存（再読み込み後に復元するため）。クイズ中・対戦中は保存しない
  const dontSave = ['pgQuizPlayer', 'pgOnlineMatch', 'pgShared', 'pgQuizResult'];
  if (!dontSave.includes(pageId)) {
    try { localStorage.setItem('susuru_anki_last_page', pageId); } catch(e) {}
  }
  if (pageId !== 'pgFriends') closeChat();
  // ★【0.03.48】画面を出たら、その画面のリアルタイムの読み込みを止める（公開カテゴリーは全部のカードを含むので、
  //  見ていないあいだも更新のたびに読み直して重くなっていた）
  if (currentId !== pageId) {
    if (currentId === 'pgPublicCategories' && typeof stopPublicCategoriesWatch === 'function') stopPublicCategoriesWatch();
    if (currentId === 'pgShared' && pageId !== 'pgShared' && typeof stopSharedDocWatch === 'function') stopSharedDocWatch();
  }

  document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); s.style.display='none'; });
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  // ★【0.03.00】下部ナビの選択状態と、クイズ中の表示切り替え
  const navOwner = { pgUpdates: 'pgHome', pgTutorial: 'pgHome', pgPublicCategories: 'pgBox', pgShared: 'pgBox', pgMatchHistory: 'pgOnlineMatch', pgFriends: 'pgBackup', pgCompareStats: 'pgBackup', pgQuizResult: 'pgHome' };
  const navPage = navOwner[pageId] || pageId;
  document.querySelectorAll('.bnav-item').forEach(b => b.classList.toggle('active', b.dataset.page === navPage));
  const wasInQuiz = document.body.classList.contains('in-quiz');
  document.body.classList.toggle('in-quiz', pageId === 'pgQuizPlayer');
  // ★【0.03.09】クイズ中にまとめていた保存を、クイズを出たらすぐ送る
  if (wasInQuiz && pageId !== 'pgQuizPlayer' && typeof flushPendingSaves === 'function') flushPendingSaves();

  const tgt = document.getElementById(pageId);
  if(tgt) { tgt.style.display='flex'; tgt.classList.add('active'); }

  if(pageId==='pgHome') { const el = document.getElementById('navHome'); if(el) el.classList.add('active'); buildQuizScopeDropdown(); updateHomeSummary(); }
  if(pageId==='pgTree') { const el = document.getElementById('navTree'); if(el) el.classList.add('active'); renderTree(); }
  if(pageId==='pgBox') { const el = document.getElementById('navBox'); if(el) el.classList.add('active'); renderBox(); }
  if(pageId==='pgStats') { const el = document.getElementById('navStats'); if(el) el.classList.add('active'); renderStatsAndCharts(); }
  if(pageId==='pgOnlineMatch') { const el = document.getElementById('navOnlineMatch'); if(el) el.classList.add('active'); initOnlineMatchPage(); }
  if(pageId==='pgPublicCategories') { loadPublicCategories(); loadMyPublicCategories(); }
  if(pageId==='pgCompareStats') { loadFriendsForComparison(); }
  if(pageId==='pgBackup') { const el = document.getElementById('navBackup'); if(el) el.classList.add('active'); if (typeof renderMySharedDocsSettings === 'function') renderMySharedDocsSettings(); if (typeof renderSnapshotList === 'function') renderSnapshotList(); if (typeof renderNotifySettings === 'function') renderNotifySettings(); if (typeof renderAiSettings === 'function') renderAiSettings(); }
  if(pageId==='pgTutorial') { fetchAndRenderTutorial(); }
  if(pageId==='pgDrill' && typeof drillOnOpen === 'function') drillOnOpen(); // ★【0.03.27】暗記テストのタブ
  if((pageId==='pgDrill' || pageId==='pgHome') && typeof renderPlanViews === 'function') renderPlanViews(); // ★【0.03.27】週間プラン
  
  closeMenu();
}
