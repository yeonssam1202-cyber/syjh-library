// 상태 머신 목록(한 곳에서 관리). 화면의 라벨·안내와 문서(docs/STATE_MACHINES.md)가 같은 내용을 쓰도록 모아 둔 것입니다.
// - 실제로 전환을 막는 곳은 DB(트리거·RLS)예요. 여기 적힌 transitions 는 "화면 안내용 + 사람/에이전트가 읽는 명세"이고,
//   바꿀 때는 DB 규칙(supabase-*.sql)과 이 파일, docs/STATE_MACHINES.md 를 함께 고쳐요.
// - 사용: States.label('meeting','draft') → '작성 중' / States.labels('task') → {todo:'할 일',...} / States.next('shiftRequest','pending') → 가능한 전환 목록
// - 에이전트/시험용: 브라우저에서 JSON.stringify(States.describe()) 로 전체 명세를 읽을 수 있어요.
(function () {
  var M = {
    profile: {
      title: '가입·접속 상태', where: 'profiles.status', enforcedBy: 'DB: RLS(본인은 못 바꿈, 관리자만) · 화면: members.html',
      initial: 'pending',
      states: { pending: { label: '승인 대기', tone: 'wait' }, approved: { label: '승인됨', tone: 'ok' }, rejected: { label: '거절됨', tone: 'bad' } },
      transitions: [
        { from: 'pending', to: 'approved', who: '관리자', ui: '승인' },
        { from: 'pending', to: 'rejected', who: '관리자', ui: '거절' },
        { from: 'approved', to: 'rejected', who: '관리자', ui: '승인 취소(접속 막음)', note: '이미 열어 둔 화면은 다시 확인할 때(탭으로 돌아올 때) 로그인 화면으로 보내요' },
        { from: 'rejected', to: 'approved', who: '관리자', ui: '승인' },
        { from: 'rejected', to: 'pending', who: '관리자', ui: '대기로 되돌리기' }
      ]
    },
    meeting: {
      title: '회의록', where: 'meetings.status', enforcedBy: 'DB: meetings_guard 트리거 · 화면: minutes.js',
      initial: 'draft',
      states: { draft: { label: '작성 중', tone: 'wait' }, signing: { label: '서명 받는 중', tone: 'info' }, closed: { label: '마감', tone: 'ok' } },
      transitions: [
        { from: 'draft', to: 'signing', who: '작성자·관리자', ui: '서명 받기 시작', guard: '참석 위원 전원이 검토 완료(관리자는 예외) · 참석자 1명 이상', note: '이 순간부터 내용 잠김' },
        { from: 'signing', to: 'draft', who: '작성자·관리자', ui: '초안으로 되돌리기', guard: '서명이 1건도 없을 때만' },
        { from: 'signing', to: 'closed', who: '작성자·관리자', ui: '서명 마감' },
        { from: 'closed', to: 'signing', who: '관리자', ui: '마감 취소', guard: '내용은 계속 잠김(서명을 더 받을 수 있게만 열어요)', pendingDb: 'supabase-state-fixes.sql' }
      ]
    },
    suggestion: {
      title: '회의록 수정 제안', where: 'meeting_suggestions.status', enforcedBy: 'DB: decide_suggestion() 함수(직접 수정 불가)',
      initial: 'pending',
      states: { pending: { label: '대기', tone: 'wait' }, accepted: { label: '반영됨', tone: 'ok' }, rejected: { label: '거절됨', tone: 'bad' }, withdrawn: { label: '제안 취소', tone: 'muted' } },
      transitions: [
        { from: 'pending', to: 'accepted', who: '회의록 작성자·관리자', ui: '반영', guard: '회의록이 작성 중일 때만' },
        { from: 'pending', to: 'rejected', who: '회의록 작성자·관리자', ui: '거절' },
        { from: 'pending', to: 'withdrawn', who: '제안한 사람', ui: '제안 취소' }
      ]
    },
    audit: {
      title: '감사 보고서', where: 'audit_reports.status', enforcedBy: 'DB: audit_reports_guard 트리거 · 화면: audit.js',
      initial: 'draft',
      states: { draft: { label: '작성 중', tone: 'wait' }, submitted: { label: '제출됨', tone: 'ok' } },
      transitions: [
        { from: 'draft', to: 'submitted', who: '감사(작성자)', ui: '서명하고 제출', guard: '감사 의견 선택 · 예산·지출 불러오기 · 서명' },
        { from: 'submitted', to: 'draft', who: '관리자', ui: '작성 중으로 되돌리기', note: '서명·제출 기록이 지워짐' }
      ]
    },
    task: {
      title: '업무', where: 'tasks.status', enforcedBy: '화면(자유 전환) · DB는 값 범위만 검사',
      initial: 'todo',
      states: { todo: { label: '할 일', tone: 'wait' }, doing: { label: '진행 중', tone: 'info' }, done: { label: '완료', tone: 'ok' } },
      transitions: [
        { from: '*', to: '*', who: '업무를 고칠 수 있는 사람(등록자·담당자·관리자)', ui: '상태 선택', note: '어느 상태로든 바꿀 수 있어요' }
      ]
    },
    shiftRequest: {
      title: '근무 변경 요청', where: 'shift_change_requests.status', enforcedBy: 'DB: decide_shift_change() 함수',
      initial: 'pending',
      states: { pending: { label: '승인 대기', tone: 'wait' }, approved: { label: '승인됨', tone: 'ok' }, rejected: { label: '거절됨', tone: 'bad' }, withdrawn: { label: '요청 취소', tone: 'muted' } },
      transitions: [
        { from: 'pending', to: 'approved', who: '관리자·임원·근무 담당자(자원봉사 제외)', ui: '승인', guard: '이동이면 휴관일·없는 시간대·같은 시간 중복 불가', note: '승인하면 근무가 취소되거나 옮겨져요' },
        { from: 'pending', to: 'rejected', who: '관리자·임원·근무 담당자', ui: '거절' },
        { from: 'pending', to: 'withdrawn', who: '요청한 사람', ui: '요청 취소' },
        { from: 'pending', to: 'withdrawn', who: '시스템', ui: '(자동)', note: '대상 근무가 지워지면 자동으로 취소 처리', pendingDb: 'supabase-state-fixes.sql' }
      ]
    },
    rsvp: {
      title: '회의 참석 응답', where: 'meeting_rsvps.response', enforcedBy: 'DB: RLS(본인만, 자원봉사 제외)',
      initial: null,
      states: { '참석': { label: '참석', tone: 'ok' }, '불참': { label: '불참', tone: 'bad' }, '미정': { label: '미정', tone: 'wait' } },
      transitions: [{ from: '*', to: '*', who: '재적 위원 본인', ui: '참석/불참/미정 버튼', note: '응답 전(없음) → 응답 → 언제든 바꿀 수 있어요. 지난 회의는 화면에서 응답 버튼을 숨겨요' }]
    },
    shiftAction: {
      title: '근무 이력 종류', where: 'shift_history.action', enforcedBy: 'DB: 트리거(자동 기록, 직접 쓰기 불가)',
      initial: null,
      states: { apply: { label: '신청', tone: 'ok' }, remove: { label: '취소', tone: 'bad' }, move: { label: '이동', tone: 'info' }, request: { label: '변경 요청', tone: 'wait' }, reject: { label: '요청 거절', tone: 'bad' }, withdraw: { label: '요청 취소', tone: 'muted' } },
      transitions: []
    }
  };

  function get(m) { var x = M[m]; if (!x) throw new Error('알 수 없는 상태 머신: ' + m); return x; }
  window.States = {
    machines: M,
    label: function (m, s) { var st = get(m).states[s]; return st ? st.label : String(s == null ? '' : s); },
    tone: function (m, s) { var st = get(m).states[s]; return st ? st.tone : 'muted'; },
    labels: function (m) { var o = {}; Object.keys(get(m).states).forEach(function (k) { o[k] = M[m].states[k].label; }); return o; },
    next: function (m, from) { return get(m).transitions.filter(function (t) { return t.from === from || t.from === '*'; }); },
    // 이 전환이 명세에 있는지(화면에서 버튼을 보여 줄지 정할 때)
    allows: function (m, from, to) { return get(m).transitions.some(function (t) { return (t.from === from || t.from === '*') && (t.to === to || t.to === '*'); }); },
    // 표시용 작은 라벨(data-state 를 달아 두면 시험·에이전트가 상태를 바로 읽어요)
    badge: function (m, s, extraClass) {
      var e = document.createElement('span');
      e.className = 'badge ' + (extraClass || '') + ' ' + s;
      e.setAttribute('data-machine', m); e.setAttribute('data-state', s); e.setAttribute('data-tone', this.tone(m, s));
      e.textContent = this.label(m, s); return e;
    },
    describe: function () { return JSON.parse(JSON.stringify(M)); }
  };
})();
