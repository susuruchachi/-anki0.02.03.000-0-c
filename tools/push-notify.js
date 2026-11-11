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

// ★【0.04.10】催促・週間プラン・煽りの通知の間隔（時間。設定の「通知の間隔」、はじめは1時間）。
//  通知の時刻から、その間隔ごとに1回まで（その日の 23:59 まで）。24 なら1日1回
function nudgeSlot(d, now) {
  const [h, m] = String(d.time || '20:00').split(':').map(Number), start = h * 60 + m;
  if (now.minutes < start) return null;
  const every = [1, 2, 3, 4, 6, 12, 24].includes(Number(d.every)) ? Number(d.every) : 1;
  return `${now.date}#${every}h#${Math.floor((now.minutes - start) / (every * 60))}`;
}
async function sendReminders() {
  const snap = await db.collection(PUSH_COL).where('reminder', '==', true).get();
  let sent = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    const now = localNow(d.tzOffset);
    const slot = nudgeSlot(d, now);
    if (!slot) continue;                              // まだ時刻になっていない
    if (d.lastStudyDate === now.date) continue;       // 今日はもう学習した
    if (d.lastRemindSlot === slot) continue;          // この間隔の中ではもう知らせた
    const body = d.weakCount > 0 ? `苦手なカードが ${d.weakCount} 枚あります。1問だけでも解いてみませんか？` : '1問だけでも解いてみませんか？';
    const n = await sendToUser(doc.ref, d, { kind: 'reminder', tag: 'reminder', title: '📚 今日の学習がまだです', body, url: APP_URL });
    await doc.ref.update({ lastRemindDate: now.date, lastRemindSlot: slot });
    sent += n;
  }
  console.log(`催促: ${sent} 件送信（対象 ${snap.size} 人）`);
}

// ★【0.03.27】週間プラン：単語の期限が近い・過ぎた、例文・復習が残っている、を1日1回知らせる
// ★【0.03.36】終わっていない課題ごとに1つずつ通知する。押すとその課題をそのまま始める（?plantask=プランID:課題）
function planTaskMessages(pl, nowMs, dow) {
  if (!pl) return [];
  const out = [];
  if (!pl.wordsDone && nowMs >= pl.from) {
    const left = pl.due - nowMs;
    if (left < 0) { if (left > -3 * 86400000) out.push({ key: 'words', title: '⏰ 単語の期限を過ぎています', body: `${pl.cat}：今日中に暗記テストを終わらせましょう` }); }
    else {
      const d = Math.floor(left / 86400000);
      out.push({ key: 'words', title: d >= 1 ? `🧠 今週の単語：期限まであと${d}日` : '🔥 今夜が単語の期限です', body: `${pl.cat}：押すと暗記テストを始めます` });
    }
  }
  // ★【0.03.41】単語に合格 → チャンツ → 例文 の順
  const chantsLeft = pl.chants && !pl.chantsDone;
  if (pl.wordsDone && chantsLeft) out.push({ key: 'chants', title: '🎵 今週のチャンツ', body: `${pl.cat}：単語は合格！次はチャンツ。押すと始めます` });
  if (pl.wordsDone && !chantsLeft && pl.examples && !pl.examplesDone && nowMs > pl.due - 86400000) out.push({ key: 'examples', title: '📖 今週の例文', body: `${pl.cat}：押すと始めます` });
  if (pl.sunday && !pl.sundayDone && dow === pl.reviewDay) out.push({ key: 'sunday', title: '🔁 今日は先週の範囲の復習の日です', body: `${pl.prevCat || '先週の範囲'}：押すと始めます` });
  return out;
}
async function sendPlanReminders() {
  const snap = await db.collection(PUSH_COL).get();
  let sent = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    const plans = Array.isArray(d.plans) ? d.plans : (d.plan ? [d.plan] : []); // ★【0.03.33】複数のプラン
    if (!plans.length) continue;
    const now = localNow(d.tzOffset);
    const slot = nudgeSlot(d, now);
    if (!slot) continue;
    const dow = new Date(Date.now() - (Number.isFinite(d.tzOffset) ? d.tzOffset : -540) * 60000).getUTCDay();
    const done = Object.assign({}, d.planReminded || {});
    Object.keys(done).forEach(k => { if (!String(done[k]).startsWith(now.date)) delete done[k]; }); // 前の日の記録は消す
    let changed = false;
    for (const pl of plans) {
      for (const msg of planTaskMessages(pl, Date.now(), dow)) {
        const k = `${pl.planId || 'p'}:${msg.key}`;
        if (done[k] === slot) continue; // この間隔の中ではもう知らせた
        const url = pl.planId ? `${APP_URL}?plantask=${encodeURIComponent(pl.planId + ':' + msg.key)}` : APP_URL;
        sent += await sendToUser(doc.ref, d, { kind: 'plan', tag: 'plan-' + k, title: msg.title, body: msg.body, url });
        done[k] = slot; changed = true;
      }
    }
    if (changed) await doc.ref.update({ planReminded: done, lastPlanRemindDate: now.date });
  }
  console.log(`週間プラン: ${sent} 件送信`);
}

