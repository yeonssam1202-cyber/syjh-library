-- 자료·링크 올리기를 모든 운영위원(자원봉사 제외)이 할 수 있게 바꿔요. (supabase-documents.sql, supabase-roles.sql 실행 후)
-- 올리기: docs_upload 권한이 있는 위원(감사·운영위원에게도 켬) / 삭제: 관리자 또는 본인이 올린 자료만
-- 관리자는 위원 관리 화면의 권한표에서 직책별로 다시 끄거나 켤 수 있어요.

insert into public.role_permissions (position, perm, allowed)
select p, 'docs_upload', true from unnest(array['감사','운영위원']) as p
on conflict (position, perm) do update set allowed = true;

drop policy if exists "admin insert documents" on public.documents;
drop policy if exists "docs insert" on public.documents;
create policy "docs insert" on public.documents for insert to authenticated
  with check (public.has_perm('docs_upload') and uploaded_by = auth.uid());

drop policy if exists "admin delete documents" on public.documents;
drop policy if exists "docs delete" on public.documents;
create policy "docs delete" on public.documents for delete to authenticated
  using (public.is_admin() or (public.has_perm('docs_upload') and uploaded_by = auth.uid()));

drop policy if exists "admin upload committee docs" on storage.objects;
drop policy if exists "docs upload committee" on storage.objects;
create policy "docs upload committee" on storage.objects for insert to authenticated
  with check (bucket_id = 'committee-docs' and public.has_perm('docs_upload'));

drop policy if exists "admin delete committee docs" on storage.objects;
drop policy if exists "docs delete committee" on storage.objects;
create policy "docs delete committee" on storage.objects for delete to authenticated
  using (bucket_id = 'committee-docs' and (public.is_admin() or (public.has_perm('docs_upload') and owner = auth.uid())));
