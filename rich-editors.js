// ================================================================
// ★【0.03.00】構造式エディタ・漢文エディタ・数式/化学式エディタ
// カード追加・編集モーダルのツールバーから開き、対象のテキストエリアへ
// {{構造式:…}} / {{漢文:…}} / $\ce{…}$ を挿入（または既存ブロックを置き換え）する。
// ================================================================

// 高校化学でよく出る化合物（日本語名 → SMILES）。ベンゼン環は教科書に合わせてケクレ構造で書く。
const CHEM_DICTIONARY = [
  // 脂肪族炭化水素
  ['メタン', 'C'], ['エタン', 'CC'], ['プロパン', 'CCC'], ['ブタン', 'CCCC'], ['2-メチルプロパン（イソブタン）', 'CC(C)C'],
  ['ペンタン', 'CCCCC'], ['ヘキサン', 'CCCCCC'], ['シクロヘキサン', 'C1CCCCC1'],
  ['エチレン（エテン）', 'C=C'], ['プロピレン（プロペン）', 'CC=C'], ['1-ブテン', 'C=CCC'],
  ['シス-2-ブテン', 'C/C=C\\C'], ['トランス-2-ブテン', 'C/C=C/C'], ['1,3-ブタジエン', 'C=CC=C'], ['イソプレン', 'CC(=C)C=C'],
  ['アセチレン（エチン）', 'C#C'], ['塩化ビニル', 'C=CCl'], ['酢酸ビニル', 'CC(=O)OC=C'], ['アクリロニトリル', 'C=CC#N'],
  // アルコール・エーテル・アルデヒド・ケトン
  ['メタノール', 'CO'], ['エタノール', 'CCO'], ['1-プロパノール', 'CCCO'], ['2-プロパノール', 'CC(C)O'],
  ['1-ブタノール', 'CCCCO'], ['2-ブタノール', 'CCC(C)O'], ['2-メチル-2-プロパノール', 'CC(C)(C)O'],
  ['エチレングリコール', 'OCCO'], ['グリセリン', 'OCC(O)CO'], ['ジメチルエーテル', 'COC'], ['ジエチルエーテル', 'CCOCC'],
  ['ホルムアルデヒド', 'C=O'], ['アセトアルデヒド', 'CC=O'], ['アセトン', 'CC(C)=O'],
  // カルボン酸・エステル
  ['ギ酸', 'OC=O'], ['酢酸', 'CC(=O)O'], ['プロピオン酸', 'CCC(=O)O'], ['シュウ酸', 'OC(=O)C(=O)O'], ['乳酸', 'CC(O)C(=O)O'],
  ['アクリル酸', 'C=CC(=O)O'], ['マレイン酸', 'OC(=O)/C=C\\C(=O)O'], ['フマル酸', 'OC(=O)/C=C/C(=O)O'], ['無水マレイン酸', 'O=C1OC(=O)C=C1'],
  ['アジピン酸', 'OC(=O)CCCCC(=O)O'], ['無水酢酸', 'CC(=O)OC(C)=O'], ['酢酸エチル', 'CCOC(C)=O'], ['メタクリル酸メチル', 'C=C(C)C(=O)OC'],
  ['ステアリン酸', 'CCCCCCCCCCCCCCCCCC(=O)O'], ['オレイン酸', 'CCCCCCCC/C=C\\CCCCCCCC(=O)O'],
  // 窒素化合物・アミノ酸
  ['尿素', 'NC(N)=O'], ['ヘキサメチレンジアミン', 'NCCCCCCN'], ['ε-カプロラクタム', 'O=C1CCCCCN1'],
  ['グリシン', 'NCC(=O)O'], ['アラニン', 'CC(N)C(=O)O'], ['セリン', 'OCC(N)C(=O)O'], ['システイン', 'SCC(N)C(=O)O'],
  ['フェニルアラニン', 'NC(CC1=CC=CC=C1)C(=O)O'], ['チロシン', 'NC(CC1=CC=C(O)C=C1)C(=O)O'],
  ['グルタミン酸', 'NC(CCC(=O)O)C(=O)O'], ['リシン', 'NCCCCC(N)C(=O)O'],
  // 糖
  ['グルコース（環状）', 'OCC1OC(O)C(O)C(O)C1O'], ['フルクトース（五員環）', 'OCC1OC(O)(CO)C(O)C1O'],
  // 芳香族
  ['ベンゼン', 'C1=CC=CC=C1'], ['トルエン', 'CC1=CC=CC=C1'], ['o-キシレン', 'CC1=CC=CC=C1C'], ['m-キシレン', 'CC1=CC(C)=CC=C1'],
  ['p-キシレン', 'CC1=CC=C(C)C=C1'], ['エチルベンゼン', 'CCC1=CC=CC=C1'], ['スチレン', 'C=CC1=CC=CC=C1'], ['クメン', 'CC(C)C1=CC=CC=C1'],
  ['ナフタレン', 'C1=CC=C2C=CC=CC2=C1'], ['アントラセン', 'C1=CC=C2C=C3C=CC=CC3=CC2=C1'],
  ['フェノール', 'OC1=CC=CC=C1'], ['o-クレゾール', 'CC1=CC=CC=C1O'], ['m-クレゾール', 'CC1=CC(O)=CC=C1'], ['p-クレゾール', 'CC1=CC=C(O)C=C1'],
  ['ナトリウムフェノキシド', '[O-]C1=CC=CC=C1.[Na+]'], ['ベンジルアルコール', 'OCC1=CC=CC=C1'], ['ベンズアルデヒド', 'O=CC1=CC=CC=C1'],
  ['アセトフェノン', 'CC(=O)C1=CC=CC=C1'], ['安息香酸', 'OC(=O)C1=CC=CC=C1'], ['フタル酸', 'OC(=O)C1=CC=CC=C1C(=O)O'],
  ['イソフタル酸', 'OC(=O)C1=CC(=CC=C1)C(=O)O'], ['テレフタル酸', 'OC(=O)C1=CC=C(C=C1)C(=O)O'], ['無水フタル酸', 'O=C1OC(=O)C2=CC=CC=C12'],
  ['サリチル酸', 'OC(=O)C1=CC=CC=C1O'], ['アセチルサリチル酸', 'CC(=O)OC1=CC=CC=C1C(=O)O'], ['サリチル酸メチル', 'COC(=O)C1=CC=CC=C1O'],
  ['クロロベンゼン', 'ClC1=CC=CC=C1'], ['ベンゼンスルホン酸', 'OS(=O)(=O)C1=CC=CC=C1'], ['ニトロベンゼン', 'O=N(=O)C1=CC=CC=C1'],
  ['2,4,6-トリニトロトルエン（TNT）', 'CC1=C(C=C(C=C1N(=O)=O)N(=O)=O)N(=O)=O'], ['ピクリン酸', 'OC1=C(C=C(C=C1N(=O)=O)N(=O)=O)N(=O)=O'],
  ['アニリン', 'NC1=CC=CC=C1'], ['アニリン塩酸塩', '[Cl-].[NH3+]C1=CC=CC=C1'], ['アセトアニリド', 'CC(=O)NC1=CC=CC=C1'],
  ['塩化ベンゼンジアゾニウム', '[Cl-].N#[N+]C1=CC=CC=C1'], ['アゾベンゼン', 'C1=CC=C(C=C1)N=NC1=CC=CC=C1'],
  ['p-ヒドロキシアゾベンゼン', 'OC1=CC=C(C=C1)N=NC1=CC=CC=C1'],
  // ★【0.03.08】官能基・結合（* は結合の腕。線だけが残る）
  ['カルボキシ基 −COOH', '*C(=O)O'], ['ヒドロキシ基 −OH', '*O'], ['ホルミル基（アルデヒド基） −CHO', '*C=O'], ['カルボニル基（ケトン基） >C=O', '*C(*)=O'],
  ['アミノ基 −NH2', '*N'], ['ニトロ基 −NO2', '*N(=O)=O'], ['スルホ基 −SO3H', '*S(=O)(=O)O'], ['メチル基 −CH3', '*C'], ['エチル基 −C2H5', '*CC'],
  ['ビニル基 −CH=CH2', '*C=C'], ['フェニル基 −C6H5', '*C1=CC=CC=C1'], ['ベンジル基 −CH2−C6H5', '*CC1=CC=CC=C1'], ['アセチル基 −COCH3', '*C(C)=O'],
  ['エステル結合 −COO−', '*C(=O)O*'], ['アミド結合 −CONH−', '*C(=O)N*'], ['エーテル結合 −O−', '*O*'], ['アゾ基 −N=N−', '*N=N*']
];

