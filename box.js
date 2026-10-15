// ----------------- 問題箱機能 -----------------
let _boxAnswerCache = {};
function showAllCards() { currentViewContext = 'all'; const sb = document.getElementById('txtSearchBox'); if(sb) sb.value = ''; renderBox(); }
function filterBoxByStatus(statusType) { currentViewContext = statusType; openPage('pgBox'); }

function renderBox() {
  const container = document.getElementById('boxList'); container.innerHTML = '';
  let filtered = [...db]; let titleString = "📝 全ての問題一覧";

  let navContainer = null;
  const specialViews = ['all', 'grad', 'master', 'normal', 'weak', 'shikkari', 'unseen'];
  
  if (typeof currentViewContext === 'object' && currentViewContext.type === 'category') {
    const currentCat = currentViewContext.value;
    const showAllSub = currentViewContext.showAllSub || false; // デフォルトは直下のみ表示
    const subCats = getAllSubcategories(currentCat); 
    
    if (showAllSub) {
      filtered = db.filter(q => subCats.includes(q.category));
      titleString = `🔖 ${currentCat} (全階層を表示中)`;
    } else {
      filtered = db.filter(q => q.category === currentCat);
      titleString = `🔖 ${currentCat}`;
    }
    
    let parentCat = null;
    if (typeof categoryTree !== 'undefined') {
      for (let p in categoryTree) { 
        if (categoryTree[p] && categoryTree[p].includes(currentCat)) { parentCat = p; break; } 
      }
    }
    
    navContainer = document.createElement('div');
    navContainer.style.cssText = 'display:flex; flex-direction:column; gap:10px; padding-bottom:15px; margin-bottom:15px; border-bottom:1px solid var(--border);';
    
    // 操作ボタンエリア（階層移動 ＆ 一括表示トグル）
    const topBar = document.createElement('div');
    topBar.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap;';
    
    if (parentCat) {
      const btnUp = document.createElement('button');
      btnUp.type = 'button';
      btnUp.className = 'btn btn-secondary';
      btnUp.style.cssText = 'padding:6px 12px; font-size:0.85rem; width:auto; border-radius:20px;';
      btnUp.innerHTML = `⬆️ 上の階層 (${escapeHtml(parentCat)})`;
      btnUp.onclick = (e) => { 
        e.preventDefault();
        currentViewContext = { type: 'category', value: parentCat }; 
        renderBox(); 
      };
      topBar.appendChild(btnUp);
    }

    // サブフォルダーが存在する場合のみ、一括表示トグルを出す
    if (subCats.length > 1) { 
      const btnToggle = document.createElement('button');
      btnToggle.type = 'button';
      btnToggle.className = showAllSub ? 'btn btn-accent' : 'btn btn-secondary';
      btnToggle.style.cssText = 'padding:6px 12px; font-size:0.85rem; width:auto; border-radius:20px;';
      btnToggle.innerHTML = showAllSub ? `🔄 直下の問題のみ表示` : `📚 下位フォルダーの問題も一括表示`;
      btnToggle.onclick = (e) => { 
        e.preventDefault();
        currentViewContext.showAllSub = !showAllSub; 
        renderBox(); 
      };
      topBar.appendChild(btnToggle);
    }
    navContainer.appendChild(topBar);
    
    // サブフォルダーを箱分けして表示
    if (typeof categoryTree !== 'undefined' && categoryTree[currentCat] && categoryTree[currentCat].length > 0) {
      const children = getChildCategories(currentCat);
      
      const subTitle = document.createElement('div');
      subTitle.style.cssText = 'font-size:0.8rem; color:var(--text2); font-weight:bold; margin-top:5px;';
      subTitle.innerText = '📂 サブフォルダー';
      navContainer.appendChild(subTitle);
      
      const subGrid = document.createElement('div');
      subGrid.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill, minmax(130px, 1fr)); gap:8px;';
      
      children.forEach(c => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-secondary';
        btn.style.cssText = 'padding:10px; font-size:0.9rem; text-align:left; justify-content:flex-start; height:auto; background:var(--bg3);';
        
        const childCount = db.filter(q => q.category === c).length;
        btn.innerHTML = `📁 ${escapeHtml(c)} <span style="font-size:0.7rem; color:var(--text3); float:right; margin-top:2px;">${childCount}</span>`;
        btn.onclick = (e) => { 
          e.preventDefault();
          currentViewContext = { type: 'category', value: c }; 
          renderBox(); 
        };
        subGrid.appendChild(btn);
      });
      navContainer.appendChild(subGrid);
    }
  } else if (typeof currentViewContext === 'string' && currentViewContext !== 'all') {
    titleString = `📊 実績抽出カードの一覧`;
    if (currentViewContext === 'grad') filtered = db.filter(q => isGraduated(q));
    if (currentViewContext === 'master') filtered = db.filter(q => !(isGraduated(q)) && q.level >= 3);
    if (currentViewContext === 'normal') filtered = db.filter(q => !(isGraduated(q)) && q.level >= 1 && q.level <= 2);
    if (currentViewContext === 'weak') filtered = db.filter(q => !(isGraduated(q)) && q.level === 0 && (q.correct+q.incorrect)>0);
    if (currentViewContext === 'shikkari') filtered = db.filter(q => !(isGraduated(q)) && q.level === -1);
    if (currentViewContext === 'unseen') filtered = db.filter(q => q.correct === 0 && q.incorrect === 0 && q.level >= 0);
  }

  const sb = document.getElementById('txtSearchBox');
  if (sb && sb.value.trim() !== '') {
    const kw = sb.value.trim().toLowerCase();
    filtered = filtered.filter(q => q.question.toLowerCase().includes(kw) || q.answer.toLowerCase().includes(kw) || String(q.note || '').toLowerCase().includes(kw));
  }

  // ★【0.03.03】フォルダーの番号順 → 問題番号順に並べる（追加した順ではなく）
  sortCardsByNumber(filtered);
  document.getElementById('boxTitle').innerText = titleString;
  document.getElementById('lblBoxCount').innerText = `${filtered.length} 件`;
  
  if (navContainer) container.appendChild(navContainer);

  if(filtered.length === 0) { 
    const emptyMsg = document.createElement('div');
    emptyMsg.style.cssText = 'text-align:center; padding:40px; color:var(--text3);';
    emptyMsg.innerText = '問題がありません';
    container.appendChild(emptyMsg);
    return; 
  }

  filtered.forEach(item => {
    const isGrad = isGraduated(item);
    const card = document.createElement('div'); card.className = 'q-card';
    setupLongpress(card, () => handleQuestionLongpress(item));
    _boxAnswerCache[item.id] = { text: item.answer, image: item.answerImage || null };

    const lvlStr = item.level === -1 ? 'しっかり' : 'LV '+item.level;
    const noHTML = item.no ? `<span class="card-no">No.${Number(item.no)}</span>` : '';
    const badgeHTML = `<span class="badge ${isGrad ? 'badge-grad':'badge-level'}">${isGrad ? 'GRADUATE' : lvlStr}</span>`;
    
    const sharedIcon = item.sharedDocId ? `<span style="margin-left:6px; font-size:0.75rem; color:var(--accent);">🌐同期</span>` : '';
    // ★【0.03.02】クイックメモを一覧にも表示する（長いものは折りたたみ）
    // ★【0.03.04】メモの和訳（答えが英語のカードは英単語・語根）は隠し、タップで表示する
    const noteHTML = item.note ? `<div class="q-card-note" onclick="this.classList.toggle('expanded')" title="タップで全文表示">📝 ${noteToSpoilerHTML(item.note, isLatinAnswer(getPrimaryAnswer(item.answer)))}</div>` : '';
    const kindBadge = item.kind === 'test' ? '<span class="badge badge-level" style="margin-right:4px;">テスト</span>' : item.kind === 'cloze' ? '<span class="badge badge-level" style="margin-right:4px;">例文</span>' : '';
    // ★【0.02.63】問題に画像が添付されていればサムネイル表示
    const qImgHTML = item.questionImage ? `<img src="${escAttr(item.questionImage)}" alt="問題画像" style="max-width:100%; max-height:120px; border-radius:8px; margin-bottom:8px; display:block;">` : '';
    
    card.innerHTML = `
      <div class="q-card-text">${noHTML}${kindBadge}${renderRichText(item.question, { escape: true, kanbunRows: 10 })}</div>
      ${qImgHTML}
      <div style="font-size:0.85rem; color:var(--text2); margin-bottom:8px; cursor:pointer;" data-id="${escapeHtml(item.id)}" data-shown="0" onclick="toggleCardAnswer(this)">
        A: <span style="background:var(--bg4); color:var(--text2); padding:2px 8px; border-radius:6px; border:1px solid var(--border); display:inline-block; font-size:0.75rem;">👆 タップして答えを表示</span>
      </div>
      ${noteHTML}
      <div class="q-card-sub">${badgeHTML}<span>正: ${item.correct} / 誤: ${item.incorrect}</span><span style="font-size:0.75rem; color:var(--text3);">📂 ${escapeHtml(item.category)}${sharedIcon}</span></div>
    `;
    container.appendChild(card);
    // ★【0.03.00】構造式・漢文・数式を描画
    hydrateRich(card.querySelector('.q-card-text'), { chemScale: 1.1 });
  });
}

