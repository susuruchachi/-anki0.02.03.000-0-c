// ★★★ すするanki0.02.51-g - ソーシャル機能（ランキング・フレンド・チャット・成績比較・オンライン対戦） ★★★

// ★ グローバル変数の安全な初期化
window.shareStats = localStorage.getItem('shareStats') === 'true';

// ★ 本日のデイリーランキング表示
async function loadDailyRanking() {
  const listDiv = document.getElementById('rankingList');
  if (!currentUser) { listDiv.innerHTML = 'ログインしてください'; return; }
  const d = getTodayStr();
  try {
    listDiv.innerHTML = '(読み込み中...)';
    const snap = await firestore.collection('susuru_anki_daily_scores').where('date', '==', d).get();
    
    if(snap.empty) { listDiv.innerHTML = 'まだ今日のスコアがありません。あなたが1番乗りです！'; return; }
    
    let scores = [];
    snap.forEach(doc => scores.push(doc.data()));
    scores.sort((a, b) => (b.score || 0) - (a.score || 0));
    scores = scores.slice(0, 10);
    
    listDiv.innerHTML = '';
    let rank = 1;
    scores.forEach(data => {
      listDiv.innerHTML += `<div><span style="display:inline-block; width:24px; color:var(--warn); font-weight:bold;">${rank}</span>: ${escapeHtml(data.name)} <span style="color:var(--success); font-weight:bold;">(${data.score}問)</span></div>`;
      rank++;
    });
  } catch(e) {
    console.error(e);
    listDiv.innerHTML = '<span style="color:var(--danger)">ランキング取得エラー (通信状況等をご確認ください)</span>';
  }
}

// ★ 自分のUIDをクリップボードにコピー
function copyMyUid() {
  const uid = document.getElementById('txtMyUid').value; 
  if (!uid) return alert("ログインが必要です。");
  navigator.clipboard.writeText(uid).then(() => alert("✅ UIDをコピーしました！"));
}

// ★ フレンド追加（双方向登録）
async function addAppFriend() {
  const fUid = document.getElementById('txtAddFriendUid').value.trim();
  if (!fUid) return alert("UIDを入力してください。"); 
  if (!currentUser) return alert("ログインが必要です。"); 
  if (fUid === currentUser.uid) return alert("自分自身は登録できません。");
  try {
    await firestore.collection('susuru_anki_profiles').doc(currentUser.uid).set({ friends: firebase.firestore.FieldValue.arrayUnion(fUid) }, { merge: true });
    await firestore.collection('susuru_anki_profiles').doc(fUid).set({ friends: firebase.firestore.FieldValue.arrayUnion(currentUser.uid) }, { merge: true });
    document.getElementById('txtAddFriendUid').value = ''; 
    alert("✅ フレンドを追加しました！"); 
    loadAppFriends();
  } catch (e) { alert("⚠️ フレンド追加に失敗しました。ルールの確認を。"); }
}

// ★ フレンド一覧を読み込んで表示
async function loadAppFriends() {
  const listDiv = document.getElementById('appFriendsList'); 
  listDiv.innerHTML = '<p style="color:var(--text3); font-size:0.8rem; text-align:center;">読み込み中...</p>';
  if (!currentUser) { listDiv.innerHTML = '<p style="color:var(--danger); font-size:0.85rem; text-align:center;">ログインしてください</p>'; return; }
  try {
    const myProfileSnap = await firestore.collection('susuru_anki_profiles').doc(currentUser.uid).get();
    const friends = myProfileSnap.exists ? (myProfileSnap.data().friends || []) : [];
    if (friends.length === 0) { listDiv.innerHTML = '<p style="color:var(--text3); font-size:0.85rem; text-align:center;">フレンドはいません。</p>'; return; }
    listDiv.innerHTML = '';
    for (const fUid of friends) {
      const fProfSnap = await firestore.collection('susuru_anki_profiles').doc(fUid).get();
      const fName = fProfSnap.exists ? fProfSnap.data().displayName : '未登録ユーザー';
      const div = document.createElement('div'); div.className = 'achieve-row';
      div.innerHTML = `<div class="achieve-label">👤 ${escapeHtml(fName)}</div><button class="btn" style="width:auto; padding:6px 12px; font-size:0.8rem;" onclick="openChat(${jsArg(fUid)}, ${jsArg(fName)})">💬</button>`;
      listDiv.appendChild(div);
    }
  } catch (e) { listDiv.innerHTML = '<p style="color:var(--danger); font-size:0.8rem; text-align:center;">エラーが発生しました。</p>'; }
}

