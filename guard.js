// 보호할 화면의 <head>에 넣는 검사 스크립트. 로그인 + 관리자 승인을 통과해야 화면을 보여 줍니다.
(function () {
  var me = document.currentScript;
  var base = me.src.replace(/guard\.js(\?.*)?$/, "");
  var loginUrl = base + "index.html";
  var hide = document.createElement("style");
  hide.textContent = "html{visibility:hidden!important}";
  document.head.appendChild(hide);

  // 폰 홈 화면에 추가할 때 쓰는 아이콘과 이름
  (function () {
    function tag(name, attrs) { var e = document.createElement(name); Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); }); document.head.appendChild(e); }
    tag("link", { rel: "manifest", href: base + "manifest.webmanifest" });
    tag("link", { rel: "apple-touch-icon", href: base + "apple-touch-icon.png" });
    tag("meta", { name: "theme-color", content: "#14305c" });
    tag("meta", { name: "apple-mobile-web-app-capable", content: "yes" });
    tag("meta", { name: "apple-mobile-web-app-title", content: "작은도서관" });
  })();
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

  function connProblem() {
    hide.remove();
    var box = document.createElement("div");
    box.style.cssText = "position:fixed;inset:0;z-index:100001;background:#fff;display:flex;align-items:center;justify-content:center;padding:24px;font:16px/1.6 -apple-system,'Malgun Gothic',sans-serif;color:#201f1d";
    var inner = document.createElement("div"); inner.style.cssText = "max-width:380px;text-align:center";
    var t = document.createElement("div"); t.style.cssText = "font-size:20px;font-weight:700;margin-bottom:8px"; t.textContent = "연결이 불안정해요";
    var m = document.createElement("div"); m.style.cssText = "color:#6c6b69;margin-bottom:16px"; m.textContent = "인터넷 연결을 확인한 뒤 다시 시도해 주세요. 로그인은 그대로 유지돼요.";
    var b = document.createElement("button"); b.textContent = "다시 시도"; b.style.cssText = "background:#1f4b8f;color:#fff;border:0;border-radius:6px;padding:12px 22px;font:inherit;font-weight:700;cursor:pointer";
    b.onclick = function () { location.reload(); };
    inner.appendChild(t); inner.appendChild(m); inner.appendChild(b); box.appendChild(inner); document.body.appendChild(box);
  }
  function watchSession(p) {
    // 다른 탭에서 로그아웃하면 이 탭도 로그인 화면으로
    try { Auth.client.auth.onAuthStateChange(function (evt) { if (evt === "SIGNED_OUT") location.replace(loginUrl); }); } catch (e) {}
    // 탭으로 돌아올 때(1분 이상 지났으면) 승인 상태·직책이 바뀌었는지 다시 확인
    var last = Date.now();
    document.addEventListener("visibilitychange", async function () {
      if (document.visibilityState !== "visible" || Date.now() - last < 60000) return;
      last = Date.now();
      var q; try { q = await Auth.getProfile(); } catch (e) { return; }
      if (!q || q.status === "error") return;                       // 연결 문제는 무시
      if (q.status !== "approved") { await Auth.client.auth.signOut(); location.replace(loginUrl); return; }
      if (q.role !== p.role || q.position !== p.position || q.shift_manager !== p.shift_manager) {
        if (document.getElementById("perm-changed")) return;
        var bn = document.createElement("div"); bn.id = "perm-changed";
        bn.style.cssText = "position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:100002;background:#fff3e0;color:#8a5a00;border:1px solid #f0d9a8;border-radius:8px;padding:10px 14px;font:14px/1.4 -apple-system,'Malgun Gothic',sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.12)";
        bn.appendChild(document.createTextNode("직책이나 권한이 바뀌었어요. "));
        var rb = document.createElement("button"); rb.textContent = "새로고침"; rb.style.cssText = "margin-left:6px;border:0;background:#1f4b8f;color:#fff;border-radius:4px;padding:5px 10px;cursor:pointer";
        rb.onclick = function () { location.reload(); }; bn.appendChild(rb); document.body.appendChild(bn);
      }
    });
  }
  function addLogoutBar(p) {
    var bar = document.createElement("div");
    bar.id = "app-bar";
    bar.style.cssText = "position:fixed;top:10px;right:14px;max-width:calc(100vw - 28px);z-index:100000;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;" +
      "background:#fff;border:1px solid #ddd;border-radius:18px;padding:6px 8px 6px 14px;font:13px/1.2 -apple-system,'Malgun Gothic',sans-serif;color:#201f1d;box-shadow:0 1px 6px rgba(0,0,0,.08)";
    var links = [["홈", "home.html"], ["공지", "notices.html"], ["회의 일정", "schedule.html"], ["회의록", "minutes.html"], ["업무 목록", "tasks.html"], ["근무표", "shifts.html"]];
    if (p.isVolunteer || p.can("shifts_approve")) links.push(["봉사 시간", "volunteer.html"]);
    links.push(["예산·지출", "budget.html"], ["감사 보고서", "audit.html"], ["회칙·세칙", "rules.html"], ["자료실", "documents.html"], ["내 정보", "myinfo.html"]);
    if (p.can("export_basic")) links.push(["내보내기", "export.html"]);
    if (p.role === "admin") links.push(["회원 승인", "members.html"]);
    var box = document.createElement("div");
    box.id = "bar-links";
    box.style.cssText = "display:flex;flex-wrap:wrap;gap:4px 16px;align-items:center";
    links.forEach(function (l) {
      var a = document.createElement("a");
      a.textContent = l[0]; a.href = base + l[1];
      a.style.cssText = "color:#14305c;text-decoration:none;font-weight:600";
      if (location.pathname.split("/").pop() === l[1]) { a.setAttribute("aria-current", "page"); a.style.borderBottom = "2px solid #1f4b8f"; }
      box.appendChild(a);
    });
    bar.appendChild(box);
    var toggle = document.createElement("button");
    toggle.className = "bar-toggle";
    toggle.textContent = "메뉴 ▲";
    toggle.style.cssText = "display:none;border:1px solid #ddd;background:#fff;color:#14305c;border-radius:999px;font:inherit;font-weight:600;cursor:pointer";
    toggle.onclick = function () { bar.classList.toggle("open"); toggle.textContent = bar.classList.contains("open") ? "메뉴 ▼" : "메뉴 ▲"; };
    bar.appendChild(toggle);
    var who = document.createElement("span");
    who.textContent = (p.name || p.email || "") + (p.role === "admin" ? " (관리자)" : "");
    var btn = document.createElement("button");
    btn.textContent = "로그아웃";
    btn.style.cssText = "border:0;background:#1f4b8f;color:#fff;font-weight:700;border-radius:999px;padding:7px 12px;font:inherit;cursor:pointer";
    btn.onclick = async function () { await Auth.client.auth.signOut(); location.replace(loginUrl); };
    bar.appendChild(who); bar.appendChild(btn);
    // 폰 배치 규칙을 바 안에 함께 넣어, 화면이 통째로 교체돼도 같이 유지되게 합니다.
    var st = document.createElement("style");
    st.textContent = "@media (max-width:820px){#app-bar{top:auto!important;bottom:10px!important;left:10px!important;right:10px!important;max-width:none!important;" +
      "justify-content:space-between!important;row-gap:4px!important;border-radius:14px!important;padding:6px 10px!important;font-size:15px!important}" +
      "#bar-links{display:none!important;width:100%;flex-wrap:wrap;gap:2px 6px;padding-bottom:6px;border-bottom:1px solid #eee}" +
      "#app-bar.open #bar-links{display:flex!important}#bar-links a{padding:11px 10px;background:#f5f7fb;border-radius:8px}" +
      "#app-bar .bar-toggle{display:inline-block!important}#app-bar button{padding:9px 14px!important}#app-bar span{display:none!important}body{padding-bottom:72px!important}}" +
      "@media print{#app-bar{display:none!important}}";
    bar.appendChild(st);
    document.body.appendChild(bar);
  }

  (async function () {
    try {
      await load(base + "config.js");
      await load("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js");
      await load(base + "auth.js?v=5");
      await load(base + "dialogs.js?v=2");
      await load(base + "states.js?v=1");
      var p = Auth.configured ? await Auth.getProfile() : null;
      if (p && p.status === "error") { connProblem(); return; }          // 연결 문제: 로그인 화면으로 보내지 않고 다시 시도하게 해요
      if (!p || p.status !== "approved") { location.replace(loginUrl); return; }
      hide.remove();
      resolveAuthed(p);
      watchSession(p);
      // 시안 화면 스크립트가 로딩 중 본문을 교체하면 바가 사라지므로, 없으면 다시 붙입니다.
      setInterval(function () {
        if (document.body && !document.getElementById("app-bar")) addLogoutBar(p);
      }, 500);
    } catch (e) {
      connProblem();
    }
  })();
})();
