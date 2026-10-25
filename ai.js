// ================================================================
// ★【0.03.15】AI（Google AI Studio の Gemini ／ OpenRouter の無料モデル）
//  ・意味で採点：完全一致で不正解だったとき、同じ意味なら正解にする
//  ・AIヒント：答えを言わずに思い出す手がかり。間違えたときは「なぜ違うか・覚え方」も
//  ・PDF・写真の読み取り：単語帳取込でカード候補にする（PDF は Gemini）
// APIキーはサイトに埋め込まない。各自が入力するか、家族の誰かが入力したキーを「家族として登録した人だけ」が使える
//  （Firestore：susuru_anki_ai/{uid} は本人だけ、susuru_anki_ai_family/{ownerUid} は本人と members だけが読める）
// ================================================================
const AI_KEYS_LOCAL = 'susuru_anki_ai_keys';
const AI_PREFS_KEY = 'susuru_anki_ai_prefs';
const AI_HINT_CACHE_KEY = 'susuru_anki_ai_hints';
const AI_USAGE_KEY = 'susuru_anki_ai_usage';
const AI_COL = 'susuru_anki_ai';
const AI_FAMILY_COL = 'susuru_anki_ai_family';

let _aiFamilyKeys = [];   // [{ owner, ownerName, keys: { gemini: [], openrouter: [] } }]
let _aiFamilyDoc = null;  // 自分が家族に共有している設定 { members: [], share: bool }
const _aiCooldown = {};   // { key: 再開できる時刻 }（上限に達したキーをしばらく休ませる）
let _aiLastModel = '';

function cleanAiKey(k) { return String(k || '').replace(/[\s　 ﻿]/g, ''); }
function parseKeyList(v) { return [...new Set((Array.isArray(v) ? v : String(v || '').split(/[\n,]+/)).map(cleanAiKey).filter(k => k.length >= 10))]; }

function getAiPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(AI_PREFS_KEY) || '{}') || {}; } catch (e) {}
  return { judge: p.judge !== false, hint: p.hint !== false, explainAuto: !!p.explainAuto };
}
function saveAiPrefs(p) { try { localStorage.setItem(AI_PREFS_KEY, JSON.stringify(p)); } catch (e) {} }

function getMyAiKeys() {
  let k = {};
  try { k = JSON.parse(localStorage.getItem(AI_KEYS_LOCAL) || '{}') || {}; } catch (e) {}
  return { gemini: parseKeyList(k.gemini), openrouter: parseKeyList(k.openrouter) };
}
// 使えるキー（自分のキー → 家族のキーの順）
function allAiKeys() {
  const mine = getMyAiKeys();
  const out = { gemini: [...mine.gemini], openrouter: [...mine.openrouter] };
  _aiFamilyKeys.forEach(f => {
    parseKeyList(f.keys && f.keys.gemini).forEach(k => { if (!out.gemini.includes(k)) out.gemini.push(k); });
    parseKeyList(f.keys && f.keys.openrouter).forEach(k => { if (!out.openrouter.includes(k)) out.openrouter.push(k); });
  });
  return out;
}
function aiAvailable() { const k = allAiKeys(); return k.gemini.length + k.openrouter.length > 0; }

function countAiUsage() {
  try {
    const u = JSON.parse(localStorage.getItem(AI_USAGE_KEY) || '{}');
    const today = localDateStr();
    const n = u.date === today ? (u.n || 0) + 1 : 1;
    localStorage.setItem(AI_USAGE_KEY, JSON.stringify({ date: today, n }));
  } catch (e) {}
}
function aiUsageToday() {
  try { const u = JSON.parse(localStorage.getItem(AI_USAGE_KEY) || '{}'); return u.date === localDateStr() ? (u.n || 0) : 0; } catch (e) { return 0; }
}

