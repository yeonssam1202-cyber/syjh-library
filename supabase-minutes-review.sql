-- 회의록 검토 완료 + 수정 제안 + 수정 이력
-- supabase-minutes.sql, supabase-roles.sql 실행 후 한 번만 실행하세요.
--
--  * 검토 완료: 참석 위원이 본인 이름 칸에서 "검토 완료"를 눌러요(계정 없는 위원은 작성자·관리자가 대신 확인).
--    누른 시각과 그때 회의록 내용의 지문(content_hash)이 함께 저장돼요. 이후 내용이 바뀌면 화면에 "수정됨"으로 보여요.
--  * 서명 받기 시작: 참석 위원 전원이 검토를 마쳐야 해요(관리자는 예외로 시작 가능).
--  * 수정 제안: 위원이 안건·회의 내용·회의 결과에 대해 고친 글을 제안하고, 작성자(또는 관리자)가 반영/거절해요.
--  * 수정 이력: 작성 중에 바뀐 항목은 누가·언제·무엇을(이전/이후) 바꿨는지 자동으로 남아요. 제안으로 반영된 건 제안자도 함께 남아요.

-- ===== 검토 완료 =====
create table if not exists public.meeting_reviews (
  attendee_id uuid primary key references public.meeting_attendees(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  reviewed_by uuid default auth.uid() references public.profiles(id) on delete set null,
  reviewed_by_name text not null default '',
  content_hash text not null default '',
  reviewed_at timestamptz not null default now()
);
create index if not exists meeting_reviews_meeting_idx on public.meeting_reviews(meeting_id);
alter table public.meeting_reviews enable row level security;

-- 검토할 수 있는 사람: 작성 중인 회의록에 '참석'으로 표시된 본인 / (계정 없는 위원은) 작성자·관리자
create or replace function public.can_review(aid uuid, mid uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select public.is_member() and exists (
    select 1 from public.meeting_attendees a join public.meetings m on m.id = a.meeting_id
    where a.id = aid and a.meeting_id = mid and a.attended and m.status = 'draft'
      and (a.user_id = auth.uid() or (a.user_id is null and (m.author_id = auth.uid() or public.is_admin())))
  );
$$;

create or replace function public.review_prepare() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.reviewed_by := auth.uid();
  new.reviewed_by_name := coalesce((select name from public.profiles where id = auth.uid()), '');
  new.content_hash := public.meeting_content_hash(new.meeting_id);
  new.reviewed_at := now();
  return new;
end; $$;
drop trigger if exists review_prepare_trg on public.meeting_reviews;
create trigger review_prepare_trg before insert on public.meeting_reviews
  for each row execute function public.review_prepare();

drop policy if exists "reviews read" on public.meeting_reviews;
create policy "reviews read" on public.meeting_reviews for select to authenticated using (public.is_member());
drop policy if exists "reviews insert" on public.meeting_reviews;
create policy "reviews insert" on public.meeting_reviews for insert to authenticated with check (public.can_review(attendee_id, meeting_id));
drop policy if exists "reviews delete" on public.meeting_reviews;
create policy "reviews delete" on public.meeting_reviews for delete to authenticated using (public.can_review(attendee_id, meeting_id));

-- ===== 수정 제안 =====
create table if not exists public.meeting_suggestions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  field text not null check (field in ('agenda','summary','result')),
  base_text text not null default '' check (char_length(base_text) <= 20000),   -- 제안 당시 본문
  new_text text not null check (char_length(new_text) <= 20000),                -- 제안하는 본문
  note text not null default '' check (char_length(note) <= 500),
  proposed_by uuid default auth.uid() references public.profiles(id) on delete set null,
  proposed_by_name text not null default '',
  status text not null default 'pending' check (status in ('pending','accepted','rejected','withdrawn')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_by_name text not null default '',
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists meeting_suggestions_meeting_idx on public.meeting_suggestions(meeting_id);
alter table public.meeting_suggestions enable row level security;

create or replace function public.suggestion_prepare() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.proposed_by := auth.uid();
  new.proposed_by_name := coalesce((select name from public.profiles where id = auth.uid()), '');
  new.status := 'pending'; new.decided_by := null; new.decided_by_name := ''; new.decided_at := null;
  new.base_text := coalesce((select case new.field when 'agenda' then m.agenda when 'summary' then m.summary else m.result end
                             from public.meetings m where m.id = new.meeting_id), '');
  if new.new_text = new.base_text then raise exception '고친 내용이 없어요.'; end if;
  return new;
end; $$;
drop trigger if exists suggestion_prepare_trg on public.meeting_suggestions;
create trigger suggestion_prepare_trg before insert on public.meeting_suggestions
  for each row execute function public.suggestion_prepare();

drop policy if exists "suggestions read" on public.meeting_suggestions;
create policy "suggestions read" on public.meeting_suggestions for select to authenticated using (public.is_member());
-- 제안은 작성 중(draft)인 회의록에만. 반영·거절·취소는 아래 decide_suggestion 함수로만 합니다(직접 수정 불가).
drop policy if exists "suggestions insert" on public.meeting_suggestions;
create policy "suggestions insert" on public.meeting_suggestions for insert to authenticated
  with check (public.is_member() and exists (select 1 from public.meetings m where m.id = meeting_id and m.status = 'draft'));

-- ===== 수정 이력 =====
create table if not exists public.meeting_changes (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  field text not null,
  old_text text not null default '',
  new_text text not null default '',
  changed_by uuid references public.profiles(id) on delete set null,
  changed_by_name text not null default '',
  suggested_by_name text not null default '',     -- 제안으로 반영된 경우 제안자
  suggestion_id uuid,
  changed_at timestamptz not null default now()
);
create index if not exists meeting_changes_meeting_idx on public.meeting_changes(meeting_id, changed_at);
alter table public.meeting_changes enable row level security;
drop policy if exists "changes read" on public.meeting_changes;
create policy "changes read" on public.meeting_changes for select to authenticated using (public.is_member());
-- 쓰기 규칙 없음: 아래 트리거만 기록할 수 있어요.

create or replace function public.meetings_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text := coalesce((select name from public.profiles where id = auth.uid()), '');
  sid uuid := nullif(current_setting('app.suggestion_id', true), '')::uuid;
  sby text := coalesce((select proposed_by_name from public.meeting_suggestions where id = sid), '');
begin
  if old.status <> 'draft' or new.status <> 'draft' then return new; end if;
  if old.seq is distinct from new.seq then
    insert into public.meeting_changes(meeting_id, field, old_text, new_text, changed_by, changed_by_name) values (new.id, 'seq', old.seq::text, new.seq::text, auth.uid(), who); end if;
  if old.kind is distinct from new.kind then
    insert into public.meeting_changes(meeting_id, field, old_text, new_text, changed_by, changed_by_name) values (new.id, 'kind', old.kind, new.kind, auth.uid(), who); end if;
  if old.meeting_date is distinct from new.meeting_date then
    insert into public.meeting_changes(meeting_id, field, old_text, new_text, changed_by, changed_by_name) values (new.id, 'meeting_date', old.meeting_date::text, new.meeting_date::text, auth.uid(), who); end if;
  if old.start_time is distinct from new.start_time then
    insert into public.meeting_changes(meeting_id, field, old_text, new_text, changed_by, changed_by_name) values (new.id, 'start_time', coalesce(old.start_time::text,''), coalesce(new.start_time::text,''), auth.uid(), who); end if;
  if old.end_time is distinct from new.end_time then
    insert into public.meeting_changes(meeting_id, field, old_text, new_text, changed_by, changed_by_name) values (new.id, 'end_time', coalesce(old.end_time::text,''), coalesce(new.end_time::text,''), auth.uid(), who); end if;
  if old.place is distinct from new.place then
    insert into public.meeting_changes(meeting_id, field, old_text, new_text, changed_by, changed_by_name) values (new.id, 'place', old.place, new.place, auth.uid(), who); end if;
  if old.author_name is distinct from new.author_name then
    insert into public.meeting_changes(meeting_id, field, old_text, new_text, changed_by, changed_by_name) values (new.id, 'author_name', old.author_name, new.author_name, auth.uid(), who); end if;
  if old.observers is distinct from new.observers then
    insert into public.meeting_changes(meeting_id, field, old_text, new_text, changed_by, changed_by_name) values (new.id, 'observers', old.observers::text, new.observers::text, auth.uid(), who); end if;
  if old.agenda is distinct from new.agenda then
    insert into public.meeting_changes(meeting_id, field, old_text, new_text, changed_by, changed_by_name, suggested_by_name, suggestion_id) values (new.id, 'agenda', old.agenda, new.agenda, auth.uid(), who, sby, sid); end if;
  if old.summary is distinct from new.summary then
    insert into public.meeting_changes(meeting_id, field, old_text, new_text, changed_by, changed_by_name, suggested_by_name, suggestion_id) values (new.id, 'summary', old.summary, new.summary, auth.uid(), who, sby, sid); end if;
  if old.result is distinct from new.result then
    insert into public.meeting_changes(meeting_id, field, old_text, new_text, changed_by, changed_by_name, suggested_by_name, suggestion_id) values (new.id, 'result', old.result, new.result, auth.uid(), who, sby, sid); end if;
  return new;
end; $$;
drop trigger if exists meetings_log_trg on public.meetings;
create trigger meetings_log_trg after update on public.meetings
  for each row execute function public.meetings_log();

-- ===== 제안 처리: 반영 / 거절 / 취소 =====
create or replace function public.decide_suggestion(sid uuid, decision text) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.meeting_suggestions; m public.meetings;
  who text := coalesce((select name from public.profiles where id = auth.uid()), '');
begin
  if not public.is_member() then raise exception '권한이 없어요.'; end if;
  select * into s from public.meeting_suggestions where id = sid for update;
  if not found or s.status <> 'pending' then raise exception '이미 처리된 제안이에요.'; end if;
  select * into m from public.meetings where id = s.meeting_id;
  if m.status <> 'draft' then raise exception '작성 중인 회의록에서만 처리할 수 있어요.'; end if;

  if decision = 'withdraw' then
    if s.proposed_by is distinct from auth.uid() then raise exception '제안한 사람만 취소할 수 있어요.'; end if;
    update public.meeting_suggestions set status = 'withdrawn', decided_by = auth.uid(), decided_by_name = who, decided_at = now() where id = sid;
  elsif decision in ('accept', 'reject') then
    if not (m.author_id = auth.uid() or public.is_admin()) then raise exception '작성자나 관리자만 처리할 수 있어요.'; end if;
    if decision = 'accept' then
      perform set_config('app.suggestion_id', sid::text, true);
      if s.field = 'agenda' then update public.meetings set agenda = s.new_text where id = m.id;
      elsif s.field = 'summary' then update public.meetings set summary = s.new_text where id = m.id;
      else update public.meetings set result = s.new_text where id = m.id; end if;
      perform set_config('app.suggestion_id', '', true);
    end if;
    update public.meeting_suggestions set status = case decision when 'accept' then 'accepted' else 'rejected' end,
      decided_by = auth.uid(), decided_by_name = who, decided_at = now() where id = sid;
  else
    raise exception '알 수 없는 처리예요.';
  end if;
end; $$;

-- ===== 서명 받기 시작 전 검토 확인 (기존 함수에 규칙 추가) =====
create or replace function public.meetings_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.author_id := old.author_id;
  new.created_at := old.created_at;
  new.updated_at := now();

  if old.status <> 'draft' and
     (new.seq, new.kind, new.meeting_date, new.start_time, new.end_time, new.place, new.author_name, new.observers, new.agenda, new.summary, new.result)
     is distinct from
     (old.seq, old.kind, old.meeting_date, old.start_time, old.end_time, old.place, old.author_name, old.observers, old.agenda, old.summary, old.result) then
    raise exception '서명을 받기 시작한 회의록은 내용을 고칠 수 없어요. 서명이 없다면 초안으로 되돌린 뒤 고쳐 주세요.';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status = 'signing' then
      if not exists (select 1 from public.meeting_attendees where meeting_id = old.id and attended) then
        raise exception '참석자가 한 명도 없어요. 참석자를 표시해 주세요.';
      end if;
      if not public.is_admin() and exists (
           select 1 from public.meeting_attendees a
           where a.meeting_id = old.id and a.attended
             and not exists (select 1 from public.meeting_reviews r where r.attendee_id = a.id)) then
        raise exception '아직 검토를 마치지 않은 위원이 있어요. 참석 위원 모두가 "검토 완료"를 눌러야 서명을 받을 수 있어요.';
      end if;
    elsif old.status = 'signing' and new.status = 'draft' then
      if exists (select 1 from public.meeting_signatures where meeting_id = old.id) then
        raise exception '이미 서명한 위원이 있어 초안으로 되돌릴 수 없어요.';
      end if;
    elsif old.status = 'signing' and new.status = 'closed' then
      null;
    else
      raise exception '이 상태로는 바꿀 수 없어요.';
    end if;
  end if;
  return new;
end; $$;

-- 함수 실행 권한
revoke execute on function public.review_prepare() from public, anon, authenticated;
revoke execute on function public.suggestion_prepare() from public, anon, authenticated;
revoke execute on function public.meetings_log() from public, anon, authenticated;
revoke execute on function public.meetings_guard() from public, anon, authenticated;
revoke execute on function public.can_review(uuid, uuid) from public, anon;
grant execute on function public.can_review(uuid, uuid) to authenticated;
revoke execute on function public.decide_suggestion(uuid, text) from public, anon;
grant execute on function public.decide_suggestion(uuid, text) to authenticated;
