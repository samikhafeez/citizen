# Citizen Feedback Chatbot — v1 System Overview

A plain-language overview of the current v1 prototype for supervisors and researchers.

_Status: prototype, running locally. Not deployed. Arabic wording is draft pending
native-speaker and ethics review. Not yet ready for real participants (see final section)._

---

## 1. Project purpose

The project studies how useful and usable a **bilingual (Arabic/English) chatbot-style
survey** is for collecting feedback from people in Jordan — refugees first, then other
communities — about **digital technology in water management**. The chatbot is the
research instrument; the academic aim is to evaluate this conversational approach to
feedback collection, not to deliver a water service.

Two kinds of data are collected: broad demographic bands (e.g. age range, general area)
and feedback across five themes — accessibility of digital tools, trust & willingness,
relevance, challenges, and impact of reporting water issues.

---

## 2. Three-endpoint architecture

The system is deliberately split into three separated endpoints with different users,
permissions, and data access.

| # | Endpoint | Route | Who uses it | LLM |
|---|----------|-------|-------------|-----|
| 1 | Resident survey | `/` | Residents (public, no login) | **None** — rule-based, non-generative |
| 2 | Researcher dashboard | `/admin` | Authorised researchers (login + roles) | Phase 2 RAG, local-first / approved only |
| 3 | General assistant | `/assistant` | Anyone with general questions | External LLM/API allowed; **no participant data** |

Only endpoints 1 and 2 touch participant data. Endpoint 3 is isolated by construction.

```
Resident (/) ──writes──▶ secure store ──reads──▶ Researcher (/admin)
                                   ▲
                                   │ (no connection)
General assistant (/assistant) ────┘  uses only the synthetic knowledge base
```

---

## 3. What each endpoint can and cannot do

### 1) Resident survey — `/`
**Can:** choose language (AR/EN, RTL/LTR); show plain-language info and a data-use notice;
take consent; create a pseudonymous session; ask banded demographics; run a guided,
branching survey one question at a time; check free-text relevance locally; redirect once
if off-topic; acknowledge a sensitive answer and offer skip/stop; save partial progress.
**Cannot:** give advice, referrals or support; generate free-form text; use an LLM; read
the dataset or any other participant's answers; expose researcher tools.

### 2) Researcher dashboard — `/admin`
**Can:** require individual login (admin/viewer roles); show overview metrics, response
volume over time, completion and drop-off, theme- and question-level charts, and language
comparison; filter by language and demographic band; review (scrubbed) free-text; export
anonymised CSV (admin only); delete a session (admin only); run a Phase 2 lexical RAG
preview; log access in `audit_logs`.
**Cannot:** be reached without authentication; let viewers export or delete; expose raw
identifiers (there are none).

### 3) General assistant — `/assistant`
**Can:** answer general questions about water services, digital water tools, and the
project, using only an approved synthetic knowledge base; stream replies; show a grounding
label and a transparency note; refuse out-of-scope and advice/sensitive questions with
fixed messages.
**Cannot:** see survey responses, sessions, demographics, consent records, exports or
dashboard data; give medical/legal/immigration/political/financial/emergency advice;
invent authorities, NGOs, phone numbers or procedures; file reports or take actions.

---

## 4. Data flow: resident survey → store → dashboard

```
Resident answer (/)
   → local relevance check (keywords + rules, AR/EN; no external call)
   → free-text PII-scrubbed BEFORE storage (emails/phones/URLs → placeholders)
   → saved per-answer to the secure store (pseudonymous session id; no name/phone/address/GPS)
        • dev:  local file store (.data/store.json)
        • prod: Supabase PostgreSQL (EU region), via the service role on the server only
   → researcher dashboard (/admin) reads anonymised data:
        metrics · completion/drop-off · theme/question charts · language & demographic filters
        · free-text explorer (scrubbed) · anonymised CSV export · session deletion
   → (Phase 2) anonymised free-text → local embeddings → grounded, cited summaries
```

Structured (closed) answers drive the charts; short free-text feeds qualitative and Phase 2
analysis. Demographic answers are also projected into a `demographics` table for filtering.

---

## 5. Confidentiality controls

- **Data minimisation:** no names, phone numbers, exact addresses or GPS; age and area as
  **bands**; gender optional with "prefer not to say".
