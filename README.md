# Citizen Feedback Chatbot — Phase 1 prototype

Bilingual (Arabic / English) chatbot-style survey that collects feedback from
residents in Jordan about **digital technology in water management**, plus a
login-protected **researcher dashboard**. The resident chatbot is a controlled
data-collection instrument: it asks approved questions, checks relevance
locally, and **never gives advice** or uses an LLM. RAG/text-mining is Phase 2,
researcher-facing, and local-first (see `analysis/`).

## Quick start (runs with zero external setup)

```bash
npm install
cp .env.example .env.local      # optional; defaults work for local dev
npm run dev                     # http://localhost:3000
```

- Resident survey (endpoint 1): `http://localhost:3000/`
- Researcher dashboard (endpoint 2): `http://localhost:3000/admin`  (password: `admin`, change via `ADMIN_PASSWORD`)
- General query assistant (endpoint 3): `http://localhost:3000/assistant`

In local dev, responses are saved to `./.data/store.json` (a file store, git-ignored).
No Supabase keys are needed to try the prototype.

## What works in v1

| Area | Status |
|------|--------|
| Language select (AR/EN) + RTL/LTR | ✅ |
| Plain-language info + data-use notice (everywhere) | ✅ |
| Consent gate (records version + timestamp) | ✅ |
| Pseudonymous session (random id, no PII) | ✅ |
| Demographics (banded) | ✅ |
| Guided chatbot survey, 5 themes, branching | ✅ |
| Single / multiple / scale / yes-no / free-text | ✅ |
| Local relevance check (keywords + rules, AR/EN) | ✅ |
| Off-topic redirect (once), sensitive ack (skip/stop, no probing) | ✅ |
| Skip / back / stop + progress indicator | ✅ |
| Partial saving (per answer) + local resume | ✅ |
| Researcher dashboard: metrics, drop-off, distributions | ✅ |
| Free-text explorer + anonymised CSV export | ✅ |
| Session erasure (data-subject right) | ✅ |
| Researcher roles (admin vs viewer); export/delete = admin only | ✅ |
| In-dashboard RAG query panel (lexical, extractive, cited) | ✅ `/admin/rag` |
| Semantic RAG / grounded summaries (local embeddings + LLM) | ✅ `analysis/` |

## Three separated endpoints

| # | Endpoint | Route | Data access | LLM |
|---|----------|-------|-------------|-----|
| 1 | Resident chatbot | `/` | Writes responses only; cannot read the dataset | **None** (rule-based) |
| 2 | Researcher dashboard | `/admin` | Reads anonymised data (login + roles) | RAG, local-first / approved only |
| 3 | General query assistant | `/assistant` | **No access to participant data at all** | External LLM/API OK (no private data flows in); replies **stream** token-by-token |

The three are isolated by construction: only the survey and admin API routes import
the data store; the assistant imports only `lib/assistant.ts` (plus `lib/rate-limit.ts`).
This is what makes it safe for endpoint 3 to use an external LLM — confidential answers
can never reach it.

**Assistant safety caps (endpoint 3 only):** a per-IP message cap
(`ASSISTANT_MAX_MESSAGES_PER_SESSION`, default 20, within `ASSISTANT_RATE_WINDOW_MS`)
and a per-message length cap (`ASSISTANT_MAX_INPUT_CHARS`, default 1200). Over-limit
or over-length messages are rejected **before** any API call, with a polite notice.
These apply only to `/api/assistant` — the survey, dashboard, RAG preview and Supabase
data are unaffected. `ASSISTANT_API_KEY` is read server-side only and never sent to the browser.

### Endpoint 3: approved context + scope guardrails

The general assistant is grounded and bounded:

- **Approved synthetic knowledge base** (`lib/water-knowledge.ts`, ~67 bilingual entries on
  water supply/quality/reporting, digital tools, the project, and confidentiality). It contains
  no participant data and no real local facts (no named authorities, NGOs or phone numbers).
- **Scope classifier + retrieval** (`lib/assistant-guardrails.ts`): every question is classified
  before the LLM is called. In-scope questions retrieve the most relevant approved entries, which
  are the *only* context the model may use. Out-of-scope questions get
  *"I can only answer questions about water services, digital water tools, and this feedback project."*
  Advice/sensitive requests (emergency, medical, legal, immigration, political, financial, personal
  crisis, humanitarian) get *"I'm sorry, but I cannot provide advice or support for that…"* — **neither calls the LLM.**
- **Strict system prompt**: answer only from approved context; never invent facts/authorities/contacts;
  never claim to represent any organisation; no advice; remind users not to share personal details;
  say "no approved information" when the context doesn't cover the question.
- **Isolation**: `/assistant` and its libs import only the knowledge base, guardrails, rate-limit and
  (optionally) the OpenAI API. They import nothing from the survey store, Supabase participant adapter,
  admin functions, responses, sessions, demographics, consent records, or the participant RAG layer.
- **OpenAI API is used only for general queries**, never for participant data. With no key set, the
  assistant answers offline directly from the approved knowledge base.
- The **resident survey remains rule-based and non-generative** — unaffected by any of this.

