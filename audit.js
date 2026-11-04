// 감사 보고서: 목록 / 작성(예산·지출 불러오기, 지출별 점검, 감사 의견) / 서명하고 제출 / 문서 보기·인쇄
window.whenAuthed.then(function (me) {
  'use strict';
  var db = Auth.client, U = UI, h = U.h, $ = U.$, app = $('app');
  var canWrite = me.can('audit_write'), isAdmin = me.role === 'admin';
  var FEE_PER_PERSON = 5000, FEE_MAX_PER_MONTH = 2;
  var OPINIONS = ['적정', '일부 보완 필요', '부적정'];
  var RESULTS = ['적정', '보완 필요', '부적정'];
  var STATUS = { draft: '작성 중', submitted: '제출됨' };

  // 자원봉사는 인쇄·PDF 저장을 할 수 없어요(회의록과 같은 규칙).
  if (me.isVolunteer) { var nop = document.createElement('style'); nop.textContent = '@media print { body { display: none !important; } }'; document.head.appendChild(nop); }

  function fmtDT(s) { var d = new Date(s); return d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate() + ' ' + U.pad(d.getHours()) + ':' + U.pad(d.getMinutes()); }
  function opClass(o) { return o === '적정' ? 'ok2' : o === '부적정' ? 'bad2' : 'warn2'; }
  function title(r) { return r.fiscal_year + '년 감사 보고서'; }

  // ---------- 이동 ----------
  function nav(search) { history.pushState(null, '', 'audit.html' + (search || '')); route(); window.scrollTo(0, 0); }
  window.addEventListener('popstate', route);
  async function route() {
    U.notice();
    var p = new URLSearchParams(location.search);
    try {
      if (p.has('new')) return showEditor(newDraft());
      var id = p.get('id');
      if (id) return await showReport(id, p.has('edit'));
      return await showList();
    } catch (e) { U.fail(e); }
  }

  // ---------- 목록 ----------
  async function showList() {
    var r = await db.from('audit_reports').select('id,fiscal_year,period_start,period_end,audit_date,opinion,status,created_by_name,submitted_at')
      .order('fiscal_year', { ascending: false }).order('created_at', { ascending: false });
    if (r.error) throw r.error;
    document.title = '감사 보고서 · 작은도서관 운영위원회';
    app.textContent = '';
    app.appendChild(h('div', { class: 'top noprint' },
      h('div', null, h('div', { class: 'mark', text: '작은도서관 운영위원회' }), h('h1', { text: '감사 보고서' })),
      canWrite ? h('button', { class: 'primary', text: '+ 감사 보고서 쓰기', onclick: function () { nav('?new'); } }) : null));
    if (!canWrite) app.appendChild(h('div', { class: 'hint noprint', style: 'margin:-8px 0 12px', text: '감사 보고서는 감사가 작성해요. 다른 위원은 읽기만 할 수 있어요.' }));
    var list = h('div', { class: 'list' });
    if (!r.data.length) list.appendChild(h('div', { class: 'empty', text: '아직 감사 보고서가 없어요.' }));
    r.data.forEach(function (x) {
      var a = h('a', { class: 'rcard', href: 'audit.html?id=' + x.id },
        h('div', { class: 't', text: title(x) }),
        h('div', { class: 's', text: '감사 기간 ' + U.fmtDate(x.period_start) + ' ~ ' + U.fmtDate(x.period_end) + ' · 감사일 ' + U.fmtDate(x.audit_date) + ' · 작성 ' + (x.created_by_name || '') }),
        h('div', { class: 'badges' }, h('span', { class: 'badge ' + (x.status === 'submitted' ? 'ok2' : ''), text: STATUS[x.status] }),
          x.opinion ? h('span', { class: 'badge ' + opClass(x.opinion), text: '감사 의견: ' + x.opinion }) : null));
      a.onclick = function (e) { e.preventDefault(); nav('?id=' + x.id); };
      list.appendChild(a);
    });
    app.appendChild(list);
  }

  // ---------- 새 보고서 ----------
  function newDraft() {
    var y = new Date().getFullYear();
    return { id: null, fiscal_year: y, period_start: y + '-01-01', period_end: U.today(), audit_date: U.today(), place: '', scope: '운영위원회 회계 및 사업 집행 전반',
      observers: '', budget_snapshot: [], expense_snapshot: [], checks: {}, opinion: null, summary: '', recommendations: '', status: 'draft' };
  }

  // ---------- 예산·지출 불러오기 ----------
  async function importData(d) {
    var yr = parseInt(d.fiscal_year, 10);
    var a = await db.from('budget_items').select('*').eq('fiscal_year', yr).order('sort_order');
    if (a.error) throw a.error;
    var b = await db.from('expenses').select('*, expense_receipts(id)').eq('fiscal_year', yr)
      .gte('spent_on', d.period_start).lte('spent_on', d.period_end).order('spent_on');
    if (b.error) throw b.error;
    var mids = b.data.map(function (e) { return e.meeting_id; }).filter(Boolean);
    var mt = {};
    if (mids.length) {
      var m = await db.from('meetings').select('id,seq,kind,meeting_date').in('id', mids);
      if (!m.error) m.data.forEach(function (x) { mt[x.id] = '제' + x.seq + '차 ' + x.kind + ' (' + U.fmtDate(x.meeting_date) + ')'; });
    }
    var itemById = {}; a.data.forEach(function (i) { itemById[i.id] = i; });
    var monthCnt = {};
    b.data.forEach(function (e) { var k = e.item_id + '|' + e.spent_on.slice(0, 7); monthCnt[k] = (monthCnt[k] || 0) + 1; });

    var expenses = b.data.map(function (e) {
      var it = itemById[e.item_id], flags = [];
      if (!e.expense_receipts.length) flags.push('영수증 미첨부');
      if (e.proof === '없음') flags.push('증빙 없음');
      if (it && it.is_meeting_fee) {
        if (!e.no_alcohol_ok) flags.push('주류·개인 용도 아님 확인이 없어요');
        if (e.attendee_count > 0 && Number(e.amount) > e.attendee_count * FEE_PER_PERSON) flags.push('1인 ' + U.won(FEE_PER_PERSON) + ' 한도 초과 (' + e.attendee_count + '명 기준 ' + U.won(e.attendee_count * FEE_PER_PERSON) + ')');
        if (!e.meeting_id) flags.push('회의록이 연결되지 않았어요');
        if (monthCnt[e.item_id + '|' + e.spent_on.slice(0, 7)] > FEE_MAX_PER_MONTH) flags.push('월 ' + FEE_MAX_PER_MONTH + '회 초과');
      }
      return { id: e.id, date: e.spent_on, item: it ? it.name : '(삭제된 항목)', desc: e.description || '', vendor: e.vendor || '', amount: Number(e.amount),
        proof: e.proof, receipts: e.expense_receipts.length, meeting: e.meeting_id ? (mt[e.meeting_id] || '연결됨') : '', attendees: e.attendee_count || 0,
        recorder: e.created_by_name || '', flags: flags };
    });
    var budget = a.data.map(function (i) {
      var spent = expenses.filter(function (e) { return e.item === i.name; }).reduce(function (s, e) { return s + e.amount; }, 0);
      return { name: i.name, source: i.source, planned: Number(i.planned_amount), spent: spent };
    });
    d.budget_snapshot = budget; d.expense_snapshot = expenses;
    var checks = {};
    expenses.forEach(function (e) { checks[e.id] = (d.checks && d.checks[e.id]) || { result: e.flags.length ? '보완 필요' : '적정', note: '' }; });
    d.checks = checks;
    return { items: budget.length, expenses: expenses.length };
  }

  // ---------- 표 (불러온 예산 집행 현황 / 지출 점검) ----------
  function budgetTable(d) {
    var rows = d.budget_snapshot || [];
    if (!rows.length) return h('div', { class: 'hint', text: '(불러온 예산 항목이 없어요)' });
    var tp = 0, ts = 0;
    rows.forEach(function (r) { tp += r.planned; ts += r.spent; });
    return h('div', { class: 'wrapx' }, h('table', { class: 't' },
      h('thead', null, h('tr', null, ['예산 항목', '재원'].map(function (t) { return h('th', { text: t }); }), ['편성액', '집행액', '잔액'].map(function (t) { return h('th', { class: 'num', text: t }); }), h('th', { text: '집행률' }))),
      h('tbody', null, rows.map(function (r) {
        var pct = r.planned > 0 ? Math.round(r.spent / r.planned * 100) : (r.spent > 0 ? 100 : 0), over = r.spent > r.planned;
        return h('tr', null, h('td', { text: r.name }), h('td', { text: r.source }), h('td', { class: 'num', text: U.won(r.planned) }), h('td', { class: 'num', text: U.won(r.spent) }),
          h('td', { class: 'num' + (over ? ' over' : ''), text: U.won(r.planned - r.spent) }), h('td', { text: pct + '%' + (over ? ' (예산 초과)' : '') }));
      })),
      h('tfoot', null, h('tr', null, h('td', { colspan: '2', text: '합계' }), h('td', { class: 'num', text: U.won(tp) }), h('td', { class: 'num', text: U.won(ts) }), h('td', { class: 'num', text: U.won(tp - ts) }), h('td', { text: '' })))));
  }
  function summaryCards(d) {
    var ex = d.expense_snapshot || [], bs = d.budget_snapshot || [];
    var tp = bs.reduce(function (s, r) { return s + r.planned; }, 0), ts = ex.reduce(function (s, e) { return s + e.amount; }, 0);
    var flagged = ex.filter(function (e) { return e.flags.length; }).length;
    function c(n, l) { return h('div', null, h('div', { class: 'n', text: n }), h('div', { class: 'l', text: l })); }
    return h('div', { class: 'sum4' }, c(U.won(tp), '총 편성액'), c(U.won(ts), '총 지출 (' + ex.length + '건)'), c(U.won(tp - ts), '남은 예산'), c(flagged + '건', '자동 점검에서 확인이 필요한 지출'));
  }
  // editable=true: 점검 결과·의견 입력 / false: 글로 표시
  function checkTable(d, editable) {
    var ex = d.expense_snapshot || [];
    if (!ex.length) return h('div', { class: 'hint', text: '(불러온 지출이 없어요)' });
    return h('div', { class: 'wrapx' }, h('table', { class: 't' },
      h('thead', null, h('tr', null, ['날짜', '항목', '내용 · 거래처'].map(function (t) { return h('th', { text: t }); }), h('th', { class: 'num', text: '금액' }),
        ['증빙', '자동 점검', '감사 점검', '감사 의견'].map(function (t) { return h('th', { text: t }); }))),
      h('tbody', null, ex.map(function (e) {
        var ck = d.checks[e.id] || { result: '적정', note: '' };
        var res, note;
        if (editable) {
          var sel = h('select', null, RESULTS.map(function (r) { return h('option', { value: r, text: r }); })); sel.value = ck.result;
          sel.onchange = function () { ck.result = sel.value; d.checks[e.id] = ck; };
          var inp = h('input', { type: 'text', maxlength: '300', placeholder: '의견 (선택)' }); inp.value = ck.note || '';
          inp.oninput = function () { ck.note = inp.value; d.checks[e.id] = ck; };
          res = sel; note = inp;
        } else { res = h('span', { class: ck.result === '적정' ? 'okmark' : 'over', text: ck.result }); note = document.createTextNode(ck.note || ''); }
        return h('tr', null, h('td', { text: U.fmtDate(e.date) }), h('td', { text: e.item }),
          h('td', null, e.desc || '(내용 없음)', e.vendor ? h('div', { class: 'hint', text: e.vendor }) : null, e.meeting ? h('div', { class: 'hint', text: '회의록: ' + e.meeting }) : null),
          h('td', { class: 'num', text: U.won(e.amount) }), h('td', { text: e.proof + (e.receipts ? ' · 영수증 ' + e.receipts + '장' : '') }),
          h('td', null, e.flags.length ? e.flags.map(function (f) { return h('span', { class: 'flag', text: '⚠ ' + f }); }) : h('span', { class: 'okmark', text: '이상 없음' })),
          h('td', null, res), h('td', null, note));
      }))));
  }

  // ---------- 작성 ----------
  function showEditor(d) {
    document.title = (d.id ? '감사 보고서 수정' : '새 감사 보고서') + ' · 작은도서관 운영위원회';
    app.textContent = '';
    function field(label, input, hint) { return h('div', null, h('label', { class: 'l', text: label }), input, hint ? h('div', { class: 'hint', text: hint }) : null); }
    function text(key, type, extra) { var i = h('input', Object.assign({ type: type || 'text' }, extra || {})); i.value = d[key] == null ? '' : d[key]; i.oninput = function () { d[key] = i.value; }; return i; }
    function area(key, rows, ph) { var t = h('textarea', { rows: rows, placeholder: ph || '', style: 'min-height:' + (rows * 24) + 'px' }); t.value = d[key] || ''; t.oninput = function () { d[key] = t.value; }; return t; }

    var dataBox = h('div');
    function renderData() {
      dataBox.textContent = '';
      if (!(d.budget_snapshot.length || d.expense_snapshot.length)) {
        dataBox.appendChild(h('div', { class: 'hint', text: '아직 불러온 내용이 없어요. 위의 "예산·지출 불러오기"를 눌러 주세요.' })); return;
      }
      dataBox.appendChild(summaryCards(d));
      dataBox.appendChild(h('h3', { style: 'margin:14px 0 6px;font-size:16px', text: '예산 집행 현황' }));
      dataBox.appendChild(budgetTable(d));
      dataBox.appendChild(h('h3', { style: 'margin:16px 0 6px;font-size:16px', text: '지출 내역 점검' }));
      dataBox.appendChild(h('div', { class: 'hint', style: 'margin:0 0 6px', text: '"자동 점검"은 영수증, 증빙, 회의운영비 기준(1인 5,000원·월 2회·주류 확인·회의록 연결)으로 미리 확인한 결과예요. 감사 점검 결과는 직접 고를 수 있어요.' }));
      dataBox.appendChild(checkTable(d, true));
    }
    var imp = h('button', { class: 'ghost', type: 'button', text: '예산·지출 불러오기', onclick: async function () {
      if (!d.period_start || !d.period_end || d.period_end < d.period_start) { await sayBox('감사 기간(시작일·종료일)을 확인해 주세요.'); return; }
      if (d.expense_snapshot.length && !(await askBox('이미 불러온 내용을 지금의 예산·지출로 다시 불러올까요? 지출별 점검 결과는 같은 지출이면 그대로 남아요.', '다시 불러오기'))) return;
      imp.disabled = true;
      try { var r = await importData(d); renderData(); U.notice('ok', '예산 항목 ' + r.items + '개, 지출 ' + r.expenses + '건을 불러왔어요.'); } catch (e) { U.fail(e); }
      imp.disabled = false;
    } });

    var opSel = h('select', null, h('option', { value: '', text: '(선택해 주세요)' }), OPINIONS.map(function (o) { return h('option', { value: o, text: o }); }));
    opSel.value = d.opinion || ''; opSel.onchange = function () { d.opinion = opSel.value || null; };

    app.appendChild(h('div', { class: 'top noprint' },
      h('div', null, h('div', { class: 'mark', text: '작은도서관 운영위원회' }), h('h1', { text: d.id ? '감사 보고서 수정' : '새 감사 보고서' })),
      h('button', { class: 'ghost', text: '← 목록', onclick: function () { nav(''); } })));

    app.appendChild(h('div', { class: 'panel' }, h('h2', { text: '1. 감사 개요' }),
      h('div', { class: 'grid3' }, field('회계연도', text('fiscal_year', 'number', { min: '2020', max: '2100' })),
        field('감사 기간 시작', text('period_start', 'date')), field('감사 기간 끝', text('period_end', 'date'))),
      h('div', { class: 'grid3' }, field('감사일', text('audit_date', 'date')), field('장소', text('place', 'text', { maxlength: '100' })),
        field('입회자(선택)', text('observers', 'text', { maxlength: '300', placeholder: '예: 위원장 ○○○, 총무 ○○○' }))),
      field('감사 대상', text('scope', 'text', { maxlength: '300' }))));

    app.appendChild(h('div', { class: 'panel' }, h('h2', { text: '2. 예산 집행 및 지출 점검' }),
      h('div', { class: 'hint', text: '예산·지출 화면에 기록된 내용을 감사 기간에 맞춰 불러와 보고서 안에 저장해요. 제출한 뒤에는 예산이 바뀌어도 보고서는 그대로예요.' }),
      h('div', { class: 'bar', style: 'margin:10px 0' }, imp), dataBox));
    renderData();

    app.appendChild(h('div', { class: 'panel' }, h('h2', { text: '3. 감사 의견' }),
      field('종합 의견', opSel),
      field('감사 내용 (종합)', area('summary', 6, '점검한 내용과 결과를 적어 주세요.')),
      field('시정·권고 사항', area('recommendations', 5, '고쳐야 할 점이나 권고할 내용을 적어 주세요. 없으면 비워 둬도 돼요.'))));

    var saveBtn = h('button', { class: 'ghost', text: '저장' }), subBtn = h('button', { class: 'primary', text: '서명하고 제출' });
    function busy(b) { saveBtn.disabled = subBtn.disabled = b; }
    saveBtn.onclick = function () { save(false); };
    subBtn.onclick = function () { save(true); };
    app.appendChild(h('div', { class: 'bar' },
      d.id ? h('button', { class: 'ghost danger', text: '삭제', onclick: function () { removeReport(d.id); } }) : null,
      h('span', { class: 'sp' }), saveBtn, subBtn));

    function fields() {
      return { fiscal_year: parseInt(d.fiscal_year, 10), period_start: d.period_start, period_end: d.period_end, audit_date: d.audit_date,
        place: (d.place || '').trim(), scope: (d.scope || '').trim(), observers: (d.observers || '').trim(),
        budget_snapshot: d.budget_snapshot, expense_snapshot: d.expense_snapshot, checks: d.checks, opinion: d.opinion || null,
        summary: (d.summary || '').trim(), recommendations: (d.recommendations || '').trim() };
    }
    async function persist(extra) {
      var f = Object.assign(fields(), extra || {});
      if (d.id) { var u = await db.from('audit_reports').update(f).eq('id', d.id); if (u.error) throw u.error; return d.id; }
      var c = await db.from('audit_reports').insert(f).select('id').single(); if (c.error) throw c.error; d.id = c.data.id; return d.id;
    }
    async function save(submit) {
      if (!d.audit_date || !d.period_start || !d.period_end) { U.notice('err', '감사일과 감사 기간을 입력해 주세요.'); return; }
      if (!(parseInt(d.fiscal_year, 10) >= 2020)) { U.notice('err', '회계연도를 입력해 주세요.'); return; }
      if (submit) {
        if (!(d.budget_snapshot.length || d.expense_snapshot.length)) { await sayBox('먼저 "예산·지출 불러오기"로 내용을 불러와 주세요.'); return; }
        if (!d.opinion) { await sayBox('종합 의견(적정 / 일부 보완 필요 / 부적정)을 골라 주세요.'); return; }
        busy(true);
        try { await persist(); } catch (e) { U.fail(e); busy(false); return; }   // 먼저 저장해 두고 서명 단계로
        busy(false);
        openSign(d);
        return;
      }
      U.notice(); busy(true);
      try { var id = await persist(); history.replaceState(null, '', 'audit.html?id=' + id + '&edit'); await route(); U.notice('ok', '저장했어요.'); }
      catch (e) { U.fail(e); busy(false); }
    }
  }

  async function removeReport(id) {
    if (!(await askBox('이 감사 보고서를 삭제할까요? 되돌릴 수 없어요.', '삭제'))) return;
    var r = await db.from('audit_reports').delete().eq('id', id);
    if (r.error) { U.fail(r.error); return; }
    nav(''); U.notice('ok', '삭제했어요.');
  }

  // ---------- 보기 ----------
  async function showReport(id, edit) {
    var r = await db.from('audit_reports').select('*').eq('id', id).maybeSingle();
    if (r.error) throw r.error;
    app.textContent = '';
    if (!r.data) { U.notice('err', '감사 보고서를 찾을 수 없어요.'); app.appendChild(h('button', { class: 'ghost', text: '← 목록', onclick: function () { nav(''); } })); return; }
    var x = r.data, mineOrAdmin = canWrite && (x.created_by === me.id || isAdmin);
    if (edit && x.status === 'draft' && mineOrAdmin) return showEditor(x);
    document.title = title(x) + ' · 작은도서관 운영위원회';

    var acts = h('div', { class: 'bar noprint' }, h('button', { class: 'ghost', text: '← 목록', onclick: function () { nav(''); } }), h('span', { class: 'sp' }));
    if (x.status === 'draft' && mineOrAdmin) acts.appendChild(h('button', { class: 'primary', text: '이어서 쓰기', onclick: function () { nav('?id=' + x.id + '&edit'); } }));
    if (x.status === 'submitted' && isAdmin) acts.appendChild(h('button', { class: 'ghost', text: '작성 중으로 되돌리기', onclick: async function () {
      if (!(await askBox('작성 중으로 되돌리면 감사 서명이 지워지고 다시 서명해 제출해야 해요. 계속할까요?', '되돌리기'))) return;
      var u = await db.from('audit_reports').update({ status: 'draft' }).eq('id', x.id);
      if (u.error) { U.fail(u.error); return; }
      await route(); U.notice('ok', '작성 중으로 되돌렸어요.');
    } }));
    if (!me.isVolunteer) acts.appendChild(h('button', { class: 'ghost', text: '인쇄 · PDF 저장', onclick: function () { window.print(); } }));
    if (isAdmin || (canWrite && x.created_by === me.id && x.status === 'draft')) acts.appendChild(h('button', { class: 'ghost danger', text: '삭제', onclick: function () { removeReport(x.id); } }));

    app.appendChild(h('div', { class: 'top noprint' },
      h('div', null, h('div', { class: 'mark', text: '작은도서관 운영위원회' }), h('h1', { text: title(x) }),
        h('div', { class: 'badges' }, h('span', { class: 'badge ' + (x.status === 'submitted' ? 'ok2' : ''), text: STATUS[x.status] }),
          x.opinion ? h('span', { class: 'badge ' + opClass(x.opinion), text: '감사 의견: ' + x.opinion }) : null))));
    app.appendChild(acts);

    function kv(rows) { return h('table', { class: 'kv' }, h('tbody', null, rows.map(function (rw) { return h('tr', null, h('th', { text: rw[0] }), h('td', { text: rw[1] || '' })); }))); }
    var doc = h('div', { class: 'doc' },
      h('div', { class: 'title' }, '쌍용더플래티넘장항 작은도서관 운영위원회', h('br'), title(x)),
      h('h2', { text: '1. 감사 개요' }),
      kv([['회계연도', x.fiscal_year + '년'], ['감사 기간', U.fmtDate(x.period_start) + ' ~ ' + U.fmtDate(x.period_end)], ['감사일', U.fmtDate(x.audit_date)], ['장소', x.place],
        ['감사 대상', x.scope], ['감사 위원', x.created_by_name + ' (감사)'], ['입회자', x.observers]]),
      h('h2', { text: '2. 예산 집행 현황' }), summaryCards(x), budgetTable(x),
      h('h2', { text: '3. 지출 내역 점검' }), checkTable(x, false),
      h('h2', { text: '4. 감사 의견' }),
      h('div', { style: 'margin-bottom:8px' }, '종합 의견: ', h('strong', { text: x.opinion || '(미정)' })),
      h('div', { class: 'txt', text: x.summary }),
      h('h2', { text: '5. 시정·권고 사항' }), h('div', { class: 'txt', text: x.recommendations || '(없음)' }));
    if (x.status === 'submitted') {
      doc.appendChild(h('div', { class: 'sigbox' }, h('div', { text: fmtDT(x.submitted_at) + ' 제출 · 감사 ' + x.created_by_name + ' (서명)' }), h('img', { src: x.signature, alt: '감사 서명' })));
      doc.appendChild(h('div', { class: 'proof', text: '전자서명은 로그인한 본인 계정으로만 할 수 있고, 제출한 시각과 제출 당시 보고서 내용의 지문(' + (x.content_hash || '').slice(0, 16) + '…)이 함께 기록돼요.' }));
    } else {
      doc.appendChild(h('div', { class: 'hint noprint', style: 'margin-top:14px', text: '아직 제출하지 않은 보고서예요. 감사가 서명하고 제출하면 이 자리에 서명이 들어가요.' }));
    }
    app.appendChild(doc);
  }

  // ---------- 전자서명 ----------
  var pad = $('pad'), pctx = pad.getContext('2d'), signTarget = null, strokes = 0, down = false, lastPt = null;
  function padReset() { pctx.clearRect(0, 0, pad.width, pad.height); pctx.lineWidth = 3; pctx.lineCap = 'round'; pctx.lineJoin = 'round'; pctx.strokeStyle = '#111'; pctx.fillStyle = '#111'; strokes = 0; }
  function pt(e) { var r = pad.getBoundingClientRect(); return { x: (e.clientX - r.left) * pad.width / r.width, y: (e.clientY - r.top) * pad.height / r.height }; }
  pad.addEventListener('pointerdown', function (e) { e.preventDefault(); pad.setPointerCapture(e.pointerId); down = true; lastPt = pt(e); pctx.beginPath(); pctx.arc(lastPt.x, lastPt.y, 1.6, 0, Math.PI * 2); pctx.fill(); strokes++; });
  pad.addEventListener('pointermove', function (e) { if (!down) return; var p = pt(e); pctx.beginPath(); pctx.moveTo(lastPt.x, lastPt.y); pctx.lineTo(p.x, p.y); pctx.stroke(); lastPt = p; strokes++; });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { pad.addEventListener(ev, function () { down = false; }); });
  function openSign(d) { signTarget = d; padReset(); $('sign-agree').checked = false; $('sign-who').textContent = title(d) + ' · 감사 ' + (me.name || ''); $('sign-dlg').showModal(); }
  $('sign-clear').onclick = padReset;
  $('sign-cancel').onclick = function () { $('sign-dlg').close(); if (signTarget && signTarget.id) history.replaceState(null, '', 'audit.html?id=' + signTarget.id + '&edit'); route(); };
  $('sign-ok').onclick = async function () {
    if (strokes < 3) { await sayBox('서명란에 이름을 직접 써 주세요.'); return; }
    if (!$('sign-agree').checked) { await sayBox('확인 문구에 체크해 주세요.'); return; }
    var btn = $('sign-ok'); btn.disabled = true;
    var u = await db.from('audit_reports').update({ status: 'submitted', signature: pad.toDataURL('image/png') }).eq('id', signTarget.id);
    btn.disabled = false;
    if (u.error) { await sayBox(U.friendly(u.error)); return; }
    $('sign-dlg').close();
    history.replaceState(null, '', 'audit.html?id=' + signTarget.id);
    await route(); U.notice('ok', '서명하고 제출했어요. 제출한 보고서는 고칠 수 없어요.');
  };
  padReset();
  route();
});
