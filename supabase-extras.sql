-- 추가 기능 6종의 DB: 공지 읽음 / 자원봉사 시간 확인 / 회의 일정·참석 응답 / 권한 2개(자료 내보내기, 회의 일정 등록)
-- supabase-roles.sql, supabase-volunteer.sql, supabase-notices.sql, supabase-minutes.sql 실행 후 한 번만 실행하세요.

-- ===== 권한 2개 추가 =====
alter table public.role_permissions drop constraint if exists role_permissions_perm_check;
alter table public.role_permissions add constraint role_permissions_perm_check
  check (perm in ('minutes_write','expense_write','budget_edit','rules_edit','shifts_settings','docs_upload','tasks_write','minutes_suggest','shifts_approve','notice_write','audit_write','export_basic','meeting_schedule'));

insert into public.role_permissions (position, perm, allowed)
select p.position, q.perm, p.position in ('위원장','부위원장','총무','감사')
from (values ('위원장'),('부위원장'),('총무'),('감사'),('운영위원'),('자원봉사')) as p(position)
cross join (values ('export_basic'),('meeting_schedule')) as q(perm)
on conflict (position, perm) do nothing;

-- ===== 1. 공지 읽음 확인 =====
-- 공지를 열면 본인 읽음이 기록돼요. 읽은 사람 명단은 공지를 쓴 사람과 관리자만 볼 수 있어요.
create table if not exists public.notice_reads (
  notice_id uuid not null references public.notices(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notice_id, user_id)
);
alter table public.notice_reads enable row level security;
drop policy if exists "notice reads read" on public.notice_reads;
create policy "notice reads read" on public.notice_reads for select to authenticated
  using (user_id = auth.uid() or public.is_admin()
         or exists (select 1 from public.notices n where n.id = notice_id and n.created_by = auth.uid()));
drop policy if exists "notice reads insert" on public.notice_reads;
create policy "notice reads insert" on public.notice_reads for insert to authenticated
  with check (public.is_member() and user_id = auth.uid());

-- ===== 2. 자원봉사 시간 확인 (월별) =====
-- 시간은 근무표에서 자동으로 더하고, 임원·근무 담당자·관리자가 달 단위로 확인(필요하면 시간을 조정)해요. 본인 시간은 본인이 확정할 수 없어요.
create table if not exists public.volunteer_hour_confirmations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  auto_minutes int not null check (auto_minutes >= 0),
  confirmed_minutes int not null check (confirmed_minutes between 0 and 44640),
  note text not null default '' check (char_length(note) <= 300),
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_by_name text not null default '',
  confirmed_at timestamptz not null default now(),
  unique (user_id, month)
);
alter table public.volunteer_hour_confirmations enable row level security;

create or replace function public.vh_prepare() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id = auth.uid() and not public.is_admin() then
    raise exception '본인의 봉사 시간은 본인이 확인할 수 없어요. 다른 임원이나 관리자가 확인해요.';
  end if;
  new.confirmed_by := auth.uid();
  new.confirmed_by_name := coalesce((select name from public.profiles where id = auth.uid()), '');
  new.confirmed_at := now();
  return new;
end; $$;
drop trigger if exists vh_prepare_trg on public.volunteer_hour_confirmations;
create trigger vh_prepare_trg before insert or update on public.volunteer_hour_confirmations
  for each row execute function public.vh_prepare();

drop policy if exists "vh read" on public.volunteer_hour_confirmations;
create policy "vh read" on public.volunteer_hour_confirmations for select to authenticated
  using (user_id = auth.uid() or public.can_approve_shift());
drop policy if exists "vh insert" on public.volunteer_hour_confirmations;
create policy "vh insert" on public.volunteer_hour_confirmations for insert to authenticated with check (public.can_approve_shift());
drop policy if exists "vh update" on public.volunteer_hour_confirmations;
create policy "vh update" on public.volunteer_hour_confirmations for update to authenticated
  using (public.can_approve_shift()) with check (public.can_approve_shift());
drop policy if exists "vh delete" on public.volunteer_hour_confirmations;
create policy "vh delete" on public.volunteer_hour_confirmations for delete to authenticated using (public.can_approve_shift());

