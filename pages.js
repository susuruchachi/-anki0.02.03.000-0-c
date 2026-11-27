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

// ★【0.03.49】設定画面の各カードを、見出しを押して開け閉めできるようにする（開いているかは端末に覚える）
function initCollapsibleSections(pageId) {
  const page = document.getElementById(pageId); if (!page) return;
  [...page.children].filter(c => c.classList.contains('card') && c.firstElementChild && c.firstElementChild.classList.contains('setting-box-title')).forEach((card, i) => {
    if (card.dataset.coll) return; card.dataset.coll = '1';
    const head = card.firstElementChild, body = document.createElement('div'); body.className = 'sec-body';
    while (head.nextSibling) body.appendChild(head.nextSibling);
    card.appendChild(body); card.classList.add('sec-card'); head.classList.add('sec-head');
    const key = 'susuru_anki_sec_' + pageId + '_' + head.textContent.trim().slice(0, 14);
    let open = null; try { open = localStorage.getItem(key); } catch (e) {}
    card.classList.toggle('open', open === null ? i === 0 : open === '1');
    head.onclick = () => { const o = !card.classList.contains('open'); card.classList.toggle('open', o); try { localStorage.setItem(key, o ? '1' : '0'); } catch (e) {} };
  });
}
// 使い方ガイド：見出し（##）ごとにたたむ＋検索
function organizeGuide(container) {
  const kids = [...container.childNodes];
  const wrap = document.createElement('div');
  let cur = null;
  kids.forEach(n => {
    if (n.nodeType === 1 && n.tagName === 'H2') {
      cur = document.createElement('details'); cur.className = 'guide-sec';
      const sm = document.createElement('summary'); sm.textContent = n.textContent; cur.appendChild(sm);
      wrap.appendChild(cur); return;
    }
    if (n.nodeType === 1 && n.tagName === 'HR') return;
    (cur || wrap).appendChild(n);
  });
  container.innerHTML = '';
  const search = document.createElement('input'); search.type = 'text'; search.className = 'form-control'; search.placeholder = '🔍 ガイドの中を探す（例：週間プラン、共有、CSV）'; search.style.marginBottom = '10px';
  container.appendChild(search);
  container.appendChild(wrap);
  const secs = [...wrap.querySelectorAll(':scope > details.guide-sec')];
  search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    secs.forEach(d => { const hit = !q || d.textContent.toLowerCase().includes(q); d.style.display = hit ? '' : 'none'; d.open = !!q && hit; });
  };
}

// ★【0.03.00】ホーム画面上部の学習状況サマリー
function updateHomeSummary() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
  const isGrad = isGraduated;
  set('homeSumTotal', db.length);
  set('homeSumWeak', db.filter(q => !isGrad(q) && ((q.level === 0 && (q.correct + q.incorrect) > 0) || q.level === -1)).length);
  set('homeSumUnseen', db.filter(q => q.correct === 0 && q.incorrect === 0 && q.level >= 0).length);
  set('homeSumGrad', db.filter(isGrad).length);
  if (typeof renderStreakCard === 'function') renderStreakCard();
  if (typeof renderGameBar === 'function') try { renderGameBar(); } catch (e) {} // ★【0.04.53】🏆 ごほうび
}

async function fetchAndRenderTutorial() {
  const container = document.getElementById('tutorialContent');
  if (!container || container.getAttribute('data-loaded') === 'true') return; 
  try {
    const res = await fetch('RULES.md');
    if (!res.ok) throw new Error('Failed to load');
    const text = await res.text();
    if (typeof marked !== 'undefined') {
      container.innerHTML = marked.parse(text.replace(/(バージョン\*\*\s*[:：]\s*)v[\d.]+/, '$1v' + (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '')));
      organizeGuide(container);
    } else {
      container.innerHTML = `<pre style="white-space:pre-wrap; font-family:inherit;">${escapeHtml(text)}</pre>`;
    }
    container.setAttribute('data-loaded', 'true');
  } catch (e) {
    container.innerHTML = '<p style="color:var(--danger); text-align:center;">ガイドの読み込みに失敗しました。</p>';
  }
}

