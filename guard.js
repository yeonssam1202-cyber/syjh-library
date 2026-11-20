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
  // ---- 상단(폰은 아래) 메뉴: 대분류 6개 + 그 안의 메뉴 ----
  function menuGroups(p) {
    var work = [["업무 목록", "tasks.html"], ["근무표", "shifts.html"]];
    if (p.isVolunteer || p.can("shifts_approve")) work.push(["봉사 시간", "volunteer.html"]);
    work.push(["개관 준비", "checklist.html"]);
    var mine = [["내 정보", "myinfo.html"]];
    if (p.can("export_basic")) mine.push(["내보내기", "export.html"]);
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
  function addLogoutBar(p) {
    var page = location.pathname.split("/").pop() || "home.html";
    var groups = menuGroups(p), cur = null;
    groups.forEach(function (g) { if (g.items.some(function (i) { return i[1] === page; })) cur = g; });
    var isPhone = function () { return window.matchMedia("(max-width:820px)").matches; };
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

    var bar = el("div"); bar.id = "app-bar";
    var top = el("div", "ab-top"), logo = el("a", "ab-logo"); logo.href = base + "home.html"; logo.setAttribute("aria-label", "홈");
    var img = el("img"); img.src = base + "logo.png"; img.alt = "The Platinum"; logo.appendChild(img); top.appendChild(logo);
    var nav = el("nav", "ab-groups"); nav.setAttribute("aria-label", "대분류 메뉴");
    var sheet = el("div", "ab-sheet");
    function closeSheet() { sheet.classList.remove("open"); sheet.removeAttribute("data-for"); }
    function openSheet(g) {
      sheet.textContent = "";
      g.items.forEach(function (i) {
        var a = el("a", "ab-si" + (i[1] === page ? " cur" : ""), i[0]); a.href = base + i[1];
        if (i[1] === page) a.setAttribute("aria-current", "page");
        sheet.appendChild(a);
      });
      if (g.short === "내 정보") {                       // 폰에서는 이름·로그아웃도 여기에
        var u = el("div", "ab-su", (p.name || p.email || "") + (p.role === "admin" ? " (관리자)" : ""));
        var lo = el("button", "ab-lo", "로그아웃"); lo.onclick = doLogout; u.appendChild(lo); sheet.appendChild(u);
      }
      sheet.classList.add("open"); sheet.setAttribute("data-for", g.name);
    }
    groups.forEach(function (g) {
      var a = el("a", "ab-g" + (g === cur ? " cur" : ""));
      a.href = base + g.items[0][1];
      a.appendChild(el("span", "l-long", g.name)); a.appendChild(el("span", "l-short", g.short));
      if (g === cur) a.setAttribute("aria-current", "true");
      a.onclick = function (ev) {
        if (!isPhone()) return;                          // PC: 그냥 이동(첫 메뉴로)
        if (g.items.length === 1 && g.items[0][1] !== "") return;   // 홈처럼 하나뿐이면 바로 이동
        ev.preventDefault();
        if (sheet.getAttribute("data-for") === g.name) closeSheet(); else openSheet(g);
      };
      nav.appendChild(a);
    });
    top.appendChild(nav);
    var user = el("div", "ab-user"), who = el("span", "", (p.name || p.email || "") + (p.role === "admin" ? " (관리자)" : ""));
    var btn = el("button", "ab-lo", "로그아웃"); btn.onclick = doLogout;
    user.appendChild(who); user.appendChild(btn); top.appendChild(user);
    bar.appendChild(top);

    // PC: 현재 대분류 안의 메뉴를 한 줄로
    var sub = null;
    if (cur && cur.items.length > 1) {
      sub = el("nav", "ab-sub"); sub.setAttribute("aria-label", cur.name + " 메뉴");
      var inn = el("div", "in");
      cur.items.forEach(function (i) { var a = el("a", i[1] === page ? "cur" : "", i[0]); a.href = base + i[1]; if (i[1] === page) a.setAttribute("aria-current", "page"); inn.appendChild(a); });
      sub.appendChild(inn); bar.appendChild(sub);
    }
    bar.appendChild(sheet);
    document.addEventListener("click", function (ev) { if (!bar.contains(ev.target)) closeSheet(); });

    var st = el("style");
    st.textContent =
      "#app-bar{position:fixed;top:0;left:0;right:0;z-index:100000;background:#fff;border-bottom:1px solid #c5d0e2;box-shadow:0 1px 6px rgba(20,48,92,.10);font:15px/1.3 -apple-system,'Malgun Gothic',sans-serif;color:#201f1d}" +
      "#app-bar .ab-top{display:flex;align-items:center;gap:8px;max-width:1120px;margin:0 auto;padding:8px 16px}" +
      "#app-bar .ab-logo img{height:30px;width:auto;display:block}" +
      "#app-bar .ab-groups{display:flex;gap:4px;flex:1;margin-left:16px}" +
      "#app-bar .ab-g{padding:9px 16px;border-radius:8px;color:#14305c;text-decoration:none;font-weight:700;font-size:16px;white-space:nowrap}" +
      "#app-bar .ab-g:hover{background:#eef2f9}#app-bar .ab-g.cur{background:#14305c;color:#fff}" +
      "#app-bar .l-short{display:none}" +
      "#app-bar .ab-user{display:flex;align-items:center;gap:10px;font-size:14px;color:#555;white-space:nowrap}" +
      "#app-bar .ab-lo{border:1px solid #9fb0cc;background:#fff;color:#14305c;font:inherit;font-weight:700;border-radius:8px;padding:7px 12px;cursor:pointer}" +
      "#app-bar .ab-sub{background:#f3f6fb;border-top:1px solid #dde3ec}" +
      "#app-bar .ab-sub .in{max-width:1120px;margin:0 auto;padding:0 16px 0 140px;display:flex;gap:6px}" +
      "#app-bar .ab-sub a{padding:10px 16px;color:#14305c;text-decoration:none;font-weight:600;border-bottom:3px solid transparent;font-size:15px}" +
      "#app-bar .ab-sub a:hover{background:#e6ecf6}#app-bar .ab-sub a.cur{border-bottom-color:#1f4b8f;color:#1f4b8f;font-weight:800}" +
      "#app-bar .ab-sheet{display:none}" +
      "@media (max-width:820px){" +
        "#app-bar{top:auto;bottom:0;border-bottom:0;border-top:1px solid #c5d0e2;box-shadow:0 -2px 10px rgba(20,48,92,.12)}" +
        "#app-bar .ab-top{padding:6px 6px calc(6px + env(safe-area-inset-bottom,0px))}" +
        "#app-bar .ab-logo,#app-bar .ab-user,#app-bar .ab-sub{display:none}" +
        "#app-bar .ab-groups{margin:0;width:100%;gap:2px}" +
        "#app-bar .ab-g{flex:1;text-align:center;padding:9px 2px;font-size:13px;line-height:1.25;white-space:normal;word-break:keep-all}" +
        "#app-bar .l-long{display:none}#app-bar .l-short{display:inline}" +
        "#app-bar .ab-sheet.open{display:flex;flex-direction:column;gap:6px;position:absolute;left:0;right:0;bottom:100%;background:#fff;border-top:1px solid #c5d0e2;box-shadow:0 -4px 12px rgba(20,48,92,.12);padding:10px 12px}" +
        "#app-bar .ab-si{display:block;padding:14px 16px;border-radius:10px;background:#f3f6fb;color:#14305c;text-decoration:none;font-weight:700;font-size:17px}" +
        "#app-bar .ab-si.cur{background:#14305c;color:#fff}" +
        "#app-bar .ab-su{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 4px 0;color:#555;font-size:15px}" +
      "}" +
      "@media print{#app-bar{display:none!important}}";
    bar.appendChild(st);
    document.body.appendChild(bar);
    // 메뉴가 화면 내용을 가리지 않게 여백을 줘요(PC: 위, 폰: 아래)
    var space = isPhone() ? "padding-bottom" : "padding-top";
    var px = isPhone() ? 84 : (sub ? 112 : 66);
    document.body.style.setProperty(isPhone() ? "padding-top" : "padding-bottom", "", "");
    document.body.style.setProperty(space, px + "px", "important");
  }
  async function doLogout() { await Auth.client.auth.signOut(); location.replace(loginUrl); }

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
      // 공통 가독성 스타일(화면별 스타일 위에 덮어씀)을 먼저 붙인 뒤 화면을 보여 줘요
      await new Promise(function (ok) { var l = document.createElement("link"); l.rel = "stylesheet"; l.href = base + "refine.css?v=1"; l.onload = ok; l.onerror = ok; document.head.appendChild(l); });
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
