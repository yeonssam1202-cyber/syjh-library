-- 직책별 이용 권한 (위원장 / 부위원장 / 총무 / 감사 / 운영위원)
-- 관리자가 [회원 승인] 화면에서 위원별 직책을 정하고, 직책별로 할 수 있는 일을 켜고 끕니다.
-- 관리자(role='admin')는 언제나 모든 권한을 가집니다. 직책은 '권한 묶음'일 뿐이라 관리자 여부와는 별개예요.
-- supabase-setup/documents/minutes/rules/budget/shifts.sql 실행 후 한 번만 실행하세요.

alter table public.profiles add column if not exists position text not null default '운영위원'
  check (position in ('위원장','부위원장','총무','감사','운영위원'));

create table if not exists public.role_permissions (
  position text not null check (position in ('위원장','부위원장','총무','감사','운영위원')),
  perm text not null check (perm in ('minutes_write','expense_write','budget_edit','rules_edit','shifts_settings','docs_upload')),
  allowed boolean not null default false,
  primary key (position, perm)
);

-- 처음 기본값 (관리자가 화면에서 바꿀 수 있어요)
insert into public.role_permissions (position, perm, allowed)
select p.position, q.perm,
  case
    when p.position = '위원장'   then q.perm in ('minutes_write','expense_write','rules_edit','shifts_settings','docs_upload')
    when p.position = '부위원장' then q.perm in ('minutes_write','expense_write','shifts_settings','docs_upload')
    when p.position = '총무'     then q.perm in ('minutes_write','expense_write','budget_edit','shifts_settings','docs_upload')
    when p.position = '감사'     then false
    else q.perm in ('minutes_write')
  end
from (values ('위원장'),('부위원장'),('총무'),('감사'),('운영위원')) as p(position)
cross join (values ('minutes_write'),('expense_write'),('budget_edit'),('rules_edit'),('shifts_settings'),('docs_upload')) as q(perm)
on conflict (position, perm) do nothing;

alter table public.role_permissions enable row level security;
drop policy if exists "perm read" on public.role_permissions;
create policy "perm read" on public.role_permissions for select to authenticated using (public.is_member());
drop policy if exists "perm insert" on public.role_permissions;
create policy "perm insert" on public.role_permissions for insert to authenticated with check (public.is_admin());
drop policy if exists "perm update" on public.role_permissions;
create policy "perm update" on public.role_permissions for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "perm delete" on public.role_permissions;
create policy "perm delete" on public.role_permissions for delete to authenticated using (public.is_admin());

-- 이 사람이 해당 일을 할 수 있는가: 관리자이거나, 승인된 위원의 직책에 권한이 켜져 있으면 true
create or replace function public.has_perm(p text) returns boolean
language sql security definer set search_path = public stable as $$
  select public.is_admin() or exists (
    select 1 from public.profiles pr
    join public.role_permissions rp on rp.position = pr.position
    where pr.id = auth.uid() and pr.status = 'approved' and rp.perm = p and rp.allowed
  );
$$;
revoke execute on function public.has_perm(text) from public, anon;
grant execute on function public.has_perm(text) to authenticated;

-- ===== 각 기능의 쓰기 규칙을 권한 확인으로 교체 =====

-- 회의록 작성
drop policy if exists "meetings insert" on public.meetings;
create policy "meetings insert" on public.meetings for insert to authenticated
  with check (public.has_perm('minutes_write') and author_id = auth.uid() and status = 'draft');

-- 지출 기록
drop policy if exists "expenses insert" on public.expenses;
create policy "expenses insert" on public.expenses for insert to authenticated
  with check (public.has_perm('expense_write') and created_by = auth.uid());

-- 예산 항목 편집
drop policy if exists "budget insert" on public.budget_items;
create policy "budget insert" on public.budget_items for insert to authenticated with check (public.has_perm('budget_edit'));
drop policy if exists "budget update" on public.budget_items;
create policy "budget update" on public.budget_items for update to authenticated
  using (public.has_perm('budget_edit')) with check (public.has_perm('budget_edit'));
drop policy if exists "budget delete" on public.budget_items;
create policy "budget delete" on public.budget_items for delete to authenticated using (public.has_perm('budget_edit'));

-- 회칙·세칙 등록·삭제
drop policy if exists "rules insert" on public.rule_versions;
create policy "rules insert" on public.rule_versions for insert to authenticated
  with check (public.has_perm('rules_edit') and created_by = auth.uid());
drop policy if exists "rules delete" on public.rule_versions;
create policy "rules delete" on public.rule_versions for delete to authenticated using (public.has_perm('rules_edit'));

-- 근무표 설정
drop policy if exists "shift settings update" on public.shift_settings;
create policy "shift settings update" on public.shift_settings for update to authenticated
  using (public.has_perm('shifts_settings')) with check (public.has_perm('shifts_settings'));

-- 자료실 올리기·삭제
drop policy if exists "admin insert documents" on public.documents;
drop policy if exists "docs insert" on public.documents;
create policy "docs insert" on public.documents for insert to authenticated with check (public.has_perm('docs_upload'));
drop policy if exists "admin update documents" on public.documents;
drop policy if exists "docs update" on public.documents;
create policy "docs update" on public.documents for update to authenticated
  using (public.has_perm('docs_upload')) with check (public.has_perm('docs_upload'));
drop policy if exists "admin delete documents" on public.documents;
drop policy if exists "docs delete" on public.documents;
create policy "docs delete" on public.documents for delete to authenticated using (public.has_perm('docs_upload'));

drop policy if exists "admin upload committee docs" on storage.objects;
drop policy if exists "docs upload committee docs" on storage.objects;
create policy "docs upload committee docs" on storage.objects for insert to authenticated
  with check (bucket_id = 'committee-docs' and public.has_perm('docs_upload'));
drop policy if exists "admin update committee docs" on storage.objects;
drop policy if exists "docs update committee docs" on storage.objects;
create policy "docs update committee docs" on storage.objects for update to authenticated
  using (bucket_id = 'committee-docs' and public.has_perm('docs_upload'))
  with check (bucket_id = 'committee-docs' and public.has_perm('docs_upload'));
drop policy if exists "admin delete committee docs" on storage.objects;
drop policy if exists "docs delete committee docs" on storage.objects;
create policy "docs delete committee docs" on storage.objects for delete to authenticated
  using (bucket_id = 'committee-docs' and public.has_perm('docs_upload'));