function toggleCardAnswer(el) {
  const itemId = el.getAttribute('data-id'); const cached = _boxAnswerCache[itemId] || { text: '', image: null };
  const shown = el.getAttribute('data-shown') === '1';
  el.setAttribute('data-shown', shown ? '0' : '1');
  if (shown) { el.innerHTML = 'A: <span style="background:var(--bg4); color:var(--text2); padding:2px 8px; border-radius:6px; border:1px solid var(--border); display:inline-block; font-size:0.75rem;">👆 タップして答えを表示</span>'; } 
  else {
    const imgHTML = cached.image ? `<img src="${escAttr(cached.image)}" alt="解答画像" style="max-width:100%; max-height:150px; border-radius:8px; margin-top:6px; display:block;">` : '';
    el.innerHTML = 'A: <span style="color:var(--text); font-weight:500;">' + renderRichText(cached.text, { escape: true, kanbunRows: 10 }) + '</span><span style="color:var(--text3); font-size:0.7rem; margin-left:8px;">👆 隠す</span>' + imgHTML;
    hydrateRich(el, { chemScale: 1.1 });
  }
}

function handleQuestionLongpress(itemRef) {
  // 同期でカードのオブジェクトが差し替わっていても、IDで最新のものを使う
  const cur = () => db.find(q => q.id === itemRef.id) || itemRef;
  const item = cur();
  const access = getSharedAccess(item.sharedDocId);
  if (access.shared && access.readOnly) {
    return alert("🔒 【閲覧専用】\nこのカードは購読している共有カテゴリーのため、作成者または許可された共同編集者のみ編集・削除できます。\n(あなたの学習記録はあなた専用に保存されています)");
  }

  openContextMenu("カード操作", [
    { html: '✏️ 編集（問題・答え・メモ）', action: () => { openCardModal('edit', cur()); } },
    { html: '📂 別のフォルダーへ移動', action: () => { openCardMoveDialog(cur()); } },
    { type: 'separator' },
    { html: '🗑️ 削除', danger: true, action: async () => { 
        if(!confirm("完全に消去しますか？")) return; 
        const it = cur();
        tombstoneCards([it.id]);
        db = db.filter(q => q.id !== it.id); 
        if (it.sharedDocId) await updateCardInSharedDoc(it.sharedDocId, it, 'delete');
        saveData(true); renderBox(); 
      } }
  ]);
}

