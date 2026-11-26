-- 보안 점검 후 조치 (2026-11). 한 번만 실행하세요. (다른 supabase-*.sql 을 모두 실행한 뒤)
-- 1) 로그인 안 한 사람(anon)이 표와 함수에 닿을 수 있는 통로를 닫아요. (이미 RLS가 막고 있지만 한 겹 더)
-- 2) 자동 실행용 함수(트리거)를 밖에서 직접 부를 수 없게 해요.
-- 3) 자료실 파일 보관함의 중복·느슨한 규칙을 정리해요. (남이 올린 파일을 지울 수 있던 구멍)
-- 4) 위원들의 이메일을 다른 위원에게 보이지 않게 막아요. 이메일은 관리자만 전용 함수로 볼 수 있어요.

-- ===== 1. anon(로그인 안 한 사람) 권한 회수 =====
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
-- 앞으로 만드는 함수는 처음에는 아무도 못 부르고, 필요한 역할에만 grant 로 열어요.
alter default privileges in schema public revoke execute on functions from public, anon;

-- ===== 2. 트리거 함수는 직접 호출 금지 =====
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and pg_get_function_result(p.oid) = 'trigger'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- ===== 3. 자료실 파일 보관함 규칙 정리 =====
-- 예전 규칙 중 "권한 있는 위원이면 누구 파일이든 지우기·바꾸기"가 남아 있었어요. 지우고, 아래 규칙만 남겨요.
--   올리기: docs_upload 권한 / 지우기: 관리자 또는 본인이 올린 파일 / 바꾸기: 관리자만 / 읽기: 승인 위원
drop policy if exists "docs delete committee docs" on storage.objects;
drop policy if exists "docs update committee docs" on storage.objects;
drop policy if exists "docs upload committee docs" on storage.objects;
drop policy if exists "admin update committee docs" on storage.objects;
drop policy if exists "docs update committee" on storage.objects;
create policy "docs update committee" on storage.objects for update to authenticated
  using (bucket_id = 'committee-docs' and public.is_admin())
  with check (bucket_id = 'committee-docs' and public.is_admin());

-- ===== 4. 이메일 가리기 =====
-- 위원(profiles) 표에서 이메일 칸은 읽을 수 없게 하고, 나머지 칸만 읽게 해요. (행은 기존 RLS 그대로)
revoke select on public.profiles from anon, authenticated;
grant select (id, name, position, role, status, shift_manager, created_at) on public.profiles to authenticated;

-- 관리자만 이메일 목록을 받을 수 있는 전용 함수 (회원 승인 화면, 위원 명단·백업 내보내기에서 사용)
create or replace function public.admin_member_emails() returns table (id uuid, email text)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception '관리자만 볼 수 있어요.'; end if;
  return query select p.id, p.email from public.profiles p;
end; $$;
revoke execute on function public.admin_member_emails() from public, anon;
grant execute on function public.admin_member_emails() to authenticated;