// ---------------- モデル一覧 ----------------
const GEMINI_FALLBACK_MODELS = ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite', 'gemini-flash-latest'];
let _geminiModels = null;
async function geminiModels(key) {
  if (_geminiModels) return _geminiModels;
  try {
    const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`, {}, 8000);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const ids = (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => String(m.name || '').replace(/^models\//, ''))
      .filter(id => /^gemini-/.test(id) && /flash/.test(id) && !/(image|tts|audio|live|embedding|thinking|exp|vision|8b)/.test(id));
    const ver = id => { const m = id.match(/gemini-(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
    // 速いもの（lite）・新しいもの・正式版を先に
    ids.sort((a, b) => (/lite/.test(b) - /lite/.test(a)) || (ver(b) - ver(a)) || (/preview/.test(a) - /preview/.test(b)));
    _geminiModels = ids.length ? [...new Set([...ids.slice(0, 6), ...GEMINI_FALLBACK_MODELS])] : GEMINI_FALLBACK_MODELS;
  } catch (e) { _geminiModels = GEMINI_FALLBACK_MODELS; }
  return _geminiModels;
}
const OPENROUTER_FALLBACK_MODELS = ['google/gemini-2.0-flash-exp:free', 'meta-llama/llama-3.3-70b-instruct:free', 'deepseek/deepseek-chat-v3-0324:free', 'qwen/qwen-2.5-72b-instruct:free', 'mistralai/mistral-small-3.1-24b-instruct:free'];
let _orModels = null;
async function openrouterModels(needImage) {
  if (!_orModels) {
    try {
      const res = await fetchWithTimeout('https://openrouter.ai/api/v1/models', {}, 8000);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      _orModels = (data.data || []).filter(m => /:free$/.test(m.id)).map(m => {
        const t = (m.id + ' ' + (m.name || '')).toLowerCase();
        let s = 0;
        if (/gemini/.test(t)) s += 40;
        if (/llama-3\.3-70b|llama-4/.test(t)) s += 30;
        if (/deepseek-chat|deepseek-v3/.test(t)) s += 28;
        if (/qwen/.test(t)) s += 22;
        if (/mistral-small|gemma-3/.test(t)) s += 15;
        if (/r1|reason|think|qwq|coder/.test(t)) s -= 30; // 考える時間が長いものは採点には向かない
        if ((m.context_length || 0) < 8000) s -= 20;
        const img = ((m.architecture && m.architecture.input_modalities) || []).includes('image') || /vision|vl/.test(t);
        return { id: m.id, s, img };
      }).sort((a, b) => b.s - a.s);
      if (!_orModels.length) throw new Error('no free models');
    } catch (e) { _orModels = OPENROUTER_FALLBACK_MODELS.map((id, i) => ({ id, s: 10 - i, img: /gemini/.test(id) })); }
  }
  return _orModels.filter(m => !needImage || m.img).map(m => m.id);
}

// opts.signal を渡すと、外からも止められる（ほかのモデルが先に答えたとき）
function fetchWithTimeout(url, opts, ms) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), ms) : null;
  const outer = opts && opts.signal;
  if (ctl && outer) { if (outer.aborted) ctl.abort(); else outer.addEventListener('abort', () => ctl.abort(), { once: true }); }
  const o = Object.assign({}, opts); delete o.signal;
  return fetch(url, Object.assign(o, ctl ? { signal: ctl.signal } : {})).finally(() => { if (t) clearTimeout(t); });
}

// ---------------- 呼び出し ----------------
// parts: [{ text }] または [{ text }, { mime, data(base64) }]
async function callGemini(key, model, system, parts, { json, maxTokens, timeout, signal }) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: parts.map(p => p.data ? { inline_data: { mime_type: p.mime, data: p.data } } : { text: p.text }) }],
    generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens || 512 }
  };
  if (json) body.generationConfig.responseMimeType = 'application/json';
  if (/2\.5-flash/.test(model)) body.generationConfig.thinkingConfig = { thinkingBudget: 0 }; // 考える時間を省いて速く返す
  const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal
  }, timeout || 15000);
  if (!res.ok) { const e = new Error('Gemini ' + res.status); e.status = res.status; e.detail = await res.text().catch(() => ''); throw e; }
  const data = await res.json();
  const text = ((data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || []).map(p => p.text || '').join('');
  if (!text.trim()) { const e = new Error('Gemini empty'); e.status = 0; throw e; }
  return text;
}
async function callOpenRouter(key, model, system, parts, { maxTokens, timeout, signal }) {
  const content = parts.some(p => p.data)
    ? parts.map(p => p.data ? { type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.data}` } } : { type: 'text', text: p.text })
    : parts.map(p => p.text).join('\n');
  const res = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'HTTP-Referer': location.origin, 'X-Title': 'susuru anki' },
    body: JSON.stringify({ model, temperature: 0.2, max_tokens: maxTokens || 512, messages: [{ role: 'system', content: system }, { role: 'user', content }] }),
    signal
  }, timeout || 20000);
  if (!res.ok) { const e = new Error('OpenRouter ' + res.status); e.status = res.status; e.detail = await res.text().catch(() => ''); throw e; }
  const data = await res.json();
  const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  if (!String(text).trim()) { const e = new Error('OpenRouter empty'); e.status = 0; throw e; }
  return String(text);
}