// ★【0.03.02】カードの移動先をフォルダー一覧（階層つき）から選ぶ
function openCardMoveDialog(item) {
  document.getElementById('ctxHeader').innerText = '📂 移動先のフォルダー';
  const body = document.getElementById('ctxBody');
  body.innerHTML = `<div style="padding:8px;"><select id="cardMoveSelect" class="form-control">${buildCategoryOptionsHTML(new Set([item.category]), false)}</select>
    <button type="button" class="btn" style="margin-top:10px; width:100%;" id="cardMoveOk">移動する</button></div>`;
  document.getElementById('ctxOverlay').style.display = 'flex';
  document.getElementById('cardMoveOk').onclick = async () => {
    const cat = document.getElementById('cardMoveSelect').value;
    closeContextMenu();
    if (!cat) return;
    const it = db.find(q => q.id === item.id); if (!it) return;
    const dest = getCategoryShareInfo(cat);
    if (dest.shared && dest.readOnly) return alert('🔒 閲覧専用の共有カテゴリーには移動できません。');
    const oldDoc = it.sharedDocId;
    it.category = cat; delete it.no; touchCard(it); // 移動先の最後の番号の次になる
    assignCardNumbers();
    if (dest.shared && dest.docId !== oldDoc) {
      if (oldDoc) await updateCardInSharedDoc(oldDoc, it, 'delete');
      it.sharedDocId = dest.docId; await updateCardInSharedDoc(dest.docId, it, 'add');
    } else if (!dest.shared && oldDoc) {
      await updateCardInSharedDoc(oldDoc, it, 'delete'); delete it.sharedDocId;
    } else if (oldDoc) await updateCardInSharedDoc(oldDoc, it, 'edit');
    saveData(true); renderBox();
  };
}

function showAddQModal() {
  let defaultCat = "未分類";
  if (typeof currentViewContext === 'object' && currentViewContext.type === 'category') {
    defaultCat = currentViewContext.value;
  }
  
  let targetSharedDocId = null;
  const shareInfo = getCategoryShareInfo(defaultCat);
  if (shareInfo.shared) {
    if (shareInfo.readOnly) return alert("🔒 【閲覧専用】\nこの共有カテゴリーは閲覧専用のため、新しい問題を追加できません。");
    targetSharedDocId = shareInfo.docId;
  }

  openCardModal('add', { category: defaultCat, sharedDocId: targetSharedDocId });
}

// ================================================================
// ★【0.02.63】カード追加・編集モーダル（問題文・答え・画像添付に対応）
// ================================================================
let _cardModalState = { mode: 'add', item: null, category: '未分類', sharedDocId: null, qImage: null, aImage: null };

