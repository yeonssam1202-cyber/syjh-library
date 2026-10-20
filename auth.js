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
    var r = await client.from("profiles").select("name,email,status,role").eq("id", user.id).maybeSingle();
    return r.data ? Object.assign({ id: user.id }, r.data) : { id: user.id, status: "pending", name: "", email: user.email };
  }

  window.Auth = { configured: configured, client: client, getProfile: getProfile };
})();
