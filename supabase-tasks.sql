-- 업무 목록(tasks) + 담당자(task_assignees, 한 업무에 여러 명).
-- supabase-setup.sql, supabase-documents.sql(is_member 함수 포함) 실행 후 한 번만 실행하세요.
-- 승인된 위원은 모든 업무를 볼 수 있어요.

-- 승인된 위원끼리 이름을 볼 수 있게 (담당자 선택·표시용)
drop policy if exists "approved read approved" on public.profiles;
create policy "approved read approved" on public.profiles for select
  using (public.is_member() and status = 'approved');

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '' check (char_length(description) <= 5000),
  due_date date,
  status text not null default 'todo' check (status in ('todo','doing','done')),
  -- 계정을 지워도(탈퇴·삭제 요청) 업무는 남도록 set null
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_assignees (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (task_id, user_id)
);

create index if not exists task_assignees_user_idx on public.task_assignees(user_id);

alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;

-- 수정 가능: 만든 사람 · 담당자 · 관리자
create or replace function public.can_edit_task(tid uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select public.is_member() and (
    public.is_admin()
    or exists (select 1 from public.tasks t where t.id = tid and t.created_by = auth.uid())
    or exists (select 1 from public.task_assignees a where a.task_id = tid and a.user_id = auth.uid())
  );
$$;

drop policy if exists "tasks read" on public.tasks;
create policy "tasks read" on public.tasks for select to authenticated using (public.is_member());

drop policy if exists "tasks insert" on public.tasks;
create policy "tasks insert" on public.tasks for insert to authenticated
  with check (public.is_member() and created_by = auth.uid());

drop policy if exists "tasks update" on public.tasks;
create policy "tasks update" on public.tasks for update to authenticated
  using (public.can_edit_task(id)) with check (public.can_edit_task(id));

-- 삭제: 만든 사람 · 관리자
drop policy if exists "tasks delete" on public.tasks;
create policy "tasks delete" on public.tasks for delete to authenticated
  using (public.is_member() and (created_by = auth.uid() or public.is_admin()));

drop policy if exists "assignees read" on public.task_assignees;
create policy "assignees read" on public.task_assignees for select to authenticated using (public.is_member());

drop policy if exists "assignees insert" on public.task_assignees;
create policy "assignees insert" on public.task_assignees for insert to authenticated
  with check (public.can_edit_task(task_id));

drop policy if exists "assignees delete" on public.task_assignees;
create policy "assignees delete" on public.task_assignees for delete to authenticated
  using (public.can_edit_task(task_id));
