-- 회칙·세칙 원문 보관 (개정할 때마다 새 버전이 쌓이고, 가장 최근 것이 현재본)
-- supabase-setup.sql, supabase-documents.sql(is_member 함수 포함) 실행 후 한 번만 실행하세요.
-- 읽기: 승인 위원 / 등록·삭제: 관리자

create table if not exists public.rule_versions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('회칙','세칙')),
  body text not null check (char_length(body) between 1 and 200000),
  effective_date date,                                           -- 시행일
  note text not null default '' check (char_length(note) <= 500), -- 개정 사유
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_by_name text not null default '' check (char_length(created_by_name) <= 50),
  created_at timestamptz not null default now()
);
create index if not exists rule_versions_kind_idx on public.rule_versions(kind, created_at desc);

alter table public.rule_versions enable row level security;

drop policy if exists "rules read" on public.rule_versions;
create policy "rules read" on public.rule_versions for select to authenticated using (public.is_member());

drop policy if exists "rules insert" on public.rule_versions;
create policy "rules insert" on public.rule_versions for insert to authenticated
  with check (public.is_admin() and created_by = auth.uid());

-- 잘못 등록한 버전을 지울 수 있게(관리자). 수정은 없고 새 버전을 등록하는 방식.
drop policy if exists "rules delete" on public.rule_versions;
create policy "rules delete" on public.rule_versions for delete to authenticated using (public.is_admin());
