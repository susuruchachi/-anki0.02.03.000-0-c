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
let _ttsCtx = null, _ttsSrc = null, _ttsSeq = 0, _ttsFailNoticed = false;
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
async function ttsCacheGet(key) {
  if (_ttsMem.has(key)) return _ttsMem.get(key);
  const d = await ttsDb(); if (!d) return null;
  const v = await new Promise(res => { try { const rq = d.transaction('a').objectStore('a').get(key); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null); } catch (e) { res(null); } });
  if (!v) return null;
  if (v instanceof ArrayBuffer) return null; // 前の版の形
  if (Date.now() - (v.at || 0) > TTS_CACHE_DAYS * 86400e3) return null;
  return v.buf || null;
}
async function ttsCachePut(key, buf) {
  _ttsMem.set(key, buf); if (_ttsMem.size > 60) _ttsMem.delete(_ttsMem.keys().next().value);
  const d = await ttsDb(); if (!d) return;
  try { d.transaction('a', 'readwrite').objectStore('a').put({ buf, at: Date.now() }, key); } catch (e) {}
}
// 前の版の声・古い声を消す（起動のたびに少しずつ）
async function ttsCacheCleanup() {
  const d = await ttsDb(); if (!d) return;
  try {
    const st = d.transaction('a', 'readwrite').objectStore('a'), limit = Date.now() - TTS_CACHE_DAYS * 86400e3;
    const rq = st.openCursor();
    rq.onsuccess = () => { const c = rq.result; if (!c) return; const v = c.value; if (!String(c.key).startsWith(TTS_CACHE_VER) || v instanceof ArrayBuffer || !v || (v.at || 0) < limit) c.delete(); c.continue(); };
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
  const d = await ttsDb();
  (texts || []).forEach(t => ttsSegments(t).forEach(s => {
    const key = TTS_CACHE_VER + TTS_AI_VOICE + '|' + s.t;
    _ttsMem.delete(key);
    if (d) { try { d.transaction('a', 'readwrite').objectStore('a').delete(key); } catch (e) {} }
  }));
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
async function ttsGenerate(plain) {
  const keys = allAiKeys().gemini;
  let lastErr = null;
  const models = TTS_AI_MODELS.slice(_ttsRotate).concat(TTS_AI_MODELS.slice(0, _ttsRotate)); // 作り直すときは別のモデルから
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
      return ttsToWav(inl.data, inl.mimeType);
    } catch (e) { lastErr = e; _ttsCooldown[ck] = Date.now() + 30e3; }
  }
  throw lastErr || new Error('TTS unavailable');
}
// 声を用意する（保存があればそれ。同じ文を同時に頼まない）
function ttsAudioFor(plain) {
  const key = TTS_CACHE_VER + TTS_AI_VOICE + '|' + plain; // plain は部分（英語だけ・日本語だけ）。v2：文字の名前をカタカナにした版（前の版で作った声は使わない）
  if (_ttsPending.has(key)) return _ttsPending.get(key);
  const p = (async () => {
    const hit = await ttsCacheGet(key);
    if (hit) return hit;
    const buf = await ttsGenerate(plain);
    await ttsCachePut(key, buf);
    return buf;
  })();
  _ttsPending.set(key, p);
  p.finally(() => _ttsPending.delete(key)).catch(() => {});
  return p;
}
// 先に作っておく（次の問題・答えなど）
function ttsPrefetch(texts) {
  if (!ttsUseAi()) return;
  (texts || []).forEach(t => ttsSegments(t).forEach(s => ttsAudioFor(s.t).catch(() => {})));
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
  // 部分ごとの声を一緒に頼んでおき、順に鳴らす
  const raws = segs.map(s => ttsAudioFor(s.t));
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
