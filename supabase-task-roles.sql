-- 업무 담당자 구분: 메인 담당자(업무당 최대 1명) + 보조 담당자(0명 이상)
-- supabase-tasks.sql 실행 후 한 번만 실행하세요. 기존 담당자는 모두 '보조'로 시작해요(화면에서 메인을 지정하면 돼요).

alter table public.task_assignees add column if not exists role text not null default 'sub' check (role in ('main','sub'));
create unique index if not exists task_assignees_one_main on public.task_assignees(task_id) where role = 'main';

-- 담당 구분 바꾸기(메인↔보조)는 업무를 고칠 수 있는 사람만
drop policy if exists "assignees update" on public.task_assignees;
create policy "assignees update" on public.task_assignees for update to authenticated
  using (public.can_edit_task(task_id)) with check (public.can_edit_task(task_id));