// ★【0.03.34】バージョンは公開しているサイトから読む（定期実行は main のファイルで動くが、サイトは別のブランチから公開していることがあるため）
async function readSiteFile(name) {
  // バージョンを上げて push したときは、まだサイトに出る前なので、押されたブランチのファイルを使う
  if (process.env.GITHUB_EVENT_NAME === 'push') return fs.readFileSync(path.join(ROOT, name), 'utf8');
  try { const r = await fetch(APP_URL + name + '?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) return await r.text(); } catch (e) {}
  return fs.readFileSync(path.join(ROOT, name), 'utf8');
}
async function readVersionInfo() {
  const v = ((await readSiteFile('version-info.js')).match(/APP_VERSION\s*=\s*["']([^"']+)["']/) || [])[1];
  let title = '';
  try {
    const ctx = {}; vm.createContext(ctx);
    vm.runInContext((await readSiteFile('release-notes.js')).replace('const BUNDLED_RELEASE_NOTES', 'var BUNDLED_RELEASE_NOTES'), ctx);
    const note = (ctx.BUNDLED_RELEASE_NOTES || []).find(n => n.version === v);
    if (note) title = note.title;
  } catch (e) {}
  return { version: v, title };
}

// ★【0.03.35】知らせ済みのバージョンは lastSiteVersion に記録する（公開しているサイトのバージョン）。
// main にある古い送信側（v0.03.14 まで）は lastVersion と「main のファイルのバージョン」を比べるので、
// lastVersion は main のバージョンにしておく（そうしないと古い送信側が「v0.03.14 が出ました」と送ってしまう）
async function mainVersion() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) return null;
  try { const r = await fetch(`https://raw.githubusercontent.com/${repo}/main/version-info.js?t=${Date.now()}`); if (r.ok) return ((await r.text()).match(/APP_VERSION\s*=\s*["']([^"']+)["']/) || [])[1] || null; } catch (e) {}
  return null;
}
async function sendUpdate() {
  const { version, title } = await readVersionInfo();
  if (!version) return console.log('バージョンを読めませんでした');
  const metaRef = db.doc(META_DOC);
  const meta = (await metaRef.get()).data() || {};
  const mv = await mainVersion();
  const keepOld = mv ? { lastVersion: mv } : {};
  const last = meta.lastSiteVersion || meta.lastVersion;
  if (!last) { await metaRef.set(Object.assign({ lastSiteVersion: version }, keepOld), { merge: true }); return console.log(`初回なので v${version} を記録だけしました`); }
  if (last === version) { await metaRef.set(Object.assign({ lastSiteVersion: version }, keepOld), { merge: true }); return console.log(`v${version} は知らせ済み`); }
  const snap = await db.collection(PUSH_COL).where('updates', '==', true).get();
  let sent = 0;
  for (const doc of snap.docs) {
    sent += await sendToUser(doc.ref, doc.data(), { kind: 'update', tag: 'update', version, title: `🆕 すするanki v${version}`, body: title || '新しい機能・修正があります。開いてお知らせを見てみましょう', url: APP_URL });
  }
  await metaRef.set(Object.assign({ lastSiteVersion: version }, keepOld), { merge: true });
  console.log(`アップデートのお知らせ v${version}: ${sent} 件送信`);
}

