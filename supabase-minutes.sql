-- 회의록 + 전자서명 (양식: 1. 회의 개요 / 2. 회의록 / 3. 참석자 명부 및 서명부 / 4. 회의 사진)
-- supabase-setup.sql, supabase-documents.sql(is_member 함수 포함) 실행 후 한 번만 실행하세요.
--
-- 상태 흐름: draft(작성 중) -> signing(서명 받는 중, 내용 잠금) -> closed(마감)
--  * 서명은 본인 계정으로만, 참석으로 표시된 위원만 할 수 있어요.
--  * 서명하는 순간의 회의록 내용 지문(content_hash)과 시각이 함께 저장돼요.
--  * 서명이 한 건이라도 있으면 초안으로 되돌릴 수 없어요.

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  seq int not null check (seq between 1 and 999),                       -- 제N차
  kind text not null default '정기회의' check (kind in ('정기회의','임시회의')),
  meeting_date date not null,
  start_time time,
  end_time time,
  place text not null default '' check (char_length(place) <= 100),
  author_id uuid default auth.uid() references public.profiles(id) on delete set null,
  author_name text not null default '' check (char_length(author_name) <= 50),
  observers int not null default 0 check (observers between 0 and 99),  -- 배석 인원
  agenda text not null default '' check (char_length(agenda) <= 3000),   -- 한 줄에 안건 하나
  summary text not null default '' check (char_length(summary) <= 20000),
  result text not null default '' check (char_length(result) <= 10000),
  status text not null default 'draft' check (status in ('draft','signing','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meeting_attendees (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,       -- 계정이 없는 위원은 비워 둠(종이 서명)
  name text not null check (char_length(name) between 1 and 50),
  position text not null default '운영위원' check (position in ('위원장','부위원장','총무','감사','운영위원')),
  attended boolean not null default true,
  sort_order int not null default 0
);
create index if not exists meeting_attendees_meeting_idx on public.meeting_attendees(meeting_id);
create unique index if not exists meeting_attendees_one_user on public.meeting_attendees(meeting_id, user_id) where user_id is not null;

create table if not exists public.meeting_signatures (
  attendee_id uuid primary key references public.meeting_attendees(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  signature text not null check (signature like 'data:image/png;base64,%' and char_length(signature) <= 150000),
  content_hash text not null default '',
  signed_at timestamptz not null default now()
);
create index if not exists meeting_signatures_meeting_idx on public.meeting_signatures(meeting_id);

create table if not exists public.meeting_photos (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  path text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists meeting_photos_meeting_idx on public.meeting_photos(meeting_id);

alter table public.meetings enable row level security;
alter table public.meeting_attendees enable row level security;
alter table public.meeting_signatures enable row level security;
alter table public.meeting_photos enable row level security;

-- 고칠 수 있는 사람: 작성 중(draft)인 회의록의 작성자 · 관리자
create or replace function public.can_edit_meeting(mid uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select public.is_member() and exists (
    select 1 from public.meetings m
    where m.id = mid and m.status = 'draft' and (m.author_id = auth.uid() or public.is_admin())
  );
$$;

-- 서명할 수 있는 사람: 서명 중(signing)인 회의록에 '참석'으로 표시된 본인 계정
create or replace function public.can_sign(aid uuid, mid uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select public.is_member() and exists (
    select 1 from public.meeting_attendees a join public.meetings m on m.id = a.meeting_id
    where a.id = aid and a.meeting_id = mid and a.user_id = auth.uid() and a.attended and m.status = 'signing'
  );
$$;

-- 회의록 내용 지문(SHA-256). 서명 시점에 저장해 두면 나중에 내용이 바뀌었는지 확인할 수 있어요.
create or replace function public.meeting_content_hash(mid uuid) returns text
language sql security definer set search_path = public stable as $$
  select encode(sha256(convert_to(
    concat_ws('|', m.seq, m.kind, m.meeting_date, m.start_time, m.end_time, m.place, m.author_name, m.observers,
      m.agenda, m.summary, m.result,
      (select coalesce(string_agg(concat_ws(':', a.name, a.position, a.attended), ',' order by a.sort_order, a.id), '')
         from public.meeting_attendees a where a.meeting_id = m.id)),
    'UTF8')), 'hex')
  from public.meetings m where m.id = mid;
$$;

-- 회의록 수정 규칙: 서명을 받기 시작하면 내용 잠금, 상태 변경은 정해진 순서로만
create or replace function public.meetings_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.author_id := old.author_id;
  new.created_at := old.created_at;
  new.updated_at := now();

  if old.status <> 'draft' and
     (new.seq, new.kind, new.meeting_date, new.start_time, new.end_time, new.place, new.author_name, new.observers, new.agenda, new.summary, new.result)
     is distinct from
     (old.seq, old.kind, old.meeting_date, old.start_time, old.end_time, old.place, old.author_name, old.observers, old.agenda, old.summary, old.result) then
    raise exception '서명을 받기 시작한 회의록은 내용을 고칠 수 없어요. 서명이 없다면 초안으로 되돌린 뒤 고쳐 주세요.';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status = 'signing' then
      if not exists (select 1 from public.meeting_attendees where meeting_id = old.id and attended) then
        raise exception '참석자가 한 명도 없어요. 참석자를 표시해 주세요.';
      end if;
    elsif old.status = 'signing' and new.status = 'draft' then
      if exists (select 1 from public.meeting_signatures where meeting_id = old.id) then
        raise exception '이미 서명한 위원이 있어 초안으로 되돌릴 수 없어요.';
      end if;
    elsif old.status = 'signing' and new.status = 'closed' then
      null;
    else
      raise exception '이 상태로는 바꿀 수 없어요.';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists meetings_guard_trg on public.meetings;
create trigger meetings_guard_trg before update on public.meetings
  for each row execute function public.meetings_guard();

create or replace function public.signature_prepare() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.content_hash := public.meeting_content_hash(new.meeting_id);
  new.signed_at := now();
  return new;
end; $$;

drop trigger if exists signature_prepare_trg on public.meeting_signatures;
create trigger signature_prepare_trg before insert on public.meeting_signatures
  for each row execute function public.signature_prepare();

-- 접근 규칙
drop policy if exists "meetings read" on public.meetings;
create policy "meetings read" on public.meetings for select to authenticated using (public.is_member());

drop policy if exists "meetings insert" on public.meetings;
create policy "meetings insert" on public.meetings for insert to authenticated
  with check (public.is_member() and author_id = auth.uid() and status = 'draft');

drop policy if exists "meetings update" on public.meetings;
create policy "meetings update" on public.meetings for update to authenticated
  using (public.is_member() and (author_id = auth.uid() or public.is_admin()))
  with check (public.is_member() and (author_id = auth.uid() or public.is_admin()));

drop policy if exists "meetings delete" on public.meetings;
create policy "meetings delete" on public.meetings for delete to authenticated
  using (public.is_member() and ((author_id = auth.uid() and status = 'draft') or public.is_admin()));

drop policy if exists "attendees read" on public.meeting_attendees;
create policy "attendees read" on public.meeting_attendees for select to authenticated using (public.is_member());
drop policy if exists "attendees insert" on public.meeting_attendees;
create policy "attendees insert" on public.meeting_attendees for insert to authenticated with check (public.can_edit_meeting(meeting_id));
drop policy if exists "attendees update" on public.meeting_attendees;
create policy "attendees update" on public.meeting_attendees for update to authenticated
  using (public.can_edit_meeting(meeting_id)) with check (public.can_edit_meeting(meeting_id));
drop policy if exists "attendees delete" on public.meeting_attendees;
create policy "attendees delete" on public.meeting_attendees for delete to authenticated using (public.can_edit_meeting(meeting_id));

drop policy if exists "signatures read" on public.meeting_signatures;
create policy "signatures read" on public.meeting_signatures for select to authenticated using (public.is_member());
drop policy if exists "signatures insert" on public.meeting_signatures;
create policy "signatures insert" on public.meeting_signatures for insert to authenticated
  with check (public.can_sign(attendee_id, meeting_id));
-- 서명 수정은 없음. 잘못된 서명을 지우는 건 관리자만.
drop policy if exists "signatures delete" on public.meeting_signatures;
create policy "signatures delete" on public.meeting_signatures for delete to authenticated using (public.is_admin());

drop policy if exists "photos read" on public.meeting_photos;
create policy "photos read" on public.meeting_photos for select to authenticated using (public.is_member());
drop policy if exists "photos insert" on public.meeting_photos;
create policy "photos insert" on public.meeting_photos for insert to authenticated with check (public.can_edit_meeting(meeting_id));
drop policy if exists "photos delete" on public.meeting_photos;
create policy "photos delete" on public.meeting_photos for delete to authenticated using (public.can_edit_meeting(meeting_id));

-- 회의 사진 보관함(비공개). 폴더 이름 = 회의록 id
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meeting-photos', 'meeting-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "members read meeting photos" on storage.objects;
create policy "members read meeting photos" on storage.objects for select to authenticated
  using (bucket_id = 'meeting-photos' and public.is_member());

drop policy if exists "editors upload meeting photos" on storage.objects;
create policy "editors upload meeting photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'meeting-photos' and case
    when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then public.can_edit_meeting(((storage.foldername(name))[1])::uuid)
    else false end);

drop policy if exists "editors delete meeting photos" on storage.objects;
create policy "editors delete meeting photos" on storage.objects for delete to authenticated
  using (bucket_id = 'meeting-photos' and case
    when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then public.can_edit_meeting(((storage.foldername(name))[1])::uuid)
    else false end);

-- 함수 실행 권한: 로그인 전(anon)에는 주지 않음. 트리거 함수는 아무도 직접 부를 수 없게 함.
revoke execute on function public.meetings_guard() from public, anon, authenticated;
revoke execute on function public.signature_prepare() from public, anon, authenticated;
revoke execute on function public.can_edit_meeting(uuid) from public, anon;
revoke execute on function public.can_sign(uuid, uuid) from public, anon;
revoke execute on function public.meeting_content_hash(uuid) from public, anon;
grant execute on function public.can_edit_meeting(uuid) to authenticated;
grant execute on function public.can_sign(uuid, uuid) to authenticated;
grant execute on function public.meeting_content_hash(uuid) to authenticated;
