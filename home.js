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

  var res = await Promise.all([
    safe(db.from('notices').select('id,title,pinned,created_by,created_by_name,created_at').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(4), []),
    safe(db.from('notice_reads').select('notice_id').eq('user_id', me.id), []),
    safe(db.from('meeting_events').select('*').gte('event_date', today).order('event_date').order('start_time').limit(1), []),
    safe(db.from('shifts').select('id,shift_date,slot').eq('user_id', me.id).gte('shift_date', today).lte('shift_date', weekEnd).order('shift_date'), []),
    safe(db.from('tasks').select('id,title,status,due_date,task_assignees(user_id,role)').neq('status', 'done').limit(200), []),
    safe(db.from('meetings').select('id,seq,kind,meeting_date,status,meeting_attendees(id,user_id,attended),meeting_signatures(attendee_id),meeting_reviews(attendee_id)').in('status', ['draft', 'signing']), []),
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
  meetings.forEach(function (m) {
    var mine = m.meeting_attendees.filter(function (a) { return a.user_id === me.id && a.attended; })[0];
    if (!mine) return;
    var label = '제' + m.seq + '차 ' + m.kind + ' (' + md(m.meeting_date) + ')';
    if (m.status === 'signing' && !m.meeting_signatures.some(function (s) { return s.attendee_id === mine.id; }))
      todo.push({ text: label + ' 회의록에 서명해 주세요', href: 'minutes.html?id=' + m.id, warn: true });
    if (m.status === 'draft' && !m.meeting_reviews.some(function (r) { return r.attendee_id === mine.id; }))
      todo.push({ text: label + ' 회의록을 검토해 주세요', href: 'minutes.html?id=' + m.id });
  });
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

  // ----- 화면 -----
  app.textContent = '';
  app.appendChild(h('div', { class: 'hero' },
    h('img', { src: 'logo.png', alt: 'The Platinum' }),
    h('div', null, h('div', { class: 'hi', text: (me.name || '위원') + ' 님, 안녕하세요' }),
      h('div', { class: 'sub', text: '쌍용더플래티넘장항 작은도서관 운영위원회 · ' + (me.role === 'admin' ? '관리자 · ' : '') + (me.position || '') + ' · ' + md(today) }))));

  app.appendChild(h('h2', { style: 'font-size:18px;margin:0 0 8px;color:var(--navy)', text: '지금 확인할 일' }));
  if (todo.length) app.appendChild(h('div', { class: 'todo' }, todo.map(function (t) {
    return h('a', { href: t.href, class: t.warn ? 'warn' : '' }, h('span', { text: t.text }), h('span', { class: 'go', text: '보기 ›' }));
  })));
  else app.appendChild(h('div', { class: 'allclear', text: '✓ 지금 확인할 일이 없어요.' }));

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
        box.appendChild(h('button', { class: 'ghost' + (mine2 && mine2.response === r ? ' sel' : ''), type: 'button', text: r, onclick: async function () {
          var x = await db.from('meeting_rsvps').upsert({ event_id: ev.id, user_id: me.id, response: r }, { onConflict: 'event_id,user_id' });
          if (x.error) { U.fail(x.error); return; }
          U.notice('ok', '"' + r + '"으로 응답했어요.'); setTimeout(function () { location.reload(); }, 600);
        } }));
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
