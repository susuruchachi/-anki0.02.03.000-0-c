// ================================================================
// ★【0.04.20】📅 カレンダー
// ・授業（何時から何時まで・毎週）、小テスト・テスト（週テストのような繰り返しも）、何日かある試験期間、
//   入試・出願などの期限、ただの予定 を登録できる
// ・共有先：自分だけ（calEvents。端末間で同期）／自分のいるグループ（グループの文書の events。メンバーは誰でも直せる）
// ・週間プランの「単語を始める日」「期限」を、毎週の授業・テストから決められる（例：火曜の授業から、次の火曜 9:00 のテストまで）
// ・Google カレンダーへ：.ics ファイルで書き出し・取り込み。1件ずつ「Google カレンダーに追加」も
// 予定の形：{ id, type, title, date:'YYYY-MM-DD', end:'YYYY-MM-DD'(何日か続く予定), start:'HH:MM', endTime:'HH:MM',
//   repeat:''|'weekly'|'biweekly', days:[曜日 0=日], until:'YYYY-MM-DD', skip:['YYYY-MM-DD'], place, note, at, by, byName }
// ================================================================
const CAL_TYPES = {
  class: { icon: '📚', label: '授業', color: '#4f8cff' },
  test: { icon: '📝', label: '小テスト・テスト', color: '#ff5d6c' },
  exam: { icon: '🗓️', label: '試験期間', color: '#ff9f1c' },
  deadline: { icon: '⏰', label: '入試・出願・期限', color: '#b26bff' },
  event: { icon: '📌', label: '予定', color: '#22b8a7' }
};
const CAL_DOW = ['日', '月', '火', '水', '木', '金', '土'];
let _calMonth = null, _calSel = null;

