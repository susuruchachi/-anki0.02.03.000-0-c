// ================================================================
// ★【0.03.08】構造式エディタの検索
//  ・分子式（C2H4O2）・示性式（CH3COOH）から探す … 収録辞書は手元で分子式を計算、ほかは PubChem
//  ・日本語名から探す … 収録辞書 → Wikidata（日本語の名前）→ カタカナ名を英語名に直して PubChem
// ================================================================

const ELEMENT_SYMBOLS = new Set(('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr ' +
  'Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pt Au Hg Tl Pb Bi Rn U').split(' '));

// 「C2H4O2」「CH3COOH」「(CH3)2CO」「C₆H₅OH」などを原子の数に直す。分子式として読めなければ null
function parseChemFormula(text) {
  let s = String(text || '').trim()
    .replace(/[₀-₉]/g, c => String(c.charCodeAt(0) - 0x2080))
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[（]/g, '(').replace(/[）]/g, ')').replace(/[-−ー―‐]/g, '');
  if (!s || !/^[A-Z(]/.test(s) || !/^[A-Za-z0-9()]+$/.test(s)) return null;
  let i = 0;
  const readNum = () => { const m = /^\d+/.exec(s.slice(i)); if (!m) return 1; i += m[0].length; return parseInt(m[0], 10); };
  const group = () => {
    const counts = {};
    while (i < s.length && s[i] !== ')') {
      let part;
      if (s[i] === '(') {
        i++; part = group();
        if (s[i] !== ')') throw new Error('paren'); i++;
      } else {
        const m = /^[A-Z][a-z]?/.exec(s.slice(i));
        if (!m) throw new Error('bad');
        let sym = m[0];
        if (!ELEMENT_SYMBOLS.has(sym)) { sym = sym[0]; if (!ELEMENT_SYMBOLS.has(sym)) throw new Error('elem'); }
        i += sym.length;
        part = { [sym]: 1 };
      }
      const n = readNum();
      Object.keys(part).forEach(k => { counts[k] = (counts[k] || 0) + part[k] * n; });
    }
    return counts;
  };
  try {
    const c = group();
    if (i !== s.length || !Object.keys(c).length) return null;
    return c;
  } catch (e) { return null; }
}

// 原子の数 → ヒル式（C, H の順、ほかはアルファベット順）
function hillFormula(counts) {
  if (!counts) return '';
  const keys = Object.keys(counts).filter(k => counts[k] > 0 && k !== '*');
  const order = keys.includes('C') ? ['C', 'H', ...keys.filter(k => k !== 'C' && k !== 'H').sort()] : keys.sort();
  return order.filter(k => counts[k]).map(k => k + (counts[k] > 1 ? counts[k] : '')).join('');
}