// 構造の部品（SMILES断片）。カーソル位置に挿入される。
const CHEM_FRAGMENTS = [
  ['ベンゼン環', 'C1=CC=CC=C1'], ['-OH', 'O'], ['-COOH', 'C(=O)O'], ['-CHO', 'C=O'], ['-NH2', 'N'], ['-NO2', 'N(=O)=O'],
  ['-SO3H', 'S(=O)(=O)O'], ['-Cl', 'Cl'], ['-Br', 'Br'], ['-CH3', 'C'], ['エステル', 'C(=O)O'], ['二重結合 =', '='], ['三重結合 #', '#'],
  ['枝 ( )', '()'], ['環を閉じる 1', '1'], ['結合の腕 *', '*'],
  // ★【0.04.34】空欄・記号・複数の構造式
  ['空欄 □', '□'], ['記号 [R]', '[R]'], ['記号 [X]', '[X]'], ['→ 反応の矢印', ' → '], ['＋ 足す', ' + '], ['｜ 並べる', ' | ']
];

let _richEditorTarget = null; // 挿入先のテキストエリア
let _richEditorRange = null;  // 置き換え対象ブロックの [start, end]（新規挿入時は null）

// テキストエリア内で、カーソル位置にある指定種類のブロックを探す
function findRichBlockAtCursor(textarea, wantType) {
  const text = textarea.value;
  const cursor = textarea.selectionStart != null ? textarea.selectionStart : 0;
  const re = new RegExp(RICH_BLOCK_RE.source, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    if (richBlockType(m[1]) !== wantType) continue;
    const hit = { start: m.index, end: m.index + m[0].length, body: m[2] };
    // ★【0.03.08】カーソルがブロックの中にある時だけ「編集」。外なら新しく追加（1つの問題に複数の構造式を置ける）
    if (cursor > hit.start && cursor < hit.end) return hit;
  }
  return null;
}