function calToday() { return planDateStr(new Date()); }
function calAddDays(ds, n) { const d = planParseDate(ds); d.setDate(d.getDate() + n); return planDateStr(d); }
function calDow(ds) { return planParseDate(ds).getDay(); }
function calType(ev) { return CAL_TYPES[ev.type] || CAL_TYPES.event; }
function calNewId() { return 'ev' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// 自分の予定＋グループの予定（グループの予定には gid を付ける）
function calAllEvents() {
  const out = [];
  Object.entries(calEvents || {}).forEach(([id, e]) => { if (e && !e.deleted && e.date) out.push(Object.assign({}, e, { id, gid: '' })); });
  (typeof myGroups !== 'undefined' ? myGroups : []).forEach(g => {
    if (typeof groupIsMember === 'function' && !groupIsMember(g)) return;
    Object.entries(g.events || {}).forEach(([id, e]) => { if (e && !e.deleted && e.date) out.push(Object.assign({}, e, { id, gid: g.id })); });
  });
  return out;
}
// その日にある予定か
function calOccursOn(ev, ds) {
  if ((ev.skip || []).includes(ds)) return false;
  if (ev.end && ev.end > ev.date) return ds >= ev.date && ds <= ev.end;
  if (ev.repeat === 'weekly' || ev.repeat === 'biweekly') {
    if (ds < ev.date || (ev.until && ds > ev.until)) return false;
    const days = ev.days && ev.days.length ? ev.days : [calDow(ev.date)];
    if (!days.includes(calDow(ds))) return false;
    if (ev.repeat === 'biweekly') { const w = Math.round((planMonday(planParseDate(ds)) - planMonday(planParseDate(ev.date))) / (7 * DAY_MS)); if (w % 2) return false; }
    return true;
  }
  return ev.date === ds;
}
function calOn(ds, list) {
  return (list || calAllEvents()).filter(e => calOccursOn(e, ds)).sort((a, b) => (a.start || '00:00').localeCompare(b.start || '00:00') || String(a.title).localeCompare(String(b.title)));
}
function calTimeText(ev) { return ev.start ? `${ev.start}${ev.endTime ? '〜' + ev.endTime : ''}` : '終日'; }
function calRepeatText(ev) {
  if (ev.repeat !== 'weekly' && ev.repeat !== 'biweekly') return '';
  const days = ev.days && ev.days.length ? ev.days : [calDow(ev.date)];
  return `${ev.repeat === 'biweekly' ? '隔週' : '毎週'}${days.map(d => CAL_DOW[d]).join('・')}${ev.until ? `（${ev.until.slice(5).replace('-', '/')}まで）` : ''}`;
}
function calMD(ds) { const d = planParseDate(ds); return `${d.getMonth() + 1}/${d.getDate()}(${CAL_DOW[d.getDay()]})`; }
function calDaysLeft(ds) { return Math.round((planParseDate(ds) - planParseDate(calToday())) / DAY_MS); }
function calLeftText(n) { return n === 0 ? '今日' : n === 1 ? '明日' : n > 0 ? `あと${n}日` : `${-n}日前`; }

// これからの大事な予定（テスト・試験期間・期限・予定。授業は除く）
function calUpcoming(days = 30) {
  const all = calAllEvents().filter(e => e.type !== 'class'), today = calToday(), out = [], seen = new Set();
  for (let i = 0; i <= days; i++) {
    const ds = calAddDays(today, i);
    all.forEach(e => {
      if (!calOccursOn(e, ds)) return;
      const multi = e.end && e.end > e.date;
      const key = multi || e.repeat ? e.gid + e.id : e.gid + e.id + ds; // 毎週のテストは次の1回だけ
      if (seen.has(key)) return; seen.add(key);
      out.push({ ev: e, date: multi ? e.date : ds, inside: multi && ds > e.date });
    });
  }
  return out;
}

// ---------------- 画面 ----------------
function openCalendar() { openPage('pgCalendar'); }
function renderCalendar() {
  const box = document.getElementById('calApp'); if (!box) return;
  const today = calToday();
  if (!_calMonth) { const d = new Date(); _calMonth = new Date(d.getFullYear(), d.getMonth(), 1); }
  if (!_calSel) _calSel = today;
  const y = _calMonth.getFullYear(), m = _calMonth.getMonth();
  const first = new Date(y, m, 1), startD = new Date(y, m, 1 - first.getDay());
  const weeks = Math.ceil((first.getDay() + new Date(y, m + 1, 0).getDate()) / 7);
  const all = calAllEvents();
  let cells = '';
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(startD); d.setDate(startD.getDate() + i);
    const ds = planDateStr(d), evs = calOn(ds, all);
    const exam = evs.find(e => e.type === 'exam' || (e.end && e.end > e.date));
    cells += `<div class="cal-cell${d.getMonth() !== m ? ' other' : ''}${ds === today ? ' today' : ''}${ds === _calSel ? ' sel' : ''}${d.getDay() === 0 ? ' sun' : d.getDay() === 6 ? ' sat' : ''}" onclick="calSelect('${ds}')" ${exam ? `style="--band:${calType(exam).color}"` : ''}>
      <div class="cal-dn">${d.getDate()}</div>${evs.slice(0, 3).map(e => `<div class="cal-ev" style="--c:${calType(e).color}">${escapeHtml(String(e.title).slice(0, 8))}</div>`).join('')}${evs.length > 3 ? `<div class="cal-more">+${evs.length - 3}</div>` : ''}</div>`;
  }
  const dayEvs = calOn(_calSel, all);
  const up = calUpcoming(45).slice(0, 12);
  box.innerHTML = `
    <div class="cal-head"><button class="chip" onclick="calMove(-1)">◀</button><b>${y}年${m + 1}月</b><button class="chip" onclick="calMove(1)">▶</button><button class="chip" onclick="calMove(0)">今日</button></div>
    <div class="cal-grid">${CAL_DOW.map((w, i) => `<div class="cal-wd${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}">${w}</div>`).join('')}${cells}</div>
    <div class="card cal-day">
      <div class="setting-box-title">${calMD(_calSel)} の予定 <button class="chip" style="float:right;" onclick="calNewEvent('${_calSel}')">＋ 追加</button></div>
      ${dayEvs.length ? dayEvs.map(e => calItemHTML(e, _calSel)).join('') : '<div class="hint-small">予定はありません。</div>'}
    </div>
    <div class="card cal-day">
      <div class="setting-box-title">⏳ これからのテスト・期限</div>
      ${up.length ? up.map(o => { const n = calDaysLeft(o.date); return `<div class="cal-up" onclick="calSelect('${o.inside ? calToday() : o.date}', true)"><span class="cal-dot" style="background:${calType(o.ev).color}"></span><span class="cal-up-d">${calMD(o.date)}</span><span class="cal-up-t">${calType(o.ev).icon} ${escapeHtml(o.ev.title)}${o.ev.end && o.ev.end > o.ev.date ? `（〜${calMD(o.ev.end)}）` : ''}</span><b class="cal-left${n <= 3 ? ' soon' : ''}">${o.inside ? '期間中' : calLeftText(n)}</b></div>`; }).join('') : '<div class="hint-small">45日以内にテスト・期限はありません。</div>'}
    </div>
    <div class="hint-small" style="margin:4px 2px 10px;">📚 授業・📝 テストを「毎週」で登録すると、週間プランの設定で「この授業から次のテストまで」のように選べます。</div>`;
}
function calItemHTML(e, ds) {
  const t = calType(e), g = e.gid ? (typeof groupNameOf === 'function' ? groupNameOf(e.gid) : 'グループ') : '';
  const sub = [t.label, calRepeatText(e), e.end && e.end > e.date ? `${calMD(e.date)}〜${calMD(e.end)}` : '', e.place ? '📍' + e.place : '', g ? '👪 ' + g : '', e.gid && e.byName ? `${e.byName} さん` : ''].filter(Boolean).join('・');
  return `<div class="cal-item" style="border-left-color:${t.color}" onclick="calEditEvent(${jsArg(e.id)}, ${jsArg(e.gid)}, '${ds}')">
    <div style="min-width:0; flex:1;"><b>${t.icon} ${escapeHtml(e.title)}</b><div class="hint-small">${calTimeText(e)}・${escapeHtml(sub)}</div>${e.note ? `<div class="hint-small cal-note">${linkifyHTML ? linkifyHTML(escapeHtml(e.note)) : escapeHtml(e.note)}</div>` : ''}</div>
    <button class="chip" onclick="event.stopPropagation(); calGoogleAdd(${jsArg(e.id)}, ${jsArg(e.gid)})" title="Google カレンダーに追加">G＋</button></div>`;
}
function calSelect(ds, jump) {
  _calSel = ds;
  if (jump) { const d = planParseDate(ds); _calMonth = new Date(d.getFullYear(), d.getMonth(), 1); }
  renderCalendar();
}
function calMove(n) {
  if (!n) { const d = new Date(); _calMonth = new Date(d.getFullYear(), d.getMonth(), 1); _calSel = calToday(); }
  else _calMonth = new Date(_calMonth.getFullYear(), _calMonth.getMonth() + n, 1);
  renderCalendar();
}
function calOnGroupsChanged() {
  const pg = document.getElementById('pgCalendar');
  if (pg && pg.classList.contains('active')) renderCalendar();
  renderCalHome();
}

