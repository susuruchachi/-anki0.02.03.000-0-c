// ================================================================
// ★【0.03.75】🎵 音楽と一緒に流せる読み上げ（iPhone・iPad 向け）
// iPhone・iPad の読み上げ（speechSynthesis）は、ページの設定に関係なく Spotify・YouTube などの音楽を止めてしまう。
// そこで、AI（Gemini の音声合成）で作った声を、ゲームの効果音と同じ Web Audio で鳴らす（navigator.audioSession を
// transient / ambient にすると、音楽を止めずに鳴る）。作った声はこの端末に保存して、同じ文は二度と作らない。
// 使えないとき（AI のキーが無い・回数の上限・オフライン）は、いつもの読み上げにする。
// ================================================================
// ★【0.03.76】読み間違いの少ない順（軽いモデルは後ろ）
const TTS_AI_MODELS = ['gemini-3.8-flash-tts', 'gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts', 'gemini-3.8-flash-lite-tts'];
const TTS_AI_VOICE = 'Kore';
let _ttsCtx = null, _ttsSrc = null, _ttsSeq = 0, _ttsFailNoticed = false, _ttsLastModel = '';
const _ttsCooldown = {}, _ttsPending = new Map(), _ttsMem = new Map();

// 使うか：iPhone・iPad（audioSession がある Safari）で、「音楽を止める」以外を選んでいて、Gemini のキーがあるとき
function ttsUseAi() {
  if (!navigator.audioSession || typeof ttsMixPref !== 'function' || ttsMixPref() === 'stop') return false;
  if (navigator.onLine === false) return false;
  try { return typeof allAiKeys === 'function' && allAiKeys().gemini.length > 0; } catch (e) { return false; }
}
// 読み上げる文（いつもの読み上げと同じ整え方）
function ttsPlainText(text) {
  return ttsSegments(text).map(s => s.t).join(' ');
}
// ★【0.03.80】英語と日本語が混ざった文は、英語の部分と日本語の部分に分けて、それぞれ声を作る
// （まとめて作ると、日本語の声が英語をカタカナ語のように読んでしまう）。
// 1文字だけの大文字（A、B）は、日本語の部分としてカタカナの名前（エー、ビー）で読む
function ttsSegments(text) {
  const div = document.createElement('div');
  div.innerHTML = typeof richTextToSpeech === 'function' ? richTextToSpeech(text) : escapeHtml(String(text || ''));
  const raw = cleanTextForSpeech(div.textContent || div.innerText || '', { noLetters: true });
  if (!raw) return [];
  let segs = isEnglishText(raw) ? [{ ja: false, t: raw }] : splitSpeechSegments(raw);
  segs = segs.map(s => {
    // 英語の部分が「A」「A, B」のような1文字の大文字だけなら、日本語の部分にする
    if (!s.ja && /^[\sA-Z.,、・/&+-]*$/.test(s.t) && !/[A-Z]{2}/.test(s.t)) return { ja: true, t: speechLetters(s.t, true) };
    return s.ja ? { ja: true, t: speechLetters(s.t, true) } : { ja: false, t: s.t };
  });
  const out = [];
  let carry = ''; // 開きかっこだけの部分は、次の部分の頭に付ける
  segs.forEach(s => {
    let t = s.t.trim();
    if (!t || !/[A-Za-z0-9\u3040-\u30ff\u4e00-\u9fff]/.test(t)) { const open = (t.match(/[「『（(【［\[]+$/) || [''])[0]; const rest = t.slice(0, t.length - open.length); if (out.length && rest) out[out.length - 1].t += rest; carry += open; return; }
    // 英語の部分の終わりに付いた開きかっこも次へ
    const tail = !s.ja ? (t.match(/[「『（【［]+$/) || [''])[0] : '';
    if (tail) t = t.slice(0, -tail.length).trim();
    t = carry + t; carry = tail;
    if (out.length && out[out.length - 1].ja === s.ja) out[out.length - 1].t += (s.ja ? '' : ' ') + t; else out.push({ ja: s.ja, t });
  });
  return out;
}

// ---------------- 保存（IndexedDB） ----------------
let _ttsDbP = null;
function ttsDb() {
  if (_ttsDbP) return _ttsDbP;
  _ttsDbP = new Promise((res) => {
    try {
      const rq = indexedDB.open('susuru_anki_tts', 1);
      rq.onupgradeneeded = () => { const d = rq.result; if (!d.objectStoreNames.contains('a')) d.createObjectStore('a'); };
      rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null);
    } catch (e) { res(null); }
  });
  return _ttsDbP;
}
// ★【0.03.77】保存した声は { buf, at }。前の版の声（読み間違いがあったもの）・30日より古い声は消す（そのうち作り直す）
const TTS_CACHE_VER = 'v2|', TTS_CACHE_DAYS = 30;
async function ttsKvGet(key) {
  const d = await ttsDb(); if (!d) return null;
  const v = await new Promise(res => { try { const rq = d.transaction('a').objectStore('a').get(key); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null); } catch (e) { res(null); } });
  if (!v || v instanceof ArrayBuffer) return null; // 前の版の形
  if (!v.user && Date.now() - (v.at || 0) > TTS_CACHE_DAYS * 86400e3) return null;
  return v;
}
async function ttsKvPut(key, v) {
  const d = await ttsDb(); if (!d) return;
  try { d.transaction('a', 'readwrite').objectStore('a').put(Object.assign({ at: Date.now() }, v), key); } catch (e) {}
}
async function ttsKvDel(key) { const d = await ttsDb(); if (d) { try { d.transaction('a', 'readwrite').objectStore('a').delete(key); } catch (e) {} } }
async function ttsCacheGet(key) {
  if (_ttsMem.has(key)) return _ttsMem.get(key);
  const v = await ttsKvGet(key);
  return v && v.buf ? v.buf : null;
}
async function ttsCachePut(key, buf, meta) {
  _ttsMem.set(key, buf); if (_ttsMem.size > 60) _ttsMem.delete(_ttsMem.keys().next().value);
  await ttsKvPut(key, Object.assign({ buf }, meta || {}));
}
// 前の版の声・古い声を消す（起動のたびに少しずつ）
async function ttsCacheCleanup() {
  const d = await ttsDb(); if (!d) return;
  try {
    const st = d.transaction('a', 'readwrite').objectStore('a'), limit = Date.now() - TTS_CACHE_DAYS * 86400e3;
    const rq = st.openCursor();
    rq.onsuccess = () => { const c = rq.result; if (!c) return; const v = c.value; if (!String(c.key).startsWith(TTS_CACHE_VER) || v instanceof ArrayBuffer || !v || (!v.user && (v.at || 0) < limit)) c.delete(); c.continue(); };
  } catch (e) {}
}
setTimeout(ttsCacheCleanup, 5000);
// 保存した声をすべて消す（設定のボタン）
async function ttsCacheClearAll() {
  _ttsMem.clear();
  const d = await ttsDb();
  if (d) { try { d.transaction('a', 'readwrite').objectStore('a').clear(); } catch (e) {} }
  if (typeof showAppToast === 'function') showAppToast('🗑️ 保存した AI の声を消しました（次に読むときに作り直します）');
}
// 読み間違えていた文の声を消して、作り直す（次は別のモデルから試す）
async function ttsForget(texts) {
  for (const t of (texts || []).filter(Boolean)) {
    const parts = await ttsSpokenParts(ttsSegments(t));
    for (const x of parts) { const key = TTS_CACHE_VER + TTS_AI_VOICE + '|' + x.spoken; _ttsMem.delete(key); await ttsKvDel(key); }
  }
  _ttsRotate = (_ttsRotate + 1) % TTS_AI_MODELS.length;
}
let _ttsRotate = 0;

