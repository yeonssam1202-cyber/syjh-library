-- 근무 이력 (신청 / 취소 / 이동 / 변경 요청·승인·거절·요청 취소를 자동 기록)
-- supabase-shifts.sql, supabase-volunteer.sql 실행 후 한 번만 실행하세요.
--  * 기록은 트리거가 자동으로 남기고, 사람이 직접 쓰거나 고치거나 지울 수 없어요(읽기만 승인 위원).
--  * 승인으로 근무가 취소·이동된 기록에는 요청한 사람·이유·승인한 사람이 함께 남아요.

create table if not exists public.shift_history (
  id uuid primary key default gen_random_uuid(),
  happened_at timestamptz not null default now(),
  action text not null check (action in ('apply','remove','move','request','reject','withdraw')),
  subject_name text not null default '',          -- 근무하는 사람(요청의 경우 요청한 사람)
  shift_date date,
  slot text,
  new_date date,                                  -- 이동·변경 요청의 새 날짜
  new_slot text,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text not null default '',            -- 실제로 한 사람(승인한 사람 포함)
  request_id uuid,
  requested_by_name text not null default '',     -- 요청으로 바뀐 경우 요청자
  reason text not null default ''
);
create index if not exists shift_history_time_idx on public.shift_history(happened_at desc);
alter table public.shift_history enable row level security;
drop policy if exists "shift history read" on public.shift_history;
create policy "shift history read" on public.shift_history for select to authenticated using (public.is_member());
-- 쓰기 규칙 없음: 아래 트리거만 기록할 수 있어요.

create or replace function public.shift_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text := coalesce((select name from public.profiles where id = auth.uid()), '');
  rid uuid := nullif(current_setting('app.shift_request', true), '')::uuid;
  rq public.shift_change_requests;
begin
  if rid is not null then select * into rq from public.shift_change_requests where id = rid; end if;
  if tg_op = 'INSERT' then
    insert into public.shift_history(action, subject_name, shift_date, slot, actor_id, actor_name)
    values ('apply', new.name, new.shift_date, new.slot, auth.uid(), who);
  elsif tg_op = 'DELETE' then
    insert into public.shift_history(action, subject_name, shift_date, slot, actor_id, actor_name, request_id, requested_by_name, reason)
    values ('remove', old.name, old.shift_date, old.slot, auth.uid(), who, rid, coalesce(rq.requested_by_name, ''), coalesce(rq.reason, ''));
  else
    if old.shift_date is distinct from new.shift_date or old.slot is distinct from new.slot then
      insert into public.shift_history(action, subject_name, shift_date, slot, new_date, new_slot, actor_id, actor_name, request_id, requested_by_name, reason)
      values ('move', new.name, old.shift_date, old.slot, new.shift_date, new.slot, auth.uid(), who, rid, coalesce(rq.requested_by_name, ''), coalesce(rq.reason, ''));
    end if;
  end if;
  return null;
end; $$;
drop trigger if exists shift_log_trg on public.shifts;
create trigger shift_log_trg after insert or update or delete on public.shifts
  for each row execute function public.shift_log();

create or replace function public.shift_request_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.shift_history(action, subject_name, shift_date, slot, new_date, new_slot, actor_id, actor_name, request_id, requested_by_name, reason)
    values ('request', new.requested_by_name, new.shift_date, new.slot, new.new_date, new.new_slot, new.requested_by, new.requested_by_name, new.id, new.requested_by_name, new.reason);
  elsif new.status is distinct from old.status and new.status in ('rejected', 'withdrawn') then
    insert into public.shift_history(action, subject_name, shift_date, slot, new_date, new_slot, actor_id, actor_name, request_id, requested_by_name, reason)
    values (case new.status when 'rejected' then 'reject' else 'withdraw' end, new.requested_by_name, new.shift_date, new.slot, new.new_date, new.new_slot,
            new.decided_by, new.decided_by_name, new.id, new.requested_by_name, new.reason);
  end if;
  return null;
end; $$;
drop trigger if exists shift_request_log_trg on public.shift_change_requests;
create trigger shift_request_log_trg after insert or update on public.shift_change_requests
  for each row execute function public.shift_request_log();

-- 승인 처리 함수: 근무가 바뀌는 동안 '어느 요청 때문인지'를 이력에 연결 (supabase-volunteer.sql 의 함수에 두 줄 추가)
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
      perform set_config('app.shift_request', rid::text, true);
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
      perform set_config('app.shift_request', '', true);
    else
      update public.shift_change_requests set status = 'rejected', decided_by = auth.uid(), decided_by_name = who, decided_at = now() where id = rid;
    end if;
  else
    raise exception '알 수 없는 처리예요.';
  end if;
end; $$;

revoke execute on function public.shift_log() from public, anon, authenticated;
revoke execute on function public.shift_request_log() from public, anon, authenticated;
revoke execute on function public.decide_shift_change(uuid, text) from public, anon;
grant execute on function public.decide_shift_change(uuid, text) to authenticated;
