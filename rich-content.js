// ================================================================
// ★【0.03.00】リッチコンテンツ（化学の構造式・漢文の返り点）
//
// カードの問題文・答えの中に、次の「埋め込みブロック」を書けるようにする。
//   {{構造式:SMILES}}   … 構造式を自動で描画（例: {{構造式:CCO}} → エタノール）
//   {{漢文:白文+注記}}  … 返り点・送り仮名・読み付きの縦書き漢文
//       注記は直前の1文字に付く。順不同。
//         [レ] [一] [二] [上] [下] [甲] [一レ] [上レ] など … 返り点
//         (ビテ) / （ビテ）                               … 送り仮名（カタカナ）
//         《まな》                                         … 読み（ふりがな）
//         [置]                                             … 置き字（書き下し文では読まない）
//         [仮]                                             … 書き下し文では読み（ひらがな）で書く（不→ず 等）
//       例: {{漢文:子曰(ハク)、学(ビテ)而[置]時(ニ)習(フ)[レ]之(ヲ)。}}
//
// 画像を用意しなくてもテキストだけで登録でき、クラウド同期・共有・CSVでもそのまま扱える。
// 実際の入力は rich-editors.js のエディタ（ボタン操作）から行える。
// ================================================================

const RICH_BLOCK_RE = /\{\{(構造式|chem|漢文|kanbun):([\s\S]*?)\}\}/g;

function hasRichBlock(text) {
  RICH_BLOCK_RE.lastIndex = 0;
  const found = RICH_BLOCK_RE.test(String(text || ''));
  RICH_BLOCK_RE.lastIndex = 0;
  return found;
}

function richBlockType(keyword) {
  return (keyword === '構造式' || keyword === 'chem') ? 'chem' : 'kanbun';
}

// 埋め込みブロックを一時的なトークンに置き換える。
// 答えの「/」「|」区切りや (タグ) 除去が、SMILESの立体表記「/」や送り仮名の ( ) を壊さないようにするため。
function maskRichBlocks(text) {
  const saved = [];
  const masked = String(text == null ? '' : text).replace(RICH_BLOCK_RE, (m) => {
    saved.push(m);
    return '' + (saved.length - 1) + '';
  });
  return {
    masked,
    restore: (s) => String(s).replace(/(\d+)/g, (_, i) => saved[+i])
  };
}

function escapeRichAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ----------------------------------------------------------------
// 漢文
// ----------------------------------------------------------------
const KAERI_MARKS = {
  '一': { fam: 'num', rank: 1 }, '二': { fam: 'num', rank: 2 }, '三': { fam: 'num', rank: 3 }, '四': { fam: 'num', rank: 4 }, '五': { fam: 'num', rank: 5 },
  '上': { fam: 'ue', rank: 1 }, '中': { fam: 'ue', rank: 2 }, '下': { fam: 'ue', rank: 3 },
  '甲': { fam: 'koh', rank: 1 }, '乙': { fam: 'koh', rank: 2 }, '丙': { fam: 'koh', rank: 3 }, '丁': { fam: 'koh', rank: 4 },
  '天': { fam: 'ten', rank: 1 }, '地': { fam: 'ten', rank: 2 }, '人': { fam: 'ten', rank: 3 }
};
// エディタのボタンに並べる順番
const KAERI_BUTTONS = ['レ', '一', '二', '三', '四', '上', '中', '下', '甲', '乙', '丙', '天', '地', '人', '一レ', '上レ', '甲レ', '天レ'];

function toKatakana(s) { return String(s || '').replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60)); }
function toHiragana(s) { return String(s || '').replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)); }

// 返り点トークン（"レ" "一" "一レ" など）を { re: bool, mark: '一'|null } に分解する。不正なら null。
function parseKaeriToken(tok) {
  const t = String(tok || '').trim();
  if (t === 'レ') return { re: true, mark: null };
  if (t.length === 2 && t[1] === 'レ' && KAERI_MARKS[t[0]] && KAERI_MARKS[t[0]].rank === 1) return { re: true, mark: t[0] };
  if (t.length === 1 && KAERI_MARKS[t]) return { re: false, mark: t };
  return null;
}

