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
const STATUS_TESTS = {
  grad: q => isGraduated(q),
  master: q => !isGraduated(q) && q.level >= 3,
  normal: q => !isGraduated(q) && q.level >= 1 && q.level <= 2,
  weak: q => !isGraduated(q) && q.level === 0 && (q.correct + q.incorrect) > 0,
  shikkari: q => !isGraduated(q) && q.level === -1,
  unseen: q => q.correct === 0 && q.incorrect === 0 && q.level >= 0
};
const STATUS_NAMES = { grad: '🎓 卒業', master: '⚡ 得意', normal: '☕ 普通', weak: '⚠️ 苦手', shikkari: '🧱 しっかり', unseen: '💤 未着手' };
function renderStatsAndCharts() {
  const sel = document.getElementById('selStatsCategory');
  if (statsCategory && !categories.includes(statsCategory)) statsCategory = '';
  if (sel) {
    sel.innerHTML = '<option value="">📚 すべてのフォルダー</option>' + buildCategoryOptionsHTML(new Set(), false);
    sel.value = statsCategory;
  }
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

  const hc = document.getElementById('heatmapContainer'); hc.innerHTML='';
  for(let i=0; i<30; i++) {
    const c = document.createElement('div'); c.className='heatmap-cell';
    const lvl = i===29 ? (todayCorrectCount>10?4:todayCorrectCount>5?3:todayCorrectCount>0?2:0) : Math.floor(Math.random()*2);
    c.setAttribute('data-level', lvl); hc.appendChild(c);
  }
}

