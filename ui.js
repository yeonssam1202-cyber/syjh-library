// 회칙·세칙 / 예산·지출 / 근무표 화면이 함께 쓰는 도우미 (DOM 만들기, 안내 문구, 형식)
window.UI = (function () {
  function add(e, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(e, x); }); return; }
    e.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  // h('div', {class:'x', text:'..', onclick:fn}, ...children) — 사용자 글은 항상 textContent로만 넣습니다.
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
  var $ = function (id) { return document.getElementById(id); };
  function notice(kind, text) {
    var n = $('notice'); if (!n) return;
    n.className = 'notice noprint' + (text ? ' ' + kind : '');
    n.textContent = text || '';
  }
  function friendly(e) {
    var m = (e && e.message) || String(e);
    if (/does not exist|schema cache|Could not find the table/i.test(m)) return '이 기능의 저장소가 아직 준비되지 않았어요. 관리자가 해당 supabase-*.sql 을 실행해야 해요.';
    if (/row-level security/i.test(m)) return '권한이 없어요. 기록한 사람이나 관리자만 할 수 있어요.';
    if (/duplicate key|unique/i.test(m)) return '이미 있는 항목이에요.';
    if (/violates check constraint/i.test(m)) return '입력한 값이 허용 범위를 벗어났어요. 내용을 다시 확인해 주세요.';
    if (/foreign key/i.test(m)) return '다른 기록과 연결돼 있어서 지울 수 없어요.';
    return m;
  }
  function fail(e) { notice('err', friendly(e)); }
  function won(n) { return Number(n || 0).toLocaleString('ko-KR') + '원'; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return ymd(new Date()); }
  function parseYmd(s) { var a = s.split('-').map(Number); return new Date(a[0], a[1] - 1, a[2]); }
  function fmtDate(s) { return s ? s.replace(/-/g, '.') + '.' : ''; }
  // 검색어 강조(안전하게 DOM으로)
  function highlight(text, term) {
    var frag = document.createDocumentFragment();
    if (!term) { frag.appendChild(document.createTextNode(text)); return frag; }
    var low = text.toLowerCase(), t = term.toLowerCase(), i = 0, j;
    while ((j = low.indexOf(t, i)) >= 0) {
      if (j > i) frag.appendChild(document.createTextNode(text.slice(i, j)));
      frag.appendChild(h('mark', { text: text.slice(j, j + t.length) }));
      i = j + t.length;
    }
    if (i < text.length) frag.appendChild(document.createTextNode(text.slice(i)));
    return frag;
  }
  return { add: add, h: h, $: $, notice: notice, friendly: friendly, fail: fail, won: won, pad: pad, ymd: ymd, today: today, parseYmd: parseYmd, fmtDate: fmtDate, highlight: highlight };
})();
