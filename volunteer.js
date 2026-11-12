// 봉사 시간: 근무표에서 자동 집계 → 임원·담당자·관리자가 달 단위로 확인 → 봉사 활동 확인서 인쇄
window.whenAuthed.then(function (me) {
  'use strict';
  var db = Auth.client, U = UI, h = U.h, $ = U.$, app = $('app');
  var isApprover = me.can('shifts_approve');
  var ym = U.today().slice(0, 7), vols = [], shifts = [], confs = [], confirmTarget = null;

  function slotMin(slot) { var m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(slot || ''); return m ? Math.max(0, (+m[3] * 60 + +m[4]) - (+m[1] * 60 + +m[2])) : 0; }
  function hrs(min) { var a = Math.floor(min / 60), b = min % 60; return a + '시간' + (b ? ' ' + b + '분' : ''); }
  function monthRange(m) { var y = +m.slice(0, 4), mo = +m.slice(5, 7); return [m + '-01', U.ymd(new Date(y, mo, 0))]; }
  function monthLabel(m) { return m.slice(0, 4) + '년 ' + (+m.slice(5, 7)) + '월'; }
  function shiftMonth(m, d) { var y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1 + d; var dt = new Date(y, mo, 1); return dt.getFullYear() + '-' + U.pad(dt.getMonth() + 1); }

  async function load() {
    var p = await db.from('profiles').select('id,name,email,position').eq('status', 'approved').order('name');
    if (p.error) throw p.error;
    vols = p.data.filter(function (x) { return x.position === '자원봉사' }).map(function (x) { return { id: x.id, name: x.name || x.email }; });
    var r = monthRange(ym), today = U.today();
    var s = await db.from('shifts').select('user_id,shift_date,slot').gte('shift_date', r[0]).lte('shift_date', r[1]);
    if (s.error) throw s.error;
    shifts = s.data;
    var c = await db.from('volunteer_hour_confirmations').select('*').eq('month', ym);
    if (c.error) throw c.error;
    confs = c.data;
  }
  function calc(uid) {
    var today = U.today(), done = 0, plan = 0, n = 0;
    shifts.filter(function (x) { return x.user_id === uid; }).forEach(function (x) { n++; if (x.shift_date <= today) done += slotMin(x.slot); else plan += slotMin(x.slot); });
    return { n: n, done: done, plan: plan };
  }
  function confOf(uid) { return confs.filter(function (c) { return c.user_id === uid; })[0]; }

  function render() {
    app.textContent = '';
    app.appendChild(h('div', { class: 'top noprint' }, h('div', null, h('div', { class: 'mark', text: '작은도서관 운영위원회' }), h('h1', { text: '봉사 시간' }))));
    app.appendChild(h('div', { class: 'monthbar noprint' },
      h('button', { class: 'ghost', 'aria-label': '이전 달', text: '‹', onclick: function () { ym = shiftMonth(ym, -1); reload(); } }),
      h('span', { class: 'm', text: monthLabel(ym) }),
      h('button', { class: 'ghost', 'aria-label': '다음 달', text: '›', onclick: function () { ym = shiftMonth(ym, 1); reload(); } })));
    app.appendChild(h('div', { class: 'note noprint', text: '봉사 시간은 근무표에 들어간 시간대(예: 10:00-13:00 = 3시간)를 지난 근무만 자동으로 더해요. 임원이 달 단위로 확인하면 확정되고, 확인된 시간만 확인서에 들어가요.' }));

    if (isApprover) {
      var p = h('div', { class: 'panel noprint' }, h('h2', { text: monthLabel(ym) + ' 자원봉사자별 시간' }));
      if (!vols.length) p.appendChild(h('div', { class: 'hint', text: '직책이 "자원봉사"인 위원이 아직 없어요. 회원 승인 화면에서 직책을 정해 주세요.' }));
      else {
        p.appendChild(h('div', { class: 'wrapx' }, h('table', { class: 'vt' },
          h('thead', null, h('tr', null, ['이름', '근무', '지난 근무(자동)', '예정', '확정 시간', '상태', ''].map(function (t) { return h('th', { text: t }); }))),
          h('tbody', null, vols.map(function (v) {
            var c = calc(v.id), cf = confOf(v.id);
            return h('tr', null, h('td', { text: v.name }), h('td', { class: 'num', text: c.n + '회' }), h('td', { class: 'num', text: hrs(c.done) }), h('td', { class: 'num', text: c.plan ? hrs(c.plan) : '-' }),
              h('td', { class: 'num', text: cf ? hrs(cf.confirmed_minutes) : '-' }),
              h('td', null, cf ? h('span', { class: 'badge gold', text: '확인됨 · ' + cf.confirmed_by_name }) : h('span', { class: 'badge', text: '미확인' }),
                cf && cf.note ? h('div', { class: 'hint', text: cf.note }) : null),
              h('td', null, h('div', { class: 'bar', style: 'margin:0' },
                h('button', { class: 'primary', type: 'button', text: cf ? '다시 확인' : '확인하기', onclick: function () { openConfirm(v, c, cf); } }),
                cf ? h('button', { class: 'ghost', type: 'button', text: '확인 취소', onclick: function () { unconfirm(v, cf); } }) : null,
                h('button', { class: 'ghost', type: 'button', text: '확인서', onclick: function () { showCert(v); } }))));
          })))));
      }
      app.appendChild(p);
    }

    if (me.isVolunteer) {
      var c = calc(me.id), cf = confOf(me.id);
      app.appendChild(h('div', { class: 'panel noprint' }, h('h2', { text: monthLabel(ym) + ' 내 봉사 시간' }),
        h('div', { text: '지난 근무 ' + hrs(c.done) + (c.plan ? ' · 앞으로 예정 ' + hrs(c.plan) : '') + ' (근무 ' + c.n + '회)' }),
        h('div', { style: 'margin-top:6px' }, cf ? h('span', { class: 'badge gold', text: '확인됨 ' + hrs(cf.confirmed_minutes) + ' · ' + cf.confirmed_by_name }) : h('span', { class: 'badge', text: '아직 임원이 확인하지 않았어요' }),
          cf && cf.note ? h('div', { class: 'hint', text: '조정 사유: ' + cf.note }) : null),
        h('div', { class: 'bar' }, h('button', { class: 'primary', type: 'button', text: '봉사 활동 확인서 만들기', onclick: function () { showCert({ id: me.id, name: me.name || me.email }); } }))));
    }
    if (!isApprover && !me.isVolunteer) app.appendChild(h('div', { class: 'empty', text: '이 화면은 자원봉사 위원과 임원이 사용해요.' }));
    app.appendChild(h('div', { id: 'certbox' }));
  }
  async function reload() { try { await load(); render(); } catch (e) { U.fail(e); } }

  // ---------- 확인 ----------
  var dlg = $('dlg');
  function openConfirm(v, c, cf) {
    confirmTarget = { v: v, auto: c.done };
    var min = cf ? cf.confirmed_minutes : c.done;
    $('d-title').textContent = v.name + ' · ' + monthLabel(ym) + ' 봉사 시간 확인';
    $('d-sub').textContent = '근무표 자동 집계(지난 근무)는 ' + hrs(c.done) + '이에요. 결근 등이 있으면 시간을 고쳐서 확인해 주세요.';
    $('v-h').value = Math.floor(min / 60); $('v-m').value = min % 60; $('v-note').value = cf ? cf.note : '';
    dlg.showModal();
  }
  $('v-cancel').onclick = function () { dlg.close(); };
  $('form').onsubmit = async function (e) {
    e.preventDefault();
    var min = (parseInt($('v-h').value, 10) || 0) * 60 + (parseInt($('v-m').value, 10) || 0);
    var adj = min !== confirmTarget.auto;
    if (adj && !$('v-note').value.trim() && !(await askBox('자동 집계(' + hrs(confirmTarget.auto) + ')와 다른 시간이에요. 조정 사유 없이 확인할까요?', '그대로 확인'))) return;
    var btn = $('v-save'); btn.disabled = true;
    var r = await db.from('volunteer_hour_confirmations').upsert({ user_id: confirmTarget.v.id, month: ym, auto_minutes: confirmTarget.auto, confirmed_minutes: min, note: $('v-note').value.trim() }, { onConflict: 'user_id,month' });
    btn.disabled = false;
    if (r.error) { await sayBox(U.friendly(r.error)); return; }
    dlg.close(); await reload(); U.notice('ok', confirmTarget.v.name + ' 님의 ' + monthLabel(ym) + ' 봉사 시간을 ' + hrs(min) + '으로 확인했어요.');
  };
  async function unconfirm(v, cf) {
    if (!(await askBox(v.name + ' 님의 ' + monthLabel(ym) + ' 확인을 취소할까요? 확인서에서 이 달이 빠져요.', '확인 취소'))) return;
    var r = await db.from('volunteer_hour_confirmations').delete().eq('id', cf.id);
    if (r.error) { U.fail(r.error); return; }
    await reload(); U.notice('ok', '확인을 취소했어요.');
  }

  // ---------- 확인서 ----------
  async function showCert(u) {
    var q = await db.from('volunteer_hour_confirmations').select('month,confirmed_minutes,confirmed_by_name,confirmed_at').eq('user_id', u.id).order('month');
    var box = $('certbox'); box.textContent = '';
    if (q.error) { U.fail(q.error); return; }
    if (!q.data.length) { box.appendChild(h('div', { class: 'panel noprint', style: 'margin-top:12px' }, h('div', { class: 'hint', text: u.name + ' 님은 아직 임원이 확인한 봉사 시간이 없어요. 임원이 달 단위로 확인하면 확인서를 만들 수 있어요.' }))); box.scrollIntoView(); return; }
    var months = q.data.map(function (x) { return x.month; });
    var from = h('select', { style: 'width:auto' }, months.map(function (m) { return h('option', { value: m, text: monthLabel(m) }); })), to = h('select', { style: 'width:auto' }, months.map(function (m) { return h('option', { value: m, text: monthLabel(m) }); }));
    from.value = months[0]; to.value = months[months.length - 1];
    var out = h('div');
    function draw() {
      out.textContent = '';
      var a = from.value <= to.value ? from.value : to.value, b = from.value <= to.value ? to.value : from.value;
      var rows = q.data.filter(function (x) { return x.month >= a && x.month <= b; }), tot = rows.reduce(function (s, x) { return s + x.confirmed_minutes; }, 0);
      var d0 = monthRange(a)[0], d1 = monthRange(b)[1], t = U.today().split('-');
      out.appendChild(h('div', { class: 'cert' }, h('h2', { text: '봉사활동 확인서' }),
        h('table', null, h('tbody', null,
          h('tr', null, h('th', { text: '성 명' }), h('td', { text: u.name })),
          h('tr', null, h('th', { text: '봉사 기간' }), h('td', { text: U.fmtDate(d0) + ' ~ ' + U.fmtDate(d1) })),
          h('tr', null, h('th', { text: '봉사 장소' }), h('td', { text: '쌍용더플래티넘장항 작은도서관' })),
          h('tr', null, h('th', { text: '봉사 내용' }), h('td', { text: '작은도서관 운영 지원 (근무표에 따른 도서관 운영 봉사)' })))),
        h('table', null, h('thead', null, h('tr', null, h('th', { text: '월' }), h('th', { text: '확인된 봉사 시간' }), h('th', { text: '확인자' }))),
          h('tbody', null, rows.map(function (x) { return h('tr', null, h('td', { text: monthLabel(x.month) }), h('td', { class: 'num', text: hrs(x.confirmed_minutes) }), h('td', { text: x.confirmed_by_name })); }),
            h('tr', null, h('th', { text: '합 계' }), h('td', { class: 'num', style: 'font-weight:700', text: hrs(tot) }), h('td', { text: '' })))),
        h('div', { class: 'msg', text: '위 사람은 위와 같이 자원봉사 활동을 하였음을 확인합니다.' }),
        h('div', { class: 'date', text: t[0] + '년 ' + (+t[1]) + '월 ' + (+t[2]) + '일' }),
        h('div', { class: 'org', text: '쌍용더플래티넘장항 작은도서관 운영위원회' }),
        h('div', { class: 'sig', text: '위원장  ________________  (서명 또는 인)' })));
    }
    from.onchange = to.onchange = draw;
    var panel = h('div', { class: 'panel noprint', style: 'margin-top:12px' }, h('h2', { text: u.name + ' 님 봉사 활동 확인서' }),
      h('div', { class: 'hint', text: '임원이 확인한 달만 들어가요. 기간을 고르고 인쇄(또는 PDF 저장)한 뒤 위원장 서명을 받으세요.' }),
      h('div', { class: 'bar' }, h('span', { text: '기간' }), from, h('span', { text: '~' }), to, h('span', { class: 'sp' }), h('button', { class: 'primary', type: 'button', text: '인쇄 · PDF 저장', onclick: function () { window.print(); } })));
    box.appendChild(panel); box.appendChild(out); draw(); box.scrollIntoView({ behavior: 'smooth' });
  }

  load().then(render).catch(U.fail);
});
