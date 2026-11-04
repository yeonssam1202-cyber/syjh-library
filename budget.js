// 예산·지출: 회계연도별 예산 항목 / 집행 막대 / 지출 내역 / 지출 기록(영수증) / 예산 항목 편집
window.whenAuthed.then(function (me) {
  'use strict';
  var db = Auth.client, U = UI, h = U.h, $ = U.$, app = $('app');
  var isAdmin = me.role === 'admin';
  var BUCKET = 'receipts', FEE_PER_PERSON = 5000, FEE_MAX_PER_MONTH = 2;
  var SOURCES = ['공동체 활성화 지원비', '외부 지원금', '기타'];
  var DEFAULT_ITEMS = [['도서 구입비', false], ['도서관 물품비', false], ['홍보 및 개관비', false], ['공모전·행사비', false], ['회의운영비(회의비·다과비)', true]];
  var year = new Date().getFullYear(), items = [], expenses = [], urls = {}, meetings = null;

  function itemName(id) { var i = items.filter(function (x) { return x.id === id; })[0]; return i ? i.name : '(삭제된 항목)'; }
  function canEdit(e) { return isAdmin || e.created_by === me.id; }
  function isPdf(path) { return /\.pdf$/i.test(path); }

  // ---------- 데이터 ----------
  async function signed(list) {
    var paths = [], map = {};
    list.forEach(function (e) { e.expense_receipts.forEach(function (r) { paths.push(r.path); }); });
    if (!paths.length) return map;
    var r = await db.storage.from(BUCKET).createSignedUrls(paths, 900);
    if (r.data) r.data.forEach(function (x) { if (x.signedUrl) map[x.path] = x.signedUrl; });
    return map;
  }
  async function load() {
    var a = await db.from('budget_items').select('*').eq('fiscal_year', year).order('sort_order');
    if (a.error) throw a.error;
    var b = await db.from('expenses').select('*, expense_receipts(id,path)').eq('fiscal_year', year).order('spent_on', { ascending: false });
    if (b.error) throw b.error;
    items = a.data; expenses = b.data; urls = await signed(expenses);
  }
  async function reload() { try { await load(); render(); } catch (e) { U.fail(e); } }

  // ---------- 화면 ----------
  function sumBy(itemId) { return expenses.filter(function (e) { return e.item_id === itemId; }).reduce(function (s, e) { return s + Number(e.amount); }, 0); }
  function monthCount(itemId, ym, exceptId) {
    return expenses.filter(function (e) { return e.item_id === itemId && e.spent_on.slice(0, 7) === ym && e.id !== exceptId; }).length;
  }

  function thumbs(e) {
    if (!e.expense_receipts.length) return h('span', { class: 'badge warn', text: '미첨부' });
    var box = h('div', { class: 'thumbs' });
    e.expense_receipts.forEach(function (r) {
      var u = urls[r.path];
      if (!u) { box.appendChild(h('span', { class: 'badge ok', text: '첨부됨' })); return; }
      box.appendChild(h('a', { href: u, target: '_blank', rel: 'noopener', title: '영수증 열기' },
        isPdf(r.path) ? h('span', { class: 'pdf', text: 'PDF' }) : h('img', { src: u, alt: '영수증' })));
    });
    return box;
  }

  function render() {
    app.textContent = '';
    var totalPlanned = items.reduce(function (s, i) { return s + Number(i.planned_amount); }, 0);
    var totalSpent = expenses.reduce(function (s, e) { return s + Number(e.amount); }, 0);
    var missing = expenses.filter(function (e) { return !e.expense_receipts.length; }).length;

    app.appendChild(h('div', { class: 'top noprint' },
      h('div', null, h('div', { class: 'mark', text: '작은도서관 운영위원회' }), h('h1', { text: '예산·지출' })),
      h('div', { class: 'bar', style: 'margin:0' },
        h('div', { class: 'yearbar' },
          h('button', { class: 'ghost', 'aria-label': '이전 해', text: '‹', onclick: function () { year--; reload(); } }),
          h('span', { class: 'y', text: year + ' 회계연도' }),
          h('button', { class: 'ghost', 'aria-label': '다음 해', text: '›', onclick: function () { year++; reload(); } })),
        h('button', { class: 'primary', text: '+ 지출 기록', onclick: function () { openExp(null); } }),
        isAdmin ? h('button', { class: 'ghost', text: '예산 항목 편집', onclick: openItems }) : null)));

    app.appendChild(h('div', { class: 'note noprint', text: '회계연도는 1월 1일~12월 31일이고, 쓰고 남은 지원금은 다음 해로 넘길 수 없어요. 공사·공용비품(서가·탁자·PC 등)은 관리주체가 집행하니 여기에 기록하지 않아요.' }));

    app.appendChild(h('div', { class: 'cards statgrid', style: 'margin-bottom:14px' },
      stat('총 편성', U.won(totalPlanned)), stat('총 지출', U.won(totalSpent)),
      stat('남은 예산', U.won(totalPlanned - totalSpent), totalPlanned - totalSpent < 0),
      stat('증빙 미첨부', missing + '건', missing > 0)));

    // 항목별 집행
    var ip = h('div', { class: 'panel' }, h('h2', { text: '항목별 집행' }));
    if (!items.length) {
      ip.appendChild(h('div', { class: 'hint', text: isAdmin ? '아직 예산 항목이 없어요. "예산 항목 편집"에서 기본 항목을 넣어 주세요.' : '아직 예산 항목이 없어요. 관리자가 만들면 여기에 나와요.' }));
    }
    var nowYm = U.today().slice(0, 7);
    items.forEach(function (it) {
      var spent = sumBy(it.id), planned = Number(it.planned_amount), pct = planned > 0 ? Math.round(spent / planned * 100) : (spent > 0 ? 100 : 0);
      var over = spent > planned;
      var row = h('div', { class: 'item' },
        h('div', { class: 'row1' },
          h('div', null, h('span', { class: 'nm', text: it.name }), h('span', { class: 'src', text: it.source })),
          h('div', { class: 'amt' }, U.won(spent) + ' / ' + U.won(planned) + ' (' + pct + '%) ', over ? h('span', { class: 'badge warn', text: '승인 예산 초과' }) : null)),
        h('div', { class: 'track', role: 'img', 'aria-label': it.name + ' 집행률 ' + pct + '%' }, h('div', { class: 'fill' + (over ? ' over' : ''), style: 'width:' + Math.min(100, pct) + '%' })));
      if (it.is_meeting_fee && year === new Date().getFullYear()) {
        var n = monthCount(it.id, nowYm);
        row.appendChild(h('div', { class: 'hint' }, '회의비·다과비는 한 달 ' + FEE_MAX_PER_MONTH + '회 이내, 참석자 1인당 ' + U.won(FEE_PER_PERSON) + ' 이내예요. 이번 달 ' + n + '회 ',
          n > FEE_MAX_PER_MONTH ? h('span', { class: 'badge warn', text: '월 횟수 초과' }) : null));
      }
      ip.appendChild(row);
    });
    app.appendChild(ip);

    // 지출 내역
    var ep = h('div', { class: 'panel' }, h('h2', { text: '지출 내역' }));
    if (!expenses.length) ep.appendChild(h('div', { class: 'empty', text: '아직 지출 기록이 없어요. "+ 지출 기록"으로 남겨 주세요.' }));
    else {
      var table = h('table', { class: 'exp' },
        h('thead', null, h('tr', null, ['날짜', '항목', '내용', '거래처'].map(function (t) { return h('th', { text: t }); }),
          h('th', { class: 'num', text: '금액' }), h('th', { text: '증빙' }), h('th', { text: '영수증' }), h('th', { text: '기록' }), h('th', { text: '' }))),
        h('tbody', null, expenses.map(function (e) {
          return h('tr', null, h('td', { text: U.fmtDate(e.spent_on) }), h('td', { text: itemName(e.item_id) }), h('td', { text: e.description }), h('td', { text: e.vendor }),
            h('td', { class: 'num', text: U.won(e.amount) }), h('td', { text: e.proof }), h('td', null, thumbs(e)), h('td', { text: e.created_by_name }),
            h('td', null, canEdit(e) ? h('button', { class: 'ghost', text: '편집', onclick: function () { openExp(e); } }) : null));
        })));
      ep.appendChild(table);
      var cards = h('div', { class: 'cards-m' });
      expenses.forEach(function (e) {
        cards.appendChild(h('div', { class: 'ecard' },
          h('div', { class: 't' }, h('span', { text: itemName(e.item_id) }), h('span', { text: U.won(e.amount) })),
          h('div', { class: 's', text: U.fmtDate(e.spent_on) + (e.vendor ? ' · ' + e.vendor : '') + ' · ' + e.proof }),
          e.description ? h('div', { text: e.description }) : null,
          h('div', { class: 'bar', style: 'margin:6px 0 0' }, thumbs(e), h('span', { class: 'sp' }), canEdit(e) ? h('button', { class: 'ghost', text: '편집', onclick: function () { openExp(e); } }) : null)));
      });
      ep.appendChild(cards);
    }
    app.appendChild(ep);
  }
  function stat(t, n, bad) { return h('div', { class: 'stat' + (bad ? ' bad' : '') }, h('div', { class: 'n', text: n }), h('div', { class: 't', text: t })); }

  // ---------- 지출 기록 ----------
  var dlg = $('exp-dlg'), editing = null, pending = [], existing = [];
  async function loadMeetings() {
    if (meetings) return meetings;
    var r = await db.from('meetings').select('id,seq,kind,meeting_date,meeting_attendees(attended)').order('meeting_date', { ascending: false });
    meetings = r.error ? [] : r.data;
    return meetings;
  }
  function selItem() { return items.filter(function (i) { return i.id === $('e-item').value; })[0]; }
  function selMeeting() { var id = $('e-meeting').value; return (meetings || []).filter(function (m) { return m.id === id; })[0]; }

  function refreshLimit() {
    var it = selItem(), box = $('e-limit');
    box.textContent = '';
    $('e-meeting-box').style.display = it && it.is_meeting_fee ? 'block' : 'none';
    if (!it || !it.is_meeting_fee) return;
    var m = selMeeting(), amount = parseInt($('e-amount').value, 10) || 0;
    if (m) {
      var n = m.meeting_attendees.filter(function (a) { return a.attended; }).length, limit = n * FEE_PER_PERSON;
      box.appendChild(h('div', { class: 'infobox', text: '참석 ' + n + '명 × ' + U.won(FEE_PER_PERSON) + ' = ' + U.won(limit) + ' 한도' }));
      if (amount > limit) box.appendChild(h('div', { class: 'warnbox', text: '한도를 ' + U.won(amount - limit) + ' 넘었어요. 세칙 기준을 확인해 주세요.' }));
    } else {
      box.appendChild(h('div', { class: 'infobox', text: '회의록을 연결하면 참석 인원으로 한도를 계산해 줘요.' }));
    }
    var ym = ($('e-date').value || '').slice(0, 7);
    if (ym) {
      var c = monthCount(it.id, ym, editing && editing.id);
      if (c >= FEE_MAX_PER_MONTH) box.appendChild(h('div', { class: 'warnbox', text: '이 달에 이미 ' + c + '회 기록돼 있어요. 회의비·다과비는 월 ' + FEE_MAX_PER_MONTH + '회 이내예요.' }));
    }
  }
  function renderFiles() {
    var list = $('e-filelist'); list.textContent = '';
    existing.forEach(function (r) {
      list.appendChild(h('div', { class: 'f' }, h('span', { text: (isPdf(r.path) ? 'PDF' : '사진') + ' · 올려둔 영수증' }),
        h('button', { class: 'linkbtn danger', type: 'button', text: '삭제', onclick: async function () {
          if (!(await askBox('이 영수증을 삭제할까요?', '삭제'))) return;
          await db.storage.from(BUCKET).remove([r.path]);
          var d = await db.from('expense_receipts').delete().eq('id', r.id);
          if (d.error) { U.fail(d.error); return; }
          existing = existing.filter(function (x) { return x.id !== r.id; }); renderFiles();
        } })));
    });
    pending.forEach(function (f, i) {
      list.appendChild(h('div', { class: 'f' }, h('span', { text: f.name }), h('button', { class: 'linkbtn', type: 'button', text: '빼기', onclick: function () { pending.splice(i, 1); renderFiles(); } })));
    });
  }

  async function openExp(e) {
    if (!items.length) { U.notice('err', '먼저 예산 항목이 있어야 해요. ' + (isAdmin ? '"예산 항목 편집"에서 만들어 주세요.' : '관리자에게 예산 항목 만들기를 요청해 주세요.')); return; }
    editing = e || null; pending = []; existing = e ? e.expense_receipts.slice() : [];
    $('exp-title').textContent = e ? '지출 편집' : '지출 기록';
    var sel = $('e-item'); sel.textContent = '';
    items.forEach(function (i) { sel.appendChild(h('option', { value: i.id, text: i.name })); });
    var def = U.today(); if (def.slice(0, 4) !== String(year)) def = year + '-01-01';
    $('e-date').value = e ? e.spent_on : def;
    sel.value = e ? e.item_id : items[0].id;
    $('e-desc').value = e ? e.description : ''; $('e-vendor').value = e ? e.vendor : '';
    $('e-amount').value = e ? e.amount : ''; $('e-proof').value = e ? e.proof : ''; $('e-note').value = e ? e.note : '';
    $('e-alc').checked = e ? e.no_alcohol_ok : false; $('e-files').value = '';
    $('e-del').style.display = e && canEdit(e) ? '' : 'none';
    var ms = await loadMeetings(), mSel = $('e-meeting'); mSel.textContent = '';
    mSel.appendChild(h('option', { value: '', text: '(연결 안 함)' }));
    ms.forEach(function (m) { mSel.appendChild(h('option', { value: m.id, text: '제' + m.seq + '차 ' + m.kind + ' · ' + U.fmtDate(m.meeting_date) })); });
    mSel.value = e && e.meeting_id ? e.meeting_id : '';
    renderFiles(); refreshLimit(); dlg.showModal();
  }
  ['e-item', 'e-meeting', 'e-amount', 'e-date'].forEach(function (id) { $(id).addEventListener('input', refreshLimit); $(id).addEventListener('change', refreshLimit); });
  $('e-files').onchange = function () {
    Array.prototype.forEach.call($('e-files').files, function (f) {
      if (f.size > 10 * 1024 * 1024) { U.notice('err', f.name + ' 파일이 10MB를 넘어요.'); return; }
      pending.push(f);
    });
    $('e-files').value = ''; renderFiles();
  };
  $('e-cancel').onclick = function () { dlg.close(); };

  function shrink(file) {
    return new Promise(function (ok, no) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var s = Math.min(1, 1800 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? ok(b) : no(new Error('사진을 변환하지 못했어요.')); }, 'image/jpeg', 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); no(new Error('사진을 열지 못했어요.')); };
      img.src = url;
    });
  }
  async function uploadReceipts(id) {
    for (var i = 0; i < pending.length; i++) {
      var f = pending[i], pdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
      var blob = pdf ? f : await shrink(f), path = id + '/' + Date.now() + '-' + i + (pdf ? '.pdf' : '.jpg');
      var up = await db.storage.from(BUCKET).upload(path, blob, { contentType: pdf ? 'application/pdf' : 'image/jpeg' });
      if (up.error) throw up.error;
      var ins = await db.from('expense_receipts').insert({ expense_id: id, path: path });
      if (ins.error) { await db.storage.from(BUCKET).remove([path]); throw ins.error; }
    }
  }

  $('exp-form').onsubmit = async function (ev) {
    ev.preventDefault();
    var it = selItem(), amount = parseInt($('e-amount').value, 10);
    if (!it) { await sayBox('예산 항목을 골라 주세요.'); return; }
    if (isNaN(amount) || amount < 0) { await sayBox('금액을 숫자로 입력해 주세요.'); return; }
    if (!$('e-proof').value) { await sayBox('증빙 종류를 골라 주세요.'); return; }
    if (it.is_meeting_fee && !$('e-alc').checked) { await sayBox('주류·개인 용도가 아님을 확인해 주세요.'); return; }
    if (!existing.length && !pending.length && !(await askBox('영수증 없이 저장할까요? 나중에 이 지출의 [편집]에서 올릴 수 있어요.', '저장'))) return;
    var m = it.is_meeting_fee ? selMeeting() : null, date = $('e-date').value;
    var fields = {
      fiscal_year: parseInt(date.slice(0, 4), 10), spent_on: date, item_id: it.id, description: $('e-desc').value.trim(), vendor: $('e-vendor').value.trim(),
      amount: amount, proof: $('e-proof').value, note: $('e-note').value.trim(), meeting_id: m ? m.id : null,
      attendee_count: m ? m.meeting_attendees.filter(function (a) { return a.attended; }).length : 0, no_alcohol_ok: it.is_meeting_fee ? $('e-alc').checked : false
    };
    var btn = $('e-save'); btn.disabled = true;
    try {
      var id = editing && editing.id;
      if (id) { var u = await db.from('expenses').update(fields).eq('id', id); if (u.error) throw u.error; }
      else { var c = await db.from('expenses').insert(Object.assign({ created_by_name: me.name || '' }, fields)).select('id').single(); if (c.error) throw c.error; id = c.data.id; }
      await uploadReceipts(id);
      dlg.close(); year = fields.fiscal_year; await reload(); U.notice('ok', '저장했어요.');
    } catch (e) { U.fail(e); dlg.close(); await reload(); }
    btn.disabled = false;
  };
  $('e-del').onclick = async function () {
    if (!editing || !(await askBox('이 지출 기록을 삭제할까요? 영수증도 함께 지워져요.', '삭제'))) return;
    try {
      var paths = editing.expense_receipts.map(function (r) { return r.path; });
      if (paths.length) await db.storage.from(BUCKET).remove(paths);
      var d = await db.from('expenses').delete().eq('id', editing.id); if (d.error) throw d.error;
      dlg.close(); await reload(); U.notice('ok', '삭제했어요.');
    } catch (e) { U.fail(e); }
  };

  // ---------- 예산 항목 편집 (관리자) ----------
  var idlg = $('item-dlg'), rows = [];
  function renderRows() {
    var box = $('item-rows'); box.textContent = '';
    rows.forEach(function (r, i) {
      if (r._del) return;
      var name = h('input', { type: 'text', maxlength: '50', placeholder: '항목 이름', 'aria-label': '항목 이름' }); name.value = r.name; name.oninput = function () { r.name = name.value; };
      var amt = h('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric', 'aria-label': '편성액' }); amt.value = r.planned_amount; amt.oninput = function () { r.planned_amount = parseInt(amt.value, 10) || 0; };
      var src = h('select', { 'aria-label': '재원' }, SOURCES.map(function (s) { return h('option', { value: s, text: s }); })); src.value = r.source; src.onchange = function () { r.source = src.value; };
      var fee = h('input', { type: 'checkbox', 'aria-label': '회의운영비' }); fee.checked = r.is_meeting_fee; fee.onchange = function () { r.is_meeting_fee = fee.checked; };
      box.appendChild(h('div', { class: 'irow' }, name, amt, src, h('label', null, fee, '회의운영비'),
        h('button', { class: 'linkbtn danger', type: 'button', text: '지우기', onclick: function () { if (r.id) r._del = true; else rows.splice(i, 1); renderRows(); } })));
    });
    if (!box.childNodes.length) box.appendChild(h('div', { class: 'hint', text: '항목이 없어요. 아래 버튼으로 추가해 주세요.' }));
  }
  function openItems() {
    rows = items.map(function (i) { return { id: i.id, name: i.name, planned_amount: Number(i.planned_amount), source: i.source, is_meeting_fee: i.is_meeting_fee }; });
    $('item-year').textContent = year + ' 회계연도 · 편성액은 원 단위 숫자로 적어 주세요.';
    renderRows(); idlg.showModal();
  }
  $('item-add').onclick = function () { rows.push({ id: null, name: '', planned_amount: 0, source: SOURCES[0], is_meeting_fee: false }); renderRows(); };
  $('item-default').onclick = function () {
    DEFAULT_ITEMS.forEach(function (d) { if (!rows.some(function (r) { return !r._del && r.name === d[0]; })) rows.push({ id: null, name: d[0], planned_amount: 0, source: SOURCES[0], is_meeting_fee: d[1] }); });
    renderRows();
  };
  $('item-cancel').onclick = function () { idlg.close(); };
  $('item-form').onsubmit = async function (ev) {
    ev.preventDefault();
    var live = rows.filter(function (r) { return !r._del; });
    if (live.some(function (r) { return !r.name.trim(); })) { await sayBox('이름이 빈 항목이 있어요.'); return; }
    var btn = $('item-save'); btn.disabled = true;
    try {
      var order = 0, i;
      for (i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (r._del) { var d = await db.from('budget_items').delete().eq('id', r.id); if (d.error) throw d.error; continue; }
        var f = { name: r.name.trim(), planned_amount: r.planned_amount, source: r.source, is_meeting_fee: r.is_meeting_fee, sort_order: order++ };
        if (r.id) { var u = await db.from('budget_items').update(f).eq('id', r.id); if (u.error) throw u.error; }
        else { var c = await db.from('budget_items').insert(Object.assign({ fiscal_year: year }, f)); if (c.error) throw c.error; }
      }
      idlg.close(); await reload(); U.notice('ok', '예산 항목을 저장했어요.');
    } catch (e) { U.fail(e); await reload(); idlg.close(); }
    btn.disabled = false;
  };

  reload();
});
