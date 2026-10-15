// ★ すするanki 初期化処理

window.onload = function() {
  loadData(); ensureSystemSanity(); autoMerge();
  if (typeof loadQuizPrefs === 'function') loadQuizPrefs(); // ★【0.03.03】詳細設定を復元
  buildQuizScopeDropdown(); 
  if (typeof updateHomeSummary === 'function') updateHomeSummary(); // ★【0.03.00】
  if (typeof showReleaseBannerIfNew === 'function') showReleaseBannerIfNew(); // ★【0.03.00】未読のお知らせバナー
  if(localStorage.getItem('theme_light')==='true') toggleLightMode(true);
  
  // 成績共有設定をUIに反映
  const chkShareStats = document.getElementById('chkShareStats');
  if(chkShareStats) chkShareStats.checked = shareStats;
  
  // ★ 管理者UI表示の初期化
  if (typeof updateAdminUIVisibility === 'function') updateAdminUIVisibility();
  
  history.pushState({ page: 'pgHome' }, '', '');
  window.onpopstate = function(event) {
    if (pageHistory.length > 0) executePageTransition(pageHistory.pop(), true);
    else executePageTransition('pgHome', true);
  };

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('share_id')) { openPage('pgShared'); listenToSharedDoc(urlParams.get('share_id')); }
  else {
    // 再読み込み時に前のページに復帰
    try {
      const lastPage = localStorage.getItem('susuru_anki_last_page');
      if (lastPage && lastPage !== 'pgHome') openPage(lastPage);
    } catch(e) {}
  }
  
  // 起動時に共有カテゴリーの変更を同期する
  if (typeof syncSubscriptions === 'function') syncSubscriptions();

  // ★【0.03.10】対戦の復帰・招待リンクはログイン後に match.js の onMatchAuthReady() で確かめる
};
