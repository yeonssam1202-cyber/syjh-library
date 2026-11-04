-- 이미 들어간 근무를 빼는(고치는) 권한 정리 (supabase-volunteer.sql 실행 후)
--  * 관리자 · 임원('근무 변경 승인' 권한이 켜진 직책) · 근무 담당자: 누구의 근무든 빼고 고칠 수 있어요.
--  * 일반 위원(운영위원 등): 본인 근무만 직접 뺄 수 있어요. 다른 사람(자원봉사 포함)의 근무를 넣어 줬더라도 이후 빼는 건 임원·관리자의 몫이에요.
--  * 자원봉사: 직접 빼거나 고칠 수 없고, 변경 요청을 올려 임원·관리자(·근무 담당자)의 승인을 받아야 해요.
-- (다른 사람의 근무를 '넣는' 일은 승인된 위원 누구나 할 수 있어요. 자원봉사는 본인 것만.)

drop policy if exists "shifts delete" on public.shifts;
create policy "shifts delete" on public.shifts for delete to authenticated
  using (public.is_member() and (
    public.is_admin() or public.can_approve_shift()
    or (not public.is_volunteer() and user_id = auth.uid())));