function executePageTransition(pageId, isBackAction) {
  if (typeof maybeAutoUpdate === 'function') setTimeout(maybeAutoUpdate, 600); // ★【0.04.10】更新が来ていて、移った先が遊んでいない画面なら読み込み直す
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
    if (currentId === 'pgListen' && typeof listenPause === 'function') listenPause(); // 聞き流しは画面を出たら一時停止
  }

  document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); s.style.display='none'; });
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  // ★【0.03.00】下部ナビの選択状態と、クイズ中の表示切り替え
  const navOwner = { pgUpdates: 'pgHome', pgTutorial: 'pgHome', pgPublicCategories: 'pgBox', pgShared: 'pgBox', pgMatchHistory: 'pgOnlineMatch', pgFriends: 'pgBackup', pgCompareStats: 'pgBackup', pgQuizResult: 'pgQuiz', pgListen: 'pgQuiz', pgCalendar: 'pgHome', pgCards: 'pgDrill' }; // ★【0.04.57】クイズ・ショップのタブ
  const navPage = navOwner[pageId] || pageId;
  document.querySelectorAll('.bnav-item').forEach(b => b.classList.toggle('active', b.dataset.page === navPage));
  const wasInQuiz = document.body.classList.contains('in-quiz');
  document.body.classList.toggle('in-quiz', pageId === 'pgQuizPlayer');
  // ★【0.03.09】クイズ中にまとめていた保存を、クイズを出たらすぐ送る
  if (wasInQuiz && pageId !== 'pgQuizPlayer' && typeof flushPendingSaves === 'function') flushPendingSaves();

  const tgt = document.getElementById(pageId);
  if(tgt) { tgt.style.display='flex'; tgt.classList.add('active'); }

  if(pageId==='pgHome') { const el = document.getElementById('navHome'); if(el) el.classList.add('active'); buildQuizScopeDropdown(); updateHomeSummary(); }
  if(pageId==='pgQuiz') { const el = document.getElementById('navQuiz'); if(el) el.classList.add('active'); buildQuizScopeDropdown(); } // ★【0.04.57】
  if(pageId==='pgShop') { const el = document.getElementById('navShop'); if(el) el.classList.add('active'); if (typeof renderShopPanel === 'function') renderShopPanel(); }
  if(pageId==='pgTree') { const el = document.getElementById('navTree'); if(el) el.classList.add('active'); renderTree(); }
  if(pageId==='pgBox') { const el = document.getElementById('navBox'); if(el) el.classList.add('active'); renderBox(); }
  if(pageId==='pgStats') { const el = document.getElementById('navStats'); if(el) el.classList.add('active'); renderStatsAndCharts(); }
  if(pageId==='pgOnlineMatch') { const el = document.getElementById('navOnlineMatch'); if(el) el.classList.add('active'); initOnlineMatchPage(); }
  if(pageId==='pgListen' && typeof renderListenPage === 'function') renderListenPage();
  if(pageId==='pgCalendar' && typeof renderCalendar === 'function') renderCalendar(); // ★【0.04.20】
  if(pageId==='pgCards' && typeof fcOnOpen === 'function') fcOnOpen(); // ★【0.04.30】カードモード
  if(pageId==='pgHome' && typeof renderCalHome === 'function') renderCalHome();
  if(pageId==='pgFriends' && typeof renderGroupCard === 'function') renderGroupCard();
  if(pageId==='pgPublicCategories') { loadPublicCategories(); loadMyPublicCategories(); }
  if(pageId==='pgCompareStats') { if (typeof renderCompareCatBtn === 'function') renderCompareCatBtn(); loadFriendsForComparison(); }
  if(pageId==='pgBackup') { const el = document.getElementById('navBackup'); if(el) el.classList.add('active'); if (typeof renderMySharedDocsSettings === 'function') renderMySharedDocsSettings(); if (typeof renderSnapshotList === 'function') renderSnapshotList(); if (typeof renderNotifySettings === 'function') renderNotifySettings(); if (typeof renderAiSettings === 'function') renderAiSettings(); if (typeof renderTtsMixSetting === 'function') renderTtsMixSetting(); }
  if(pageId==='pgTutorial') { fetchAndRenderTutorial(); }
  if(pageId==='pgDrill' && typeof drillOnOpen === 'function') drillOnOpen(); // ★【0.03.27】暗記テストのタブ
  if((pageId==='pgDrill' || pageId==='pgHome') && typeof renderPlanViews === 'function') renderPlanViews(); // ★【0.03.27】週間プラン
  
  closeMenu();
}