// ---------------- 声を作る ----------------
// PCM（audio/L16）なら WAV の頭を付けて、どちらも WAV の ArrayBuffer にする
function ttsToWav(b64, mime) {
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (!/L16|pcm/i.test(mime || '')) return bytes.buffer;
  const rate = Number((String(mime).match(/rate=(\d+)/) || [])[1]) || 24000;
  const h = new ArrayBuffer(44), v = new DataView(h), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + bytes.length, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, bytes.length, true);
  const out = new Uint8Array(44 + bytes.length); out.set(new Uint8Array(h), 0); out.set(bytes, 44);
  return out.buffer;
}
async function ttsGenerate(plain, offset) {
  const keys = allAiKeys().gemini;
  let lastErr = null;
  const r = ((offset || 0) + _ttsRotate) % TTS_AI_MODELS.length;
  const models = TTS_AI_MODELS.slice(r).concat(TTS_AI_MODELS.slice(0, r)); // 作り直すときは別のモデルから
  for (const model of models) for (const key of keys) {
    const ck = key + '|' + model;
    if ((_ttsCooldown[ck] || 0) > Date.now()) continue;
    try {
      const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: plain }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_AI_VOICE } } } } })
      }, 20000);
      if (!res.ok) {
        // 回数の上限は1時間、使えないモデルは1日、混雑は30秒休ませる
        _ttsCooldown[ck] = Date.now() + (res.status === 429 ? 3600e3 : res.status === 404 || res.status === 400 || res.status === 403 ? 86400e3 : 30e3);
        lastErr = new Error('TTS ' + res.status); continue;
      }
      const j = await res.json();
      const part = (((j.candidates || [])[0] || {}).content || {}).parts || [];
      const inl = (part.find(p => p.inlineData) || {}).inlineData;
      if (!inl || !inl.data) { lastErr = new Error('no audio'); continue; }
      _ttsLastModel = model;
      return ttsToWav(inl.data, inl.mimeType);
    } catch (e) { lastErr = e; _ttsCooldown[ck] = Date.now() + 30e3; }
  }
  throw lastErr || new Error('TTS unavailable');
}
// 声を用意する（保存があればそれ。同じ文を同時に頼まない）
// ★【0.03.82】expect：その声で聞こえるはずの読み（ひらがな）。作ったあと裏で聞き取って比べ、違えば消して次は別のモデルで作り直す
function ttsAudioFor(plain, expect) {
  const key = TTS_CACHE_VER + TTS_AI_VOICE + '|' + plain; // plain は部分（英語だけ・日本語だけ）。v2：文字の名前をカタカナにした版（前の版で作った声は使わない）
  if (_ttsPending.has(key)) return _ttsPending.get(key);
  const p = (async () => {
    const hit = await ttsCacheGet(key);
    if (hit) return hit;
    const old = await ttsKvGet(key); // 前に聞き取りで作り直しになったもの（tries）
    const tries = (old && old.tries) || 0;
    const buf = await ttsGenerate(plain, tries);
    const model = _ttsLastModel;
    await ttsCachePut(key, buf, { tries, model });
    if (expect && ttsVerifyOn() && tries < 3) setTimeout(() => ttsVerify(key, buf, expect, tries, model).catch(() => {}), 300);
    return buf;
  })();
  _ttsPending.set(key, p);
  p.finally(() => _ttsPending.delete(key)).catch(() => {});
  return p;
}
// 先に作っておく（次の問題・答えなど）
function ttsPrefetch(texts) {
  if (!ttsUseAi()) return;
  (texts || []).forEach(t => { const segs = ttsSegments(t); ttsSpokenParts(segs).then(parts => parts.forEach(x => ttsAudioFor(x.spoken, x.expect).catch(() => {}))).catch(() => {}); });
}

