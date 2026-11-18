// ================================================================
// ★【0.04.32】📄 「テキストから問題を作る」の形で書き出す（text-import.js の逆）
// ・セクションのフォルダー（例：#28 産業。中に「#28-1 産業」…のグループ、「#28 例文」「#28 チャンツ」）を、
//   # SECTION … ／ ■グループ：… ／（導入：…）／ 図（…）：… ／ [No.1000] word ★ ／ 意味：… ／ 問題： ／ 選択肢： ／
//   補足： ／ 関連語注記： ／ 表現：◆熟語「訳」／▶ 例文「訳」 ／ 1000-1 派生語｜意味／メモ／◆… ／ Check!：● 問題 → 答え の形にする
// ・書いたテキストを、その場で「テキストから問題を作る」と同じ読み方（vtParse・vtCards）で読み直して、元のカードと同じになるか確かめる
// ・自動で作られるカード（熟語の「（ ）に入るのは？」、メモの発音記号からのアクセント問題）は書かない（読み込むとまた作られる）
// ================================================================
const VTX_POS_INV = Object.fromEntries(Object.entries(VT_POS).map(([k, v]) => [v, k]));
const VTX_ACC_Q = ' のアクセント位置は？（強く読む母音に ´ が付いたものを選ぶ）';
const vtxStrip = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const vtxNoKey = n => (n === null || n === undefined || !Number.isFinite(Number(n))) ? '' : String(Math.round(Number(n) * 10000));

