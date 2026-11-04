-- 근무표 (자원봉사 주간 근무) : 설정(시간대·휴관 요일·필요 인원) + 근무 배정
-- supabase-setup.sql, supabase-documents.sql(is_member 함수 포함) 실행 후 한 번만 실행하세요.
--
--  * 읽기: 승인 위원 모두
--  * 근무 넣기: 승인 위원 누구나(본인 또는 다른 위원). 빼기: 넣은 사람 · 당사자 · 관리자
--  * 설정 변경: 관리자

create table if not exists public.shift_settings (
  id int primary key default 1 check (id = 1),
  slots text[] not null default array['10:00-13:00','13:00-16:00','16:00-19:00'],
  closed_days int[] not null default array[0],                 -- 0=일 ... 6=토
  required int not null default 2 check (required between 1 and 20),
  updated_at timestamptz not null default now()
);
insert into public.shift_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  shift_date date not null,
  slot text not null check (char_length(slot) between 1 and 30),
  user_id uuid references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 50),   -- 표에 보일 이름(계정 없는 사람도 가능)
  note text not null default '' check (char_length(note) <= 200),
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists shifts_date_idx on public.shifts(shift_date);
create unique index if not exists shifts_one_per_user on public.shifts(shift_date, slot, user_id) where user_id is not null;

alter table public.shift_settings enable row level security;
alter table public.shifts enable row level security;

drop policy if exists "shift settings read" on public.shift_settings;
create policy "shift settings read" on public.shift_settings for select to authenticated using (public.is_member());
drop policy if exists "shift settings update" on public.shift_settings;
create policy "shift settings update" on public.shift_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "shifts read" on public.shifts;
create policy "shifts read" on public.shifts for select to authenticated using (public.is_member());
drop policy if exists "shifts insert" on public.shifts;
create policy "shifts insert" on public.shifts for insert to authenticated
  with check (public.is_member() and created_by = auth.uid());
drop policy if exists "shifts delete" on public.shifts;
create policy "shifts delete" on public.shifts for delete to authenticated
  using (public.is_member() and (created_by = auth.uid() or user_id = auth.uid() or public.is_admin()));