// ---------------- 鳴らす ----------------
function ttsContext() {
  if (typeof applyTtsAudioSession === 'function') applyTtsAudioSession();
  if (!_ttsCtx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; _ttsCtx = new C(); }
  if (_ttsCtx.state === 'suspended') _ttsCtx.resume().catch(() => {});
  return _ttsCtx;
}
// 画面を触ったときに音を出せるようにしておく（iPhone・iPad は、触ったときでないと音を出せない）
document.addEventListener('touchend', () => { if (ttsUseAi()) ttsContext(); }, { passive: true });
document.addEventListener('click', () => { if (ttsUseAi()) ttsContext(); });

function ttsStopAi() { _ttsSeq++; if (_ttsSrc) { try { _ttsSrc.onended = null; _ttsSrc.stop(); } catch (e) {} _ttsSrc = null; } }
// 読み上げを止める（AI の声・いつもの読み上げのどちらも）
function ttsStopAll() { ttsStopAi(); try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch (e) {} }
function ttsSpeaking() { return !!_ttsSrc || ('speechSynthesis' in window && speechSynthesis.speaking); }

// AI の声で読む。終わったら（止めたときも）resolve。使えなければ reject（呼ぶ側でいつもの読み上げにする）
async function ttsSpeakAi(text, opts = {}) {
  const segs = ttsSegments(text);
  if (!segs.length) return;
  ttsStopAll();
  const my = ++_ttsSeq;
  const ctx = ttsContext(); if (!ctx) throw new Error('no audio context');
  // 日本語の部分は読み仮名にしてから（漢字の読み間違いを減らす）、部分ごとの声を一緒に頼んでおき、順に鳴らす
  const parts = await ttsSpokenParts(segs);
  if (my !== _ttsSeq) return;
  const raws = parts.map(x => ttsAudioFor(x.spoken, x.expect));
  raws.forEach(p => p.catch(() => {}));
  for (let k = 0; k < segs.length; k++) {
    const raw = await raws[k];
    if (my !== _ttsSeq) return; // 待っているあいだに止められた・次の読み上げが来た
    const buf = await ctx.decodeAudioData(raw.slice(0));
    if (my !== _ttsSeq) return;
    await ttsPlayBuffer(ctx, buf, opts, my);
    if (my !== _ttsSeq) return;
  }
}
function ttsPlayBuffer(ctx, buf, opts, my) {
  return new Promise(res => {
    const src = ctx.createBufferSource(); src.buffer = buf;
    if (opts.rate && opts.rate !== 1) src.playbackRate.value = Math.max(0.5, Math.min(2, opts.rate));
    src.connect(ctx.destination);
    src.onended = () => { if (_ttsSrc === src) _ttsSrc = null; res(); };
    _ttsSrc = src; src.start();
    // 止められたとき（ttsStopAi で onended を外す）にも待ちを終わらせる
    const watch = setInterval(() => { if (my !== _ttsSeq) { clearInterval(watch); res(); } else if (!_ttsSrc) clearInterval(watch); }, 200);
  });
}
function ttsNoticeFallback() {
  if (_ttsFailNoticed) return; _ttsFailNoticed = true;
  if (typeof showAppToast === 'function') showAppToast('🔊 AI の声が使えなかったので、いつもの読み上げにしました（音楽は止まります）');
}


