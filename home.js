// 홈: 지금 내가 확인해야 할 일 + 다음 회의 + 최근 공지 + 내 근무 + 내 업무 (모두 실제 데이터)
window.whenAuthed.then(async function (me) {
  'use strict';
  var db = Auth.client, U = UI, h = U.h, $ = U.$, app = $('app');
  var DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  var today = U.today(), isApprover = me.can('shifts_approve');

  function md(s) { var d = U.parseYmd(s); return (d.getMonth() + 1) + '월 ' + d.getDate() + '일(' + DAYS[d.getDay()] + ')'; }
  function hm(t) { return t ? String(t).slice(0, 5) : ''; }
  function dday(s) { var n = Math.round((U.parseYmd(s) - U.parseYmd(today)) / 86400000); return n === 0 ? '오늘' : n > 0 ? n + '일 후' : Math.abs(n) + '일 지남'; }
  // 각 항목은 따로 불러와서, 아직 준비 안 된 기능이 있어도 홈은 계속 보여요.
  async function safe(p, fallback) { try { var r = await p; return r.error ? fallback : r.data; } catch (e) { return fallback; } }

  var todo = [];            // {text, href, warn}
  var weekEnd = U.ymd(new Date(Date.now() + 14 * 86400000));

  app.appendChild(loadingBox());      // 불러오는 동안 표시
  var res = await Promise.all([
    safe(db.from('notices').select('id,title,pinned,created_by,created_by_name,created_at').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(4), []),
    safe(db.from('notice_reads').select('notice_id').eq('user_id', me.id), []),
    safe(db.from('meeting_events').select('*').gte('event_date', today).order('event_date').order('start_time').limit(1), []),
    safe(db.from('shifts').select('id,shift_date,slot').eq('user_id', me.id).gte('shift_date', today).lte('shift_date', weekEnd).order('shift_date'), []),
    safe(db.from('tasks').select('id,title,status,due_date,task_assignees(user_id,role)').neq('status', 'done').limit(200), []),
    safe(db.from('meetings').select('id,seq,kind,meeting_date,status,meeting_attendees(id,user_id,attended),meeting_signatures(attendee_id),meeting_reviews(attendee_id,content_hash)').in('status', ['draft', 'signing']), []),
    isApprover ? safe(db.from('shift_change_requests').select('id').eq('status', 'pending'), []) : Promise.resolve([]),
    me.role === 'admin' ? safe(db.from('profiles').select('id').eq('status', 'pending'), []) : Promise.resolve([])
  ]);
  var notices = res[0], myReads = {}, events = res[2], myShifts = res[3], allTasks = res[4], meetings = res[5], pendReq = res[6], pendMem = res[7];
  res[1].forEach(function (r) { myReads[r.notice_id] = true; });

  // ----- 내 업무 -----
  var myTasks = allTasks.filter(function (t) { return t.task_assignees.some(function (a) { return a.user_id === me.id; }); })
    .sort(function (a, b) { if (a.due_date && b.due_date) return a.due_date < b.due_date ? -1 : 1; return a.due_date ? -1 : b.due_date ? 1 : 0; });
  var late = myTasks.filter(function (t) { return t.due_date && t.due_date < today; });

  // ----- 해야 할 일 -----
  var recheck = [];
  meetings.forEach(function (m) {
    var mine = m.meeting_attendees.filter(function (a) { return a.user_id === me.id && a.attended; })[0];
    if (!mine) return;
    var label = '제' + m.seq + '차 ' + m.kind + ' (' + md(m.meeting_date) + ')';
    if (m.status === 'signing' && !m.meeting_signatures.some(function (s) { return s.attendee_id === mine.id; }))
      todo.push({ text: label + ' 회의록에 서명해 주세요', href: 'minutes.html?id=' + m.id, warn: true });
    var myRv = m.meeting_reviews.filter(function (r) { return r.attendee_id === mine.id; })[0];
    if (m.status === 'draft' && !myRv)
      todo.push({ text: label + ' 회의록을 검토해 주세요', href: 'minutes.html?id=' + m.id });
    if (m.status === 'draft' && myRv) recheck.push({ m: m, rv: myRv, label: label });      // 검토했어도 그 뒤 내용이 바뀌었는지 아래에서 확인
  });
  // 검토한 뒤에 회의록이 수정됐으면 다시 검토하라고 알려요(수정 → 재검토가 이어지게)
  await Promise.all(recheck.map(async function (x) {
    try {
      var hr = await db.rpc('meeting_content_hash', { mid: x.m.id });
      if (!hr.error && hr.data && hr.data !== x.rv.content_hash) todo.push({ text: x.label + ' 회의록이 수정됐어요. 다시 검토해 주세요', href: 'minutes.html?id=' + x.m.id, warn: true });
    } catch (e) {}
  }));
  var unreadN = notices.filter(function (n) { return n.created_by !== me.id && !myReads[n.id]; });
  if (unreadN.length) todo.push({ text: '새 공지 ' + unreadN.length + '건을 아직 읽지 않았어요', href: 'notices.html' });
  if (pendReq.length) todo.push({ text: '승인할 근무 변경 요청이 ' + pendReq.length + '건 있어요', href: 'shifts.html', warn: true });
  if (pendMem.length) todo.push({ text: '승인을 기다리는 가입 신청이 ' + pendMem.length + '건 있어요', href: 'members.html', warn: true });
  if (late.length) todo.push({ text: '마감이 지난 내 업무가 ' + late.length + '건 있어요', href: 'tasks.html', warn: true });

  var ev = events[0], rsvps = [];
  if (ev) {
    rsvps = await safe(db.from('meeting_rsvps').select('user_id,user_name,response').eq('event_id', ev.id), []);
    var mineR = rsvps.filter(function (r) { return r.user_id === me.id; })[0];
    if (!me.isVolunteer && !mineR) todo.push({ text: md(ev.event_date) + ' ' + ev.title + ' 참석 여부를 알려 주세요', href: '#next' });
  }

  // 투표할 날짜 투표가 있으면 알려 줘요(재적 위원만). 표가 아직 없으면 조용히 건너뛰어요.
  if (!me.isVolunteer) {
    var openPolls = await safe(db.from('meeting_polls').select('id,title').eq('status', 'open'), []);
    if (openPolls.length) {
      var popts = await safe(db.from('meeting_poll_options').select('id,poll_id').in('poll_id', openPolls.map(function (p) { return p.id; })), []);
      var pv = popts.length ? await safe(db.from('meeting_poll_votes').select('option_id').eq('user_id', me.id).in('option_id', popts.map(function (o) { return o.id; })), []) : [];
      var voted = {}; pv.forEach(function (v) { voted[v.option_id] = 1; });
      var pending = openPolls.filter(function (p) { return !popts.some(function (o) { return o.poll_id === p.id && voted[o.id]; }); });
      if (pending.length) todo.push({ text: '"' + pending[0].title + '"에 가능한 날짜를 골라 주세요' + (pending.length > 1 ? ' (외 ' + (pending.length - 1) + '건)' : ''), href: 'poll.html', warn: true });
    }
  }

  // ----- 화면 -----
  app.textContent = '';
  app.appendChild(h('div', { class: 'hero' },
    h('div', null, h('div', { class: 'hi', text: (me.name || '위원') + ' 님, 안녕하세요' }),
      h('div', { class: 'sub', text: '쌍용더플래티넘장항 작은도서관 운영위원회 · ' + (me.role === 'admin' ? '관리자 · ' : '') + (me.position || '') + ' · ' + md(today) }))));

  // 한눈에 보는 숫자 (누르면 해당 화면으로)
  var minutesN = todo.filter(function (t) { return t.href.indexOf('minutes.html') === 0; }).length;
  function kpi(n, label, href, tone) { return h('a', { class: 'kpi-c ' + tone + (n > 0 ? ' on' : ''), href: href }, h('b', { text: String(n) }), h('span', { text: label })); }
  app.appendChild(h('div', { class: 'kpi' },
    kpi(minutesN, '확인할 회의록', 'minutes.html', 'red'), kpi(unreadN.length, '안 읽은 공지', 'notices.html', 'blue'),
    kpi(myTasks.length, '내 업무(진행 중)', 'tasks.html', 'purple'), kpi(myShifts.length, '내 근무(2주)', 'shifts.html', 'green')));

  app.appendChild(h('h2', { class: 'sec', text: '지금 확인할 일' }));
  if (todo.length) app.appendChild(h('div', { class: 'todo' }, todo.map(function (t) {
    return h('a', { href: t.href, class: t.warn ? 'warn' : '' }, h('span', { text: t.text }), h('span', { class: 'go', text: '보기 ›' }));
  })));
  else app.appendChild(h('div', { class: 'allclear', text: '✓ 지금 확인할 일이 없어요.' }));

  // 자주 하는 일
  var openCalHook = null;
  var ICO = { bell: ["M6 17V11a6 6 0 0 1 12 0v6l2 2H4z", "M10 21h4"], cal: ["M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M3 10h18M8 3v4M16 3v4"], vote: ["M4 13l8 7 8-7", "M12 3v12M8 8l4-4 4 4"], clock: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 7v5l3 2"] };
  function ico(n) { var NS = "http://www.w3.org/2000/svg", s = document.createElementNS(NS, "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "qi"); ICO[n].forEach(function (d) { var p = document.createElementNS(NS, "path"); p.setAttribute("d", d); s.appendChild(p); }); return s; }
  app.appendChild(h('h2', { class: 'sec', text: '자주 하는 일' }));
  var qa = h('div', { class: 'quick' }, h('a', { href: 'notices.html' }, ico("bell"), '공지 보기'));
  if (!me.isVolunteer) {
    qa.appendChild(h('button', { type: 'button', onclick: function () { if (openCalHook) openCalHook(); } }, ico("cal"), '일정 추가'));
    qa.appendChild(h('a', { href: 'poll.html' }, ico("vote"), '날짜 투표'));
  }
  qa.appendChild(h('a', { href: 'shifts.html' }, ico("clock"), '근무표'));
  app.appendChild(qa);

  // ----- 달력: 회의 일정 · 업무 마감 · 근무 (실제 데이터) -----
  var calBox = h('div', { class: 'calwrap' });
  app.appendChild(h('h2', { class: 'sec', text: '일정 달력' }));
  app.appendChild(calBox);
  buildCalendar(calBox);

  function buildCalendar(box) {
    var cur = new Date(); cur.setDate(1);
    var sel = today, data = { events: [], tasks: [], shifts: [], cal: [] };
    var COLORS = { ev: '#14305c', task: '#c27a1a', shift: '#2f8f6b', cal: '#7b4ea3' };
    var canAddCal = !me.isVolunteer;      // 재적 위원(자원봉사 제외)은 누구나 공유 일정을 추가해요

    async function loadMonth() {
      var a = U.ymd(cur), last = U.ymd(new Date(cur.getFullYear(), cur.getMonth() + 1, 0));
      var r = await Promise.all([
        safe(db.from('meeting_events').select('id,title,kind,event_date,start_time,place').gte('event_date', a).lte('event_date', last).order('start_time'), []),
        safe(db.from('tasks').select('id,title,status,due_date,task_assignees(user_id,role)').gte('due_date', a).lte('due_date', last), []),
        safe(db.from('shifts').select('user_id,name,shift_date,slot').gte('shift_date', a).lte('shift_date', last).order('slot'), []),
        safe(db.from('calendar_items').select('*').lte('item_date', last).gte('end_date', a).order('start_time'), [])
      ]);
      data = { events: r[0], tasks: r[1], shifts: r[2], cal: r[3] };
    }
    function itemsOn(ymd) {
      var items = [];
      data.events.filter(function (e) { return e.event_date === ymd; }).forEach(function (e) { items.push({ k: 'ev', t: (hm(e.start_time) ? hm(e.start_time) + ' ' : '') + e.title, href: 'schedule.html', sort: hm(e.start_time) || '00:00' }); });
      data.tasks.filter(function (x) { return x.due_date === ymd; }).forEach(function (x) {
        var mine = x.task_assignees.some(function (a) { return a.user_id === me.id; });
        items.push({ k: 'task', t: x.title + (x.status === 'done' ? ' (완료)' : ''), mine: mine, done: x.status === 'done', href: 'tasks.html', sort: '09:99' });
      });
      data.cal.filter(function (c) { return c.item_date <= ymd && c.end_date >= ymd; }).forEach(function (c) {
        items.push({ k: 'cal', t: (hm(c.start_time) ? hm(c.start_time) + ' ' : '') + c.title, row: c, sort: hm(c.start_time) || '00:00' });
      });
      var sh = data.shifts.filter(function (s) { return s.shift_date === ymd; });
      sh.forEach(function (s) { items.push({ k: 'shift', t: s.name + ' · ' + s.slot, short: s.name + ' ' + s.slot.slice(0, 2) + '시', mine: s.user_id === me.id, href: 'shifts.html', sort: s.slot.slice(0, 5) }); });
      return items.sort(function (a, b) { return a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0; });
    }

    function draw() {
      box.textContent = '';
      var y = cur.getFullYear(), m = cur.getMonth(), firstDow = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
      var grid = h('div', { class: 'calgrid' });
      DAYS.forEach(function (d, i) { grid.appendChild(h('div', { class: 'dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : ''), text: d })); });
      for (var i = 0; i < firstDow; i++) grid.appendChild(h('div', { class: 'cell empty' }));
      for (var d = 1; d <= days; d++) {
        (function (d) {
          var ymd = y + '-' + U.pad(m + 1) + '-' + U.pad(d), items = itemsOn(ymd), dow = new Date(y, m, d).getDay();
          var cell = h('button', { type: 'button', class: 'cell' + (ymd === today ? ' today' : '') + (ymd === sel ? ' sel' : '') + (dow === 0 ? ' sun' : dow === 6 ? ' sat' : ''), 'aria-label': (m + 1) + '월 ' + d + '일 ' + items.length + '건',
            onclick: function () { sel = ymd; draw(); } }, h('div', { class: 'dn', text: String(d) }));
          // PC: 항목 글자 칩 3개까지 / 폰: 색 점
          var chips = h('div', { class: 'chips2' });
          items.slice(0, 3).forEach(function (it) { chips.appendChild(h('div', { class: 'chip2 ' + it.k + (it.mine ? ' mine' : '') + (it.done ? ' done' : ''), text: it.short || it.t })); });
          if (items.length > 3) chips.appendChild(h('div', { class: 'more', text: '+' + (items.length - 3) + '건' }));
          cell.appendChild(chips);
          var dots = h('div', { class: 'dots' });
          var kinds = {}; items.forEach(function (it) { kinds[it.k] = (kinds[it.k] || 0) + 1; });
          Object.keys(kinds).forEach(function (k) { dots.appendChild(h('span', { class: 'dot ' + k })); });
          cell.appendChild(dots);
          grid.appendChild(cell);
        })(d);
      }
      var head = h('div', { class: 'calhead' },
        h('div', { class: 'ttl', text: y + '년 ' + (m + 1) + '월' }),
        h('div', { class: 'nav' },
          h('button', { class: 'ghost', type: 'button', 'aria-label': '이전 달', text: '‹', onclick: function () { cur = new Date(y, m - 1, 1); change(); } }),
          h('button', { class: 'ghost', type: 'button', text: '오늘', onclick: function () { cur = new Date(); cur.setDate(1); sel = today; change(); } }),
          h('button', { class: 'ghost', type: 'button', 'aria-label': '다음 달', text: '›', onclick: function () { cur = new Date(y, m + 1, 1); change(); } })));
      var legend = h('div', { class: 'legend2' },
        h('span', null, h('span', { class: 'dot ev' }), ' 회의'), h('span', null, h('span', { class: 'dot cal' }), ' 공유 일정'), h('span', null, h('span', { class: 'dot task' }), ' 업무 마감'), h('span', null, h('span', { class: 'dot shift' }), ' 근무 (내 근무는 굵게)'));
      var left = h('div', { class: 'calmain' }, head, grid, legend);

      // 선택한 날 내용
      var sd = U.parseYmd(sel), list = itemsOn(sel);
      var right = h('div', { class: 'calday' }, h('h3', { text: (sd.getMonth() + 1) + '월 ' + sd.getDate() + '일 (' + DAYS[sd.getDay()] + ')' + (sel === today ? ' · 오늘' : '') }));
      if (!list.length) right.appendChild(h('div', { class: 'hint', text: '이 날은 등록된 일정이 없어요.' }));
      var LAB = { ev: '회의', task: '업무 마감', shift: '근무', cal: '공유 일정' };
      list.forEach(function (it) {
        if (it.k === 'cal') {
          var c = it.row, when = hm(c.start_time) ? hm(c.start_time) + (hm(c.end_time) ? '~' + hm(c.end_time) : '') : '';
          var span = c.end_date !== c.item_date ? md(c.item_date) + ' ~ ' + md(c.end_date) : '';
          var det = [c.category, when, span, c.place].filter(Boolean).join(' · ');
          var box2 = h('div', { class: 'ditem cal', style: 'align-items:flex-start' }, h('span', { class: 'dot cal', style: 'margin-top:8px' }),
            h('div', { style: 'flex:1' }, h('div', { class: 'tt', style: 'font-weight:600', text: c.title }),
              det ? h('div', { class: 'hint', text: det }) : null,
              c.note ? h('div', { class: 'hint', style: 'white-space:pre-wrap', text: c.note }) : null,
              h('div', { class: 'hint', text: (c.created_by_name || '') + ' 님이 올림' })));
          if (canAddCal && (me.role === 'admin' || c.created_by === me.id)) box2.appendChild(h('button', { class: 'ghost', type: 'button', text: '고치기', onclick: function () { openCal(c, sel); } }));
          right.appendChild(box2); return;
        }
        right.appendChild(h('a', { class: 'ditem ' + it.k, href: it.href },
          h('span', { class: 'dot ' + it.k }), h('span', { class: 'k', text: LAB[it.k] }),
          h('span', { class: 'tt' + (it.mine ? ' mine' : '') + (it.done ? ' done' : ''), text: it.t + (it.k === 'task' && it.mine ? ' · 내 업무' : '') })));
      });
      if (canAddCal) right.appendChild(h('button', { class: 'primary', type: 'button', style: 'margin-top:12px;width:100%', text: '+ 이 날 일정 추가', onclick: function () { openCal(null, sel); } }));
      else right.appendChild(h('div', { class: 'hint', style: 'margin-top:10px', text: '공유 일정은 재적 위원이 추가할 수 있어요.' }));
      box.appendChild(left); box.appendChild(right);
    }
    async function change() { await loadMonth(); draw(); }
    change();

    // ----- 공유 일정 추가 · 고치기 -----
    var cdlg = document.getElementById('c-dlg'), editingCal = null;
    openCalHook = function () { openCal(null, sel); };
    function openCal(c, day) {
      editingCal = c;
      document.getElementById('c-head').textContent = c ? '공유 일정 고치기' : '공유 일정 추가';
      document.getElementById('c-title').value = c ? c.title : '';
      document.getElementById('c-cat').value = c ? c.category : '입대의 회의';
      document.getElementById('c-date').value = c ? c.item_date : day;
      document.getElementById('c-end').value = c && c.end_date !== c.item_date ? c.end_date : '';
      document.getElementById('c-start').value = c ? hm(c.start_time) : '';
      document.getElementById('c-endt').value = c ? hm(c.end_time) : '';
      document.getElementById('c-place').value = c ? c.place : '';
      document.getElementById('c-note').value = c ? c.note : '';
      document.getElementById('c-del').style.display = c ? '' : 'none';
      cdlg.showModal();
    }
    document.getElementById('c-cancel').onclick = function () { cdlg.close(); };
    document.getElementById('c-form').onsubmit = async function (ev) {
      ev.preventDefault();
      var f = { title: document.getElementById('c-title').value.trim(), category: document.getElementById('c-cat').value, item_date: document.getElementById('c-date').value,
        end_date: document.getElementById('c-end').value || document.getElementById('c-date').value, start_time: document.getElementById('c-start').value || null, end_time: document.getElementById('c-endt').value || null,
        place: document.getElementById('c-place').value.trim(), note: document.getElementById('c-note').value.trim() };
      if (!f.title || !f.item_date) { await sayBox('제목과 날짜를 적어 주세요.'); return; }
      if (f.end_date < f.item_date) { await sayBox('끝나는 날이 시작 날짜보다 빠를 수 없어요.'); return; }
      var btn = document.getElementById('c-save'); btn.disabled = true;
      var r = editingCal ? await db.from('calendar_items').update(f).eq('id', editingCal.id) : await db.from('calendar_items').insert(f);
      btn.disabled = false;
      if (r.error) { await sayBox(U.friendly(r.error)); return; }
      cdlg.close(); sel = f.item_date; var was = editingCal; editingCal = null;
      var d0 = U.parseYmd(f.item_date); cur = new Date(d0.getFullYear(), d0.getMonth(), 1);
      await change(); U.notice('ok', was ? '고쳤어요.' : '공유 일정을 추가했어요. 모든 위원의 달력에 보여요.');
    };
    document.getElementById('c-del').onclick = async function () {
      if (!editingCal || !(await askBox('"' + editingCal.title + '" 일정을 지울까요?', '지우기'))) return;
      var r = await db.from('calendar_items').delete().eq('id', editingCal.id);
      if (r.error) { await sayBox(U.friendly(r.error)); return; }
      cdlg.close(); editingCal = null; await change(); U.notice('ok', '지웠어요.');
    };
  }

  // 다음 회의
  var next = h('div', { class: 'card2', id: 'next' }, h('h2', null, '다음 회의', h('a', { href: 'schedule.html', text: '일정 전체 ›' })));
  if (!ev) next.appendChild(h('div', { class: 'hint', text: '등록된 다음 회의 일정이 없어요.' }));
  else {
    var cnt = { '참석': 0, '불참': 0, '미정': 0 }; rsvps.forEach(function (r) { cnt[r.response]++; });
    next.appendChild(h('div', { class: 'row' }, h('div', { class: 't', text: md(ev.event_date) + ' · ' + ev.title + ' (' + dday(ev.event_date) + ')' }),
      h('div', { class: 's', text: (hm(ev.start_time) ? hm(ev.start_time) + (hm(ev.end_time) ? '~' + hm(ev.end_time) : '') + ' · ' : '') + (ev.place || '장소 미정') }),
      ev.agenda ? h('div', { class: 's', style: 'white-space:pre-wrap', text: ev.agenda }) : null,
      h('div', { class: 'chips' }, h('span', { class: 'badge gold', text: '참석 ' + cnt['참석'] }), h('span', { class: 'badge', text: '불참 ' + cnt['불참'] }), h('span', { class: 'badge', text: '미정 ' + cnt['미정'] }))));
    if (!me.isVolunteer) {
      var mine2 = rsvps.filter(function (r) { return r.user_id === me.id; })[0];
      var box = h('div', { class: 'bar rsvp', style: 'margin:8px 0 0' }, h('span', { class: 'hint', text: '내 응답: ' }));
      ['참석', '불참', '미정'].forEach(function (r) {
        box.appendChild(h('button', { class: 'ghost' + (mine2 && mine2.response === r ? ' sel' : ''), type: 'button', text: r, onclick: actOnce(async function () {
          var x = await db.from('meeting_rsvps').upsert({ event_id: ev.id, user_id: me.id, response: r }, { onConflict: 'event_id,user_id' });
          if (x.error) { U.fail(x.error); return; }
          U.notice('ok', '"' + r + '"으로 응답했어요.'); setTimeout(function () { location.reload(); }, 600);
        }) }));
      });
      next.appendChild(box);
    }
  }

  // 최근 공지
  var nb = h('div', { class: 'card2' }, h('h2', null, '최근 공지', h('a', { href: 'notices.html', text: '전체 ›' })));
  if (!notices.length) nb.appendChild(h('div', { class: 'hint', text: '아직 공지가 없어요.' }));
  notices.slice(0, 4).forEach(function (n) {
    var unread = n.created_by !== me.id && !myReads[n.id];
    nb.appendChild(h('div', { class: 'row' }, h('a', { href: 'notices.html', style: 'color:inherit;text-decoration:none' },
      h('div', { class: 't' }, (n.pinned ? '📌 ' : '') + n.title, unread ? h('span', { class: 'nbadge', text: '새 글' }) : null),
      h('div', { class: 's', text: (n.created_by_name || '') + ' · ' + md(n.created_at.slice(0, 10)) }))));
  });

  // 내 근무
  var sb = h('div', { class: 'card2' }, h('h2', null, '내 근무 (앞으로 2주)', h('a', { href: 'shifts.html', text: '근무표 ›' })));
  if (!myShifts.length) sb.appendChild(h('div', { class: 'hint', text: '예정된 내 근무가 없어요.' }));
  myShifts.forEach(function (s) { sb.appendChild(h('div', { class: 'row' }, h('div', { class: 't', text: md(s.shift_date) + ' ' + s.slot }), h('div', { class: 's', text: dday(s.shift_date) }))); });

  // 내 업무
  var tb = h('div', { class: 'card2' }, h('h2', null, '내 업무', h('a', { href: 'tasks.html', text: '업무 목록 ›' })));
  if (!myTasks.length) tb.appendChild(h('div', { class: 'hint', text: '내가 맡은 진행 중인 업무가 없어요.' }));
  myTasks.slice(0, 5).forEach(function (t) {
    var role = t.task_assignees.filter(function (a) { return a.user_id === me.id; })[0];
    tb.appendChild(h('div', { class: 'row' }, h('div', { class: 't', text: t.title }),
      h('div', { class: 's' }, (role && role.role === 'main' ? '메인 담당' : '보조 담당') + (t.due_date ? ' · 마감 ' + md(t.due_date) + ' (' + dday(t.due_date) + ')' : ''))));
  });
  if (myTasks.length > 5) tb.appendChild(h('div', { class: 'hint', text: '외 ' + (myTasks.length - 5) + '건' }));

  app.appendChild(h('div', { class: 'cols' }, h('div', { style: 'display:flex;flex-direction:column;gap:14px' }, next, sb), h('div', { style: 'display:flex;flex-direction:column;gap:14px' }, nb, tb)));
});
