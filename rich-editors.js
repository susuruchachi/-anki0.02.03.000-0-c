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
  ['p-ヒドロキシアゾベンゼン', 'OC1=CC=C(C=C1)N=NC1=CC=CC=C1']
];

// 構造の部品（SMILES断片）。カーソル位置に挿入される。
const CHEM_FRAGMENTS = [
  ['ベンゼン環', 'C1=CC=CC=C1'], ['-OH', 'O'], ['-COOH', 'C(=O)O'], ['-CHO', 'C=O'], ['-NH2', 'N'], ['-NO2', 'N(=O)=O'],
  ['-SO3H', 'S(=O)(=O)O'], ['-Cl', 'Cl'], ['-Br', 'Br'], ['-CH3', 'C'], ['エステル', 'C(=O)O'], ['二重結合 =', '='], ['三重結合 #', '#'],
  ['枝 ( )', '()'], ['環を閉じる 1', '1']
];

let _richEditorTarget = null; // 挿入先のテキストエリア
let _richEditorRange = null;  // 置き換え対象ブロックの [start, end]（新規挿入時は null）

// テキストエリア内で、カーソル位置にある（無ければ最初の）指定種類のブロックを探す
function findRichBlockAtCursor(textarea, wantType) {
  const text = textarea.value;
  const cursor = textarea.selectionStart != null ? textarea.selectionStart : 0;
  const re = new RegExp(RICH_BLOCK_RE.source, 'g');
  let m, first = null;
  while ((m = re.exec(text)) !== null) {
    if (richBlockType(m[1]) !== wantType) continue;
    const hit = { start: m.index, end: m.index + m[0].length, body: m[2] };
    if (cursor >= hit.start && cursor <= hit.end) return hit;
    if (!first) first = hit;
  }
  return first;
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

function renderChemSearchResults(query) {
  const box = document.getElementById('chemSearchResults');
  if (!box) return;
  const q = normalizeChemQuery(query);
  const hits = q ? CHEM_DICTIONARY.filter(([name]) => normalizeChemQuery(name).includes(q)) : [];
  box.innerHTML = '';
  if (!q) {
    box.innerHTML = '<div class="hint-small">化合物名を入力すると候補が出ます（高校化学の主な化合物を収録）。英語名なら PubChem でも検索できます。</div>';
    return;
  }
  if (hits.length === 0) {
    box.innerHTML = '<div class="hint-small">辞書に見つかりません。英語名（例: caffeine）で「🌐 PubChemで検索」を試してください。</div>';
    return;
  }
  hits.slice(0, 30).forEach(([name, smiles]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip chip-strong'; b.innerText = name;
    b.onclick = () => { document.getElementById('txtChemSmiles').value = smiles; updateChemPreview(); };
    box.appendChild(b);
  });
}

async function searchChemOnPubChem() {
  const q = document.getElementById('txtChemSearch').value.trim();
  const status = document.getElementById('chemSearchStatus');
  if (!q) { status.innerText = '検索する名前を入力してください。'; return; }
  status.innerText = '🌐 PubChemで検索中...';
  try {
    const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(q)}/property/SMILES/JSON`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('not found');
    const data = await res.json();
    const p = data && data.PropertyTable && data.PropertyTable.Properties && data.PropertyTable.Properties[0];
    const smiles = p && (p.SMILES || p.IsomericSMILES || p.CanonicalSMILES || p.ConnectivitySMILES);
    if (!smiles) throw new Error('no smiles');
    document.getElementById('txtChemSmiles').value = smiles;
    status.innerText = `✅ 「${q}」が見つかりました（PubChem CID: ${p.CID}）`;
    updateChemPreview();
  } catch (e) {
    status.innerText = '⚠️ 見つかりませんでした。PubChemは英語名のみ対応です（例: aspirin, caffeine）。';
  }
}

function scheduleChemPreview() {
  clearTimeout(_chemPreviewTimer);
  _chemPreviewTimer = setTimeout(updateChemPreview, 250);
}

function updateChemPreview() {
  const box = document.getElementById('chemPreview');
  const smiles = document.getElementById('txtChemSmiles').value.trim();
  _chemPreviewOk = false;
  if (!smiles) { box.innerHTML = '<div class="hint-small">ここにプレビューが表示されます</div>'; return; }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  box.innerHTML = '';
  box.appendChild(svg);
  drawSmilesInto(svg, smiles, 1.5).then(ok => {
    if (document.getElementById('txtChemSmiles').value.trim() !== smiles) return; // 入力が進んでいたら無視
    _chemPreviewOk = ok;
    if (!ok) box.innerHTML = '<div class="chem-err">⚠️ この書き方では構造式を描けません。カッコや環の番号の対応を確認してください。</div>';
  }).catch(() => { box.innerHTML = '<div class="chem-err">⚠️ 構造式ライブラリを読み込めません（通信状況を確認してください）</div>'; });
}

function submitChemEditor() {
  const smiles = document.getElementById('txtChemSmiles').value.trim();
  if (!smiles) { alert('構造（SMILES）を入力するか、化合物名から選んでください。'); return; }
  if (!_chemPreviewOk && !confirm('プレビューで構造式を描けていません。このまま挿入しますか？')) return;
  replaceRangeInTextarea(_richEditorTarget, _richEditorRange, `{{構造式:${smiles}}}`);
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
  _kbUnits = chars.map((ch, i) => (old[i] && old[i].ch === ch) ? old[i] : { ch, re: false, mark: null, okuri: '', furi: '', oki: false, kana: false });
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
    t.className = 'kb-tile' + (i === _kbSel ? ' active' : '') + (u.oki ? ' oki' : '');
    const k = kaeriLabel(u);
    t.innerHTML = `<span class="kb-tile-ch">${escapeHtml(u.ch)}</span>` +
      (u.okuri ? `<span class="kb-tile-okuri">${escapeHtml(u.okuri)}</span>` : '') +
      (k ? `<span class="kb-tile-kaeri">${escapeHtml(k)}</span>` : '') +
      (u.furi ? `<span class="kb-tile-furi">${escapeHtml(u.furi)}</span>` : '');
    t.onclick = () => selectKanbunUnit(i);
    tiles.appendChild(t);
  });

  // 選択中の字の注記パネル
  const panel = document.getElementById('kanbunUnitPanel');
  const u = _kbUnits[_kbSel];
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