let currentChatUnsubscribe = null, currentChatFriendUid = null;
function getChatId(uid1, uid2) { return [uid1, uid2].sort().join('_'); }

function openChat(friendUid, friendName) {
  document.getElementById('friendsListArea').style.display = 'none'; 
  document.getElementById('chatArea').style.display = 'flex'; 
  document.getElementById('chatWithTitle').innerText = friendName + " とのチャット";
  currentChatFriendUid = friendUid; 
  const chatId = getChatId(currentUser.uid, friendUid); 
  const msgBox = document.getElementById('chatMessages'); 
  msgBox.innerHTML = '履歴を取得中...';
  
  if (currentChatUnsubscribe) currentChatUnsubscribe();
  currentChatUnsubscribe = firestore.collection('susuru_anki_chats').doc(chatId).collection('messages').orderBy('timestamp', 'asc').onSnapshot(snap => {
    msgBox.innerHTML = ''; 
    if (snap.empty) { msgBox.innerHTML = '<div style="color:var(--text3); text-align:center; font-size:0.8rem;">まだメッセージがありません。</div>'; }
    snap.forEach(doc => {
      const data = doc.data(); const isMe = data.senderId === currentUser.uid;
      const wrap = document.createElement('div'); wrap.style.cssText = `display:flex; flex-direction:column; max-width:80%; ${isMe ? 'align-self:flex-end;' : 'align-self:flex-start;'}`;
      const bubble = document.createElement('div'); bubble.style.cssText = `padding:10px 14px; border-radius:14px; font-size:0.9rem; word-break:break-all; ${isMe ? 'background:var(--primary); color:#fff; border-bottom-right-radius:2px;' : 'background:var(--bg3); border:1px solid var(--border); color:var(--text); border-bottom-left-radius:2px;'}`;
      bubble.innerText = data.text; wrap.appendChild(bubble); msgBox.appendChild(wrap);
    });
    msgBox.scrollTop = msgBox.scrollHeight;
  });
}

function closeChat() { 
  if (currentChatUnsubscribe) { currentChatUnsubscribe(); currentChatUnsubscribe = null; } 
  document.getElementById('chatArea').style.display = 'none'; 
  document.getElementById('friendsListArea').style.display = 'flex'; 
  currentChatFriendUid = null; 
}

async function sendChatMessage() {
  const input = document.getElementById('txtChatInput'); 
  const text = input.value.trim(); 
  if (!text || !currentChatFriendUid) return;
  const chatId = getChatId(currentUser.uid, currentChatFriendUid);
  try { 
    await firestore.collection('susuru_anki_chats').doc(chatId).collection('messages').add({ text: text, senderId: currentUser.uid, timestamp: firebase.firestore.FieldValue.serverTimestamp() }); 
    input.value = ''; 
  } catch (e) { alert("⚠️ エラーが発生しました。"); }
}

// ★ カテゴリー別ランキング
async function loadCategoryRanking(catName) {
  const listDiv = document.getElementById('categoryRankingList');
  if (!currentUser) { listDiv.innerHTML = 'ログインしてください'; return; }
  const d = getTodayStr();
  try {
    listDiv.innerHTML = '(読み込み中...)';
    const snap = await firestore.collection('susuru_anki_category_scores').where('date', '==', d).where('category', '==', catName).get();
    
    if(snap.empty) { listDiv.innerHTML = `このカテゴリーはまだスコアがありません。`; return; }
    
    let scores = [];
    snap.forEach(doc => scores.push(doc.data()));
    scores.sort((a, b) => (b.score || 0) - (a.score || 0));
    scores = scores.slice(0, 10);
    
    listDiv.innerHTML = '';
    let rank = 1;
    scores.forEach(data => {
      listDiv.innerHTML += `<div class="card" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; padding:10px;"><span style="color:var(--warn); font-weight:bold; font-size:1.1rem;">#${rank}</span><span>${escapeHtml(data.name || 'Unknown')}</span><span style="color:var(--success); font-weight:bold;">${data.score || 0}問</span></div>`;
      rank++;
    });
  } catch(e) {
    console.error(e);
    listDiv.innerHTML = '<span style="color:var(--danger)">ランキング取得エラー</span>';
  }
}

