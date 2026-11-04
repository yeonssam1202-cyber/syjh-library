// 회칙·세칙: 핵심 요약 카드 + 원문(장·조문 구분, 검색, 목차) + 개정 이력
window.whenAuthed.then(function (me) {
  'use strict';
  var db = Auth.client, U = UI, h = U.h, $ = U.$, app = $('app');
  var isAdmin = me.role === 'admin';
  var versions = [];          // 최신순
  var kind = '회칙', pickedId = null, term = '';

  // 기획서의 "자동 알림·검사 규칙" 표를 쉬운 말로 정리한 요약입니다. 원문과 다르면 원문이 우선이에요.
  var SUMMARY = [
    { t: '위원 구성', li: ['재적위원은 10명 이상', '위원 임기는 2년(위촉일부터 각자 계산)', '사직·전출하면 30일 안에 변경신고'], ref: '회칙 제5조②, 제6조③④⑦' },
    { t: '임원', li: ['위원장·부위원장·총무·감사 4명', '위원장 임기 2년', '부위원장·총무·감사 임기 6개월'], ref: '회칙 제8조, 제9조' },
    { t: '회의', li: ['정기회의는 월 1회', '재적 과반수 출석으로 회의를 열 수 있어요(성원)', '출석 과반수 찬성으로 의결, 찬반이 같으면 부결'], ref: '회칙 제11조②, 제12조' },
    { t: '회의록', li: ['회의록은 총무가 작성', '성원 여부를 회의록에 표시'], ref: '회칙 · 회의록 메뉴' },
    { t: '회의운영비·다과비', li: ['한 달에 2회 이내', '참석자 1인당 5,000원 이내', '주류·개인 용도는 쓸 수 없어요'], ref: '세칙 제3조' },
    { t: '지출 증빙', li: ['카드 전표·현금영수증·세금계산서만 적격 증빙', '영수증은 사진이나 PDF로 남겨요'], ref: '회칙 제16조⑤' },
    { t: '직접 집행 불가', li: ['공사·공용비품(서가·탁자·PC 등)은 관리주체가 집행', '승인된 예산을 넘거나 목적 외로 쓰면 안 돼요'], ref: '회칙 제13조②, 제16조⑥ · 세칙 제5조④' },
    { t: '회계', li: ['회계연도는 1월 1일~12월 31일', '쓰고 남은 지원금은 다음 해로 넘길 수 없어요', '감사보고서는 운영위원회와 입주자대표회의에 보고'], ref: '회칙 제17조, 제10조④' }
  ];

  async function load() {
    var r = await db.from('rule_versions').select('*').order('created_at', { ascending: false });
    if (r.error) throw r.error;
    versions = r.data;
  }
  function ofKind(k) { return versions.filter(function (v) { return v.kind === k; }); }
  function current() {
    var list = ofKind(kind);
    if (pickedId) { var p = list.filter(function (v) { return v.id === pickedId; })[0]; if (p) return p; }
    return list[0] || null;
  }

  // ---- 원문 나누기: 장 / 조 / 부칙 ----
  function parse(body) {
    var items = [], cur = null;
    body.split(/\r?\n/).forEach(function (raw) {
      var t = raw.trim(), m;
      if (/^제\s*\d+\s*장/.test(t)) { items.push({ type: 'chapter', title: t }); cur = null; }
      else if ((m = t.match(/^(제\s*\d+(?:\s*의\s*\d+)?\s*조\s*(?:\([^)]*\))?)\s*(.*)$/))) {
        cur = { type: 'article', title: m[1], lines: m[2] ? [m[2]] : [] }; items.push(cur);
      }
      else if (/^부\s*칙/.test(t)) { cur = { type: 'addendum', title: t, lines: [] }; items.push(cur); }
      else if (cur) cur.lines.push(raw.replace(/\s+$/, ''));
      else if (t) items.push({ type: 'pre', text: t });
    });
    items.forEach(function (it) { if (it.lines) it.text = it.lines.join('\n').replace(/^\n+|\n+$/g, ''); });
    return items;
  }

  function render() {
    app.textContent = '';
    app.appendChild(h('div', { class: 'top noprint' },
      h('div', null, h('div', { class: 'mark', text: '작은도서관 운영위원회' }), h('h1', { text: '회칙·세칙' })),
      h('div', { class: 'bar', style: 'margin:0' },
        h('button', { class: 'ghost', text: '인쇄', onclick: function () { window.print(); } }),
        isAdmin ? h('button', { class: 'primary', text: '원문 등록 · 개정', onclick: openDlg }) : null)));

    // 핵심 요약
    var sum = h('details', { class: 'sumcards noprint', open: window.innerWidth > 760 },
      h('summary', { class: 'sumhead', text: '핵심 요약 (눌러서 접고 펴기)' }),
      h('div', { class: 'cards' }, SUMMARY.map(function (s) {
        return h('div', { class: 'sumcard' }, h('h3', { text: s.t }), h('ul', null, s.li.map(function (x) { return h('li', { text: x }); })), h('div', { class: 'ref', text: s.ref }));
      })),
      h('div', { class: 'note', text: '위 카드는 위원회 기획서의 점검 기준을 쉬운 말로 줄인 요약이에요. 조항 번호와 내용은 아래 원문이 우선해요.' }));
    app.appendChild(sum);

    // 탭
    var tabs = h('div', { class: 'tabs noprint' }, ['회칙', '세칙'].map(function (k) {
      return h('button', { class: 'chip', 'aria-pressed': String(k === kind), text: k + (ofKind(k).length ? '' : ' (미등록)'),
        onclick: function () { kind = k; pickedId = null; term = ''; render(); } });
    }));
    app.appendChild(tabs);

    var v = current();
    if (!v) {
      app.appendChild(h('div', { class: 'empty', text: '아직 등록된 ' + kind + ' 원문이 없어요.' + (isAdmin ? ' 위의 "원문 등록 · 개정"으로 붙여 넣어 주세요.' : ' 관리자가 등록하면 여기에 나와요.') }));
      return;
    }
    var items = parse(v.body);
    var meta = (v.effective_date ? '시행일 ' + U.fmtDate(v.effective_date) + ' · ' : '') + '등록 ' + U.fmtDate(v.created_at.slice(0, 10)) +
      (v.created_by_name ? ' (' + v.created_by_name + ')' : '') + (v.note ? ' · ' + v.note : '');
    app.appendChild(h('div', { class: 'metaline' }, h('strong', { text: kind + (ofKind(kind)[0] === v ? ' 현재본' : ' (이전 버전)') }), ' · ' + meta));

    var input = h('input', { type: 'text', placeholder: '찾을 말 (예: 회의비, 임기, 영수증)', 'aria-label': '원문 검색' });
    input.value = term;
    input.oninput = function () { term = input.value.trim(); draw(); };
    app.appendChild(h('div', { class: 'search noprint' }, input,
      h('button', { class: 'ghost', text: '지우기', onclick: function () { term = ''; input.value = ''; draw(); } })));

    var tocBox = h('div', { class: 'toc noprint' }), docBox = h('div', { class: 'doc' });
    app.appendChild(h('div', { class: 'layout' }, tocBox, docBox));

    function draw() {
      tocBox.textContent = ''; docBox.textContent = '';
      var low = term.toLowerCase(), shown = 0, idx = 0;
      items.forEach(function (it) {
        if (it.type === 'chapter') {
          var id = 'x' + (idx++);
          if (!term) { docBox.appendChild(h('h2', { class: 'ch', id: id, text: it.title })); tocBox.appendChild(h('a', { class: 'ch', href: '#' + id, text: it.title })); }
        } else if (it.type === 'pre') {
          if (!term) docBox.appendChild(h('div', { class: 'art' }, h('div', { class: 'ab', text: it.text })));
        } else {
          var hit = !term || (it.title + '\n' + it.text).toLowerCase().indexOf(low) >= 0;
          if (!hit) return;
          shown++;
          var aid = 'x' + (idx++);
          var ah = h('div', { class: 'ah' }); ah.appendChild(U.highlight(it.title, term));
          var ab = h('div', { class: 'ab' }); ab.appendChild(U.highlight(it.text, term));
          docBox.appendChild(h('div', { class: 'art' + (it.type === 'addendum' ? ' add' : ''), id: aid }, ah, it.text ? ab : null));
          tocBox.appendChild(h('a', { href: '#' + aid, text: it.title.length > 26 ? it.title.slice(0, 26) + '…' : it.title }));
        }
      });
      if (term && !shown) docBox.appendChild(h('div', { class: 'hint', text: '"' + term + '"이(가) 들어 있는 조문이 없어요.' }));
      if (term && shown) tocBox.insertBefore(h('div', { class: 'hint', text: shown + '개 조문' }), tocBox.firstChild);
      if (!items.some(function (i) { return i.type !== 'pre'; })) docBox.appendChild(h('div', { class: 'art' }, h('div', { class: 'ab', text: v.body })));
    }
    draw();

    // 개정 이력
    var list = ofKind(kind);
    if (list.length > 1 || isAdmin) {
      var hist = h('div', { class: 'panel hist noprint', style: 'margin-top:14px' }, h('h2', { text: '개정 이력' }));
      list.forEach(function (x, i) {
        var label = (x.effective_date ? U.fmtDate(x.effective_date) : U.fmtDate(x.created_at.slice(0, 10))) + (x.note ? ' · ' + x.note : '') + (i === 0 ? ' (현재)' : '');
        var row = h('div', { class: 'bar', style: 'margin:2px 0' },
          h('button', { class: x.id === v.id ? 'primary' : 'ghost', text: label, onclick: function () { pickedId = i === 0 ? null : x.id; render(); } }));
        if (isAdmin) row.appendChild(h('button', { class: 'linkbtn danger', text: '이 버전 삭제', onclick: function () { removeVersion(x); } }));
        hist.appendChild(row);
      });
      app.appendChild(hist);
    }
  }

  async function removeVersion(x) {
    if (!(await askBox('이 버전을 삭제할까요? 잘못 등록한 경우에만 지워 주세요. 되돌릴 수 없어요.', '삭제'))) return;
    var r = await db.from('rule_versions').delete().eq('id', x.id);
    if (r.error) { U.fail(r.error); return; }
    pickedId = null; await reload(); U.notice('ok', '삭제했어요.');
  }

  // ---- 등록 · 개정 (관리자) ----
  var dlg = $('dlg');
  function openDlg() {
    $('f-kind').value = kind; $('f-date').value = ''; $('f-note').value = '';
    var cur = ofKind(kind)[0]; $('f-body').value = cur ? cur.body : '';
    dlg.showModal();
  }
  $('f-kind').onchange = function () { var cur = ofKind($('f-kind').value)[0]; $('f-body').value = cur ? cur.body : ''; };
  $('f-cancel').onclick = function () { dlg.close(); };
  $('form').onsubmit = async function (e) {
    e.preventDefault();
    var body = $('f-body').value.trim();
    if (!body) return;
    var btn = $('f-save'); btn.disabled = true;
    var r = await db.from('rule_versions').insert({
      kind: $('f-kind').value, body: body, effective_date: $('f-date').value || null, note: $('f-note').value.trim(), created_by_name: me.name || ''
    });
    btn.disabled = false;
    if (r.error) { U.fail(r.error); dlg.close(); return; }
    dlg.close(); kind = $('f-kind').value; pickedId = null;
    await reload(); U.notice('ok', '등록했어요. 이전 버전은 개정 이력에 남아 있어요.');
  };

  async function reload() { try { await load(); render(); } catch (e) { U.fail(e); } }
  reload();
});