function kaeriLabel(u) {
  if (!u) return '';
  return (u.mark || '') + (u.re ? 'レ' : '');
}

// 漢文ソースを1文字単位の配列にする: [{ ch, re, mark, okuri, furi, oki, kana }]
function parseKanbun(src) {
  const units = [];
  const s = Array.from(String(src || ''));
  const closeOf = { '[': ']', '［': '］', '(': ')', '（': '）', '《': '》' };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (closeOf[c]) {
      const close = closeOf[c];
      let j = i + 1, body = '';
      while (j < s.length && s[j] !== close) { body += s[j]; j++; }
      const last = units[units.length - 1];
      if (last) {
        if (c === '[' || c === '［') {
          const t = body.trim();
          if (t === '置') last.oki = true;
          else if (t === '仮') last.kana = true;
          else { const k = parseKaeriToken(t); if (k) { last.re = k.re; last.mark = k.mark; } }
        } else if (c === '《') {
          last.furi = body.trim();
        } else {
          last.okuri = toKatakana(body.trim());
        }
      }
      i = j + 1;
      continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    units.push({ ch: c, re: false, mark: null, okuri: '', furi: '', oki: false, kana: false });
    i++;
  }
  return units;
}

function serializeKanbun(units) {
  return units.map(u => {
    let out = u.ch;
    const k = kaeriLabel(u);
    if (k) out += `[${k}]`;
    if (u.furi) out += `《${u.furi}》`;
    if (u.okuri) out += `(${u.okuri})`;
    if (u.oki) out += '[置]';
    if (u.kana) out += '[仮]';
    return out;
  }).join('');
}

// 返り点に従って読む順番（unitsのインデックス列）を求める。
//  ・レ点: その字は「次の字」を読んだ直後に読む
//  ・一二点/上下点/甲乙点/天地点: 二以降の字は、同じ系列の「一(上/甲/天)」の字を読んだ直後に順に読む
function kanbunReadingOrder(units) {
  const n = units.length;
  const done = new Array(n).fill(false);
  const order = [];
  const pending = { num: [], ue: [], koh: [], ten: [] };
  const emit = (i) => {
    if (done[i]) return;
    done[i] = true; order.push(i);
    // レ点：直前の字がこの字を待っていれば、すぐに返って読む
    if (i > 0 && units[i - 1].re && !done[i - 1]) emit(i - 1);
    const mk = units[i].mark && KAERI_MARKS[units[i].mark];
    if (mk && mk.rank === 1) {
      const list = pending[mk.fam].sort((a, b) => a.rank - b.rank);
      pending[mk.fam] = [];
      list.forEach(p => emit(p.idx));
    }
  };
  for (let i = 0; i < n; i++) {
    const u = units[i];
    if (u.re) continue; // 次の字を読んだときに読む
    const mk = u.mark && KAERI_MARKS[u.mark];
    if (mk && mk.rank > 1) { pending[mk.fam].push({ idx: i, rank: mk.rank }); continue; }
    emit(i);
  }
  // 返り点の付け方がおかしく読み残しが出た場合は、元の順番で後ろに付け足す
  for (let i = 0; i < n; i++) if (!done[i]) order.push(i);
  return order;
}

// 書き下し文を自動生成する（送り仮名はひらがなに、置き字は読まない、[仮]の字は読みをひらがなで書く）。
// 再読文字などは自動では扱えないので、必要に応じて手で直してもらう前提。
function kanbunToKakikudashi(units) {
  return kanbunReadingOrder(units).map(i => {
    const u = units[i];
    if (u.oki) return '';
    const head = (u.kana && u.furi) ? toHiragana(u.furi) : u.ch;
    return head + toHiragana(u.okuri || '');
  }).join('');
}

