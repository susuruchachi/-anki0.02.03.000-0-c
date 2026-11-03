// ================================================================
// ★【0.03.75】🎵 音楽と一緒に流せる読み上げ（iPhone・iPad 向け）
// iPhone・iPad の読み上げ（speechSynthesis）は、ページの設定に関係なく Spotify・YouTube などの音楽を止めてしまう。
// そこで、AI（Gemini の音声合成）で作った声を、ゲームの効果音と同じ Web Audio で鳴らす（navigator.audioSession を
// transient / ambient にすると、音楽を止めずに鳴る）。作った声はこの端末に保存して、同じ文は二度と作らない。
// 使えないとき（AI のキーが無い・回数の上限・オフライン）は、いつもの読み上げにする。
// ================================================================
// ★【0.03.76】読み間違いの少ない順（軽いモデルは後ろ）
const TTS_AI_MODELS = ['gemini-3.8-flash-tts', 'gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts', 'gemini-3.8-flash-lite-tts'];
// ★【0.03.87】声の種類を選べる（設定）。const の代わりに ttsVoice() で読む
const TTS_VOICES = [['Kore', '落ち着いた女性の声'], ['Aoede', 'やわらかい女性の声'], ['Leda', '若い女性の声'], ['Charon', '落ち着いた男性の声'], ['Puck', '明るい男性の声']];
function ttsVoice() { try { const v = localStorage.getItem('susuru_anki_tts_voice'); return TTS_VOICES.some(x => x[0] === v) ? v : 'Kore'; } catch (e) { return 'Kore'; } }
// まとめて作る（イントネーションが自然・回数が少ない）／英語と日本語を分けて作る（英語の発音がはっきり）
function ttsModeWhole() { try { return localStorage.getItem('susuru_anki_tts_mode') !== 'split'; } catch (e) { return true; } }
let _ttsCtx = null, _ttsSrc = null, _ttsSeq = 0, _ttsFailNoticed = false, _ttsLastModel = '', _ttsQuotaHit = false;
const _ttsPending = new Map(), _ttsMem = new Map();
// ★【0.03.90】休ませているモデルは再読み込みしても覚えておく（Too Many Requests を減らす）
const TTS_COOL_KEY = 'susuru_anki_tts_cool';
const _ttsCooldown = (() => { try { const o = JSON.parse(localStorage.getItem(TTS_COOL_KEY) || '{}') || {}; Object.keys(o).forEach(k => { if (!(o[k] > Date.now())) delete o[k]; }); return o; } catch (e) { return {}; } })();
function ttsSaveCooldown() { try { Object.keys(_ttsCooldown).forEach(k => { if (!(_ttsCooldown[k] > Date.now())) delete _ttsCooldown[k]; }); localStorage.setItem(TTS_COOL_KEY, JSON.stringify(_ttsCooldown)); } catch (e) {} }
// 今すぐ使えるモデルがあるか（無ければ頼まない）
// どのモデルも休んでいるとき、いちばん早く使えるまでの時間（ms）。使えるモデルがあれば 0
function ttsNextReadyIn() { try { const keys = allAiKeys().gemini, now = Date.now(); let best = Infinity; TTS_AI_MODELS.forEach(m => keys.forEach(k => { best = Math.min(best, Math.max(0, (_ttsCooldown[k + '|' + m] || 0) - now)); })); return best === Infinity ? 0 : best; } catch (e) { return 0; } }
function ttsAnyModelReady() { try { const keys = allAiKeys().gemini; return TTS_AI_MODELS.some(m => keys.some(k => !((_ttsCooldown[k + '|' + m] || 0) > Date.now()))); } catch (e) { return false; } }

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
const TTS_CACHE_VER = 'v2|', TTS_CACHE_DAYS = 365; // ★【0.03.85】無料回数が少ないので、作った声は1年とっておく（読み間違いは聞き取りや「読み方を直す」で作り直す）
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
    const parts = await ttsPartsOf(t);
    for (const x of parts) { const key = TTS_CACHE_VER + ttsVoice() + '|' + x.spoken; _ttsMem.delete(key); await ttsKvDel(key); }
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
      const call = text => fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: ttsVoice() } } } } })
      }, 20000);
      let res = await call(plain);
      // ★【0.03.84】「の～」「とは？」のような短い部分を、読む文ではなく指示だと思って断ることがある（400）。読む文だと分かる形で頼み直す
      if (res.status === 400) { const t = await res.text().catch(() => ''); if (/generate text|only be used for TTS/i.test(t)) res = await call(`Say: ${plain}`); else res = { ok: false, status: 400 }; }
      if (!res.ok) {
        // 1日の上限は次に戻る時刻まで、1分の上限は言われた秒数だけ、使えないモデルは1日、混雑は30秒休ませる（400 は1時間）
        let wait = res.status === 404 || res.status === 403 ? 86400e3 : res.status === 400 ? 3600e3 : 30e3;
        if (res.status === 429) {
          const t = typeof res.text === 'function' ? await res.text().catch(() => '') : '';
          const rd = Number((t.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/) || [])[1]) || 0;
          const perDay = /PerDay|per day|daily/i.test(t) || !t;
          wait = perDay ? (typeof aiNextGeminiReset === 'function' ? aiNextGeminiReset() - Date.now() : 6 * 3600e3) : Math.min(300, Math.max(15, rd || 60)) * 1000;
        }
        _ttsCooldown[ck] = Date.now() + wait; ttsSaveCooldown();
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
  // どのモデルも休ませている：1日の上限なら「使い切った」
  _ttsQuotaHit = ttsNextReadyIn() > 10 * 60e3;
  throw lastErr || new Error('TTS unavailable');
}
// 声を用意する（保存があればそれ。同じ文を同時に頼まない）
// ★【0.03.82】expect：その声で聞こえるはずの読み（ひらがな）。作ったあと裏で聞き取って比べ、違えば消して次は別のモデルで作り直す
function ttsAudioFor(plain, expect, share, low) {
  const key = TTS_CACHE_VER + ttsVoice() + '|' + plain; // plain は部分（英語だけ・日本語だけ）。v2：文字の名前をカタカナにした版（前の版で作った声は使わない）
  if (_ttsPending.has(key)) return _ttsPending.get(key);
  const p = (async () => {
    const hit = await ttsCacheGet(key);
    if (hit) return hit;
    // ★【0.03.86】共有・公開カテゴリーなら、だれかが作った声を探す
    if (share) { const got = await ttsCloudGetAudio(plain); if (got) { await ttsCachePut(key, got, { ok: true, shared: true }); return got; } }
    const old = await ttsKvGet(key); // 前に聞き取りで作り直しになったもの（tries）
    const tries = (old && old.tries) || 0;
    const buf = await ttsQueue(() => ttsGenerate(plain, tries), !!low);
    const model = _ttsLastModel;
    await ttsCachePut(key, buf, { tries, model });
    if (expect && ttsVerifyOn() && tries < 2) setTimeout(() => ttsVerify(key, buf, expect, tries, model, share ? plain : null).catch(() => {}), 300);
    else if (share) ttsCloudPutAudio(plain, buf, model); // チェックしないときは作ってすぐ共有
    return buf;
  })();
  _ttsPending.set(key, p);
  p.finally(() => _ttsPending.delete(key)).catch(() => {});
  return p;
}
// ★【0.03.90】声を作る頼みは1つずつ（同時にいくつも頼むと、1分の上限ですぐ Too Many Requests になっていた）。
// 読むための頼みを先に、先に作っておく頼み（low）は後に
const _ttsQ = { hi: [], lo: [], busy: false };
function ttsQueue(fn, low) {
  return new Promise((res, rej) => { (low ? _ttsQ.lo : _ttsQ.hi).push({ fn, res, rej }); ttsQueueRun(); });
}
async function ttsQueueRun() {
  if (_ttsQ.busy) return;
  const job = _ttsQ.hi.shift() || _ttsQ.lo.shift(); if (!job) return;
  _ttsQ.busy = true;
  try { job.res(await job.fn()); } catch (e) { job.rej(e); }
  _ttsQ.busy = false;
  setTimeout(ttsQueueRun, 400); // 少し間をあける
}
// 先に作っておく（次の問題・答えなど）。使えるモデルが無いときや、ほかの頼みが混んでいるときはしない
// ★【0.04.01】改行で区切った行は、それぞれ別の声にする（同じ行の声は、暗記テスト・クイズ・聞き流し・振り返りで使い回す）
function ttsUnits(text) { return String(text == null ? '' : text).split(/\n+/).map(x => x.trim()).filter(Boolean); }
async function ttsPartsOf(text, share) { const out = []; for (const u of ttsUnits(text)) { const segs = ttsSegments(u); if (segs.length) out.push(...await ttsSpokenParts(segs, share)); } return out; }
function ttsPrefetch(texts) {
  if (!ttsUseAi() || !ttsAnyModelReady() || _ttsQ.hi.length + _ttsQ.lo.length > 2) return;
  const share = _ttsShareCtx;
  (texts || []).forEach(t => { ttsPartsOf(t, share).then(parts => parts.forEach(x => ttsAudioFor(x.spoken, x.expect, share, true).catch(() => {}))).catch(() => {}); });
}

