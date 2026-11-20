-- 공유 일정(달력): 입대의 회의, 관리사무소 일정, 행사 등 "회의·업무가 아니어도 같이 봐야 할 일정".
-- 읽기 = 승인 위원 모두 / 쓰기 = 재적 위원(자원봉사 제외) 누구나 / 고치기·지우기 = 만든 사람 또는 관리자
-- (supabase-setup.sql 실행 후)

create table if not exists public.calendar_items (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 100),
  category text not null default '기타' check (category in ('입대의 회의','관리사무소','행사·교육','기타')),
  item_date date not null,
  end_date date not null,
  start_time time,
  end_time time,
  place text not null default '' check (char_length(place) <= 100),
  note text not null default '' check (char_length(note) <= 500),
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= item_date)
);
create index if not exists calendar_items_date_idx on public.calendar_items(item_date, end_date);
alter table public.calendar_items enable row level security;

create or replace function public.calendar_items_prepare() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.end_date is null then new.end_date := new.item_date; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_by_name := coalesce((select name from public.profiles where id = auth.uid()), '');
    new.created_at := now();
  else
    new.created_by := old.created_by; new.created_by_name := old.created_by_name; new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists calendar_items_prepare_trg on public.calendar_items;
create trigger calendar_items_prepare_trg before insert or update on public.calendar_items
  for each row execute function public.calendar_items_prepare();

drop policy if exists "cal read" on public.calendar_items;
create policy "cal read" on public.calendar_items for select to authenticated using (public.is_member());
drop policy if exists "cal insert" on public.calendar_items;
create policy "cal insert" on public.calendar_items for insert to authenticated
  with check (public.is_member() and not public.is_volunteer() and created_by = auth.uid());
drop policy if exists "cal update" on public.calendar_items;
create policy "cal update" on public.calendar_items for update to authenticated
  using (public.is_member() and not public.is_volunteer() and (created_by = auth.uid() or public.is_admin()))
  with check (public.is_member() and not public.is_volunteer() and (created_by = auth.uid() or public.is_admin()));
drop policy if exists "cal delete" on public.calendar_items;
create policy "cal delete" on public.calendar_items for delete to authenticated
  using (public.is_member() and not public.is_volunteer() and (created_by = auth.uid() or public.is_admin()));