// ホームの「次の予定」
function renderCalHome() {
  const box = document.getElementById('homeCalCard'); if (!box) return;
  const today = calToday(), todays = calOn(today).filter(e => e.type === 'class' || e.start);
  const up = calUpcoming(14).slice(0, 4);
  if (!todays.length && !up.length) { box.innerHTML = `<div class="cal-home-row"><span>📅 カレンダー</span><span class="hint-small">テスト・授業・期限を登録できます ›</span></div>`; return; }
  box.innerHTML = `<div class="cal-home-row"><b>📅 予定</b><span class="hint-small">カレンダーを開く ›</span></div>` +
    (todays.length ? `<div class="hint-small cal-home-today">今日：${todays.slice(0, 4).map(e => `${calType(e).icon}${e.start ? e.start + ' ' : ''}${escapeHtml(e.title)}`).join('　')}</div>` : '') +
    up.map(o => { const n = calDaysLeft(o.date); return `<div class="cal-up"><span class="cal-dot" style="background:${calType(o.ev).color}"></span><span class="cal-up-d">${calMD(o.date)}</span><span class="cal-up-t">${calType(o.ev).icon} ${escapeHtml(o.ev.title)}</span><b class="cal-left${n <= 3 ? ' soon' : ''}">${o.inside ? '期間中' : calLeftText(n)}</b></div>`; }).join('');
}