// ---------------- 鳴らす ----------------
function ttsContext() {
  if (typeof applyTtsAudioSession === 'function') applyTtsAudioSession();
  if (!_ttsCtx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; _ttsCtx = new C(); }
  if (_ttsCtx.state === 'suspended') _ttsCtx.resume().catch(() => {});
  return _ttsCtx;
}
// 画面を触ったときに音を出せるようにしておく（iPhone・iPad は、触ったときでないと音を出せない）
// ★【0.03.85】いつもの読み上げも、画面を触ったときに一度鳴らしておく（iPhone・iPad は、触ったときに一度も鳴らしていない読み上げを、
// あとから鳴らそうとしても無音になる。AI の声がだめで、いつもの読み上げにしたときに何も読まなかった）
let _ttsSpeechUnlocked = false;
function ttsUnlockSpeech() {
  if (_ttsSpeechUnlocked || !('speechSynthesis' in window)) return;
  _ttsSpeechUnlocked = true;
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; u.rate = 2; speechSynthesis.speak(u); } catch (e) {}
}
const ttsOnGesture = () => { if (ttsUseAi()) { ttsContext(); ttsUnlockSpeech(); } };
document.addEventListener('touchend', ttsOnGesture, { passive: true });
document.addEventListener('click', ttsOnGesture);
// いつもの読み上げに切り替える前に、AI の声の音（Web Audio）を止めて、音の扱いを「ふつうの再生」にする
function ttsPrepareNative() {
  try { if (_ttsCtx && _ttsCtx.state === 'running') _ttsCtx.suspend().catch(() => {}); } catch (e) {}
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  try { speechSynthesis.cancel(); speechSynthesis.resume(); } catch (e) {}
}

