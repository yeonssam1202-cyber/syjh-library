// 내보내기: 엑셀(.xlsx)로 받기 + (관리자) 위원 명단·전체 백업(JSON)
window.whenAuthed.then(function (me) {
  'use strict';
  var db = Auth.client, U = UI, h = U.h, $ = U.$, app = $('app');
  var isAdmin = me.role === 'admin', canBasic = me.can('export_basic');
  var STAMP = U.today().replace(/-/g, '');

  app.appendChild(h('div', { class: 'top noprint' }, h('div', null, h('div', { class: 'mark', text: '작은도서관 운영위원회' }), h('h1', { text: '내보내기' }))));
  if (!canBasic && !isAdmin) { app.appendChild(h('div', { class: 'empty', text: '내보내기는 임원과 관리자만 쓸 수 있어요.' })); return; }
  app.appendChild(h('div', { class: 'note', text: '내려받은 파일에는 위원 이름과 금액 등이 들어 있어요. 안전한 곳에 보관하고, 메신저나 공개 장소에 올리지 마세요.' }));

  // ---------- 도우미 ----------
  async function all(table, build) {
    var out = [], from = 0, step = 1000;
    for (;;) {
      var q = build ? build(db.from(table).select('*')) : db.from(table).select('*');
      var r = await q.range(from, from + step - 1);
      if (r.error) throw r.error;
      out = out.concat(r.data);
      if (r.data.length < step) break;
      from += step;
    }
    return out;
  }
  function save(sheets, filename) {
    var wb = XLSX.utils.book_new();
    sheets.forEach(function (s) {
      var rows = s.rows.length ? s.rows : [Object.fromEntries(s.cols.map(function (c) { return [c, '']; }))];
      var ws = XLSX.utils.json_to_sheet(rows, { header: s.cols });
      ws['!cols'] = s.cols.map(function (c) { var w = Math.max(c.length * 2, 10); rows.slice(0, 50).forEach(function (r) { w = Math.max(w, Math.min(40, String(r[c] == null ? '' : r[c]).length * 1.6)); }); return { wch: w }; });
      XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
    });
    XLSX.writeFile(wb, filename);
  }
  function slotMin(slot) { var m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(slot || ''); return m ? Math.max(0, (+m[3] * 60 + +m[4]) - (+m[1] * 60 + +m[2])) : 0; }
  function t(v) { return v == null ? '' : String(v); }
  async function run(btn, fn) {
    btn.disabled = true; var old = btn.textContent; btn.textContent = '준비 중…'; U.notice();
    try { var msg = await fn(); U.notice('ok', msg || '파일을 내려받았어요.'); } catch (e) { U.fail(e); }
    btn.disabled = false; btn.textContent = old;
  }
  function card(title, desc, opts, label, fn, adm) {
    var b = h('button', { class: 'primary', type: 'button', text: label });
    b.onclick = function () { run(b, fn); };
    return h('div', { class: 'ex' + (adm ? ' adm' : '') }, h('h3', { text: title }), h('div', { class: 'd', text: desc }), opts ? h('div', { class: 'opts' }, opts) : null, b);
  }

  var year = h('input', { type: 'number', min: '2020', max: '2100', value: String(new Date().getFullYear()), style: 'width:100px' });
  var d1 = h('input', { type: 'date' }), d2 = h('input', { type: 'date' });
  d1.value = U.today().slice(0, 7) + '-01'; d2.value = U.today();

  var cards = [];
  // ----- 임원·관리자 -----
  cards.push(card('예산 · 지출 내역', '예산 항목별 집행 현황과 지출 내역(증빙 종류, 영수증 수 포함)을 엑셀 두 장으로 받아요.', [h('span', { text: '회계연도' }), year], '엑셀 받기', async function () {
    var y = parseInt(year.value, 10);
    var items = await all('budget_items', function (q) { return q.eq('fiscal_year', y).order('sort_order'); });
    var exps = await all('expenses', function (q) { return q.select('*, expense_receipts(id)').eq('fiscal_year', y).order('spent_on'); });
    var by = {}; items.forEach(function (i) { by[i.id] = i; });
    var spent = {}; exps.forEach(function (e) { spent[e.item_id] = (spent[e.item_id] || 0) + Number(e.amount); });
    save([
      { name: '예산 항목', cols: ['예산 항목', '재원', '편성액', '집행액', '잔액', '집행률(%)'], rows: items.map(function (i) { var s = spent[i.id] || 0, p = Number(i.planned_amount); return { '예산 항목': i.name, '재원': i.source, '편성액': p, '집행액': s, '잔액': p - s, '집행률(%)': p ? Math.round(s / p * 100) : 0 }; }) },
      { name: '지출 내역', cols: ['날짜', '예산 항목', '내용', '거래처', '금액', '증빙', '영수증 수', '참석 인원', '기록자'], rows: exps.map(function (e) { return { '날짜': e.spent_on, '예산 항목': by[e.item_id] ? by[e.item_id].name : '', '내용': e.description, '거래처': e.vendor, '금액': Number(e.amount), '증빙': e.proof, '영수증 수': e.expense_receipts.length, '참석 인원': e.attendee_count || '', '기록자': e.created_by_name }; }) }
    ], '예산지출_' + y + '_' + STAMP + '.xlsx');
  }));

  cards.push(card('근무표 · 봉사 시간', '기간 안의 근무 목록과 사람별 시간 합계(확인된 봉사 시간 포함)를 받아요.', [d1, h('span', { text: '~' }), d2], '엑셀 받기', async function () {
    var a = d1.value, b = d2.value; if (!a || !b || b < a) throw new Error('기간을 확인해 주세요.');
    var sh = await all('shifts', function (q) { return q.gte('shift_date', a).lte('shift_date', b).order('shift_date'); });
    var months = {}; for (var d = new Date(a + 'T00:00:00'); d <= new Date(b + 'T00:00:00'); d.setDate(d.getDate() + 25)) months[U.ymd(d).slice(0, 7)] = 1; months[b.slice(0, 7)] = 1;
    var conf = []; try { conf = await all('volunteer_hour_confirmations'); } catch (e) { conf = []; }
    var pf = await all('profiles'), nmap = {}; pf.forEach(function (p) { nmap[p.id] = p.name || p.email; });
    var per = {}; sh.forEach(function (s) { var k = s.name; per[k] = per[k] || { n: 0, min: 0 }; per[k].n++; per[k].min += slotMin(s.slot); });
    save([
      { name: '근무', cols: ['날짜', '시간대', '이름', '메모'], rows: sh.map(function (s) { return { '날짜': s.shift_date, '시간대': s.slot, '이름': s.name, '메모': s.note }; }) },
      { name: '사람별 합계', cols: ['이름', '근무 횟수', '근무 시간(시간)'], rows: Object.keys(per).sort().map(function (k) { return { '이름': k, '근무 횟수': per[k].n, '근무 시간(시간)': Math.round(per[k].min / 6) / 10 }; }) },
      { name: '확인된 봉사 시간', cols: ['월', '이름', '자동 집계(분)', '확인(분)', '조정 사유', '확인자'], rows: conf.filter(function (c) { return months[c.month]; }).map(function (c) { return { '월': c.month, '이름': nmap[c.user_id] || '', '자동 집계(분)': c.auto_minutes, '확인(분)': c.confirmed_minutes, '조정 사유': c.note, '확인자': c.confirmed_by_name }; }) }
    ], '근무표_' + a + '_' + b + '.xlsx');
  }));

  cards.push(card('회의록 목록', '회의 일시, 상태, 참석 현황, 회의 내용·결과와 참석자 명단(서명 여부)을 받아요.', null, '엑셀 받기', async function () {
    var ms = await all('meetings', function (q) { return q.order('meeting_date'); });
    var at = await all('meeting_attendees'); var sg = await all('meeting_signatures', function (q) { return q.select('attendee_id'); });
    var signed = {}; sg.forEach(function (s) { signed[s.attendee_id] = 1; });
    var mt = {}; ms.forEach(function (m) { mt[m.id] = m; });
    var ST = { draft: '작성 중', signing: '서명 받는 중', closed: '마감' };
    save([
      { name: '회의록', cols: ['차수', '구분', '날짜', '시작', '종료', '장소', '상태', '재적', '참석', '안건', '회의 내용', '회의 결과', '작성자'], rows: ms.map(function (m) { var a = at.filter(function (x) { return x.meeting_id === m.id; }); return { '차수': m.seq, '구분': m.kind, '날짜': m.meeting_date, '시작': t(m.start_time).slice(0, 5), '종료': t(m.end_time).slice(0, 5), '장소': m.place, '상태': ST[m.status], '재적': a.length, '참석': a.filter(function (x) { return x.attended; }).length, '안건': m.agenda, '회의 내용': m.summary, '회의 결과': m.result, '작성자': m.author_name }; }) },
      { name: '참석자', cols: ['차수', '날짜', '직급', '이름', '참석', '서명'], rows: at.filter(function (x) { return mt[x.meeting_id]; }).sort(function (a, b) { return mt[a.meeting_id].meeting_date < mt[b.meeting_id].meeting_date ? -1 : 1; }).map(function (x) { return { '차수': mt[x.meeting_id].seq, '날짜': mt[x.meeting_id].meeting_date, '직급': x.position, '이름': x.name, '참석': x.attended ? '참석' : '불참', '서명': x.attended ? (signed[x.id] ? '서명함' : '') : '' }; }) }
    ], '회의록_' + STAMP + '.xlsx');
  }));

  cards.push(card('공지 · 업무 목록', '공지 전체와 업무 목록(상태, 마감일, 메인·보조 담당자)을 엑셀 두 장으로 받아요.', null, '엑셀 받기', async function () {
    var ns = await all('notices', function (q) { return q.order('created_at'); });
    var ts = await all('tasks', function (q) { return q.select('*, task_assignees(user_id,role)').order('created_at'); });
    var pr = await all('profiles'); var nm = {}; pr.forEach(function (p) { nm[p.id] = p.name || p.email; });
    var ST = { todo: '할 일', doing: '진행 중', done: '완료' };
    save([
      { name: '공지', cols: ['작성일', '제목', '작성자', '고정', '내용'], rows: ns.map(function (n) { return { '작성일': n.created_at.slice(0, 10), '제목': n.title, '작성자': n.created_by_name, '고정': n.pinned ? '고정' : '', '내용': n.body }; }) },
      { name: '업무 목록', cols: ['업무', '상태', '마감일', '메인 담당', '보조 담당', '설명', '등록자'], rows: ts.map(function (x) { return { '업무': x.title, '상태': ST[x.status] || x.status, '마감일': x.due_date || '', '메인 담당': x.task_assignees.filter(function (a) { return a.role === 'main'; }).map(function (a) { return nm[a.user_id] || ''; }).join(', '), '보조 담당': x.task_assignees.filter(function (a) { return a.role !== 'main'; }).map(function (a) { return nm[a.user_id] || ''; }).join(', '), '설명': x.description, '등록자': nm[x.created_by] || '' }; }) }
    ], '공지_업무_' + STAMP + '.xlsx');
  }));

  // ----- 관리자 전용 -----
  if (isAdmin) {
    cards.push(card('위원 명단 (관리자 전용)', '이름, 이메일, 직책, 권한, 상태, 가입일이 들어 있어요. 개인정보이니 조심해서 다뤄 주세요.', null, '엑셀 받기', async function () {
      var pr = await all('profiles', function (q) { return q.order('created_at'); });
      var ST = { approved: '승인됨', pending: '승인 대기', rejected: '거절됨' };
      save([{ name: '위원 명단', cols: ['이름', '이메일', '직책', '관리자', '근무 담당', '상태', '가입일'], rows: pr.map(function (p) { return { '이름': p.name, '이메일': p.email, '직책': p.position || '', '관리자': p.role === 'admin' ? '관리자' : '', '근무 담당': p.shift_manager ? '담당' : '', '상태': ST[p.status] || p.status, '가입일': (p.created_at || '').slice(0, 10) }; }) }], '위원명단_' + STAMP + '.xlsx');
    }, true));

    cards.push(card('전체 백업 (관리자 전용)', '모든 기록(위원, 회의록과 서명, 예산·지출, 근무, 공지, 감사 보고서 등)을 JSON 파일 하나로 받아요. Supabase 무료 플랜이 멈추거나 문제가 생겼을 때를 대비해 달마다 한 번씩 받아 두세요.', null, '백업 파일 받기', async function () {
      var TABLES = ['profiles', 'role_permissions', 'tasks', 'task_assignees', 'documents', 'meetings', 'meeting_attendees', 'meeting_signatures', 'meeting_photos', 'meeting_reviews', 'meeting_suggestions', 'meeting_changes',
        'meeting_events', 'meeting_rsvps', 'rule_versions', 'budget_items', 'expenses', 'expense_receipts', 'shift_settings', 'shifts', 'shift_change_requests', 'shift_history', 'volunteer_hour_confirmations',
        'notices', 'notice_reads', 'audit_reports'];
      var out = { _info: { 만든날: new Date().toISOString(), 설명: '작은도서관 운영위원회 업무공간 전체 백업(표 내용만, 영수증·사진·자료실 파일은 포함되지 않음)' } }, skipped = [];
      for (var i = 0; i < TABLES.length; i++) { try { out[TABLES[i]] = await all(TABLES[i]); } catch (e) { skipped.push(TABLES[i]); } }
      var blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '백업_' + STAMP + '.json'; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      var rows = Object.keys(out).filter(function (k) { return k !== '_info'; }).reduce(function (s, k) { return s + out[k].length; }, 0);
      return '백업 파일을 내려받았어요 (' + rows + '건' + (skipped.length ? ', 아직 없는 표 ' + skipped.length + '개는 건너뜀' : '') + '). 영수증·사진·자료실 파일은 Supabase 보관함에서 따로 받아야 해요.';
    }, true));
  }
  app.appendChild(h('div', { class: 'grid' }, cards));
});
