// ================================================================
// ★【0.03.49】📁 フォルダーを選ぶ画面（ホームの出題範囲・暗記テスト・週間プラン・オンライン対戦で共通）
// 段々のプルダウンをやめて、フォルダーのツリーから1つ選ぶ。検索・問題数つき。
// openFolderPicker({
//   title, current: 今のフォルダー（'' はすべて）, allLabel: 「すべて」の行の文字（無ければ出さない）,
//   selectable: c => 選べるか（既定：すべて）, visible: c => 出すか（既定：選べるフォルダーとその上のフォルダー）,
//   count: c => 横に出す数（既定：中の問題数）, note: c => 横に出す文字, hint: 上に出す説明, onPick: c => {}
// })
// ================================================================
let _fp = null;
function fpCardCounts() {
  const direct = {};
  db.forEach(q => { if (q.kind !== 'intro') direct[q.category] = (direct[q.category] || 0) + 1; });
  const total = {};
  Object.keys(direct).forEach(c => getCategoryPath(c).forEach(p => { total[p] = (total[p] || 0) + direct[c]; }));
  return total;
}
function openFolderPicker(o) {
  const total = fpCardCounts();
  const sel = o.selectable || (() => true);
  const below = c => getAllSubcategories(c); // 自分も含む
  const vis = o.visible || (c => below(c).some(sel));
  const open = new Set(o.current ? getCategoryPath(o.current).slice(0, -1) : []);
  _fp = Object.assign({}, o, { total, sel, vis, open, q: '' });
  let ov = document.getElementById('folderPickerOverlay');
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'folderPickerOverlay'; ov.className = 'ctx-overlay'; ov.style.zIndex = '1070';
    ov.innerHTML = '<div class="menu-card editor-card fp-card" onclick="event.stopPropagation()"><div id="fpBody"></div></div>';
    ov.onclick = closeFolderPicker;
    document.body.appendChild(ov);
  }
  ov.style.display = 'flex';
  renderFolderPicker();
  setTimeout(() => { const cur = document.querySelector('#fpList .fp-row.cur'); if (cur) cur.scrollIntoView({ block: 'center' }); }, 30);
}
function closeFolderPicker() { const ov = document.getElementById('folderPickerOverlay'); if (ov) ov.style.display = 'none'; _fp = null; }
function fpRowHTML(c, depth, flat) {
  const p = _fp, kids = flat ? [] : getChildCategories(c).filter(p.vis);
  const can = p.sel(c), isOpen = p.open.has(c), cur = p.current === c;
  const n = p.count ? p.count(c) : (p.total[c] || 0);
  const note = p.note ? p.note(c) : '';
  const label = flat ? getCategoryPath(c).map(escapeHtml).join(' <span class="fp-sep">›</span> ') : escapeHtml(c);
  // ★【0.03.62】中にフォルダーがあるものは、名前を押すと開く（決めるのは「これにする」）。中が無いものは名前を押すと決まる
  return `<div class="fp-row${cur ? ' cur' : ''}${can ? '' : ' off'}" style="padding-left:${8 + depth * 18}px;">
    ${kids.length ? `<button type="button" class="fp-tog" data-tog="${escAttr(c)}">${isOpen ? '▾' : '▸'}</button>` : '<span class="fp-tog"></span>'}
    <button type="button" class="fp-name" ${kids.length && !flat ? `data-tog="${escAttr(c)}"` : `data-pick="${escAttr(c)}"`}>${kids.length ? (isOpen ? '📂' : '📁') : '📄'} ${label}<span class="fp-meta-in">${note ? escapeHtml(note) + ' ・ ' : ''}${n}問</span></button>
    ${can && kids.length && !flat ? `<button type="button" class="chip fp-pick" data-pick="${escAttr(c)}">これにする</button>` : ''}
  </div>` + (isOpen ? kids.map(k => fpRowHTML(k, depth + 1)).join('') : '');
}
function renderFolderPicker() {
  const p = _fp; if (!p) return;
  const body = document.getElementById('fpBody');
  const q = p.q.trim().toLowerCase();
  let list;
  if (q) {
    const hits = categories.filter(c => p.vis(c) && c.toLowerCase().includes(q));
    list = hits.length ? hits.slice(0, 80).map(c => fpRowHTML(c, 0, true)).join('') : '<div class="hint-small" style="padding:12px;">見つかりません</div>';
  } else {
    list = getTopLevelCategories().filter(p.vis).map(c => fpRowHTML(c, 0)).join('') || '<div class="hint-small" style="padding:12px;">選べるフォルダーがありません</div>';
  }
  const keep = (document.getElementById('fpList') || {}).scrollTop || 0;
  body.innerHTML = `<div class="cat-edit-title">${escapeHtml(p.title || '📁 フォルダーを選ぶ')}</div>
    ${p.hint ? `<div class="hint-small" style="margin-top:4px;">${p.hint}</div>` : ''}
    <input type="text" id="fpSearch" class="form-control" placeholder="🔍 フォルダー名で探す" value="${escAttr(p.q)}" style="margin-top:8px;">
    <div id="fpList" class="fp-list">
      ${p.allLabel ? `<div class="fp-row${!p.current ? ' cur' : ''}" style="padding-left:8px;"><span class="fp-tog"></span><button type="button" class="fp-name" data-pick="">${escapeHtml(p.allLabel)}</button></div>` : ''}
      ${list}
    </div>
    <div class="hint-small" style="margin-top:6px;">📁 を押すと中のフォルダーが開きます。そのフォルダー（とその中ぜんぶ）にするときは「これにする」、📄 は押すとそれに決まります</div>
    <button type="button" class="btn btn-secondary" style="margin-top:8px;" onclick="closeFolderPicker()">閉じる</button>`;
  const L = document.getElementById('fpList'); L.scrollTop = keep;
  L.querySelectorAll('[data-tog]').forEach(b => b.onclick = () => { const c = b.dataset.tog; if (p.open.has(c)) p.open.delete(c); else p.open.add(c); renderFolderPicker(); });
  L.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
    const c = b.dataset.pick;
    if (c && !p.sel(c)) { if (getChildCategories(c).some(p.vis)) { p.open.add(c); renderFolderPicker(); } return; }
    const fn = p.onPick; closeFolderPicker(); fn(c);
  });
  const s = document.getElementById('fpSearch');
  s.oninput = () => { p.q = s.value; const pos = s.selectionStart; renderFolderPicker(); const s2 = document.getElementById('fpSearch'); s2.focus(); try { s2.setSelectionRange(pos, pos); } catch (e) {} };
}
// 選んでいるフォルダーを表すボタン（押すと選ぶ画面）
function folderPickButtonHTML(cat, emptyLabel, onclick, extra) {
  const path = cat ? getCategoryPath(cat) : [];
  const label = path.length ? path.map(escapeHtml).join(' <span class="fp-sep">›</span> ') : escapeHtml(emptyLabel || 'フォルダーを選ぶ');
  return `<button type="button" class="fp-btn" onclick="${onclick}"><span class="fp-btn-ico">${path.length ? '📁' : '🌐'}</span><span class="fp-btn-txt">${label}${extra ? `<span class="fp-btn-sub">${extra}</span>` : ''}</span><span class="fp-btn-chg">変更 ▾</span></button>`;
}
