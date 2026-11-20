-- 회의 날짜 투표. (supabase-extras.sql 실행 후)
-- 임원·관리자(meeting_schedule 권한)가 후보 날짜를 올리면, 재적 위원(자원봉사 제외)이 날짜별로 "가능/어려움"을 남기고,
-- 만든 사람(또는 관리자)이 한 날짜를 확정하면 회의 일정(meeting_events)이 자동으로 만들어져요.

create table if not exists public.meeting_polls (
  id uuid primary key default gen_random_uuid(),
  title text not null default '정기회의 날짜 투표' check (char_length(title) between 1 and 100),
  kind text not null default '정기회의' check (kind in ('정기회의','임시회의')),
  place text not null default '' check (char_length(place) <= 100),
  note text not null default '' check (char_length(note) <= 500),
  status text not null default 'open' check (status in ('open','closed')),
  picked_option uuid,
  event_id uuid references public.meeting_events(id) on delete set null,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now()
);
alter table public.meeting_polls enable row level security;

create table if not exists public.meeting_poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.meeting_polls(id) on delete cascade,
  opt_date date not null,
  start_time time,
  end_time time,
  created_at timestamptz not null default now()
);
create index if not exists meeting_poll_options_poll_idx on public.meeting_poll_options(poll_id);
alter table public.meeting_poll_options enable row level security;

create table if not exists public.meeting_poll_votes (
  option_id uuid not null references public.meeting_poll_options(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  user_name text not null default '',
  answer text not null check (answer in ('가능','어려움')),
  updated_at timestamptz not null default now(),
  primary key (option_id, user_id)
);
alter table public.meeting_poll_votes enable row level security;

create or replace function public.meeting_polls_prepare() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.status := 'open'; new.picked_option := null; new.event_id := null;
  new.created_by := auth.uid();
  new.created_by_name := coalesce((select name from public.profiles where id = auth.uid()), '');
  new.created_at := now();
  return new;
end; $$;
drop trigger if exists meeting_polls_prepare_trg on public.meeting_polls;
create trigger meeting_polls_prepare_trg before insert on public.meeting_polls
  for each row execute function public.meeting_polls_prepare();

create or replace function public.meeting_poll_votes_prepare() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then new.user_id := old.user_id; new.option_id := old.option_id; end if;
  new.user_name := coalesce((select name from public.profiles where id = new.user_id), '');
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists meeting_poll_votes_prepare_trg on public.meeting_poll_votes;
create trigger meeting_poll_votes_prepare_trg before insert or update on public.meeting_poll_votes
  for each row execute function public.meeting_poll_votes_prepare();

-- 투표가 열려 있는지 / 내가 만든 투표인지 확인하는 도우미
create or replace function public.poll_is_open(pid uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.meeting_polls where id = pid and status = 'open');
$$;
create or replace function public.poll_is_mine(pid uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.meeting_polls where id = pid and (created_by = auth.uid() or public.is_admin()));
$$;
create or replace function public.option_poll_open(oid uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.meeting_poll_options o join public.meeting_polls p on p.id = o.poll_id where o.id = oid and p.status = 'open');
$$;

-- 읽기: 승인 위원 모두
drop policy if exists "polls read" on public.meeting_polls;
create policy "polls read" on public.meeting_polls for select to authenticated using (public.is_member());
drop policy if exists "poll opts read" on public.meeting_poll_options;
create policy "poll opts read" on public.meeting_poll_options for select to authenticated using (public.is_member());
drop policy if exists "poll votes read" on public.meeting_poll_votes;
create policy "poll votes read" on public.meeting_poll_votes for select to authenticated using (public.is_member());

-- 만들기·후보 추가/삭제: 일정 권한이 있고 본인이 만든 투표(관리자는 모두), 열려 있는 동안만
drop policy if exists "polls insert" on public.meeting_polls;
create policy "polls insert" on public.meeting_polls for insert to authenticated
  with check (public.has_perm('meeting_schedule') and created_by = auth.uid());
drop policy if exists "polls delete" on public.meeting_polls;
create policy "polls delete" on public.meeting_polls for delete to authenticated
  using (public.has_perm('meeting_schedule') and (created_by = auth.uid() or public.is_admin()));
drop policy if exists "poll opts insert" on public.meeting_poll_options;
create policy "poll opts insert" on public.meeting_poll_options for insert to authenticated
  with check (public.has_perm('meeting_schedule') and public.poll_is_mine(poll_id) and public.poll_is_open(poll_id));
drop policy if exists "poll opts delete" on public.meeting_poll_options;
create policy "poll opts delete" on public.meeting_poll_options for delete to authenticated
  using (public.has_perm('meeting_schedule') and public.poll_is_mine(poll_id) and public.poll_is_open(poll_id));

-- 투표: 재적 위원(자원봉사 제외) 본인만, 열려 있는 동안만
drop policy if exists "poll votes insert" on public.meeting_poll_votes;
create policy "poll votes insert" on public.meeting_poll_votes for insert to authenticated
  with check (public.is_member() and not public.is_volunteer() and user_id = auth.uid() and public.option_poll_open(option_id));
drop policy if exists "poll votes update" on public.meeting_poll_votes;
create policy "poll votes update" on public.meeting_poll_votes for update to authenticated
  using (user_id = auth.uid() and not public.is_volunteer() and public.option_poll_open(option_id))
  with check (user_id = auth.uid() and not public.is_volunteer() and public.option_poll_open(option_id));
drop policy if exists "poll votes delete" on public.meeting_poll_votes;
create policy "poll votes delete" on public.meeting_poll_votes for delete to authenticated
  using (user_id = auth.uid() and public.option_poll_open(option_id));

-- 날짜 확정: 만든 사람 또는 관리자 → 투표를 닫고 회의 일정을 자동으로 만들어요. (열려 있는 투표만, 한 번만)
create or replace function public.close_meeting_poll(pid uuid, oid uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare p public.meeting_polls; o public.meeting_poll_options; eid uuid;
begin
  select * into p from public.meeting_polls where id = pid for update;
  if not found then raise exception '투표를 찾을 수 없어요.'; end if;
  if not (public.has_perm('meeting_schedule') and (p.created_by = auth.uid() or public.is_admin())) then
    raise exception '날짜를 확정할 권한이 없어요.'; end if;
  if p.status <> 'open' then raise exception '이미 확정된 투표예요.'; end if;
  select * into o from public.meeting_poll_options where id = oid and poll_id = pid;
  if not found then raise exception '고른 날짜가 이 투표의 후보가 아니에요.'; end if;
  insert into public.meeting_events (title, kind, event_date, start_time, end_time, place, note)
  values (p.title, p.kind, o.opt_date, o.start_time, o.end_time, p.place, p.note) returning id into eid;
  update public.meeting_polls set status = 'closed', picked_option = oid, event_id = eid where id = pid;
  return eid;
end; $$;
revoke execute on function public.close_meeting_poll(uuid, uuid) from public, anon;
grant execute on function public.close_meeting_poll(uuid, uuid) to authenticated;
revoke execute on function public.poll_is_open(uuid) from public, anon;
revoke execute on function public.poll_is_mine(uuid) from public, anon;
revoke execute on function public.option_poll_open(uuid) from public, anon;
grant execute on function public.poll_is_open(uuid) to authenticated;
grant execute on function public.poll_is_mine(uuid) to authenticated;
grant execute on function public.option_poll_open(uuid) to authenticated;
