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

  function addLogoutBar(p) {
    var bar = document.createElement("div");
    bar.style.cssText = "position:fixed;top:10px;right:14px;z-index:100000;display:flex;gap:10px;align-items:center;" +
      "background:#fff;border:1px solid #ddd;border-radius:999px;padding:6px 8px 6px 14px;font:13px/1 -apple-system,'Malgun Gothic',sans-serif;color:#201f1d;box-shadow:0 1px 6px rgba(0,0,0,.08)";
    var who = document.createElement("span");
    who.textContent = (p.name || p.email || "") + (p.role === "admin" ? " (관리자)" : "");
    var btn = document.createElement("button");
    btn.textContent = "로그아웃";
    btn.style.cssText = "border:0;background:#7d5411;color:#fff;border-radius:999px;padding:7px 12px;font:inherit;cursor:pointer";
    btn.onclick = async function () { await Auth.client.auth.signOut(); location.replace(loginUrl); };
    bar.appendChild(who); bar.appendChild(btn);
    document.body.appendChild(bar);
  }

  (async function () {
    try {
      await load(base + "config.js");
      await load("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js");
      await load(base + "auth.js");
      var p = Auth.configured ? await Auth.getProfile() : null;
      if (!p || p.status !== "approved") { location.replace(loginUrl); return; }
      hide.remove();
      if (document.body) addLogoutBar(p);
      else document.addEventListener("DOMContentLoaded", function () { addLogoutBar(p); });
    } catch (e) {
      location.replace(loginUrl);
    }
  })();
})();