#### Evaluating the assistant guardrails

A local, deterministic eval checks scope control, retrieval, Arabic/English handling and
safety refusals (40+ cases). It runs the guardrail decision only — **no API key, no
network, no participant data** — so it's repeatable:

```bash
npm run eval:assistant
```

It prints total/passed/failed, failures with reasons, and coverage by category. For
out-of-scope and sensitive inputs it asserts the exact fixed message is returned and the
LLM would **not** be called; for in-scope inputs it asserts at least one approved
knowledge-base entry is retrieved. Cases live in `scripts/eval-assistant.ts`.

## Project structure

```
app/(survey)/   public resident chatbot (no login): landing, consent, survey, complete
app/admin/      researcher dashboard (login-protected via middleware.ts)
app/assistant/  general query/chat assistant (endpoint 3, isolated from participant data)
app/api/        survey + admin + assistant API routes (serverless)
components/     Shell, ChatSurvey (the survey engine UI)
lib/            survey content, deterministic engine, relevance checker, store, i18n, auth
locales/        en.json, ar.json  (UI strings; questions live in lib/DB)
supabase/migrations/  production PostgreSQL schema (pgvector-ready)
analysis/       Phase 2 Python RAG pipeline (local-first, researchers only)
middleware.ts   blocks unauthenticated /admin access
```

## Going to production (Supabase + Vercel)

> Full step-by-step setup, RLS lock-down, smoke tests, researcher accounts, and the
> ethics/DPIA readiness checklist live in **[`docs/RUNBOOK.md`](docs/RUNBOOK.md)**.

The Supabase data backend is **implemented** (`lib/store-supabase.ts`) and selected
with `DATA_BACKEND=supabase`. The app code is unchanged — `lib/store.ts` dispatches
to either the file store (dev) or Supabase (prod).

1. Create a Supabase project in an **EU region** (e.g. Frankfurt).
2. In the SQL editor, run **all** files in `supabase/migrations/` in numeric order
   (`0001_init.sql`, then `0002_add_pii_scrubbed.sql`, …). They are idempotent (`IF NOT EXISTS`).
   **Existing projects:** after pulling changes, run any new migration files before deploying —
   e.g. a project created before `pii_scrubbed` existed must run `0002_add_pii_scrubbed.sql`,
   otherwise saving a survey response fails. The migration also issues
   `notify pgrst, 'reload schema';` so the API exposes the new column immediately.
3. In `.env.local`, set:
   ```
   DATA_BACKEND=supabase
   NEXT_PUBLIC_SUPABASE_URL=...        # from Supabase project settings
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...        # server-only secret, never exposed
   ```
4. Seed the survey content (questions/options) into the DB:
   ```
   npm run seed
   ```
5. Enable Row Level Security so the **anon** role can only INSERT responses,
   never SELECT them; reads happen server-side via the service role. (Policy
   stubs are noted at the bottom of the migration.)
6. Deploy to Vercel (EU region). Set the same env vars in the Vercel dashboard.

### Data mapping

The app works with a denormalised `SessionRecord`; the Supabase adapter maps it
onto the normalised tables (`sessions`, `responses`, `interaction_events`,
`consent_records`, `demographics`). Multi-select answers are stored as JSON so
they round-trip. Deleting a session cascades to all child rows (data-subject erasure).

### Upgrading admin auth to Supabase Auth (recommended for prod)

The prototype uses a signed-cookie password (`lib/auth.ts`). For production:

1. Create researcher users in Supabase Auth (email + password) and an `admins`
   row per user with a `role` of `admin` or `viewer`.
2. Sign in on `/admin/login` via `supabase.auth.signInWithPassword`.
3. In `middleware.ts`, validate the Supabase session (JWT) instead of the
   `cfc_admin` cookie, and gate `view=export`/`DELETE` on the `admin` role.
4. Record `login` / `export` / `delete` actions in `audit_logs`.

## Confidentiality (built in)

- Data minimisation: no names, phone numbers, exact addresses or GPS; age **bands**.
- Pseudonymous sessions; consent recorded with version + timestamp.
- Resident chatbot uses **no LLM**; relevance checking is **local** and auditable.
- Free-text is **scrubbed of personal detail before storage** (resident write path),
  and **again at export/display** as defence-in-depth. Only the scrubbed text is
  persisted (`responses.free_text`, with `pii_scrubbed=true`); the raw input is never stored.
- Researcher access is login-gated; CSV export contains no identifiers.
- **Never** paste raw participant data into public ChatGPT/Gemini/Claude tools.

## ⚠️ Before any real-world use

- Native Arabic review + ethics approval of **all** wording (questions, consent,
  redirects, the sensitive-answer acknowledgement). Arabic strings here are
  indicative only.
- Confirm the data retention period and the deletion/withdrawal process.
- Complete a DPIA; confirm UK GDPR / Data Protection Act 2018 obligations (and any
  Jordan data-management requirements) with your data-protection team.

## Try it without Next.js

Open `public/demo.html` directly in a browser for a zero-install walkthrough of
the resident chatbot (no server, saves to the browser only).
