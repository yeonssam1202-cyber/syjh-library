// 내 정보: 내 직책·권한, 내 활동 요약(업무·근무·봉사 시간), 비밀번호 변경, 폰 홈 화면에 추가 안내
window.whenAuthed.then(async function (me) {
  'use strict';
  var db = Auth.client, U = UI, h = U.h, $ = U.$, app = $('app');
  var PERMS = [['minutes_write', '회의록 쓰기'], ['expense_write', '지출 기록'], ['budget_edit', '예산 항목 편집'], ['rules_edit', '회칙·세칙 등록'],
    ['shifts_settings', '근무표 설정'], ['docs_upload', '자료실 올리기'], ['tasks_write', '업무 목록 쓰기'], ['minutes_suggest', '회의록 수정 제안'],
    ['shifts_approve', '근무 변경 승인'], ['notice_write', '공지 쓰기'], ['audit_write', '감사 보고서 쓰기'], ['export_basic', '자료 내보내기'], ['meeting_schedule', '회의 일정 등록']];
  function slotMin(slot) { var m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(slot || ''); return m ? Math.max(0, (+m[3] * 60 + +m[4]) - (+m[1] * 60 + +m[2])) : 0; }
  function hours(min) { var h2 = Math.floor(min / 60), m2 = min % 60; return h2 + '시간' + (m2 ? ' ' + m2 + '분' : ''); }
  async function safe(p, fb) { try { var r = await p; return r.error ? fb : r.data; } catch (e) { return fb; } }

  var ym = U.today().slice(0, 7), first = ym + '-01', nextMonth = new Date(+ym.slice(0, 4), +ym.slice(5, 7), 1);
  var last = U.ymd(new Date(nextMonth.getTime() - 86400000));
  var res = await Promise.all([
    safe(db.from('tasks').select('id,title,status,due_date,task_assignees(user_id,role)').neq('status', 'done').limit(200), []),
    safe(db.from('shifts').select('shift_date,slot').eq('user_id', me.id).gte('shift_date', first).lte('shift_date', last).order('shift_date'), []),
    safe(db.from('volunteer_hour_confirmations').select('month,confirmed_minutes').eq('user_id', me.id).eq('month', ym), [])
  ]);
  var tasks = res[0].filter(function (t) { return t.task_assignees.some(function (a) { return a.user_id === me.id; }); });
  var shifts = res[1], conf = res[2][0];
  var today = U.today(), doneMin = shifts.filter(function (s) { return s.shift_date <= today; }).reduce(function (s, x) { return s + slotMin(x.slot); }, 0);

  app.appendChild(h('div', { class: 'top noprint' }, h('div', null, h('div', { class: 'mark', text: '작은도서관 운영위원회' }), h('h1', { text: '내 정보' }))));

  // ----- 내 정보 + 권한 -----
  var allowed = PERMS.filter(function (p) { return me.can(p[0]); });
  var info = h('div', { class: 'panel' }, h('h2', { text: '내 계정' }),
    h('dl', { class: 'kv' },
      h('dt', { text: '이름' }), h('dd', { text: me.name || '(이름 없음)' }),
      h('dt', { text: '이메일' }), h('dd', { text: me.email || '' }),
      h('dt', { text: '직책' }), h('dd', { text: (me.position || '') + (me.role === 'admin' ? ' · 관리자' : '') }),
      h('dt', { text: '할 수 있는 일' }), h('dd', null,
        me.role === 'admin' ? h('div', { class: 'small', text: '관리자는 모든 기능을 쓸 수 있어요.' }) : null,
        h('div', { class: 'permlist' }, allowed.length ? allowed.map(function (p) { return h('span', { class: 'badge gold', text: p[1] }); }) : h('span', { class: 'small', text: '글 읽기와 본인 근무 신청 등 기본 기능만 쓸 수 있어요.' })),
        h('div', { class: 'small', style: 'margin-top:6px', text: '직책별 권한은 관리자가 회원 승인 화면에서 정해요.' }))));

  // ----- 내 활동 요약 -----
  var act = h('div', { class: 'panel' }, h('h2', { text: '내 활동 요약' }),
    h('dl', { class: 'kv' },
      h('dt', { text: '맡은 업무' }), h('dd', { text: tasks.length ? tasks.length + '건 진행 중 (' + tasks.filter(function (t) { return t.task_assignees.some(function (a) { return a.user_id === me.id && a.role === 'main'; }); }).length + '건은 메인 담당)' : '진행 중인 업무가 없어요' }),
      h('dt', { text: '이번 달 근무' }), h('dd', { text: shifts.length ? shifts.length + '회 · 지난 근무 ' + hours(doneMin) + (conf ? ' · 확인된 봉사 시간 ' + hours(conf.confirmed_minutes) : '') : '이번 달 근무가 없어요' })),
    h('div', { class: 'bar', style: 'margin:10px 0 0' }, h('a', { href: 'tasks.html', class: 'linkbtn', text: '업무 목록 ›' }), h('a', { href: 'shifts.html', class: 'linkbtn', text: '근무표 ›' }),
      (me.isVolunteer || me.can('shifts_approve')) ? h('a', { href: 'volunteer.html', class: 'linkbtn', text: '봉사 시간·확인서 ›' }) : null));

  // ----- 비밀번호 변경 -----
  var pw0 = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': '현재 비밀번호' }), pw1 = h('input', { type: 'password', autocomplete: 'new-password', 'aria-label': '새 비밀번호' }), pw2 = h('input', { type: 'password', autocomplete: 'new-password', 'aria-label': '새 비밀번호 확인' });
  var pbtn = h('button', { class: 'primary', type: 'submit', text: '비밀번호 바꾸기' });
  var pform = h('form', { class: 'panel' }, h('h2', { text: '비밀번호 변경' }),
    h('label', { class: 'l', text: '현재 비밀번호' }), pw0, h('label', { class: 'l', text: '새 비밀번호 (8자 이상)' }), pw1, h('label', { class: 'l', text: '새 비밀번호 한 번 더' }), pw2,
    h('div', { class: 'bar' }, pbtn));
  pform.onsubmit = async function (e) {
    e.preventDefault(); U.notice();
    if (!pw0.value) { await sayBox('현재 비밀번호를 입력해 주세요.'); return; }
    if (pw1.value.length < 8) { await sayBox('새 비밀번호는 8자 이상으로 해 주세요.'); return; }
    if (pw1.value !== pw2.value) { await sayBox('새 비밀번호 두 칸이 서로 달라요.'); return; }
    if (pw1.value === pw0.value) { await sayBox('현재 비밀번호와 다른 비밀번호로 정해 주세요.'); return; }
    pbtn.disabled = true;
    var chk = await db.auth.signInWithPassword({ email: me.email, password: pw0.value });   // 본인 확인
    if (chk.error) { pbtn.disabled = false; await sayBox('현재 비밀번호가 맞지 않아요.'); return; }
    var r = await db.auth.updateUser({ password: pw1.value });
    pbtn.disabled = false;
    if (r.error) { await sayBox('바꾸지 못했어요: ' + r.error.message); return; }
    pw0.value = pw1.value = pw2.value = '';
    U.notice('ok', '비밀번호를 바꿨어요. 다음 로그인부터 새 비밀번호를 쓰세요.');
  };

  // ----- 홈 화면에 추가 -----
  var ua = navigator.userAgent || '';
  var install = h('div', { class: 'panel' }, h('h2', { text: '폰 홈 화면에 추가 (앱처럼 쓰기)' }),
    h('div', { class: 'small', text: '홈 화면에 아이콘을 추가하면 앱처럼 한 번에 열 수 있어요. 별도 설치나 가입은 필요 없어요.' }),
    h('div', { style: 'margin-top:10px;font-weight:600', text: '아이폰 (사파리)' }),
    h('ol', { class: 'steps' }, h('li', { text: '사파리로 이 사이트를 열어요 (크롬이 아니라 사파리예요).' }), h('li', { text: '아래쪽의 공유 버튼(네모에 화살표)을 눌러요.' }), h('li', { text: '"홈 화면에 추가"를 누르고 오른쪽 위 "추가"를 눌러요.' })),
    h('div', { style: 'margin-top:10px;font-weight:600', text: '안드로이드 (크롬)' }),
    h('ol', { class: 'steps' }, h('li', { text: '크롬으로 이 사이트를 열어요.' }), h('li', { text: '오른쪽 위 점 세 개(⋮) 메뉴를 눌러요.' }), h('li', { text: '"홈 화면에 추가" 또는 "앱 설치"를 눌러요.' })),
    h('div', { class: 'small', style: 'margin-top:8px', text: /iPhone|iPad/.test(ua) ? '지금 아이폰으로 보고 계시네요. 위의 "아이폰" 순서를 따라 하세요.' : /Android/.test(ua) ? '지금 안드로이드로 보고 계시네요. 위의 "안드로이드" 순서를 따라 하세요.' : '폰에서 이 주소를 열어서 위 순서를 따라 하세요.' }));

  app.appendChild(h('div', { class: 'cols2' }, h('div', null, info, act), h('div', null, pform, install)));
});
