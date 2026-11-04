-- 감사 보고서 (감사 직책이 작성 · 예산·지출을 불러와 점검 · 전자서명 후 제출)
-- supabase-roles.sql, supabase-volunteer.sql, supabase-budget.sql, supabase-notices.sql 실행 후 한 번만 실행하세요.
--
--  * 쓰기 권한: 직책별 권한 표의 '감사 보고서 쓰기'(audit_write). 기본: 감사 직책만. 관리자는 항상 가능.
--  * 읽기: 승인된 위원 모두.
--  * 흐름: 작성 중(draft) → 서명하고 제출(submitted). 제출하면 내용이 잠기고, 제출 당시 내용의 지문(content_hash)이 남아요.
--    제출한 보고서를 다시 고치려면 관리자가 '작성 중으로 되돌리기'를 해야 해요(서명은 지워져요).
--  * 예산·지출 내용은 '불러오기' 시점의 값이 보고서 안에 그대로 저장돼요(이후 예산이 바뀌어도 제출한 보고서는 그대로).

alter table public.role_permissions drop constraint if exists role_permissions_perm_check;
alter table public.role_permissions add constraint role_permissions_perm_check
  check (perm in ('minutes_write','expense_write','budget_edit','rules_edit','shifts_settings','docs_upload','tasks_write','minutes_suggest','shifts_approve','notice_write','audit_write'));

insert into public.role_permissions (position, perm, allowed)
select p.position, 'audit_write', p.position = '감사'
from (values ('위원장'),('부위원장'),('총무'),('감사'),('운영위원'),('자원봉사')) as p(position)
on conflict (position, perm) do nothing;

create table if not exists public.audit_reports (
  id uuid primary key default gen_random_uuid(),
  fiscal_year int not null check (fiscal_year between 2020 and 2100),
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  audit_date date not null,
  place text not null default '' check (char_length(place) <= 100),
  scope text not null default '' check (char_length(scope) <= 300),
  observers text not null default '' check (char_length(observers) <= 300),       -- 입회자
  budget_snapshot jsonb not null default '[]'::jsonb,                              -- 불러온 예산 집행 현황
  expense_snapshot jsonb not null default '[]'::jsonb,                             -- 불러온 지출 내역(+자동 점검 표시)
  checks jsonb not null default '{}'::jsonb,                                       -- 지출별 감사 점검 {지출id: {result, note}}
  opinion text check (opinion in ('적정','일부 보완 필요','부적정')),
  summary text not null default '' check (char_length(summary) <= 10000),
  recommendations text not null default '' check (char_length(recommendations) <= 10000),
  status text not null default 'draft' check (status in ('draft','submitted')),
  signature text check (signature is null or (signature like 'data:image/png;base64,%' and char_length(signature) <= 150000)),
  content_hash text not null default '',
  submitted_at timestamptz,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (octet_length(budget_snapshot::text) <= 300000 and octet_length(expense_snapshot::text) <= 900000 and octet_length(checks::text) <= 300000)
);
create index if not exists audit_reports_year_idx on public.audit_reports(fiscal_year desc, created_at desc);
alter table public.audit_reports enable row level security;

create or replace function public.audit_report_hash(r public.audit_reports) returns text
language sql immutable set search_path = public as $$
  select encode(sha256(convert_to(concat_ws('|', r.fiscal_year, r.period_start, r.period_end, r.audit_date, r.place, r.scope, r.observers,
    r.budget_snapshot::text, r.expense_snapshot::text, r.checks::text, r.opinion, r.summary, r.recommendations, r.created_by_name), 'UTF8')), 'hex');
$$;

create or replace function public.audit_reports_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text := coalesce((select name from public.profiles where id = auth.uid()), '');
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_by_name := who; new.created_at := now(); new.updated_at := now();
    new.status := 'draft'; new.signature := null; new.submitted_at := null; new.content_hash := '';
    return new;
  end if;

  new.created_by := old.created_by; new.created_by_name := old.created_by_name; new.created_at := old.created_at;
  new.updated_at := now();

  if old.status = 'submitted' then
    -- 제출한 보고서: 관리자가 '작성 중으로 되돌리기'만 할 수 있어요(서명·제출 기록은 지워져요).
    if new.status = 'draft' and public.is_admin() then
      new.signature := null; new.submitted_at := null; new.content_hash := '';
      new.fiscal_year := old.fiscal_year; new.period_start := old.period_start; new.period_end := old.period_end; new.audit_date := old.audit_date;
      new.place := old.place; new.scope := old.scope; new.observers := old.observers; new.budget_snapshot := old.budget_snapshot;
      new.expense_snapshot := old.expense_snapshot; new.checks := old.checks; new.opinion := old.opinion; new.summary := old.summary;
      new.recommendations := old.recommendations;
      return new;
    end if;
    raise exception '제출한 감사 보고서는 고칠 수 없어요. 관리자에게 작성 중으로 되돌려 달라고 요청해 주세요.';
  end if;

  if new.status = 'submitted' then
    if new.opinion is null then raise exception '감사 의견(적정/일부 보완 필요/부적정)을 골라 주세요.'; end if;
    if new.signature is null then raise exception '감사 서명이 필요해요.'; end if;
    if jsonb_array_length(new.expense_snapshot) = 0 and jsonb_array_length(new.budget_snapshot) = 0 then
      raise exception '예산·지출 내용을 먼저 불러와 주세요.'; end if;
    new.submitted_at := now();
    new.content_hash := public.audit_report_hash(new);
  else
    new.signature := null; new.submitted_at := null; new.content_hash := '';
  end if;
  return new;
end; $$;
drop trigger if exists audit_reports_guard_trg on public.audit_reports;
create trigger audit_reports_guard_trg before insert or update on public.audit_reports
  for each row execute function public.audit_reports_guard();

drop policy if exists "audit read" on public.audit_reports;
create policy "audit read" on public.audit_reports for select to authenticated using (public.is_member());
drop policy if exists "audit insert" on public.audit_reports;
create policy "audit insert" on public.audit_reports for insert to authenticated
  with check (public.has_perm('audit_write') and created_by = auth.uid() and status = 'draft');
drop policy if exists "audit update" on public.audit_reports;
create policy "audit update" on public.audit_reports for update to authenticated
  using (public.has_perm('audit_write') and (created_by = auth.uid() or public.is_admin()))
  with check (public.has_perm('audit_write') and (created_by = auth.uid() or public.is_admin()));
drop policy if exists "audit delete" on public.audit_reports;
create policy "audit delete" on public.audit_reports for delete to authenticated
  using (public.has_perm('audit_write') and ((created_by = auth.uid() and status = 'draft') or public.is_admin()));

revoke execute on function public.audit_reports_guard() from public, anon, authenticated;
revoke execute on function public.audit_report_hash(public.audit_reports) from public, anon, authenticated;
