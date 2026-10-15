// ----------------- ツリー機能 -----------------
function getTopLevelCategories() {
  const children = new Set();
  for (const parent in categoryTree) { (categoryTree[parent] || []).forEach(c => children.add(c)); }
  return categories.filter(c => !children.has(c));
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
    const children = categoryTree[catName] || [];
    children.forEach(child => addCategoryAndChildren(child));
  }
  
  getTopLevelCategories().forEach(topCat => addCategoryAndChildren(topCat));
  return result;
}

function renderTree() {
  const root = document.getElementById('treeRoot'); root.innerHTML = '';
  getTopLevelCategories().forEach(cat => root.appendChild(createTreeNode(cat, 0)));
}

function createTreeNode(catName, depth) {
  const container = document.createElement('div');
  if (depth > 0) { container.style.marginLeft = '16px'; container.style.marginTop = '6px'; }
  const card = document.createElement('div'); card.className = 'tree-group-card';
  if (depth > 0) { card.style.borderLeft = '3px solid var(--primary)'; card.style.borderRadius = '0 8px 8px 0'; }

  const header = document.createElement('div'); header.className = 'tree-group-header';
  if (depth > 0) { header.style.background = 'var(--bg4)'; header.style.padding = '10px 14px'; }

  const directCount = db.filter(q => q.category === catName).length;
  const children = categoryTree[catName] || [];
  const isExpanded = localStorage.getItem(`cat_exp_${catName}`) === 'true';
  if (isExpanded) card.classList.add('expanded');

  const titleArea = document.createElement('div'); titleArea.className = 'tree-group-title';
  titleArea.innerHTML = `<span>${depth===0?'📁':'📂'}</span> <span style="word-break:break-all;">${escapeHtml(catName)}</span> <span class="tree-cat-count">${directCount}</span>`;
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
    children.forEach(c => childContainer.appendChild(createTreeNode(c, depth + 1)));
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