// ★【0.03.25】フレンド申請が届いた・承認された、を知らせる（それぞれ1回だけ）
// ★【0.03.42】フレンドの頑張りで煽る（★0.03.53：通知の時刻から4時間ごと、その日の 23:59 まで）。
//  プランバトル（同じ単語帳のプラン）で負けていればその差を、そうでなければ今日の正解数で負けていれば知らせる
function weekKeyOf(dateStr) { const [y, m, d] = dateStr.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, d)); x.setUTCDate(x.getUTCDate() - (x.getUTCDay() + 6) % 7); return x.toISOString().slice(0, 10); }
function racePoints(r) { return (r.words ? 30 : 0) + (r.words && r.onTime ? 10 : 0) + (r.chants ? 20 : 0) + (r.examples ? 20 : 0) + (r.sunday ? 15 : 0) + (r.monthly ? 15 : 0) + (Number(r.dc) || 0); }
// ★【0.04.08】暗記テストの進み具合（アプリの drillProgText と同じ文）。先に進んでいる方が大きい数
function progText(d) {
  if (!d) return '';
  if (d.passed) return `合格（${d.r}周）`;
  if (d.r === 1) return `1周目・${d.to ? `No.${d.to} まで` : 'はじめたところ'}`;
  return `${d.r}周目${d.final ? '（最終ループ）' : ''}・残り ${d.left}問`;
}
function progRank(d) {
  if (!d) return -1;
  if (d.passed) return 1e12;
  const no = String(d.to || '').split('-').map(Number), n = (no[0] || 0) + (no[1] || 0) / 100 + (no[2] || 0) / 10000;
  return d.r * 1e8 + (d.r === 1 ? n : (d.rt ? (d.rt - (d.left || 0)) / d.rt * 1e6 : 0));
}
const progFor = (who, cat) => (who.progs || []).filter(p => p.cat === cat).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
function tauntMessage(myName, me, friends) {
  // me / friends: { name, today, races: [{root, week, points, words, chants, cur}], progs: [暗記テストの進み具合] }
  let best = null;
  friends.forEach(f => (f.races || []).forEach(r => {
    const mine = (me.races || []).find(x => x.root === r.root);
    if (!mine) return;
    const d = r.points - mine.points;
    if (d > 0 && (!best || d > best.d)) best = { d, f, r, mine };
  }));
  if (best) {
    const extra = best.r.words && !best.mine.words ? `${best.f.name}さんはもう今週の単語に合格。` : best.r.chants && !best.mine.chants ? `${best.f.name}さんはチャンツまで終わってます。` : '';
    const fp = progFor(best.f, best.r.cur), mp = progFor(me, best.r.cur);
    const pg = fp ? `${best.f.name}さんの暗記テストは「${progText(fp)}」${mp ? `、あなたは「${progText(mp)}」` : ''}。` : '';
    return { title: `⚔️ ${best.r.root}バトル：${best.f.name}さんに ${best.d}点差`, body: `${extra}${pg}このままだと置いていかれるよ？押して巻き返そう` };
  }
  // 同じフォルダーの暗記テストで、フレンドのほうが先に進んでいる
  let ahead = null;
  friends.forEach(f => (f.progs || []).forEach(p => {
    if (Date.now() - (p.updatedAt || 0) > 3 * 86400000) return; // 3日より前の記録は使わない
    const mp = progFor(me, p.cat), gap = progRank(p) - progRank(mp);
    if (gap > 0 && (!ahead || p.updatedAt > ahead.p.updatedAt)) ahead = { f, p, mp };
  }));
  if (ahead) return { title: `🧠 ${ahead.f.name}さんは「${ahead.p.cat}」の暗記テストが ${progText(ahead.p)}`, body: ahead.mp ? `あなたは ${progText(ahead.mp)}。押して追いつこう` : 'あなたはまだ始めていません。押して始めよう' };
  const top = friends.filter(f => f.today > me.today && f.today > 0).sort((a, b) => b.today - a.today)[0];
  if (top) { const tp = (top.progs || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    return { title: `🔥 ${top.name}さんは今日もう ${top.today}問 正解！`, body: (tp ? `暗記テストは「${tp.cat}」${progText(tp)}。` : '') + (me.today ? `あなたは ${me.today}問。まだ追いつけます` : 'あなたはまだ0問…1問だけでも始めよう') }; }
  return null;
}
async function sendTaunts() {
  const snap = await db.collection(PUSH_COL).get();
  let sent = 0;
  const cache = {};
  const todayOf = async (uid, date) => { const k = date + '_' + uid; if (!(k in cache)) { const s = await db.collection('susuru_anki_daily_scores').doc(k).get(); const d = s.exists ? s.data() : {}; cache[k] = (Number(d.score) || 0) + (Number(d.drillScore) || 0); } return cache[k]; };
  const progsOf = async uid => { const k = 'prog:' + uid; if (!(k in cache)) cache[k] = (await db.collection('susuru_anki_category_scores').where('uid', '==', uid).where('mode', '==', 'drillprog').get()).docs.map(d => d.data()); return cache[k]; };
  const racesOf = async (uid, wk) => { const k = 'race:' + uid; if (!(k in cache)) cache[k] = (await db.collection('susuru_anki_category_scores').where('uid', '==', uid).where('mode', '==', 'race').get()).docs.map(d => d.data()); return cache[k].filter(r => r.week === wk).map(r => Object.assign({}, r, { points: racePoints(r) })); };
  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.taunt === false || !Object.keys(d.tokens || {}).length) continue;
    const now = localNow(d.tzOffset);
    // ★【0.04.10】通知の時刻から、設定の間隔ごと（はじめは1時間ごと。その日の 23:59 まで）
    const slot = nudgeSlot(d, now);
    if (!slot) continue;
    if (d.lastTauntSlot === slot) continue;
    const prof = await db.collection('susuru_anki_profiles').doc(doc.id).get();
    const fl = prof.exists ? (prof.data().friends || []) : [];
    if (!fl.length) continue;
    const wk = weekKeyOf(now.date);
    const me = { today: await todayOf(doc.id, now.date), races: await racesOf(doc.id, wk), progs: await progsOf(doc.id) };
    const friends = [];
    for (const f of fl.slice(0, 30)) {
      const fp = await db.collection('susuru_anki_profiles').doc(f).get();
      friends.push({ name: (fp.exists && fp.data().displayName) || 'フレンド', today: await todayOf(f, now.date), races: await racesOf(f, wk), progs: await progsOf(f) });
    }
    const msg = tauntMessage(prof.data().displayName, me, friends);
    await doc.ref.update({ lastTauntSlot: slot, lastTauntDate: now.date });
    if (msg) sent += await sendToUser(doc.ref, d, { kind: 'taunt', tag: 'taunt', title: msg.title, body: msg.body, url: APP_URL + '?page=pgDrill' });
  }
  console.log(`フレンドの頑張りのお知らせ: ${sent} 件送信`);
}