// 縦書き用の句読点（セル内は横書きにして位置を安定させるため、縦書き用の字形に置き換える）
const KANBUN_VERTICAL_PUNCT = { '、': '\uFE11', '。': '\uFE12', '，': '\uFE10', '：': '\uFE13', '；': '\uFE14', '！': '\uFE15', '？': '\uFE16', '「': '\uFE41', '」': '\uFE42', '『': '\uFE43', '』': '\uFE44' };

// 縦書き表示のHTML。注記の位置は文字サイズ(em)基準で計算して絶対配置する。
//  右側: 読み（上寄り）・送り仮名（下寄り）／左下: 返り点
function renderKanbunHTML(units, opts = {}) {
  if (!units.length) return '';
  const maxRows = opts.maxRows || 10;
  const A = 0.55; // 注記の文字サイズ（本文に対する比率）
  let totalLen = 0;
  // 句読点は直前の字と同じグループに入れ、行頭（列の先頭）に句読点が来ないようにする
  const groups = [];
  units.forEach((u, idx) => {
    const furiLen = Array.from(u.furi || '').length * A;
    const furiStart = Math.max(0, 0.5 - furiLen / 2);
    const furiEnd = u.furi ? furiStart + furiLen : 0;
    const okuriStart = Math.max(0.55, furiEnd);
    const okuriEnd = u.okuri ? okuriStart + Array.from(u.okuri).length * A : 0;
    const kaeri = kaeriLabel(u);
    const kaeriStart = 0.62;
    const kaeriEnd = kaeri ? kaeriStart + Array.from(kaeri).length * A : 0;
    const h = Math.max(1, furiEnd, okuriEnd, kaeriEnd);
    totalLen += h;
    // 注記要素の中では 1em = 本文のA em なので、本文em → 注記em は ÷A
    const toA = (v) => (v / A).toFixed(2) + 'em';
    let inner = `<span class="kb-ch${u.oki ? ' kb-oki' : ''}">${escapeHtml(KANBUN_VERTICAL_PUNCT[u.ch] || u.ch)}</span>`;
    if (u.furi) inner += `<span class="kb-furi" style="top:${toA(furiStart)}">${escapeHtml(u.furi)}</span>`;
    if (u.okuri) inner += `<span class="kb-okuri" style="top:${toA(okuriStart)}">${escapeHtml(u.okuri)}</span>`;
    if (kaeri) inner += `<span class="kb-kaeri" style="top:${toA(kaeriStart)}">${escapeHtml(kaeri)}</span>`;
    const cell = `<span class="kb-c" style="height:${h.toFixed(2)}em">${inner}</span>`;
    if (idx > 0 && KANBUN_VERTICAL_PUNCT[u.ch] && groups.length) groups[groups.length - 1].push(cell);
    else groups.push([cell]);
  });
  const rows = Math.min(maxRows, Math.ceil(totalLen + 0.2));
  const html = groups.map(g => `<span class="kb-g">${g.join('')}</span>`).join('\u200B');
  return `<span class="kb" style="height:${rows}em">${html}</span>`;
}

// ----------------------------------------------------------------
// 構造式（SmilesDrawer を必要になった時だけ読み込む）
// ----------------------------------------------------------------
const SMILES_DRAWER_URL = 'https://cdn.jsdelivr.net/npm/smiles-drawer@2.1.7/dist/smiles-drawer.min.js';
let _smilesDrawerPromise = null;
function ensureSmilesDrawer() {
  if (typeof SmilesDrawer !== 'undefined') return Promise.resolve();
  if (_smilesDrawerPromise) return _smilesDrawerPromise;
  _smilesDrawerPromise = new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = SMILES_DRAWER_URL;
    sc.onload = () => resolve();
    sc.onerror = () => { _smilesDrawerPromise = null; reject(new Error('構造式ライブラリの読み込みに失敗しました')); };
    document.head.appendChild(sc);
  });
  return _smilesDrawerPromise;
}

