// ----------------- ツリー機能 -----------------
function getTopLevelCategories() {
  const children = new Set();
  for (const parent in categoryTree) { (categoryTree[parent] || []).forEach(c => children.add(c)); }
  return sortCategoryNames(categories.filter(c => !children.has(c)));
}
// ================================================================
// ★【0.03.07】教科タグ
// ・フォルダーごとに教科を付けられる。付けていないフォルダーは、親フォルダーの教科を引き継ぐ
// ・フォルダー名が教科名そのもの（「化学」など）なら、その教科とみなす
// ================================================================
const SUBJECTS = [
  { name: '英語', color: '#4f7cff' }, { name: '国語', color: '#e0567a' }, { name: '古文', color: '#c2577e' }, { name: '漢文', color: '#a8566e' },
  { name: '数学', color: '#2bb3a3' }, { name: '物理', color: '#f5a623' }, { name: '化学', color: '#22c77a' }, { name: '生物', color: '#7bc043' },
  { name: '地学', color: '#9c8a5a' }, { name: '日本史', color: '#d9534f' }, { name: '世界史', color: '#c8743a' }, { name: '地理', color: '#3aa0c8' },
  { name: '公民', color: '#8a6fd1' }, { name: '情報', color: '#5b6b8c' }, { name: 'その他', color: '#7a8699' }
];
function subjectColor(name) {
  const s = SUBJECTS.find(x => x.name === name);
  if (s) return s.color;
  let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h}, 55%, 55%)`;
}
function getCategoryParentName(cat) { for (const p in categoryTree) { if ((categoryTree[p] || []).includes(cat)) return p; } return null; }
// フォルダー自身に付けた教科（無ければ null。'' は「なし」を明示）
function getOwnSubject(cat) {
  if (catSubjects && Object.prototype.hasOwnProperty.call(catSubjects, cat)) return catSubjects[cat];
  if (SUBJECTS.some(s => s.name === cat)) return cat;
  return null;
}
// 親をたどって決まる教科（無ければ ''）
function getCategorySubject(cat) {
  let cur = cat, g = 0;
  while (cur && g++ < 100) {
    const own = getOwnSubject(cur);
    if (own !== null) return own;
    cur = getCategoryParentName(cur);
  }
  return '';
}
function setCategorySubject(cat, subject) {
  if (subject === null || subject === undefined) delete catSubjects[cat];
  else catSubjects[cat] = subject;
  saveData(true);
}
// 使われている教科の一覧（並び順は SUBJECTS の順）
function usedSubjects() {
  const set = new Set(categories.map(getCategorySubject).filter(Boolean));
  const known = SUBJECTS.map(s => s.name).filter(n => set.has(n));
  return [...known, ...[...set].filter(n => !known.includes(n)).sort(naturalCompare)];
}
// そのフォルダー（またはサブフォルダー）にその教科が含まれるか
function categoryHasSubject(cat, subject) {
  return getAllSubcategories(cat).some(c => getCategorySubject(c) === subject);
}
function subjectChipHTML(subject, small) {
  if (!subject) return '';
  return `<span class="subj-chip${small ? ' small' : ''}" style="--subj:${subjectColor(subject)}">${escapeHtml(subject)}</span>`;
}
let treeSubjectFilter = (() => { try { return localStorage.getItem('susuru_anki_tree_subject') || ''; } catch (e) { return ''; } })();
function setTreeSubjectFilter(s) { treeSubjectFilter = s; try { localStorage.setItem('susuru_anki_tree_subject', s); } catch (e) {} renderTree(); }

// ★【0.03.03】サブフォルダーを番号順に返す（追加した順ではなく）
function getChildCategories(catName) { return sortCategoryNames(categoryTree[catName] || []); }
// フォルダーを「ツリーの表示順」に並べたときの位置（カードの並べ替え・番号順の出題に使う）
function getCategoryOrderIndex() {
  const idx = {}; let i = 0;
  getSortedCategoriesForMenu().forEach(c => { idx[c] = i++; });
  return idx;
}
function getAllSubcategories(catName, result = new Set()) {
  if (result.has(catName)) return [...result];
  result.add(catName);
  if (categoryTree[catName]) categoryTree[catName].forEach(c => getAllSubcategories(c, result));
  return [...result];
}

function getSortedCategoriesForMenu() {
  const result = [];
  const visited = new Set();
  
  function addCategoryAndChildren(catName) {
    if (visited.has(catName)) return;
    visited.add(catName);
    result.push(catName);
    getChildCategories(catName).forEach(child => addCategoryAndChildren(child));
  }
  
  getTopLevelCategories().forEach(topCat => addCategoryAndChildren(topCat));
  return result;
}

function renderTree() {
  const root = document.getElementById('treeRoot'); root.innerHTML = '';
  // 教科で絞り込むチップ
  const subs = usedSubjects();
  if (treeSubjectFilter && !subs.includes(treeSubjectFilter)) treeSubjectFilter = '';
  if (subs.length > 0) {
    const bar = document.createElement('div'); bar.className = 'subj-filter';
    bar.innerHTML = `<button type="button" class="chip${treeSubjectFilter ? '' : ' active'}" data-s="">すべて</button>` +
      subs.map(sb => `<button type="button" class="chip subj-filter-chip${treeSubjectFilter === sb ? ' active' : ''}" data-s="${escAttr(sb)}" style="--subj:${subjectColor(sb)}">${escapeHtml(sb)}</button>`).join('');
    bar.querySelectorAll('button').forEach(b => b.onclick = () => setTreeSubjectFilter(b.getAttribute('data-s')));
    root.appendChild(bar);
  }
  getTopLevelCategories().filter(cat => !treeSubjectFilter || categoryHasSubject(cat, treeSubjectFilter))
    .forEach(cat => root.appendChild(createTreeNode(cat, 0)));
}

function createTreeNode(catName, depth) {
  const container = document.createElement('div');
  if (depth > 0) { container.style.marginLeft = '16px'; container.style.marginTop = '6px'; }
  const card = document.createElement('div'); card.className = 'tree-group-card';
  if (depth > 0) { card.style.borderLeft = '3px solid var(--primary)'; card.style.borderRadius = '0 8px 8px 0'; }

  const header = document.createElement('div'); header.className = 'tree-group-header';
  if (depth > 0) { header.style.background = 'var(--bg4)'; header.style.padding = '10px 14px'; }

  const directCount = db.filter(q => q.category === catName).length;
  const children = getChildCategories(catName);
  const isExpanded = localStorage.getItem(`cat_exp_${catName}`) === 'true';
  if (isExpanded) card.classList.add('expanded');

  const titleArea = document.createElement('div'); titleArea.className = 'tree-group-title';
  // 教科タグ：自分で付けたもの（またはフォルダー名が教科名）は色付き、親から引き継いだものは表示しない
  const own = getOwnSubject(catName);
  const subjHTML = own ? subjectChipHTML(own, true) : '';
  titleArea.innerHTML = `<span>${depth===0?'📁':'📂'}</span> <span style="word-break:break-all;">${escapeHtml(catName)}</span>${subjHTML} <span class="tree-cat-count">${directCount}</span>`;
  titleArea.onclick = (e) => { e.stopPropagation(); currentViewContext = { type: 'category', value: catName }; openPage('pgBox'); };
  setupLongpress(titleArea, () => handleCategoryLongpress(catName));
  header.appendChild(titleArea);

  if (children.length > 0) {
    const arrow = document.createElement('div'); arrow.className = 'tree-group-arrow'; arrow.innerText = isExpanded ? '▼' : '▶';
    arrow.onclick = (e) => {
      e.stopPropagation();
      const nextState = !card.classList.contains('expanded');
      card.classList.toggle('expanded');
      arrow.innerText = nextState ? '▼' : '▶';
      localStorage.setItem(`cat_exp_${catName}`, nextState);
    };
    header.appendChild(arrow);
  }
  card.appendChild(header);

  if (children.length > 0) {
    const childContainer = document.createElement('div'); childContainer.className = 'tree-group-children';
    children.filter(c => !treeSubjectFilter || categoryHasSubject(c, treeSubjectFilter)).forEach(c => childContainer.appendChild(createTreeNode(c, depth + 1)));
    card.appendChild(childContainer);
  }
  container.appendChild(card); return container;
}

function addNewRootCategory() {
  const txt = document.getElementById('txtNewRoot').value.trim();
  if(!txt) return;
  if(categories.includes(txt)) return alert("既に使用されているフォルダー名です。");
  const bad = invalidCategoryName(txt); if (bad) return alert(bad);
  markCatCreated(txt);
  categories.push(txt); document.getElementById('txtNewRoot').value = '';
  saveData(true); renderTree();
}