// ★【0.03.52】公開カテゴリーの目次（アプリの一覧はこれだけを読む）を作り直す。目次に無い・食い違うものだけ書く
async function rebuildPublicIndex() {
  const idxCol = db.collection('susuru_anki_public_index');
  const have = {}; (await idxCol.get()).docs.forEach(d => { have[d.id] = d.data(); });
  const snap = await db.collection('susuru_anki_shared').where('isPublic', '==', true).get();
  let wrote = 0; const alive = new Set();
  for (const doc of snap.docs) {
    const d = doc.data(); alive.add(doc.id);
    const e = { isPublic: true, catName: d.catName || '', ownerId: d.ownerId || '', ownerName: d.ownerName || '', cardCount: (d.cards || []).length, subscriberCount: (d.subscriberUids || []).length, shareCode: d.shareCode || null };
    const h = have[doc.id];
    if (h && ['catName', 'ownerId', 'ownerName', 'cardCount', 'subscriberCount', 'shareCode'].every(k => h[k] === e[k])) continue;
    await idxCol.doc(doc.id).set(Object.assign(e, { updatedAt: Date.now() })); wrote++;
  }
  let removed = 0;
  for (const id of Object.keys(have)) if (!alive.has(id)) { await idxCol.doc(id).delete(); removed++; }
  console.log(`公開カテゴリーの目次: ${snap.size} 件中 ${wrote} 件を書き直し、${removed} 件を削除`);
}

