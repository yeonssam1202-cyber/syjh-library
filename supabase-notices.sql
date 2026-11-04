-- 공지 (임원·관리자만 쓰기, 승인된 위원은 읽기)
-- supabase-roles.sql, supabase-volunteer.sql 실행 후 한 번만 실행하세요.
--  * 쓰기 권한은 직책별 권한 표의 '공지 쓰기'(notice_write)로 정해요. 기본: 위원장·부위원장·총무·감사. 관리자는 항상 가능.
--  * 고치기·삭제: 쓴 사람 또는 관리자(그리고 '공지 쓰기' 권한이 있어야 해요).

alter table public.role_permissions drop constraint if exists role_permissions_perm_check;
alter table public.role_permissions add constraint role_permissions_perm_check
  check (perm in ('minutes_write','expense_write','budget_edit','rules_edit','shifts_settings','docs_upload','tasks_write','minutes_suggest','shifts_approve','notice_write'));

insert into public.role_permissions (position, perm, allowed)
select p.position, 'notice_write', p.position in ('위원장','부위원장','총무','감사')
from (values ('위원장'),('부위원장'),('총무'),('감사'),('운영위원'),('자원봉사')) as p(position)
on conflict (position, perm) do nothing;

create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  body text not null default '' check (char_length(body) <= 20000),
  pinned boolean not null default false,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_by_name text not null default '',
  updated_at timestamptz not null default now()
);
create index if not exists notices_order_idx on public.notices(pinned desc, created_at desc);
alter table public.notices enable row level security;

create or replace function public.notices_prepare() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text := coalesce((select name from public.profiles where id = auth.uid()), '');
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_by_name := who; new.created_at := now();
    new.updated_at := now(); new.updated_by_name := '';
  else
    new.created_by := old.created_by; new.created_by_name := old.created_by_name; new.created_at := old.created_at;
    new.updated_at := now(); new.updated_by_name := who;
  end if;
  return new;
end; $$;
drop trigger if exists notices_prepare_trg on public.notices;
create trigger notices_prepare_trg before insert or update on public.notices
  for each row execute function public.notices_prepare();

drop policy if exists "notices read" on public.notices;
create policy "notices read" on public.notices for select to authenticated using (public.is_member());
drop policy if exists "notices insert" on public.notices;
create policy "notices insert" on public.notices for insert to authenticated
  with check (public.has_perm('notice_write') and created_by = auth.uid());
drop policy if exists "notices update" on public.notices;
create policy "notices update" on public.notices for update to authenticated
  using (public.has_perm('notice_write') and (created_by = auth.uid() or public.is_admin()))
  with check (public.has_perm('notice_write') and (created_by = auth.uid() or public.is_admin()));
drop policy if exists "notices delete" on public.notices;
create policy "notices delete" on public.notices for delete to authenticated
  using (public.has_perm('notice_write') and (created_by = auth.uid() or public.is_admin()));

revoke execute on function public.notices_prepare() from public, anon, authenticated;
