-- 자료실에 "링크" 자료 추가 (함께 볼 웹 주소). supabase-documents.sql 실행 후 한 번만 실행하세요.
-- 링크는 파일이 없으므로 path/orig_name 이 비어 있을 수 있고, 대신 url 에 http(s) 주소를 저장해요.
-- 읽기=승인 위원, 올리기/삭제=관리자 (기존 정책 그대로).

alter table public.documents add column if not exists url text;
alter table public.documents alter column path drop not null;
alter table public.documents alter column orig_name set default '';

alter table public.documents drop constraint if exists documents_url_http;
alter table public.documents add constraint documents_url_http
  check (url is null or (url ~* '^https?://[^\s]+$' and length(url) <= 2000));

alter table public.documents drop constraint if exists documents_file_or_link;
alter table public.documents add constraint documents_file_or_link
  check (path is not null or url is not null);