// SMILES から分子式（原子の数）を数える（高校化学の範囲：水素は原子価から補う）
function smilesToCounts(smiles) {
  const VAL = { B: [3], C: [4], N: [3, 5], O: [2], P: [3, 5], S: [2, 4, 6], F: [1], Cl: [1], Br: [1], I: [1] };
  const atoms = []; // { el, aromatic, bonds, hExplicit (null=暗黙) }
  const counts = {};
  const s = String(smiles || '');
  let i = 0, prev = -1, bond = 1;
  const stack = [], rings = {};
  const connect = (a, b, order) => { atoms[a].bonds += order; atoms[b].bonds += order; };
  while (i < s.length) {
    const ch = s[i];
    if (ch === '(') { stack.push(prev); i++; continue; }
    if (ch === ')') { prev = stack.pop(); i++; continue; }
    if (ch === '.') { prev = -1; i++; continue; }
    if (ch === '=') { bond = 2; i++; continue; }
    if (ch === '#') { bond = 3; i++; continue; }
    if (ch === '-' || ch === '/' || ch === '\\') { bond = 1; i++; continue; }
    if (ch === ':') { bond = 1.5; i++; continue; }
    if (/[0-9%]/.test(ch)) {
      let num;
      if (ch === '%') { num = s.substr(i + 1, 2); i += 3; } else { num = ch; i++; }
      if (rings[num]) { const r = rings[num]; connect(r.atom, prev, Math.max(bond, r.bond)); delete rings[num]; }
      else rings[num] = { atom: prev, bond };
      bond = 1; continue;
    }
    let atom = null;
    if (ch === '[') {
      const end = s.indexOf(']', i);
      if (end < 0) return null;
      const body = s.slice(i + 1, end);
      const m = /^(\d*)([A-Z][a-z]?|[a-z][a-z]?|\*)(@*)(H(\d*))?/.exec(body);
      if (!m) return null;
      let el = m[2]; const aromatic = /^[a-z]/.test(el);
      if (aromatic) el = el[0].toUpperCase() + el.slice(1);
      atom = { el, aromatic, bonds: 0, hExplicit: m[4] ? (m[5] ? parseInt(m[5], 10) : 1) : 0 };
      i = end + 1;
    } else if (ch === '*') {
      atom = { el: '*', aromatic: false, bonds: 0, hExplicit: 0 }; i++;
    } else {
      const two = s.substr(i, 2);
      let el;
      if (two === 'Cl' || two === 'Br') { el = two; i += 2; }
      else if (/[BCNOPSFI]/.test(ch)) { el = ch; i++; }
      else if (/[bcnops]/.test(ch)) { el = ch.toUpperCase(); i++; atom = { el, aromatic: true, bonds: 0, hExplicit: null }; }
      else return null;
      if (!atom) atom = { el, aromatic: false, bonds: 0, hExplicit: null };
    }
    atoms.push(atom);
    const idx = atoms.length - 1;
    if (prev >= 0) connect(prev, idx, atom.aromatic && atoms[prev].aromatic && bond === 1 ? 1.5 : bond);
    prev = idx; bond = 1;
  }
  atoms.forEach(a => {
    if (a.el === '*') return;
    counts[a.el] = (counts[a.el] || 0) + 1;
    let h = a.hExplicit;
    if (h === null) {
      const vals = VAL[a.el] || [0];
      const used = Math.round(a.bonds);
      const v = vals.find(x => x >= used);
      h = v === undefined ? 0 : v - used;
    }
    if (h > 0) counts.H = (counts.H || 0) + h;
  });
  return counts;
}

// 収録辞書から分子式が一致するものを探す
let _chemFormulaIndex = null;
function findDictionaryByFormula(counts) {
  const target = hillFormula(counts);
  if (!target) return [];
  if (!_chemFormulaIndex) {
    _chemFormulaIndex = CHEM_DICTIONARY.map(([name, smiles]) => {
      let f = ''; try { f = hillFormula(smilesToCounts(smiles)); } catch (e) {}
      return { name, smiles, formula: f };
    });
  }
  return _chemFormulaIndex.filter(e => e.formula === target);
}

