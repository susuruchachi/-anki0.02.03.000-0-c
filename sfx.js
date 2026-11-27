// ================================================================
// ★【0.04.71】🔔 効果音：正解「ピンポーン」・不正解「ブッブー」・〇にならないけど聞き直す「ブッブッ」
//  すべてのモード（クイズ・暗記テスト・Check!・カードモード・対戦・プランバトル）で鳴らす。音のファイルは使わず、その場で作る
//  iPhone・iPad では読み上げと同じ鳴らし方（ttsContext：音楽を止めずに鳴る）。設定の「🔔 効果音」で止められる
// ================================================================
const SFX_KEY = 'susuru_anki_sfx';
function sfxOn() { try { return localStorage.getItem(SFX_KEY) !== 'off'; } catch (e) { return true; } }
function sfxSet(on) { try { localStorage.setItem(SFX_KEY, on ? 'on' : 'off'); } catch (e) {} if (on) sfxPlay('ok', true); }
let _sfxCtx = null, _sfxLast = { k: '', t: 0 };
function sfxContext() {
  if (typeof ttsContext === 'function') { try { const c = ttsContext(); if (c) return c; } catch (e) {} }
  if (!_sfxCtx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; _sfxCtx = new C(); }
  if (_sfxCtx.state === 'suspended') _sfxCtx.resume().catch(() => {});
  return _sfxCtx;
}
// 1つの音：f（Hz）を t0 から d 秒。type は波の形。vol は大きさ。end まで少しずつ小さく
function sfxTone(ctx, out, f, t0, d, type, vol) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  g.gain.setValueAtTime(vol, t0 + Math.max(0.02, d * 0.55));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + d + 0.02);
}
// kind：'ok'（ピンポーン）・'ng'（ブッブー）・'retry'（ブッブッ）
function sfxPlay(kind, force) {
  if (!force && !sfxOn()) return;
  const now = Date.now(); if (_sfxLast.k === kind && now - _sfxLast.t < 350) return; // 同じ答えで二重に鳴らさない
  _sfxLast = { k: kind, t: now };
  try {
    const ctx = sfxContext(); if (!ctx) return;
    const t = ctx.currentTime + 0.02, out = ctx.createGain(); out.gain.value = 0.9; out.connect(ctx.destination);
    if (kind === 'ok') {
      // ピン（高い）ポーン（少し低くて長い）。倍音を少し重ねてチャイムらしく
      sfxTone(ctx, out, 1318.5, t, 0.22, 'sine', 0.32); sfxTone(ctx, out, 2637, t, 0.15, 'sine', 0.06);
      sfxTone(ctx, out, 1046.5, t + 0.2, 0.6, 'sine', 0.32); sfxTone(ctx, out, 2093, t + 0.2, 0.35, 'sine', 0.05);
    } else {
      // ブザー：低い角ばった音を、やわらげて鳴らす
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.connect(out);
      const buzz = (t0, d) => { sfxTone(ctx, lp, 155, t0, d, 'square', 0.16); sfxTone(ctx, lp, 158, t0, d, 'sawtooth', 0.07); };
      if (kind === 'ng') { buzz(t, 0.17); buzz(t + 0.24, 0.55); } // ブッ ブー
      else { buzz(t, 0.13); buzz(t + 0.2, 0.13); } // ブッ ブッ
    }
  } catch (e) {}
}
