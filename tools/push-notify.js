// ================================================================
// ★【0.03.14】プッシュ通知の送信（GitHub Actions から定期的に実行する）
//   node tools/push-notify.js [all|reminders|update]
//  ・reminders: 学習の催促。各ユーザーが決めた時刻を過ぎて、その日まだ学習していなければ知らせる（1日1回）
//  ・update:    アップデートのお知らせ。version-info.js のバージョンが前回知らせたものと違えば、全員に知らせる
// 必要なもの：環境変数 FIREBASE_SERVICE_ACCOUNT（Firebase のサービスアカウントの秘密鍵 JSON）
// ================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MODE = process.argv[2] || 'all';
const APP_URL = process.env.APP_URL || 'https://susuruchachi.github.io/-anki0.02.03.000-0-c/';
const PUSH_COL = 'susuru_anki_push';
const META_DOC = 'susuru_anki_meta/push';
const ROOT = path.join(__dirname, '..');

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.log('FIREBASE_SERVICE_ACCOUNT が設定されていないので、プッシュ通知は送りません（docs/notifications-setup.md を参照）');
  process.exit(0);
}
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
const messaging = admin.messaging();

// そのユーザーの端末の時刻（tzOffset は Date#getTimezoneOffset の値。日本なら -540）
function localNow(tzOffset) {
  const off = Number.isFinite(tzOffset) ? tzOffset : -540;
  const d = new Date(Date.now() - off * 60000);
  const p = n => String(n).padStart(2, '0');
  return { date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`, minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

// トークンごとに送る。使えなくなったトークンは消す
async function sendToUser(docRef, data, payload) {
  const tokens = Object.keys(data.tokens || {});
  if (!tokens.length) return 0;
  const messages = tokens.map(token => ({
    token,
    data: Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, String(v)])),
    webpush: { headers: { Urgency: 'high', TTL: String(12 * 3600) } }
  }));
  const res = await messaging.sendEach(messages);
  const dead = [];
  res.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error && r.error.code;
      console.log(`  送信失敗 ${data.uid}: ${code}`);
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token' || code === 'messaging/invalid-argument') dead.push(tokens[i]);
    }
  });
  if (dead.length) {
    await docRef.update(...dead.flatMap(t => [new admin.firestore.FieldPath('tokens', t), admin.firestore.FieldValue.delete()])).catch(e => console.log('  トークン削除失敗', e.message));
  }
  return res.successCount;
}

async function sendReminders() {
  const snap = await db.collection(PUSH_COL).where('reminder', '==', true).get();
  let sent = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    const now = localNow(d.tzOffset);
    const [h, m] = String(d.time || '20:00').split(':').map(Number);
    if (now.minutes < h * 60 + m) continue;          // まだ時刻になっていない
    if (d.lastStudyDate === now.date) continue;       // 今日はもう学習した
    if (d.lastRemindDate === now.date) continue;      // 今日はもう知らせた
    const body = d.weakCount > 0 ? `苦手なカードが ${d.weakCount} 枚あります。1問だけでも解いてみませんか？` : '1問だけでも解いてみませんか？';
    const n = await sendToUser(doc.ref, d, { kind: 'reminder', tag: 'reminder', title: '📚 今日の学習がまだです', body, url: APP_URL });
    await doc.ref.update({ lastRemindDate: now.date });
    sent += n;
  }
  console.log(`催促: ${sent} 件送信（対象 ${snap.size} 人）`);
}

// ★【0.03.27】週間プラン：単語の期限が近い・過ぎた、例文・復習が残っている、を1日1回知らせる
function planMessage(pl, nowMs, dow) {
  if (!pl) return '';
  if (!pl.wordsDone && nowMs >= pl.from) {
    const left = pl.due - nowMs;
    if (left < 0) return left > -3 * 86400000 ? `⏰ 単語（${pl.cat}）の期限を過ぎています。今日中に終わらせましょう` : '';
    const d = Math.floor(left / 86400000);
    return d >= 1 ? `🧠 今週の単語（${pl.cat}）：期限まであと${d}日` : `🔥 今夜が単語（${pl.cat}）の期限です`;
  }
  if (pl.wordsDone && pl.examples && !pl.examplesDone && nowMs > pl.due - 86400000) return `📖 今週の例文・チャンツ（${pl.cat}）をやりましょう`;
  if (pl.sunday && !pl.sundayDone && dow === pl.reviewDay) return '🔁 今日は先週の範囲の復習の日です';
  return '';
}
async function sendPlanReminders() {
  const snap = await db.collection(PUSH_COL).get();
  let sent = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    if (!d.plan) continue;
    const now = localNow(d.tzOffset);
    const [h, m] = String(d.time || '20:00').split(':').map(Number);
    if (now.minutes < h * 60 + m || d.lastPlanRemindDate === now.date) continue;
    const dow = new Date(Date.now() - (Number.isFinite(d.tzOffset) ? d.tzOffset : -540) * 60000).getUTCDay();
    const body = planMessage(d.plan, Date.now(), dow);
    if (!body) continue;
    sent += await sendToUser(doc.ref, d, { kind: 'plan', tag: 'plan', title: '📅 今週のプラン', body, url: APP_URL });
    await doc.ref.update({ lastPlanRemindDate: now.date });
  }
  console.log(`週間プラン: ${sent} 件送信`);
}

function readVersionInfo() {
  const v = (fs.readFileSync(path.join(ROOT, 'version-info.js'), 'utf8').match(/APP_VERSION\s*=\s*["']([^"']+)["']/) || [])[1];
  let title = '';
  try {
    const ctx = {}; vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'release-notes.js'), 'utf8').replace('const BUNDLED_RELEASE_NOTES', 'var BUNDLED_RELEASE_NOTES'), ctx);
    const note = (ctx.BUNDLED_RELEASE_NOTES || []).find(n => n.version === v);
    if (note) title = note.title;
  } catch (e) {}
  return { version: v, title };
}

async function sendUpdate() {
  const { version, title } = readVersionInfo();
  if (!version) return console.log('バージョンを読めませんでした');
  const metaRef = db.doc(META_DOC);
  const meta = (await metaRef.get()).data() || {};
  if (!meta.lastVersion) { await metaRef.set({ lastVersion: version }, { merge: true }); return console.log(`初回なので v${version} を記録だけしました`); }
  if (meta.lastVersion === version) return console.log(`v${version} は知らせ済み`);
  const snap = await db.collection(PUSH_COL).where('updates', '==', true).get();
  let sent = 0;
  for (const doc of snap.docs) {
    sent += await sendToUser(doc.ref, doc.data(), { kind: 'update', tag: 'update', version, title: `🆕 すするanki v${version}`, body: title || '新しい機能・修正があります。開いてお知らせを見てみましょう', url: APP_URL });
  }
  await metaRef.set({ lastVersion: version }, { merge: true });
  console.log(`アップデートのお知らせ v${version}: ${sent} 件送信`);
}

// ★【0.03.25】フレンド申請が届いた・承認された、を知らせる（それぞれ1回だけ）
async function sendFriendNotices() {
  const col = db.collection('susuru_anki_friend_requests');
  let sent = 0;
  const pushOf = async uid => { const ref = db.collection(PUSH_COL).doc(uid); const s = await ref.get(); return s.exists && s.data().friends !== false ? { ref, data: s.data() } : null; };
  for (const doc of (await col.where('status', '==', 'pending').get()).docs) {
    const d = doc.data();
    if (d.notifiedTo) continue;
    const p = await pushOf(d.to);
    if (p) sent += await sendToUser(p.ref, p.data, { kind: 'friend', tag: 'friend-' + doc.id, title: '🤝 フレンド申請', body: `${d.fromName || '名無し'} さんからフレンド申請が届きました`, url: APP_URL + '#friends' });
    await doc.ref.update({ notifiedTo: true });
  }
  for (const doc of (await col.where('status', '==', 'accepted').get()).docs) {
    const d = doc.data();
    if (d.notifiedFrom) continue;
    const p = await pushOf(d.from);
    if (p) sent += await sendToUser(p.ref, p.data, { kind: 'friend', tag: 'friend-' + doc.id, title: '✅ フレンド申請が承認されました', body: `${d.toName || '相手'} さんとフレンドになりました`, url: APP_URL + '#friends' });
    await doc.ref.update({ notifiedFrom: true });
  }
  console.log(`フレンド申請のお知らせ: ${sent} 件送信`);
}

(async () => {
  if (MODE === 'all' || MODE === 'friends') await sendFriendNotices().catch(e => console.log('フレンド申請のお知らせに失敗:', e.message));
  if (MODE === 'all' || MODE === 'reminders') await sendReminders();
  if (MODE === 'all' || MODE === 'plan') await sendPlanReminders().catch(e => console.log('週間プランの通知に失敗:', e.message));
  if (MODE === 'all' || MODE === 'update') await sendUpdate();
  // アプリ側が「送信側が動いている」と分かるように、最後に動いた時刻を書く
  await db.doc(META_DOC).set({ lastRunAt: Date.now() }, { merge: true });
})().catch(e => { console.error(e); process.exit(1); });
