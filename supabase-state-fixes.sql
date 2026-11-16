-- 상태 머신 점검에서 찾은 "막다른 길" 2가지 보완 (docs/STATE_MACHINES.md 참고)
-- supabase-minutes-review.sql, supabase-volunteer.sql, supabase-shift-history.sql 실행 후 한 번만 실행하세요.
--
-- 1) 회의록: 서명을 마감(closed)한 뒤에는 어떤 방법으로도 되돌릴 수 없었어요(서명 마감을 너무 일찍 눌러도 끝).
--    → 관리자만 '마감 취소'로 서명 받는 중(signing)으로 되돌릴 수 있게 해요. 내용은 계속 잠겨 있어서(서명 이후 수정 금지) 기록의 무결성은 그대로예요.
-- 2) 근무 변경 요청: 대상 근무가 지워졌는데(직접 빼기 등) 요청이 '승인 대기'로 영원히 남았어요.
--    → 근무가 지워지면 대기 중인 요청을 자동으로 '요청 취소'(처리: 시스템)로 바꾸고 이력에 남겨요.

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
    elsif old.status = 'closed' and new.status = 'signing' then
      if not public.is_admin() then
        raise exception '마감한 회의록을 다시 여는 것은 관리자만 할 수 있어요.';
      end if;
    else
      raise exception '이 상태로는 바꿀 수 없어요.';
    end if;
  end if;
  return new;
end; $$;
revoke execute on function public.meetings_guard() from public, anon, authenticated;

create or replace function public.shift_orphan_requests() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.shift_change_requests
     set status = 'withdrawn', decided_by = null, decided_by_name = '시스템', decided_at = now()
   where shift_id = old.id and status = 'pending';
  return old;
end; $$;
drop trigger if exists shift_orphan_requests_trg on public.shifts;
create trigger shift_orphan_requests_trg before delete on public.shifts
  for each row execute function public.shift_orphan_requests();
revoke execute on function public.shift_orphan_requests() from public, anon, authenticated;
