# 작은도서관 운영위원회 업무공간

로그인한 운영위원(관리자 승인 완료)만 업무 화면을 볼 수 있어요.

| 파일 | 역할 |
|---|---|
| `index.html` | 로그인 · 가입 신청 화면 |
| `app.html` | 홈(한눈에 보기) 화면 — 로그인 필요 |
| `site/.../checklist.html` | 체크리스트 화면 — 로그인 필요 |
| `guard.js` | 보호 화면 상단에서 로그인·승인 여부 검사, 로그아웃 버튼 표시 |
| `auth.js` / `config.js` | 인증 도우미 / Supabase 접속 정보 |
| `supabase-setup.sql` | 가입 신청·승인 구조(데이터베이스 규칙) |

## 처음 한 번만 하는 설정 (Supabase)

1. https://supabase.com 에서 가입 → **New project** 생성 (무료 플랜이면 충분해요).
2. 왼쪽 **SQL Editor** → `supabase-setup.sql` 내용을 통째로 붙여 넣고 **Run**.
3. **Project Settings → API** 에서 `Project URL` 과 `anon public` 키를 복사해 `config.js` 에 붙여 넣기.
   (anon 키는 공개돼도 되는 키예요. **service_role 키는 절대 넣지 마세요.**)
4. **Authentication → Sign In / Providers → Email** 에서 *Confirm email* 을 끄면, 이메일 인증 없이 "가입 신청 → 관리자 승인"만으로 진행돼요.
5. **Authentication → URL Configuration** 의 Site URL 에 `https://yeonssam1202-cyber.github.io/syjh-library/` 입력.
6. 사이트에서 본인 이메일로 **가입 신청** 후, SQL Editor 에서 `supabase-setup.sql` 맨 아래 주석의 `update ...` 한 줄을 실행하면 관리자가 돼요.

## 위원 승인하는 법

위원이 가입 신청하면 Supabase → **Table Editor → profiles** 에 `pending` 으로 나타나요.
`status` 를 `approved` 로 바꾸면 그 위원이 로그인할 수 있어요. 거절은 `rejected`.

## 알아 둘 점

이 저장소는 공개(public)이고 GitHub Pages는 정적 호스팅이라, 화면 파일 자체는 주소를 아는 사람이 직접 내려받을 수 있어요.
지금의 로그인은 "화면 진입 통제"이고, **위원들이 입력한 업무 데이터**는 다음 단계에서 Supabase 에 저장하면서 로그인한 승인 위원에게만 보이도록 DB 규칙으로 보호합니다.
