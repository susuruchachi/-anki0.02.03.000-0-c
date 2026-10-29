// ================================================================
// ★【0.03.45】📄 テキストから暗記テスト・クイズの問題を作る
// 単語帳を書き起こしたテキスト（試作の「鉄壁 暗記テスト」と同じ形）を読み取って、すするanki のカードにして保存する。
//  ・# SECTION … ／ ■グループ：名前 ／（導入：…）／ [No.1000] value ★★ ／ 意味：名 ①価値 ②価値観　他 ～を重んじる ／
//    品詞属性： ／ 補足： ／ 表現：◆熟語「訳」／▶ 例文「訳」 ／ 関連語注記： ／ 派生語：（1000-1 valuable｜形 貴重な／★メモ／◆…／▶…）／
//    Check!：（● 問題 → 答え）
//  ・保存先：選んだフォルダーの下に「セクション」→「グループ」のフォルダー。例文は「セクション 例文」フォルダー（上から出題しない）
//  ・カード：単語（答えは (名詞①)価値/(名詞②)価値観/(他動詞)～を重んじる の形）、派生語、熟語（◆）、例文（▶、kind:'cloze'）、
//    Check!（kind:'test'。番号の選択肢・アクセントは選択肢つき）、導入の文（kind:'intro'）
//  ・同じフォルダーに同じ問題があれば、増やさずに書き換える（成績はそのまま）
// ================================================================
const VT_POS = { '名': '名詞', '他': '他動詞', '自': '自動詞', '形': '形容詞', '副': '副詞', '前': '前置詞', '接': '接続詞', '句': '熟語', '動': '動詞', '代': '代名詞', '助': '助動詞' };
const VT_POS_RE = /^(名|他|自|形|副|前|接|句|動|代|助)(?=[\s　（(①②③④⑤⑥⑦⑧⑨]|$)/;
const VT_CIRC = '①②③④⑤⑥⑦⑧⑨';

// カッコ・かぎカッコの外にある区切りで分ける
function vtSplitTop(s, seps) {
  const out = []; let cur = '', d = 0;
  for (const ch of String(s || '')) {
    if ('「［[（('.includes(ch)) d++;
    else if ('」］]）)'.includes(ch)) d = Math.max(0, d - 1);
    if (d === 0 && seps.includes(ch)) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}

// ---------------- 読み取り ----------------
function vtParse(text) {
  const out = { title: '', groups: [], skipped: [] };
  const byNo = {}, seenChk = new Set();
  let g = null, w = null, mode = '', intro = null;
  const finishIntro = () => { if (g && intro !== null) { const t = intro.replace(/）\s*$/, '').trim(); if (t.length > (g.intro || '').length) g.intro = t; } intro = null; };
  const introClosed = s => { let d = 1; for (const ch of s) { if (ch === '（') d++; else if (ch === '）') d--; } return d <= 0; };
  const pushCheck = s => { s = String(s || '').trim(); if (!s || !g) return; if (seenChk.has(s)) return; seenChk.add(s); g.checks.push(s); };
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const l = raw.trim();
    if (intro !== null) {
      if (/^(\[No\.|■|Check!?[：:])/i.test(l)) finishIntro();
      else { if (l) intro += '\n' + l; if (introClosed(intro)) finishIntro(); continue; }
    }
    if (!l || /^-{3,}$|^={3,}$/.test(l)) continue;
    let m;
    if (!out.groups.length && (m = l.match(/^#+\s*(.+)$/))) { out.title = m[1].trim(); continue; }
    if ((m = l.match(/^■\s*グループ\s*[：:]\s*(.+)$/))) {
      const name = m[1].trim();
      g = out.groups.find(x => x.name === name) || null;
      if (!g) { g = { name, intro: '', items: [], checks: [] }; out.groups.push(g); }
      w = null; mode = ''; continue;
    }
    if (l.startsWith('■')) { if (!out.groups.length && !out.title) out.title = l.replace(/^■\s*/, ''); g = null; continue; }
    // グループの見出しが無い単語帳：最初の [No.] で「単語」グループを作る
    if (!g && /^\[No\./.test(l)) { g = out.groups.find(x => x.name === '単語') || null; if (!g) { g = { name: '単語', intro: '', items: [], checks: [] }; out.groups.push(g); } }
    if (!g) continue;
    if (/^（導入[：:]/.test(l)) { intro = l.replace(/^（導入[：:]\s*/, ''); if (introClosed(intro)) finishIntro(); continue; }
    if ((m = l.match(/^Check!?\s*[：:]\s*(.*)$/i))) { mode = 'check'; w = null; if (m[1]) pushCheck(m[1]); continue; }
    if ((m = l.match(/^\[No\.\s*([^\]]+)\]\s*(.+?)\s*(★*)$/))) {
      mode = 'item';
      const no = m[1].trim(), nw = { no, w: m[2].trim(), stars: m[3].length, mean: '', attr: '', notes: [], exprs: [], related: [], derived: [] };
      // 同じ番号がもう一度出てきたら（貼り付けの重なりなど）、前のものを置き換える（グループは前のまま）
      if (byNo[no]) { Object.keys(nw).forEach(k => { byNo[no][k] = nw[k]; }); w = byNo[no]; }
      else { byNo[no] = nw; g.items.push(nw); w = nw; }
      continue;
    }
    if (mode === 'check') { if (/^[●・\-–]/.test(l)) pushCheck(l.replace(/^[●・\-–]\s*/, '')); else if (/→/.test(l)) pushCheck(l); continue; }
    if (!w) { out.skipped.push(l); continue; }
    if ((m = l.match(/^(意味|品詞属性|補足|表現|関連語注記|派生語)\s*[：:]\s*(.*)$/))) {
      mode = m[1]; const v = m[2].trim();
      if (mode === '意味') w.mean = v;
      else if (mode === '品詞属性') w.attr = v;
      else if (mode === '補足') { if (v) w.notes.push(v.replace(/^★\s*/, '')); }
      else if (mode === '表現') w.exprs.push(...vtSplitTop(v, '／'));
      else if (mode === '関連語注記') { if (v) w.related.push(v); }
      continue;
    }
    if ((m = l.match(/^(\d+)-(\d+)\s+(.+?)\s*(★*)\s*｜\s*(.+)$/))) {
      const parts = vtSplitTop(m[5], '／');
      const d = { no: m[1] + '-' + m[2], k: Number(m[2]), w: m[3].trim(), stars: m[4].length, mean: parts[0] || '', notes: [], exprs: [] };
      parts.slice(1).forEach(p => { if (/^[◆▶]/.test(p)) d.exprs.push(p); else d.notes.push(p.replace(/^★\s*/, '')); });
      if (!w.derived.some(x => x.no === d.no)) w.derived.push(d);
      mode = '派生語'; continue;
    }
    if (mode === '表現') { w.exprs.push(...vtSplitTop(l, '／')); continue; }
    if (mode === '補足') { w.notes.push(l); continue; }
    if (mode === '関連語注記') { w.related.push(l); continue; }
    out.skipped.push(l);
  }
  finishIntro();
  return out;
}

// 「名 ①価値 ②価値観　他 ～を重んじる」→「(名詞①)価値/(名詞②)価値観/(他動詞)～を重んじる」
function vtMeaning(s, head) {
  s = String(s || '').trim();
  if (!s) return '';
  const chunks = s.split(/[\s　]+(?=(?:名|他|自|形|副|前|接|句|動|代|助)(?:[\s　（(①②③④⑤⑥⑦⑧⑨]))/);
  const segs = [];
  chunks.forEach((ch, ci) => {
    ch = ch.trim(); if (!ch) return;
    // 英単語の意味の行の先頭は必ず品詞（AI が「自起こる」のように空白を抜かすことがある）
    const m = ch.match(VT_POS_RE) || (ci === 0 && /^[\x00-\x7F’]+$/.test(String(head || '')) ? ch.match(/^(名|他|自|形|副|前|接|句|動|代|助)(?=[～〜(（\u3040-\u30ff\u4e00-\u9fff])/) : null);
    const pos = m ? VT_POS[m[1]] : '';
    const body = m ? ch.slice(1).trim() : ch;
    let senses = /[①②③④⑤⑥⑦⑧⑨]/.test(body) ? body.split(/[①②③④⑤⑥⑦⑧⑨]/).map(x => x.trim()).filter(Boolean) : vtSplitTop(body, '；;');
    if (!senses.length) senses = [body];
    const fix = t => vtSplitTop(t, '，,').join('　'); // 並べた訳は全角スペースで（それぞれ別の意味として答える）
    senses.forEach((t, i) => segs.push({ label: pos ? pos + (senses.length > 1 ? VT_CIRC[i] || '' : '') : '', text: fix(t) }));
  });
  if (segs.length === 1 && !segs[0].label) return segs[0].text;
  if (segs.some(x => !x.label)) return segs.map(x => x.text).join('　');
  return segs.map(x => `(${x.label})${x.text}`).join('/');
}
function vtPlainMeaning(s) { return String(vtMeaning(s)).replace(/\([^()]*\)/g, '').replace(/\//g, '／'); }

// 表現：◆熟語「訳」（＝…） → 熟語のカード。▶ 例文「訳」・ふつうの語句「訳」 → 例文のカード（太字 **…** を空欄に）
function vtExpr(e, head) {
  e = String(e || '').trim();
  if (e.startsWith('◆')) {
    const m = e.slice(1).trim().match(/^(.+?)「([^」]+)」(.*)$/);
    if (!m) return null;
    return { type: 'phrase', q: m[1].trim().replace(/\*\*/g, ''), a: `(熟語)${vtSplitTop(m[2].trim(), '，,').join('　')}${m[3].trim()}` };
  }
  const m = e.replace(/^▶\s*/, '').match(/^(.+?)「([^」]+)」\s*$/);
  if (!m || !/[A-Za-z]/.test(m[1])) return null;
  let en = m[1].trim(); const ja = m[2].trim();
  let target = null;
  const b = en.match(/\*\*([^*]+)\*\*/);
  if (b) { target = b[1].trim(); en = en.replace(b[0], '（　　　）').replace(/\*\*/g, ''); }
  else {
    const hw = String(head || '').split(/\s+/)[0].toLowerCase(), stem = hw.length > 5 ? hw.slice(0, hw.length - 2) : hw;
    const re = new RegExp('\\b' + stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "[A-Za-z']*", 'i');
    const f = stem && en.match(re);
    if (!f) return null;
    target = f[0]; en = en.replace(re, '（　　　）');
  }
  return { type: 'example', q: `${en}\n${ja}`, a: target };
}

// Check!：問題 → 答え。番号の選択肢（1. … / 2. …）・アクセントは選択肢つきにする
function vtAccentChoices(a) {
  const nfd = String(a).normalize('NFD'), k = nfd.indexOf('́') - 1, base = nfd.replace(/[̀-ͯ]/g, '');
  if (k < 0) return null;
  const cl = [...base.matchAll(/[aeiouy]+/gi)].map(m => ({ p: m.index, l: m[0].length }));
  const mk = p => (base.slice(0, p + 1) + '́' + base.slice(p + 1)).normalize('NFC');
  const right = String(a).normalize('NFC');
  const opts = [...new Set(cl.map(c => (k >= c.p && k < c.p + c.l) ? right : mk(c.p)))];
  if (!opts.includes(right)) opts.unshift(right);
  const i = opts.indexOf(right), keep = opts.filter(o => o !== right).slice(0, 3);
  keep.splice(Math.min(i, keep.length), 0, right);
  return keep.length >= 2 ? keep : null;
}
// 1つの Check! から問題の配列（アクセントで「a / b」と2語あれば2問。元の試作と同じ）
function vtChecks(raw) {
  const s = String(raw || '').trim(), k = s.lastIndexOf('→');
  if (k < 0) return [];
  const q = s.slice(0, k).trim(), a = s.slice(k + 1).trim();
  if (/アクセント/.test(q) && /[\/／]/.test(a)) return a.split(/[\/／]/).map(x => x.trim()).filter(Boolean).map(x => vtCheck(`${q} → ${x}`)).filter(Boolean);
  const x = vtCheck(s); return x ? [x] : [];
}
function vtCheck(raw) {
  const s = String(raw || '').trim(), k = s.lastIndexOf('→');
  if (k < 0) return null;
  let q = s.slice(0, k).trim(), a = s.slice(k + 1).trim();
  if (!q || !a) return null;
  if (/アクセント/.test(q)) {
    const ch = vtAccentChoices(a);
    const w = String(a).normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (ch) return { q: `${w} のアクセント位置は？（強く読む母音に ´ が付いたものを選ぶ）`, a: a.normalize('NFC'), choices: ch };
    return { q, a };
  }
  const opts = [...q.matchAll(/(\d)\.\s*([^\/／()（）]+?)\s*(?=[\/／)）]|$)/g)];
  if (opts.length >= 2 && /^\d\.?$/.test(a)) {
    const choices = opts.map(o => o[2].trim()), idx = opts.findIndex(o => o[1] === a[0]);
    if (idx >= 0) {
      let qq = q.replace(/[（(]\s*1\.[^)）]*[)）]/, '（　　　）');
      if (qq === q) qq = q.split(/[：:]/)[0].trim();
      return { q: qq, a: choices[idx], choices };
    }
  }
  return { q, a };
}

// ---------------- カードにする ----------------
function vtSectionName(title) {
  const t = String(title || '').trim();
  const m = t.match(/SECTION\s*(#?\s*\d+)\s*[「『]?([^」』]*)[」』]?/i);
  if (m) return `#${m[1].replace(/[#\s]/g, '')}${m[2] ? ' ' + m[2].trim() : ''}`;
  return t.replace(/[「」『』]/g, ' ').replace(/\s+/g, ' ').trim();
}
function vtCode(section) { const m = String(section).match(/#\d+/); return m ? m[0] : String(section).split(/\s+/)[0]; }
// 読み取った結果から、作るカードの一覧（フォルダーはまだ作らない）
function vtCards(parsed, section) {
  const code = vtCode(section), exFolder = `${code} 例文`, chFolder = `${code} チャンツ`;
  const cards = [], folders = [], seenPhrase = new Set();
  const add = c => cards.push(c);
  parsed.groups.forEach((g, gi) => {
    const folder = `${code}-${gi + 1} ${g.name}`; // 番号を付けて、本の順に並ぶように
    folders.push(folder);
    if (g.intro) add({ folder, q: '📖 導入の文', a: g.intro, kind: 'intro' });
    g.items.forEach(w => {
      const base = parseInt(w.no, 10);
      const ans = vtMeaning(w.mean, w.w);
      if (ans) add({ folder, q: w.w, a: ans, note: [...w.notes, ...w.related.map(r => '関連：' + r)].join('\n'), stars: w.stars, no: Number.isFinite(base) ? base : null, head: w.w, mean: w.mean });
      const exprs = w.exprs.map(e => ({ e, head: w.w, mean: w.mean }));
      w.derived.forEach(d => {
        const a = vtMeaning(d.mean, d.w);
        if (a) add({ folder, q: d.w, a, note: d.notes.join('\n'), stars: d.stars, no: Number.isFinite(base) ? base + d.k / 100 : null, head: d.w, mean: d.mean });
        d.exprs.forEach(e => exprs.push({ e, head: d.w, mean: d.mean }));
      });
      exprs.forEach(({ e, head, mean }, j) => {
        const x = vtExpr(e, head); if (!x) return;
        if (x.type === 'phrase') {
          const key = x.q.toLowerCase(); if (seenPhrase.has(key)) return; seenPhrase.add(key);
          // ◆の熟語は「チャンツ」フォルダーへ（元の試作と同じく暗記テストには出さない。クイズ・週間プランのチャンツで）
          add({ folder: chFolder, q: x.q, a: x.a, no: Number.isFinite(base) ? base + (j + 1) / 10000 : null, note: `${head}：${vtPlainMeaning(mean)}` });
        } else add({ folder: exFolder, q: x.q, a: x.a, kind: 'cloze', note: `${head}：${vtPlainMeaning(mean)}`, no: Number.isFinite(base) ? base : null });
      });
    });
    g.checks.forEach(c => vtChecks(c).forEach(x => add({ folder, q: x.q, a: x.a, kind: 'test', choices: x.choices || null })));
  });
  return { cards, folders, exFolder, chFolder, code };
}

// 保存する（同じフォルダーに同じ問題・同じ形式のカードがあれば書き換える）
function vtSave(parsed, parentCat, section) {
  const { cards, folders, exFolder, chFolder } = vtCards(parsed, section);
  const pre = parentCat ? getCategoryPath(parentCat).join('>') + '>' : '';
  const sec = ensureCategoryPath(pre + section);
  // ほかの場所に同じ名前のフォルダーがあれば、名前を変えて作る（フォルダー名はアプリ全体で1つ）
  const nameMap = {};
  const hasEx = cards.some(c => c.folder === exFolder), hasCh = cards.some(c => c.folder === chFolder);
  [...folders, ...(hasCh ? [chFolder] : []), ...(hasEx ? [exFolder] : [])].forEach(f => {
    let n = f;
    if (categories.includes(n) && getCategoryParent(n) !== sec) n = `${f}（${section}）`;
    nameMap[f] = ensureCategoryPath(pre + section + '>' + n);
  });
  // 例文・チャンツは上のフォルダーから出題しない（週間プランの例文・チャンツで）
  catSkip = catSkip || {};
  if (hasEx) catSkip[nameMap[exFolder]] = true;
  if (hasCh) catSkip[nameMap[chFolder]] = true;
  let added = 0, updated = 0; const touched = new Set();
  cards.forEach(c => {
    const cat = nameMap[c.folder]; touched.add(cat);
    const kind = c.kind || '';
    const ex = db.find(d => d.category === cat && String(d.question).trim() === String(c.q).trim() && (d.kind || '') === kind);
    if (ex) {
      if (ex.sharedDocId && getSharedAccess(ex.sharedDocId).readOnly) return;
      let ch = false;
      const set = (f, v) => { if (v === undefined || v === null || v === '') return; if (JSON.stringify(ex[f]) !== JSON.stringify(v)) { ex[f] = v; ch = true; } };
      set('answer', c.a); set('note', c.note); set('choices', c.choices); set('stars', c.stars || null); set('no', c.no);
      if (ch) { touchCard(ex); updated++; }
      return;
    }
    const card = { id: newCardId(), question: c.q, answer: c.a, category: cat, level: 0, correct: 0, incorrect: 0, streak: 0, wrongStreak: 0, shikkariStreak: 0 };
    if (c.note) card.note = c.note;
    if (kind) card.kind = kind;
    if (c.choices) card.choices = c.choices;
    if (c.stars) card.stars = c.stars;
    if (c.no !== null && c.no !== undefined) card.no = c.no;
    const info = getCategoryShareInfo(cat);
    if (info.shared && info.canEdit) card.sharedDocId = info.docId;
    touchCard(card); db.push(card); added++;
  });
  autoMerge();
  saveData(true);
  if (typeof pushSharedDocsForCategories === 'function') pushSharedDocsForCategories([...touched]);
  return { section: sec, added, updated };
}

// ---------------- 画面（🧠 暗記タブ） ----------------
let _vt = null;
function vtOpen() {
  if (typeof _drillActive !== 'undefined' && _drillActive) return;
  const A = document.getElementById('drillApp');
  A.innerHTML = `<div class="card"><div class="setting-box-title">📄 テキストから問題を作る</div>
    <div class="hint-small">単語帳を書き起こしたテキストを貼るか、.txt ファイルを選んでください。読み取った問題は、暗記テストにもクイズにも使えるカードとして保存します。<br>読み取れる行：# SECTION … ／ ■グループ：… ／（導入：…）／ [No.1000] value ★★ ／ 意味：名 ①価値 ②価値観　他 ～を重んじる ／ 補足： ／ 表現：◆熟語「訳」／▶ 例文「訳」 ／ 関連語注記： ／ 派生語：（1000-1 valuable｜形 貴重な／★メモ）／ Check!：（● 問題 → 答え）</div>
    <div class="drill-sub"><label class="chip" style="cursor:pointer;">🤖 PDF・写真をAIで読み取る<input type="file" id="vtAiFile" accept="image/*,application/pdf" multiple style="display:none;"></label><button class="chip" onclick="vtCopyPrompt()">📋 ほかのAIに頼むプロンプトをコピー</button></div>
    <div id="vtAiStatus" class="hint-small" style="margin-top:4px;"></div>
    <textarea id="vtText" class="form-control" rows="9" style="margin-top:8px;" placeholder="ここに貼り付け">${dE((_vt && _vt.text) || '')}</textarea>
    <input type="file" id="vtFile" accept=".txt,.md,text/plain" class="form-control" style="margin-top:6px;">
    <label class="section-label" style="font-weight:500; margin-top:8px;">📁 保存先（親フォルダー）</label>
    <select id="vtParent" class="form-control"><option value="">（いちばん上）</option>${buildCategoryOptionsHTML(new Set(), false)}</select>
    <label class="section-label" style="font-weight:500; margin-top:8px;">🏷️ フォルダー名（読み取ると自動で入ります）</label>
    <input id="vtName" class="form-control" value="${dE((_vt && _vt.name) || '')}" placeholder="例：#26 価値・基準・選択・出来事・参加">
    <div class="drill-btns" style="margin-top:10px;"><button class="btn btn-primary" onclick="vtPreview()">🔍 読み取る</button><button class="btn btn-secondary" onclick="_vt=null; drillHome()">戻る</button></div>
    <div id="vtResult"></div></div>`;
  const sel = document.getElementById('vtParent');
  const def = (_vt && _vt.parent !== undefined) ? _vt.parent : (categories.includes('鉄壁') ? '鉄壁' : '');
  sel.value = def;
  document.getElementById('vtAiFile').onchange = e => vtAiRead([...e.target.files]);
  document.getElementById('vtFile').onchange = e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { document.getElementById('vtText').value = r.result; vtPreview(); }; r.readAsText(f); };
}
// ★【0.03.50】PDF・写真を AI でテキスト版に書き写して、そのまま読み取る
async function vtAiRead(files) {
  const st = document.getElementById('vtAiStatus');
  if (!files.length) return;
  if (typeof aiAvailable !== 'function' || !aiAvailable()) { st.innerHTML = '<span class="drill-ng">AI のキーが設定されていません（⚙️ 設定 →「🤖 AI」。PDF は Gemini のキー）</span>'; return; }
  const ta = document.getElementById('vtText');
  try {
    for (let i = 0; i < files.length; i++) {
      const t = await aiReadVocabFile(files[i], msg => { st.textContent = `(${i + 1}/${files.length}) ${msg}`; });
      ta.value = (ta.value.trim() ? ta.value.trim() + '\n\n' : '') + t;
    }
    st.textContent = '✅ 読み取りました。下の結果を確かめてから保存してください（テキストは直せます。直したら「🔍 読み取る」）';
    vtPreview();
  } catch (e) { st.innerHTML = `<span class="drill-ng">⚠️ ${dE(e.message || '読み取りに失敗しました')}</span>`; }
}
async function vtCopyPrompt() {
  try { await navigator.clipboard.writeText(VOCAB_TEXT_PROMPT); showAppToast('📋 プロンプトをコピーしました。AI にページと一緒に送って、返ってきたテキストを貼ってください'); }
  catch (e) { const ta = document.getElementById('vtText'); ta.value = VOCAB_TEXT_PROMPT; ta.select(); alert('コピーできなかったので、テキスト欄に入れました。全部選んでコピーしてください（貼るときは消してから）。'); }
}
function vtPreview() {
  const text = document.getElementById('vtText').value;
  const parsed = vtParse(text);
  const nameEl = document.getElementById('vtName');
  if (!nameEl.value.trim()) nameEl.value = vtSectionName(parsed.title) || (parsed.groups[0] ? parsed.groups[0].name : '');
  _vt = { text, parsed, name: nameEl.value.trim(), parent: document.getElementById('vtParent').value };
  const R = document.getElementById('vtResult');
  if (!parsed.groups.length) { R.innerHTML = '<p class="drill-ng">グループ（■グループ：…）が読み取れませんでした。</p>'; return; }
  const { cards } = vtCards(parsed, _vt.name || 'セクション');
  const n = k => cards.filter(c => (c.kind || 'word') === k).length;
  const words = cards.filter(c => !c.kind && !/^\(熟語\)/.test(c.a)).length, phrases = cards.filter(c => !c.kind && /^\(熟語\)/.test(c.a)).length;
  const sample = cards.filter(c => !c.kind).slice(0, 4).map(c => `<div class="hint-small">・${dE(c.q)} → ${dE(c.a)}</div>`).join('');
  R.innerHTML = `<div class="drill-saved" style="margin-top:10px;"><b>📖 読み取り結果</b>
    <div class="hint-small">グループ ${parsed.groups.length} ・ 単語（派生語を含む）${words} ・ 熟語 ${phrases} ・ 例文 ${n('cloze')} ・ Check! ${n('test')} ・ 導入の文 ${n('intro')}</div>
    <div style="margin-top:6px;">${parsed.groups.map(g => `<div class="hint-small">📁 ${dE(g.name)}：${g.items.length}語${g.items.reduce((s, w) => s + w.derived.length, 0) ? `（派生語 ${g.items.reduce((s, w) => s + w.derived.length, 0)}）` : ''}・Check! ${g.checks.length}${g.intro ? '・導入あり' : ''}</div>`).join('')}</div>
    <div style="margin-top:6px;">${sample}</div>
    ${parsed.skipped.length ? `<details style="margin-top:6px;"><summary class="hint-small">読み取らなかった行 ${parsed.skipped.length}</summary>${parsed.skipped.slice(0, 30).map(l => `<div class="hint-small">${dE(l)}</div>`).join('')}</details>` : ''}
    <div class="drill-btns" style="margin-top:8px;"><button class="btn btn-primary" onclick="vtCommit(true)">💾 保存して暗記テストを始める</button><button class="btn btn-secondary" onclick="vtCommit(false)">💾 保存だけ</button></div>
    <div class="hint-small" style="margin-top:4px;">保存すると「${dE(_vt.parent ? _vt.parent + ' › ' : '')}${dE(_vt.name)}」の下にグループごとのフォルダーができます。クイズ（ホームの出題範囲）でもそのまま使えます。</div></div>`;
}
function vtCommit(start) {
  if (!_vt || !_vt.parsed) return;
  const name = (document.getElementById('vtName').value || '').trim() || _vt.name;
  if (!name) return alert('フォルダー名を入れてください。');
  if (typeof invalidCategoryName === 'function' && invalidCategoryName(name)) return alert('そのフォルダー名は使えません。');
  const parent = document.getElementById('vtParent').value;
  if (typeof takeSnapshot === 'function') takeSnapshot(`テキストから問題を作成（${name}）`);
  const r = vtSave(_vt.parsed, parent, name);
  _vt = null;
  if (typeof refreshVisibleViews === 'function') refreshVisibleViews(true);
  try { localStorage.setItem('susuru_anki_drill_cat', r.section); } catch (e) {}
  drillHome();
  if (typeof showAppToast === 'function') showAppToast(`📄 「${r.section}」に保存しました（追加 ${r.added}・更新 ${r.updated}）`);
  if (start && DG.length) drillStart();
}