- **Pseudonymous sessions:** random session id, not linked to identity.
- **Consent:** recorded with version and timestamp before any questions.
- **Free-text scrubbing before storage**, and again at export/display (defence-in-depth).
- **Encryption** in transit and at rest (production hosting); EU data residency.
- **Role-based researcher access** (admin vs viewer); export and deletion are admin-only.
- **Audit logging** of login, export, delete, and assistant queries.
- **Server-side secrets:** service-role and API keys are read server-side only, never sent
  to the browser.
- **No raw participant data to public LLM tools.** The resident side uses no LLM; the
  researcher RAG layer is local-first; the assistant has no participant data.

---

## 6. Why the resident survey stays non-generative

The resident-facing chatbot is a controlled data-collection instrument for a potentially
vulnerable population. Keeping it fully rule-based means it **cannot** improvise advice,
hallucinate, be steered into a trauma conversation, or leak the dataset — because it has no
generative model and no read access to collected data. All messages it shows are
pre-written, approved strings. This is the single most important safety property of the
system, and it is enforced architecturally, not just by prompt wording.

---

## 7. How `/assistant` is isolated from participant data

`/assistant` and its libraries import **only** the synthetic knowledge base, the
guardrails, the rate-limiter, the OpenAI API (if configured), and React/Next. They import
**nothing** from the survey store, the Supabase participant-data adapter, admin functions,
responses, sessions, demographics, consent records, exports, the dashboard, or the
participant RAG layer. Because confidential answers can never reach it, using an external
LLM there is safe. Every question is also classified before any model call, so
out-of-scope and advice/sensitive requests are answered with fixed messages and never
reach the LLM. (Full detail in `docs/ASSISTANT_EVALUATION.md`.)

---

## 8. Current v1 features (completed)

- Bilingual resident survey (AR/EN, RTL/LTR), language selectable.
- Plain-language project info and a data-use notice available throughout.
- Informed consent gate (version + timestamp).
- Pseudonymous sessions; banded demographics.
- Guided chatbot survey across five themes with conditional branching.
- Question types: single, multiple, scale, yes/no, optional free-text.
- Local relevance checking (AR/EN keywords + rules): relevant / partially / off-topic /
  sensitive / unclear; redirect once; no trauma follow-up; no advice.
- Skip / back / stop always available; progress indicator; partial saving.
- Secure storage with a pluggable backend (local file store in dev, Supabase in prod).
- Free-text PII scrubbing before storage (+ at export/display).
- Researcher dashboard: metrics, response volume, completion/drop-off, theme/question
  charts, language comparison, demographic filters, free-text explorer, anonymised CSV
  export, session deletion, warnings/limitations panel.
- Role-based researcher login (admin/viewer) with audit logging.
- Endpoint 3 assistant: 98-entry approved synthetic knowledge base, scope/safety
  guardrails, streaming replies, Stop/New-chat, conversation persistence, per-IP and
  per-message caps, transparency note and grounding labels.
- Deterministic assistant evaluation suite (48/48). See `docs/ASSISTANT_EVALUATION.md`.
- Documentation: `README.md`, `docs/RUNBOOK.md`, `docs/ASSISTANT_EVALUATION.md`, this file.

---

## 9. Phase 2 features (not implemented, or only scaffolded)

- **Semantic RAG over participant free-text** for researchers: the Python pipeline
  (`analysis/`) is scaffolded and runnable on sample data (scrub → local multilingual
  embeddings → vector store → grounded, cited summaries), but is not yet run on real
  collected data and not wired into the dashboard beyond a **lexical preview**.
- **Local or approved-API LLM summarisation** for researchers — scaffolded, gated behind
  approval; default is local-first / extractive.
- **Supabase Auth** for researchers — the data backend and role gating exist; production
  auth (JWT, per-user accounts) is documented but the prototype uses a signed-cookie
  password by default.
- **Knowledge graph / richer analytics / multi-project support** — future roadmap only.

---

## 10. Known limitations

- **Arabic needs native review.** All Arabic wording (survey questions, consent,
  redirects, the sensitive-answer acknowledgement, assistant knowledge base, refusal
  messages, labels) is **draft** and must be reviewed by a native speaker and approved by
  the ethics/research team before real use.
- **Ethics approval required before real participants.** A DPIA and ethics sign-off are
  prerequisites (collecting feedback from a potentially vulnerable group).
- **Assistant knowledge is synthetic, not live or official.** `/assistant` answers from an
  approved general knowledge base; it does not contain live or official service
  information and says so in a visible notice.
