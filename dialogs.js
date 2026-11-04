// 확인·안내창. 브라우저 기본 팝업(confirm/alert)은 앱 안 브라우저 등에서 막힐 수 있어 화면 안 창을 씁니다.
// 사용: if (!(await askBox('삭제할까요?', '삭제'))) return;   await sayBox('안내 문구');
(function () {
  function askBox(msg, okText, noText) {
    return new Promise(function (done) {
      var dlg = document.createElement('dialog');
      dlg.style.cssText = 'margin:auto;border:1px solid #d3e2d8;border-radius:8px;padding:20px;width:min(420px,calc(100vw - 24px));color:#201f1d;font:16px/1.6 "Malgun Gothic",-apple-system,sans-serif';
      var p = document.createElement('div');
      p.textContent = msg; p.style.cssText = 'white-space:pre-wrap;margin-bottom:16px';
      var bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
      function finish(v) { dlg.close(); dlg.remove(); done(v); }
      function mk(text, primary, v) {
        var b = document.createElement('button'); b.type = 'button'; b.textContent = text;
        b.style.cssText = 'font:inherit;cursor:pointer;border-radius:4px;padding:10px 18px;' +
          (primary ? 'background:#11bf53;color:#0b2a4a;border:0;font-weight:700' : 'background:#fff;color:#201f1d;border:1px solid #d3e2d8');
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
