# Deployment & readiness runbook

How to take the prototype from "runs on my laptop" to "ready to collect real data",
and the approvals that must be in place **before** any real participant uses it.

Target per spec: prototype deployed end of June, data collection + RAG in July.

---

## 0. Prerequisites

- Node 18+ and npm.
- A GitHub repo for the project.
- A Supabase account.
- A Vercel account (free hobby tier is enough for the pilot).
- Decisions from the academic/ethics team (see §9) — at least retention period and
  approved consent/redirect wording.

---

## 1. Local sanity check (file backend)

```bash
npm install
npm run dev
```

- `/` resident survey, `/admin` dashboard (password `admin`), `/assistant`.
- Confirm: language switch (AR/EN + RTL), consent gate, a full survey run with
  skip/back/stop, off-topic redirect, and that the dashboard shows the response.

---

## 2. Create the Supabase project

1. New project, **EU region (Frankfurt)** — required for GDPR data residency.
2. SQL editor → run **every** file in `supabase/migrations/` in numeric order
   (`0001_init.sql`, then `0002_add_pii_scrubbed.sql`, …). The migrations are idempotent
   (`IF NOT EXISTS`), so re-running them is safe.
3. (Phase 2 only) enable pgvector: `create extension if not exists vector;` and
   uncomment the `embeddings` table in the migration.

> **Existing Supabase projects:** after pulling new code, always run any new migration
> files in `supabase/migrations/` (in order) before deploying. For example, projects
> created before `pii_scrubbed` existed must run `0002_add_pii_scrubbed.sql`, or saving a
> survey response will fail because the app writes a column the database is missing.
> The migration also runs `notify pgrst, 'reload schema';` so the Supabase API picks up
> the new column immediately.

---

## 3. Configure environment

Create `.env.local` (never commit it):

```
DATA_BACKEND=supabase
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...        # Project Settings → API
SUPABASE_SERVICE_ROLE_KEY=...            # Project Settings → API (server-only secret)

ADMIN_PASSWORD=<long random string>      # used only until Supabase Auth is enabled
ADMIN_COOKIE_SECRET=<long random string>

# Endpoint 3 (optional). Leave blank to use the offline FAQ fallback.
ASSISTANT_API_KEY=
ASSISTANT_MODEL=gpt-4o-mini
```

---

## 4. Seed the survey content

```bash
npm run seed
```

Loads `survey_versions`, `questions`, `question_options` from `lib/survey-data.ts`.
Re-run any time you change the questions (it is idempotent for the current version).

---

## 5. Lock down the database (Row Level Security)

The app reads/writes **server-side using the service role**, which bypasses RLS.
The public anon key should therefore be able to do **nothing** on participant tables.
Enable RLS and add no anon policies (RLS-on with no policy = deny):

```sql
alter table sessions           enable row level security;
alter table responses          enable row level security;
alter table consent_records    enable row level security;
alter table demographics       enable row level security;
alter table interaction_events enable row level security;
-- No policies for the anon role → anon cannot read or write these tables.
-- The service role (server) bypasses RLS and is the only path in/out.
```

Verify: with the anon key, `select * from responses` must return zero rows / be denied.

---

## 6. Deploy to Vercel

1. Import the GitHub repo into Vercel.
2. Set the **EU region** for functions.
3. Add every variable from §3 in Project → Settings → Environment Variables.
4. Deploy. HTTPS/TLS is automatic.

---

## 7. Post-deploy smoke test (do this every deploy)

- [ ] Complete one full survey in **Arabic** and one in **English** on a real phone.
- [ ] Off-topic free-text answer triggers a single redirect, then accepts/skips.
- [ ] A distress keyword shows the approved acknowledgement with skip/stop and **no** follow-up.
- [ ] `/admin` shows the new responses; metrics, drop-off and distributions render.
- [ ] Submit a free-text answer containing an email/phone; confirm it is stored
      **already scrubbed** (`responses.free_text` shows `[email]`/`[phone]`,
      `pii_scrubbed=true`). Free-text is scrubbed before storage and again at
      export/display as defence-in-depth.
- [ ] CSV export downloads and contains **no** identifiers.
- [ ] Delete a test session → it disappears (child rows cascade).
- [ ] `/assistant` answers a general question and never references survey data.
- [ ] Confirm rows appear in `audit_logs` for login / export / delete.

---

## 8. Researcher accounts (Supabase Auth)

Until enabled, login uses the single `ADMIN_PASSWORD`. To move to per-researcher accounts:

1. Supabase → Authentication → add each researcher (email + password).
2. Insert a matching row per researcher:
   ```sql
   insert into admins (email, role) values ('researcher@uni.ac.uk', 'admin');
   insert into admins (email, role) values ('viewer@uni.ac.uk', 'viewer');
   ```
3. Researchers sign in at `/admin/login` with their email; role (admin/viewer)
   comes from `admins`. Viewers can browse and run RAG queries; **export and
   delete require the admin role** (already enforced server-side).
4. Optional hardening: validate the Supabase JWT in `middleware.ts` instead of the
   signed cookie, and set the `audit_logs.admin_id` to the signed-in user.

---

## 9. Ethics / data-protection readiness (BEFORE real participants)

Engineering being "done" is not the gate — these are:

- [ ] **DPIA** completed and signed off (vulnerable population + personal data).
- [ ] **Ethics approval** obtained from the relevant board.
- [ ] **Native Arabic review** of every string: questions, options, consent,
      data-use notice, redirects, and the sensitive-answer acknowledgement.
- [ ] **Consent wording** finalised and matched in `locales/*.json` + `consent_records`.
- [ ] **Retention period** decided, documented, and an erasure schedule in place.
- [ ] **Withdrawal route** defined (how a participant asks for deletion, and who acts).
- [ ] **Hosting/residency** confirmed (Supabase EU + Vercel EU) and acceptable to DP team.
- [ ] **Endpoint 3 / external LLM**: confirm sending *general, non-participant* queries
      to an external API is acceptable; if not, leave `ASSISTANT_API_KEY` blank (offline FAQ)
      or point it at a self-hosted/EU model.
- [ ] **Jordan-side requirements** reviewed if data is collected in-country.
- [ ] **Named researchers** and their roles agreed; access list recorded.

### Open questions to confirm with the supervisor / DP team

1. Exact retention period, and delete-vs-fully-anonymise at the end?
2. Which demographic fields are permitted, and at what granularity (bands)?
3. Is any external API LLM permitted at all (endpoint 3, or Phase 2 summaries)? Under what agreement?
4. Approved final wording for consent, data-use notice, and every redirect/acknowledgement.
5. What — if anything — should a distress answer signpost (as a static, approved notice)?

---

## 10. Go / no-go gate

Do **not** open to real participants until: §7 smoke test passes on the deployed
EU instance, RLS denies anon access to participant tables (§5), and **every box in
§9 is checked**. Until then, restrict use to the internal academic team with test data.
```
