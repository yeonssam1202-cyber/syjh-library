// 보호할 화면의 <head>에 넣는 검사 스크립트. 로그인 + 관리자 승인을 통과해야 화면을 보여 줍니다.
(function () {
  var me = document.currentScript;
  var base = me.src.replace(/guard\.js(\?.*)?$/, "");
  var loginUrl = base + "index.html";
  var hide = document.createElement("style");
  hide.textContent = "html{visibility:hidden!important}";
  document.head.appendChild(hide);

  function load(src) {
    return new Promise(function (ok, fail) {
      var s = document.createElement("script");
      s.src = src; s.onload = ok; s.onerror = fail;
      document.head.appendChild(s);
    });
  }

  // 보호된 화면의 스크립트는 window.whenAuthed.then(profile => ...) 로 인증 완료 후 시작합니다.
  var resolveAuthed;
  window.whenAuthed = new Promise(function (ok) { resolveAuthed = ok; });

  function addLogoutBar(p) {
    var bar = document.createElement("div");
    bar.id = "app-bar";
    bar.style.cssText = "position:fixed;top:10px;right:14px;max-width:calc(100vw - 28px);z-index:100000;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;" +
      "background:#fff;border:1px solid #ddd;border-radius:18px;padding:6px 8px 6px 14px;font:13px/1.2 -apple-system,'Malgun Gothic',sans-serif;color:#201f1d;box-shadow:0 1px 6px rgba(0,0,0,.08)";
    var links = [["홈", "app.html"], ["공지", "notices.html"], ["업무 목록", "tasks.html"], ["회의록", "minutes.html"], ["예산·지출", "budget.html"],
      ["근무표", "shifts.html"], ["회칙·세칙", "rules.html"], ["자료실", "documents.html"]];
    if (p.role === "admin") links.push(["회원 승인", "members.html"]);
    var box = document.createElement("div");
    box.id = "bar-links";
    box.style.cssText = "display:flex;flex-wrap:wrap;gap:4px 16px;align-items:center";
    links.forEach(function (l) {
      var a = document.createElement("a");
      a.textContent = l[0]; a.href = base + l[1];
      a.style.cssText = "color:#0a7d36;text-decoration:none;font-weight:600";
      box.appendChild(a);
    });
    bar.appendChild(box);
    var toggle = document.createElement("button");
    toggle.className = "bar-toggle";
    toggle.textContent = "메뉴 ▲";
    toggle.style.cssText = "display:none;border:1px solid #ddd;background:#fff;color:#0a7d36;border-radius:999px;font:inherit;font-weight:600;cursor:pointer";
    toggle.onclick = function () { bar.classList.toggle("open"); toggle.textContent = bar.classList.contains("open") ? "메뉴 ▼" : "메뉴 ▲"; };
    bar.appendChild(toggle);
    var who = document.createElement("span");
    who.textContent = (p.name || p.email || "") + (p.role === "admin" ? " (관리자)" : "");
    var btn = document.createElement("button");
    btn.textContent = "로그아웃";
    btn.style.cssText = "border:0;background:#11bf53;color:#0b2a4a;font-weight:700;border-radius:999px;padding:7px 12px;font:inherit;cursor:pointer";
    btn.onclick = async function () { await Auth.client.auth.signOut(); location.replace(loginUrl); };
    bar.appendChild(who); bar.appendChild(btn);
    // 폰 배치 규칙을 바 안에 함께 넣어, 화면이 통째로 교체돼도 같이 유지되게 합니다.
    var st = document.createElement("style");
    st.textContent = "@media (max-width:820px){#app-bar{top:auto!important;bottom:10px!important;left:10px!important;right:10px!important;max-width:none!important;" +
      "justify-content:space-between!important;row-gap:4px!important;border-radius:14px!important;padding:6px 10px!important;font-size:15px!important}" +
      "#bar-links{display:none!important;width:100%;flex-wrap:wrap;gap:2px 6px;padding-bottom:6px;border-bottom:1px solid #eee}" +
      "#app-bar.open #bar-links{display:flex!important}#bar-links a{padding:11px 10px;background:#f0f9f3;border-radius:8px}" +
      "#app-bar .bar-toggle{display:inline-block!important}#app-bar button{padding:9px 14px!important}#app-bar span{display:none!important}body{padding-bottom:72px!important}}" +
      "@media print{#app-bar{display:none!important}}";
    bar.appendChild(st);
    document.body.appendChild(bar);
  }

  (async function () {
    try {
      await load(base + "config.js");
      await load("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js");
      await load(base + "auth.js?v=4");
      await load(base + "dialogs.js?v=1");
      var p = Auth.configured ? await Auth.getProfile() : null;
      if (!p || p.status !== "approved") { location.replace(loginUrl); return; }
      hide.remove();
      resolveAuthed(p);
      // 시안 화면 스크립트가 로딩 중 본문을 교체하면 바가 사라지므로, 없으면 다시 붙입니다.
      setInterval(function () {
        if (document.body && !document.getElementById("app-bar")) addLogoutBar(p);
      }, 500);
    } catch (e) {
      location.replace(loginUrl);
    }
  })();
})();
