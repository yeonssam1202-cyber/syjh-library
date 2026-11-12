// 회의 일정: 임원·관리자가 등록, 재적 위원이 참석/불참/미정으로 응답, 회의록 쓰기와 연결
window.whenAuthed.then(function (me) {
  'use strict';
  var db = Auth.client, U = UI, h = U.h, $ = U.$, app = $('app');
  var canCreate = me.can('meeting_schedule'), isAdmin = me.role === 'admin', canMinutes = me.can('minutes_write');
  var DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  var events = [], rsvps = [], minutesBy = {}, editing = null;

  function md(s) { var d = U.parseYmd(s); return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일(' + DAYS[d.getDay()] + ')'; }
  function hm(t) { return t ? String(t).slice(0, 5) : ''; }
  function when(e) { var a = hm(e.start_time), b = hm(e.end_time); return md(e.event_date) + (a ? ' ' + a + (b ? ' ~ ' + b : '') : ''); }
  function mineEvent(e) { return isAdmin || e.created_by === me.id; }

  async function load() {
    var a = await db.from('meeting_events').select('*').order('event_date', { ascending: false }).order('start_time', { ascending: false }).limit(60);
    if (a.error) throw a.error;
    events = a.data;
    var b = await db.from('meeting_rsvps').select('event_id,user_id,user_name,response,note');
    rsvps = b.error ? [] : b.data;
    var c = await db.from('meetings').select('id,event_id,seq,status').not('event_id', 'is', null);
    minutesBy = {}; if (!c.error) c.data.forEach(function (m) { minutesBy[m.event_id] = m; });
  }

  function render() {
    app.textContent = '';
    app.appendChild(h('div', { class: 'top noprint' },
      h('div', null, h('div', { class: 'mark', text: '작은도서관 운영위원회' }), h('h1', { text: '회의 일정' })),
      canCreate ? h('button', { class: 'primary', text: '+ 회의 일정 등록', onclick: function () { openDlg(null); } }) : null));
    if (!canCreate) app.appendChild(h('div', { class: 'hint noprint', style: 'margin:-8px 0 12px', text: '회의 일정은 임원과 관리자가 등록해요. 위원은 참석 여부만 알려 주세요.' }));
    var today = U.today();
    var upcoming = events.filter(function (e) { return e.event_date >= today; }).sort(function (a, b) { return a.event_date < b.event_date ? -1 : 1; });
    var past = events.filter(function (e) { return e.event_date < today; });
    app.appendChild(h('h2', { style: 'font-size:17px;margin:4px 0 8px;color:var(--navy)', text: '다가오는 회의' }));
    if (!upcoming.length) app.appendChild(h('div', { class: 'empty', text: '등록된 다가오는 회의가 없어요.' }));
    upcoming.forEach(function (e) { app.appendChild(card(e, false)); });
    if (past.length) {
      var d = h('details', { style: 'margin-top:14px' }, h('summary', { style: 'cursor:pointer;font-weight:600;color:var(--navy);margin-bottom:8px', text: '지난 회의 ' + past.length + '건' }));
      past.forEach(function (e) { d.appendChild(card(e, true)); });
      app.appendChild(d);
    }
  }

  function card(e, isPast) {
    var rs = rsvps.filter(function (r) { return r.event_id === e.id; });
    var cnt = { '참석': [], '불참': [], '미정': [] }; rs.forEach(function (r) { cnt[r.response].push(r); });
    var mineR = rs.filter(function (r) { return r.user_id === me.id; })[0];
    var c = h('div', { class: 'ev' + (isPast ? ' past' : '') },
      h('div', { class: 't', text: e.title + ' · ' + e.kind }),
      h('div', { class: 's', text: when(e) + (e.place ? ' · ' + e.place : '') }),
      e.agenda ? h('div', { class: 'ag', text: e.agenda }) : null,
      e.note ? h('div', { class: 'hint', text: e.note }) : null);

    // 참석 응답 (자원봉사는 재적 위원이 아니라서 응답 대상이 아니에요)
    if (!me.isVolunteer && !isPast) {
      var box = h('div', { class: 'rsvp noprint' }, h('span', { style: 'font-weight:600', text: '내 응답' }));
      ['참석', '불참', '미정'].forEach(function (r) {
        box.appendChild(h('button', { class: 'ghost' + (mineR && mineR.response === r ? ' sel' : ''), type: 'button', text: r, onclick: function () { respond(e, r, mineR); } }));
      });
      if (!mineR) box.appendChild(h('span', { class: 'hint', text: '아직 응답하지 않았어요' }));
      c.appendChild(box);
    }
    c.appendChild(h('div', { class: 'names' },
      h('span', { class: 'badge gold', text: '참석 ' + cnt['참석'].length }), h('span', { class: 'badge', text: '불참 ' + cnt['불참'].length }), h('span', { class: 'badge', text: '미정 ' + cnt['미정'].length })));
    if (rs.length) {
      var det = h('details', { style: 'margin-top:6px' }, h('summary', { style: 'cursor:pointer;color:var(--muted);font-size:14px', text: '응답 보기' }));
      ['참석', '불참', '미정'].forEach(function (k) {
        if (!cnt[k].length) return;
        det.appendChild(h('div', { style: 'margin-top:6px;font-size:14px' }, h('strong', { text: k + ' ' }), cnt[k].map(function (r) { return r.user_name + (r.note ? '(' + r.note + ')' : ''); }).join(', ')));
      });
      c.appendChild(det);
    }

    // 회의록 연결 · 관리
    var acts = h('div', { class: 'bar noprint', style: 'margin:12px 0 0' });
    var m = minutesBy[e.id];
    if (m) acts.appendChild(h('a', { class: 'ghost', style: 'display:inline-block;padding:9px 14px;border:1px solid var(--line);border-radius:4px;text-decoration:none;color:inherit', href: 'minutes.html?id=' + m.id, text: '제' + m.seq + '차 회의록 보기' }));
    else if (canMinutes) acts.appendChild(h('a', { class: 'ghost', style: 'display:inline-block;padding:9px 14px;border:1px solid var(--line);border-radius:4px;text-decoration:none;color:inherit', href: 'minutes.html?new&event=' + e.id, text: '이 회의로 회의록 쓰기 (참석 응답이 채워져요)' }));
    if (canCreate && mineEvent(e)) {
      acts.appendChild(h('span', { class: 'sp' }));
      acts.appendChild(h('button', { class: 'ghost', type: 'button', text: '고치기', onclick: function () { openDlg(e); } }));
      acts.appendChild(h('button', { class: 'ghost danger', type: 'button', text: '삭제', onclick: function () { remove(e); } }));
    }
    if (acts.childNodes.length) c.appendChild(acts);
    return c;
  }

  async function respond(e, r, mineR) {
    var x = await db.from('meeting_rsvps').upsert({ event_id: e.id, user_id: me.id, response: r }, { onConflict: 'event_id,user_id' });
    if (x.error) { U.fail(x.error); return; }
    await reload(); U.notice('ok', '"' + r + '"으로 응답했어요.');
  }
  async function reload() { try { await load(); render(); } catch (x) { U.fail(x); } }

  // ---------- 등록 · 고치기 ----------
  var dlg = $('dlg');
  function openDlg(e) {
    editing = e;
    $('d-title').textContent = e ? '회의 일정 고치기' : '회의 일정 등록';
    $('e-title').value = e ? e.title : '정기회의';
    $('e-kind').value = e ? e.kind : '정기회의'; $('e-date').value = e ? e.event_date : '';
    $('e-start').value = e ? hm(e.start_time) : '10:00'; $('e-end').value = e ? hm(e.end_time) : '12:00';
    $('e-place').value = e ? e.place : ''; $('e-agenda').value = e ? e.agenda : ''; $('e-note').value = e ? e.note : '';
    dlg.showModal();
  }
  $('e-cancel').onclick = function () { dlg.close(); };
  $('form').onsubmit = async function (ev) {
    ev.preventDefault();
    var f = { title: $('e-title').value.trim(), kind: $('e-kind').value, event_date: $('e-date').value, start_time: $('e-start').value || null, end_time: $('e-end').value || null,
      place: $('e-place').value.trim(), agenda: $('e-agenda').value.trim(), note: $('e-note').value.trim() };
    if (!f.title || !f.event_date) { await sayBox('회의 이름과 날짜를 적어 주세요.'); return; }
    var btn = $('e-save'); btn.disabled = true;
    var r = editing ? await db.from('meeting_events').update(f).eq('id', editing.id) : await db.from('meeting_events').insert(f);
    btn.disabled = false;
    if (r.error) { await sayBox(U.friendly(r.error)); return; }
    dlg.close(); var was = editing; editing = null;
    await reload(); U.notice('ok', was ? '고쳤어요.' : '회의 일정을 등록했어요. 위원들이 참석 여부를 알려 줄 수 있어요.');
  };
  async function remove(e) {
    if (!(await askBox('"' + e.title + '" 일정을 삭제할까요? 참석 응답도 함께 지워져요.', '삭제'))) return;
    var r = await db.from('meeting_events').delete().eq('id', e.id);
    if (r.error) { U.fail(r.error); return; }
    await reload(); U.notice('ok', '삭제했어요.');
  }

  load().then(render).catch(U.fail);
});