// ★ 成績保存
async function recordCategoryScore(catName, isCorrect) {
  const isShared = typeof window.shareStats !== 'undefined' ? window.shareStats : (localStorage.getItem('shareStats') === 'true');
  if(!currentUser || !isShared) return;

  const d = getTodayStr();
  const ref = firestore.collection('susuru_anki_category_scores').doc(`${d}_${currentUser.uid}_${catName}`);
  try {
    await ref.set({
      date: d,
      category: catName,
      uid: currentUser.uid,
      name: currentUser.displayName || 'Anonymous',
      score: firebase.firestore.FieldValue.increment(isCorrect ? 1 : 0),
      total: firebase.firestore.FieldValue.increment(1)
    }, { merge: true });
  } catch(e) {}
}

// ★ 成績共有設定のトグル
function toggleShareStats() {
  const chk = document.getElementById('chkShareStats');
  window.shareStats = chk.checked;
  localStorage.setItem('shareStats', window.shareStats);
  alert(window.shareStats ? '✅ 成績共有を有効にしました' : '✅ 成績共有を無効にしました');
}

// ★ フレンド成績比較ページ用
async function loadFriendsForComparison() {
  if (!currentUser) return;
  try {
    const myProfileSnap = await firestore.collection('susuru_anki_profiles').doc(currentUser.uid).get();
    const friends = myProfileSnap.exists ? (myProfileSnap.data().friends || []) : [];
    
    const select = document.getElementById('selCompareFriend');
    select.innerHTML = '<option value="">フレンドを選択...</option>';
    
    for (const friendUid of friends) {
      try {
        const friendSnap = await firestore.collection('susuru_anki_profiles').doc(friendUid).get();
        const friendName = friendSnap.exists ? (friendSnap.data().displayName || friendUid) : friendUid;
        const opt = document.createElement('option');
        opt.value = friendUid;
        opt.innerText = friendName;
        select.appendChild(opt);
      } catch(e) {}
    }
    
    const catSelect = document.getElementById('selCompareCategory');
    catSelect.innerHTML = '<option value="">🌐 全カテゴリー</option>';
    categories.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.innerText = c;
      catSelect.appendChild(opt);
    });
  } catch(e) {}
}

// ★【0.02.59-g】成績比較: 折れ線グラフ（横軸=日付、縦軸=正答率）
let compareChartInstance = null;