// ================================================================
// ★【0.04.61】🔄 読み込み直す（右上の 🔄・画面を下に引っぱる・「押すと再読み込み」のお知らせ）
//  クラウドとの同期・共有カテゴリー・フレンドのリーグをやり直して、今の画面を描き直す。
//  何度やってもだめなときは、ページごと読み込み直すか聞く
// ================================================================
let _appReloading = false, _appReloadFails = 0;
async function appReload() {
  if (_appReloading) return;
  _appReloading = true;
  const btn = document.getElementById('btnAppReload'); if (btn) btn.classList.add('spin');
  if (typeof showAppToast === 'function') showAppToast('🔄 読み込み直しています…');
  let ok = true;
  try {
    if (typeof _syncing !== 'undefined') { _syncing = false; _syncFails = 0; } // 止まっている同期はやめて、やり直す
    if (typeof _subsSyncing !== 'undefined') _subsSyncing = 0;
    if (typeof currentUser !== 'undefined' && currentUser) {
      if (typeof cloudReady !== 'undefined') cloudReady = false;
      await syncToCloud(true);
      ok = typeof cloudReady !== 'undefined' ? !!cloudReady : true;
      if (typeof gameLoadLeague === 'function') gameLoadLeague(true).catch(() => {});
    } else if (typeof syncSubscriptions === 'function') await syncSubscriptions();
    // 今の画面を描き直す
    const act = document.querySelector('.screen.active');
    if (act) executePageTransition(act.id, true);
    if (typeof updateHomeSummary === 'function') updateHomeSummary();
  } catch (e) { ok = false; console.warn(e); }
  if (btn) btn.classList.remove('spin');
  _appReloading = false;
  if (ok) { _appReloadFails = 0; if (typeof showAppToast === 'function') showAppToast('✅ 読み込み直しました'); return; }
  _appReloadFails++;
  if (_appReloadFails >= 2 && confirm('⚠️ うまく読み込めませんでした。\nページごと読み込み直しますか？（この端末に保存したデータはそのままです）')) {
    const u = new URL(location.href); u.searchParams.set('r', Date.now().toString(36)); location.replace(u.toString());
  } else if (typeof showAppToast === 'function') showAppToast('⚠️ 読み込めませんでした。電波のよいところで、もう一度 🔄 を押してください');
}
// 画面のいちばん上で、下に引っぱって離すと読み込み直す
(function () {
  let y0 = null, dy = 0;
  const el = () => document.getElementById('pullRefresh');
  const screen = () => document.querySelector('.screen.active');
  document.addEventListener('touchstart', e => {
    const sc = screen();
    if (document.body.classList.contains('in-quiz') || !sc || sc.scrollTop > 0 || e.touches.length !== 1) { y0 = null; return; }
    if (e.target.closest && e.target.closest('.ctx-overlay, input, textarea, select, .ship-scene, canvas')) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (y0 === null) return;
    const sc = screen(); if (sc && sc.scrollTop > 0) { y0 = null; const p = el(); if (p) p.style.opacity = 0; return; }
    dy = e.touches[0].clientY - y0;
    const p = el(); if (!p) return;
    if (dy > 20) {
      const d = Math.min(dy, 120);
      p.style.opacity = Math.min(1, d / 70); p.style.transform = `translate(-50%, ${d - 80}px)`;
      p.classList.toggle('ready', dy > 90);
      document.getElementById('pullRefreshText').textContent = dy > 90 ? '↻ 離すと読み込み直す' : '↓ 引っぱって読み込み直す';
    }
  }, { passive: true });
  document.addEventListener('touchend', () => {
    const p = el();
    if (y0 !== null && dy > 90) appReload();
    y0 = null; dy = 0;
    if (p) { p.style.opacity = 0; p.style.transform = 'translate(-50%, -80px)'; p.classList.remove('ready'); }
  }, { passive: true });
})();