// キー・モデルを順番に試す。opts: { json, maxTokens, timeout, needPdf, needImage, totalTimeout }
// ★【0.03.19】Gemini は、ふだん1秒ほどで返すのに、ときどき数十秒止まることがある。
//  そこで、少し待っても返ってこなければ次のモデルにも同時に頼み、先に返ってきた方を使う（残りは止める）
const AI_HEDGE_MS = 3500;       // 文字だけのとき、次のモデルにも頼むまでの時間
const AI_HEDGE_FILE_MS = 25000; // PDF・写真のとき
async function aiRequest(system, parts, opts = {}) {
  const keys = allAiKeys();
  const hasFile = parts.some(p => p.data);
  const started = Date.now();
  const limit = opts.totalTimeout || 30000;
  const errors = [];
  const cooling = id => (_aiCooldown[id] || 0) > Date.now();
  const tryOne = async (fn, key, model, label, signal) => {
    try {
      const t = await fn();
      _aiLastModel = label;
      countAiUsage();
      return t;
    } catch (e) {
      if (signal && signal.aborted) return null; // ほかのモデルが先に答えたので止めた
      errors.push(`${label}: ${e.message}`);
      const d = e.detail || '';
      if (e.status === 401 || e.status === 403 || (e.status === 400 && /API_KEY_INVALID|API key not valid/i.test(d))) _aiCooldown[key] = Date.now() + 3600 * 1000; // キーが使えない
      else if (e.status === 402) _aiCooldown[key] = Date.now() + 3600 * 1000; // そのキーの上限
      else if (e.status === 429) {
        // Gemini の無料枠の上限はモデルごと（1分に15回・1日の回数）。OpenRouter の1日の上限はキーごと
        const perDay = /PerDay|per-day|per day|daily/i.test(d);
        const rd = Number((d.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/) || [])[1]) || 0;
        if (perDay && /^OpenRouter/.test(label)) _aiCooldown[key] = Date.now() + 3600 * 1000;
        else _aiCooldown[key + '|' + model] = Date.now() + (perDay ? 3600 * 1000 : Math.min(120, Math.max(5, rd || 60)) * 1000);
      }
      else if (e.status === 503 || e.status === 500) _aiCooldown[key + '|' + model] = Date.now() + 30 * 1000; // 混んでいる
      else if (e.status === 404 || e.status === 400) _aiCooldown[key + '|' + model] = Date.now() + 3600 * 1000; // そのモデルは使えない
      return null;
    }
  };
  // 候補を順に始め、hedgeMs たっても返ってこなければ次の候補も同時に始める（同時に3つまで）
  const race = (cands, hedgeMs) => new Promise(resolve => {
    let idx = 0, running = 0, done = false, hedgeTimer = null;
    const ctls = [];
    const finish = v => { if (done) return; done = true; clearTimeout(hedgeTimer); clearTimeout(limitTimer); ctls.forEach(c => c.abort()); resolve(v); };
    const limitTimer = setTimeout(() => finish(null), Math.max(0, limit - (Date.now() - started)));
    const launch = () => {
      if (done) return;
      clearTimeout(hedgeTimer);
      while (idx < cands.length) {
        const c = cands[idx++];
        if (cooling(c.key) || cooling(c.key + '|' + c.model)) continue;
        const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        if (ctl) ctls.push(ctl);
        running++;
        tryOne(() => c.run(ctl ? ctl.signal : undefined), c.key, c.model, c.label, ctl && ctl.signal).then(t => {
          running--;
          if (done) return;
          if (t) return finish(t);
          launch(); // 失敗したらすぐ次へ
        });
        hedgeTimer = setTimeout(() => { if (running < 3) launch(); }, hedgeMs);
        return;
      }
      if (running === 0) finish(null);
    };
    launch();
  });
  const gem = [];
  for (const key of keys.gemini) {
    if (cooling(key)) continue;
    const models = (await geminiModels(key)).slice(0, 5);
    models.forEach(m => gem.push({ key, model: m, label: `Gemini ${m}`, run: signal => callGemini(key, m, system, parts, Object.assign({}, opts, { signal })) }));
  }
  let t = gem.length ? await race(gem, hasFile ? AI_HEDGE_FILE_MS : AI_HEDGE_MS) : null;
  if (t) return t;
  if (!opts.needPdf && Date.now() - started < limit) {
    const or = [];
    for (const key of keys.openrouter) {
      if (cooling(key)) continue;
      const models = (await openrouterModels(hasFile)).slice(0, 4);
      models.forEach(m => or.push({ key, model: m, label: `OpenRouter ${m.replace(/:free$/, '')}`, run: signal => callOpenRouter(key, m, system, parts, Object.assign({}, opts, { signal })) }));
    }
    t = or.length ? await race(or, hasFile ? AI_HEDGE_FILE_MS : AI_HEDGE_MS * 2) : null;
    if (t) return t;
  }
  const err = new Error(keys.gemini.length + keys.openrouter.length ? 'AIに接続できませんでした（回数の上限・通信を確認してください）' : 'APIキーが設定されていません');
  err.details = errors;
  console.warn('AI request failed:', errors);
  throw err;
}

