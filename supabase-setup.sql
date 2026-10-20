-- Supabase 대시보드 > SQL Editor 에 통째로 붙여 넣고 Run 하세요. (한 번만)
-- 가입 신청 시 profiles 에 pending 으로 기록되고, 관리자가 approved 로 바꾸면 접속할 수 있어요.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  role text not null default 'member' check (role in ('member','admin')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.is_admin() returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'approved');
$$;

drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles for select using (id = auth.uid() or public.is_admin());

drop policy if exists "admin update" on public.profiles;
create policy "admin update" on public.profiles for update using (public.is_admin()) with check (public.is_admin());

-- 가입하면 자동으로 profiles 한 줄 생성 (본인이 status/role 을 정할 수 없음)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', ''));
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ▼ 관리자 지정: 먼저 사이트에서 본인 계정으로 가입 신청한 뒤, 아래 이메일을 본인 것으로 바꿔 실행하세요.
-- update public.profiles set status = 'approved', role = 'admin' where email = 'yeonssam1202@gmail.com';