// ---------------- 予定の登録・編集 ----------------
function calFindEvent(id, gid) {
  if (gid) { const g = typeof groupById === 'function' ? groupById(gid) : null; const e = g && (g.events || {})[id]; return e ? Object.assign({}, e, { id, gid }) : null; }
  const e = (calEvents || {})[id]; return e && !e.deleted ? Object.assign({}, e, { id, gid: '' }) : null;
}
function calNewEvent(ds, gid) { calEditor({ id: '', type: 'test', title: '', date: ds || _calSel || calToday(), gid: gid || '' }); }
function calEditEvent(id, gid, ds) { const e = calFindEvent(id, gid); if (e) calEditor(e, ds); }
function calEditor(e, occ) {
  let ov = document.getElementById('calOverlay');
  if (!ov) { ov = document.createElement('div'); ov.id = 'calOverlay'; ov.className = 'ctx-overlay'; ov.style.zIndex = '1060'; ov.onclick = () => { ov.style.display = 'none'; }; document.body.appendChild(ov); }
  const groups = (typeof myGroups !== 'undefined' ? myGroups : []).filter(g => typeof groupIsMember === 'function' && groupIsMember(g));
  const days = e.days && e.days.length ? e.days : [calDow(e.date)];
  const rep = e.repeat || '';
  ov.innerHTML = `<div class="menu-card editor-card cal-editor" onclick="event.stopPropagation()">
    <div class="cat-edit-title">${e.id ? '✏️ 予定を直す' : '＋ 予定を追加'}</div>
    <input type="hidden" id="calEdId" value="${escAttr(e.id)}"><input type="hidden" id="calEdOldGid" value="${escAttr(e.gid || '')}"><input type="hidden" id="calEdType" value="${escAttr(e.type || 'event')}">
    <div class="cal-types">${Object.entries(CAL_TYPES).map(([k, t]) => `<button class="chip${(e.type || 'event') === k ? ' active' : ''}" data-caltype="${k}" onclick="calEdSetType('${k}')">${t.icon} ${t.label}</button>`).join('')}</div>
    <input type="text" id="calEdTitle" class="form-control" placeholder="名前（例：英単語テスト・数学の授業・共通テスト出願）" value="${escAttr(e.title || '')}" style="margin-top:8px;">
    <div class="form-row" style="margin-top:8px; align-items:flex-end;">
      <div style="flex:1;"><label class="section-label cal-lbl" id="calEdDateLbl">日付</label><input type="date" id="calEdDate" class="form-control" value="${escAttr(e.date)}"></div>
      <div style="flex:1;" class="cal-r-end"><label class="section-label cal-lbl">最後の日</label><input type="date" id="calEdEnd" class="form-control" value="${escAttr(e.end || '')}"></div>
    </div>
    <label class="toggle-pill cal-r-time" style="margin-top:8px; display:flex; align-items:center; gap:8px;"><input type="checkbox" id="calEdAllDay" ${e.start ? '' : 'checked'} onchange="calEdUpdate()">終日（時刻なし）</label>
    <div class="form-row cal-r-times" style="margin-top:6px;">
      <div style="flex:1;"><label class="section-label cal-lbl">開始</label><input type="time" id="calEdStart" class="form-control" value="${escAttr(e.start || '')}"></div>
      <div style="flex:1;"><label class="section-label cal-lbl">終了</label><input type="time" id="calEdEndTime" class="form-control" value="${escAttr(e.endTime || '')}"></div>
    </div>
    <div class="cal-r-rep" style="margin-top:8px;"><label class="section-label cal-lbl">🔁 繰り返し</label>
      <select id="calEdRepeat" class="form-control" onchange="calEdUpdate()"><option value="" ${!rep ? 'selected' : ''}>しない</option><option value="weekly" ${rep === 'weekly' ? 'selected' : ''}>毎週</option><option value="biweekly" ${rep === 'biweekly' ? 'selected' : ''}>隔週</option></select>
      <div class="cal-r-days" style="margin-top:6px;"><div class="cal-days">${CAL_DOW.map((w, i) => `<label class="cal-daychk"><input type="checkbox" class="calEdDay" value="${i}" ${days.includes(i) ? 'checked' : ''}>${w}</label>`).join('')}</div>
        <label class="section-label cal-lbl" style="margin-top:6px;">いつまで（空なら ずっと）</label><input type="date" id="calEdUntil" class="form-control" value="${escAttr(e.until || '')}"></div>
    </div>
    <input type="text" id="calEdPlace" class="form-control" placeholder="場所（なくてもOK）" value="${escAttr(e.place || '')}" style="margin-top:8px;">
    <textarea id="calEdNote" class="form-control" rows="2" placeholder="メモ（範囲・持ち物など）" style="margin-top:8px;">${escapeHtml(e.note || '')}</textarea>
    <label class="section-label cal-lbl" style="margin-top:8px;">👪 共有先</label>
    <select id="calEdShare" class="form-control"><option value="">自分だけ</option>${groups.map(g => `<option value="${escAttr(g.id)}" ${e.gid === g.id ? 'selected' : ''}>👪 ${escapeHtml(g.name)}（メンバーも直せます）</option>`).join('')}</select>
    ${!groups.length ? '<div class="hint-small">フレンドの画面でグループを作ると、グループのみんなと予定を共有できます。</div>' : ''}
    <div class="plan-btns" style="margin-top:12px; flex-wrap:wrap;">
      <button class="btn btn-primary" onclick="calSaveEvent()">💾 ${e.id ? '保存' : '追加'}</button>
      <button class="btn btn-secondary" onclick="document.getElementById('calOverlay').style.display='none'">やめる</button>
      ${e.id && occ && (e.repeat === 'weekly' || e.repeat === 'biweekly') ? `<button class="btn btn-secondary" onclick="calSkipOne(${jsArg(e.id)}, ${jsArg(e.gid || '')}, '${occ}')">この日だけ消す</button>` : ''}
      ${e.id ? `<button class="btn btn-danger" onclick="calDeleteEvent(${jsArg(e.id)}, ${jsArg(e.gid || '')})">🗑️ 削除</button>` : ''}
    </div></div>`;
  ov.style.display = 'flex';
  calEdUpdate();
  if (!e.id) setTimeout(() => { const t = document.getElementById('calEdTitle'); if (t) t.focus(); }, 50);
}
// 種類を選んだら、よく使う形にする（授業は毎週・時刻あり、試験期間は何日か・終日 など）
function calEdSetType(k) {
  const prev = document.getElementById('calEdType').value;
  document.getElementById('calEdType').value = k;
  document.querySelectorAll('[data-caltype]').forEach(b => b.classList.toggle('active', b.dataset.caltype === k));
  if (prev !== k) {
    const allDay = document.getElementById('calEdAllDay'), rep = document.getElementById('calEdRepeat');
    if (k === 'class') { allDay.checked = false; if (!rep.value) rep.value = 'weekly'; }
    if (k === 'exam' || k === 'deadline') { allDay.checked = true; rep.value = ''; }
    if (k === 'exam' && !document.getElementById('calEdEnd').value) document.getElementById('calEdEnd').value = calAddDays(document.getElementById('calEdDate').value || calToday(), 4);
  }
  calEdUpdate();
}
function calEdUpdate() {
  const k = document.getElementById('calEdType').value, show = (sel, on) => document.querySelectorAll(sel).forEach(x => { x.style.display = on ? '' : 'none'; });
  const rep = document.getElementById('calEdRepeat').value;
  show('.cal-r-end', k === 'exam');
  show('.cal-r-rep', k !== 'exam');
  show('.cal-r-days', !!rep && k !== 'exam');
  show('.cal-r-times', !document.getElementById('calEdAllDay').checked);
  document.getElementById('calEdDateLbl').textContent = k === 'exam' ? '最初の日' : rep ? '最初の日（この日から）' : '日付';
}
function calReadEditor() {
  const v = id => (document.getElementById(id) || {}).value || '';
  const type = v('calEdType') || 'event', allDay = document.getElementById('calEdAllDay').checked;
  const e = { type, title: v('calEdTitle').trim(), date: v('calEdDate'), place: v('calEdPlace').trim(), note: v('calEdNote').trim() };
  if (type === 'exam' && v('calEdEnd') > e.date) e.end = v('calEdEnd');
  if (!allDay && v('calEdStart')) { e.start = v('calEdStart'); if (v('calEdEndTime')) e.endTime = v('calEdEndTime'); }
  const rep = type === 'exam' ? '' : v('calEdRepeat');
  if (rep) {
    e.repeat = rep;
    e.days = [...document.querySelectorAll('.calEdDay:checked')].map(x => Number(x.value));
    if (!e.days.length && e.date) e.days = [calDow(e.date)];
    if (v('calEdUntil')) e.until = v('calEdUntil');
  }
  return e;
}
async function calSaveEvent() {
  const e = calReadEditor();
  if (!e.title) return alert('名前を入れてください。');
  if (!e.date) return alert('日付を選んでください。');
  const id = document.getElementById('calEdId').value || calNewId(), oldGid = document.getElementById('calEdOldGid').value, gid = document.getElementById('calEdShare').value;
  const old = document.getElementById('calEdId').value ? calFindEvent(id, oldGid) : null;
  if (old && old.skip) e.skip = old.skip;
  e.at = Date.now();
  if (currentUser) { e.by = currentUser.uid; e.byName = currentUser.displayName || ''; }
  try {
    await calPut(id, gid, e);
    if (old && oldGid !== gid) await calRemove(id, oldGid); // 共有先を変えたら、前の場所から消す
  } catch (err) { return alert('⚠️ 保存できませんでした: ' + (err.code || err.message)); }
  document.getElementById('calOverlay').style.display = 'none';
  _calSel = e.date >= calToday() || !_calSel ? (_calSel && calOccursOn(Object.assign({ id }, e), _calSel) ? _calSel : e.date) : _calSel;
  calAfterChange();
}
async function calPut(id, gid, e) {
  const clean = JSON.parse(JSON.stringify(e)); delete clean.id; delete clean.gid;
  if (gid) {
    if (!currentUser) throw new Error('グループの予定はログインが必要です');
    await firestore.collection('susuru_anki_groups').doc(gid).update({ ['events.' + id]: clean, updatedAt: Date.now() });
    const g = groupById(gid); if (g) { g.events = Object.assign({}, g.events || {}, { [id]: clean }); }
  } else { calEvents[id] = clean; saveData(true); }
}
async function calRemove(id, gid) {
  if (gid) {
    await firestore.collection('susuru_anki_groups').doc(gid).update({ ['events.' + id]: firebase.firestore.FieldValue.delete(), updatedAt: Date.now() });
    const g = groupById(gid); if (g && g.events) delete g.events[id];
  } else { calEvents[id] = { deleted: true, at: Date.now() }; saveData(true); }
}
async function calDeleteEvent(id, gid) {
  const e = calFindEvent(id, gid); if (!e) return;
  if (!confirm(`「${e.title}」を削除しますか？${e.repeat ? '（繰り返しの予定は全部消えます）' : ''}${gid ? '\n（グループのみんなの予定からも消えます）' : ''}`)) return;
  try { await calRemove(id, gid); } catch (err) { return alert('⚠️ 削除できませんでした: ' + (err.code || err.message)); }
  document.getElementById('calOverlay').style.display = 'none';
  calAfterChange();
}
async function calSkipOne(id, gid, ds) {
  const e = calFindEvent(id, gid); if (!e) return;
  e.skip = [...new Set([...(e.skip || []), ds])]; e.at = Date.now();
  try { await calPut(id, gid, e); } catch (err) { return alert('⚠️ ' + (err.code || err.message)); }
  document.getElementById('calOverlay').style.display = 'none';
  calAfterChange();
}
function calAfterChange() {
  renderCalendar(); renderCalHome();
  if (typeof renderPlanViews === 'function') try { renderPlanViews(); } catch (e) {}
}
// グループの画面に出す、これからの予定
function calGroupEventsText(g) {
  const evs = Object.entries(g.events || {}).filter(([, e]) => e && !e.deleted).map(([id, e]) => Object.assign({}, e, { id, gid: g.id }));
  if (!evs.length) return '';
  const today = calToday(), rows = [];
  for (let i = 0; i <= 60 && rows.length < 6; i++) { const ds = calAddDays(today, i); evs.forEach(e => { if (rows.length < 6 && calOccursOn(e, ds) && !(e.end && ds > e.date && i > 0)) rows.push(`<div class="hint-small">${calMD(ds)} ${calType(e).icon} ${escapeHtml(e.title)}${e.start ? ' ' + e.start : ''}</div>`); }); }
  return rows.join('') || '<div class="hint-small">60日以内の予定はありません。</div>';
}