-- ===== 3. 회의 일정 · 참석 응답 =====
create table if not exists public.meeting_events (
  id uuid primary key default gen_random_uuid(),
  title text not null default '정기회의' check (char_length(title) between 1 and 100),
  kind text not null default '정기회의' check (kind in ('정기회의','임시회의')),
  event_date date not null,
  start_time time,
  end_time time,
  place text not null default '' check (char_length(place) <= 100),
  agenda text not null default '' check (char_length(agenda) <= 3000),
  note text not null default '' check (char_length(note) <= 500),
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists meeting_events_date_idx on public.meeting_events(event_date desc);
alter table public.meeting_events enable row level security;

create or replace function public.meeting_events_prepare() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_by_name := coalesce((select name from public.profiles where id = auth.uid()), '');
    new.created_at := now();
  else
    new.created_by := old.created_by; new.created_by_name := old.created_by_name; new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists meeting_events_prepare_trg on public.meeting_events;
create trigger meeting_events_prepare_trg before insert or update on public.meeting_events
  for each row execute function public.meeting_events_prepare();

drop policy if exists "events read" on public.meeting_events;
create policy "events read" on public.meeting_events for select to authenticated using (public.is_member());
drop policy if exists "events insert" on public.meeting_events;
create policy "events insert" on public.meeting_events for insert to authenticated
  with check (public.has_perm('meeting_schedule') and created_by = auth.uid());
drop policy if exists "events update" on public.meeting_events;
create policy "events update" on public.meeting_events for update to authenticated
  using (public.has_perm('meeting_schedule') and (created_by = auth.uid() or public.is_admin()))
  with check (public.has_perm('meeting_schedule') and (created_by = auth.uid() or public.is_admin()));
drop policy if exists "events delete" on public.meeting_events;
create policy "events delete" on public.meeting_events for delete to authenticated
  using (public.has_perm('meeting_schedule') and (created_by = auth.uid() or public.is_admin()));

-- 참석 응답: 재적 위원(자원봉사 제외) 본인만 자기 응답을 남기고 바꿔요. 모든 위원이 볼 수 있어요.
create table if not exists public.meeting_rsvps (
  event_id uuid not null references public.meeting_events(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  user_name text not null default '',
  response text not null check (response in ('참석','불참','미정')),
  note text not null default '' check (char_length(note) <= 200),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
alter table public.meeting_rsvps enable row level security;

create or replace function public.meeting_rsvps_prepare() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then new.user_id := old.user_id; end if;
  new.user_name := coalesce((select name from public.profiles where id = new.user_id), '');
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists meeting_rsvps_prepare_trg on public.meeting_rsvps;
create trigger meeting_rsvps_prepare_trg before insert or update on public.meeting_rsvps
  for each row execute function public.meeting_rsvps_prepare();

drop policy if exists "rsvps read" on public.meeting_rsvps;
create policy "rsvps read" on public.meeting_rsvps for select to authenticated using (public.is_member());
drop policy if exists "rsvps insert" on public.meeting_rsvps;
create policy "rsvps insert" on public.meeting_rsvps for insert to authenticated
  with check (public.is_member() and not public.is_volunteer() and user_id = auth.uid());
drop policy if exists "rsvps update" on public.meeting_rsvps;
create policy "rsvps update" on public.meeting_rsvps for update to authenticated
  using (user_id = auth.uid() and not public.is_volunteer()) with check (user_id = auth.uid() and not public.is_volunteer());
drop policy if exists "rsvps delete" on public.meeting_rsvps;
create policy "rsvps delete" on public.meeting_rsvps for delete to authenticated using (user_id = auth.uid());

-- 회의록이 어느 일정에서 시작됐는지 연결
alter table public.meetings add column if not exists event_id uuid references public.meeting_events(id) on delete set null;

revoke execute on function public.vh_prepare() from public, anon, authenticated;
revoke execute on function public.meeting_events_prepare() from public, anon, authenticated;
revoke execute on function public.meeting_rsvps_prepare() from public, anon, authenticated;