function replaceRangeInTextarea(textarea, range, insertText) {
  if (range) {
    textarea.value = textarea.value.slice(0, range[0]) + insertText + textarea.value.slice(range[1]);
    const pos = range[0] + insertText.length;
    textarea.focus();
    if (textarea.setSelectionRange) textarea.setSelectionRange(pos, pos);
  } else {
    insertAtCursor(textarea, insertText);
  }
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function openRichOverlay(id) { const el = document.getElementById(id); if (el) el.style.display = 'flex'; }
function closeRichOverlay(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }

// ----------------------------------------------------------------
// 構造式エディタ
// ----------------------------------------------------------------
let _chemPreviewTimer = null;
let _chemPreviewOk = false;

function openChemEditor(textareaId) {
  _richEditorTarget = document.getElementById(textareaId);
  if (!_richEditorTarget) return;
  const hit = findRichBlockAtCursor(_richEditorTarget, 'chem');
  _richEditorRange = hit ? [hit.start, hit.end] : null;
  document.getElementById('txtChemSmiles').value = hit ? hit.body.trim() : '';
  document.getElementById('txtChemSearch').value = '';
  document.getElementById('chemEditorTitle').innerText = hit ? '🧪 構造式を編集' : '🧪 構造式を挿入';
  const addBtn = document.getElementById('btnChemAddNew'); if (addBtn) addBtn.style.display = hit ? '' : 'none';
  document.getElementById('chemSearchStatus').innerText = '';
  renderChemSearchResults('');
  renderChemFragmentChips();
  openRichOverlay('chemEditorOverlay');
  updateChemPreview();
  ensureSmilesDrawer().catch(() => {});
}

function closeChemEditor() { closeRichOverlay('chemEditorOverlay'); }

function renderChemFragmentChips() {
  const row = document.getElementById('chemFragmentChips');
  if (!row || row.childElementCount) return;
  CHEM_FRAGMENTS.forEach(([label, frag]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.innerText = label;
    b.onclick = () => {
      const input = document.getElementById('txtChemSmiles');
      insertAtCursor(input, frag);
      if (frag === '()' && input.setSelectionRange) { const p = input.selectionStart - 1; input.setSelectionRange(p, p); }
      updateChemPreview();
    };
    row.appendChild(b);
  });
}

function normalizeChemQuery(s) {
  return toKatakana(String(s || '').toLowerCase()).replace(/[\s　・\-（）()]/g, '');
}

function chemResultChip(label, smiles, title) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'chip chip-strong'; b.innerText = label;
  if (title) b.title = title;
  b.onclick = () => chemUseSmiles(smiles);
  return b;
}

// ★【0.04.34】選んだ構造：「足していく」がオンで、もう構造式があれば「 | 」で並べる（複数の構造式）
function chemUseSmiles(smiles) {
  const el = document.getElementById('txtChemSmiles'), add = document.getElementById('chkChemAppend');
  el.value = add && add.checked && el.value.trim() ? `${el.value.trim()} | ${smiles}` : smiles;
  updateChemPreview();
}
function renderChemSearchResults(query) {
  const box = document.getElementById('chemSearchResults');
  if (!box) return;
  const raw = String(query || '').trim();
  const q = normalizeChemQuery(raw);
  box.innerHTML = '';
  const st = document.getElementById('chemSearchStatus'); if (st) st.innerText = '';
  if (!q) {
    box.innerHTML = '<div class="hint-small">化合物名（日本語・英語）、分子式（C2H6O）、示性式（CH3COOH）で探せます。「−COOH」などの官能基も選べます。</div>';
    return;
  }
  // ★【0.03.08】分子式・示性式なら、分子式が同じものを並べる
  const counts = parseChemFormula(raw);
  if (counts) {
    const f = hillFormula(counts);
    const hits = findDictionaryByFormula(counts);
    const head = document.createElement('div'); head.className = 'hint-small'; head.style.width = '100%';
    head.innerText = hits.length ? `分子式 ${f} の化合物（収録分）：「🌐 ネット検索」でほかの異性体も探せます` : `分子式 ${f}：収録辞書にはありません。「🌐 ネット検索」で探せます`;
    box.appendChild(head);
    hits.forEach(e => box.appendChild(chemResultChip(e.name, e.smiles)));
    return;
  }
  const hits = CHEM_DICTIONARY.filter(([name]) => normalizeChemQuery(name).includes(q));
  if (hits.length === 0) {
    box.innerHTML = '<div class="hint-small">収録辞書に見つかりません。「🌐 ネット検索」で日本語名・英語名から探せます。</div>';
    return;
  }
  hits.slice(0, 30).forEach(([name, smiles]) => box.appendChild(chemResultChip(name, smiles)));
}

