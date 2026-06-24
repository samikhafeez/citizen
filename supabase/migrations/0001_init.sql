-- Citizen Feedback Chatbot — initial schema (Supabase / PostgreSQL, EU region).
-- Pseudonymous, GDPR-aware. No names, phones, exact addresses or GPS are stored.
-- Run in the Supabase SQL editor (or via the CLI) for production. The local
-- prototype uses a file store instead (lib/store.ts).

-- Phase 2 vector search:
-- create extension if not exists vector;

-- ── survey versioning ───────────────────────────────────────────────
create table if not exists survey_versions (
  id          text primary key,           -- e.g. 'v1-2026-06'
  label       text,
  active      boolean default false,
  created_at  timestamptz default now()
);

create table if not exists questions (
  id            text primary key,
  version_id    text references survey_versions(id),
  theme         text not null,
  type          text not null,            -- single|multiple|scale|yesno|freetext
  prompt_en     text not null,
  prompt_ar     text not null,
  show_if       jsonb,                    -- { questionId, in:[...] }
  ord           int default 0
);

create table if not exists question_options (
  id          bigserial primary key,
  question_id text references questions(id),
  value       text not null,
  label_en    text not null,
  label_ar    text not null,
  ord         int default 0
);

-- ── participation (pseudonymous) ────────────────────────────────────
create table if not exists sessions (
  id              uuid primary key default gen_random_uuid(),
  language        text not null,          -- 'en' | 'ar'
  survey_version  text references survey_versions(id),
  status          text not null default 'started',  -- started|completed|stopped
  started_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  completed_at    timestamptz
);

create table if not exists consent_records (
  id              bigserial primary key,
  session_id      uuid references sessions(id) on delete cascade,
  consent_version text not null,
  agreed          boolean not null,
  created_at      timestamptz default now()
);

create table if not exists demographics (
  session_id   uuid primary key references sessions(id) on delete cascade,
  age_band     text,
  gender       text,
  area_coarse  text
);

create table if not exists responses (
  id              bigserial primary key,
  session_id      uuid references sessions(id) on delete cascade,
  question_id     text references questions(id),
  value           text,                   -- single value or pipe-joined for multi
  free_text       text,                   -- PII-scrubbed before storage (see pii_scrubbed)
  pii_scrubbed    boolean default false,   -- true when free_text was scrubbed on the write path
  language        text not null,
  relevance_label text,                   -- relevant|partially_relevant|off_topic|sensitive|unclear
  skipped         boolean default false,
  created_at      timestamptz default now()
);

create table if not exists interaction_events (
  id          bigserial primary key,
  session_id  uuid references sessions(id) on delete cascade,
  type        text not null,              -- start|consent|answer|skip|back|redirect|complete|stop
  question_id text,
  created_at  timestamptz default now()
);

-- ── researchers / governance ────────────────────────────────────────
create table if not exists admins (
  id          uuid primary key default gen_random_uuid(),
  email       text unique not null,
  role        text not null default 'viewer',  -- admin|viewer
  created_at  timestamptz default now()
);

create table if not exists audit_logs (
  id          bigserial primary key,
  admin_id    uuid references admins(id),
  action      text not null,              -- login|view|export|delete
  detail      text,
  created_at  timestamptz default now()
);

create table if not exists exports (
  id          bigserial primary key,
  admin_id    uuid references admins(id),
  filters     jsonb,
  row_count   int,
  created_at  timestamptz default now()
);

-- ── Phase 2: RAG ────────────────────────────────────────────────────
create table if not exists rag_chunks (
  id            bigserial primary key,
  response_id   bigint references responses(id) on delete cascade,
  question_id   text,
  theme         text,
  language      text,
  text          text not null             -- scrubbed
);

-- Requires the vector extension; e5-small = 384 dims.
-- create table if not exists embeddings (
--   id        bigserial primary key,
--   chunk_id  bigint references rag_chunks(id) on delete cascade,
--   model     text not null,
--   vector    vector(384)
-- );

-- ── Row Level Security ──────────────────────────────────────────────
-- Enable RLS and add policies so only the service role / authenticated
-- researchers can read participant data. The public anon role should only be
-- able to INSERT survey responses, never SELECT them.
alter table sessions            enable row level security;
alter table responses           enable row level security;
alter table consent_records     enable row level security;
alter table demographics        enable row level security;
alter table interaction_events  enable row level security;
-- (Define policies appropriate to your Supabase auth setup.)
