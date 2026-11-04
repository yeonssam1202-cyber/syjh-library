-- 예산·지출 (회계연도별 예산 항목 / 지출 기록 / 영수증 사진·PDF)
-- supabase-setup.sql, supabase-documents.sql(is_member), supabase-minutes.sql(meetings 표) 실행 후 한 번만 실행하세요.
--
--  * 예산 항목 편집: 관리자(총무 역할을 맡은 관리자)
--  * 지출 기록: 승인 위원 누구나 새로 기록 / 고치기·삭제는 기록한 사람 또는 관리자
--  * 영수증: 비공개 보관함(receipts), 승인 위원만 열람

create table if not exists public.budget_items (
  id uuid primary key default gen_random_uuid(),
  fiscal_year int not null check (fiscal_year between 2020 and 2100),
  name text not null check (char_length(name) between 1 and 50),
  planned_amount bigint not null default 0 check (planned_amount >= 0),
  source text not null default '공동체 활성화 지원비' check (source in ('공동체 활성화 지원비','외부 지원금','기타')),
  is_meeting_fee boolean not null default false,        -- 회의운영비(세칙 한도 적용)
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists budget_items_year_idx on public.budget_items(fiscal_year, sort_order);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  fiscal_year int not null check (fiscal_year between 2020 and 2100),
  spent_on date not null,
  item_id uuid not null references public.budget_items(id) on delete restrict,
  description text not null default '' check (char_length(description) <= 300),
  vendor text not null default '' check (char_length(vendor) <= 100),
  amount bigint not null check (amount >= 0 and amount <= 100000000000),
  proof text not null check (proof in ('카드 전표','현금영수증','세금계산서','기타','없음')),
  note text not null default '' check (char_length(note) <= 500),
  meeting_id uuid references public.meetings(id) on delete set null,   -- 회의운영비: 연결한 회의록
  attendee_count int not null default 0 check (attendee_count between 0 and 999),
  no_alcohol_ok boolean not null default false,                         -- 주류·개인 용도 아님 확인
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_by_name text not null default '' check (char_length(created_by_name) <= 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists expenses_year_idx on public.expenses(fiscal_year, spent_on desc);
create index if not exists expenses_item_idx on public.expenses(item_id);

create table if not exists public.expense_receipts (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  path text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists expense_receipts_expense_idx on public.expense_receipts(expense_id);

alter table public.budget_items enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_receipts enable row level security;

create or replace function public.can_edit_expense(eid uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select public.is_member() and exists (
    select 1 from public.expenses e where e.id = eid and (e.created_by = auth.uid() or public.is_admin())
  );
$$;

create or replace function public.expenses_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end; $$;

drop trigger if exists expenses_guard_trg on public.expenses;
create trigger expenses_guard_trg before insert or update on public.expenses
  for each row execute function public.expenses_guard();

drop policy if exists "budget read" on public.budget_items;
create policy "budget read" on public.budget_items for select to authenticated using (public.is_member());
drop policy if exists "budget insert" on public.budget_items;
create policy "budget insert" on public.budget_items for insert to authenticated with check (public.is_admin());
drop policy if exists "budget update" on public.budget_items;
create policy "budget update" on public.budget_items for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "budget delete" on public.budget_items;
create policy "budget delete" on public.budget_items for delete to authenticated using (public.is_admin());

drop policy if exists "expenses read" on public.expenses;
create policy "expenses read" on public.expenses for select to authenticated using (public.is_member());
drop policy if exists "expenses insert" on public.expenses;
create policy "expenses insert" on public.expenses for insert to authenticated
  with check (public.is_member() and created_by = auth.uid());
drop policy if exists "expenses update" on public.expenses;
create policy "expenses update" on public.expenses for update to authenticated
  using (public.can_edit_expense(id)) with check (public.can_edit_expense(id));
drop policy if exists "expenses delete" on public.expenses;
create policy "expenses delete" on public.expenses for delete to authenticated using (public.can_edit_expense(id));

drop policy if exists "receipts read" on public.expense_receipts;
create policy "receipts read" on public.expense_receipts for select to authenticated using (public.is_member());
drop policy if exists "receipts insert" on public.expense_receipts;
create policy "receipts insert" on public.expense_receipts for insert to authenticated with check (public.can_edit_expense(expense_id));
drop policy if exists "receipts delete" on public.expense_receipts;
create policy "receipts delete" on public.expense_receipts for delete to authenticated using (public.can_edit_expense(expense_id));

-- 영수증 보관함(비공개). 폴더 이름 = 지출 id
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf'];

drop policy if exists "members read receipts" on storage.objects;
create policy "members read receipts" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.is_member());

drop policy if exists "editors upload receipts" on storage.objects;
create policy "editors upload receipts" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and case
    when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then public.can_edit_expense(((storage.foldername(name))[1])::uuid)
    else false end);

drop policy if exists "editors delete receipts" on storage.objects;
create policy "editors delete receipts" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and case
    when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then public.can_edit_expense(((storage.foldername(name))[1])::uuid)
    else false end);

revoke execute on function public.expenses_guard() from public, anon, authenticated;
revoke execute on function public.can_edit_expense(uuid) from public, anon;
grant execute on function public.can_edit_expense(uuid) to authenticated;
