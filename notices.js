// 공지: 모든 승인 위원이 읽고, 임원(공지 쓰기 권한이 있는 직책)과 관리자만 쓰는 화면
window.whenAuthed.then(function (me) {
  'use strict';
  var db = Auth.client, U = UI, h = U.h, $ = U.$, app = $('app');
  var canWrite = me.can('notice_write');
  var list = [], term = '', editing = null, openId = null, reads = [], members = [];

  function fmt(s) {
    var d = new Date(s);
    return d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate() + ' ' + U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
  }
  function mine(n) { return me.role === 'admin' || n.created_by === me.id; }

  async function load() {
    var r = await db.from('notices').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(100);
    if (r.error) throw r.error;
    list = r.data;
    // 읽음 기록(표가 아직 없으면 읽음 기능만 빠진 채 계속 동작)
    var rd = await db.from('notice_reads').select('notice_id,user_id,read_at').limit(5000);
    reads = rd.error ? [] : rd.data;
    if (!members.length) {
      var m = await db.from('profiles').select('id,name,email').eq('status', 'approved');
      members = m.error ? [] : m.data.map(function (x) { return { id: x.id, name: x.name || x.email }; });
    }
  }
  function isRead(n) { return n.created_by === me.id || reads.some(function (r) { return r.notice_id === n.id && r.user_id === me.id; }); }
  function readersOf(n) { return reads.filter(function (r) { return r.notice_id === n.id; }); }
  function canSeeReaders(n) { return me.role === 'admin' || n.created_by === me.id; }
  async function markRead(n) {
    if (isRead(n)) return;
    reads.push({ notice_id: n.id, user_id: me.id, read_at: new Date().toISOString() });
    var r = await db.from('notice_reads').upsert({ notice_id: n.id, user_id: me.id }, { onConflict: 'notice_id,user_id', ignoreDuplicates: true });
    if (r.error) { reads = reads.filter(function (x) { return !(x.notice_id === n.id && x.user_id === me.id); }); return; }
    var badge = document.querySelector('[data-new="' + n.id + '"]'); if (badge) badge.remove();
  }
  function showReaders(n) {
    var rs = readersOf(n), done = {}; rs.forEach(function (r) { done[r.user_id] = r.read_at; });
    var nameOf = function (id) { var m = members.filter(function (x) { return x.id === id; })[0]; return m ? m.name : '(알 수 없음)'; };
    var read = members.filter(function (m) { return done[m.id]; }), unread = members.filter(function (m) { return !done[m.id] && m.id !== n.created_by; });
    var dlg = h('dialog', { style: 'margin:auto' }), box = h('div', { class: 'dlg' });
    box.appendChild(h('h3', { text: '읽음 확인 · ' + n.title }));
    box.appendChild(h('div', { class: 'hint', text: '읽은 사람 ' + read.length + '명 · 아직 안 읽은 사람 ' + unread.length + '명' }));
    box.appendChild(h('label', { class: 'l', text: '읽음' }));
    box.appendChild(h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' }, read.length ? read.map(function (m) { return h('span', { class: 'badge gold', text: m.name + ' · ' + fmt(done[m.id]).slice(5) }); }) : h('span', { class: 'hint', text: '아직 없어요' })));
    box.appendChild(h('label', { class: 'l', text: '아직 안 읽음' }));
    box.appendChild(h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' }, unread.length ? unread.map(function (m) { return h('span', { class: 'badge', text: m.name }); }) : h('span', { class: 'hint', text: '모두 읽었어요' })));
    box.appendChild(h('div', { class: 'bar', style: 'margin:14px 0 0' }, h('span', { class: 'sp' }), h('button', { class: 'primary', type: 'button', text: '닫기', onclick: function () { dlg.close(); dlg.remove(); } })));
    dlg.appendChild(box); document.body.appendChild(dlg); dlg.showModal();
  }

  function render() {
    app.textContent = '';
    app.appendChild(h('div', { class: 'top noprint' },
      h('div', null, h('div', { class: 'mark', text: '작은도서관 운영위원회' }), h('h1', { text: '공지' })),
      canWrite ? h('button', { class: 'primary', text: '+ 공지 쓰기', onclick: function () { openDlg(null); } }) : null));
    if (!canWrite) app.appendChild(h('div', { class: 'hint noprint', style: 'margin:-8px 0 12px', text: '공지는 임원과 관리자가 올려요. 다른 위원은 읽기만 할 수 있어요.' }));

    var s = h('input', { type: 'search', class: 'search', placeholder: '공지 검색 (제목·내용)', 'aria-label': '공지 검색' });
    s.value = term;
    s.oninput = function () { term = s.value.trim().toLowerCase(); renderList(); };
    app.appendChild(s);
    app.appendChild(h('div', { id: 'nl', class: 'nlist' }));
    renderList();
  }

  function renderList() {
    var box = $('nl'); box.textContent = '';
    var rows = list.filter(function (n) { return !term || (n.title + '\n' + n.body).toLowerCase().indexOf(term) >= 0; });
    if (!rows.length) { box.appendChild(h('div', { class: 'empty', text: list.length ? '찾는 공지가 없어요.' : '아직 올라온 공지가 없어요.' })); return; }
    rows.forEach(function (n) {
      var edited = n.updated_at && new Date(n.updated_at) - new Date(n.created_at) > 60000;
      var d = h('details', { class: 'ncard' + (n.pinned ? ' pinned' : ''), open: openId === n.id ? true : null },
        h('summary', null,
          h('div', { class: 't' }, (n.pinned ? '📌 ' : '') + n.title, isRead(n) ? null : h('span', { class: 'badge', 'data-new': n.id, style: 'margin-left:8px;background:#fde8e4;color:var(--err);font-weight:700', text: '새 글' })),
          h('div', { class: 'm' }, h('span', { text: n.created_by_name || '작성자 미상' }), h('span', { text: fmt(n.created_at) }),
            edited ? h('span', { class: 'badge gold', text: '수정됨 ' + fmt(n.updated_at) + (n.updated_by_name ? ' · ' + n.updated_by_name : '') }) : null,
            canSeeReaders(n) && members.length ? h('span', { class: 'badge', text: '읽음 ' + readersOf(n).length + '/' + members.length + '명' }) : null)),
        h('div', { class: 'body', text: n.body }));
      d.addEventListener('toggle', function () {
        if (d.open) { openId = n.id; markRead(n); } else if (openId === n.id) openId = null;
      });
      var acts = h('div', { class: 'acts noprint' });
      if (canSeeReaders(n)) acts.appendChild(h('button', { class: 'ghost', type: 'button', text: '읽은 사람 보기', onclick: function () { showReaders(n); } }));
      if (canWrite && mine(n)) {
        acts.appendChild(h('button', { class: 'ghost', type: 'button', text: '고치기', onclick: function () { openDlg(n); } }));
        acts.appendChild(h('button', { class: 'ghost danger', type: 'button', text: '삭제', onclick: function () { remove(n); } }));
      }
      if (acts.childNodes.length) d.appendChild(acts);
      box.appendChild(d);
    });
  }

  // ---------- 쓰기 · 고치기 ----------
  var dlg = $('dlg');
  function openDlg(n) {
    editing = n;
    $('d-title').textContent = n ? '공지 고치기' : '공지 쓰기';
    $('n-title').value = n ? n.title : ''; $('n-body').value = n ? n.body : ''; $('n-pin').checked = !!(n && n.pinned);
    $('n-save').textContent = n ? '저장' : '올리기';
    dlg.showModal();
  }
  $('n-cancel').onclick = function () { dlg.close(); };
  $('form').onsubmit = async function (e) {
    e.preventDefault();
    var title = $('n-title').value.trim(), body = $('n-body').value.trim();
    if (!title || !body) { await sayBox('제목과 내용을 적어 주세요.'); return; }
    var btn = $('n-save'); btn.disabled = true;
    var fields = { title: title, body: body, pinned: $('n-pin').checked };
    var r = editing ? await db.from('notices').update(fields).eq('id', editing.id) : await db.from('notices').insert(fields);
    btn.disabled = false;
    if (r.error) { await sayBox(U.friendly(r.error)); return; }
    dlg.close();
    var was = editing; editing = null;
    try { await load(); render(); U.notice('ok', was ? '고쳤어요.' : '공지를 올렸어요.'); } catch (x) { U.fail(x); }
  };
  async function remove(n) {
    if (!(await askBox('"' + n.title + '" 공지를 삭제할까요? 되돌릴 수 없어요.', '삭제'))) return;
    var r = await db.from('notices').delete().eq('id', n.id);
    if (r.error) { U.fail(r.error); return; }
    try { await load(); render(); U.notice('ok', '삭제했어요.'); } catch (x) { U.fail(x); }
  }

  load().then(render).catch(U.fail);
});
