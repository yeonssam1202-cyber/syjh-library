// 근무표(자원봉사): 주간 표 / 칸 눌러 근무 넣기·빼기 / 4주 반복 / 설정
window.whenAuthed.then(function (me) {
  'use strict';
  var db = Auth.client, U = UI, h = U.h, $ = U.$, app = $('app');
  var isAdmin = me.role === 'admin';
  var DAYS = ['월', '화', '수', '목', '금', '토', '일'];            // 열 순서(월~일)
  var DEFAULTS = { slots: ['10:00-13:00', '13:00-16:00', '16:00-19:00'], closed_days: [0], required: 2 };
  var settings = Object.assign({}, DEFAULTS), members = [], shifts = [];
  var weekStart = mondayOf(new Date());
  var openCellKey = null;                                          // 열려 있는 칸 { date, slot }

  function mondayOf(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  function weekDates() { return DAYS.map(function (_, i) { return addDays(weekStart, i); }); }
  function isClosed(date) { return settings.closed_days.indexOf(date.getDay()) >= 0; }   // getDay: 0=일
  function md(d) { return (d.getMonth() + 1) + '.' + U.pad(d.getDate()); }
  function weekLabel(ws) {
    var we = addDays(ws, 6), first = new Date(ws.getFullYear(), ws.getMonth(), 1);
    var nth = Math.floor((ws.getDate() + ((first.getDay() + 6) % 7) - 1) / 7) + 1;
    return (ws.getMonth() + 1) + '월 ' + nth + '주 · ' + md(ws) + '~' + md(we);
  }
  function at(date, slot) { var k = U.ymd(date); return shifts.filter(function (s) { return s.shift_date === k && s.slot === slot; }); }
  function canRemove(s) { return isAdmin || s.created_by === me.id || s.user_id === me.id; }

  // ---------- 데이터 ----------
  async function loadAll() {
    var a = await db.from('shift_settings').select('*').eq('id', 1).maybeSingle();
    if (a.error) throw a.error;
    if (a.data) settings = { slots: a.data.slots, closed_days: a.data.closed_days, required: a.data.required };
    if (!members.length) {
      var m = await db.from('profiles').select('id,name,email').eq('status', 'approved').order('name');
      if (m.error) throw m.error;
      members = m.data.map(function (x) { return { id: x.id, name: x.name || x.email }; });
    }
    await loadWeek();
  }
  async function loadWeek() {
    var s = await db.from('shifts').select('*').gte('shift_date', U.ymd(weekStart)).lte('shift_date', U.ymd(addDays(weekStart, 6))).order('created_at');
    if (s.error) throw s.error;
    shifts = s.data;
  }
  async function refresh() { try { await loadWeek(); render(); if (openCellKey && $('cell-dlg').open) fillCell(); } catch (e) { U.fail(e); } }

  // ---------- 화면 ----------
  function names(list) {
    return list.map(function (s) { return h('div', { class: s.user_id === me.id ? 'me' : '', text: s.name, title: s.note || '' }); });
  }
  function status(n) { return n < settings.required ? 'short' : 'ok'; }

  function render() {
    app.textContent = '';
    var dates = weekDates(), todayKey = U.today();
    app.appendChild(h('div', { class: 'top noprint' },
      h('div', null, h('div', { class: 'mark', text: '작은도서관 운영위원회' }), h('h1', { text: '근무표' })),
      h('div', { class: 'bar', style: 'margin:0' },
        h('div', { class: 'weekbar' },
          h('button', { class: 'ghost', 'aria-label': '이전 주', text: '‹', onclick: function () { weekStart = addDays(weekStart, -7); refresh(); } }),
          h('span', { class: 'w', text: weekLabel(weekStart) }),
          h('button', { class: 'ghost', 'aria-label': '다음 주', text: '›', onclick: function () { weekStart = addDays(weekStart, 7); refresh(); } }),
          h('button', { class: 'ghost', text: '오늘', onclick: function () { weekStart = mondayOf(new Date()); refresh(); } })),
        isAdmin ? h('button', { class: 'ghost', text: '설정', onclick: openSettings }) : null)));

    app.appendChild(h('div', { class: 'legend noprint', text: '칸을 누르면 근무자를 보고 넣고 뺄 수 있어요. 빨간 줄은 필요 인원(' + settings.required + '명)보다 적은 시간이에요. 진한 갈색 이름이 나예요.' }));

    // 데스크톱 표
    var head = h('tr', null, h('th', { class: 'slot', text: '' }), dates.map(function (d, i) {
      return h('th', { class: U.ymd(d) === todayKey ? 'today' : '', text: DAYS[i] + ' ' + md(d) });
    }));
    var body = settings.slots.map(function (slot) {
      return h('tr', null, h('th', { class: 'slot', text: slot }), dates.map(function (d) {
        var td = h('td');
        if (isClosed(d)) { td.appendChild(h('div', { class: 'cell closed', text: '휴관' })); return td; }
        var list = at(d, slot);
        var btn = h('button', { class: 'cell ' + status(list.length) + (U.ymd(d) === todayKey ? ' today-col' : ''), type: 'button', 'aria-label': md(d) + ' ' + slot + ' 근무자 ' + list.length + '명',
          onclick: function () { openCell(d, slot); } },
          h('span', { class: 'cnt', text: list.length + '/' + settings.required + '명' }), names(list));
        td.appendChild(btn); return td;
      }));
    });
    app.appendChild(h('table', { class: 'grid' }, h('thead', null, head), h('tbody', null, body)));

    // 폰: 요일별 카드
    var days = h('div', { class: 'days-m' });
    dates.forEach(function (d, i) {
      var card = h('div', { class: 'dcard' + (U.ymd(d) === todayKey ? ' today' : '') }, h('div', { class: 'dh' }, h('span', { text: DAYS[i] + ' ' + md(d) }), U.ymd(d) === todayKey ? h('span', { class: 'badge gold', text: '오늘' }) : null));
      if (isClosed(d)) card.appendChild(h('div', { class: 'closedrow', text: '휴관' }));
      else settings.slots.forEach(function (slot) {
        var list = at(d, slot);
        card.appendChild(h('button', { class: 'srow ' + status(list.length), type: 'button', onclick: function () { openCell(d, slot); } },
          h('span', { class: 'sl', text: slot + ' · ' + list.length + '/' + settings.required + '명' }),
          list.length ? list.map(function (s) { return h('span', { class: s.user_id === me.id ? 'me' : '', style: 'margin-right:8px;' + (s.user_id === me.id ? 'font-weight:700;color:var(--accent-700)' : ''), text: s.name }); }) : h('span', { style: 'color:var(--muted)', text: '(비어 있어요)' })));
      });
      days.appendChild(card);
    });
    app.appendChild(days);

    // 위원별 이번 주 횟수
    var tally = {};
    shifts.forEach(function (s) { tally[s.name] = (tally[s.name] || 0) + 1; });
    var keys = Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a] || a.localeCompare(b, 'ko'); });
    app.appendChild(h('div', { class: 'panel', style: 'margin-top:14px' }, h('h2', { text: '이번 주 위원별 근무 횟수' }),
      keys.length ? h('div', { class: 'counts' }, keys.map(function (k) { return h('span', { class: 'badge gold', text: k + ' ' + tally[k] + '회' }); })) : h('div', { class: 'hint', text: '아직 근무가 정해지지 않았어요.' })));
  }

  // ---------- 칸 대화창 ----------
  var cdlg = $('cell-dlg');
  function openCell(date, slot) { openCellKey = { date: date, slot: slot }; fillCell(); if (!cdlg.open) cdlg.showModal(); }
  function fillCell() {
    var d = openCellKey.date, slot = openCellKey.slot, list = at(d, slot);
    $('c-title').textContent = md(d) + '(' + DAYS[(d.getDay() + 6) % 7] + ') ' + slot;
    $('c-sub').textContent = '필요 ' + settings.required + '명 · 지금 ' + list.length + '명';
    var box = $('c-list'); box.textContent = '';
    if (!list.length) box.appendChild(h('div', { class: 'hint', text: '아직 아무도 없어요.' }));
    list.forEach(function (s) {
      box.appendChild(h('div', { class: 'shiftrow' },
        h('div', null, h('span', { class: s.user_id === me.id ? 'me' : '', style: s.user_id === me.id ? 'font-weight:700;color:var(--accent-700)' : '', text: s.name }), s.note ? h('div', { class: 'nt', text: s.note }) : null),
        canRemove(s) ? h('button', { class: 'ghost danger', type: 'button', text: '빼기', onclick: function () { removeShift(s); } }) : null));
    });
    var mine = list.some(function (s) { return s.user_id === me.id; });
    $('c-me').disabled = mine; $('c-me').textContent = mine ? '이미 근무에 들어 있어요' : '내가 근무할게요';
    var sel = $('c-who'); sel.textContent = '';
    members.forEach(function (m) { if (!list.some(function (s) { return s.user_id === m.id; })) sel.appendChild(h('option', { value: m.id, text: m.name })); });
    $('c-add').disabled = !sel.childNodes.length;
  }
  async function removeShift(s) {
    var r = await db.from('shifts').delete().eq('id', s.id);
    if (r.error) { U.fail(r.error); return; }
    await refresh();
  }
  async function addShifts(userId, name, note) {
    var d = openCellKey.date, slot = openCellKey.slot, times = $('c-repeat').checked ? 4 : 1, added = 0, skipped = 0, err = null;
    for (var k = 0; k < times; k++) {
      var date = addDays(d, 7 * k);
      if (isClosed(date)) { skipped++; continue; }
      var r = await db.from('shifts').insert({ shift_date: U.ymd(date), slot: slot, user_id: userId, name: name, note: note || '' });
      if (r.error) { if (/duplicate|unique/i.test(r.error.message)) skipped++; else { err = r.error; break; } } else added++;
    }
    if (err) U.fail(err);
    else U.notice('ok', name + ' 위원을 ' + added + '번 넣었어요.' + (skipped ? ' (이미 있거나 휴관이라 ' + skipped + '번은 건너뛰었어요)' : ''));
    await refresh();
  }
  $('c-me').onclick = function () { addShifts(me.id, me.name || me.email || '나', ''); };
  $('c-add').onclick = function () {
    var id = $('c-who').value, m = members.filter(function (x) { return x.id === id; })[0];
    if (m) addShifts(m.id, m.name, $('c-note').value.trim());
    $('c-note').value = '';
  };
  $('c-close').onclick = function () { cdlg.close(); };
  cdlg.addEventListener('close', function () { openCellKey = null; $('c-repeat').checked = false; });

  // ---------- 설정(관리자) ----------
  var sdlg = $('set-dlg');
  function openSettings() {
    $('s-slots').value = settings.slots.join('\n'); $('s-req').value = settings.required;
    var box = $('s-days'); box.textContent = '';
    [1, 2, 3, 4, 5, 6, 0].forEach(function (n) {
      var cb = h('input', { type: 'checkbox', value: String(n) }); cb.checked = settings.closed_days.indexOf(n) >= 0;
      box.appendChild(h('label', null, cb, DAYS[(n + 6) % 7]));
    });
    sdlg.showModal();
  }
  $('s-cancel').onclick = function () { sdlg.close(); };
  $('set-form').onsubmit = async function (e) {
    e.preventDefault();
    var slots = $('s-slots').value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
    if (!slots.length) { await sayBox('시간대를 한 줄 이상 적어 주세요.'); return; }
    var closed = Array.prototype.filter.call($('s-days').querySelectorAll('input'), function (c) { return c.checked; }).map(function (c) { return parseInt(c.value, 10); });
    var btn = $('s-save'); btn.disabled = true;
    var r = await db.from('shift_settings').update({ slots: slots, closed_days: closed, required: parseInt($('s-req').value, 10) || 2, updated_at: new Date().toISOString() }).eq('id', 1);
    btn.disabled = false; sdlg.close();
    if (r.error) { U.fail(r.error); return; }
    await loadAll(); render(); U.notice('ok', '설정을 저장했어요.');
  };

  loadAll().then(render).catch(U.fail);
});
