// 회의 날짜 투표: 임원·관리자가 후보 날짜를 올리고, 재적 위원이 날짜별 "가능/어려움"을 고르고, 만든 사람이 한 날짜를 확정하면 회의 일정이 자동으로 생겨요.
window.whenAuthed.then(function (me) {
  'use strict';
  var db = Auth.client, U = UI, h = U.h, $ = U.$, app = $('app');
  var canCreate = me.can('meeting_schedule'), isAdmin = me.role === 'admin';
  var DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  var polls = [], options = [], votes = [], roster = [];

  function md(s) { var d = U.parseYmd(s); return (d.getMonth() + 1) + '월 ' + d.getDate() + '일(' + DAYS[d.getDay()] + ')'; }
  function hm(t) { return t ? String(t).slice(0, 5) : ''; }
  function optText(o) { var a = hm(o.start_time), b = hm(o.end_time); return md(o.opt_date) + (a ? ' ' + a + (b ? ' ~ ' + b : '') : ''); }
  function mine(p) { return isAdmin || p.created_by === me.id; }

  async function load() {
    var a = await db.from('meeting_polls').select('*').order('created_at', { ascending: false }).limit(40);
    if (a.error) throw a.error;
    polls = a.data;
    var ids = polls.map(function (p) { return p.id; });
    options = []; votes = [];
    if (ids.length) {
      var b = await db.from('meeting_poll_options').select('*').in('poll_id', ids).order('opt_date').order('start_time');
      if (b.error) throw b.error;
      options = b.data;
      var oids = options.map(function (o) { return o.id; });
      if (oids.length) {
        var c = await db.from('meeting_poll_votes').select('option_id,user_id,user_name,answer').in('option_id', oids);
        if (c.error) throw c.error;
        votes = c.data;
      }
    }
    var r = await db.from('profiles').select('id,name,position').eq('status', 'approved').order('name');
    roster = r.error ? [] : r.data.filter(function (m) { return m.position !== '자원봉사'; });
  }
  async function reload() { try { await load(); render(); } catch (x) { U.fail(x); } }

  function render() {
    app.textContent = '';
    app.appendChild(h('div', { class: 'top noprint' },
      h('div', null, h('div', { class: 'mark', text: '작은도서관 운영위원회' }), h('h1', { text: '날짜 투표' })),
      canCreate ? h('button', { class: 'primary', text: '+ 날짜 투표 만들기', onclick: openDlg }) : null));
    if (!canCreate) app.appendChild(h('div', { class: 'hint noprint', style: 'margin:-8px 0 12px', text: '투표는 임원과 관리자가 만들어요. 위원은 가능한 날짜를 골라 주세요.' }));
    var open = polls.filter(function (p) { return p.status === 'open'; });
    var closed = polls.filter(function (p) { return p.status !== 'open'; });
    if (!open.length) app.appendChild(h('div', { class: 'empty', text: '진행 중인 날짜 투표가 없어요.' }));
    open.forEach(function (p) { app.appendChild(card(p)); });
    if (closed.length) {
      var d = h('details', { style: 'margin-top:14px' }, h('summary', { style: 'cursor:pointer;font-weight:600;color:var(--navy);margin-bottom:8px', text: '확정된 투표 ' + closed.length + '건' }));
      closed.forEach(function (p) { d.appendChild(card(p)); });
      app.appendChild(d);
    }
  }

  function card(p) {
    var isOpen = p.status === 'open';
    var opts = options.filter(function (o) { return o.poll_id === p.id; });
    var ov = {}; opts.forEach(function (o) { ov[o.id] = votes.filter(function (v) { return v.option_id === o.id; }); });
    var voters = {}; opts.forEach(function (o) { ov[o.id].forEach(function (v) { voters[v.user_id] = 1; }); });
    var nVoters = Object.keys(voters).length;
    var best = -1; opts.forEach(function (o) { var c = ov[o.id].filter(function (v) { return v.answer === '가능'; }).length; if (c > best) best = c; });

    var c = h('div', { class: 'pl' },
      h('div', { class: 't', text: p.title + ' · ' + p.kind }),
      h('div', { class: 's', text: (p.place ? p.place + ' · ' : '') + (p.created_by_name ? p.created_by_name + ' 님이 만듦' : '') + ' · ' + String(p.created_at).slice(0, 10) }),
      p.note ? h('div', { class: 'hint', text: p.note }) : null);

    if (!isOpen) {
      var pick = opts.filter(function (o) { return o.id === p.picked_option; })[0];
      c.appendChild(h('div', { style: 'margin-top:8px' }, h('span', { class: 'badge gold', text: '확정' }), ' ', h('strong', { text: pick ? optText(pick) : '' }), ' ',
        p.event_id ? h('a', { href: 'schedule.html', text: '회의 일정 보기 →' }) : null));
    } else if (me.isVolunteer) {
      c.appendChild(h('div', { class: 'hint', text: '자원봉사 위원은 재적 위원이 아니라 투표 결과만 볼 수 있어요.' }));
    }

    opts.forEach(function (o) {
      var vs = ov[o.id], yes = vs.filter(function (v) { return v.answer === '가능'; }), no = vs.filter(function (v) { return v.answer === '어려움'; });
      var my = vs.filter(function (v) { return v.user_id === me.id; })[0];
      var total = Math.max(roster.length, 1);
      var left = h('div', null,
        h('div', { class: 'd' }, optText(o), (isOpen && best > 0 && yes.length === best) ? h('span', { class: 'best', text: '가장 많아요' }) : null,
          (!isOpen && o.id === p.picked_option) ? h('span', { class: 'best', text: '확정' }) : null),
        h('div', { class: 'cnt', text: '가능 ' + yes.length + '명 · 어려움 ' + no.length + '명' }),
        h('div', { class: 'bar2' }, h('i', { style: 'width:' + Math.round(yes.length / total * 100) + '%' })));
      var btns = h('div', { class: 'btns noprint' });
      if (isOpen && !me.isVolunteer) {
        btns.appendChild(h('button', { class: 'ghost' + (my && my.answer === '가능' ? ' sel' : ''), type: 'button', text: '가능', onclick: actOnce(function () { return vote(o, '가능', my); }) }));
        btns.appendChild(h('button', { class: 'ghost' + (my && my.answer === '어려움' ? ' sel no' : ''), type: 'button', text: '어려움', onclick: actOnce(function () { return vote(o, '어려움', my); }) }));
      }
      if (isOpen && canCreate && mine(p)) btns.appendChild(h('button', { class: 'primary', type: 'button', text: '이 날짜로 확정', onclick: function () { confirmPick(p, o); } }));
      var row = h('div', { class: 'opt' }, left, btns);
      if (yes.length || no.length) {
        var det = h('details', { class: 'who', style: 'grid-column:1/-1' }, h('summary', { style: 'cursor:pointer;color:var(--muted)', text: '누가 골랐나요' }));
        if (yes.length) det.appendChild(h('div', null, h('strong', { text: '가능 ' }), yes.map(function (v) { return v.user_name; }).join(', ')));
        if (no.length) det.appendChild(h('div', null, h('strong', { text: '어려움 ' }), no.map(function (v) { return v.user_name; }).join(', ')));
        row.appendChild(det);
      }
      c.appendChild(row);
    });

    if (isOpen) {
      var wait = roster.filter(function (m) { return !voters[m.id]; });
      c.appendChild(h('div', { class: 'hint', style: 'margin-top:8px', text: '투표한 위원 ' + nVoters + '/' + roster.length + '명' + (wait.length ? ' · 아직 안 한 위원: ' + wait.map(function (m) { return m.name; }).join(', ') : ' · 모두 투표했어요') }));
    }
    if (canCreate && mine(p)) {
      c.appendChild(h('div', { class: 'bar noprint', style: 'margin:10px 0 0' }, h('span', { class: 'sp' }),
        h('button', { class: 'ghost danger', type: 'button', text: '투표 삭제', onclick: function () { removePoll(p); } })));
    }
    return c;
  }

  async function vote(o, ans, my) {
    var r = my && my.answer === ans
      ? await db.from('meeting_poll_votes').delete().eq('option_id', o.id).eq('user_id', me.id)
      : await db.from('meeting_poll_votes').upsert({ option_id: o.id, user_id: me.id, answer: ans }, { onConflict: 'option_id,user_id' });
    if (r.error) { U.fail(r.error); return; }
    await reload();
  }
  async function confirmPick(p, o) {
    if (!(await askBox('"' + optText(o) + '"으로 확정할까요? 투표가 닫히고 회의 일정이 자동으로 만들어져요. (되돌릴 수 없어요)', '확정'))) return;
    var r = await db.rpc('close_meeting_poll', { pid: p.id, oid: o.id });
    if (r.error) { U.fail(r.error); return; }
    await reload(); U.notice('ok', '날짜를 확정했어요. "회의 일정"에 등록됐어요. 이제 위원들이 참석 여부를 알려 줄 수 있어요.');
  }
  async function removePoll(p) {
    if (!(await askBox('"' + p.title + '" 투표를 삭제할까요? 위원들이 고른 내용도 함께 지워져요.', '삭제'))) return;
    var r = await db.from('meeting_polls').delete().eq('id', p.id);
    if (r.error) { U.fail(r.error); return; }
    await reload(); U.notice('ok', '삭제했어요.');
  }

  // ---------- 만들기 ----------
  var dlg = $('dlg'), cands = $('cands');
  function candRow(date, st, en) {
    var d = h('input', { type: 'date', 'aria-label': '후보 날짜' }), s = h('input', { type: 'time', 'aria-label': '시작 시각' }), e = h('input', { type: 'time', 'aria-label': '종료 시각' });
    d.value = date || ''; s.value = st || '10:00'; e.value = en || '12:00';
    var row = h('div', { class: 'crow' }, h('div', null, h('label', { class: 'l', text: '날짜' }), d), h('div', null, h('label', { class: 'l', text: '시작' }), s), h('div', null, h('label', { class: 'l', text: '종료' }), e),
      h('button', { class: 'ghost danger', type: 'button', text: '빼기', onclick: function () { if (cands.children.length > 2) cands.removeChild(row); } }));
    row._get = function () { return { opt_date: d.value, start_time: s.value || null, end_time: e.value || null }; };
    return row;
  }
  function openDlg() {
    $('p-title').value = '정기회의 날짜 투표'; $('p-kind').value = '정기회의'; $('p-place').value = ''; $('p-note').value = '';
    cands.textContent = ''; cands.appendChild(candRow()); cands.appendChild(candRow()); cands.appendChild(candRow());
    dlg.showModal();
  }
  $('p-add').onclick = function () { if (cands.children.length >= 10) { sayBox('후보 날짜는 최대 10개예요.'); return; } cands.appendChild(candRow()); };
  $('p-cancel').onclick = function () { dlg.close(); };
  $('form').onsubmit = async function (ev) {
    ev.preventDefault();
    var list = Array.prototype.map.call(cands.children, function (r) { return r._get(); }).filter(function (x) { return x.opt_date; });
    var seen = {}, dup = false; list.forEach(function (x) { var k = x.opt_date + '|' + (x.start_time || ''); if (seen[k]) dup = true; seen[k] = 1; });
    if (list.length < 2) { await sayBox('후보 날짜를 2개 이상 넣어 주세요.'); return; }
    if (dup) { await sayBox('같은 날짜·시간이 두 번 들어 있어요.'); return; }
    var title = $('p-title').value.trim(); if (!title) { await sayBox('투표 이름을 적어 주세요.'); return; }
    var btn = $('p-save'); btn.disabled = true;
    var ins = await db.from('meeting_polls').insert({ title: title, kind: $('p-kind').value, place: $('p-place').value.trim(), note: $('p-note').value.trim() }).select('id').single();
    if (ins.error) { btn.disabled = false; await sayBox(U.friendly(ins.error)); return; }
    var oi = await db.from('meeting_poll_options').insert(list.map(function (x) { return Object.assign({ poll_id: ins.data.id }, x); }));
    btn.disabled = false;
    if (oi.error) { await db.from('meeting_polls').delete().eq('id', ins.data.id); await sayBox(U.friendly(oi.error)); return; }
    dlg.close(); await reload(); U.notice('ok', '투표를 열었어요. 위원들이 가능한 날짜를 고를 수 있어요.');
  };

  app.appendChild(loadingBox());
  load().then(render).catch(U.fail);
});