// セクションらしいフォルダーか（中に「〇-1 …」のグループや「〇 例文」「〇 チャンツ」がある）
function vtxIsSection(c) {
  const kids = getChildCategories(c);
  return kids.some(k => /^\S+-\d+\s/.test(k) || /\s(例文|チャンツ)$/.test(k));
}
// 選んだフォルダーから、書き出すセクション
function vtxSectionsOf(cat) {
  if (!cat || !categories.includes(cat)) return [];
  if (vtxIsSection(cat)) return [cat];
  const p = getCategoryParent(cat);
  if (p && vtxIsSection(p)) return [p];
  const subs = getAllSubcategories(cat).filter(c => c !== cat && vtxIsSection(c));
  if (subs.length) return subs;
  return [cat]; // ふつうのフォルダー：そのフォルダー（と中のフォルダー）をグループにする
}
function vtxFolders(sec) {
  const kids = getChildCategories(sec);
  const exF = kids.find(c => /\s例文$/.test(c)) || null, chF = kids.find(c => /\sチャンツ$/.test(c)) || null;
  let groups = kids.filter(c => c !== exF && c !== chF);
  const num = c => { const m = c.match(/^\S+-(\d+)\s/); return m ? Number(m[1]) : null; };
  if (groups.every(c => num(c) !== null)) groups = groups.slice().sort((a, b) => num(a) - num(b));
  if (!groups.length && db.some(q => q.category === sec)) groups = [sec];
  return { exF, chF, groups };
}
function vtxGroupName(folder, code) {
  const m = String(folder).match(/^(\S+)-\d+\s+(.+)$/);
  return m && (m[1] === code || /^#?\d+$/.test(m[1].replace('#', ''))) ? m[2] : folder;
}
// 答え → 「意味：」の書き方（(名詞①)価値/(名詞②)価値観/(他動詞)～を重んじる → 名 ①価値 ②価値観　他 ～を重んじる）
function vtxMean(ans) {
  const a = String(ans || '');
  if (!a.startsWith('(')) return a;
  const parts = a.split(/\/(?=\()/), segs = [];
  for (const p of parts) {
    const m = p.match(/^\(([^()]+?)([①②③④⑤⑥⑦⑧⑨]?)\)([\s\S]*)$/);
    if (!m || !VTX_POS_INV[m[1]]) return a;
    segs.push({ pos: VTX_POS_INV[m[1]], circ: !!m[2], t: m[3] });
  }
  const groups = [];
  segs.forEach(s => { const g = groups[groups.length - 1]; if (g && g.pos === s.pos && s.circ) g.ts.push(s.t); else groups.push({ pos: s.pos, ts: [s.t], circ: s.circ }); });
  return groups.map(g => g.pos + ' ' + (g.ts.length > 1 || g.circ ? g.ts.map((t, i) => VT_CIRC[i] + t).join(' ') : g.ts[0])).join('　');
}
function vtxStars(n) { n = Number(n) || 0; return n > 0 ? ' ' + '★'.repeat(Math.min(5, n)) : ''; }
// 番号 → { base, k（派生語）, j（表現の何番目） }
function vtxNo(no) {
  if (no === null || no === undefined || !Number.isFinite(Number(no))) return null;
  const n = Number(no), base = Math.floor(n + 1e-9), x = Math.round((n - base) * 10000);
  return { base, k: Math.floor(x / 100), j: x % 100 };
}
function vtxExprText(c, type) {
  if (type === 'phrase') return `◆${c.question}「${String(c.answer).replace(/^\(熟語\)/, '')}」`;
  const [en, ...ja] = String(c.question).split('\n');
  return `▶ ${en.replace('（　　　）', `**${c.answer}**`)}「${ja.join(' ')}」`;
}
// Check! の書き方
function vtxCheckLine(c) {
  const q = String(c.question), a = String(c.answer);
  if (q === vtxStrip(a) + VTX_ACC_Q) return `アクセント → ${a}`;
  if (Array.isArray(c.choices) && c.choices.length >= 2) {
    const idx = c.choices.findIndex(x => String(x) === a);
    const list = c.choices.map((x, i) => `${i + 1}. ${x}`).join(' / ');
    if (idx >= 0) return q.includes('（　　　）') ? `${q.replace('（　　　）', `（${list}）`)} → ${idx + 1}` : `${q}：${list} → ${idx + 1}`;
  }
  return `${q.replace(/\n/g, ' ')} → ${a.replace(/\n/g, ' ')}`;
}
// 自動で作られるカードか（書き出さない）
function vtxAuto(c, chF) {
  if (c.kind === 'test' && c.category === chF && /（　　　）に入るのは？$/.test(c.question)) return true;
  if (c.kind === 'test' && /^\S+（[^）]+）の(アクセント位置|発音)は？/.test(c.question)) return true;
  return false;
}

// 1つのセクションを書く。{ text, src: 元のカード, groupsOrder, exF, chF, skipped: 書けなかったカード }
function vtxSection(sec) {
  const code = vtCode(sec), { exF, chF, groups } = vtxFolders(sec);
  const sortNo = arr => (typeof sortCardsByNumber === 'function' ? sortCardsByNumber(arr.slice()) : arr);
  const exprs = {}; // base → [{ k, j, type, card }]
  const skipped = [];
  const addExpr = (c, type) => {
    const n = vtxNo(c.no);
    if (!n || !n.j) { skipped.push({ c, why: '番号が無い（どの語の表現か分からない）' }); return; }
    (exprs[n.base] = exprs[n.base] || []).push({ k: n.k, j: n.j, type, card: c });
  };
  if (chF) db.filter(q => q.category === chF).forEach(c => { if (vtxAuto(c, chF)) return; if (!c.kind && /^\(熟語\)/.test(c.answer)) addExpr(c, 'phrase'); else skipped.push({ c, why: 'チャンツのフォルダーの熟語ではないカード' }); });
  if (exF) db.filter(q => q.category === exF).forEach(c => { if (c.kind === 'cloze' && /（　　　）/.test(c.question)) addExpr(c, 'example'); else skipped.push({ c, why: '例文のフォルダーの例文（空欄つき）ではないカード' }); });
  const used = new Set();
  const L = [`# SECTION ${sec}`];
  const parent = getCategoryParent(sec);
  if (parent) L.push(`// 保存先：${getCategoryPath(parent).join('>')}`);
  groups.forEach(gf => {
    const cards = db.filter(q => q.category === gf && (gf !== sec || true));
    if (!cards.length) return;
    L.push('', `■グループ：${vtxGroupName(gf, code)}`);
    const intro = cards.find(c => c.kind === 'intro');
    if (intro) {
      const parts = String(intro.answer || '').split('\n\n');
      const body = parts.filter(p => !p.startsWith('🗺️ 図')).join('\n\n').trim(), figs = parts.filter(p => p.startsWith('🗺️ 図'));
      if (body) L.push(`（導入：${body}）`);
      figs.forEach(f => { const [h, ...rest] = f.split('\n'); const t = (h.match(/^🗺️ 図(?:（(.*)）)?$/) || [])[1]; L.push(`図${t ? `（${t}）` : ''}：${rest.shift() || ''}`, ...rest); });
    }
    const words = sortNo(cards.filter(c => !c.kind));
    const mains = [], derivedOf = {};
    let xi = 0;
    words.forEach(c => {
      const n = vtxNo(c.no);
      if (!n) { mains.push({ c, tag: 'x' + (++xi) }); return; }
      if (n.j) { skipped.push({ c, why: '表現の番号を持つ単語のカード' }); return; }
      if (n.k) (derivedOf[n.base] = derivedOf[n.base] || []).push({ c, k: n.k });
      else mains.push({ c, base: n.base });
    });
    mains.forEach(m => {
      const c = m.c, [w0, ...qx] = String(c.question).split('\n');
      L.push(`[No.${m.tag || m.base}] ${w0}${vtxStars(c.stars)}`);
      qx.forEach(x => L.push(`問題：${x}`));
      if (Array.isArray(c.choices) && c.choices.length >= 2) { L.push(`意味：${c.answer}`); L.push(`選択肢：${c.choices.join('／')}`); }
      else L.push(`意味：${vtxMean(c.answer)}`);
      String(c.note || '').split('\n').map(x => x.trim()).filter(Boolean).forEach(x => L.push(x.startsWith('関連：') ? `関連語注記：${x.slice(3)}` : `補足：${x}`));
      if (m.base === undefined) { used.add(c.id); return; }
      const ex = (exprs[m.base] || []).filter(e => e.k === 0).sort((a, b) => a.j - b.j || (a.type < b.type ? -1 : 1));
      if (ex.length) { L.push(`表現：${ex.map(e => vtxExprText(e.card, e.type)).join('／')}`); ex.forEach(e => used.add(e.card.id)); }
      (derivedOf[m.base] || []).sort((a, b) => a.k - b.k).forEach(d => {
        const notes = String(d.c.note || '').split('\n').map(x => x.trim()).filter(Boolean);
        const dex = (exprs[m.base] || []).filter(e => e.k === d.k).sort((a, b) => a.j - b.j);
        dex.forEach(e => used.add(e.card.id));
        L.push(`${m.base}-${d.k} ${d.c.question}${vtxStars(d.c.stars)}｜${[vtxMean(d.c.answer), ...notes, ...dex.map(e => vtxExprText(e.card, e.type))].join('／')}`);
        used.add(d.c.id);
      });
      used.add(c.id);
    });
    Object.entries(derivedOf).forEach(([b, list]) => { if (!mains.some(m => m.base === Number(b))) list.forEach(d => skipped.push({ c: d.c, why: `派生語の元の語（No.${b}）が無い` })); });
    const tests = sortNo(cards.filter(c => c.kind === 'test' && !vtxAuto(c, chF)));
    if (tests.length) { L.push('Check!：'); tests.forEach(c => L.push(`● ${vtxCheckLine(c)}`)); }
    cards.filter(c => c.kind && !['test', 'intro'].includes(c.kind)).forEach(c => skipped.push({ c, why: `この形のカード（${c.kind}）は単語帳の形で書けない` }));
  });
  Object.values(exprs).flat().forEach(e => { if (!used.has(e.card.id)) skipped.push({ c: e.card, why: `元の語（No.${vtxNo(e.card.no).base}）が無い` }); });
  return { text: L.join('\n') + '\n', sec, code, exF, chF, groups };
}

// 書いたテキストを読み直して、元のカードと同じになるか確かめる。{ same, diffs: [文] }
function vtxVerify(r) {
  const parsed = vtParse(r.text), gen = vtCards(parsed, r.sec).cards;
  const usedGroups = r.groups.filter(g => db.some(q => q.category === g));
  const map = {};
  usedGroups.forEach((g, i) => { map[`${r.code}-${i + 1} ${(parsed.groups[i] || {}).name}`] = g; });
  map[`${r.code} 例文`] = r.exF; map[`${r.code} チャンツ`] = r.chF;
  const key = (cat, q, a, kind, choices, no, stars) => [cat, String(q).trim(), String(a).trim(), kind || '', JSON.stringify(choices || null), vtxNoKey(no), Number(stars) || 0].join('\u0001');
  const srcCats = new Set([...usedGroups, r.exF, r.chF].filter(Boolean));
  const src = new Map(), got = new Map();
  db.filter(q => srcCats.has(q.category)).forEach(c => { if (c.kind === 'intro') return; const k = key(c.category, c.question, c.answer, c.kind, c.choices, c.kind === 'test' ? null : c.no, c.stars); src.set(k, c); });
  gen.forEach(c => { if (c.kind === 'intro') return; const k = key(map[c.folder], c.q, c.a, c.kind, c.choices, c.kind === 'test' ? null : c.no, c.stars); got.set(k, c); });
  const diffs = [];
  src.forEach((c, k) => { if (!got.has(k) && !vtxAuto(c, r.chF)) diffs.push(`・${c.category}：${String(c.question).split('\n')[0]} → ${String(c.answer).slice(0, 30)}`); });
  got.forEach((c, k) => { if (!src.has(k)) diffs.push(`・（読み込むと増える）${map[c.folder] || c.folder}：${String(c.q).split('\n')[0]} → ${String(c.a).slice(0, 30)}`); });
  return { same: !diffs.length, diffs };
}
// 書き出し（選んだフォルダーから）
function vtxExport(cats) {
  const secs = [...new Set(cats.flatMap(vtxSectionsOf))];
  // 中のセクションがほかのセクションの中にあるときは重ねない
  const top = secs.filter(s => !secs.some(o => o !== s && getAllSubcategories(o).includes(s) && vtxIsSection(o)));
  const outs = top.map(vtxSection);
  const text = outs.map(o => o.text).join('\n');
  const checks = outs.map(o => ({ sec: o.sec, v: vtxVerify(o) }));
  const n = outs.reduce((s, o) => s + db.filter(q => [...o.groups, o.exF, o.chF].includes(q.category)).length, 0);
  return { text, n, checks, secs: top };
}
