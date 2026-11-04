// 공통 인증 도우미 (로그인 화면·보호된 화면에서 함께 사용)
(function () {
  var cfg = window.APP_CONFIG || {};
  var configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    cfg.SUPABASE_URL.indexOf("YOUR_") !== 0 && cfg.SUPABASE_ANON_KEY.indexOf("YOUR_") !== 0);
  var client = configured && window.supabase
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
    : null;

  async function getProfile() {
    if (!client) return null;
    var s = await client.auth.getSession();
    var user = s.data.session && s.data.session.user;
    if (!user) return null;
    var r = await client.from("profiles").select("name,email,status,role,position").eq("id", user.id).maybeSingle();
    if (r.error) r = await client.from("profiles").select("name,email,status,role").eq("id", user.id).maybeSingle();
    if (!r.data) return { id: user.id, status: "pending", name: "", email: user.email, can: function () { return false; } };
    var p = Object.assign({ id: user.id, position: "운영위원" }, r.data), perms = {};
    // 직책별 이용 권한(관리자가 정함). 관리자는 모든 권한을 가집니다. 화면 표시용이며 실제 막는 것은 DB 규칙입니다.
    if (p.status === "approved") {
      var pr = await client.from("role_permissions").select("perm,allowed").eq("position", p.position);
      if (!pr.error && pr.data) pr.data.forEach(function (x) { perms[x.perm] = x.allowed; });
    }
    p.can = function (perm) { return p.role === "admin" || perms[perm] === true; };
    return p;
  }

  window.Auth = { configured: configured, client: client, getProfile: getProfile };
})();