// ★【0.03.08】ネット検索：分子式 → PubChem、日本語名 → Wikidata（だめなら英語名に直して PubChem）、英語名 → PubChem
async function searchChemOnline() {
  const q = document.getElementById('txtChemSearch').value.trim();
  const status = document.getElementById('chemSearchStatus');
  const box = document.getElementById('chemSearchResults');
  if (!q) { status.innerText = '検索する名前か分子式を入力してください。'; return; }
  const counts = parseChemFormula(q);
  try {
    if (counts) {
      const f = hillFormula(counts);
      status.innerText = `🌐 分子式 ${f} を PubChem で検索中...`;
      const list = await pubchemByFormula(f, 12);
      if (!list.length) throw new Error('none');
      renderChemSearchResults(q);
      const head = document.createElement('div'); head.className = 'hint-small'; head.style.width = '100%';
      head.innerText = `🌐 PubChem の候補（英語名）：`;
      box.appendChild(head);
      list.forEach(r => box.appendChild(chemResultChip(r.title, r.smiles, 'PubChem CID: ' + r.cid)));
      status.innerText = `✅ 分子式 ${f} の候補が ${list.length} 件見つかりました。タップするとプレビューに出ます`;
      return;
    }
    if (/[ぁ-んァ-ヶ一-龠]/.test(q)) {
      status.innerText = '🌐 日本語名で検索中...';
      const r = await lookupJapaneseChemName(q);
      chemUseSmiles(r.smiles);
      status.innerText = `✅ 「${r.title}」が見つかりました（${r.source}${r.cid ? ' CID: ' + r.cid : ''}）。プレビューで確認してください`;
      updateChemPreview();
      return;
    }
    status.innerText = '🌐 PubChemで検索中...';
    const r = await pubchemByName(q);
    chemUseSmiles(r.smiles);
    status.innerText = `✅ 「${r.title}」が見つかりました（PubChem CID: ${r.cid}）`;
    updateChemPreview();
  } catch (e) {
    // ★【0.04.34】見つからなければ AI に SMILES で描いてもらう
    if (typeof aiAvailable === 'function' && aiAvailable()) return chemAiDraw(q, true);
    status.innerText = counts ? '⚠️ その分子式の化合物が見つかりませんでした。'
      : '⚠️ 見つかりませんでした。別の名前（慣用名・英語名）や分子式で試してください（設定 → 🤖 AI でキーを入れると、見つからないものは AI が描きます）。';
  }
}
// ★【0.04.34】AI に SMILES で描いてもらう（見つからない化合物・官能基・部分構造・反応式も）
async function chemAiDraw(q, afterSearch) {
  q = String(q || document.getElementById('txtChemSearch').value || '').trim();
  const status = document.getElementById('chemSearchStatus');
  if (!q) { status.innerText = '描きたいもの（化合物名・官能基・説明）を上の欄に入れてください。'; return; }
  if (typeof aiAvailable !== 'function' || !aiAvailable()) { status.innerText = '⚠️ AI のキーが設定されていません（設定 → 🤖 AI）。'; return; }
  status.innerText = `${afterSearch ? 'ネットでは見つからなかったので、' : ''}🤖 AI が構造式を考えています…`;
  const t0 = Date.now();
  try {
    const txt = await aiRequest('あなたは高校化学の先生です。指示どおりに、JSONだけを出力します。', [{ text:
      `「${q}」の構造式を SMILES で書いてください。\n決まり：\n・高校化学の教科書の書き方。ベンゼン環はケクレ構造（C1=CC=CC=C1 のように二重結合を書く。小文字の芳香族表記は使わない）\n・官能基・置換基・結合など、何も付いていない結合の腕は * （例：カルボキシ基 *C(=O)O、エステル結合 *C(=O)O*）\n・R・R'・X などの記号は [R] [R'] [X] のように角かっこで\n・空欄にする所は □\n・反応式なら、物質を「 + 」、左辺と右辺を「 → 」で区切る（前後に空白）\n・いくつかの物質を並べるなら「 | 」で区切る\n・分からない・化合物でないときは smiles を空に\nJSONだけ：{"smiles":"…","name":"日本語の名前","note":"一言（構造の説明）"}` }],
      { json: true, maxTokens: 600, timeout: 20000, totalTimeout: 40000 });
    const r = parseAiJson(txt) || {};
    const sm = String(r.smiles || '').trim();
    if (!sm) { status.innerText = `⚠️ AI にも分かりませんでした${r.note ? '（' + r.note + '）' : ''}。名前を変えて試すか、SMILES を直接書いてください。`; return; }
    chemUseSmiles(sm);
    status.innerHTML = `🤖 AI が描きました：${escapeHtml(r.name || q)}${r.note ? `（${escapeHtml(r.note)}）` : ''}。<b>正しいか、プレビューで必ず確かめてください。</b> ${typeof aiModelTag === 'function' ? aiModelTag(aiModelSince(t0)) : ''}`;
  } catch (e) { status.innerText = '⚠️ AI に頼めませんでした：' + (e.message || e); }
}
// 以前の名前でも呼べるように
const searchChemOnPubChem = searchChemOnline;

function scheduleChemPreview() {
  clearTimeout(_chemPreviewTimer);
  _chemPreviewTimer = setTimeout(updateChemPreview, 250);
}

function updateChemPreview() {
  const box = document.getElementById('chemPreview');
  const smiles = document.getElementById('txtChemSmiles').value.trim();
  _chemPreviewOk = false;
  if (!smiles) { box.innerHTML = '<div class="hint-small">ここにプレビューが表示されます</div>'; return; }
  // ★【0.04.34】「 → 」「 + 」「 | 」で区切った複数の構造式は、並べて描く
  const parts = chemSplitParts(smiles);
  box.innerHTML = '';
  const wrap = document.createElement('div'); wrap.className = 'chem-multi'; box.appendChild(wrap);
  const jobs = parts.map(p => {
    if (p.smiles === undefined) { const o = document.createElement('span'); o.className = 'chem-op'; o.textContent = p.op; wrap.appendChild(o); return Promise.resolve(true); }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); wrap.appendChild(svg);
    return drawSmilesInto(svg, p.smiles, parts.length > 1 ? 1.1 : 1.5);
  });
  Promise.all(jobs).then(res => {
    if (document.getElementById('txtChemSmiles').value.trim() !== smiles) return; // 入力が進んでいたら無視
    _chemPreviewOk = res.every(Boolean);
    if (!_chemPreviewOk) box.insertAdjacentHTML('beforeend', '<div class="chem-err">⚠️ この書き方では描けない構造式があります。カッコや環の番号の対応を確認してください。</div>');
  }).catch(() => { box.innerHTML = '<div class="chem-err">⚠️ 構造式ライブラリを読み込めません（通信状況を確認してください）</div>'; });
}

