// 공지: 모든 승인 위원이 읽고, 임원(공지 쓰기 권한이 있는 직책)과 관리자만 쓰는 화면
window.whenAuthed.then(function (me) {
  'use strict';
  var db = Auth.client, U = UI, h = U.h, $ = U.$, app = $('app');
  var canWrite = me.can('notice_write');
  var list = [], term = '', editing = null, openId = null;

  function fmt(s) {
    var d = new Date(s);
    return d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate() + ' ' + U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
  }
  function mine(n) { return me.role === 'admin' || n.created_by === me.id; }

  async function load() {
    var r = await db.from('notices').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(100);
    if (r.error) throw r.error;
    list = r.data;
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
          h('div', { class: 't', text: (n.pinned ? '📌 ' : '') + n.title }),
          h('div', { class: 'm' }, h('span', { text: n.created_by_name || '작성자 미상' }), h('span', { text: fmt(n.created_at) }),
            edited ? h('span', { class: 'badge gold', text: '수정됨 ' + fmt(n.updated_at) + (n.updated_by_name ? ' · ' + n.updated_by_name : '') }) : null)),
        h('div', { class: 'body', text: n.body }));
      d.addEventListener('toggle', function () { if (d.open) openId = n.id; else if (openId === n.id) openId = null; });
      if (canWrite && mine(n)) {
        d.appendChild(h('div', { class: 'acts noprint' },
          h('button', { class: 'ghost', type: 'button', text: '고치기', onclick: function () { openDlg(n); } }),
          h('button', { class: 'ghost danger', type: 'button', text: '삭제', onclick: function () { remove(n); } })));
      }
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