function openCardModal(mode, itemOrDefaults) {
  _cardModalState = {
    mode,
    item: mode === 'edit' ? itemOrDefaults : null,
    category: itemOrDefaults.category || '未分類',
    sharedDocId: itemOrDefaults.sharedDocId || null,
    qImage: itemOrDefaults.questionImage || null,
    aImage: itemOrDefaults.answerImage || null
  };
  document.getElementById('cardModalTitle').innerText = mode === 'edit' ? '✏️ カードを編集' : '➕ 新規カード追加';
  document.getElementById('cardModalCatLabel').innerText = `📁 追加先: ${_cardModalState.category}`;
  document.getElementById('txtCardQuestion').value = mode === 'edit' ? (itemOrDefaults.question || '') : '';
  document.getElementById('txtCardAnswer').value = mode === 'edit' ? (itemOrDefaults.answer || '') : '';
  document.getElementById('txtCardNote').value = mode === 'edit' ? (itemOrDefaults.note || '') : '';
  document.getElementById('numCardNo').value = mode === 'edit' && itemOrDefaults.no ? itemOrDefaults.no : '';
  updateCardImagePreview('question');
  updateCardImagePreview('answer');
  document.getElementById('cardModalOverlay').style.display = 'flex';
  updateCardPreview();
}

function closeCardModal() {
  document.getElementById('cardModalOverlay').style.display = 'none';
}

function updateCardImagePreview(which) {
  const isQ = which === 'question';
  const img = isQ ? _cardModalState.qImage : _cardModalState.aImage;
  const wrap = document.getElementById(isQ ? 'cardQImageWrap' : 'cardAImageWrap');
  const imgEl = document.getElementById(isQ ? 'cardQImagePreview' : 'cardAImagePreview');
  if (img) { wrap.style.display = 'block'; imgEl.src = img; } else { wrap.style.display = 'none'; imgEl.src = ''; }
}

async function handleCardImageSelect(event, which) {
  const file = event.target.files[0];
  event.target.value = ''; // 同じファイルを選び直せるようにリセット
  if (!file) return;
  try {
    const dataUrl = await compressImageToDataURL(file);
    if (which === 'question') _cardModalState.qImage = dataUrl; else _cardModalState.aImage = dataUrl;
    updateCardImagePreview(which);
  } catch (e) { alert('⚠️ 画像の読み込みに失敗しました。'); }
}

function removeCardImage(which) {
  if (which === 'question') _cardModalState.qImage = null; else _cardModalState.aImage = null;
  updateCardImagePreview(which);
}

async function submitCardModal() {
  const q = document.getElementById('txtCardQuestion').value.trim();
  const a = document.getElementById('txtCardAnswer').value.trim();
  const note = document.getElementById('txtCardNote').value.trim();
  const noVal = parseInt(document.getElementById('numCardNo').value, 10);
  const no = Number.isFinite(noVal) && noVal > 0 ? noVal : null;
  if (!q) { alert('問題文を入力してください。'); document.getElementById('txtCardQuestion').focus(); return; }
  if (!a) { alert('答えを入力してください。'); document.getElementById('txtCardAnswer').focus(); return; }

  if (_cardModalState.mode === 'edit') {
    // 同期でオブジェクトが差し替わっていても、IDで最新のカードを更新する
    const item = db.find(x => x.id === _cardModalState.item.id) || _cardModalState.item;
    item.question = q; item.answer = a;
    if (note) item.note = note; else delete item.note;
    if (no) item.no = no;
    touchCard(item);
    if (_cardModalState.qImage) item.questionImage = _cardModalState.qImage; else delete item.questionImage;
    if (_cardModalState.aImage) item.answerImage = _cardModalState.aImage; else delete item.answerImage;
    if (item.sharedDocId) await updateCardInSharedDoc(item.sharedDocId, item, 'edit');
    autoMerge(); renderBox();
  } else {
    const newCard = { id: newCardId(), question: q, answer: a, category: _cardModalState.category, level: 0, correct: 0, incorrect: 0, streak: 0, wrongStreak: 0, shikkariStreak: 0 };
    if (note) newCard.note = note;
    if (no) newCard.no = no;
    touchCard(newCard);
    if (_cardModalState.qImage) newCard.questionImage = _cardModalState.qImage;
    if (_cardModalState.aImage) newCard.answerImage = _cardModalState.aImage;
    if (_cardModalState.sharedDocId) newCard.sharedDocId = _cardModalState.sharedDocId;
    db.push(newCard);
    if (_cardModalState.sharedDocId) updateCardInSharedDoc(_cardModalState.sharedDocId, newCard, 'add');
    autoMerge(); renderBox();
  }
  closeCardModal();
}