// 炭素・水素は currentColor にして、ダーク/ライトどちらでも文字色に馴染むようにする
const CHEM_THEME = {
  C: 'currentColor', H: 'currentColor', O: '#e5484d', N: '#3b82f6', F: '#22a06b', CL: '#16a085', BR: '#d35400',
  I: '#8e44ad', P: '#d97706', S: '#d4a20b', B: '#e67e22', SI: '#e67e22', BACKGROUND: 'transparent'
};

// SMILES を svg 要素に描画する。成功なら true を返す Promise。
function drawSmilesInto(svg, smiles, scale = 1.4) {
  return ensureSmilesDrawer().then(() => new Promise((resolve) => {
    const drawer = new SmilesDrawer.SvgDrawer({ width: 300, height: 300, terminalCarbons: true, compactDrawing: false, padding: 10, themes: { anki: CHEM_THEME } });
    labelNonBenzeneCarbons(drawer);
    SmilesDrawer.parse(String(smiles).trim(), (tree) => {
      try {
        drawer.draw(tree, svg, 'anki', null, false);
        removeAttachmentLabels(svg);
        fitChemSvg(svg, scale);
        resolve(true);
      } catch (e) { resolve(false); }
    }, () => resolve(false));
  }));
}

// 高校化学の表記に合わせ、ベンゼン環（芳香環）以外の炭素はすべて C / CH / CH2 / CH3 と書く。
// SmilesDrawer は標準では炭素を省略した骨格式（折れ線）で描くので、頂点を描く直前に
// 「ベンゼン環に属さない炭素」へ drawExplicit を立てて元素記号と水素の数を表示させる。
function labelNonBenzeneCarbons(drawer) {
  const origDrawVertices = drawer.drawVertices.bind(drawer);
  drawer.drawVertices = function (debug) {
    try {
      const pre = this.preprocessor, graph = pre.graph, vertices = graph.vertices;
      const isC = (v) => v.value.element === 'C';
      const isDouble = (a, b) => { const e = graph.getEdge(a, b); return !!e && e.bondType === '='; };
      // 炭素だけの六員環を候補にし、全員が（候補環の炭素と）二重結合を持っていればベンゼン環とみなす
      // （ナフタレンなど縮合環のケクレ構造で、片方の環に二重結合が2本しかない場合にも対応するため）
      const candidates = (pre.rings || []).filter(r => r.members.length === 6 && r.members.every(id => isC(vertices[id])));
      const inCandidate = new Set();
      candidates.forEach(r => r.members.forEach(id => inCandidate.add(id)));
      const benzene = new Set();
      candidates.forEach(r => {
        const aromatic = r.members.every(id => {
          const v = vertices[id];
          if (v.value.isPartOfAromaticRing) return true; // 小文字(c1ccccc1)で書かれた芳香環
          return v.neighbours.some(n => inCandidate.has(n) && isDouble(id, n));
        });
        if (aromatic) r.members.forEach(id => benzene.add(id));
      });
      vertices.forEach(v => {
        if (isC(v) && !benzene.has(v.id) && !v.value.isPartOfAromaticRing) v.value.drawExplicit = true;
      });
    } catch (e) { /* 失敗しても通常の骨格式で描く */ }
    return origDrawVertices(debug);
  };
}

// ★【0.03.08】「*」（結合の腕）の文字を消して、結合の線だけを残す（−COOH などの基を描くため）
function removeAttachmentLabels(svg) {
  svg.querySelectorAll('text').forEach(t => {
    if (t.textContent.trim() !== '*') return;
    const g = t.parentNode;
    if (g && g !== svg && g.tagName.toLowerCase() === 'g' && g.querySelectorAll('text').length === 1) g.remove(); else t.remove();
  });
}