function submitChemEditor(asNew) {
  const smiles = document.getElementById('txtChemSmiles').value.trim();
  if (!smiles) { alert('構造（SMILES）を入力するか、化合物名から選んでください。'); return; }
  if (!_chemPreviewOk && !confirm('プレビューで構造式を描けていません。このまま挿入しますか？')) return;
  // 「別に追加」は、編集していた構造式のすぐ後ろに新しく置く
  const range = asNew ? (_richEditorRange ? [_richEditorRange[1], _richEditorRange[1]] : null) : _richEditorRange;
  replaceRangeInTextarea(_richEditorTarget, range, (asNew && _richEditorRange ? ' ' : '') + `{{構造式:${smiles}}}`);
  closeChemEditor();
}

// ----------------------------------------------------------------
// 漢文エディタ
// ----------------------------------------------------------------
let _kbUnits = [];
let _kbSel = -1;

function openKanbunEditor(textareaId) {
  _richEditorTarget = document.getElementById(textareaId);
  if (!_richEditorTarget) return;
  const hit = findRichBlockAtCursor(_richEditorTarget, 'kanbun');
  _richEditorRange = hit ? [hit.start, hit.end] : null;
  _kbUnits = hit ? parseKanbun(hit.body) : [];
  _kbSel = _kbUnits.length ? 0 : -1;
  _kbNumMode = false; _kbSame = false; _kbHist = []; kbOrdFromMarks(); // ★【0.04.33】読む順の番号
  document.getElementById('txtKanbunPlain').value = _kbUnits.map(u => u.ch).join('');
  document.getElementById('kanbunEditorTitle').innerText = hit ? '📜 漢文を編集' : '📜 漢文を挿入';
  // 問題文から開いた場合だけ「書き下し文を答えに入れる」を出す
  document.getElementById('kanbunToAnswerRow').style.display = textareaId === 'txtCardQuestion' ? 'flex' : 'none';
  renderKanbunKaeriButtons();
  renderKanbunEditor();
  openRichOverlay('kanbunEditorOverlay');
}

function closeKanbunEditor() { closeRichOverlay('kanbunEditorOverlay'); }

// 白文の入力が変わったら、文字単位で注記を引き継いで並べ直す（同じ字が同じ位置にあれば注記を残す）
function onKanbunPlainInput() {
  const chars = Array.from(document.getElementById('txtKanbunPlain').value.replace(/\s/g, ''));
  const old = _kbUnits;
  _kbUnits = chars.map((ch, i) => (old[i] && old[i].ch === ch) ? old[i] : { ch, re: false, mark: null, okuri: '', furi: '', oki: false, kana: false, ord: [] });
  if (_kbSel >= _kbUnits.length) _kbSel = _kbUnits.length - 1;
  if (_kbSel < 0 && _kbUnits.length) _kbSel = 0;
  renderKanbunEditor();
}

function renderKanbunKaeriButtons() {
  const row = document.getElementById('kanbunKaeriButtons');
  if (!row || row.childElementCount) return;
  const none = document.createElement('button');
  none.type = 'button'; none.className = 'chip'; none.dataset.kaeri = ''; none.innerText = 'なし';
  none.onclick = () => setKanbunKaeri('');
  row.appendChild(none);
  KAERI_BUTTONS.forEach(k => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip chip-kaeri'; b.dataset.kaeri = k; b.innerText = k;
    b.onclick = () => setKanbunKaeri(k);
    row.appendChild(b);
  });
}

function selectKanbunUnit(i) {
  _kbSel = i;
  renderKanbunEditor();
}

function moveKanbunSel(delta) {
  if (!_kbUnits.length) return;
  _kbSel = Math.max(0, Math.min(_kbUnits.length - 1, _kbSel + delta));
  renderKanbunEditor();
}

function setKanbunKaeri(tok) {
  const u = _kbUnits[_kbSel]; if (!u) return;
  const k = tok ? parseKaeriToken(tok) : null;
  u.re = k ? k.re : false; u.mark = k ? k.mark : null;
  renderKanbunEditor();
}

function onKanbunFieldInput(field) {
  const u = _kbUnits[_kbSel]; if (!u) return;
  if (field === 'okuri') {
    // スマホのかな入力でもカタカナの送り仮名になるよう自動変換
    const el = document.getElementById('txtKanbunOkuri');
    u.okuri = toKatakana(el.value.trim());
  } else if (field === 'furi') {
    u.furi = document.getElementById('txtKanbunFuri').value.trim();
  } else if (field === 'oki') {
    u.oki = document.getElementById('chkKanbunOki').checked;
  } else if (field === 'kana') {
    u.kana = document.getElementById('chkKanbunKana').checked;
  } else if (field === 'hy') {
    u.hy = document.getElementById('chkKanbunHy').checked;
  } else if (field === 'sai') {
    u.sai = document.getElementById('txtKanbunSai').value.trim();
  }
  renderKanbunEditor(true);
}

