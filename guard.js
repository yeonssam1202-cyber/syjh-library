// 보호할 화면의 <head>에 넣는 검사 스크립트. 로그인 + 관리자 승인을 통과해야 화면을 보여 줍니다.
(function () {
  var me = document.currentScript;
  var base = me.src.replace(/guard\.js(\?.*)?$/, "");
  var loginUrl = base + "index.html";
  var hide = document.createElement("style");
  hide.textContent = "html{visibility:hidden!important}";
  document.head.appendChild(hide);

  // ---- 보안 설정 ----
  // 1) 다른 사이트의 틀(iframe) 안에 이 화면을 끼워 넣는 것(클릭 가로채기)을 막아요.
  if (window.top !== window.self) { document.documentElement.innerHTML = ""; try { window.top.location = window.self.location; } catch (e) {} throw new Error("framed"); }
  // 2) 허용한 곳(이 사이트, 지정한 라이브러리, Supabase)만 연결하도록 제한하고, 방문 기록(주소)이 다른 사이트에 넘어가지 않게 해요.
  //    (개관 준비 화면은 외부 디자인 라이브러리를 쓰는 시안이라 제외)
  (function () {
    var m = document.createElement("meta"); m.name = "referrer"; m.content = "same-origin"; document.head.appendChild(m);
    if (/checklist.html$/.test(location.pathname)) return;
    var c = document.createElement("meta"); c.httpEquiv = "Content-Security-Policy";
    c.content = "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.supabase.co; font-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; object-src 'none'; base-uri 'self'; form-action 'self'; frame-src 'none'";
    document.head.appendChild(c);
  })();

  // 폰 홈 화면에 추가할 때 쓰는 아이콘과 이름
  (function () {
    function tag(name, attrs) { var e = document.createElement(name); Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); }); document.head.appendChild(e); }
    tag("link", { rel: "manifest", href: base + "manifest.webmanifest" });
    tag("link", { rel: "apple-touch-icon", href: base + "apple-touch-icon.png" });
    tag("meta", { name: "theme-color", content: "#14305c" });
    tag("meta", { name: "apple-mobile-web-app-capable", content: "yes" });
    tag("meta", { name: "apple-mobile-web-app-title", content: "작은도서관" });
  })();
  function load(src, integrity) {
    return new Promise(function (ok, fail) {
      var s = document.createElement("script");
      if (integrity) { s.integrity = integrity; s.crossOrigin = "anonymous"; }   // 내용이 바뀐 파일은 실행하지 않아요
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
  // ---- 상단(폰은 아래) 메뉴: 대분류 6개 + 그 안의 메뉴 ----
  function menuGroups(p) {
    var work = [["업무 목록", "tasks.html"], ["근무표", "shifts.html"]];
    if (p.isVolunteer || p.can("shifts_approve")) work.push(["봉사 시간", "volunteer.html"]);
    work.push(["개관 준비", "checklist.html"]);
    var mine = [["내 정보", "myinfo.html"]];
    if (p.can("export_basic")) mine.push(["내보내기", "export.html"]);
    mine.push(["홈 화면에 추가", "install.html"]);
    if (p.role === "admin") mine.push(["회원 승인", "members.html"]);
    return [
      { name: "홈", short: "홈", items: [["홈", "home.html"]] },
      { name: "회의·공지", short: "회의·공지", items: [["공지", "notices.html"], ["회의 일정", "schedule.html"], ["날짜 투표", "poll.html"], ["회의록", "minutes.html"]] },
      { name: "업무·근무", short: "업무·근무", items: work },
      { name: "회계", short: "회계", items: [["예산·지출", "budget.html"], ["감사 보고서", "audit.html"]] },
      { name: "자료", short: "자료", items: [["회칙·세칙", "rules.html"], ["자료실", "documents.html"]] },
      { name: "내 정보·관리", short: "내 정보", items: mine }
    ];
  }
  // 메뉴 아이콘 (선 그림). 이름 → 그릴 선(path) 목록
  var ICONS = {
    home: ["M3 11l9-8 9 8", "M5 10v10h14V10"],
    chat: ["M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-5.5A8 8 0 1 1 21 12z"],
    task: ["M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M8 9l2 2 4-4", "M8 16h8"],
    won: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M8 9l1.5 6L12 10l2.5 5L16 9"],
    book: ["M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z", "M4 19V5"],
    user: ["M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M4 21c0-4 4-6 8-6s8 2 8 6"]
  };
  var GROUP_ICON = { "홈": "home", "회의·공지": "chat", "업무·근무": "task", "회계": "won", "자료": "book", "내 정보·관리": "user" };
  function icon(name) {
    var NS = "http://www.w3.org/2000/svg", s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "ab-i"); s.setAttribute("aria-hidden", "true");
    (ICONS[name] || []).forEach(function (d) { var p = document.createElementNS(NS, "path"); p.setAttribute("d", d); s.appendChild(p); });
    return s;
  }
  // 컴퓨터: 왼쪽 메뉴(현재 대분류가 펼쳐져요) / 폰: 아래 탭 메뉴(누르면 세부 메뉴가 위로 펼쳐져요)
  function addLogoutBar(p) {
    var page = location.pathname.split("/").pop() || "home.html";
    var groups = menuGroups(p), cur = null;
    groups.forEach(function (g) { if (g.items.some(function (i) { return i[1] === page; })) cur = g; });
    var isPhone = function () { return window.matchMedia("(max-width:820px)").matches; };
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    var who = (p.name || p.email || "") + (p.role === "admin" ? " (관리자)" : "");

    var bar = el("div"); bar.id = "app-bar";

    // ---- 컴퓨터: 왼쪽 메뉴 ----
    var side = el("aside", "ab-side"); side.setAttribute("aria-label", "메뉴");
    var logo = el("a", "ab-logo"); logo.href = base + "home.html"; logo.setAttribute("aria-label", "홈");
    var img = el("img"); img.src = base + "logo.png"; img.alt = "The Platinum"; logo.appendChild(img); side.appendChild(logo);
    var list = el("nav", "ab-list"); list.setAttribute("aria-label", "대분류 메뉴");
    groups.forEach(function (g) {
      var a = el("a", "ab-g" + (g === cur ? " cur" : "")); a.href = base + g.items[0][1];
      a.appendChild(icon(GROUP_ICON[g.name])); a.appendChild(el("span", "", g.name));
      if (g === cur) a.setAttribute("aria-current", "true");
      list.appendChild(a);
      if (g === cur && g.items.length > 1) {
        var sub = el("div", "ab-subs");
        g.items.forEach(function (i) { var s = el("a", "ab-s" + (i[1] === page ? " cur" : ""), i[0]); s.href = base + i[1]; if (i[1] === page) s.setAttribute("aria-current", "page"); sub.appendChild(s); });
        list.appendChild(sub);
      }
    });
    side.appendChild(list);
    var user = el("div", "ab-user"); user.appendChild(el("div", "ab-who", who));
    var lo = el("button", "ab-lo", "로그아웃"); lo.onclick = doLogout; user.appendChild(lo); side.appendChild(user);
    bar.appendChild(side);

    // ---- 폰: 아래 탭 + 위로 펼쳐지는 세부 메뉴 ----
    var tabs = el("nav", "ab-tabs"); tabs.setAttribute("aria-label", "대분류 메뉴");
    var sheet = el("div", "ab-sheet");
    function closeSheet() { sheet.classList.remove("open"); sheet.removeAttribute("data-for"); }
    function openSheet(g) {
      sheet.textContent = "";
      g.items.forEach(function (i) {
        var a = el("a", "ab-si" + (i[1] === page ? " cur" : ""), i[0]); a.href = base + i[1];
        if (i[1] === page) a.setAttribute("aria-current", "page");
        sheet.appendChild(a);
      });
      if (g.short === "내 정보") {
        var u = el("div", "ab-su", who); var b2 = el("button", "ab-lo2", "로그아웃"); b2.onclick = doLogout; u.appendChild(b2); sheet.appendChild(u);
      }
      sheet.classList.add("open"); sheet.setAttribute("data-for", g.name);
    }
    groups.forEach(function (g) {
      var a = el("a", "ab-t" + (g === cur ? " cur" : "")); a.href = base + g.items[0][1];
      a.appendChild(icon(GROUP_ICON[g.name])); a.appendChild(el("span", "", g.short));
      if (g === cur) a.setAttribute("aria-current", "true");
      a.onclick = function (ev) {
        if (!isPhone()) return;
        if (g.items.length === 1) return;
        ev.preventDefault();
        if (sheet.getAttribute("data-for") === g.name) closeSheet(); else openSheet(g);
      };
      tabs.appendChild(a);
    });
    bar.appendChild(sheet); bar.appendChild(tabs);
    document.addEventListener("click", function (ev) { if (!bar.contains(ev.target)) closeSheet(); });

    var st = el("style");
    st.textContent =
      "#app-bar .ab-i{width:1.35em;height:1.35em;stroke:currentColor;fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;flex:none}" +
      "#app-bar{font:15px/1.3 -apple-system,'Malgun Gothic',sans-serif}" +
      /* 컴퓨터: 왼쪽 메뉴 */
      "#app-bar .ab-side{position:fixed;top:0;left:0;bottom:0;width:220px;z-index:100000;background:#14305c;color:#cfdcf2;display:flex;flex-direction:column;padding:16px 12px;overflow-y:auto}" +
      "#app-bar .ab-logo{display:block;background:#fff;border-radius:10px;padding:8px 10px;margin:0 2px 18px;text-align:center}" +
      "#app-bar .ab-logo img{height:34px;width:auto;display:inline-block;vertical-align:middle}" +
      "#app-bar .ab-list{display:flex;flex-direction:column;gap:2px}" +
      "#app-bar .ab-g{display:flex;align-items:center;gap:11px;padding:11px 12px;border-radius:9px;color:#cfdcf2;text-decoration:none;font-weight:700;font-size:15.5px}" +
      "#app-bar .ab-g:hover{background:rgba(255,255,255,.10)}#app-bar .ab-g.cur{background:#fff;color:#14305c}" +
      "#app-bar .ab-subs{display:flex;flex-direction:column;margin:2px 0 6px 22px;padding-left:12px;border-left:2px solid rgba(255,255,255,.22)}" +
      "#app-bar .ab-s{padding:8px 10px;border-radius:7px;color:#b9c9e6;text-decoration:none;font-size:14.5px;font-weight:600}" +
      "#app-bar .ab-s:hover{background:rgba(255,255,255,.10);color:#fff}#app-bar .ab-s.cur{color:#fff;font-weight:800;background:rgba(255,255,255,.16)}" +
      "#app-bar .ab-user{margin-top:auto;padding:14px 6px 2px;border-top:1px solid rgba(255,255,255,.18)}" +
      "#app-bar .ab-who{font-size:13.5px;color:#cfdcf2;margin-bottom:8px;word-break:keep-all}" +
      "#app-bar .ab-lo{width:100%;border:1px solid rgba(255,255,255,.4);background:transparent;color:#fff;font:inherit;font-weight:700;border-radius:8px;padding:8px 10px;cursor:pointer}" +
      "#app-bar .ab-lo:hover{background:rgba(255,255,255,.12)}" +
      "#app-bar .ab-tabs,#app-bar .ab-sheet{display:none}" +
      "@media screen and (min-width:821px){body{padding:28px 30px 60px 250px!important}}" +
      /* 폰: 아래 탭 */
      "@media (max-width:820px){" +
        "body{padding-top:18px!important;padding-bottom:92px!important}" +
        "#app-bar .ab-side{display:none}" +
        "#app-bar .ab-tabs{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:100000;background:#fff;border-top:1px solid #c5d0e2;box-shadow:0 -2px 10px rgba(20,48,92,.12);padding:5px 4px calc(5px + env(safe-area-inset-bottom,0px))}" +
        "#app-bar .ab-t{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 0;border-radius:12px;color:#667085;text-decoration:none;font-size:12.5px;font-weight:700;line-height:1.2;word-break:keep-all;text-align:center}" +
        "#app-bar .ab-t .ab-i{width:24px;height:24px}" +
        "#app-bar .ab-t.cur{color:#14305c;background:#e8edf5}" +
        "#app-bar .ab-sheet.open{display:flex;flex-direction:column;gap:6px;position:fixed;left:0;right:0;bottom:66px;z-index:100001;background:#fff;border-top:1px solid #c5d0e2;box-shadow:0 -4px 12px rgba(20,48,92,.14);padding:10px 12px}" +
        "#app-bar .ab-si{display:block;padding:14px 16px;border-radius:10px;background:#f3f6fb;color:#14305c;text-decoration:none;font-weight:700;font-size:17px}" +
        "#app-bar .ab-si.cur{background:#14305c;color:#fff}" +
        "#app-bar .ab-su{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 4px 0;color:#555;font-size:15px}" +
        "#app-bar .ab-lo2{border:1px solid #9fb0cc;background:#fff;color:#14305c;font:inherit;font-weight:700;border-radius:8px;padding:7px 12px;cursor:pointer}" +
      "}" +
      "@media print{#app-bar{display:none!important}}";
    bar.appendChild(st);
    document.body.appendChild(bar);
  }
  async function doLogout() { await Auth.client.auth.signOut(); location.replace(loginUrl); }

  (async function () {
    try {
      await load(base + "config.js");
      await load("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js", "sha384-GFr3yTh5lJznCbZfpTtXnwboFsxqtTQoeTZCRHhE0579KrRmlCzen5AA8ohaB5ug");
      await load(base + "auth.js?v=6");
      await load(base + "dialogs.js?v=2");
      await load(base + "states.js?v=1");
      var p = Auth.configured ? await Auth.getProfile() : null;
      if (p && p.status === "error") { connProblem(); return; }          // 연결 문제: 로그인 화면으로 보내지 않고 다시 시도하게 해요
      if (!p || p.status !== "approved") { location.replace(loginUrl); return; }
      // 공통 가독성 스타일(화면별 스타일 위에 덮어씀)을 먼저 붙인 뒤 화면을 보여 줘요
      await new Promise(function (ok) { var l = document.createElement("link"); l.rel = "stylesheet"; l.href = base + "refine.css?v=3"; l.onload = ok; l.onerror = ok; document.head.appendChild(l); });
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