function ttsStopAi() { _ttsSeq++; if (_ttsSrc) { try { _ttsSrc.onended = null; _ttsSrc.stop(); } catch (e) {} _ttsSrc = null; } }
// 読み上げを止める（AI の声・いつもの読み上げのどちらも）
function ttsStopAll() { ttsStopAi(); try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch (e) {} }
function ttsSpeaking() { return !!_ttsSrc || ('speechSynthesis' in window && speechSynthesis.speaking); }

// AI の声で読む。終わったら（止めたときも）resolve。使えなければ reject（呼ぶ側でいつもの読み上げにする）
async function ttsSpeakAi(text, opts = {}) {
  if (!ttsUnits(text).some(u => ttsSegments(u).length)) return;
  ttsStopAll();
  const my = ++_ttsSeq;
  const ctx = ttsContext(); if (!ctx) throw new Error('no audio context');
  // 日本語の部分は読み仮名にしてから（漢字の読み間違いを減らす）、部分ごとの声を一緒に頼んでおき、順に鳴らす
  const share = _ttsShareCtx;
  const parts = await ttsPartsOf(text, share);
  if (my !== _ttsSeq) return;
  const raws = parts.map(x => ttsAudioFor(x.spoken, x.expect, share));
  raws.forEach(p => p.catch(() => {}));
  let played = 0;
  for (let k = 0; k < parts.length; k++) {
    let buf = null;
    try { const raw = await raws[k]; if (my !== _ttsSeq) return; buf = await ctx.decodeAudioData(raw.slice(0)); }
    catch (e) {
      if (my !== _ttsSeq) return;
      // ★【0.03.84】この部分の声を作れなかった（回数の上限など）：この部分だけいつもの読み上げで読んで、続ける（前は日本語の部分が読まれないことがあった）
      if (!played && k === parts.length - 1) throw e; // 1つも作れなかったときは、呼ぶ側でまとめていつもの読み上げに
      ttsNoticeFallback();
      await ttsNativeSay(parts[k].seg.t, parts[k].seg.ja, opts);
      if (my !== _ttsSeq) return;
      continue;
    }
    if (my !== _ttsSeq) return;
    await ttsPlayBuffer(ctx, buf, opts, my);
    played++;
    if (my !== _ttsSeq) return;
  }
}
// ★【0.03.85】鳴らさずに声だけ作る（聞き流しの「先に作っておく」）。{ made: 作った数, have: 作ってあった数 }
async function ttsBuildText(text) {
  const share = _ttsShareCtx;
  const parts = await ttsPartsOf(text, share);
  let made = 0, have = 0;
  for (const x of parts) {
    const key = TTS_CACHE_VER + ttsVoice() + '|' + x.spoken;
    if (await ttsCacheGet(key)) { have++; continue; }
    await ttsAudioFor(x.spoken, x.expect, share, true); made++;
  }
  return { made, have };
}
// いつもの読み上げで1つの部分を読み、終わるまで待つ（iPhone・iPad では音楽が止まる）
function ttsNativeSay(text, ja, opts = {}) {
  return new Promise(res => {
    if (!('speechSynthesis' in window) || !text) return res();
    ttsPrepareNative();
    const u = new SpeechSynthesisUtterance(text);
    const v = typeof getBestVoice === 'function' ? getBestVoice(ja ? 'ja' : 'en') : null;
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = ja ? 'ja-JP' : 'en-US';
    u.rate = opts.rate || 1;
    const done = () => { clearTimeout(g); try { if (typeof applyTtsAudioSession === 'function') applyTtsAudioSession(); if (_ttsCtx) _ttsCtx.resume().catch(() => {}); } catch (e) {} res(); };
    const g = setTimeout(done, text.length * 250 + 4000);
    u.onend = u.onerror = done;
    speechSynthesis.speak(u);
  });
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
  if (typeof showAppToast === 'function') showAppToast(_ttsQuotaHit ? '🔊 AI の声の無料回数（1日・モデルごと）を使い切ったので、新しい文はいつもの読み上げにします（音楽は止まります。作ってある声はそのまま使えます）' : '🔊 AI の声が使えなかったので、いつもの読み上げにしました（音楽は止まります）');
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
const ttsReadKey = t => TTS_CACHE_VER + 'r2|' + t; // r2：{ t, k }（0.03.87〜）
// 部分ごとに { spoken: 声にする文, expect: 聞こえるはずの読み（ひらがな）}
async function ttsSpokenParts(segs, share) {
  const rd = await ttsReadings(segs.filter(s => s.ja && ttsNeedsReading(s.t)).map(s => s.t), share);
  const noKanji = t => !/[一-鿿々〆]/.test(t);
  // ★【0.03.98】かなの無い漢字だけの部分（「保存、保全」「名詞、政治」など）は、声のモデルが中国語として読んでしまうので、ひらがなの読みで頼む
  const noKana = t => /[一-鿿々〆]/.test(t) && !/[ぁ-ゖァ-ヺ]/.test(t);
  const ja = s => { const r = rd.get(s.t); const k = r && r.k ? r.k : (noKanji(s.t) ? s.t : ''); return { t: noKana(s.t) && k ? k : r && r.t ? r.t : s.t, k, cn: noKana(s.t) && !k }; };
  const jpSay = t => `Say in Japanese: ${t}`; // 読みが無いときは、日本語として読むように頼む
  const orig0 = segs.map(x => x.t).join(' ');
  if (!ttsModeWhole() || segs.length <= 1 || ttsSplitTexts().includes(orig0)) {
    return segs.map(s => { if (!s.ja) return { seg: s, spoken: s.t, expect: '' }; const x = ja(s); return { seg: s, spoken: x.cn ? jpSay(x.t) : x.t, expect: x.k }; });
  }
  // ★【0.03.87】まとめて1つの声にする（部分ごとに作ると、「とは？」のような短い部分の抑揚がおかしくなっていた）
  const hasEn = segs.some(s => !s.ja), hasJa = segs.some(s => s.ja);
  let body = '', orig = '', kana = '', kanaOk = true, cn = false;
  segs.forEach((s, i) => {
    const prev = segs[i - 1], sp = prev && (!prev.ja || !s.ja) ? ' ' : '';
    if (s.ja) { const x = ja(s); body += sp + x.t; if (x.cn) cn = true; if (x.k) kana += x.k; else kanaOk = false; }
    else body += sp + s.t;
    orig += sp + s.t;
  });
  // 英語と日本語が混ざっているときは、英語の部分を英語の発音で読むように頼む（説明は読まない）。
  // 英語が「of」「to」のような短い語だけなら頼まない（頼むと「読めません」と英語で話し出すことがあった）
  const enWords = segs.filter(x => !x.ja).map(x => x.t).join(' ').split(/\s+/).filter(Boolean);
  const direct = hasEn && hasJa && !(enWords.length <= 2 && enWords.every(w => w.replace(/[^A-Za-z]/g, '').length <= 3));
  const spoken = direct ? `Read the following aloud naturally. Use natural Japanese intonation for Japanese, and native English pronunciation for English words:\n${body}` : cn ? jpSay(body) : body;
  return [{ seg: { ja: hasJa, t: orig }, spoken, expect: hasEn ? '#mix|' + orig0 : (!kanaOk ? '' : kana) }];
}
// ★【0.03.87】日本語の部分の「読み上げ用の文」と「読み（ひらがな）」。{ t: 読み間違えやすい漢字だけかなにした文, k: 全部ひらがなの読み }
// 全部をひらがなにすると、語の切れ目が分からなくなって抑揚がおかしくなるので、ふつうの語は漢字のまま
async function ttsReadings(texts, share) {
  const out = new Map();
  texts = [...new Set(texts)];
  if (!texts.length) return out;
  await Promise.all(texts.map(async t => {
    const v = await ttsKvGet(ttsReadKey(t));
    if (v && (v.k || v.kana)) { out.set(t, { t: v.t || (v.user ? (v.k || v.kana) : t), k: v.k || v.kana }); return; }
    const old = await ttsKvGet(TTS_CACHE_VER + 'r|' + t); // 前の版で自分で直した読み
    if (old && old.user && old.kana) out.set(t, { t: old.kana, k: old.kana });
  }));
  if (share) await Promise.all(texts.filter(t => !out.has(t)).map(async t => { const r = await ttsCloudGetReading(t); if (r) { try { const o = JSON.parse(r); if (o.k && !/[一-鿿]/.test(o.k)) { out.set(t, { t: o.t || t, k: o.k }); ttsKvPut(ttsReadKey(t), { t: o.t || t, k: o.k }); } } catch (e) {} } }));
  const ask = texts.filter(t => !out.has(t));
  if (ask.length && ttsReadingOn() && typeof aiRequest === 'function') {
    try {
      const prompt = `次の日本語（単語帳・問題集の文）を、AI の読み上げ用に整える。それぞれ2つを返す。\n- t：読み上げに渡す文。読み間違えやすい漢字（いくつも読み方がある語・難しい読みの語・人名や地名・古文の語）だけをひらがなにし、ふつうの語は漢字のまま。古文・歴史的仮名づかいは今の発音のかなにする（例：思ひ→思い、けふ→きょう、あはれ→あわれ）。句読点・記号・カタカナ語・数字はそのまま。内容は変えない・足さない\n- k：文全体の正しい読みを、すべてひらがなで（文脈に合った読み。例：「一日」は文脈で ついたち／いちにち）。助詞の「は」「へ」はそのまま書く\n入力（JSON配列）：${JSON.stringify(ask)}\nJSONのみ：{"r":[{"t":"…","k":"…"}, ...]}（入力と同じ順番・同じ数）`;
      const txt = await aiRequest('あなたは日本語の読み仮名をつける係です。指示どおりJSONだけを出力します。', [{ text: prompt }], { json: true, maxTokens: 1200, timeout: 10000, totalTimeout: 12000, noHedge: true });
      const r = (parseAiJson(txt) || {}).r || [];
      ask.forEach((t, i) => {
        const o = r[i] || {}, k = String(o.k || '').trim(), tt = String(o.t || '').trim() || t;
        if (k && !/[一-鿿]/.test(k) && k.length <= t.length * 5 + 10 && tt.length <= t.length * 4 + 10) {
          out.set(t, { t: tt, k });
          ttsKvPut(ttsReadKey(t), { t: tt, k });
          if (share) ttsCloudPutReading(t, JSON.stringify({ t: tt, k }));
        }
      });
    } catch (e) { /* 読みを付けられなければ、そのまま声にする */ }
  }
  return out;
}
// ArrayBuffer → base64
function ttsB64(buf) { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
function ttsSimilarity(a, b) {
  a = ttsKana(a); b = ttsKana(b);
  if (!b) return 1; // 比べる読みが無い
  if (!a) return 0; // 何も聞こえない（声が出ていない）
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[m][n] / Math.max(m, n);
}
// 作った声を聞き取って比べる（違えば消して、次は別のモデルで作り直す）
// まとめて読ませた文で、AI が読まずに「読めません」などと話していないか
const TTS_REFUSAL_RE = /sorry|unable|can(?:no|'|’)t|cannot|not able|I'm|I am|as an ai|申し訳|できません|読めません|読み上げられ/i;
function ttsSplitTexts() { try { return JSON.parse(localStorage.getItem('susuru_anki_tts_split') || '[]'); } catch (e) { return []; } }
function ttsAddSplitText(t) { const a = ttsSplitTexts().filter(x => x !== t); a.push(t); try { localStorage.setItem('susuru_anki_tts_split', JSON.stringify(a.slice(-500))); } catch (e) {} }
async function ttsVerify(key, buf, expect, tries, model, sharePlain) {
  if (typeof aiRequest !== 'function') return;
  if (String(expect).startsWith('#mix|')) {
    // ★【0.03.89】英語と日本語が混ざった文：聞き取って、読まずに話していたら、その文は次から分けて作る
    const orig = expect.slice(5);
    const heard = await aiRequest('あなたは音声の書き起こし係です。', [{ text: '音声で話している内容を、聞こえたとおりに書き起こす（英語は英語、日本語は日本語で）。書き起こしだけを出力。' }, { mime: 'audio/wav', data: ttsB64(buf) }], { needPdf: true, maxTokens: 400, timeout: 15000, totalTimeout: 20000, noHedge: true });
    const h = String(heard || '');
    const bad = TTS_REFUSAL_RE.test(h) && !TTS_REFUSAL_RE.test(orig);
    if (!bad) { await ttsKvPut(key, { buf, tries, model, ok: true }); if (sharePlain) ttsCloudPutAudio(sharePlain, buf, model); return; }
    _ttsMem.delete(key); await ttsKvDel(key); ttsAddSplitText(orig);
    console.warn('TTS が読まずに話していたので、次から分けて作ります', { orig, heard: h });
    return;
  }
  if (!ttsKana(expect)) return;
  const txt = await aiRequest('あなたは音声の書き起こし係です。', [{ text: '音声で読み上げている日本語を、聞こえたとおりにすべてひらがなで書き起こす（漢字・カタカナは使わない。句読点は不要）。書き起こしだけを出力。' }, { mime: 'audio/wav', data: ttsB64(buf) }], { needPdf: true, maxTokens: 400, timeout: 15000, totalTimeout: 20000, noHedge: true });
  const sim = ttsSimilarity(txt, expect);
  if (sim >= 0.8) { await ttsKvPut(key, { buf, tries, model, ok: true }); if (sharePlain) ttsCloudPutAudio(sharePlain, buf, model); return; }
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
  const rows = await Promise.all(segs.map(async s => { const v = await ttsKvGet(ttsReadKey(s.t)); return { t: s.t, kana: v ? (v.k || v.kana || '') : '' }; }));
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
  // 文の読み方（自分で直したものは期限なしで保存）。今の声は消して作り直す（読み間違えた声を残さない）
  if (f.rows.some((r, i) => { const el = document.getElementById('ttsFixRow' + i); return el && el.value.trim() && el.value.trim() !== r.kana; })) await ttsForget(f.texts);
  for (let i = 0; i < f.rows.length; i++) {
    const el = document.getElementById('ttsFixRow' + i); if (!el) continue;
    const v = el.value.trim();
    if (v && v !== f.rows[i].kana) {
      await ttsKvPut(ttsReadKey(f.rows[i].t), { t: v, k: v, user: true });
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

// ================================================================
// ★【0.03.86】共有・公開カテゴリーの声は、使っている人みんなで分け合う（Firestore の susuru_anki_tts）
//  ・その文の声・読み仮名を、まず共有の場所から探す。だれかが作っていれば、AI の回数を使わない
//  ・自分が作った声は、読み間違いのチェックに通ってから（チェックがオフなら作ってすぐ）共有の場所に置く
//  ・声は 16kHz・8bit（μ-law）に縮めて置く（元の約3分の1）。自分だけのカードの声は置かない
// ================================================================
let _ttsShareCtx = false;
// 今読むカードが共有・公開カテゴリーのものか（クイズ・暗記テスト・聞き流しから呼ぶ）
function ttsSetShareCard(card) {
  let c = card; if (c && !c.sharedDocId && (c._sourceId || c.id)) c = db.find(q => q.id === (c._sourceId || c.id)) || c;
  _ttsShareCtx = !!(c && c.sharedDocId);
}
function ttsShareReady() { return typeof currentUser !== 'undefined' && currentUser && typeof firestore !== 'undefined' && navigator.onLine !== false; }
async function ttsCloudId(s) {
  try { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(h)].slice(0, 20).map(b => b.toString(16).padStart(2, '0')).join(''); }
  catch (e) { return null; }
}
const ttsCloudRef = id => firestore.collection('susuru_anki_tts').doc(id);
// WAV（16bit）→ 16kHz・μ-law（8bit）
function ttsPackUlaw(wav) {
  const v = new DataView(wav); const rate = v.getUint32(24, true) || 24000;
  const pcm = new Int16Array(wav.slice(44)), outRate = 16000, n = Math.floor(pcm.length * outRate / rate), out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const x = pcm[Math.min(pcm.length - 1, Math.floor(i * rate / outRate))];
    let s = Math.max(-32635, Math.min(32635, x)); const sign = s < 0 ? 0x80 : 0; if (s < 0) s = -s; s += 132;
    let exp = 7; for (let m = 0x4000; (s & m) === 0 && exp > 0; m >>= 1) exp--;
    out[i] = ~(sign | (exp << 4) | ((s >> (exp + 3)) & 0x0f)) & 0xff;
  }
  return out;
}
// μ-law → WAV（16kHz・16bit）
function ttsUnpackUlaw(u8) {
  const n = u8.length, pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) { const u = ~u8[i] & 0xff, sign = u & 0x80, exp = (u >> 4) & 7, man = u & 0x0f; let s = ((man << 3) + 132) << exp; s -= 132; pcm[i] = sign ? -s : s; }
  const bytes = new Uint8Array(pcm.buffer), h = new ArrayBuffer(44), v = new DataView(h), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + bytes.length, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, bytes.length, true);
  const out = new Uint8Array(44 + bytes.length); out.set(new Uint8Array(h), 0); out.set(bytes, 44); return out.buffer;
}
async function ttsCloudGetAudio(plain) {
  if (!ttsShareReady()) return null;
  const id = await ttsCloudId('a|' + TTS_CACHE_VER + ttsVoice() + '|' + plain); if (!id) return null;
  try {
    const s = await ttsCloudRef(id).get(); if (!s.exists) return null;
    const a = (s.data() || {}).a; if (!a) return null;
    const u8 = typeof a.toUint8Array === 'function' ? a.toUint8Array() : new Uint8Array(a);
    return ttsUnpackUlaw(u8);
  } catch (e) { return null; }
}
async function ttsCloudPutAudio(plain, wav, model) {
  if (!ttsShareReady() || !firebase.firestore.Blob) return;
  const id = await ttsCloudId('a|' + TTS_CACHE_VER + ttsVoice() + '|' + plain); if (!id) return;
  try { const u8 = ttsPackUlaw(wav); if (u8.length > 880000) return; await ttsCloudRef(id).set({ a: firebase.firestore.Blob.fromUint8Array(u8), v: ttsVoice(), m: model || '', by: currentUser.uid, at: Date.now() }); }
  catch (e) { /* ほかの人が先に置いていた・ルールがまだ、など */ }
}
async function ttsCloudGetReading(text) {
  if (!ttsShareReady()) return null;
  const id = await ttsCloudId('r2|' + text); if (!id) return null;
  try { const s = await ttsCloudRef(id).get(); return s.exists ? ((s.data() || {}).r || null) : null; } catch (e) { return null; }
}
async function ttsCloudPutReading(text, kana) {
  if (!ttsShareReady()) return;
  const id = await ttsCloudId('r2|' + text); if (!id) return;
  try { await ttsCloudRef(id).set({ r: String(kana).slice(0, 1900), by: currentUser.uid, at: Date.now() }); } catch (e) {}
}
