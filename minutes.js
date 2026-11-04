// 회의록 화면: 목록 / 작성 / 문서 보기(회의록 양식) / 전자서명 / 사진 / 인쇄
window.whenAuthed.then(function (me) {
  'use strict';
  var db = Auth.client;
  var BUCKET = 'meeting-photos';
  var POS = ['위원장', '부위원장', '총무', '감사', '운영위원'];
  var STATUS = { draft: '작성 중', signing: '서명 받는 중', closed: '마감' };
  var $ = function (id) { return document.getElementById(id); };
  var app = $('app');
  var members = [];

  // ---------- 작은 도우미 ----------
  function add(e, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(e, x); }); return; }
    e.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  function h(tag, props) {
    var e = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.slice(0, 2) === 'on') e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function notice(kind, text) {
    var n = $('notice');
    n.className = 'notice noprint' + (text ? ' ' + kind : '');
    n.textContent = text || '';
  }
  function friendly(e) {
    var m = (e && e.message) || String(e);
    if (/does not exist|schema cache|Could not find the table/i.test(m)) return '회의록 저장소가 아직 준비되지 않았어요. 관리자가 supabase-minutes.sql 을 실행해야 해요.';
    if (/row-level security/i.test(m)) return '권한이 없어요. 작성자나 관리자만 할 수 있어요.';
    if (/Bucket not found/i.test(m)) return '사진 보관함이 아직 준비되지 않았어요.';
    return m;
  }
  function fail(e) { notice('err', friendly(e)); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function fmtDate(d) { return d ? d.replace(/-/g, '.') + '.' : ''; }
  function fmtTime(t) { return t ? t.slice(0, 5) : ''; }
  function when(m) {
    var s = fmtDate(m.meeting_date), a = fmtTime(m.start_time), b = fmtTime(m.end_time);
    if (a) s += ' ' + a;
    if (b) s += ' ~ ' + b;
    return s;
  }
  function rank(p) { var i = POS.indexOf(p); return i < 0 ? 99 : i; }
  function sortAtt(list) { list.sort(function (a, b) { return rank(a.position) - rank(b.position) || String(a.name).localeCompare(String(b.name), 'ko'); }); }
  function counts(att, observers) {
    var total = att.length, present = att.filter(function (a) { return a.attended; }).length;
    return { total: total, present: present, absent: total - present, observers: observers || 0, quorum: present * 2 > total };
  }
  function attText(c) { return '재적 ' + c.total + '명 중 ' + c.present + '명 참석, ' + c.absent + '명 불참, ' + c.observers + '명 배석'; }
  function agendaLines(s) {
    return (s || '').split('\n').map(function (x) { return x.trim().replace(/^\d+[.)]\s*/, ''); }).filter(Boolean);
  }

  // ---------- 이동 ----------
  function nav(search) { history.pushState(null, '', 'minutes.html' + (search || '')); route(); window.scrollTo(0, 0); }
  function link(search, props) {
    var a = h('a', Object.assign({ href: 'minutes.html' + search }, props));
    for (var i = 2; i < arguments.length; i++) add(a, arguments[i]);
    a.onclick = function (e) { e.preventDefault(); nav(search); };
    return a;
  }
  window.addEventListener('popstate', route);

  async function route() {
    notice();
    var p = new URLSearchParams(location.search);
    try {
      if (p.has('new')) return await showEditor(null);
      var id = p.get('id');
      if (id) return await showMeeting(id, p.has('edit'));
      return await showList();
    } catch (e) { fail(e); }
  }

  // ---------- 데이터 ----------
  async function loadMembers() {
    if (members.length) return;
    var r = await db.from('profiles').select('id,name,email').eq('status', 'approved').order('name');
    if (r.error) throw r.error;
    members = r.data.map(function (x) { return { id: x.id, name: x.name || x.email }; });
  }
  async function loadOne(id) {
    var r = await db.from('meetings').select('*, meeting_attendees(*), meeting_signatures(*), meeting_photos(*)').eq('id', id).maybeSingle();
    if (r.error) throw r.error;
    return r.data;
  }
  async function signedUrls(photos) {
    var map = {};
    if (!photos.length) return map;
    var r = await db.storage.from(BUCKET).createSignedUrls(photos.map(function (p) { return p.path; }), 900);
    if (r.data) r.data.forEach(function (x) { if (x.signedUrl) map[x.path] = x.signedUrl; });
    return map;
  }

  // ---------- 목록 ----------
  async function showList() {
    var r = await db.from('meetings')
      .select('id,seq,kind,meeting_date,start_time,end_time,place,status,author_name,meeting_attendees(id,attended),meeting_signatures(attendee_id)')
      .order('meeting_date', { ascending: false }).order('seq', { ascending: false });
    if (r.error) throw r.error;
    document.title = '회의록 · 작은도서관 운영위원회';
    app.textContent = '';
    app.appendChild(h('div', { class: 'top' },
      h('div', null, h('div', { class: 'mark', text: '작은도서관 운영위원회' }), h('h1', { text: '회의록' })),
      h('button', { class: 'primary', text: '+ 회의록 쓰기', onclick: function () { nav('?new'); } })));
    var list = h('div', { class: 'list' });
    if (!r.data.length) list.appendChild(h('div', { class: 'empty', text: '아직 회의록이 없어요. 첫 회의록을 남겨 보세요.' }));
    r.data.forEach(function (m) {
      var present = m.meeting_attendees.filter(function (a) { return a.attended; }).length;
      var badges = h('div', { class: 'badges' }, h('span', { class: 'badge ' + m.status, text: STATUS[m.status] }));
      if (m.status !== 'draft') badges.appendChild(h('span', { class: 'badge', text: '서명 ' + m.meeting_signatures.length + '/' + present + '명' }));
      list.appendChild(link('?id=' + m.id, { class: 'card' },
        h('div', { class: 't', text: '제' + m.seq + '차 ' + m.kind }),
        h('div', { class: 's', text: when(m) + (m.place ? ' · ' + m.place : '') + (m.author_name ? ' · 작성 ' + m.author_name : '') }),
        badges));
    });
    app.appendChild(list);
  }

  // ---------- 작성 ----------
  async function newDraft() {
    await loadMembers();
    var last = await db.from('meetings').select('seq,place,meeting_attendees(user_id,position)')
      .order('meeting_date', { ascending: false }).order('seq', { ascending: false }).limit(1);
    if (last.error) throw last.error;
    var prev = last.data && last.data[0], pos = {};
    if (prev) prev.meeting_attendees.forEach(function (a) { if (a.user_id) pos[a.user_id] = a.position; });
    var d = {
      id: null, seq: (prev ? prev.seq : 0) + 1, kind: '정기회의', meeting_date: today(), start_time: '10:00', end_time: '12:00',
      place: prev ? prev.place : '', author_name: me.name || '', observers: 0, agenda: '', summary: '', result: '', photos: [],
      attendees: members.map(function (m) { return { user_id: m.id, name: m.name, position: pos[m.id] || '운영위원', attended: true }; })
    };
    sortAtt(d.attendees);
    return d;
  }
  function draftFrom(m) {
    var att = m.meeting_attendees.slice().sort(function (a, b) { return a.sort_order - b.sort_order; })
      .map(function (a) { return { user_id: a.user_id, name: a.name, position: a.position, attended: a.attended }; });
    return {
      id: m.id, seq: m.seq, kind: m.kind, meeting_date: m.meeting_date, start_time: fmtTime(m.start_time), end_time: fmtTime(m.end_time),
      place: m.place, author_name: m.author_name, observers: m.observers, agenda: m.agenda, summary: m.summary, result: m.result,
      photos: m.meeting_photos.slice(), attendees: att
    };
  }
  async function showEditor(d) {
    if (!d) d = await newDraft();
    document.title = (d.id ? '회의록 수정' : '새 회의록') + ' · 작은도서관 운영위원회';
    app.textContent = '';

    function field(label, input, hint) { return h('div', null, h('label', { class: 'l', text: label }), input, hint ? h('div', { class: 'hint', text: hint }) : null); }
    function text(key, type, extra) {
      var i = h('input', Object.assign({ type: type || 'text' }, extra || {}));
      i.value = d[key] == null ? '' : d[key];
      i.oninput = function () { d[key] = i.value; };
      return i;
    }
    function area(key, rows, ph) {
      var t = h('textarea', { placeholder: ph || '', rows: rows || 5 });
      t.value = d[key] || '';
      t.oninput = function () { d[key] = t.value; };
      return t;
    }
    var kindSel = h('select', null, h('option', { value: '정기회의', text: '정기회의' }), h('option', { value: '임시회의', text: '임시회의' }));
    kindSel.value = d.kind; kindSel.onchange = function () { d.kind = kindSel.value; };

    // 참석자
    var attBox = h('div'), sumBox = h('div', { class: 'sum' });
    function renderSum() {
      var c = counts(d.attendees, d.observers);
      sumBox.className = 'sum' + (c.quorum ? '' : ' bad');
      sumBox.textContent = attText(c) + ' · ' + (c.quorum ? '성원(의결 가능)' : '성원 미달');
    }
    function renderAtt() {
      attBox.textContent = '';
      if (!d.attendees.length) attBox.appendChild(h('div', { class: 'hint', text: '아직 위원이 없어요. 아래에서 직접 추가해 주세요.' }));
      d.attendees.forEach(function (a, i) {
        var cb = h('input', { type: 'checkbox', 'aria-label': a.name + ' 참석' }); cb.checked = a.attended;
        cb.onchange = function () { a.attended = cb.checked; renderSum(); };
        var sel = h('select', { 'aria-label': a.name + ' 직급' }, POS.map(function (p) { return h('option', { value: p, text: p }); }));
        sel.value = a.position; sel.onchange = function () { a.position = sel.value; };
        var nm = h('div', { class: 'nm' }, a.name, a.user_id ? null : h('small', { text: ' (계정 없음 · 종이 서명)' }));
        var row = h('div', { class: 'att' }, cb, nm, sel);
        row.appendChild(a.user_id ? h('span') : h('button', { class: 'ghost danger', type: 'button', text: '빼기', onclick: function () { d.attendees.splice(i, 1); renderAtt(); } }));
        attBox.appendChild(row);
      });
      renderSum();
    }
    var newName = h('input', { type: 'text', placeholder: '계정이 없는 위원 이름', maxlength: '50' });
    var addRow = h('div', { class: 'addrow' }, newName,
      h('button', { class: 'ghost', type: 'button', text: '위원 직접 추가', onclick: function () {
        var n = newName.value.trim(); if (!n) return;
        d.attendees.push({ user_id: null, name: n, position: '운영위원', attended: true }); newName.value = ''; renderAtt();
      } }));

    var obs = text('observers', 'number', { min: '0', max: '99' });
    obs.oninput = function () { d.observers = Math.max(0, parseInt(obs.value, 10) || 0); renderSum(); };

    var photoBox = h('div');
    renderAtt();

    var saveBtn = h('button', { class: 'ghost', text: '저장' });
    var signBtn = h('button', { class: 'primary', text: '저장하고 서명 받기 시작' });
    function busy(b) { saveBtn.disabled = signBtn.disabled = b; }
    saveBtn.onclick = function () { onSave(false); };
    signBtn.onclick = function () { onSave(true); };

    async function onSave(startSigning) {
      if (!d.meeting_date) { notice('err', '회의 일시(날짜)를 입력해 주세요.'); return; }
      if (!(parseInt(d.seq, 10) >= 1)) { notice('err', '회의 차수를 입력해 주세요.'); return; }
      if (startSigning && !confirm('서명을 받기 시작하면 내용을 고칠 수 없어요(서명이 없다면 초안으로 되돌릴 수는 있어요). 계속할까요?')) return;
      notice(); busy(true);
      try {
        sortAtt(d.attendees);
        var id = await persist(d);
        if (startSigning) {
          var u = await db.from('meetings').update({ status: 'signing' }).eq('id', id);
          if (u.error) throw u.error;
          history.replaceState(null, '', 'minutes.html?id=' + id);
          await route();
          notice('ok', '서명 받기를 시작했어요. 위원들이 로그인해서 서명하면 돼요.');
        } else {
          history.replaceState(null, '', 'minutes.html?id=' + id + '&edit');
          await route();
          notice('ok', '저장했어요.');
        }
      } catch (e) { fail(e); busy(false); }
    }

    app.appendChild(h('div', { class: 'top' },
      h('div', null, h('div', { class: 'mark', text: '작은도서관 운영위원회' }), h('h1', { text: d.id ? '회의록 수정' : '새 회의록' })),
      h('button', { class: 'ghost', text: '← 목록', onclick: function () { nav(''); } })));

    app.appendChild(h('div', { class: 'panel' }, h('h2', { text: '1. 회의 개요' }),
      h('div', { class: 'grid3' },
        field('회의 차수 (제 ○ 차)', text('seq', 'number', { min: '1', max: '999' })),
        field('회의 구분', kindSel),
        field('날짜', text('meeting_date', 'date'))),
      h('div', { class: 'grid3' },
        field('시작 시각', text('start_time', 'time')),
        field('종료 시각', text('end_time', 'time')),
        field('장소', text('place', 'text', { maxlength: '100' }))),
      h('div', { class: 'grid2' },
        field('작성자명', text('author_name', 'text', { maxlength: '50' })),
        field('배석 인원(관리사무소 등)', obs)),
      field('안건', area('agenda', 5, '한 줄에 안건 하나씩 적어 주세요. 번호는 자동으로 붙어요.'))));

    app.appendChild(h('div', { class: 'panel' }, h('h2', { text: '참석 확인' }),
      h('div', { class: 'hint', text: '참석한 위원에 체크하고 직급을 골라 주세요. 서명은 참석으로 표시된 위원만 할 수 있어요.' }),
      attBox, sumBox, addRow));

    app.appendChild(h('div', { class: 'panel' }, h('h2', { text: '2. 회의록' }),
      field('회의 내용 (요약)', area('summary', 12, '안건별로 논의한 내용을 요약해 적어 주세요.')),
      field('회의 결과', area('result', 6, '안건별 결과(의결·보류 등)를 적어 주세요.'))));

    app.appendChild(h('div', { class: 'panel' }, h('h2', { text: '4. 회의 사진' }), photoBox));
    renderPhotoEditor(photoBox, d);

    app.appendChild(h('div', { class: 'bar' },
      d.id ? h('button', { class: 'ghost danger', text: '삭제', onclick: function () { removeMeeting(d.id, d.photos); } }) : null,
      h('span', { class: 'sp' }), saveBtn, signBtn));
  }

  async function persist(d) {
    var fields = {
      seq: parseInt(d.seq, 10), kind: d.kind, meeting_date: d.meeting_date,
      start_time: d.start_time || null, end_time: d.end_time || null,
      place: (d.place || '').trim(), author_name: (d.author_name || '').trim(), observers: d.observers || 0,
      agenda: (d.agenda || '').trim(), summary: (d.summary || '').trim(), result: (d.result || '').trim()
    };
    var id = d.id;
    if (id) {
      var u = await db.from('meetings').update(fields).eq('id', id);
      if (u.error) throw u.error;
    } else {
      var c = await db.from('meetings').insert(fields).select('id').single();
      if (c.error) throw c.error;
      id = d.id = c.data.id;
    }
    var del = await db.from('meeting_attendees').delete().eq('meeting_id', id);
    if (del.error) throw del.error;
    var rows = d.attendees.map(function (a, i) {
      return { meeting_id: id, user_id: a.user_id || null, name: a.name, position: a.position, attended: a.attended, sort_order: i };
    });
    if (rows.length) {
      var ins = await db.from('meeting_attendees').insert(rows);
      if (ins.error) throw ins.error;
    }
    return id;
  }

  async function removeMeeting(id, photos) {
    if (!confirm('이 회의록을 삭제할까요? 서명과 사진도 함께 지워지고 되돌릴 수 없어요.')) return;
    try {
      if (photos && photos.length) await db.storage.from(BUCKET).remove(photos.map(function (p) { return p.path; }));
      var r = await db.from('meetings').delete().eq('id', id);
      if (r.error) throw r.error;
      nav('');
      notice('ok', '삭제했어요.');
    } catch (e) { fail(e); }
  }

  // ---------- 사진 ----------
  function shrink(file) {
    return new Promise(function (ok, no) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var s = Math.min(1, 1600 / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? ok(b) : no(new Error('사진을 변환하지 못했어요.')); }, 'image/jpeg', 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(url); no(new Error('사진을 열지 못했어요. 사진 파일이 맞는지 확인해 주세요.')); };
      img.src = url;
    });
  }
  async function renderPhotoEditor(box, d) {
    box.textContent = '';
    if (!d.id) { box.appendChild(h('div', { class: 'hint', text: '먼저 "저장"을 누르면 사진을 올릴 수 있어요.' })); return; }
    var status = h('div', { class: 'hint' });
    var input = h('input', { type: 'file', accept: 'image/*', multiple: true });
    input.onchange = async function () {
      var files = Array.prototype.slice.call(input.files);
      if (!files.length) return;
      if (d.photos.length + files.length > 10) { notice('err', '사진은 한 회의록에 10장까지 올릴 수 있어요.'); input.value = ''; return; }
      notice(); input.disabled = true;
      try {
        for (var i = 0; i < files.length; i++) {
          status.textContent = '올리는 중 ' + (i + 1) + '/' + files.length + ' …';
          var blob = await shrink(files[i]);
          var path = d.id + '/' + Date.now() + '-' + i + '.jpg';
          var up = await db.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
          if (up.error) throw up.error;
          var ins = await db.from('meeting_photos').insert({ meeting_id: d.id, path: path }).select('*').single();
          if (ins.error) { await db.storage.from(BUCKET).remove([path]); throw ins.error; }
          d.photos.push(ins.data);
        }
      } catch (e) { fail(e); }
      renderPhotoEditor(box, d);
    };
    box.appendChild(h('div', { class: 'hint', text: '사진은 자동으로 줄여서 올려요. 최대 10장.' }));
    box.appendChild(input); box.appendChild(status);
    var urls = await signedUrls(d.photos);
    var grid = h('div', { class: 'photos' });
    d.photos.forEach(function (p) {
      grid.appendChild(h('figure', null, h('img', { src: urls[p.path] || '', alt: '회의 사진' }),
        h('button', { type: 'button', text: '삭제', onclick: async function () {
          if (!confirm('이 사진을 삭제할까요?')) return;
          await db.storage.from(BUCKET).remove([p.path]);
          var r = await db.from('meeting_photos').delete().eq('id', p.id);
          if (r.error) { fail(r.error); return; }
          d.photos = d.photos.filter(function (x) { return x.id !== p.id; });
          renderPhotoEditor(box, d);
        } })));
    });
    box.appendChild(grid);
  }

  // ---------- 문서 보기 ----------
  async function showMeeting(id, edit) {
    var m = await loadOne(id);
    app.textContent = '';
    if (!m) {
      notice('err', '회의록을 찾을 수 없어요. 삭제됐거나 주소가 맞지 않아요.');
      app.appendChild(h('button', { class: 'ghost', text: '← 목록', onclick: function () { nav(''); } }));
      return;
    }
    var manage = me.role === 'admin' || m.author_id === me.id;
    if (edit && m.status === 'draft' && manage) return showEditor(draftFrom(m));
    return renderDoc(m, manage);
  }

  async function renderDoc(m, manage) {
    var att = m.meeting_attendees.slice().sort(function (a, b) { return a.sort_order - b.sort_order; });
    var sigByAtt = {};
    m.meeting_signatures.forEach(function (s) { sigByAtt[s.attendee_id] = s; });
    var c = counts(att, m.observers);
    var urls = await signedUrls(m.meeting_photos);
    var curHash = null;
    if (m.meeting_signatures.length) {
      var hr = await db.rpc('meeting_content_hash', { mid: m.id });
      if (!hr.error) curHash = hr.data;
    }
    var mine = att.filter(function (a) { return a.user_id === me.id && a.attended && !sigByAtt[a.id]; })[0];
    document.title = '제' + m.seq + '차 회의록 · 작은도서관 운영위원회';

    function setStatus(status, msg) {
      return async function () {
        var u = await db.from('meetings').update({ status: status }).eq('id', m.id);
        if (u.error) { fail(u.error); return; }
        await route(); notice('ok', msg);
      };
    }

    // 위쪽 안내·버튼 (인쇄 때는 숨김)
    var acts = h('div', { class: 'bar noprint' });
    acts.appendChild(h('button', { class: 'ghost', text: '← 목록', onclick: function () { nav(''); } }));
    acts.appendChild(h('span', { class: 'sp' }));
    if (mine && m.status === 'signing') acts.appendChild(h('button', { class: 'primary', text: '내 서명하기', onclick: function () { openSign(m, mine); } }));
    if (m.status === 'draft' && manage) acts.appendChild(h('button', { class: 'ghost', text: '이어서 쓰기', onclick: function () { nav('?id=' + m.id + '&edit'); } }));
    if (m.status === 'signing' && manage) {
      if (!m.meeting_signatures.length) acts.appendChild(h('button', { class: 'ghost', text: '초안으로 되돌리기', onclick: setStatus('draft', '초안으로 되돌렸어요. 다시 고칠 수 있어요.') }));
      acts.appendChild(h('button', { class: 'ghost', text: '서명 마감', onclick: function () {
        var left = c.present - m.meeting_signatures.length;
        if (confirm((left > 0 ? '아직 서명하지 않은 위원이 ' + left + '명 있어요. ' : '') + '서명을 마감할까요? 마감하면 더는 서명할 수 없어요.')) setStatus('closed', '서명을 마감했어요.')();
      } }));
    }
    acts.appendChild(h('button', { class: 'ghost', text: '인쇄 · PDF 저장', onclick: function () { window.print(); } }));
    if (me.role === 'admin' || (m.author_id === me.id && m.status === 'draft'))
      acts.appendChild(h('button', { class: 'ghost danger', text: '삭제', onclick: function () { removeMeeting(m.id, m.meeting_photos); } }));

    var head = h('div', { class: 'top noprint' },
      h('div', null, h('div', { class: 'mark', text: '작은도서관 운영위원회' }), h('h1', { text: '제' + m.seq + '차 ' + m.kind + ' 회의록' }),
        h('div', { class: 'badges' }, h('span', { class: 'badge ' + m.status, text: STATUS[m.status] }),
          m.status !== 'draft' ? h('span', { class: 'badge', text: '서명 ' + m.meeting_signatures.length + '/' + c.present + '명' }) : null)));

    // 서명 칸
    function sigCell(a) {
      var td = h('td', { class: 'sigcell' }), s = sigByAtt[a.id];
      if (!a.attended) { td.appendChild(h('span', { class: 'wait', text: '불참' })); return td; }
      if (s) {
        td.appendChild(h('img', { src: s.signature, alt: a.name + ' 서명', title: new Date(s.signed_at).toLocaleString('ko-KR') + ' 서명' }));
        if (me.role === 'admin' && m.status === 'signing')
          td.appendChild(h('button', { class: 'x noprint', type: 'button', text: '서명 지우기', onclick: async function () {
            if (!confirm(a.name + ' 위원의 서명을 지울까요?')) return;
            var r = await db.from('meeting_signatures').delete().eq('attendee_id', a.id);
            if (r.error) { fail(r.error); return; }
            await route();
          } }));
      } else if (m.status === 'signing' && a.user_id === me.id) {
        td.appendChild(h('button', { class: 'primary noprint', type: 'button', text: '서명하기', onclick: function () { openSign(m, a); } }));
      } else if (!a.user_id) {
        td.appendChild(h('span', { class: 'wait', text: '직접 서명' }));
      } else {
        td.appendChild(h('span', { class: 'wait', text: m.status === 'closed' ? '미서명' : (m.status === 'draft' ? '' : '서명 대기') }));
      }
      return td;
    }
    var half = Math.ceil(att.length / 2) || 1, rows = [];
    for (var i = 0; i < half; i++) {
      var L = att[i], R = att[i + half], tr = h('tr');
      tr.appendChild(h('td', { text: L ? L.position : '' })); tr.appendChild(h('td', { text: L ? L.name : '' })); tr.appendChild(L ? sigCell(L) : h('td'));
      tr.appendChild(h('td', { text: R ? R.position : '' })); tr.appendChild(h('td', { text: R ? R.name : '' })); tr.appendChild(R ? sigCell(R) : h('td'));
      rows.push(tr);
    }
    // 폰용: 한 줄에 한 사람
    var rosterN = h('table', { class: 'f narrow' },
      h('colgroup', null, [16, 22, 24, 38].map(function (w) { return h('col', { style: 'width:' + w + '%' }); })),
      h('tr', null, h('th', { rowspan: String(att.length + 1), text: '참석자' }), h('th', { text: '직급' }), h('th', { text: '이름' }), h('th', { text: '서명' })));
    att.forEach(function (a) { rosterN.appendChild(h('tr', null, h('td', { text: a.position }), h('td', { text: a.name }), sigCell(a))); });
    var roster = h('table', { class: 'f wide' },
      h('colgroup', null, [14, 14, 17, 19, 14, 14, 19].map(function (w) { return h('col', { style: 'width:' + w + '%' }); })),
      h('tr', null, h('th', { rowspan: String(half + 1), text: '참석자' }), h('th', { text: '직급' }), h('th', { text: '이름' }), h('th', { text: '서명' }), h('th', { text: '직급' }), h('th', { text: '이름' }), h('th', { text: '서명' })));
    rows.forEach(function (tr) { roster.appendChild(tr); });

    var agenda = agendaLines(m.agenda);
    var quorumNote = c.quorum ? '성원(의결 가능)' : '성원 미달';
    var overviewN = h('table', { class: 'f narrow' },
      h('colgroup', null, [28, 72].map(function (w) { return h('col', { style: 'width:' + w + '%' }); })),
      [['회의 차수', '제' + m.seq + '차'], ['회의 구분', m.kind], ['회의 일시', when(m)], ['장소', m.place], ['작성자명', m.author_name]].map(function (r) {
        return h('tr', null, h('th', { text: r[0] }), h('td', { class: 'left', text: r[1] }));
      }),
      h('tr', null, h('th', { text: '참석 현황' }), h('td', { class: 'left' }, attText(c), h('div', { class: 'hint', text: quorumNote }))),
      h('tr', null, h('th', { text: '안건' }), h('td', { class: 'left' }, agenda.length ? agenda.map(function (x, k) { return h('div', { text: (k + 1) + '. ' + x }); }) : '')));
    var overview = h('table', { class: 'f wide' },
      h('colgroup', null, [13, 15, 13, 15, 13, 31].map(function (w) { return h('col', { style: 'width:' + w + '%' }); })),
      h('tr', null, h('th', { text: '회의 차수' }), h('td', { text: '제' + m.seq + '차' }), h('th', { text: '회의 구분' }), h('td', { text: m.kind }), h('th', { text: '회의 일시' }), h('td', { text: when(m) })),
      h('tr', null, h('th', { text: '장소' }), h('td', { text: m.place }), h('th', { text: '작성자명' }), h('td', { text: m.author_name }), h('th', { text: '참석 현황' }),
        h('td', null, attText(c), h('div', { class: 'hint noprint', text: c.quorum ? '성원(의결 가능)' : '성원 미달' }))),
      h('tr', null, h('th', { text: '안건' }), h('td', { class: 'left', colspan: '5' }, agenda.length ? agenda.map(function (x, k) { return h('div', { text: (k + 1) + '. ' + x }); }) : '')));

    function box(title, body) { return h('div', { class: 'box' }, h('div', { class: 'bh', text: title }), h('div', { class: 'bb', text: body || '' })); }

    var photos = h('div', { class: 'docphotos' });
    m.meeting_photos.forEach(function (p) { if (urls[p.path]) photos.appendChild(h('img', { src: urls[p.path], alt: '회의 사진' })); });
    if (!m.meeting_photos.length) photos = h('div', { class: 'hint', text: '(첨부된 사진 없음)' });

    var nSig = m.meeting_signatures.length, bad = 0;
    if (curHash != null) m.meeting_signatures.forEach(function (s) { if (s.content_hash !== curHash) bad++; });
    var proof = null;
    if (m.status !== 'draft') {
      proof = h('div', { class: 'proof' + (bad ? ' warn' : '') },
        '전자서명 ' + nSig + '/' + c.present + '명 완료. 서명은 로그인한 본인 계정으로만 할 수 있고, 서명한 시각과 서명 당시 회의록 내용의 지문이 함께 기록돼요.',
        nSig ? (bad ? ' ⚠ 서명 이후 내용이 바뀐 흔적이 있어요(' + bad + '건 불일치). 관리자에게 알려 주세요.' : ' ✓ 모든 서명이 현재 회의록 내용과 일치해요.') : '');
    }

    var year = (m.meeting_date || '').slice(0, 4);
    app.appendChild(head);
    app.appendChild(acts);
    app.appendChild(h('div', { class: 'doc' },
      h('div', { class: 'cover' }, h('div', { class: 'c1' }, '쌍용더플래티넘장항', h('br'), '작은도서관 운영위원회', h('br'), '회의록'), h('div', { class: 'c2', text: year + '년' })),
      h('h2', { text: '1. 회의 개요' }), overview, overviewN,
      h('h2', { class: 'p2', text: '2. 회의록' }), box('회의 내용 (요약)', m.summary), box('회의 결과', m.result),
      h('div', { class: 'keep' },
        h('h2', { text: '3. 참석자 명부 및 서명부' }), h('p', { class: 'pledge', text: '위 결의사항의 명확을 기하기 위하여 연서·날인합니다.' }), roster, rosterN),
      h('h2', { class: 'p3', text: '4. 회의 사진' }), photos,
      proof));
  }

  // ---------- 전자서명 ----------
  var pad = $('pad'), pctx = pad.getContext('2d'), signTarget = null, strokes = 0, down = false, lastPt = null;
  function padReset() {
    pctx.clearRect(0, 0, pad.width, pad.height);
    pctx.lineWidth = 3; pctx.lineCap = 'round'; pctx.lineJoin = 'round'; pctx.strokeStyle = '#111'; pctx.fillStyle = '#111';
    strokes = 0;
  }
  function pt(e) {
    var r = pad.getBoundingClientRect();
    return { x: (e.clientX - r.left) * pad.width / r.width, y: (e.clientY - r.top) * pad.height / r.height };
  }
  pad.addEventListener('pointerdown', function (e) {
    e.preventDefault(); pad.setPointerCapture(e.pointerId); down = true; lastPt = pt(e);
    pctx.beginPath(); pctx.arc(lastPt.x, lastPt.y, 1.6, 0, Math.PI * 2); pctx.fill(); strokes++;
  });
  pad.addEventListener('pointermove', function (e) {
    if (!down) return;
    var p = pt(e);
    pctx.beginPath(); pctx.moveTo(lastPt.x, lastPt.y); pctx.lineTo(p.x, p.y); pctx.stroke(); lastPt = p; strokes++;
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { pad.addEventListener(ev, function () { down = false; }); });

  function openSign(m, a) {
    signTarget = { m: m, a: a };
    padReset();
    $('sign-agree').checked = false;
    $('sign-who').textContent = '제' + m.seq + '차 ' + m.kind + ' · ' + a.position + ' ' + a.name;
    $('sign-dlg').showModal();
  }
  $('sign-clear').onclick = padReset;
  $('sign-cancel').onclick = function () { $('sign-dlg').close(); };
  $('sign-ok').onclick = async function () {
    if (strokes < 8) { alert('서명란에 이름을 직접 써 주세요.'); return; }
    if (!$('sign-agree').checked) { alert('확인 문구에 체크해 주세요.'); return; }
    var btn = $('sign-ok'); btn.disabled = true;
    var r = await db.from('meeting_signatures').insert({
      attendee_id: signTarget.a.id, meeting_id: signTarget.m.id, signature: pad.toDataURL('image/png')
    });
    btn.disabled = false;
    if (r.error) { alert(friendly(r.error)); return; }
    $('sign-dlg').close();
    await route();
    notice('ok', '서명했어요. 고맙습니다.');
  };

  padReset();
  route();
});