function renderKanbunEditor(keepFields) {
  // 文字タイル
  const tiles = document.getElementById('kanbunTiles');
  tiles.innerHTML = '';
  if (!_kbUnits.length) tiles.innerHTML = '<div class="hint-small">上の欄に白文（漢字だけの文）を入力すると、ここに1文字ずつ並びます。</div>';
  _kbUnits.forEach((u, i) => {
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'kb-tile' + (i === _kbSel && !_kbNumMode ? ' active' : '') + (u.oki ? ' oki' : '') + (_kbNumMode ? ' numbering' : '');
    const k = kaeriLabel(u) + (u.hy ? '-' : '');
    const ord = (u.ord || []).join('・');
    t.innerHTML = `<span class="kb-tile-ch">${escapeHtml(u.ch)}</span>` +
      (u.okuri ? `<span class="kb-tile-okuri">${escapeHtml(u.okuri)}</span>` : '') +
      (k ? `<span class="kb-tile-kaeri">${escapeHtml(k)}</span>` : '') +
      (u.furi ? `<span class="kb-tile-furi">${escapeHtml(u.furi)}</span>` : '') +
      (ord ? `<span class="kb-tile-ord">${escapeHtml(ord)}</span>` : '');
    t.onclick = () => (_kbNumMode ? kbTap(i) : selectKanbunUnit(i));
    tiles.appendChild(t);
  });

  // ★【0.04.33】読む順の番号のボタン
  const nb = document.getElementById('kbNumBar');
  if (nb) nb.innerHTML = `<button type="button" class="chip${_kbNumMode ? ' active' : ''}" onclick="kbToggleNumMode()">🔢 読む順にタップ${_kbNumMode ? '（オン）' : ''}</button>` +
    (_kbNumMode ? `<button type="button" class="chip${_kbSame ? ' active' : ''}" onclick="kbArmSame()">＝ 次も同じ番号（熟語）</button><button type="button" class="chip" onclick="kbUndo()">↩ 1つ戻す</button>` : '') +
    `<button type="button" class="chip" onclick="kbClearNums()">🗑 番号を消す</button><button type="button" class="chip" onclick="kbApplyKaeri(false)">✨ 返り点を付ける</button>`;
  const nh = document.getElementById('kbNumHint');
  if (nh) nh.textContent = _kbNumMode ? (_kbSame ? '熟語の次の字をタップ（前と同じ番号になります）' : `次は ${kbNextNumber()} 番。読む順に字をタップ（置き字はタップしない）`) : '';

  // 選択中の字の注記パネル
  const panel = document.getElementById('kanbunUnitPanel');
  const u = _kbNumMode ? null : _kbUnits[_kbSel];
  panel.style.display = u ? 'block' : 'none';
  if (u) {
    document.getElementById('kanbunSelChar').innerText = u.ch;
    const cur = kaeriLabel(u);
    document.querySelectorAll('#kanbunKaeriButtons .chip').forEach(b => b.classList.toggle('active', b.dataset.kaeri === cur));
    if (!keepFields) {
      document.getElementById('txtKanbunOkuri').value = u.okuri || '';
      document.getElementById('txtKanbunFuri').value = u.furi || '';
      document.getElementById('chkKanbunOki').checked = !!u.oki;
      document.getElementById('chkKanbunKana').checked = !!u.kana;
      document.getElementById('chkKanbunHy').checked = !!u.hy;
      document.getElementById('txtKanbunSai').value = u.sai || '';
    }
  }

  // 縦書きプレビュー・書き下し文
  const pv = document.getElementById('kanbunPreview');
  pv.innerHTML = _kbUnits.length ? renderKanbunHTML(_kbUnits, { maxRows: 9 }) : '<div class="hint-small">プレビュー</div>';
  document.getElementById('kanbunKakikudashi').innerText = _kbUnits.length ? kanbunToKakikudashi(_kbUnits) : '';
}

