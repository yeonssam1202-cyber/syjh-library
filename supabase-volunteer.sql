-- 자원봉사 직급 + 근무 변경 승인
-- supabase-roles.sql, supabase-shifts.sql, supabase-minutes-review.sql 실행 후 한 번만 실행하세요.
--
--  * 자원봉사: 근무표에 '본인' 근무를 신청할 수 있고, 나머지는 열람만 가능해요.
--    (업무 쓰기·회의록 쓰기/수정 제안·지출·예산·회칙·자료실 올리기는 모두 막힘 — 관리자가 직책별 권한 표에서 바꿀 수 있어요)
--  * 신청한 근무를 취소하거나 다른 시간으로 바꾸려면 '변경 요청'을 올리고, 승인을 받아야 해요.
--    승인할 수 있는 사람: 관리자 / '근무 변경 승인' 권한이 켜진 직책(기본: 위원장·부위원장·총무·감사) / 근무 담당자로 지정된 위원
--  * 자원봉사는 회의록 재적 인원에 들어가지 않아요(새 회의록 참석자 목록에서 자동 제외 — 화면에서 처리).

-- ===== 직책 목록에 '자원봉사' 추가 =====
alter table public.profiles drop constraint if exists profiles_position_check;
alter table public.profiles add constraint profiles_position_check
  check (position in ('위원장','부위원장','총무','감사','운영위원','자원봉사'));
alter table public.role_permissions drop constraint if exists role_permissions_position_check;
alter table public.role_permissions add constraint role_permissions_position_check
  check (position in ('위원장','부위원장','총무','감사','운영위원','자원봉사'));
alter table public.meeting_attendees drop constraint if exists meeting_attendees_position_check;
alter table public.meeting_attendees add constraint meeting_attendees_position_check
  check (position in ('위원장','부위원장','총무','감사','운영위원','자원봉사'));

-- ===== 권한 종류 3개 추가: 업무 목록 쓰기 / 회의록 수정 제안 / 근무 변경 승인 =====
alter table public.role_permissions drop constraint if exists role_permissions_perm_check;
alter table public.role_permissions add constraint role_permissions_perm_check
  check (perm in ('minutes_write','expense_write','budget_edit','rules_edit','shifts_settings','docs_upload','tasks_write','minutes_suggest','shifts_approve'));

insert into public.role_permissions (position, perm, allowed)
select p.position, q.perm,
  case
    when q.perm in ('tasks_write','minutes_suggest') then p.position <> '자원봉사'
    when q.perm = 'shifts_approve' then p.position in ('위원장','부위원장','총무','감사')
    else false                                              -- 자원봉사의 기존 권한 6개는 모두 꺼짐
  end
from (values ('위원장'),('부위원장'),('총무'),('감사'),('운영위원'),('자원봉사')) as p(position)
cross join (values ('minutes_write'),('expense_write'),('budget_edit'),('rules_edit'),('shifts_settings'),('docs_upload'),
                   ('tasks_write'),('minutes_suggest'),('shifts_approve')) as q(perm)
on conflict (position, perm) do nothing;

-- 근무 담당자(직책과 상관없이 근무 변경을 승인할 수 있는 위원) — 관리자만 지정
alter table public.profiles add column if not exists shift_manager boolean not null default false;

create or replace function public.is_volunteer() returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'approved' and position = '자원봉사');
$$;

create or replace function public.can_approve_shift() returns boolean
language sql security definer set search_path = public stable as $$
  select public.has_perm('shifts_approve') or exists (
    select 1 from public.profiles where id = auth.uid() and status = 'approved' and shift_manager);
$$;

