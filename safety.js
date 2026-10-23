// ================================================================
// ★【0.03.13】復元ポイント
// 全消去・置き換え・フォルダー削除・購読解除・成績リセットなど、取り返しのつかない操作の直前に
// この端末のデータをまるごと保存しておき、設定画面から「この時点に戻す」ことができるようにする。
// 保存先は端末内の IndexedDB（ローカルストレージより大きいデータを置ける）。新しい方から一定数だけ残す。
// ================================================================
const SAFETY_DB = 'susuru_anki_safety';
const SAFETY_STORE = 'snapshots';
const SAFETY_KEEP = 8;

function safetyDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB を使えません'));
    const req = indexedDB.open(SAFETY_DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(SAFETY_STORE)) req.result.createObjectStore(SAFETY_STORE, { keyPath: 'id', autoIncrement: true }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// 今の状態を保存する（データは呼んだ瞬間のものを使うので、この後すぐ書き換えてよい）
function takeSnapshot(label) {
  let json;
  try { json = JSON.stringify(buildSyncPayload()); } catch (e) { return Promise.resolve(false); }
  const rec = { at: Date.now(), label: String(label || ''), cards: db.length, cats: categories.filter(c => c !== '未分類').length, json };
  return safetyDB().then(d => new Promise(resolve => {
    const tx = d.transaction(SAFETY_STORE, 'readwrite');
    const st = tx.objectStore(SAFETY_STORE);
    st.add(rec);
    const keysReq = st.getAllKeys();
    keysReq.onsuccess = () => {
      const keys = (keysReq.result || []).slice().sort((a, b) => a - b);
      keys.slice(0, Math.max(0, keys.length - SAFETY_KEEP)).forEach(k => st.delete(k));
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  })).catch(e => { console.warn('復元ポイントを保存できませんでした:', e); return false; });
}

function listSnapshots() {
  return safetyDB().then(d => new Promise(resolve => {
    const req = d.transaction(SAFETY_STORE, 'readonly').objectStore(SAFETY_STORE).getAll();
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => b.at - a.at));
    req.onerror = () => resolve([]);
  })).catch(() => []);
}
function getSnapshot(id) {
  return safetyDB().then(d => new Promise(resolve => {
    const req = d.transaction(SAFETY_STORE, 'readonly').objectStore(SAFETY_STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  })).catch(() => null);
}

function formatSnapshotTime(t) {
  const d = new Date(t);
  const p = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function renderSnapshotList() {
  const box = document.getElementById('snapshotList');
  if (!box) return;
  const list = await listSnapshots();
  if (!list.length) { box.innerHTML = '<div class="hint-small">まだ復元ポイントはありません（消す・置き換える操作をすると、その直前の状態が自動で保存されます）。</div>'; return; }
  box.innerHTML = list.map(s => `
    <div class="shared-doc-row" style="display:flex; align-items:center; gap:8px; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--border);">
      <div style="min-width:0;">
        <div style="font-size:0.85rem; font-weight:700; color:var(--text);">${escapeHtml(formatSnapshotTime(s.at))}　${escapeHtml(s.label)}の前</div>
        <div class="hint-small">カード ${s.cards}枚・フォルダー ${s.cats}個</div>
      </div>
      <div style="display:flex; gap:6px; flex-shrink:0;">
        <button class="btn btn-secondary" style="width:auto; padding:4px 10px; font-size:0.75rem;" onclick="downloadSnapshot(${Number(s.id)})">📤</button>
        <button class="btn btn-secondary" style="width:auto; padding:4px 10px; font-size:0.75rem;" onclick="restoreSnapshot(${Number(s.id)})">↩️ 戻す</button>
      </div>
    </div>`).join('');
}

async function downloadSnapshot(id) {
  const s = await getSnapshot(id);
  if (!s) return alert('復元ポイントが見つかりません。');
  const p = JSON.parse(s.json);
  const blob = new Blob([JSON.stringify({ app: 'susuru_anki', version: typeof APP_VERSION !== 'undefined' ? APP_VERSION : '', exportedAt: s.at, db: p.db, categories: p.categories, categoryTree: p.categoryTree, catSubjects: p.catSubjects || {} }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `susuru_anki_restore_${s.at}.json`; a.click();
}

// その時点の状態に戻す：その時点にあったカード・フォルダー・購読を戻し、カードの内容と成績もその時点のものにする。
// その後に追加したカードやフォルダーは消さずに残す（戻す操作もまた復元ポイントに保存するので、やり直せる）
async function restoreSnapshot(id) {
  const s = await getSnapshot(id);
  if (!s) return alert('復元ポイントが見つかりません。');
  if (!confirm(`${formatSnapshotTime(s.at)}（${s.label}の前）の状態に戻しますか？\n\n・その時点にあったカード・フォルダー・購読が戻ります\n・カードの内容と成績はその時点のものになります\n・その後に追加したカードやフォルダーは残ります\n（戻す前の状態も復元ポイントに保存されます）`)) return;
  let p;
  try { p = JSON.parse(s.json); } catch (e) { return alert('復元ポイントのデータが壊れています。'); }
  await takeSnapshot('復元');
  const now = Date.now();
  const cards = (p.db || []).filter(c => c && c.id).map(c => Object.assign({}, c, { updatedAt: now, statsAt: now }));
  let r = {
    db: cards, categories: p.categories || ['未分類'], categoryTree: p.categoryTree || {}, catSubjects: p.catSubjects || {},
    subscribedDocs: p.subscribedDocs || [], ownedDocs: p.ownedDocs || [],
    deletedCards: [], deletedCardsAt: {}, deletedCats: [], catStamps: {}, docStamps: {}
  };
  r = reconcileUnionState(r);
  // フォルダーの親子関係・教科タグは、戻す時点のものを優先する
  structAt = 0; r.structAt = 1;
  mergeIntoLocal(r);
  structAt = Date.now(); _structHash = structFingerprint();
  autoMerge(true);
  saveData(true);
  if (typeof refreshVisibleViews === 'function') refreshVisibleViews(true);
  if (typeof syncSubscriptions === 'function') syncSubscriptions();
  renderSnapshotList();
  alert(`↩️ 戻しました。\nカード: ${db.length}枚・フォルダー: ${categories.filter(c => c !== '未分類').length}個`);
}