// ================================================================
// ★【0.03.82】漢字の読み間違いを減らす・読み間違いをそのままにしない
//  1. 日本語の部分は、声を作る前に AI（文章のモデル）で読み仮名に直す（文脈から読む。古文は今の発音で）。直した読みはこの端末に保存
//  2. 作った声は、裏で AI に聞き取らせて読み仮名と比べる。違えばその声を消し、次に読むときは別のモデルで作り直す（3回まで）
//  3. 「🗣️ 読み方を直す」で、その文の読み方を自分で直したり、単語の読み方を辞書に登録したりできる（辞書は同期・いつもの読み上げにも効く）
// ================================================================
const TTS_READ_PREF = 'susuru_anki_tts_reading', TTS_VERIFY_PREF = 'susuru_anki_tts_verify';
function ttsReadingOn() { try { return localStorage.getItem(TTS_READ_PREF) !== 'off'; } catch (e) { return true; } }
function ttsVerifyOn() { try { return localStorage.getItem(TTS_VERIFY_PREF) !== 'off'; } catch (e) { return true; } }
function ttsSetPref(k, on) { try { localStorage.setItem(k, on ? 'on' : 'off'); } catch (e) {} }
// 読み仮名にしたほうがよい部分か（漢字・古い仮名づかい）
function ttsNeedsReading(t) { return /[一-鿿々〆]/.test(t) || /[ゐゑ]/.test(t) || /[ぁ-ん][はひふへほ]/.test(t); }
const ttsKana = t => String(t || '').replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/[^ぁ-ゖー]/g, '').replace(/ー/g, '');
const ttsReadKey = t => TTS_CACHE_VER + 'r|' + t;
// 部分ごとに { spoken: 声にする文, expect: 聞こえるはずの読み（ひらがな）}
async function ttsSpokenParts(segs) {
  const out = segs.map(s => ({ seg: s, spoken: s.t, expect: s.ja && !/[一-鿿]/.test(s.t) ? s.t : '' }));
  const need = out.filter(x => x.seg.ja && ttsNeedsReading(x.seg.t));
  if (!need.length) return out;
  // 保存している読み（自分で直したものを含む）
  await Promise.all(need.map(async x => { const v = await ttsKvGet(ttsReadKey(x.seg.t)); if (v && v.kana) { x.spoken = v.kana; x.expect = v.kana; x.have = true; } }));
  const ask = need.filter(x => !x.have);
  if (ask.length && ttsReadingOn() && typeof aiRequest === 'function') {
    try {
      const prompt = `次の日本語（単語帳・問題集の文）を、読み上げ用の「読み」に直す。\n規則：\n- 漢字はすべて、文脈に合った正しい読みのひらがなにする（例：「今日」はきょう、「一日」は文脈で ついたち／いちにち）\n- 古文・歴史的仮名づかいは、今の発音のひらがなにする（例：思ひ→おもい、けふ→きょう、あはれ→あわれ、言ふ→いう）\n- カタカナ語・送り仮名・句読点・記号・数字はそのまま。文の内容は変えない・足さない\n- 助詞の「は」「へ」はそのまま書く\n入力（JSON配列）：${JSON.stringify(ask.map(x => x.seg.t))}\nJSONのみ：{"r":["読み", ...]}（入力と同じ順番・同じ数）`;
      const txt = await aiRequest('あなたは日本語の読み仮名をつける係です。指示どおりJSONだけを出力します。', [{ text: prompt }], { json: true, maxTokens: 800, timeout: 10000, totalTimeout: 12000 });
      const r = (parseAiJson(txt) || {}).r || [];
      ask.forEach((x, i) => {
        const k = String(r[i] || '').trim();
        // 漢字が残っていない・長さがおかしくないものだけ使う
        if (k && !/[一-鿿]/.test(k) && k.length <= x.seg.t.length * 5 + 10) { x.spoken = k; x.expect = k; ttsKvPut(ttsReadKey(x.seg.t), { kana: k }); }
      });
    } catch (e) { /* 読みを付けられなければ、そのまま声にする */ }
  }
  return out;
}
// ArrayBuffer → base64
function ttsB64(buf) { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
function ttsSimilarity(a, b) {
  a = ttsKana(a); b = ttsKana(b);
  if (!a || !b) return 1;
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[m][n] / Math.max(m, n);
}
// 作った声を聞き取って比べる（違えば消して、次は別のモデルで作り直す）
async function ttsVerify(key, buf, expect, tries, model) {
  if (typeof aiRequest !== 'function' || !ttsKana(expect)) return;
  const txt = await aiRequest('あなたは音声の書き起こし係です。', [{ text: '音声で読み上げている日本語を、聞こえたとおりにすべてひらがなで書き起こす（漢字・カタカナは使わない。句読点は不要）。書き起こしだけを出力。' }, { mime: 'audio/wav', data: ttsB64(buf) }], { needPdf: true, maxTokens: 400, timeout: 15000, totalTimeout: 20000 });
  const sim = ttsSimilarity(txt, expect);
  if (sim >= 0.8) { await ttsKvPut(key, { buf, tries, model, ok: true }); return; }
  // 読み間違い：声を消して、作り直す回数を進める（同じ声を保存したままにしない）
  _ttsMem.delete(key);
  await ttsKvPut(key, { buf: null, tries: tries + 1, model, bad: String(txt).slice(0, 200) });
  console.warn('TTS 読み間違いのため作り直します', { expect, heard: txt, sim: sim.toFixed(2), model });
}

// ---------------- 🗣️ 読み方を直す ----------------
let _ttsFix = null;
async function ttsOpenFixDialog(texts) {
  const segs = [];
  (texts || []).filter(Boolean).forEach(t => ttsSegments(t).forEach(s => { if (s.ja && !segs.some(x => x.t === s.t)) segs.push(s); }));
  const rows = await Promise.all(segs.map(async s => { const v = await ttsKvGet(ttsReadKey(s.t)); return { t: s.t, kana: v && v.kana ? v.kana : '' }; }));
  _ttsFix = { rows, texts };
  let ov = document.getElementById('ttsFixOverlay');
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'ttsFixOverlay'; ov.className = 'ctx-overlay'; ov.style.zIndex = '1080';
    ov.innerHTML = '<div class="menu-card editor-card fp-card" onclick="event.stopPropagation()"><div id="ttsFixBody"></div></div>';
    ov.onclick = () => { ov.style.display = 'none'; };
    document.body.appendChild(ov);
  }
  const dict = Object.entries(ttsDict || {}).filter(([k, v]) => v && !v.deleted && v.r).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  document.getElementById('ttsFixBody').innerHTML = `<div class="cat-edit-title">🗣️ 読み方を直す</div>
    ${rows.length ? `<div class="hint-small" style="margin-top:4px;">この文の読み方（ひらがな）。直すと、この文はこの読み方で読みます${ttsUseAi() ? '（AI の声も作り直します）' : ''}</div>
    ${rows.map((r, i) => `<div style="margin-top:8px;"><div class="hint-small">${escapeHtml(r.t)}</div><input class="form-control" id="ttsFixRow${i}" value="${escAttr(r.kana || '')}" placeholder="${escAttr(r.kana ? '' : '（まだ読みが付いていません。ひらがなで入れる）')}"></div>`).join('')}` : '<div class="hint-small" style="margin-top:4px;">日本語の部分がありません</div>'}
    <div class="setting-box-title" style="margin-top:14px;">📖 単語の読み方を登録</div>
    <div class="hint-small">ほかの問題でも、この書き方はこの読み方で読みます（同期します・いつもの読み上げにも効きます）</div>
    <div class="form-row" style="margin-top:6px; gap:6px;"><input class="form-control" id="ttsDictSurface" placeholder="書き方（例：一日）"><input class="form-control" id="ttsDictReading" placeholder="読み方（例：ついたち）"></div>
    ${dict.length ? `<details style="margin-top:6px;"><summary class="hint-small">登録した読み方（${dict.length}）</summary>${dict.map(([k, v]) => `<div class="hint-small" style="display:flex; align-items:center; gap:6px; margin-top:4px;"><span style="flex:1;">${escapeHtml(k)} → ${escapeHtml(v.r)}</span><button class="chip" onclick="ttsDictRemove(${jsArg(k)})">🗑️</button></div>`).join('')}</details>` : ''}
    ${ttsUseAi() ? '<button class="chip" style="margin-top:10px;" onclick="ttsFixRegen()">🔁 読み方はそのままで、AI の声だけ作り直す</button>' : ''}
    <div class="drill-btns" style="margin-top:12px;"><button class="btn btn-primary" onclick="ttsFixSave()">💾 保存して読み直す</button><button class="btn btn-secondary" onclick="document.getElementById('ttsFixOverlay').style.display='none'">閉じる</button></div>`;
  ov.style.display = 'flex';
}
async function ttsFixSave() {
  const f = _ttsFix; if (!f) return;
  // 文の読み方（自分で直したものは期限なしで保存）。声は作り直す
  for (let i = 0; i < f.rows.length; i++) {
    const el = document.getElementById('ttsFixRow' + i); if (!el) continue;
    const v = el.value.trim();
    if (v && v !== f.rows[i].kana) {
      if (f.rows[i].kana) { const oldKey = TTS_CACHE_VER + TTS_AI_VOICE + '|' + f.rows[i].kana; _ttsMem.delete(oldKey); await ttsKvDel(oldKey); }
      await ttsKvPut(ttsReadKey(f.rows[i].t), { kana: v, user: true });
    }
  }
  // 単語の辞書
  const sf = (document.getElementById('ttsDictSurface').value || '').trim(), rd = (document.getElementById('ttsDictReading').value || '').trim();
  if (sf && rd) { ttsDict[sf] = { r: rd, at: Date.now() }; try { saveData(); } catch (e) {} }
  document.getElementById('ttsFixOverlay').style.display = 'none';
  if (typeof showAppToast === 'function') showAppToast('🗣️ 読み方を保存しました');
  // 読み直す
  const t = (f.texts || []).filter(Boolean).join('。');
  if (t && typeof speakText === 'function') speakText(t);
}
async function ttsFixRegen() {
  const f = _ttsFix; if (!f) return;
  await ttsForget(f.texts);
  document.getElementById('ttsFixOverlay').style.display = 'none';
  if (typeof showAppToast === 'function') showAppToast('🔁 声を作り直します');
  const t = (f.texts || []).filter(Boolean).join('。'); if (t && typeof speakText === 'function') speakText(t);
}
function ttsDictRemove(k) {
  ttsDict[k] = { deleted: true, at: Date.now() };
  try { saveData(); } catch (e) {}
  if (_ttsFix) ttsOpenFixDialog(_ttsFix.texts);
}