async function renderCompareStats() {
  const friendUid = document.getElementById('selCompareFriend').value;
  const category = document.getElementById('selCompareCategory').value;
  const area = document.getElementById('compareStatsArea');

  if (!friendUid) {
    area.innerHTML = '<div style="text-align:center; color:var(--text3); padding:40px;">フレンドを選択してください</div>';
    return;
  }

  area.innerHTML = '<div style="text-align:center; color:var(--text2);">読み込み中...</div>';

  try {
    const [mySnap, friendSnap] = await Promise.all([
      firestore.collection('susuru_anki_category_scores').where('uid', '==', currentUser.uid).get(),
      firestore.collection('susuru_anki_category_scores').where('uid', '==', friendUid).get()
    ]);

    // date -> { my: rate, friend: rate, friendName } のマップを作る
    const dateMap = {}; // key: date, value: { myScore, myTotal, friendScore, friendTotal, friendName }
    let friendName = 'フレンド';

    const accumulate = (doc, isMe) => {
      const d = doc.data();
      if (category && d.category !== category) return;
      if (!dateMap[d.date]) dateMap[d.date] = { myScore: 0, myTotal: 0, friendScore: 0, friendTotal: 0, friendName: '?' };
      if (isMe) {
        dateMap[d.date].myScore += (d.score || 0);
        dateMap[d.date].myTotal += (d.total || 0);
      } else {
        dateMap[d.date].friendScore += (d.score || 0);
        dateMap[d.date].friendTotal += (d.total || 0);
        dateMap[d.date].friendName = d.name || 'フレンド';
        friendName = d.name || 'フレンド';
      }
    };

    mySnap.forEach(doc => accumulate(doc, true));
    friendSnap.forEach(doc => accumulate(doc, false));

    const allDates = Object.keys(dateMap).sort();

    area.innerHTML = '';

    if (allDates.length === 0) {
      area.innerHTML = '<div style="text-align:center; color:var(--text3); padding:40px;">成績データがありません</div>';
      return;
    }

    // グラフ用canvasラッパー
    const chartWrap = document.createElement('div');
    chartWrap.style.cssText = 'background:var(--bg3); border:1px solid var(--border); border-radius:12px; padding:16px; margin-bottom:16px;';

    const titleDiv = document.createElement('div');
    titleDiv.style.cssText = 'font-size:0.85rem; color:var(--text2); margin-bottom:10px; text-align:center;';
    titleDiv.innerText = category ? `📂 ${category} の正答率推移` : '🌐 全カテゴリー 正答率推移';
    chartWrap.appendChild(titleDiv);

    const canvas = document.createElement('canvas');
    canvas.id = 'compareLineChart';
    canvas.style.cssText = 'width:100%; max-height:260px;';
    chartWrap.appendChild(canvas);
    area.appendChild(chartWrap);

    const myRates = allDates.map(d => {
      const e = dateMap[d];
      return e.myTotal > 0 ? parseFloat((e.myScore / e.myTotal * 100).toFixed(1)) : null;
    });
    const friendRates = allDates.map(d => {
      const e = dateMap[d];
      return e.friendTotal > 0 ? parseFloat((e.friendScore / e.friendTotal * 100).toFixed(1)) : null;
    });

    // 日付ラベルを MM/DD 形式に
    const labels = allDates.map(d => d.slice(5));

    if (compareChartInstance) compareChartInstance.destroy();
    const isDark = !document.body.classList.contains('light-mode');
    Chart.defaults.color = isDark ? '#e8edf5' : '#4b5563';

    compareChartInstance = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'あなた',
            data: myRates,
            borderColor: '#4f7cff',
            backgroundColor: 'rgba(79,124,255,0.08)',
            tension: 0.3,
            pointRadius: 4,
            spanGaps: true
          },
          {
            label: friendName,
            data: friendRates,
            borderColor: '#f5a623',
            backgroundColor: 'rgba(245,166,35,0.08)',
            tension: 0.3,
            pointRadius: 4,
            spanGaps: true
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'top', labels: { font: { size: 12 } } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y ?? '-'}%` } }
        },
        scales: {
          x: { ticks: { font: { size: 11 } } },
          y: { min: 0, max: 100, ticks: { callback: v => v + '%', font: { size: 11 } } }
        }
      }
    });

    // 日付別データ一覧（テキスト補足）
    const tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'margin-top:8px; max-height:260px; overflow-y:auto;';
    [...allDates].reverse().forEach(d => {
      const e = dateMap[d];
      const myR = e.myTotal > 0 ? (e.myScore / e.myTotal * 100).toFixed(1) : '-';
      const frR = e.friendTotal > 0 ? (e.friendScore / e.friendTotal * 100).toFixed(1) : '-';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; justify-content:space-between; padding:8px 4px; border-bottom:1px solid var(--border); font-size:0.82rem;';
      row.innerHTML = `<span style="color:var(--text3);">${d}</span><span style="color:#4f7cff;">あなた: ${myR}%</span><span style="color:#f5a623;">${escapeHtml(e.friendName || friendName)}: ${frR}%</span>`;
      tableWrap.appendChild(row);
    });
    area.appendChild(tableWrap);

  } catch(e) {
    console.error(e);
    area.innerHTML = '<div style="color:var(--danger);">成績データの読み込みに失敗しました</div>';
  }
}

// ====== ⚔️ オンライン対戦機能 → match.js ======