// ---------------- 日本語名 → 英語名（カタカナの規則的な名前だけ） ----------------
const JA_CHEM_ACID_STEMS = [
  ['テレフタル', 'terephthal'], ['イソフタル', 'isophthal'], ['フタル', 'phthal'], ['メタクリル', 'methacryl'], ['アクリル', 'acryl'],
  ['プロピオン', 'propion'], ['ステアリン', 'stear'], ['パルミチン', 'palmit'], ['リノレン', 'linolen'], ['リノール', 'linole'], ['オレイン', 'ole'],
  ['安息香', 'benzo'], ['サリチル', 'salicyl'], ['シュウ', 'oxal'], ['マロン', 'malon'], ['コハク', 'succin'], ['マレイン', 'male'], ['フマル', 'fumar'],
  ['アジピン', 'adip'], ['クエン', 'citr'], ['酒石', 'tartar'], ['乳', 'lact'], ['酪', 'butyr'], ['酢', 'acet'], ['ギ', 'form'],
  ['硫', 'sulfur'], ['硝', 'nitr'], ['炭', 'carbon'], ['リン', 'phosphor'], ['塩素', 'chlor']
];
const JA_CHEM_CATIONS = [
  ['メチル', 'methyl'], ['エチル', 'ethyl'], ['プロピル', 'propyl'], ['ブチル', 'butyl'], ['ペンチル', 'pentyl'], ['フェニル', 'phenyl'],
  ['ビニル', 'vinyl'], ['ベンジル', 'benzyl'], ['イソプロピル', 'isopropyl'],
  ['ナトリウム', 'sodium'], ['カリウム', 'potassium'], ['カルシウム', 'calcium'], ['アンモニウム', 'ammonium'], ['マグネシウム', 'magnesium'],
  ['リチウム', 'lithium'], ['バリウム', 'barium'], ['銀', 'silver'], ['銅(II)', 'copper(II)'], ['鉄(III)', 'iron(III)'], ['鉄(II)', 'iron(II)'],
  ['アルミニウム', 'aluminium'], ['亜鉛', 'zinc'], ['鉛(II)', 'lead(II)']
];
const JA_CHEM_INORGANIC_ANIONS = [['水酸化', 'hydroxide'], ['塩化', 'chloride'], ['臭化', 'bromide'], ['ヨウ化', 'iodide'], ['フッ化', 'fluoride'], ['酸化', 'oxide'], ['硫化', 'sulfide']];
const JA_CHEM_MORPHEMES = [
  // 化合物まるごと
  ['ベンズアルデヒド', 'benzaldehyde'], ['アセトアルデヒド', 'acetaldehyde'], ['ホルムアルデヒド', 'formaldehyde'], ['アセトアニリド', 'acetanilide'],
  ['ナフタレン', 'naphthalene'], ['アントラセン', 'anthracene'], ['ベンゼン', 'benzene'], ['トルエン', 'toluene'], ['キシレン', 'xylene'],
  ['スチレン', 'styrene'], ['フェノール', 'phenol'], ['クレゾール', 'cresol'], ['アニリン', 'aniline'], ['ピリジン', 'pyridine'], ['アセトン', 'acetone'],
  ['エチレン', 'ethylene'], ['プロピレン', 'propylene'], ['アセチレン', 'acetylene'], ['グリセリン', 'glycerol'], ['グリコール', 'glycol'],
  // 母体（アルカン・アルケン・アルキン）と、その -ol, -al, -one
  ['メタノール', 'methanol'], ['エタノール', 'ethanol'], ['プロパノール', 'propanol'], ['ブタノール', 'butanol'], ['ペンタノール', 'pentanol'], ['ヘキサノール', 'hexanol'],
  ['メタナール', 'methanal'], ['エタナール', 'ethanal'], ['プロパナール', 'propanal'], ['ブタナール', 'butanal'],
  ['プロパノン', 'propanone'], ['ブタノン', 'butanone'], ['ペンタノン', 'pentanone'],
  ['メタン', 'methane'], ['エタン', 'ethane'], ['プロパン', 'propane'], ['ブタン', 'butane'], ['ペンタン', 'pentane'], ['ヘキサン', 'hexane'],
  ['ヘプタン', 'heptane'], ['オクタン', 'octane'], ['ノナン', 'nonane'], ['デカン', 'decane'],
  ['エテン', 'ethene'], ['プロペン', 'propene'], ['ブテン', 'butene'], ['ペンテン', 'pentene'], ['ヘキセン', 'hexene'], ['ブタジエン', 'butadiene'],
  ['エチン', 'ethyne'], ['プロピン', 'propyne'], ['ブチン', 'butyne'], ['ペンチン', 'pentyne'],
  // 置換基
  ['イソプロピル', 'isopropyl'], ['メチル', 'methyl'], ['エチル', 'ethyl'], ['プロピル', 'propyl'], ['ブチル', 'butyl'], ['ペンチル', 'pentyl'], ['ヘキシル', 'hexyl'],
  ['フェニル', 'phenyl'], ['ベンジル', 'benzyl'], ['ビニル', 'vinyl'], ['アセチル', 'acetyl'],
  ['クロロ', 'chloro'], ['ブロモ', 'bromo'], ['ヨード', 'iodo'], ['フルオロ', 'fluoro'], ['ニトロ', 'nitro'], ['アミノ', 'amino'],
  ['ヒドロキシ', 'hydroxy'], ['メトキシ', 'methoxy'], ['エトキシ', 'ethoxy'], ['カルボキシ', 'carboxy'], ['スルホ', 'sulfo'], ['オキソ', 'oxo'],
  // 倍数・接頭語・語尾
  ['テトラ', 'tetra'], ['トリ', 'tri'], ['ジ', 'di'], ['シクロ', 'cyclo'], ['シス', 'cis'], ['トランス', 'trans'], ['イソ', 'iso'],
  ['ジオール', 'diol'], ['トリオール', 'triol'], ['オール', 'ol'], ['アール', 'al'], ['オン', 'one'], ['アミン', 'amine'], ['アミド', 'amide'],
  ['ニトリル', 'nitrile'], ['エーテル', ' ether'], ['スルホン酸', 'sulfonic acid'], ['ジアゾニウム', 'diazonium'],
  ['オルト', 'o-'], ['パラ', 'p-']
];
function convertMorphemes(s) {
  let out = '', i = 0;
  const list = JA_CHEM_MORPHEMES.slice().sort((a, b) => b[0].length - a[0].length);
  while (i < s.length) {
    if (/[0-9,\-\s]/.test(s[i])) { out += s[i] === ' ' ? ' ' : s[i]; i++; continue; }
    const hit = list.find(([ja]) => s.startsWith(ja, i));
    if (!hit) return null;
    out += hit[1]; i += hit[0].length;
  }
  return out;
}
// 例: 「2-メチルプロパン-1-オール」→ 2-methylpropan-1-ol、「酢酸エチル」→ ethyl acetate、「プロパン酸」→ propanoic acid
function japaneseChemNameToEnglish(name) {
  let s = String(name || '').trim()
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[（]/g, '(').replace(/[）]/g, ')').replace(/([0-9])[‐−―]/g, '$1-').replace(/[‐−―ー](?=[0-9])/g, '-')
    .replace(/[，、]/g, ',').replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
  if (!s) return null;
  // 「○○酸△△」（エステル・塩）
  for (const [ja, en] of JA_CHEM_ACID_STEMS) {
    for (const [cj, ce] of JA_CHEM_CATIONS) {
      if (s === ja + '酸' + cj) {
        const ate = en === 'sulfur' ? 'sulfate' : en === 'nitr' ? 'nitrate' : en === 'carbon' ? 'carbonate' : en === 'phosphor' ? 'phosphate' : en === 'chlor' ? 'chlorate' : en + 'ate';
        return ce + ' ' + ate;
      }
    }
    if (s === ja + '酸') {
      const acid = en === 'sulfur' ? 'sulfuric' : en === 'nitr' ? 'nitric' : en === 'carbon' ? 'carbonic' : en === 'phosphor' ? 'phosphoric' : en === 'chlor' ? 'chloric' : en + 'ic';
      return acid + ' acid';
    }
    if (s === '無水' + ja + '酸') return en + 'ic anhydride';
  }
  // 「塩化ナトリウム」など
  for (const [aj, ae] of JA_CHEM_INORGANIC_ANIONS) {
    for (const [cj, ce] of JA_CHEM_CATIONS) if (s === aj + cj) return ce + ' ' + ae;
  }
  // 「○○酸」（系統名のカルボン酸: プロパン酸 → propanoic acid）
  let acid = false;
  let en = convertMorphemes(s);
  if (!en && /酸$/.test(s)) { acid = true; s = s.slice(0, -1); en = convertMorphemes(s); }
  if (!en) return null;
  en = en.replace(/e(-[\d,]+-)(?=[aeiouy])/g, '$1')     // propane-1-ol → propan-1-ol
    .replace(/e(?=(ol|al|one|diol|triol)\b)/g, '');   // propaneol → propanol
  if (acid) en = en.replace(/e$/, '') + 'oic acid';
  return en.trim();
}