// ★【0.04.10】要望・報告が届いたら、管理者だけに知らせる（管理者の UID は updates.js の ADMIN_UID）
async function sendReportNotices() {
  const adminUid = (fs.readFileSync(path.join(ROOT, 'updates.js'), 'utf8').match(/ADMIN_UID\s*=\s*["']([^"']+)["']/) || [])[1];
  if (!adminUid) return console.log('管理者の UID が分かりません');
  const metaRef = db.doc(META_DOC);
  const meta = (await metaRef.get()).data() || {};
  const since = Number(meta.lastReportAt) || 0;
  if (!since) { await metaRef.set({ lastReportAt: Date.now() }, { merge: true }); return console.log('要望・報告：今から届いたものを知らせます'); }
  const snap = await db.collection('susuru_anki_reports').where('date', '>', admin.firestore.Timestamp.fromMillis(since)).orderBy('date', 'asc').limit(20).get();
  if (snap.empty) return;
  const pref = await db.collection(PUSH_COL).doc(adminUid).get();
  let sent = 0, last = since;
  for (const doc of snap.docs) {
    const d = doc.data(), at = d.date && d.date.toMillis ? d.date.toMillis() : Date.now();
    last = Math.max(last, at);
    if (pref.exists) sent += await sendToUser(pref.ref, pref.data(), { kind: 'report', tag: 'report-' + doc.id, title: `📮 要望・報告：${d.name || '名無し'}（v${d.version || '?'}）`, body: String(d.content || '').slice(0, 120), url: APP_URL + '?page=pgBackup' });
  }
  await metaRef.set({ lastReportAt: last }, { merge: true });
  console.log(`要望・報告のお知らせ（管理者）: ${sent} 件送信`);
}

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
  // ★【0.03.47】フレンドの紹介
  for (const doc of (await db.collection('susuru_anki_friend_intros').get()).docs) {
    const d = doc.data();
    if (d.notifiedTo) continue;
    const p = await pushOf(d.to);
    if (p) sent += await sendToUser(p.ref, p.data, { kind: 'friend', tag: 'intro-' + doc.id, title: '🤝 フレンドの紹介', body: `${d.fromName || 'フレンド'} さんが ${d.introName || '名無し'} さんを紹介しました。押すとフレンド申請を送れます`, url: APP_URL + '#friends' });
    await doc.ref.update({ notifiedTo: true });
  }
  console.log(`フレンド申請のお知らせ: ${sent} 件送信`);
}

(async () => {
  if (MODE === 'all' || MODE === 'friends' || MODE === 'reports') await sendReportNotices().catch(e => console.log('要望・報告のお知らせに失敗:', e.message));
  if (MODE === 'all' || MODE === 'friends') await sendFriendNotices().catch(e => console.log('フレンド申請のお知らせに失敗:', e.message));
  if (MODE === 'all' || MODE === 'reminders') await sendReminders();
  if (MODE === 'all' || MODE === 'plan') await sendPlanReminders().catch(e => console.log('週間プランの通知に失敗:', e.message));
  if (MODE === 'all' || MODE === 'taunt') await sendTaunts().catch(e => console.log('フレンドの頑張りのお知らせに失敗:', e.message));
  if (MODE === 'all' || MODE === 'update') await sendUpdate();
  if (MODE === 'update' || MODE === 'index') await rebuildPublicIndex().catch(e => console.log('公開カテゴリーの目次の作り直しに失敗:', e.message));
  // アプリ側が「送信側が動いている」と分かるように、最後に動いた時刻を書く
  await db.doc(META_DOC).set({ lastRunAt: Date.now() }, { merge: true });
})().catch(e => { console.error(e); process.exit(1); });