function submitKanbunEditor() {
  if (!_kbUnits.length) { alert('白文を入力してください。'); return; }
  replaceRangeInTextarea(_richEditorTarget, _richEditorRange, `{{漢文:${serializeKanbun(_kbUnits)}}}`);
  if (document.getElementById('chkKanbunToAnswer').checked && _richEditorTarget.id === 'txtCardQuestion') {
    const ans = document.getElementById('txtCardAnswer');
    if (ans && (!ans.value.trim() || confirm('答え欄を書き下し文で上書きしますか？'))) {
      ans.value = kanbunToKakikudashi(_kbUnits);
      ans.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  closeKanbunEditor();
}

// ----------------------------------------------------------------
// 数式・化学反応式エディタ（KaTeX / mhchem の \ce{}）
// ----------------------------------------------------------------
const FORMULA_SAMPLES = [
  ['水', 'H2O', 'ce'], ['硫酸', 'H2SO4', 'ce'], ['燃焼', 'CH4 + 2O2 -> CO2 + 2H2O', 'ce'], ['平衡', 'N2 + 3H2 <=> 2NH3', 'ce'],
  ['イオン', 'Cu^2+ + 2e- -> Cu', 'ce'], ['沈殿', 'Ag+ + Cl- -> AgCl v', 'ce'], ['気体発生', 'Zn + 2HCl -> ZnCl2 + H2 ^', 'ce'],
  ['分数', '\\frac{a}{b}', 'math'], ['平方根', '\\sqrt{x}', 'math'], ['べき乗', 'x^{2}', 'math'], ['添字', 'a_{n}', 'math']
];

function openFormulaEditor(textareaId) {
  _richEditorTarget = document.getElementById(textareaId);
  if (!_richEditorTarget) return;
  _richEditorRange = null;
  document.getElementById('txtFormulaInput').value = '';
  document.querySelector('input[name="formulaKind"][value="ce"]').checked = true;
  const row = document.getElementById('formulaSampleChips');
  if (!row.childElementCount) {
    FORMULA_SAMPLES.forEach(([label, src, kind]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.innerText = label;
      b.onclick = () => {
        document.querySelector(`input[name="formulaKind"][value="${kind}"]`).checked = true;
        document.getElementById('txtFormulaInput').value = src;
        updateFormulaPreview();
      };
      row.appendChild(b);
    });
  }
  updateFormulaPreview();
  openRichOverlay('formulaEditorOverlay');
}

function closeFormulaEditor() { closeRichOverlay('formulaEditorOverlay'); }

function buildFormulaMarkup() {
  const src = document.getElementById('txtFormulaInput').value.trim();
  if (!src) return '';
  const kind = (document.querySelector('input[name="formulaKind"]:checked') || {}).value;
  return kind === 'ce' ? `$\\ce{${src}}$` : `$${src}$`;
}

function updateFormulaPreview() {
  const box = document.getElementById('formulaPreview');
  const markup = buildFormulaMarkup();
  if (!markup) { box.innerHTML = '<div class="hint-small">ここにプレビューが表示されます</div>'; return; }
  box.textContent = markup;
  hydrateRich(box);
}

function submitFormulaEditor() {
  const markup = buildFormulaMarkup();
  if (!markup) { alert('式を入力してください。'); return; }
  replaceRangeInTextarea(_richEditorTarget, null, markup);
  closeFormulaEditor();
}

// ----------------------------------------------------------------
// カード追加・編集モーダルのライブプレビュー
// ----------------------------------------------------------------
let _cardPreviewTimer = null;
function scheduleCardPreview() {
  clearTimeout(_cardPreviewTimer);
  _cardPreviewTimer = setTimeout(updateCardPreview, 300);
}

function updateCardPreview() {
  const wrap = document.getElementById('cardPreviewWrap');
  if (!wrap) return;
  const q = document.getElementById('txtCardQuestion').value;
  const a = document.getElementById('txtCardAnswer').value;
  // 構造式・漢文・数式を含むときだけプレビューを出す（普通のカードでは邪魔にならないように）
  const needs = (s) => hasRichBlock(s) || /\$[^$]+\$/.test(s);
  if (!needs(q) && !needs(a)) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  setRichContent(document.getElementById('cardPreviewQ'), q || '（問題文なし）', { escape: true, chemScale: 1.1, kanbunRows: 9 });
  setRichContent(document.getElementById('cardPreviewA'), a || '（答えなし）', { escape: true, chemScale: 1.1, kanbunRows: 9 });
}

// ================================================================
// ★【0.04.33】読む順に番号を振って、返り点を自動で付ける
// ・「🔢 読む順にタップ」をオンにして、字を読む順にタップすると 1, 2, 3… と番号が付く
// ・熟語（所以 など、まとめて読む字）は「＝ 次も同じ番号」を押してからタップ（同じ番号になる）
// ・同じ字をもう一度タップすると、再読文字（未・将・当…：その場で1回目、返ってきて2回目を読む）
// ・番号が全部付いたら（または「✨ 返り点を付ける」で）、返り点（レ・一二・上下・甲乙・天地）・竪点（熟語の -）を付ける
//   句形の A・B などのアルファベットは熟語が入るものとして、レ点ではなく一二点（以上）で返る
// ・番号を付けなかった字（句読点以外）は置き字にする
// ================================================================
let _kbNumMode = false, _kbSame = false, _kbHist = [];
const KB_PUNCT_RE = /[、。，．・：；！？「」『』（）()〔〕［］\s]/;
const KB_LETTER_RE = /[A-Za-zＡ-Ｚａ-ｚ]/;
// 再読文字の読み（1回目：ふりがな・送り仮名 ／ 2回目）
const KB_SAI = { '未': ['いま', 'ダ', 'ず'], '将': ['まさ', 'ニ', 'す'], '且': ['まさ', 'ニ', 'す'], '当': ['まさ', 'ニ', 'べし'], '応': ['まさ', 'ニ', 'べし'], '宜': ['よろ', 'シク', 'べし'], '須': ['すべか', 'ラク', 'べし'], '猶': ['な', 'ホ', 'ごとし'], '由': ['な', 'ホ', 'ごとし'], '盍': ['なん', 'ゾ', 'ざる'] };
const kbCountable = u => !KB_PUNCT_RE.test(u.ch);
// 返り点から番号を作る（編集を開いたとき）
function kbOrdFromMarks() {
  _kbUnits.forEach(u => { u.ord = []; });
  if (!_kbUnits.length || !_kbUnits.some(u => u.mark || u.re)) return; // 返り点が無ければ番号は付けない（タップで付ける）
  const B = kanbunBlocks(_kbUnits), blockOf = {}; B.forEach((b, k) => b.forEach(i => { blockOf[i] = k; }));
  let n = 0, lastBlock = -1;
  const seen = new Set();
  kanbunReadingOrder(_kbUnits).forEach(i => {
    const u = _kbUnits[i];
    if (!kbCountable(u) || u.oki) { lastBlock = -1; return; }
    const again = seen.has(i); seen.add(i);
    if (!again && blockOf[i] === lastBlock) { u.ord.push(n); return; }
    n++; u.ord.push(n); lastBlock = blockOf[i];
  });
}
function kbToggleNumMode() {
  _kbNumMode = !_kbNumMode; _kbSame = false;
  renderKanbunEditor();
}
function kbNextNumber() { return Math.max(0, ..._kbUnits.flatMap(u => u.ord || [])) + 1; }
function kbTap(i) {
  const u = _kbUnits[i]; if (!u || !kbCountable(u)) return;
  u.ord = u.ord || [];
  if (_kbSame) {
    const last = _kbHist[_kbHist.length - 1];
    const n = last !== undefined ? _kbUnits[last].ord[_kbUnits[last].ord.length - 1] : kbNextNumber();
    if (u.ord.length) return;
    u.ord.push(n);
  } else if (u.ord.length === 1) {
    if (!confirm(`「${u.ch}」にもう1つ番号を付けて、再読文字（2回読む字）にしますか？`)) return;
    u.ord.push(kbNextNumber());
  } else if (u.ord.length >= 2) return;
  else u.ord.push(kbNextNumber());
  _kbHist.push(i); _kbSame = false;
  // 全部の字に番号が付いたら、返り点を付ける
  if (_kbUnits.every(x => !kbCountable(x) || (x.ord && x.ord.length))) kbApplyKaeri(true);
  else renderKanbunEditor();
}
function kbUndo() {
  const i = _kbHist.pop(); if (i === undefined) return;
  const u = _kbUnits[i]; if (u && u.ord) u.ord.pop();
  renderKanbunEditor();
}
function kbClearNums() {
  _kbUnits.forEach(u => { u.ord = []; }); _kbHist = []; _kbSame = false;
  renderKanbunEditor();
}
function kbArmSame() { if (!_kbHist.length) return alert('先に、熟語の1字目をタップしてください。'); _kbSame = !_kbSame; renderKanbunEditor(); }

// 番号から返り点を作る。{ ok, msg }
function kbAutoKaeri(U) {
  U.forEach(u => {
    if (!kbCountable(u)) return;
    u.oki = !(u.ord && u.ord.length);
    u.re = false; u.mark = null; u.hy = false;
    if (!(u.ord && u.ord.length === 2)) u.sai = '';
  });
  // まとまり：続いている同じ番号の字（熟語）。再読文字は1字で1つ
  const bl = [];
  U.forEach((u, i) => {
    if (!u.ord || !u.ord.length) return;
    const sai = u.ord.length === 2, last = bl[bl.length - 1];
    if (last && !sai && !last.sai && last.end === i - 1 && last.rank === u.ord[0]) { last.end = i; last.jk = true; return; }
    bl.push({ start: i, end: i, rank: u.ord[u.ord.length - 1], sai, jk: KB_LETTER_RE.test(u.ch) });
  });
  const ranks = bl.map(b => b.rank);
  if (new Set(ranks).size !== ranks.length) return { ok: false, msg: '同じ番号は、続いている字（熟語）にだけ付けてください。' };
  const seq = bl.slice().sort((a, b) => a.rank - b.rank), segs = [];
  let open = null;
  for (let t = 1; t < seq.length; t++) {
    const src = seq[t - 1], tgt = seq[t];
    if (tgt.start > src.start) { open = null; continue; } // 下へ進む（ふつうに読む）
    // すぐ上の1字に、1字から返る → レ点（熟語・A などからは一二点）
    if (tgt.end === src.start - 1 && !src.jk && !tgt.jk) { tgt.re = true; open = null; continue; }
    if (open && open[open.length - 1] === src) open.push(tgt); else { open = [src, tgt]; segs.push(open); }
  }
  // 一二点の組が、ほかの組をまたぐときは上下点、さらにまたぐときは甲乙点・天地点
  const FAM = [['一', '二', '三', '四', '五'], ['上', '中', '下'], ['甲', '乙', '丙', '丁'], ['天', '地', '人']];
  segs.forEach(sg => { sg.lo = Math.min(...sg.map(b => b.start)); sg.hi = Math.max(...sg.map(b => b.end)); });
  segs.sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo));
  for (const sg of segs) {
    let f = 0;
    segs.forEach(o => { if (o !== sg && o.fam !== undefined && o.lo <= sg.hi && o.hi >= sg.lo) f = Math.max(f, o.fam + 1); });
    while (f < FAM.length && FAM[f].length < sg.length) f++;
    if (f >= FAM.length) return { ok: false, msg: '返る字が多すぎて、返り点で表せませんでした。' };
    sg.fam = f;
    const marks = f === 1 && sg.length === 2 ? ['上', '下'] : FAM[f]; // 上下点が2つなら「上・下」（中は使わない）
    sg.forEach((b, k) => { U[b.start].mark = marks[k]; });
  }
  bl.forEach(b => {
    if (b.re) U[b.start].re = true;
    if (b.end > b.start && (U[b.start].mark || b.re)) for (let i = b.start; i < b.end; i++) U[i].hy = true; // 熟語の竪点
    if (b.sai) { const u = U[b.start], d = KB_SAI[u.ch]; u.sai = u.sai || (d ? d[2] : 'ず'); if (d) { if (!u.furi) u.furi = d[0]; if (!u.okuri) u.okuri = d[1]; } }
  });
  // 付けた返り点で読むと、番号の順になるか確かめる
  const want = [];
  U.forEach((u, i) => (u.ord || []).forEach(n => want.push({ n, i })));
  want.sort((a, b) => a.n - b.n || a.i - b.i);
  const got = kanbunReadingOrder(U).filter(i => kbCountable(U[i]) && !U[i].oki);
  const ok = got.length === want.length && got.every((i, k) => i === want[k].i);
  return ok ? { ok: true } : { ok: false, msg: 'この読む順は、返り点で表せませんでした（番号を確かめるか、返り点を手で直してください）。' };
}
function kbApplyKaeri(auto) {
  if (!_kbUnits.some(u => u.ord && u.ord.length)) return alert('先に「🔢 読む順にタップ」で、字を読む順にタップしてください。');
  const r = kbAutoKaeri(_kbUnits);
  if (r.ok) _kbNumMode = false;
  renderKanbunEditor();
  const st = document.getElementById('kbNumStatus');
  if (st) st.innerHTML = r.ok ? '<span style="color:var(--success);">✨ 返り点を付けました。送り仮名・ふりがなを確かめてください。</span>' : `<span class="drill-ng">⚠️ ${escapeHtml(r.msg)}</span>`;
  if (!r.ok && !auto) alert('⚠️ ' + r.msg);
}