// ライブラリが付ける正方形の viewBox を、実際の描画範囲ぴったりに詰め直す
function fitChemSvg(svg, scale) {
  let box = null;
  try { const bb = svg.getBBox(); if (bb.width > 0 && bb.height > 0) box = { x: bb.x, y: bb.y, w: bb.width, h: bb.height }; } catch (e) {}
  const pad = 4;
  if (box) svg.setAttribute('viewBox', `${box.x - pad} ${box.y - pad} ${box.w + pad * 2} ${box.h + pad * 2}`);
  const vb = svg.viewBox && svg.viewBox.baseVal;
  if (vb && vb.width) {
    svg.setAttribute('width', Math.round(vb.width * scale));
    svg.setAttribute('height', Math.round(vb.height * scale));
  }
  svg.classList.add('chem-svg');
}

function hydrateChem(root, scale) {
  const spans = root.querySelectorAll('.chem-struct:not([data-done])');
  spans.forEach(span => {
    span.setAttribute('data-done', '1');
    const smiles = span.getAttribute('data-smiles') || '';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    span.innerHTML = '';
    span.appendChild(svg);
    const s = parseFloat(span.getAttribute('data-scale')) || scale || 1.4;
    drawSmilesInto(svg, smiles, s).then(ok => {
      if (!ok) span.innerHTML = `<span class="chem-err">⚠️ 構造式を描けません: ${escapeHtml(smiles)}</span>`;
    }).catch(() => {
      span.innerHTML = `<span class="chem-err">⚠️ 構造式ライブラリを読み込めません（通信状況を確認してください）</span>`;
    });
  });
}

// ----------------------------------------------------------------
// 共通: テキスト → 表示用HTML / 読み上げ用テキスト
// ----------------------------------------------------------------

// escape=true: ブロック以外の部分をHTMLエスケープする（カード一覧など）
// escape=false: ブロック以外はそのままHTMLとして扱う（従来の出題表示の方針どおり）
function renderRichText(text, opts = {}) {
  const src = String(text == null ? '' : text);
  const conv = opts.escape ? (s) => escapeHtml(s) : (s) => s;
  let out = '', last = 0, m;
  RICH_BLOCK_RE.lastIndex = 0;
  while ((m = RICH_BLOCK_RE.exec(src)) !== null) {
    out += conv(src.slice(last, m.index));
    const body = m[2];
    if (richBlockType(m[1]) === 'chem') {
      out += `<span class="chem-struct" data-smiles="${escapeRichAttr(body.trim())}"></span>`;
    } else {
      out += renderKanbunHTML(parseKanbun(body), { maxRows: opts.kanbunRows });
    }
    last = m.index + m[0].length;
  }
  out += conv(src.slice(last));
  RICH_BLOCK_RE.lastIndex = 0;
  return out;
}

const KATEX_DELIMITERS = [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }];

// innerHTML を入れた後に呼ぶ: 構造式の描画と数式(KaTeX, \ce{} 化学式)の描画
function hydrateRich(root, opts = {}) {
  if (!root) return;
  hydrateChem(root, opts.chemScale);
  if (typeof renderMathInElement === 'function') {
    try { renderMathInElement(root, { delimiters: KATEX_DELIMITERS, throwOnError: false }); } catch (e) {}
  }
}

// el に text を描画してから hydrate までまとめて行うヘルパー
function setRichContent(el, text, opts = {}) {
  if (!el) return;
  el.innerHTML = renderRichText(text, opts);
  hydrateRich(el, opts);
}

// 読み上げ用: 漢文は書き下し文で読み、構造式は「構造式」と読む
function richTextToSpeech(text) {
  return String(text == null ? '' : text).replace(RICH_BLOCK_RE, (_, kw, body) =>
    richBlockType(kw) === 'chem' ? ' 構造式 ' : kanbunToKakikudashi(parseKanbun(body)));
}
