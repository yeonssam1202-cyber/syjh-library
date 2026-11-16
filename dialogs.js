// 확인·안내창. 브라우저 기본 팝업(confirm/alert)은 앱 안 브라우저 등에서 막힐 수 있어 화면 안 창을 씁니다.
// 사용: if (!(await askBox('삭제할까요?', '삭제'))) return;   await sayBox('안내 문구');
(function () {
  function askBox(msg, okText, noText) {
    return new Promise(function (done) {
      var dlg = document.createElement('dialog');
      dlg.style.cssText = 'margin:auto;border:1px solid #dde3ec;border-radius:8px;padding:20px;width:min(420px,calc(100vw - 24px));color:#201f1d;font:16px/1.6 "Malgun Gothic",-apple-system,sans-serif';
      var p = document.createElement('div');
      p.textContent = msg; p.style.cssText = 'white-space:pre-wrap;margin-bottom:16px';
      var bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
      function finish(v) { dlg.close(); dlg.remove(); done(v); }
      function mk(text, primary, v) {
        var b = document.createElement('button'); b.type = 'button'; b.textContent = text;
        b.style.cssText = 'font:inherit;cursor:pointer;border-radius:4px;padding:10px 18px;' +
          (primary ? 'background:#1f4b8f;color:#fff;border:0;font-weight:700' : 'background:#fff;color:#201f1d;border:1px solid #dde3ec');
        b.onclick = function () { finish(v); };
        return b;
      }
      if (noText !== null) bar.appendChild(mk(noText || '취소', false, false));
      bar.appendChild(mk(okText || '확인', true, true));
      dlg.appendChild(p); dlg.appendChild(bar);
      dlg.addEventListener('cancel', function (e) { e.preventDefault(); finish(false); });
      document.body.appendChild(dlg); dlg.showModal();
    });
  }
  window.askBox = askBox;
  window.sayBox = function (msg) { return askBox(msg, '확인', null); };
})();

// ---- 모든 보호 화면이 함께 쓰는 작은 도우미 ----
// 1) actOnce(fn): 버튼을 눌러 처리하는 동안 버튼을 잠가서 두 번 눌러도 한 번만 처리해요(승인·응답·검토 등).
//    사용: onclick: actOnce(async function () { ... })
window.actOnce = function (fn) {
  return async function (ev) {
    var b = ev && ev.currentTarget;
    if (b && b.dataset && b.dataset.busy) return;
    if (b && b.dataset) { b.dataset.busy = '1'; b.disabled = true; }
    try { return await fn.apply(this, arguments); }
    finally { if (b && b.dataset) { delete b.dataset.busy; b.disabled = false; } }
  };
};
// 2) loadingBox(): 화면 자료를 불러오는 동안 보여 주는 "불러오는 중…" 표시(화면이 새로 그려지면 자동으로 사라져요)
window.loadingBox = function (text) {
  var d = document.createElement('div');
  d.className = 'loadingbox'; d.setAttribute('role', 'status'); d.setAttribute('data-state', 'loading');
  d.style.cssText = 'padding:40px 0;text-align:center;color:#6c6b69;font-size:16px';
  d.textContent = text || '불러오는 중…';
  return d;
};
// 3) Unsaved: 작성 화면에서 저장하지 않은 내용이 있으면 닫기·새로고침·"← 목록" 때 한 번 물어봐요.
//    watch(영역) 은 화면 시작 때 한 번만, start() 는 작성 화면을 그린 직후, clear() 는 저장·이동 뒤에 불러요.
window.Unsaved = (function () {
  var s = { dirty: false, armed: false }, bound = false;
  function onUnload(e) { if (s.dirty) { e.preventDefault(); e.returnValue = ''; return ''; } }
  s.watch = function (el) {
    if (bound) return; bound = true;
    window.addEventListener('beforeunload', onUnload);
    var mark = function (ev) { if (s.armed && !(ev && ev.target && ev.target.type === 'file')) s.dirty = true; };   // 사진 올리기는 바로 저장되니 제외
    el.addEventListener('input', mark); el.addEventListener('change', mark);
  };
  s.start = function () { s.armed = true; s.dirty = false; };
  s.clear = function () { s.armed = false; s.dirty = false; };
  s.confirmLeave = async function () {
    if (!s.dirty) return true;
    var ok = await window.askBox('저장하지 않은 내용이 있어요. 나가면 사라져요. 나갈까요?', '나가기', '계속 작성');
    if (ok) s.clear();
    return ok;
  };
  return s;
})();
