// ----------------- コンテキストメニュー & 長押し -----------------
function setupLongpress(element, actionCallback) {
  let pressTimer = null; 
  let startX = 0, startY = 0;
  let isDragging = false;
  
  const startHandler = (e) => {
    if (e.type === 'contextmenu') { e.preventDefault(); return; }
    if (e.touches && e.touches.length > 1) return;
    
    let clientX = e.touches ? e.touches[0].clientX : e.clientX;
    let clientY = e.touches ? e.touches[0].clientY : e.clientY;
    startX = clientX; startY = clientY;
    isDragging = false;
    
    pressTimer = setTimeout(() => {
      if (!isDragging) { 
        if (navigator.vibrate) navigator.vibrate(50); 
        actionCallback(); 
      }
    }, 500);
  };
  
  const moveHandler = (e) => { 
    if(!pressTimer) return;
    let clientX = e.touches ? e.touches[0].clientX : e.clientX;
    let clientY = e.touches ? e.touches[0].clientY : e.clientY;
    if(Math.abs(clientX - startX) > 10 || Math.abs(clientY - startY) > 10) {
      isDragging = true; 
      clearTimeout(pressTimer); 
      pressTimer = null;
    }
  };
  
  const cancelHandler = () => { 
    if(pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
  };
  
  element.addEventListener('mousedown', startHandler); 
  element.addEventListener('touchstart', startHandler, { passive: true });
  element.addEventListener('mousemove', moveHandler); 
  element.addEventListener('touchmove', moveHandler, { passive: true });
  element.addEventListener('mouseup', cancelHandler); 
  element.addEventListener('mouseleave', cancelHandler);
  element.addEventListener('touchend', cancelHandler); 
  element.addEventListener('touchcancel', cancelHandler);
  element.addEventListener('contextmenu', e => { e.preventDefault(); });
}

function openContextMenu(title, items) {
  document.getElementById('ctxHeader').innerText = title;
  const body = document.getElementById('ctxBody'); body.innerHTML = '';
  items.forEach(item => {
    if (item.type === 'separator') {
      const sep = document.createElement('div'); sep.className = 'menu-sep'; body.appendChild(sep);
    } else {
      const btn = document.createElement('button'); btn.className = `menu-item ${item.danger ? 'danger' : ''}`;
      btn.innerHTML = item.html; btn.onclick = () => { closeContextMenu(); item.action(); }; body.appendChild(btn);
    }
  });
  document.getElementById('ctxOverlay').style.display = 'flex';
}
function closeContextMenu() { document.getElementById('ctxOverlay').style.display = 'none'; }

// ================================================================
// ★【0.03.02】フォルダー編集パネル（長押しメニューを作り直し）
// ・よく使う操作をボタンで並べ、名前変更・サブフォルダー作成はパネル内で入力できるようにした
// ・「移動」「統合」はフォルダーを一覧から選ぶ方式（以前はフォルダーの数だけメニューが並んでいた）
// ・名前変更・移動・統合・削除は削除記録つきで行い、共有/公開カテゴリーにも反映するので、同期で元に戻らない
// ================================================================
function handleCategoryLongpress(catName) { openCategoryEditor(catName); }

function getCategoryParent(catName) {
  for (const p in categoryTree) { if ((categoryTree[p] || []).includes(catName)) return p; }
  return null;
}
function getCategoryPath(catName) {
  const path = [catName]; let cur = catName, g = 0;
  while (g++ < 100) { const p = getCategoryParent(cur); if (!p) break; path.unshift(p); cur = p; }
  return path;
}
// フォルダー選択用の <option> 一覧（階層を字下げして表示）
function buildCategoryOptionsHTML(excludeSet, extraTop) {
  let html = extraTop ? `<option value="__top__">⬆️ 一番上の階層</option>` : '';
  const walk = (cat, depth) => {
    if (!excludeSet.has(cat)) html += `<option value="${escapeHtml(cat)}">${'　'.repeat(depth)}${depth ? '└ ' : ''}${escapeHtml(cat)}</option>`;
    getChildCategories(cat).forEach(c => walk(c, depth + 1));
  };
  getTopLevelCategories().forEach(c => walk(c, 0));
  return html;
}
function replaceInScopePaths(oldName, newName) {
  const fix = arr => Array.isArray(arr) ? arr.map(x => x === oldName ? newName : x) : arr;
  selectedScopePath = fix(selectedScopePath); lastQuizScopePath = fix(lastQuizScopePath);
  try { if (typeof saveScopePath === 'function') saveScopePath(); } catch (e) {}
  try {
    const exp = localStorage.getItem(`cat_exp_${oldName}`);
    if (exp !== null && newName) { localStorage.setItem(`cat_exp_${newName}`, exp); localStorage.removeItem(`cat_exp_${oldName}`); }
  } catch (e) {}
}
function afterCategoryChange() {
  saveData(true);
  const isActive = id => document.getElementById(id) && document.getElementById(id).classList.contains('active');
  if (isActive('pgTree')) renderTree();
  if (isActive('pgBox')) renderBox();
  if (typeof buildQuizScopeDropdown === 'function') buildQuizScopeDropdown();
}

function ensureCategoryEditorDom() {
  let ov = document.getElementById('catEditOverlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.className = 'ctx-overlay'; ov.id = 'catEditOverlay'; ov.style.display = 'none'; ov.style.zIndex = '1050';
  ov.onclick = closeCategoryEditor;
  ov.innerHTML = `<div class="menu-card editor-card cat-editor" onclick="event.stopPropagation()"><div id="catEditBody"></div></div>`;
  document.body.appendChild(ov);
  return ov;
}
// 教科タグの状態（自分で設定／親から引き継ぎ／なし）
function subjectStatusHTML(cat) {
  const own = getOwnSubject(cat), eff = getCategorySubject(cat);
  if (own) return `<span class="hint-small">… ${subjectChipHTML(own, true)}${catSubjects && Object.prototype.hasOwnProperty.call(catSubjects, cat) ? '' : '（フォルダー名から）'}</span>`;
  if (own === '') return '<span class="hint-small">… なし（親の教科を引き継がない）</span>';
  if (eff) return `<span class="hint-small">… ${subjectChipHTML(eff, true)}（親フォルダーから）</span>`;
  return '<span class="hint-small">… 未設定（サブフォルダーにも引き継がれます）</span>';
}
function closeCategoryEditor() { const ov = document.getElementById('catEditOverlay'); if (ov) ov.style.display = 'none'; }

function openCategoryEditor(catName) {
  if (!categories.includes(catName)) return;
  const ov = ensureCategoryEditorDom();
  const body = document.getElementById('catEditBody');
  const isRoot = catName === '未分類';
  const info = getCategoryShareInfo(catName);
  const subCats = getAllSubcategories(catName);
  const direct = db.filter(q => q.category === catName).length;
  const total = db.filter(q => subCats.includes(q.category)).length;
  const children = (categoryTree[catName] || []).length;
  const path = getCategoryPath(catName);
  const ro = info.shared && info.readOnly;
  const statusChip = !info.shared ? '' :
    ro ? '<span class="cat-chip ro">🔒 購読中（閲覧専用）</span>' :
    info.isOwner ? '<span class="cat-chip own">🌐 自分の共有・公開カテゴリー</span>' : '<span class="cat-chip edit">🤝 共同編集中</span>';
  const btn = (id, icon, label, opts = {}) => `<button type="button" class="cat-act${opts.danger ? ' danger' : ''}" ${opts.disabled ? 'disabled' : ''} data-act="${id}"><span class="cat-act-ic">${icon}</span><span>${label}</span></button>`;
  const lock = ro || isRoot;

  body.innerHTML = `
    <div class="cat-edit-head">
      <div class="cat-edit-path">${path.slice(0, -1).map(p => escapeHtml(p)).join(' › ') || 'トップ'}</div>
      <div class="cat-edit-title">📁 ${escapeHtml(catName)}</div>
      <div class="cat-edit-meta">直下 ${direct} 問 ・ 全体 ${total} 問 ・ サブフォルダー ${children} 個 ${statusChip}</div>
    </div>
    <div class="cat-edit-sec">学習・追加</div>
    <div class="cat-act-grid">
      ${btn('quiz', '▶️', 'このフォルダーで出題')}
      ${btn('open', '📂', '問題一覧を開く')}
      ${btn('add', '📝', '問題を追加', { disabled: ro })}
      ${btn('bulk', '📋', '一括追加', { disabled: ro })}
      ${btn('scan', '📚', '単語帳取込', { disabled: ro })}
      ${btn('sub', '➕', 'サブフォルダー作成', { disabled: ro })}
      ${btn('intro', '📖', getCategoryIntroCard(catName) ? '導入の文を編集' : '導入の文を登録', { disabled: ro })}
    </div>
    <div class="cat-edit-sec">整理</div>
    <div class="cat-act-grid">
      ${btn('rename', '✏️', '名前を変更', { disabled: lock })}
      ${btn('move', '↪️', '別の場所へ移動', { disabled: lock })}
      ${btn('merge', '🔀', '他のフォルダーに統合', { disabled: lock })}
      ${btn('reset', '🔄', '成績をリセット')}
      ${btn('renumber', '🔢', '問題番号を振り直す', { disabled: ro })}
      ${btn('pickdel', '☑️', '問題を選んで削除', { disabled: ro || !total, danger: true })}
    </div>
    <div id="catEditPanel"></div>
    <div class="cat-edit-sec">🏷️ 教科タグ ${subjectStatusHTML(catName)}</div>
    <div class="subj-pick" id="catSubjPick">
      ${SUBJECTS.map(sb => `<button type="button" class="chip subj-filter-chip${getOwnSubject(catName) === sb.name ? ' active' : ''}" data-subj="${escAttr(sb.name)}" style="--subj:${sb.color}">${escapeHtml(sb.name)}</button>`).join('')}
      ${usedSubjects().filter(n => !SUBJECTS.some(s => s.name === n)).map(n => `<button type="button" class="chip subj-filter-chip${getOwnSubject(catName) === n ? ' active' : ''}" data-subj="${escAttr(n)}" style="--subj:${subjectColor(n)}">${escapeHtml(n)}</button>`).join('')}
      <button type="button" class="chip" data-subj-custom="1">＋ 自分で入力</button>
      <button type="button" class="chip" data-subj-clear="1">${catSubjects && Object.prototype.hasOwnProperty.call(catSubjects, catName) ? '↩️ 設定を外す' : '— なし'}</button>
    </div>
    ${path.length > 1 ? `<div class="cat-edit-sec">🚫 出題</div>
    <label class="toggle-pill" style="display:flex; align-items:center; gap:8px;"><input type="checkbox" id="chkCatSkip" ${isCatSkipped(catName) ? 'checked' : ''}>上のフォルダー（${escapeHtml(path[path.length - 2])} など）から出題するときは、このフォルダーの問題を出さない</label>
    <div class="hint-small">例文・Review Test などのフォルダー向け。このフォルダーを選べば、ここだけで出題できます。</div>` : ''}
    ${children ? `<div class="cat-act-grid" style="margin-top:6px;">${btn('skipauto', '🚫', '下の「例文」「Review」「テスト」「チャンツ」フォルダーをまとめて出題から外す')}</div>` : ''}
    <div class="cat-edit-sec">共有</div>
    <div class="cat-act-grid">
      ${info.shared ? '' : btn('share', '🔗', '共有URLを発行', { disabled: isRoot })}
      ${info.shared ? '' : btn('public', '🌐', '公開カテゴリーにする', { disabled: isRoot })}
      ${info.shared && info.isOwner ? btn('unshare', '🛑', '共有・公開を停止') : ''}
      ${info.shared && !info.isOwner ? btn('leave', '🚫', info.root && info.root !== catName ? `購読を解除（${escapeHtml(info.root)} 全体）` : '購読を解除', { danger: true }) : ''}
    </div>
    ${isRoot ? '' : `<div class="cat-edit-sec">危険な操作</div><div class="cat-act-grid">${btn('delete', '🗑️', 'フォルダーと中身を削除', { danger: true, disabled: ro })}</div>`}
    ${ro ? '<div class="hint-small" style="margin-top:6px;">🔒 購読中のカテゴリーは作成者だけが編集できます。成績はあなた専用に保存されます。</div>' : ''}
    <button type="button" class="btn btn-secondary" style="margin-top:14px;" onclick="closeCategoryEditor()">閉じる</button>`;

  body.querySelectorAll('.cat-act').forEach(b => { b.onclick = () => runCategoryAction(catName, b.getAttribute('data-act'), info); });
  // ★【0.03.30】上のフォルダーから出題するときに出さない
  const skipChk = body.querySelector('#chkCatSkip');
  if (skipChk) skipChk.onchange = () => { setCategorySkip(catName, skipChk.checked); };
  // ★【0.03.07】教科タグ
  const afterSubj = () => { afterCategoryChange(); openCategoryEditor(catName); };
  body.querySelectorAll('[data-subj]').forEach(b => { b.onclick = () => {
    const sb = b.getAttribute('data-subj');
    setCategorySubject(catName, getOwnSubject(catName) === sb && Object.prototype.hasOwnProperty.call(catSubjects, catName) ? undefined : sb);
    afterSubj();
  }; });
  const custom = body.querySelector('[data-subj-custom]');
  if (custom) custom.onclick = () => {
    const panel = showCategoryPanel(`<label class="section-label">教科名（例: 現代文、政治・経済）</label>
      <input type="text" id="catEditInput" class="form-control" maxlength="12">
      <div class="form-row" style="margin-top:8px;"><button type="button" class="btn" id="catEditOk">設定</button></div>`);
    const ok = () => { const n = (document.getElementById('catEditInput').value || '').trim(); if (!n) return; setCategorySubject(catName, n); afterSubj(); };
    panel.querySelector('#catEditOk').onclick = ok;
    panel.querySelector('#catEditInput').onkeydown = e => { if (e.key === 'Enter') ok(); };
  };
  const clear = body.querySelector('[data-subj-clear]');
  if (clear) clear.onclick = () => {
    // 自分で付けた教科があれば外す（親から引き継ぐ）。無ければ「なし」を明示して、親の教科も引き継がない
    if (catSubjects && Object.prototype.hasOwnProperty.call(catSubjects, catName)) setCategorySubject(catName, undefined);
    else setCategorySubject(catName, '');
    afterSubj();
  };
  ov.style.display = 'flex';
}

function setCategorySkip(cat, on) {
  catSkip = catSkip || {};
  if (on) catSkip[cat] = true; else if (catSkip[cat]) catSkip[cat] = false;
  saveData(true);
  if (typeof refreshVisibleViews === 'function') refreshVisibleViews(true);
}
const CAT_SKIP_NAME_RE = /例文|review|テスト|チャンツ|chant|check/i;
function autoSkipSubfolders(cat) {
  const targets = getAllSubcategories(cat).filter(c => c !== cat && CAT_SKIP_NAME_RE.test(c) && !isCatSkipped(c));
  if (!targets.length) return alert('名前に「例文」「Review」「テスト」「チャンツ」が入ったサブフォルダーで、まだ外していないものはありません。');
  if (!confirm(`次の ${targets.length} 個のフォルダーを、上のフォルダーから出題するときに出さないようにしますか？\n\n${targets.slice(0, 30).join('\n')}${targets.length > 30 ? '\n…' : ''}`)) return;
  targets.forEach(c => { catSkip[c] = true; });
  saveData(true);
  if (typeof refreshVisibleViews === 'function') refreshVisibleViews(true);
  openCategoryEditor(cat);
}

// ================================================================
// ★【0.03.38】フォルダーの中の問題を選んで、まとめて削除する
// ================================================================
let _bulkDel = null; // { cat, sub, sel: Set(id), q }
function openBulkDeleteDialog(cat) {
  _bulkDel = { cat, sub: false, sel: new Set(), q: '' };
  let ov = document.getElementById('bulkDelOverlay');
  if (!ov) {
    ov = document.createElement('div'); ov.className = 'ctx-overlay'; ov.id = 'bulkDelOverlay'; ov.style.zIndex = '1060';
    ov.innerHTML = `<div class="menu-card editor-card bulkdel-card" onclick="event.stopPropagation()"><div id="bulkDelBody"></div></div>`;
    ov.onclick = closeBulkDeleteDialog;
    document.body.appendChild(ov);
  }
  ov.style.display = 'flex';
  renderBulkDelete();
}
function closeBulkDeleteDialog() { const ov = document.getElementById('bulkDelOverlay'); if (ov) ov.style.display = 'none'; _bulkDel = null; }
function bulkDeleteCards() {
  const st = _bulkDel; if (!st) return [];
  const cats = new Set(st.sub ? getAllSubcategories(st.cat) : [st.cat]);
  const kw = st.q.trim().toLowerCase();
  return sortCardsByNumber(db.filter(q => cats.has(q.category) && (!kw || String(q.question).toLowerCase().includes(kw) || String(q.answer).toLowerCase().includes(kw) || String(q.note || '').toLowerCase().includes(kw))));
}
function bulkDelCanDelete(q) { const a = getSharedAccess(q.sharedDocId); return !(a.shared && a.readOnly); }
function renderBulkDelete() {
  const st = _bulkDel; if (!st) return;
  const body = document.getElementById('bulkDelBody');
  const cards = bulkDeleteCards();
  const hasSub = getAllSubcategories(st.cat).length > 1;
  const keepScroll = (document.getElementById('bulkDelList') || {}).scrollTop || 0;
  body.innerHTML = `
    <div class="cat-edit-title">☑️ 問題を選んで削除</div>
    <div class="cat-edit-path">📁 ${escapeHtml(st.cat)}</div>
    <input type="text" id="bulkDelSearch" class="form-control" placeholder="🔍 問題・答え・メモで絞り込み" value="${escAttr(st.q)}" style="margin-top:8px;">
    ${hasSub ? `<label class="toggle-pill" style="margin-top:6px; display:flex; align-items:center; gap:8px;"><input type="checkbox" id="bulkDelSub" ${st.sub ? 'checked' : ''}>下のフォルダーの問題も表示</label>` : ''}
    <div class="bulkdel-bar">
      <button type="button" class="chip" id="bulkDelAll">表示中を全部選ぶ</button>
      <button type="button" class="chip" id="bulkDelNone">選択を外す</button>
      <span class="hint-small">${st.sel.size} 件を選択中 ・ ${cards.length} 件を表示</span>
    </div>
    <div id="bulkDelList" class="bulkdel-list">${cards.map(q => {
      const ok = bulkDelCanDelete(q);
      return `<label class="bulkdel-row${ok ? '' : ' ro'}"><input type="checkbox" data-id="${escAttr(q.id)}" ${st.sel.has(q.id) ? 'checked' : ''} ${ok ? '' : 'disabled'}>
        <div style="min-width:0; flex:1;"><div class="bulkdel-q">${q.no ? `<span class="card-no">No.${cardNoText(q.no)}</span>` : ''}${escapeHtml(String(q.question).slice(0, 120))}</div>
        <div class="hint-small">${escapeHtml(String(q.answer).slice(0, 80))}${st.sub && q.category !== st.cat ? `　📂 ${escapeHtml(q.category)}` : ''}${ok ? '' : '　🔒 閲覧専用'}</div></div></label>`;
    }).join('') || '<div class="hint-small" style="padding:12px;">問題がありません。</div>'}</div>
    <div class="plan-btns" style="margin-top:10px;">
      <button type="button" class="btn btn-danger" id="bulkDelGo" ${st.sel.size ? '' : 'disabled'}>🗑️ ${st.sel.size} 件を削除</button>
      <button type="button" class="btn btn-secondary" onclick="closeBulkDeleteDialog()">閉じる</button>
    </div>`;
  const list = document.getElementById('bulkDelList'); list.scrollTop = keepScroll;
  list.querySelectorAll('input[type=checkbox]').forEach(cb => cb.onchange = () => { if (cb.checked) st.sel.add(cb.dataset.id); else st.sel.delete(cb.dataset.id); renderBulkDelete(); });
  const s = document.getElementById('bulkDelSearch');
  s.oninput = () => { st.q = s.value; const pos = s.selectionStart; renderBulkDelete(); const s2 = document.getElementById('bulkDelSearch'); s2.focus(); try { s2.setSelectionRange(pos, pos); } catch (e) {} };
  const sub = document.getElementById('bulkDelSub'); if (sub) sub.onchange = () => { st.sub = sub.checked; renderBulkDelete(); };
  document.getElementById('bulkDelAll').onclick = () => { cards.filter(bulkDelCanDelete).forEach(q => st.sel.add(q.id)); renderBulkDelete(); };
  document.getElementById('bulkDelNone').onclick = () => { st.sel.clear(); renderBulkDelete(); };
  document.getElementById('bulkDelGo').onclick = runBulkDelete;
}
async function runBulkDelete() {
  const st = _bulkDel; if (!st || !st.sel.size) return;
  const targets = db.filter(q => st.sel.has(q.id) && bulkDelCanDelete(q));
  if (!targets.length) return;
  const shared = targets.filter(q => q.sharedDocId).length;
  if (!confirm(`選んだ ${targets.length} 件の問題を削除しますか？${shared ? `\n\n⚠️ そのうち ${shared} 件は共有カテゴリーのカードなので、共有している全員の手元からも消えます。` : ''}\n（削除の前の状態は「復元ポイント」から戻せます）`)) return;
  if (typeof takeSnapshot === 'function') await takeSnapshot(`問題の一括削除（${st.cat}・${targets.length}件）`);
  const ids = targets.map(q => q.id), idSet = new Set(ids);
  tombstoneCards(ids);
  db = db.filter(q => !idSet.has(q.id));
  const byDoc = {};
  targets.forEach(q => { if (q.sharedDocId) (byDoc[q.sharedDocId] = byDoc[q.sharedDocId] || []).push(q.id); });
  saveData(true);
  for (const d of Object.keys(byDoc)) await removeCardsFromSharedDoc(d, byDoc[d]);
  st.sel.clear();
  if (typeof refreshVisibleViews === 'function') refreshVisibleViews(true);
  renderBulkDelete();
  if (typeof showAppToast === 'function') showAppToast(`🗑️ ${targets.length} 件を削除しました`); else alert(`🗑️ ${targets.length} 件を削除しました`);
}

// ================================================================
// ★【0.03.44】📖 フォルダーの導入の文（単語帳のグループのはじめの文章など）
// 種類「導入」（kind: 'intro'）のカードとしてそのフォルダーに1枚だけ持つ（端末間の同期・共有カテゴリーにも乗る）。
// クイズ・暗記テストの問題には出さない。暗記テストの2周目で、グループの切れ目ごとに読む（AI があればその文から4択も）
// ================================================================
function getCategoryIntroCard(cat) { return db.find(q => q.category === cat && q.kind === 'intro') || null; }
function getCategoryIntro(cat) { const c = getCategoryIntroCard(cat); return c ? String(c.answer || '').trim() : ''; }
function openCategoryIntroEditor(catName, info) {
  const cur = getCategoryIntroCard(catName);
  const panel = showCategoryPanel(`<div class="cat-edit-sec" style="margin-top:0;">📖 導入の文</div>
    <textarea id="catIntroText" class="form-control" rows="7" placeholder="このフォルダー（グループ）のはじめの文章。暗記テストの2周目で、グループの切れ目ごとに読みます">${escapeHtml(cur ? cur.answer : '')}</textarea>
    <div class="plan-btns" style="margin-top:8px;"><button type="button" class="btn btn-primary" id="catIntroSave">💾 保存</button>${cur ? '<button type="button" class="btn btn-secondary" id="catIntroDel">🗑️ 消す</button>' : ''}</div>`);
  panel.querySelector('#catIntroSave').onclick = () => saveCategoryIntro(catName, panel.querySelector('#catIntroText').value, info);
  const del = panel.querySelector('#catIntroDel'); if (del) del.onclick = () => { if (confirm('導入の文を消しますか？')) saveCategoryIntro(catName, '', info); };
}
async function saveCategoryIntro(catName, text, info) {
  text = String(text || '').trim();
  const cur = getCategoryIntroCard(catName);
  if (!text) {
    if (!cur) return;
    tombstoneCards([cur.id]); db = db.filter(q => q !== cur); saveData(true);
    if (cur.sharedDocId) await removeCardsFromSharedDoc(cur.sharedDocId, [cur.id]);
  } else if (cur) {
    cur.answer = text; touchCard(cur); saveData(true);
    if (cur.sharedDocId) await updateCardInSharedDoc(cur.sharedDocId, cur, 'edit');
  } else {
    const card = { id: newCardId(), question: '📖 導入の文', answer: text, kind: 'intro', category: catName, level: 0, correct: 0, incorrect: 0, streak: 0, wrongStreak: 0, shikkariStreak: 0 };
    touchCard(card);
    if (info && info.shared && info.canEdit) card.sharedDocId = info.docId;
    db.push(card); saveData(true);
    if (card.sharedDocId) await updateCardInSharedDoc(card.sharedDocId, card, 'add');
  }
  if (typeof refreshVisibleViews === 'function') refreshVisibleViews(true);
  openCategoryEditor(catName);
  if (typeof showAppToast === 'function') showAppToast(text ? '📖 導入の文を保存しました' : '📖 導入の文を消しました');
}

function showCategoryPanel(html) {
  const panel = document.getElementById('catEditPanel');
  panel.innerHTML = `<div class="cat-edit-panel">${html}</div>`;
  const first = panel.querySelector('input, select');
  if (first) setTimeout(() => first.focus(), 30);
  return panel;
}

function runCategoryAction(catName, act, info) {
  const ro = info.shared && info.readOnly;
  switch (act) {
    case 'quiz': {
      selectedScopePath = getCategoryPath(catName); lastQuizScopePath = [...selectedScopePath];
      try { saveScopePath(); } catch (e) {}
      closeCategoryEditor(); openPage('pgHome'); buildQuizScopeDropdown();
      return;
    }
    case 'skipauto': autoSkipSubfolders(catName); return;
    case 'pickdel': closeCategoryEditor(); openBulkDeleteDialog(catName); return;
    case 'intro': openCategoryIntroEditor(catName, info); return;
    case 'open': closeCategoryEditor(); currentViewContext = { type: 'category', value: catName }; openPage('pgBox'); return;
    case 'add': closeCategoryEditor(); currentViewContext = { type: 'category', value: catName }; showAddQModal(); return;
    case 'bulk': closeCategoryEditor(); showBulkAddModal(catName); return;
    case 'scan': closeCategoryEditor(); showScanImportModal(catName); return;
    case 'reset': {
      if(!confirm(`⚠️ 「${catName}」とサブフォルダー内の全てのカードの成績（正解数・レベル等）をリセットしますか？\n（問題自体は消えません。リセット前の成績は「復元ポイント」から戻せます）`)) return;
      takeSnapshot(`「${catName}」の成績リセット`);
      const targetCats = getAllSubcategories(catName);
      let resetCount = 0;
      db.forEach(q => {
        if(targetCats.includes(q.category)) {
          q.level = 0; q.correct = 0; q.incorrect = 0; q.streak = 0; q.wrongStreak = 0; q.shikkariStreak = 0; q.level5Correct = 0; delete q.senses; delete q.drillStats;
          touchStats(q); resetCount++;
        }
      });
      saveData(true);
      alert(`✅ ${resetCount}件の成績をリセットしました！`);
      if (document.getElementById('pgStats') && document.getElementById('pgStats').classList.contains('active')) renderStatsAndCharts();
      return;
    }
    case 'renumber': {
      const cards = sortCardsByNumber(db.filter(q => q.category === catName));
      if (!cards.length) return alert('このフォルダーの直下に問題がありません。');
      if (!confirm(`「${catName}」の直下の問題 ${cards.length} 問に、今の並び順で 1 から番号を振り直しますか？`)) return;
      takeSnapshot(`「${catName}」の番号振り直し`);
      cards.forEach((q, i) => { if (q.no !== i + 1) { q.no = i + 1; touchCard(q); } });
      saveData(true);
      if (info.shared && info.canEdit) pushSharedDocFromLocal(info.docId);
      if (document.getElementById('pgBox').classList.contains('active')) renderBox();
      alert('✅ 番号を振り直しました。');
      return;
    }
    case 'sub': {
      const panel = showCategoryPanel(`
        <label class="section-label">「${escapeHtml(catName)}」の中に作るフォルダー名</label>
        <input type="text" id="catEditInput" class="form-control" placeholder="例: 第1章">
        <div class="form-row" style="margin-top:8px;"><button type="button" class="btn" id="catEditOk">作成</button></div>`);
      const ok = () => {
        const n = (document.getElementById('catEditInput').value || '').trim();
        if (!n) return;
        const bad = invalidCategoryName(n); if (bad) return alert(bad);
        if (categories.includes(n)) return alert('同じ名前のフォルダーが既にあります。');
        markCatCreated(n);
        categories.push(n);
        if (!categoryTree[catName]) categoryTree[catName] = [];
        categoryTree[catName].push(n);
        try { localStorage.setItem(`cat_exp_${catName}`, 'true'); } catch (e) {}
        afterCategoryChange();
        if (info.shared && info.canEdit) pushSharedDocFromLocal(info.docId);
        openCategoryEditor(catName);
      };
      panel.querySelector('#catEditOk').onclick = ok;
      panel.querySelector('#catEditInput').onkeydown = e => { if (e.key === 'Enter') ok(); };
      return;
    }
    case 'rename': {
      const panel = showCategoryPanel(`
        <label class="section-label">新しいフォルダー名</label>
        <input type="text" id="catEditInput" class="form-control" value="${escapeHtml(catName)}">
        <div class="hint-small">既にある名前にすると、そのフォルダーに統合できます。</div>
        <div class="form-row" style="margin-top:8px;"><button type="button" class="btn" id="catEditOk">変更</button></div>`);
      const ok = () => {
        const n = (document.getElementById('catEditInput').value || '').trim();
        if (!n || n === catName) return;
        const bad = invalidCategoryName(n); if (bad) return alert(bad);
        if (categories.includes(n)) {
          if (!confirm(`「${n}」は既にあります。\n「${catName}」の中身を「${n}」に統合しますか？`)) return;
          if (!mergeCategoryInto(catName, n)) return;
          closeCategoryEditor(); return;
        }
        renameCategory(catName, n);
        openCategoryEditor(n);
      };
      panel.querySelector('#catEditOk').onclick = ok;
      panel.querySelector('#catEditInput').onkeydown = e => { if (e.key === 'Enter') ok(); };
      return;
    }
    case 'move': {
      const exclude = new Set(getAllSubcategories(catName));
      const parent = getCategoryParent(catName);
      const panel = showCategoryPanel(`
        <label class="section-label">移動先（この中に入れます）</label>
        <select id="catEditSelect" class="form-control">${buildCategoryOptionsHTML(exclude, !!parent)}</select>
        <div class="hint-small">今の場所: ${parent ? escapeHtml(parent) : '一番上の階層'}</div>
        <div class="form-row" style="margin-top:8px;"><button type="button" class="btn" id="catEditOk">移動</button></div>`);
      panel.querySelector('#catEditOk').onclick = () => {
        const v = document.getElementById('catEditSelect').value;
        if (!v) return;
        if (v !== '__top__') { const d = getCategoryShareInfo(v); if (d.shared && d.readOnly) return alert('🔒 閲覧専用の共有カテゴリーの中には移動できません。'); }
        moveCategory(catName, v === '__top__' ? null : v);
        openCategoryEditor(catName);
      };
      return;
    }
    case 'merge': {
      const exclude = new Set(getAllSubcategories(catName));
      const panel = showCategoryPanel(`
        <label class="section-label">統合先のフォルダー</label>
        <select id="catEditSelect" class="form-control">${buildCategoryOptionsHTML(exclude, false)}</select>
        <div class="hint-small">「${escapeHtml(catName)}」の問題とサブフォルダーをすべて統合先へ移し、「${escapeHtml(catName)}」は削除します。同じ問題・答えのカードは1枚にまとめます（成績は良い方を残します）。</div>
        <div class="form-row" style="margin-top:8px;"><button type="button" class="btn" id="catEditOk">統合する</button></div>`);
      panel.querySelector('#catEditOk').onclick = () => {
        const v = document.getElementById('catEditSelect').value;
        if (!v) return;
        if (!confirm(`「${catName}」を「${v}」に統合しますか？`)) return;
        if (mergeCategoryInto(catName, v)) closeCategoryEditor();
      };
      return;
    }
    case 'share': closeCategoryEditor(); shareCategory(catName); return;
    case 'public': closeCategoryEditor(); makePublicCategory(catName); return;
    case 'unshare': closeCategoryEditor(); deletePublicCategory(info.docId, catName); return;
    case 'leave': closeCategoryEditor(); unsubscribeSharedCategory(catName); return;
    case 'delete': closeCategoryEditor(); deleteCategoryTree(catName, info); return;
  }
}

function renameCategory(oldName, newName) {
  const info = getCategoryShareInfo(oldName);
  categories = categories.map(c => c === oldName ? newName : c);
  for (const p in categoryTree) categoryTree[p] = categoryTree[p].map(c => c === oldName ? newName : c);
  if (categoryTree[oldName]) { categoryTree[newName] = categoryTree[oldName]; delete categoryTree[oldName]; }
  db.forEach(q => { if (q.category === oldName) { q.category = newName; touchCard(q); } });
  renameInSharedMeta(oldName, newName);
  if (catSubjects && Object.prototype.hasOwnProperty.call(catSubjects, oldName)) { catSubjects[newName] = catSubjects[oldName]; delete catSubjects[oldName]; }
  if (catSkip && Object.prototype.hasOwnProperty.call(catSkip, oldName)) { catSkip[newName] = catSkip[oldName]; delete catSkip[oldName]; }
  markCatsDeleted([oldName]);
  markCatCreated(newName);
  replaceInScopePaths(oldName, newName);
  afterCategoryChange();
  if (info.shared && info.canEdit) pushSharedDocFromLocal(info.docId);
}

function moveCategory(catName, newParent) {
  const before = getCategoryShareInfo(catName);
  for (const g in categoryTree) categoryTree[g] = (categoryTree[g] || []).filter(c => c !== catName);
  if (newParent) { if (!categoryTree[newParent]) categoryTree[newParent] = []; categoryTree[newParent].push(catName); }
  const after = newParent ? getCategoryShareInfo(newParent) : { shared: false };
  afterCategoryChange();
  if (before.shared && before.canEdit) pushSharedDocFromLocal(before.docId);
  if (after.shared && after.canEdit && after.docId !== before.docId) pushSharedDocFromLocal(after.docId);
}

// ★【0.03.02】フォルダーの統合：src の問題とサブフォルダーを dst に移し、src を削除する
function mergeCategoryInto(src, dst) {
  if (src === dst || src === '未分類') return false;
  if (getAllSubcategories(src).includes(dst)) { alert('自分の中のフォルダーには統合できません。'); return false; }
  if (isSharedDocRoot(src)) { alert('共有・公開カテゴリーの一番上のフォルダーは統合できません。\n（名前の変更や移動はできます）'); return false; }
  const sInfo = getCategoryShareInfo(src), dInfo = getCategoryShareInfo(dst);
  if ((sInfo.shared && sInfo.readOnly) || (dInfo.shared && dInfo.readOnly)) { alert('🔒 閲覧専用の共有カテゴリーは統合できません。'); return false; }
  takeSnapshot(`「${src}」の統合`);
  // 統合したカードは、統合先の最後の番号の次から元の順番で並べる
  let nextNo = Math.max(0, ...db.filter(q => q.category === dst).map(q => Number(q.no) || 0));
  sortCardsByNumber(db.filter(q => q.category === src)).forEach(q => { q.no = ++nextNo; });
  db.forEach(q => {
    if (q.category === src) {
      q.category = dst;
      // 統合先が共有カテゴリーなら、そのドキュメントのカードとして扱う
      if (dInfo.shared && dInfo.canEdit) q.sharedDocId = dInfo.docId;
      else if (q.sharedDocId && sInfo.shared && !dInfo.shared) delete q.sharedDocId;
      touchCard(q);
    }
  });
  const movedChildren = categoryTree[src] || [];
  delete categoryTree[src];
  for (const p in categoryTree) categoryTree[p] = categoryTree[p].filter(c => c !== src);
  if (movedChildren.length) { if (!categoryTree[dst]) categoryTree[dst] = []; movedChildren.forEach(c => { if (!categoryTree[dst].includes(c)) categoryTree[dst].push(c); }); }
  categories = categories.filter(c => c !== src);
  markCatsDeleted([src]);
  replaceInScopePaths(src, dst);
  autoMerge(true);
  afterCategoryChange();
  if (sInfo.shared && sInfo.canEdit) pushSharedDocFromLocal(sInfo.docId);
  if (dInfo.shared && dInfo.canEdit && dInfo.docId !== sInfo.docId) pushSharedDocFromLocal(dInfo.docId);
  alert(`✅ 「${src}」を「${dst}」に統合しました。`);
  return true;
}

async function deleteCategoryTree(catName, info) {
  if (info.shared && info.readOnly) return alert("🔒 購読中のカテゴリーは削除ではなく「購読を解除」してください。");
  const toDelete = getAllSubcategories(catName);
  const count = db.filter(q => toDelete.includes(q.category)).length;
  // ★【0.03.13】共有・公開中のカテゴリーを消すときの扱いを分かりやすく
  //  ・作成者が一番上のフォルダーを消す → 共有・公開を停止する（購読している人の手元には、同期が止まったフォルダーとして残る）
  //    以前は「キャンセル」でも共有先の中身まで空にしていた
  //  ・共有カテゴリーの中のフォルダーを消す（作成者・共同編集者）→ 共有している全員の手元から消える
  const ownerRoot = info.shared && info.isOwner && info.root === catName;
  let msg = `警告: 「${catName}」とサブフォルダー ${toDelete.length - 1} 個、問題 ${count} 問をすべて削除しますか？`;
  if (ownerRoot) msg += `\n\n「${catName}」は共有・公開中です。共有・公開も停止します。\n（購読している人の手元には、同期が止まったフォルダーとして残ります）`;
  else if (info.shared && info.canEdit && info.root === catName) msg += `\n\n⚠️ 共同編集中の共有カテゴリーです。共有している全員の手元からこのフォルダーの問題が消えます。\n（自分だけ使わなくなる場合は「購読を解除」を使ってください）`;
  else if (info.shared && info.canEdit) msg += `\n\n⚠️ 共有カテゴリーの中のフォルダーなので、共有している全員の手元からも消えます。`;
  msg += `\n\n（消す前の状態は、この端末の「復元ポイント」から戻せます）`;
  if (!confirm(msg)) return;
  takeSnapshot(`「${catName}」の削除`);
  if (ownerRoot) {
    // 先に共有を止めてから手元を消す（空になった状態を共有先へ書き戻さない）
    try { await deleteSharedDocAndCode(info.docId); } catch (e) { console.warn(e); }
    detachSharedDoc(info.docId);
  }
  tombstoneCards(db.filter(q => toDelete.includes(q.category)).map(q => q.id));
  db = db.filter(q => !toDelete.includes(q.category));
  categories = categories.filter(c => !toDelete.includes(c));
  for(let p in categoryTree) { if(toDelete.includes(p)) delete categoryTree[p]; else if(categoryTree[p]) categoryTree[p] = categoryTree[p].filter(c => !toDelete.includes(c)); }
  markCatsDeleted(toDelete);
  afterCategoryChange();
  if (!ownerRoot && info.shared && info.canEdit) pushSharedDocFromLocal(info.docId);
}