// ---------------- 週間プランと結びつける ----------------
// 毎週ある予定の（予定・曜日）の組
function calWeeklySlots() {
  const out = [];
  calAllEvents().filter(e => e.repeat === 'weekly' && (!e.until || e.until >= calToday())).forEach(e => {
    (e.days && e.days.length ? e.days : [calDow(e.date)]).forEach(d => out.push({ val: `${e.gid || ''}~${e.id}~${d}`, ev: e, dow: d, label: `${calType(e).icon} 毎週${CAL_DOW[d]} ${e.start || '終日'} ${e.title}` }));
  });
  return out.sort((a, b) => a.dow - b.dow || (a.ev.start || '').localeCompare(b.ev.start || ''));
}
function calPlanPickerHTML(p) {
  const slots = calWeeklySlots();
  const opt = (sel) => `<option value="">（曜日で決める）</option>` + slots.map(s => `<option value="${escAttr(s.val)}" ${sel === s.val ? 'selected' : ''}>${escapeHtml(s.label)}</option>`).join('');
  return `<div class="cal-plan-pick">
    <label class="section-label" style="font-weight:500; margin-top:8px;">📅 カレンダーの予定に合わせる（毎週の授業・テストから）</label>
    ${slots.length ? `<div class="form-row" style="align-items:center;">
      <div style="flex:1;"><div class="hint-small">🧠 この予定の日から始める</div><select id="calPlanFrom" class="form-control" onchange="calPlanApply()">${opt(p.fromEv || '')}</select></div>
      <div style="flex:1;"><div class="hint-small">⏰ 次のこの予定まで（期限）</div><select id="calPlanDue" class="form-control" onchange="calPlanApply()">${opt(p.dueEv || '')}</select></div></div>
      <input type="hidden" id="calPlanDueTime" value="${escAttr(p.dueTime || '')}"><input type="hidden" id="calPlanDueShift" value="${p.dueShift || 0}"><input type="hidden" id="calPlanDueTitle" value="${escAttr(p.dueEvTitle || '')}">
      <div class="hint-small" id="calPlanNote">${p.dueTime ? `期限：${escapeHtml(planDueText(p))}` : '例：「火曜の英語の授業」から「次の火曜 9:00 の単語テスト」まで'}</div>`
      : `<div class="hint-small">📅 カレンダーに授業・テストを「毎週」で登録すると、ここで選べます。<button class="chip" onclick="openCalendar()">カレンダーを開く</button></div>`}
  </div>`;
}
function calSlotOf(val) { return calWeeklySlots().find(s => s.val === val) || null; }
function calPlanApply() {
  const f = calSlotOf((document.getElementById('calPlanFrom') || {}).value), d = calSlotOf((document.getElementById('calPlanDue') || {}).value);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  if (f) set('planFrom', f.dow);
  let note = '';
  if (d) {
    const from = f ? f.dow : Number(document.getElementById('planFrom').value);
    if (d.ev.start) {
      // 始める日と同じ曜日なら、次の週のその日の始まる時刻まで
      if (d.dow === from) { set('planDue', (d.dow + 6) % 7); set('calPlanDueShift', 1); } else { set('planDue', d.dow); set('calPlanDueShift', 0); }
      set('calPlanDueTime', d.ev.start);
      note = `期限：${CAL_DOW[d.dow]}曜 ${d.ev.start}（${d.ev.title} が始まるまで）`;
    } else {
      // 時刻のない予定は、その前の日の夜まで
      set('planDue', (d.dow + 6) % 7); set('calPlanDueShift', 0); set('calPlanDueTime', '');
      note = `期限：${CAL_DOW[(d.dow + 6) % 7]}曜の夜（${d.ev.title} の前の日）まで`;
    }
    set('calPlanDueTitle', d.ev.title);
  } else { set('calPlanDueTime', ''); set('calPlanDueShift', 0); set('calPlanDueTitle', ''); }
  if (f) note = `${CAL_DOW[f.dow]}曜（${f.ev.title}）から始める` + (note ? '・' + note : '');
  const n = document.getElementById('calPlanNote'); if (n) n.textContent = note || '例：「火曜の英語の授業」から「次の火曜 9:00 の単語テスト」まで';
}
// 曜日を手で変えたら、予定との結びつきを外す
function calPlanManual() {
  ['calPlanFrom', 'calPlanDue'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['calPlanDueTime', 'calPlanDueTitle'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const s = document.getElementById('calPlanDueShift'); if (s) s.value = 0;
  const n = document.getElementById('calPlanNote'); if (n) n.textContent = '曜日で決めています（期限はその日の夜まで）';
}
function calPlanFormValues() {
  const v = id => (document.getElementById(id) || {}).value || '';
  return { fromEv: v('calPlanFrom'), dueEv: v('calPlanDue'), dueTime: v('calPlanDueTime'), dueShift: Number(v('calPlanDueShift')) || 0, dueEvTitle: v('calPlanDueTitle') };
}

// ---------------- Google カレンダー ----------------
function calIcsEsc(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
function calIcsDate(ds) { return ds.replace(/-/g, ''); }
function calIcsDT(ds, t) { return calIcsDate(ds) + 'T' + t.replace(':', '') + '00'; }
const CAL_BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
// 最初の回（繰り返しの予定は、最初の日以降で曜日が合う最初の日）
function calFirstDate(e) {
  if (!e.repeat) return e.date;
  for (let i = 0; i < 14; i++) { const ds = calAddDays(e.date, i); if (calOccursOn(Object.assign({}, e, { skip: [] }), ds)) return ds; }
  return e.date;
}
function calPlusHour(t) { const [h, m] = t.split(':').map(Number); return `${String(Math.min(23, h + 1)).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
function calRrule(e) {
  if (!e.repeat) return '';
  const days = e.days && e.days.length ? e.days : [calDow(e.date)];
  return `RRULE:FREQ=WEEKLY${e.repeat === 'biweekly' ? ';INTERVAL=2' : ''};BYDAY=${days.map(d => CAL_BYDAY[d]).join(',')}${e.until ? `;UNTIL=${calIcsDate(e.until)}${e.start ? 'T235959Z' : ''}` : ''}`;
}
function calToIcs(list) {
  const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'Asia/Tokyo';
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//susuruanki//calendar//JA', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:すするanki', 'X-WR-TIMEZONE:' + tz];
  list.forEach(e => {
    const d0 = calFirstDate(e);
    L.push('BEGIN:VEVENT', `UID:${e.id}@susuruanki`, `DTSTAMP:${now}`, `SUMMARY:${calIcsEsc(e.title)}`);
    if (e.start) { L.push(`DTSTART;TZID=${tz}:${calIcsDT(d0, e.start)}`, `DTEND;TZID=${tz}:${calIcsDT(d0, e.endTime && e.endTime > e.start ? e.endTime : calPlusHour(e.start))}`); }
    else { L.push(`DTSTART;VALUE=DATE:${calIcsDate(d0)}`, `DTEND;VALUE=DATE:${calIcsDate(calAddDays(e.end && e.end > e.date ? e.end : d0, 1))}`); }
    const rr = calRrule(e); if (rr) L.push(rr);
    (e.skip || []).forEach(s => L.push(e.start ? `EXDATE;TZID=${tz}:${calIcsDT(s, e.start)}` : `EXDATE;VALUE=DATE:${calIcsDate(s)}`));
    if (e.place) L.push(`LOCATION:${calIcsEsc(e.place)}`);
    if (e.note) L.push(`DESCRIPTION:${calIcsEsc(e.note)}`);
    L.push(`CATEGORIES:${calIcsEsc(calType(e).label)}`, `X-SUSURU-TYPE:${e.type || 'event'}`, 'END:VEVENT');
  });
  L.push('END:VCALENDAR');
  return L.join('\r\n') + '\r\n';
}
function calExportIcs() {
  const list = calAllEvents();
  if (!list.length) return alert('書き出す予定がありません。');
  saveBlobFile(new Blob([calToIcs(list)], { type: 'text/calendar' }), `susuruanki-calendar-${calToday()}.ics`);
}
// 1件ずつ Google カレンダーの「予定を作る」画面を開く
function calGoogleAdd(id, gid) {
  const e = calFindEvent(id, gid); if (!e) return;
  const d0 = calFirstDate(e);
  const dates = e.start ? `${calIcsDT(d0, e.start)}/${calIcsDT(d0, e.endTime && e.endTime > e.start ? e.endTime : calPlusHour(e.start))}` : `${calIcsDate(d0)}/${calIcsDate(calAddDays(e.end && e.end > e.date ? e.end : d0, 1))}`;
  const q = new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates, details: e.note || '', location: e.place || '', ctz: (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'Asia/Tokyo' });
  const rr = calRrule(e); if (rr) q.set('recur', rr);
  const url = 'https://calendar.google.com/calendar/render?' + q.toString();
  if (isAndroidApp() && window.SusuruApp.openExternal) { try { window.SusuruApp.openExternal(url); return; } catch (err) {} }
  window.open(url, '_blank', 'noopener');
}
// .ics を読む
function calHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
function calIcsUnesc(s) { return String(s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1'); }
function calIcsParseDT(v) {
  const m = String(v).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
  if (!m) return null;
  if (!m[4]) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: '' };
  if (m[7]) { const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])); return { date: planDateStr(d), time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }; }
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
}
function calGuessType(title, multi, repeat, timed) {
  if (/試験期間|定期考査|考査|期末|中間試験/.test(title) && multi) return 'exam';
  if (/出願|締切|締め切り|〆切|期限|入試|受験|共通テスト|合格発表|申込/.test(title)) return 'deadline';
  if (/テスト|試験|小テ|test|quiz|exam|模試|検定/i.test(title)) return multi ? 'exam' : 'test';
  if (repeat && timed) return 'class';
  return multi ? 'exam' : 'event';
}
function calParseIcs(text) {
  const lines = String(text).replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const out = []; let cur = null;
  lines.forEach(line => {
    if (line === 'BEGIN:VEVENT') { cur = { exd: [] }; return; }
    if (line === 'END:VEVENT') { if (cur) out.push(cur); cur = null; return; }
    if (!cur) return;
    const i = line.indexOf(':'); if (i < 0) return;
    const head = line.slice(0, i), val = line.slice(i + 1), name = head.split(';')[0].toUpperCase();
    if (name === 'EXDATE') val.split(',').forEach(x => cur.exd.push(x)); else cur[name] = val;
  });
  const today = calToday(), res = [];
  out.forEach(v => {
    if (!v.DTSTART || (v.STATUS || '').toUpperCase() === 'CANCELLED' || v['RECURRENCE-ID']) return;
    const s = calIcsParseDT(v.DTSTART); if (!s) return;
    const en = v.DTEND ? calIcsParseDT(v.DTEND) : null;
    const title = calIcsUnesc(v.SUMMARY || '（名前なし）').trim();
    const e = { title, date: s.date };
    if (s.time) { e.start = s.time; if (en && en.time && en.date === s.date) e.endTime = en.time; }
    else if (en && en.date && calAddDays(en.date, -1) > s.date) e.end = calAddDays(en.date, -1);
    let last = e.end || e.date;
    if (v.RRULE) {
      const r = {}; v.RRULE.split(';').forEach(kv => { const [k, x] = kv.split('='); r[k.toUpperCase()] = x; });
      const iv = Number(r.INTERVAL) || 1;
      if (r.FREQ === 'WEEKLY' || (r.FREQ === 'DAILY' && iv === 1)) {
        e.repeat = r.FREQ === 'WEEKLY' && iv === 2 ? 'biweekly' : 'weekly';
        e.days = r.FREQ === 'DAILY' ? [0, 1, 2, 3, 4, 5, 6] : r.BYDAY ? r.BYDAY.split(',').map(x => CAL_BYDAY.indexOf(x.replace(/[^A-Z]/g, ''))).filter(x => x >= 0) : [calDow(s.date)];
        if (!e.days.length) e.days = [calDow(s.date)];
        if (r.UNTIL) { const u = calIcsParseDT(r.UNTIL); if (u) e.until = u.date; }
        else if (r.COUNT) e.until = calAddDays(s.date, Math.ceil(Number(r.COUNT) / e.days.length) * 7 * (e.repeat === 'biweekly' ? 2 : 1));
        last = e.until || '9999-12-31';
        delete e.end;
        if (r.FREQ === 'WEEKLY' && iv > 2) { e.note = `（${iv}週ごと：毎週として取り込みました）`; e.repeat = 'weekly'; }
      } else if (r.FREQ === 'MONTHLY' || r.FREQ === 'YEARLY') e.note = `（${r.FREQ === 'MONTHLY' ? '毎月' : '毎年'}の予定：最初の1回だけ取り込みました）`;
    }
    if (v.exd.length) e.skip = v.exd.map(x => (calIcsParseDT(x) || {}).date).filter(Boolean);
    if (v.LOCATION) e.place = calIcsUnesc(v.LOCATION).trim();
    if (v.DESCRIPTION) e.note = ((e.note ? e.note + '\n' : '') + calIcsUnesc(v.DESCRIPTION)).trim().slice(0, 1000);
    const t = (v['X-SUSURU-TYPE'] || '').trim();
    e.type = CAL_TYPES[t] ? t : calGuessType(title, !!e.end, !!e.repeat, !!e.start);
    const uid = v.UID || (title + s.date + (s.time || ''));
    const m = String(uid).match(/^(ev[a-z0-9]+)@susuruanki$/);
    res.push({ id: m ? m[1] : 'ics' + calHash(uid), ev: e, old: last < calAddDays(today, -30) });
  });
  return res;
}
function calImportIcsPick() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.ics,text/calendar';
  inp.onchange = () => { const f = inp.files && inp.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => calImportIcsText(String(r.result)); r.readAsText(f); };
  inp.click();
}
function calImportIcsText(text) {
  const all = calParseIcs(text);
  if (!all.length) return alert('⚠️ 予定が見つかりませんでした（.ics のファイルを選んでください）。');
  const list = all.filter(x => !x.old), past = all.length - list.length;
  if (!list.length) return alert(`予定は ${all.length} 件ありましたが、どれも1か月以上前に終わった予定でした。`);
  const counts = {}; list.forEach(x => { counts[x.ev.type] = (counts[x.ev.type] || 0) + 1; });
  if (!confirm(`${list.length} 件の予定を「自分だけ」の予定として取り込みます。${past ? `\n（1か月以上前に終わった ${past} 件は取り込みません）` : ''}\n\n${Object.entries(counts).map(([k, n]) => `${CAL_TYPES[k].icon} ${CAL_TYPES[k].label}：${n}件`).join('\n')}\n\n種類はあとで直せます。同じ予定をもう一度取り込んだときは、上書きします。`)) return;
  const now = Date.now();
  list.forEach(x => { calEvents[x.id] = Object.assign(x.ev, { at: now }); });
  saveData(true);
  calCloseMenu();
  calAfterChange();
  alert(`📥 ${list.length} 件の予定を取り込みました。`);
}
function calCloseMenu() { const ov = document.getElementById('calOverlay'); if (ov) ov.style.display = 'none'; }
function calMenu() {
  let ov = document.getElementById('calOverlay');
  if (!ov) { ov = document.createElement('div'); ov.id = 'calOverlay'; ov.className = 'ctx-overlay'; ov.style.zIndex = '1060'; ov.onclick = () => { ov.style.display = 'none'; }; document.body.appendChild(ov); }
  ov.innerHTML = `<div class="menu-card editor-card" onclick="event.stopPropagation()">
    <div class="cat-edit-title">🔄 Google カレンダーと</div>
    <button class="btn btn-secondary" style="margin-top:8px;" onclick="calExportIcs()">📤 書き出す（.ics ファイル）</button>
    <div class="hint-small" style="margin:4px 2px 10px;">Google カレンダー（パソコンのブラウザ）の ⚙️ 設定 →「インポート / エクスポート」→「インポート」で、このファイルを選ぶと入ります。繰り返し・試験期間もそのまま入ります。1件だけなら、予定の「G＋」から追加できます。</div>
    <button class="btn btn-secondary" onclick="calImportIcsPick()">📥 取り込む（.ics ファイル）</button>
    <div class="hint-small" style="margin:4px 2px 10px;">Google カレンダーの ⚙️ 設定 →「インポート / エクスポート」→「エクスポート」で届く zip を開くと、カレンダーごとの .ics ファイルがあります。または、カレンダーの設定の「iCal 形式の非公開 URL」を開くと .ics を保存できます。テスト・授業・期限などの種類は名前から見分けます（あとで直せます）。</div>
    <button class="btn btn-secondary" onclick="calCloseMenu()">閉じる</button></div>`;
  ov.style.display = 'flex';
}
window.addEventListener('load', () => setTimeout(() => { try { renderCalHome(); } catch (e) {} }, 1500));
