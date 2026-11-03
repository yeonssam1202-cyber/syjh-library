-- 자료실(문서 다운로드) 설정. Supabase 대시보드 > SQL Editor 에서 한 번만 실행하세요. (supabase-setup.sql 실행 후)
-- 파일은 "비공개" 저장소에 보관되고, 승인된 위원만 내려받을 수 있습니다. 올리기·삭제는 관리자만 할 수 있어요.

-- 승인된 위원인지 확인하는 함수 (profiles.status = 'approved')
create or replace function public.is_member() returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'approved');
$$;

-- 파일 목록(원래 이름 등)을 담는 표
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  path text not null unique,          -- 저장소 안의 파일 키(영문)
  title text not null default '',     -- 화면에 보일 이름(한글 가능)
  orig_name text not null,            -- 내려받을 때 쓸 원래 파일명
  size_bytes bigint not null default 0,
  uploaded_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.documents enable row level security;

drop policy if exists "members read documents" on public.documents;
create policy "members read documents" on public.documents for select to authenticated using (public.is_member());

drop policy if exists "admin insert documents" on public.documents;
create policy "admin insert documents" on public.documents for insert to authenticated with check (public.is_admin());

drop policy if exists "admin update documents" on public.documents;
create policy "admin update documents" on public.documents for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin delete documents" on public.documents;
create policy "admin delete documents" on public.documents for delete to authenticated using (public.is_admin());

-- 비공개 저장소(버킷). public = false 이므로 주소를 알아도 로그인 없이는 열 수 없어요.
insert into storage.buckets (id, name, public, file_size_limit)
values ('committee-docs', 'committee-docs', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = 20971520;

drop policy if exists "members read committee docs" on storage.objects;
create policy "members read committee docs" on storage.objects for select to authenticated
  using (bucket_id = 'committee-docs' and public.is_member());

drop policy if exists "admin upload committee docs" on storage.objects;
create policy "admin upload committee docs" on storage.objects for insert to authenticated
  with check (bucket_id = 'committee-docs' and public.is_admin());

drop policy if exists "admin update committee docs" on storage.objects;
create policy "admin update committee docs" on storage.objects for update to authenticated
  using (bucket_id = 'committee-docs' and public.is_admin()) with check (bucket_id = 'committee-docs' and public.is_admin());

drop policy if exists "admin delete committee docs" on storage.objects;
create policy "admin delete committee docs" on storage.objects for delete to authenticated
  using (bucket_id = 'committee-docs' and public.is_admin());
