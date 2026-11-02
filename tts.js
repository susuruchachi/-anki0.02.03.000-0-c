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
  const div = document.createElement('div');
  div.innerHTML = typeof richTextToSpeech === 'function' ? richTextToSpeech(text) : escapeHtml(String(text || ''));
  return cleanTextForSpeech(div.textContent || div.innerText || '', { kana: true });
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
async function ttsCacheGet(key) {
  if (_ttsMem.has(key)) return _ttsMem.get(key);
  const d = await ttsDb(); if (!d) return null;
  return new Promise(res => { try { const rq = d.transaction('a').objectStore('a').get(key); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null); } catch (e) { res(null); } });
}
async function ttsCachePut(key, buf) {
  _ttsMem.set(key, buf); if (_ttsMem.size > 60) _ttsMem.delete(_ttsMem.keys().next().value);
  const d = await ttsDb(); if (!d) return;
  try { d.transaction('a', 'readwrite').objectStore('a').put(buf, key); } catch (e) {}
}

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
  for (const model of TTS_AI_MODELS) for (const key of keys) {
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
  const key = 'v2|' + TTS_AI_VOICE + '|' + plain; // v2：文字の名前をカタカナにした版（前の版で作った声は使わない）
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
  (texts || []).forEach(t => { const p = ttsPlainText(t); if (p) ttsAudioFor(p).catch(() => {}); });
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
  const plain = ttsPlainText(text);
  if (!plain) return;
  ttsStopAll();
  const my = ++_ttsSeq;
  const ctx = ttsContext(); if (!ctx) throw new Error('no audio context');
  const raw = await ttsAudioFor(plain);
  if (my !== _ttsSeq) return; // 待っているあいだに止められた・次の読み上げが来た
  const buf = await ctx.decodeAudioData(raw.slice(0));
  if (my !== _ttsSeq) return;
  await new Promise(res => {
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
