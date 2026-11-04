-- 자원봉사는 '근무 담당자' 표시가 있어도 근무를 직접 고치거나 승인할 수 없게 막음 (supabase-volunteer.sql 보완)
--  * 승인·직접 수정 권한: 관리자, 또는 (자원봉사가 아닌 위원 중) '근무 변경 승인' 직책이거나 근무 담당자로 지정된 위원
--  * 자원봉사로 바꾼 위원의 근무 담당자 표시는 해제

create or replace function public.can_approve_shift() returns boolean
language sql security definer set search_path = public stable as $$
  select public.is_admin() or (
    public.is_member() and not public.is_volunteer() and (
      public.has_perm('shifts_approve') or exists (
        select 1 from public.profiles where id = auth.uid() and status = 'approved' and shift_manager)));
$$;

update public.profiles set shift_manager = false where position = '자원봉사' and shift_manager;