-- ===== 열람만 가능하게: 업무 목록 · 회의록 수정 제안 =====
create or replace function public.can_edit_task(tid uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select public.is_member() and public.has_perm('tasks_write') and (
    public.is_admin()
    or exists (select 1 from public.tasks t where t.id = tid and t.created_by = auth.uid())
    or exists (select 1 from public.task_assignees a where a.task_id = tid and a.user_id = auth.uid())
  );
$$;

drop policy if exists "tasks insert" on public.tasks;
create policy "tasks insert" on public.tasks for insert to authenticated
  with check (public.is_member() and created_by = auth.uid() and public.has_perm('tasks_write'));
drop policy if exists "tasks delete" on public.tasks;
create policy "tasks delete" on public.tasks for delete to authenticated
  using (public.is_member() and public.has_perm('tasks_write') and (created_by = auth.uid() or public.is_admin()));

drop policy if exists "suggestions insert" on public.meeting_suggestions;
create policy "suggestions insert" on public.meeting_suggestions for insert to authenticated
  with check (public.is_member() and public.has_perm('minutes_suggest')
              and exists (select 1 from public.meetings m where m.id = meeting_id and m.status = 'draft'));

-- ===== 근무표: 자원봉사는 '본인' 근무만 신청, 취소·변경은 승인 필요 =====
drop policy if exists "shifts insert" on public.shifts;
create policy "shifts insert" on public.shifts for insert to authenticated
  with check (public.is_member() and created_by = auth.uid() and (not public.is_volunteer() or user_id = auth.uid()));

drop policy if exists "shifts delete" on public.shifts;
create policy "shifts delete" on public.shifts for delete to authenticated
  using (public.is_member() and (
    public.is_admin() or public.can_approve_shift()
    or (not public.is_volunteer() and (created_by = auth.uid() or user_id = auth.uid()))));

create table if not exists public.shift_change_requests (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid references public.shifts(id) on delete set null,
  shift_date date not null,                              -- 요청 당시 근무(기록용)
  slot text not null,
  kind text not null check (kind in ('cancel','move')),
  new_date date,
  new_slot text check (new_slot is null or char_length(new_slot) between 1 and 30),
  reason text not null default '' check (char_length(reason) <= 300),
  requested_by uuid default auth.uid() references public.profiles(id) on delete set null,
  requested_by_name text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_by_name text not null default '',
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (kind = 'cancel' or (new_date is not null and new_slot is not null))
);
create index if not exists shift_change_requests_status_idx on public.shift_change_requests(status, created_at desc);
create unique index if not exists shift_change_one_pending on public.shift_change_requests(shift_id) where status = 'pending';
alter table public.shift_change_requests enable row level security;

create or replace function public.shift_change_prepare() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.requested_by := auth.uid();
  new.requested_by_name := coalesce((select name from public.profiles where id = auth.uid()), '');
  new.status := 'pending'; new.decided_by := null; new.decided_by_name := ''; new.decided_at := null;
  select s.shift_date, s.slot into new.shift_date, new.slot from public.shifts s where s.id = new.shift_id;
  return new;
end; $$;
drop trigger if exists shift_change_prepare_trg on public.shift_change_requests;
create trigger shift_change_prepare_trg before insert on public.shift_change_requests
  for each row execute function public.shift_change_prepare();

drop policy if exists "shift requests read" on public.shift_change_requests;
create policy "shift requests read" on public.shift_change_requests for select to authenticated using (public.is_member());
-- 요청은 '내 근무'에 대해서만. 승인·거절·취소는 아래 함수로만 합니다.
drop policy if exists "shift requests insert" on public.shift_change_requests;
create policy "shift requests insert" on public.shift_change_requests for insert to authenticated
  with check (public.is_member() and requested_by = auth.uid()
              and exists (select 1 from public.shifts s where s.id = shift_id and s.user_id = auth.uid()));

create or replace function public.decide_shift_change(rid uuid, decision text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.shift_change_requests; st public.shift_settings;
  who text := coalesce((select name from public.profiles where id = auth.uid()), '');
begin
  if not public.is_member() then raise exception '권한이 없어요.'; end if;
  select * into r from public.shift_change_requests where id = rid for update;
  if not found or r.status <> 'pending' then raise exception '이미 처리된 요청이에요.'; end if;

  if decision = 'withdraw' then
    if r.requested_by is distinct from auth.uid() then raise exception '요청한 사람만 취소할 수 있어요.'; end if;
    update public.shift_change_requests set status = 'withdrawn', decided_by = auth.uid(), decided_by_name = who, decided_at = now() where id = rid;
  elsif decision in ('approve', 'reject') then
    if not public.can_approve_shift() then raise exception '근무 변경은 임원·근무 담당자·관리자가 승인할 수 있어요.'; end if;
    if decision = 'approve' then
      if r.shift_id is null then raise exception '대상 근무가 이미 없어요.'; end if;
      if r.kind = 'move' then
        select * into st from public.shift_settings where id = 1;
        if st.id is not null then
          if extract(dow from r.new_date)::int = any (st.closed_days) then raise exception '휴관일로는 옮길 수 없어요.'; end if;
          if not (r.new_slot = any (st.slots)) then raise exception '없는 시간대예요.'; end if;
        end if;
        begin
          update public.shifts set shift_date = r.new_date, slot = r.new_slot where id = r.shift_id;
        exception when unique_violation then
          raise exception '옮기려는 시간에 이미 같은 분의 근무가 있어요.';
        end;
      end if;
      update public.shift_change_requests set status = 'approved', decided_by = auth.uid(), decided_by_name = who, decided_at = now() where id = rid;
      if r.kind = 'cancel' then delete from public.shifts where id = r.shift_id; end if;
    else
      update public.shift_change_requests set status = 'rejected', decided_by = auth.uid(), decided_by_name = who, decided_at = now() where id = rid;
    end if;
  else
    raise exception '알 수 없는 처리예요.';
  end if;
end; $$;

revoke execute on function public.shift_change_prepare() from public, anon, authenticated;
revoke execute on function public.is_volunteer() from public, anon;
revoke execute on function public.can_approve_shift() from public, anon;
revoke execute on function public.decide_shift_change(uuid, text) from public, anon;
grant execute on function public.is_volunteer() to authenticated;
grant execute on function public.can_approve_shift() to authenticated;
grant execute on function public.decide_shift_change(uuid, text) to authenticated;