- **PII scrubbing is regex-based** (emails, phone numbers, URLs) — it does not detect names
  or addresses typed in free text. The closed-question-first design plus the scrub are the
  v1 mitigation; stronger name detection (NER) is Phase 2.
- **Scope detection and retrieval are lexical**, not semantic; unusually phrased questions
  can occasionally be mis-routed. The eval suite is the regression guard.
- **Rate limiting is in-memory** and single-instance (fine for the prototype, not for
  public scale).
- **No public deployment yet.** The system runs locally / on a private instance only.

---

## 11. How to run locally

```bash
# from the project root
npm install
cp .env.example .env.local      # optional in dev; defaults work
npm run dev                     # http://localhost:3000
```

- Resident survey: `http://localhost:3000/`
- Researcher dashboard: `http://localhost:3000/admin` (dev password: `admin`, set via `ADMIN_PASSWORD`)
- General assistant: `http://localhost:3000/assistant`

In dev, responses are saved to `./.data/store.json` (a local file store, git-ignored); no
Supabase keys are required to try the prototype. To enable the assistant's LLM mode, set
`ASSISTANT_API_KEY` in `.env.local`; without it the assistant answers offline from the
approved knowledge base. For production setup (Supabase + Vercel + RLS), see
`docs/RUNBOOK.md`.

---

## 12. How to test

```bash
npm run dev             # run the app and click through all three endpoints
npm run seed            # (Supabase mode only) load survey questions/options into the DB
npm run eval:assistant  # deterministic guardrail eval for /assistant (48/48 expected)
```

`npm run eval:assistant` runs entirely before any LLM call (no key, no network, no
participant data) and prints total/passed/failed, failures with reasons, and coverage by
category. Type safety can be checked at any time with `npx tsc --noEmit`.

---

## 13. Demo flow for the academic team

1. **Resident survey (`/`):** choose Arabic to show RTL, read the info + data-use notice,
   give consent, answer a couple of demographic bands, then a few theme questions.
   Demonstrate skip / back / stop and the progress indicator.
2. **Relevance + safety:** in a free-text box, type something off-topic → show the single
   gentle redirect; then type a distress-style phrase → show the approved acknowledgement
   with skip/stop and **no follow-up questions**.
3. **Partial save:** reload mid-survey to show progress is preserved; then complete and
   show the thank-you page.
4. **Researcher dashboard (`/admin`):** log in; show overview metrics, response volume,
   completion/drop-off, theme/question charts; apply a language and demographic filter;
   open the free-text explorer (scrubbed); export an anonymised CSV; show role gating
   (viewer cannot export/delete).
5. **Assistant (`/assistant`):** ask an accepted question ("Why is my tap water salty?",
   "ما هو هذا المشروع؟") → show streamed answer + grounding label; ask an out-of-scope
   question ("Tell me a joke") → fixed scope message; ask a sensitive one ("Who should I
   vote for?") → fixed refusal. Point out the transparency note and that it has no access
   to survey answers.
6. **Evidence:** run `npm run eval:assistant` to show 48/48, and reference
   `docs/ASSISTANT_EVALUATION.md` and `docs/RUNBOOK.md`.

---

## 14. Not ready for real participants until…

All of the following are in place:

- [ ] **Ethics approval** and a completed **DPIA** for collecting feedback from a
  potentially vulnerable group.
- [ ] **Native-speaker review** and ethics approval of **all** Arabic (and English) wording:
  survey questions, options, consent, data-use notice, redirects, the sensitive-answer
  acknowledgement, and the assistant's knowledge base, refusal messages and labels.
- [ ] **Confirmed data retention period** and a working deletion/withdrawal process.
- [ ] **Production data store** stood up (Supabase EU), migration applied, `npm run seed`
  done, and **Row Level Security** locking the anon role out of participant tables.
- [ ] **Researcher accounts and roles** agreed; production auth (Supabase Auth) enabled.
- [ ] **Decision on external LLM use** for `/assistant` (and any Phase 2 summaries)
  confirmed with the data-protection team.
- [ ] **Post-deploy smoke test** passed on the EU instance (see `docs/RUNBOOK.md` §7).

Until every box is checked, use the system only with the **internal academic team and test
data** — not with real participants.

---

_Generated as project documentation. No application code was changed to produce this file._