function parseAiJson(text) {
  const s = String(text || '').replace(/```(?:json)?/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('JSONではない応答');
  return JSON.parse(s.slice(a, b + 1));
}

// ---------------- スペルミスの見分け ----------------
// 何文字直せば同じになるか（となり合う2文字の入れ替え＝recieve なども1回と数える）
function editDistance(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => { const r = new Array(n + 1).fill(0); r[0] = i; return r; });
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[m][n];
}
// イギリス式・アメリカ式のつづりの違いはそろえる
function usUkFold(w) { return w.replace(/our(s?)$/, 'or$1').replace(/our(?=[a-z])/g, 'or').replace(/([^aeiou])re(s?)$/, '$1er$2').replace(/is(e|es|ed|ing|ation|ations)$/, 'iz$1').replace(/ll(ed|ing|er)$/, 'l$1').replace(/ogue$/, 'og'); }
// 英語の答えが、正解の英語のどれかと1〜2文字だけ違うとき、その正解を返す（同じなら null）
function englishSpellingSlip(given, expected) {
  const g = String(given || '').toLowerCase().replace(/[^a-z' -]/g, '').replace(/\s+/g, ' ').trim();
  if (!g || !/^[a-z' -]+$/.test(g) || g.length < 3) return null;
  const words = String(expected || '').split(/[\/|、,，;；\u3000]+/).map(w => w.replace(/\([^()]*\)|（[^（）]*）|[\[\]［］～〜~…]/g, ' ').toLowerCase().replace(/[^a-z' -]/g, '').replace(/\s+/g, ' ').trim()).filter(w => w.length >= 3);
  if (!words.length || words.includes(g) || words.some(w => usUkFold(w) === usUkFold(g))) return null;
  for (const w of words) {
    const d = editDistance(g, w);
    if (d > 0 && d <= (w.length >= 8 ? 2 : 1)) return w;
  }
  return null;
}

// ---------------- 用途別 ----------------
const AI_JUDGE_SYSTEM = [
  'あなたは暗記カードの採点係です。問題・正解・解答者の答えを見て、解答者の答えが「正解と同じ意味で、内容として間違っていないか」を判定します。',
  '・表記の違い（ひらがな/カタカナ/漢字の書き分け、送り仮名、全角/半角、大文字/小文字、句読点、語順の小さな違い）、言い換え、同義語は正解。',
  '・英単語や熟語の和訳では、辞書で同じ意味として載っている、品詞が同じ訳語なら正解（例：「理由」と「根拠」はどちらも名詞なので正解）。',
  '・つづり・字の誤りは厳しく不正解（issue は "spelling"）：英語のスペルミス（1文字の違い・抜け・入れ替えも。例：receive に recieve、necessary に neccesary）、漢字の誤字（例：感情 に 感状、専門 に 専問）。イギリス式とアメリカ式のつづりの違い（colour/color、centre/center）は誤りではない。',
  '・品詞の誤りも厳しく不正解（issue は "pos"）：正解が動詞なのに名詞で答えた（「を放棄する」に「放棄」、decide に decision）、形容詞なのに名詞・動詞（「残忍な」に「残忍さ」、happy に happiness）、副詞なのに形容詞（quickly に quick）、他動詞の訳（〜を…させる）に自動詞の訳（…する）など。意味が近くても品詞が違えば不正解。ただし「野蛮な」と「野蛮」のような、語尾の「な」「の」の有無だけの違いは正解。',
  '・意味が違う、反対の意味、大事な部分が欠けている、余計な誤りを含む答えは不正解。',
  '・化学・数学などは、物質・値・式が同じなら正解。',
  '・厳しすぎず、甘すぎず。迷ったら不正解。',
  '・正しい内容だが一部しか答えていない（例：意味が2つある答えの片方だけ、必要な語句が欠けている）は "partial"（解答不足）。',
  '出力は次のJSONだけ：{"results":[{"verdict":"correct か partial か wrong","correct":true,"issue":"正解でないときの理由の種類：spelling（つづり・字の誤り）か pos（品詞の誤り）か meaning（意味の誤り・不足）。正解なら none","reason":"40字以内の理由","hint":"正解でないとき、答えを言わずに、足りない部分・違う部分に気づかせる短いヒント（50字以内。正解の語・その一部・頭文字・文字数・訳語は書かない。問題の語の説明ではなく、正解を思い出すための手がかりにする）"}],"tip":"不正解があるとき、次に覚えるための短い覚え方（60字以内。正解を含めてよい）。全部正解なら空文字"}',
  'correct は verdict が correct のときだけ true。results は与えた項目と同じ順番・同じ数にすること。'
].join('\n');
// items: [{ label, expected, given }]
async function aiJudgeAnswers(question, items, note) {
  const lines = [`問題：${question}`];
  if (note) lines.push(`参考メモ：${String(note).slice(0, 300)}`);
  items.forEach((it, i) => lines.push(`項目${i + 1}${it.label ? `（${it.label}）` : ''}\n  正解：${it.expected}\n  解答者の答え：${it.given || '（空欄）'}`));
  const text = await aiRequest(AI_JUDGE_SYSTEM, [{ text: lines.join('\n') }], { json: true, maxTokens: 400, timeout: 12000, totalTimeout: 20000 });
  const j = parseAiJson(text);
  const results = (Array.isArray(j.results) ? j.results : []).slice(0, items.length).map(r => {
    const v = String(r.verdict || '').toLowerCase();
    const verdict = /correct/.test(v) ? 'correct' : /partial/.test(v) ? 'partial' : (r.correct === true || r.correct === 'true') && !v ? 'correct' : 'wrong';
    const issue = verdict === 'correct' ? '' : (String(r.issue || '').match(/spelling|pos|meaning/) || [''])[0];
    return { verdict, correct: verdict === 'correct', issue, reason: cleanAiHintText(r.reason), hint: cleanAiHintText(r.hint) };
  });
  if (results.length !== items.length) throw new Error('判定の数が合いません');
  // ★【0.03.22】英語の答えで、正解と1〜2文字だけ違うものはスペルミス（AI が甘く判定しても不正解にする）
  results.forEach((r, i) => {
    if (!r.correct) return;
    const miss = englishSpellingSlip(items[i].given, items[i].expected);
    if (miss) Object.assign(r, { verdict: 'wrong', correct: false, issue: 'spelling', reason: `スペルミス（${miss}）`, hint: r.hint || 'つづりをもう一度確かめましょう' });
  });
  return { results, tip: String(j.tip || ''), model: _aiLastModel };
}

// ★【0.03.20】手がかりは「正解」を思い出すためのもの。問題の語の説明（「〜を表す英単語」「頭文字は〜」）や、正解の文字を漏らすものにしない
const AI_HINT_RULES = [
  '・解答者には「問題」だけが見えていて、「正解」を思い出そうとしている。手がかりは正解を思い出すためのものにする。',
  '・問題の語そのものの説明（「〜を表す英単語です」「〜という意味の動詞です」、問題の語のつづり・頭文字・文字数・品詞）は書かない。解答者はもう問題を見ているので手がかりにならない。',
  '・正解の語そのもの、その一部（漢字1字・単語の一部も）、頭文字、文字数、読み、訳語は書かない（文字のヒントは別に出る）。',
  '・使ってよいもの：正解が指す内容の説明、使われる場面、似た意味の別の語、反対の意味の語、関連する事柄、例文（正解の部分は＿＿にする）、文字の種類（ひらがな/漢字/英字など）。',
  '・正解が英語で問題が日本語のときは、問題の日本語を言い換えるだけでは手がかりにならない。例文（正解の部分は＿＿）、よく一緒に使う語、反対の意味の英単語などを使う。',
  '例）問題「decide」正解「決める」：×「dから始まる6文字の動詞です」×「何かを判断することを表す英単語です」○「いくつかの中から、迷うのをやめて1つを選ぶこと」',
  '例）問題「決める」正解「decide」：×「dから始まる英単語」×「決めることを表す英単語」○「I can\'t ＿＿ which to buy. のように使う」'
];
const AI_HINT_SYSTEM = [
  'あなたは暗記カードの家庭教師です。正解を思い出すための「手がかり」を、正解を言わずに1〜2文（60字以内）で出します。',
  ...AI_HINT_RULES,
  '出力は手がかりの文だけ。'
].join('\n');
async function aiHintFor(card) {
  const cache = loadAiHintCache();
  const sig = String(card.answer || '').slice(0, 60);
  const c = cache[card.id];
  if (c && c.a === sig) return c.h;
  const lines = [`問題（解答者に見えている）：${card.question}`, `正解（解答者が思い出したいもの。書いてはいけない）：${card.answer}`];
  if (card.note) lines.push(`メモ：${String(card.note).slice(0, 300)}`);
  let h = (await aiRequest(AI_HINT_SYSTEM, [{ text: lines.join('\n') }], { maxTokens: 200, timeout: 12000, totalTimeout: 20000 })).trim();
  h = cleanAiHintText(h);
  if (typeof maskAnswerInText === 'function') h = maskAnswerInText(h, card.answer); // 念のため答えを伏せる
  cache[card.id] = { h, a: sig, t: Date.now() };
  saveAiHintCache(cache);
  return h;
}
// AI の文の後ろに付くことがある「（40字）」や、全体を囲むかぎかっこを外す
function cleanAiHintText(h) {
  h = String(h || '').trim().replace(/\s*[（(]\s*\d+\s*(文字|字)\s*(以内)?\s*[）)]\s*$/, '').trim();
  if (/^「[^「」]*」$/.test(h) || /^"[^"]*"$/.test(h)) h = h.slice(1, -1);
  return h;
}
function loadAiHintCache() { try { return JSON.parse(localStorage.getItem(AI_HINT_CACHE_KEY) || '{}') || {}; } catch (e) { return {}; } }
function saveAiHintCache(c) {
  const ids = Object.keys(c);
  if (ids.length > 1500) ids.sort((a, b) => (c[a].t || 0) - (c[b].t || 0)).slice(0, ids.length - 1500).forEach(k => delete c[k]);
  try { localStorage.setItem(AI_HINT_CACHE_KEY, JSON.stringify(c)); } catch (e) {}
}

const AI_EXPLAIN_SYSTEM = [
  'あなたは暗記カードの家庭教師です。解答者が間違えた問題について、短く解説します。',
  '出力は次のJSONだけ：{"explain":"なぜ違うのか（解答者の答えがあれば、正解との違い）。60字以内","tip":"次に思い出すための覚え方・語源・語呂合わせなど。60字以内。正解を含めてよい","hint":"次に同じ問題で迷ったときの、正解を言わない手がかり（50字以内）"}',
  'hint は、次の決まりを必ず守る（explain と tip は正解を含めてよいが、hint はだめ）：',
  ...AI_HINT_RULES
].join('\n');
async function aiExplainMistake(card, given) {
  const lines = [`問題：${card.question}`, `正解：${card.answer}`, `解答者の答え：${given || '（答えられなかった）'}`];
  if (card.note) lines.push(`メモ：${String(card.note).slice(0, 300)}`);
  const j = parseAiJson(await aiRequest(AI_EXPLAIN_SYSTEM, [{ text: lines.join('\n') }], { json: true, maxTokens: 300, timeout: 12000, totalTimeout: 20000 }));
  return { explain: cleanAiHintText(j.explain), tip: cleanAiHintText(j.tip), hint: cleanAiHintText(j.hint), model: _aiLastModel };
}

// ================================================================
// ★【0.03.18】AI のヒントの記憶（この端末にだけ保存）
//  答えられなかった・間違えた・足りなかったときに AI が出したヒント（答えを伏せたもの）を、カード（意味）ごとに覚えておく。
//  同じ状況（同じ間違い・また答えられない）になったら AI を呼ばずにそれを出す。
//  何度も必要になったヒントは、次からは解いている途中のヒントにも出す。
// ================================================================
const AI_MEMORY_KEY = 'susuru_anki_ai_memory';
const AI_MEMORY_KINDS = { blank: '答えられなかったとき', wrong: '間違えたとき', partial: '足りなかったとき', hint: 'ヒント' };
function aiMemKey(cur) { return (cur._swapped ? 'swap:' : '') + (cur._sourceId || cur.id) + (cur._senseKey ? '\u0001' + cur._senseKey : ''); }
function aiMemNorm(g) { try { return typeof normalizeAnswer === 'function' ? normalizeAnswer(g || '') : String(g || '').trim(); } catch (e) { return String(g || '').trim(); } }
function loadAiMemory() { try { return JSON.parse(localStorage.getItem(AI_MEMORY_KEY) || '{}') || {}; } catch (e) { return {}; } }
function saveAiMemory(m) {
  const keys = Object.keys(m);
  if (keys.length > 3000) keys.sort((a, b) => (m[a].t || 0) - (m[b].t || 0)).slice(0, keys.length - 3000).forEach(k => delete m[k]);
  try { localStorage.setItem(AI_MEMORY_KEY, JSON.stringify(m)); } catch (e) {}
}
function aiMemEntry(mem, cur) {
  const key = aiMemKey(cur);
  const sig = String(cur.answer || '').slice(0, 80);
  let e = mem[key];
  if (!e || e.a !== sig) e = mem[key] = { a: sig, items: [], t: Date.now() }; // 答えを書き換えたら覚え直す
  return e;
}
// 同じ状況のヒントを探す（答えられなかった・ヒントは1つ、間違い・不足は同じ答えのとき）
function findAiMemItem(e, kind, given) {
  const g = aiMemNorm(given);
  return e.items.find(it => it.k === kind && (kind === 'blank' || kind === 'hint' || it.g === g));
}
// 覚えたヒントを使う（使った回数を数える）。無ければ null
function recallAiHint(cur, kind, given) {
  const mem = loadAiMemory();
  const key = aiMemKey(cur);
  const e = mem[key];
  if (!e || e.a !== String(cur.answer || '').slice(0, 80)) return null;
  const it = findAiMemItem(e, kind, given);
  if (!it || !it.h) return null;
  it.n = (it.n || 1) + 1; it.t = Date.now(); e.t = Date.now();
  saveAiMemory(mem);
  return it.h;
}
// AI が出したヒントを覚える
function rememberAiHint(cur, kind, given, hint) {
  if (!hint) return;
  let h = String(hint).trim();
  if (typeof maskAnswerInText === 'function') h = maskAnswerInText(h, cur.answer); // 念のため答えを伏せる
  const mem = loadAiMemory();
  const e = aiMemEntry(mem, cur);
  const it = findAiMemItem(e, kind, given);
  if (it) { it.h = h; it.n = (it.n || 1) + 1; it.t = Date.now(); }
  else e.items.push({ k: kind, g: (kind === 'blank' || kind === 'hint') ? '' : aiMemNorm(given), h, n: 1, t: Date.now() });
  e.items.sort((a, b) => (b.n || 1) - (a.n || 1) || (b.t || 0) - (a.t || 0));
  e.items = e.items.slice(0, 6);
  e.t = Date.now();
  saveAiMemory(mem);
}
// 解いている途中に出す、覚えたヒント（何度も必要になったもの）
function aiMemoryHintsFor(cur, minCount = 2) {
  const e = loadAiMemory()[aiMemKey(cur)];
  if (!e || e.a !== String(cur.answer || '').slice(0, 80)) return [];
  return e.items.filter(it => it.h && (it.n || 1) >= minCount).slice(0, 2);
}
// 重点モード：間違えた（または答えられなかった）ときの、答え直すためのヒント
async function aiRetryHint(cur, kind, given) {
  if (kind === 'blank') return aiHintFor({ id: 'retry:' + aiMemKey(cur), question: cur.question + (cur._senseLabel ? `（${cur._senseLabel}）` : ''), answer: getPrimaryAnswer(cur.answer), note: cur.note });
  const r = await aiExplainMistake({ question: cur.question + (cur._senseLabel ? `（${cur._senseLabel}）` : ''), answer: cur.answer, note: cur.note }, given);
  let h = r.hint || '';
  if (typeof maskAnswerInText === 'function') h = maskAnswerInText(h, cur.answer);
  return h;
}

// PDF・画像をカード候補の文字（見出し語<TAB>答え）に変換する
async function aiReadVocabFile(file, onStatus) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (file.size > 18 * 1024 * 1024) throw new Error(`「${file.name}」が大きすぎます（18MBまで）。ページを分けてください`);
  let mime = file.type || (isPdf ? 'application/pdf' : 'image/jpeg');
  let data;
  if (isPdf) data = await fileToBase64(file);
  else { const url = await compressImageToDataURL(file, 2000, 0.9); data = url.split(',')[1]; mime = 'image/jpeg'; }
  if (isPdf && !allAiKeys().gemini.length) throw new Error('PDF の読み取りには Google AI Studio（Gemini）のキーが必要です（写真なら OpenRouter でも読めます）');
  if (onStatus) onStatus(`🤖 「${file.name}」をAIで読み取り中...（ページが多いと1分ほどかかります）`);
  const text = await aiRequest('あなたは単語帳・問題集を暗記カードに変換する係です。指示に正確に従い、余計な説明は書きません。',
    [{ text: VOCAB_AI_PROMPT }, { mime, data }], { needPdf: isPdf, maxTokens: 8192, timeout: 120000, totalTimeout: 180000 });
  return text.replace(/```[a-z]*\n?/g, '').trim();
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// ---------------- クラウド（キーの保存・家族の共有） ----------------
async function loadAiKeysFromCloud() {
  if (!currentUser) return;
  try {
    const snap = await firestore.collection(AI_COL).doc(currentUser.uid).get();
    const d = snap.exists ? snap.data() : null;
    const local = getMyAiKeys();
    if (d && d.keys && !local.gemini.length && !local.openrouter.length) {
      try { localStorage.setItem(AI_KEYS_LOCAL, JSON.stringify({ gemini: parseKeyList(d.keys.gemini), openrouter: parseKeyList(d.keys.openrouter) })); } catch (e) {}
    }
  } catch (e) { console.warn('AIキーの読み込みに失敗:', e.message); }
  try {
    const fam = await firestore.collection(AI_FAMILY_COL).doc(currentUser.uid).get();
    _aiFamilyDoc = fam.exists ? fam.data() : null;
  } catch (e) { _aiFamilyDoc = null; }
  try {
    const snap = await firestore.collection(AI_FAMILY_COL).where('members', 'array-contains', currentUser.uid).get();
    _aiFamilyKeys = snap.docs.map(d => d.data()).filter(d => d.share !== false && d.owner !== currentUser.uid);
  } catch (e) { _aiFamilyKeys = []; console.warn('家族のAIキーを読めませんでした:', e.message); }
  renderAiSettings();
}
async function saveMyAiKeys(keys) {
  try { localStorage.setItem(AI_KEYS_LOCAL, JSON.stringify(keys)); } catch (e) {}
  _geminiModels = null;
  if (!currentUser) return;
  try { await firestore.collection(AI_COL).doc(currentUser.uid).set({ keys, updatedAt: Date.now() }, { merge: true }); }
  catch (e) { alert('⚠️ キーをアカウントに保存できませんでした（この端末には保存しました）。Firestore のルールを確認してください。'); }
  // 家族に共有しているなら、共有しているキーも新しくする
  if (_aiFamilyDoc && _aiFamilyDoc.share !== false && (_aiFamilyDoc.members || []).length) await saveAiFamily(_aiFamilyDoc.members, true);
}
async function saveAiFamily(members, share) {
  if (!currentUser) return alert('家族と共有するにはログインしてください。');
  const uniq = [...new Set(members.map(s => String(s).trim()).filter(s => s && s !== currentUser.uid))].slice(0, 20);
  const doc = { owner: currentUser.uid, ownerName: currentUser.displayName || '家族', members: uniq, share: !!share, keys: getMyAiKeys(), updatedAt: Date.now() };
  try {
    await firestore.collection(AI_FAMILY_COL).doc(currentUser.uid).set(doc);
    _aiFamilyDoc = doc;
  } catch (e) { alert('⚠️ 家族との共有を保存できませんでした。Firestore のルール（docs/ai-setup.md）を確認してください。'); }
  renderAiSettings();
}

// ---------------- 設定画面 ----------------
function onAiPrefChange() {
  const p = getAiPrefs();
  ['judge', 'hint', 'explainAuto'].forEach(k => { const el = document.getElementById('chkAi_' + k); if (el) p[k] = el.checked; });
  saveAiPrefs(p);
}
async function onSaveAiKeys() {
  const keys = { gemini: parseKeyList(document.getElementById('txtAiGemini').value), openrouter: parseKeyList(document.getElementById('txtAiOpenRouter').value) };
  await saveMyAiKeys(keys);
  renderAiSettings();
  alert(`✅ 保存しました（Gemini ${keys.gemini.length}個・OpenRouter ${keys.openrouter.length}個）`);
}
async function onTestAi() {
  const st = document.getElementById('aiTestStatus');
  st.innerText = '🤖 接続テスト中...';
  try {
    const r = await aiJudgeAnswers('reason（英単語の意味）', [{ expected: '理由', given: '根拠' }], '');
    st.innerText = `✅ つながりました（${r.model}）：「理由」と「根拠」→ ${r.results[0].correct ? '正解' : '不正解'}（${r.results[0].reason}）`;
  } catch (e) { st.innerText = '⚠️ ' + e.message + (e.details && e.details.length ? '\n' + e.details.slice(-3).join('\n') : ''); }
}
async function onSaveAiFamily() {
  const members = document.getElementById('txtAiFamily').value.split(/[\s,、]+/);
  const share = document.getElementById('chkAiFamilyShare').checked;
  if (share && !getMyAiKeys().gemini.length && !getMyAiKeys().openrouter.length) return alert('先に自分のAPIキーを保存してください。');
  await saveAiFamily(members, share);
  alert(share ? '✅ 家族に共有しました。家族がログインすると、このキーで AI を使えます。' : '✅ 共有を止めました。');
}
async function addAiFamilyFromFriend() {
  const sel = document.getElementById('selAiFamilyFriend');
  if (!sel || !sel.value) return;
  const ta = document.getElementById('txtAiFamily');
  const list = ta.value.split(/[\s,、]+/).filter(Boolean);
  if (!list.includes(sel.value)) list.push(sel.value);
  ta.value = list.join('\n');
}
async function loadAiFriendOptions() {
  const sel = document.getElementById('selAiFamilyFriend');
  if (!sel || !currentUser) return;
  try {
    const me = await firestore.collection('susuru_anki_profiles').doc(currentUser.uid).get();
    const friends = (me.exists && me.data().friends) || [];
    const opts = await Promise.all(friends.slice(0, 30).map(async uid => {
      try { const p = await firestore.collection('susuru_anki_profiles').doc(uid).get(); return { uid, name: (p.exists && p.data().displayName) || uid.slice(0, 8) }; } catch (e) { return { uid, name: uid.slice(0, 8) }; }
    }));
    sel.innerHTML = '<option value="">フレンドから選ぶ...</option>' + opts.map(o => `<option value="${escapeHtml(o.uid)}">${escapeHtml(o.name)}</option>`).join('');
  } catch (e) {}
}

function renderAiSettings() {
  const box = document.getElementById('aiSettings');
  if (!box) return;
  const p = getAiPrefs();
  const mine = getMyAiKeys();
  const fam = _aiFamilyDoc || { members: [], share: false };
  const famFrom = _aiFamilyKeys.map(f => escapeHtml(f.ownerName || '家族')).join('・');
  box.innerHTML = `
    <div class="hint-small" style="margin-bottom:8px;">${aiAvailable()
      ? `✅ AI を使えます（${[mine.gemini.length ? `自分の Gemini ${mine.gemini.length}` : '', mine.openrouter.length ? `自分の OpenRouter ${mine.openrouter.length}` : '', famFrom ? `${famFrom} さんのキー` : ''].filter(Boolean).join('・')}）。今日の利用 ${aiUsageToday()} 回`
      : '🔑 APIキーを入れると、AI の採点・ヒント・読み取りが使えます（家族が共有してくれた場合は入力不要）'}</div>
    <label class="toggle-pill" style="display:flex; gap:8px; align-items:center;"><input type="checkbox" id="chkAi_judge" ${p.judge ? 'checked' : ''} onchange="onAiPrefChange()">✅ 記述式で、意味が同じなら正解にする</label>
    <label class="toggle-pill" style="display:flex; gap:8px; align-items:center; margin-top:6px;"><input type="checkbox" id="chkAi_hint" ${p.hint ? 'checked' : ''} onchange="onAiPrefChange()">💡 「🤖 AIヒント」ボタンを出す（間違えたときの「AIの解説」も）</label>
    <label class="toggle-pill" style="display:flex; gap:8px; align-items:center; margin-top:6px;"><input type="checkbox" id="chkAi_explainAuto" ${p.explainAuto ? 'checked' : ''} onchange="onAiPrefChange()">🧑‍🏫 間違えたら自動でAIの解説を出す（回数を多く使います）</label>
    <details style="margin-top:10px;" ${mine.gemini.length || mine.openrouter.length ? '' : 'open'}>
      <summary class="hint-small" style="cursor:pointer;">🔑 自分のAPIキー</summary>
      <label class="section-label" style="margin-top:8px;">Google AI Studio（Gemini）<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style="font-size:0.75rem; margin-left:6px;">キーを作る</a></label>
      <textarea id="txtAiGemini" class="form-control" rows="2" placeholder="AIza... や AQ. で始まるキー（複数なら1行に1つ）" autocomplete="off" spellcheck="false" style="font-family:'JetBrains Mono',monospace; font-size:0.8rem;">${escapeHtml(mine.gemini.join('\n'))}</textarea>
      <label class="section-label" style="margin-top:8px;">OpenRouter<a href="https://openrouter.ai/keys" target="_blank" rel="noopener" style="font-size:0.75rem; margin-left:6px;">キーを作る</a></label>
      <textarea id="txtAiOpenRouter" class="form-control" rows="2" placeholder="sk-or-...（複数なら1行に1つ）" autocomplete="off" spellcheck="false" style="font-family:'JetBrains Mono',monospace; font-size:0.8rem;">${escapeHtml(mine.openrouter.join('\n'))}</textarea>
      <div class="form-row" style="margin-top:8px;">
        <button class="btn" onclick="onSaveAiKeys()">💾 保存</button>
        <button class="btn btn-secondary" onclick="onTestAi()">🔌 接続テスト</button>
      </div>
      <div id="aiTestStatus" class="hint-small" style="margin-top:6px; white-space:pre-line;"></div>
      <div class="hint-small" style="margin-top:6px;">キーはこの端末と、ログイン中なら自分のアカウントにだけ保存されます（サイトには載りません）。PDF の読み取りは Gemini のキーで使えます。</div>
    </details>
    <details style="margin-top:10px;" ${fam.members && fam.members.length ? 'open' : ''}>
      <summary class="hint-small" style="cursor:pointer;">👨‍👩‍👧 家族に自分のキーを使ってもらう</summary>
      <div class="hint-small" style="margin:6px 0;">家族のUID（設定画面の「あなたのUID」）を1行に1人ずつ入れて保存すると、その人たちはキーを入力しなくても、ログインするだけであなたのキーで AI を使えます。キーは登録した家族だけが読めるように保存され、サイトには載りません（無料枠の回数は家族で共有になります）。</div>
      <div class="form-row"><select id="selAiFamilyFriend" class="form-control"><option value="">フレンドから選ぶ...</option></select><button class="btn btn-secondary" style="width:auto; padding:0 12px;" onclick="addAiFamilyFromFriend()">追加</button></div>
      <textarea id="txtAiFamily" class="form-control" rows="3" style="margin-top:6px; font-family:'JetBrains Mono',monospace; font-size:0.75rem;" placeholder="家族のUID（1行に1人）">${escapeHtml((fam.members || []).join('\n'))}</textarea>
      <label class="toggle-pill" style="display:flex; gap:8px; align-items:center; margin-top:6px;"><input type="checkbox" id="chkAiFamilyShare" ${fam.share !== false && (fam.members || []).length ? 'checked' : ''}>この家族にキーを使ってもらう</label>
      <button class="btn btn-secondary" style="margin-top:8px;" onclick="onSaveAiFamily()">👨‍👩‍👧 保存</button>
    </details>
    <div class="hint-small" style="margin-top:10px;">※ AI に送るのは問題・答え・自分の答え（読み取りではファイル）だけです。無料枠では、送った内容がサービスの改善に使われることがあります。AI の判定は間違えることもあるので、そのときは「やっぱり不正解」「正解にする」で直してください。</div>
  `;
  loadAiFriendOptions();
}
