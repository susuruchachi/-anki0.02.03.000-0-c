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
  const navOwner = { pgUpdates: 'pgHome', pgTutorial: 'pgHome', pgPublicCategories: 'pgBox', pgShared: 'pgBox', pgMatchHistory: 'pgOnlineMatch', pgFriends: 'pgBackup', pgCompareStats: 'pgBackup', pgQuizResult: 'pgHome', pgListen: 'pgHome' };
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
  if(pageId==='pgListen' && typeof renderListenPage === 'function') renderListenPage();
  if(pageId==='pgPublicCategories') { loadPublicCategories(); loadMyPublicCategories(); }
  if(pageId==='pgCompareStats') { if (typeof renderCompareCatBtn === 'function') renderCompareCatBtn(); loadFriendsForComparison(); }
  if(pageId==='pgBackup') { const el = document.getElementById('navBackup'); if(el) el.classList.add('active'); if (typeof renderMySharedDocsSettings === 'function') renderMySharedDocsSettings(); if (typeof renderSnapshotList === 'function') renderSnapshotList(); if (typeof renderNotifySettings === 'function') renderNotifySettings(); if (typeof renderAiSettings === 'function') renderAiSettings(); }
  if(pageId==='pgTutorial') { fetchAndRenderTutorial(); }
  if(pageId==='pgDrill' && typeof drillOnOpen === 'function') drillOnOpen(); // ★【0.03.27】暗記テストのタブ
  if((pageId==='pgDrill' || pageId==='pgHome') && typeof renderPlanViews === 'function') renderPlanViews(); // ★【0.03.27】週間プラン
  
  closeMenu();
}