// ---------------- オンライン検索 ----------------
async function fetchJSON(url, timeoutMs = 12000) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { if (t) clearTimeout(t); }
}
function pubchemSmilesOf(p) { return p && (p.SMILES || p.IsomericSMILES || p.CanonicalSMILES || p.ConnectivitySMILES); }

// 英語名 → { smiles, cid, title }
async function pubchemByName(name) {
  const data = await fetchJSON(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/property/SMILES,Title/JSON`);
  const p = data && data.PropertyTable && data.PropertyTable.Properties && data.PropertyTable.Properties[0];
  const smiles = pubchemSmilesOf(p);
  if (!smiles) throw new Error('no smiles');
  return { smiles, cid: p.CID, title: p.Title || name };
}
async function pubchemByCid(cid) {
  const data = await fetchJSON(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${encodeURIComponent(cid)}/property/SMILES,Title/JSON`);
  const p = data && data.PropertyTable && data.PropertyTable.Properties && data.PropertyTable.Properties[0];
  const smiles = pubchemSmilesOf(p);
  if (!smiles) throw new Error('no smiles');
  return { smiles, cid: p.CID, title: p.Title || '' };
}
// 分子式 → 候補（最大 limit 件）
async function pubchemByFormula(formula, limit = 12) {
  const ids = await fetchJSON(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/fastformula/${encodeURIComponent(formula)}/cids/JSON?MaxRecords=${limit}`);
  const cids = (ids && ids.IdentifierList && ids.IdentifierList.CID || []).slice(0, limit);
  if (!cids.length) return [];
  const data = await fetchJSON(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cids.join(',')}/property/SMILES,Title/JSON`);
  const props = (data && data.PropertyTable && data.PropertyTable.Properties) || [];
  return props.map(p => ({ smiles: pubchemSmilesOf(p), cid: p.CID, title: p.Title || ('CID ' + p.CID) })).filter(x => x.smiles);
}
// 日本語名 → Wikidata の項目（SMILES か PubChem CID か英語名）
async function wikidataByJapaneseName(name) {
  const base = 'https://www.wikidata.org/w/api.php?format=json&origin=*';
  const search = await fetchJSON(`${base}&action=wbsearchentities&language=ja&uselang=ja&type=item&limit=5&search=${encodeURIComponent(name)}`);
  const hits = (search && search.search) || [];
  if (!hits.length) return null;
  const ids = hits.map(h => h.id).join('|');
  const ents = await fetchJSON(`${base}&action=wbgetentities&props=claims|labels&languages=ja|en&ids=${ids}`);
  const val = (e, p) => { const c = e.claims && e.claims[p]; const v = c && c[0] && c[0].mainsnak && c[0].mainsnak.datavalue; return v ? v.value : null; };
  const norm = t => String(t || '').replace(/[\s　・]/g, '');
  const found = [];
  for (const h of hits) {
    const e = ents && ents.entities && ents.entities[h.id];
    if (!e) continue;
    const smiles = val(e, 'P2017') || val(e, 'P233');
    const cid = val(e, 'P662');
    const en = e.labels && e.labels.en && e.labels.en.value;
    const ja = (e.labels && e.labels.ja && e.labels.ja.value) || h.label;
    // 名前が完全に一致するか（別名で一致した場合も含む）
    const exact = norm(ja) === norm(name) || norm(h.label) === norm(name) || (h.match && norm(h.match.text) === norm(name));
    if (smiles || cid) found.push({ smiles, cid, en, ja, exact });
  }
  return found.find(f => f.exact) || (found[0] ? Object.assign(found[0], { exact: false }) : null);
}

// 日本語名から構造を探す（見つからなければ例外）
async function lookupJapaneseChemName(name) {
  const fromWikidata = async (w) => {
    if (w.smiles) return { smiles: w.smiles, source: 'Wikidata', title: w.ja || name };
    const r = await pubchemByCid(w.cid); return { smiles: r.smiles, source: 'PubChem', title: w.ja || r.title, cid: r.cid };
  };
  let w = null;
  try { w = await wikidataByJapaneseName(name); } catch (e) { /* Wikidata が使えない時は英語名に直して探す */ }
  if (w && w.exact) return fromWikidata(w);
  // 名前がぴったり一致しなければ、規則的な名前（2-メチルプロパン-1-オール など）を英語に直して PubChem で探す
  const en = japaneseChemNameToEnglish(name);
  if (en) {
    try {
      const r = await pubchemByName(en);
      return { smiles: r.smiles, source: 'PubChem', title: `${name}（${en}）`, cid: r.cid };
    } catch (e) { /* 次へ */ }
  }
  if (w) return fromWikidata(w);
  throw new Error('not found');
}

// Node のテスト用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseChemFormula, hillFormula, smilesToCounts, japaneseChemNameToEnglish, convertMorphemes };
}
