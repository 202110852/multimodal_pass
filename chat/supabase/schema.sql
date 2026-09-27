-- 복합경로 챗봇 — Supabase(Postgres) 운영 스키마
--
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여 넣고 Run.
-- 여러 번 실행해도 안전하다 (IF NOT EXISTS).
--
-- 담는 것
--   · public.bug_report       화면 우클릭 → 버그 리포트   (src/mastra/bugs.ts)
--   · public.place_report     챗봇 오류 제보 tool         (src/mastra/tools/reportIssue.ts, reports.ts)
--   · public.answer_feedback  답변 좋아요/싫어요          (src/mastra/feedback.ts)
--   · mastra 스키마           에이전트 메모리 — 테이블은 PostgresStore 가 기동 시 자동 생성
--
-- 담지 않는 것: 레거시 관광 POI·FAQ·날씨 테이블/뷰. 없으면 db.ts 가 빈 결과로 처리한다.
--
-- 접근 모델: 챗봇 서버만 postgres 역할(테이블 소유자)로 직접 접속한다.
-- 브라우저는 Supabase Data API 를 쓰지 않으므로 anon/authenticated 는 전부 막는다.
-- RLS 를 켜고 정책을 두지 않으면 Data API 로는 한 행도 보이지 않는다.

-- ── 버그 리포트 ─────────────────────────────────────────────
create table if not exists public.bug_report (
  bug_id      bigint generated always as identity primary key,
  note        text,
  page_url    text        not null,
  user_agent  text,
  context     jsonb       not null,
  screenshot  bytea,
  client_ip   text,
  status      text        not null default 'new'
              check (status in ('new', 'checked', 'fixed', 'rejected')),
  created_at  timestamptz not null default now()
);

create index if not exists bug_report_status_created_idx
  on public.bug_report (status, created_at desc);

-- ── 장소 정보 오류 제보 ─────────────────────────────────────
-- poi_id 는 레거시 POI 테이블이 없어 외래키를 걸지 않는다.
create table if not exists public.place_report (
  report_id   bigint generated always as identity primary key,
  poi_id      bigint,
  place_name  text        not null,
  place_addr  text,
  issue_type  text        not null
              check (issue_type in ('hours', 'address', 'closed', 'phone', 'price', 'location', 'other')),
  detail      text,
  thread_id   text,
  status      text        not null default 'new'
              check (status in ('new', 'checked', 'fixed', 'rejected')),
  created_at  timestamptz not null default now()
);

create index if not exists place_report_status_created_idx
  on public.place_report (status, created_at desc);

-- ── 답변 평가 ──────────────────────────────────────────────
-- 같은 답변(thread_id, message_key)에 다시 누르면 ON CONFLICT 로 덮어쓴다.
create table if not exists public.answer_feedback (
  feedback_id  bigint generated always as identity primary key,
  thread_id    text        not null,
  message_key  text        not null,
  rating       smallint    not null check (rating in (1, -1)),
  reason       text,
  question     text,
  answer       text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (thread_id, message_key)
);

create index if not exists answer_feedback_rating_updated_idx
  on public.answer_feedback (rating, updated_at desc);

-- ── Data API 차단 ──────────────────────────────────────────
alter table public.bug_report      enable row level security;
alter table public.place_report    enable row level security;
alter table public.answer_feedback enable row level security;

revoke all on public.bug_report, public.place_report, public.answer_feedback
  from anon, authenticated;

-- ── 에이전트 메모리 스키마 ─────────────────────────────────
-- 노출 스키마(public)가 아니라 Data API 로는 닿지 않는다. 방어적으로 권한도 걷는다.
create schema if not exists mastra;
revoke all on schema mastra from anon, authenticated;
