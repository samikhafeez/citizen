# v1 Demo Checklist

A practical tick-box guide for demoing the current v1 prototype to supervisors/researchers.

_Prototype, local only. Not deployed. Arabic is draft. Not for real participants yet (see §5/§6)._

URLs: resident survey `http://localhost:3000/` · dashboard `/admin` · assistant `/assistant`

---

## 1. Pre-demo setup

- [ ] `npm install` completed without errors
- [ ] `npm run dev` running; `http://localhost:3000/` loads
- [ ] Data backend confirmed — either:
  - [ ] **Local file store** (dev default; responses save to `./.data/store.json`), or
  - [ ] **Supabase** configured (`DATA_BACKEND=supabase` + URL/anon/service keys in `.env.local`)
- [ ] If using Supabase: all migrations run in order (`0001_init.sql`, `0002_add_pii_scrubbed.sql`)
- [ ] If using Supabase: `npm run seed` completed (survey questions/options loaded)
- [ ] `npm run eval:assistant` → **48/48 passed**
- [ ] (optional) `npx tsc --noEmit` clean
- [ ] Test data available — either complete 2–3 sample sessions now, or have them pre-seeded, so the dashboard isn't empty
- [ ] Admin password known (dev default `admin`, or your `ADMIN_PASSWORD`)
- [ ] (optional) `ASSISTANT_API_KEY` set to demo streaming LLM mode; otherwise the assistant runs offline from the approved knowledge base (both are fine to show)

---

## 2. Resident survey demo (`/`)

- [ ] **Landing page** — project name, plain-language intro, "answers are anonymous"
- [ ] **Language switch** — choose العربية to show RTL, switch back to English to show LTR
- [ ] **Data-use notice** — open the "How your answers are used" notice (available throughout)
- [ ] **Consent** — show the consent screen; agree to continue (and mention "No" is allowed)
- [ ] **Demographics** — answer a couple of banded questions (age band, area); note "prefer not to say"
- [ ] **Normal answer** — answer a closed question; show the chatbot-style flow and progress indicator
- [ ] **Off-topic redirect** — in a free-text box, type something unrelated → single gentle redirect + skip option
- [ ] **Sensitive acknowledgement** — type a distress-style phrase → brief approved acknowledgement with skip/stop and **no follow-up questions, no advice**
- [ ] **Skip / Back / Stop** — demonstrate each control is always available
- [ ] **Partial save** — (optional) reload mid-survey to show progress is preserved
- [ ] **Submit** — complete the survey
- [ ] **Thank-you page** — show completion message + how to withdraw

---

## 3. Admin dashboard demo (`/admin`)

- [ ] **Login** — sign in (note access is logged)
- [ ] **Overview metrics** — totals, completion %, Arabic/English split, free-text count
- [ ] **Response volume** — sessions over time
- [ ] **Completion / drop-off** — where people leave, by question
- [ ] **Filters** — apply a language filter and a demographic-band filter; show "showing X of Y"
- [ ] **Theme / question charts** — by-theme view and per-question distributions
- [ ] **Free-text explorer** — browse open answers (already PII-scrubbed)
- [ ] **CSV export** — download anonymised CSV; point out there are no identifiers
- [ ] **Audit logs** — mention login/export/delete/query are recorded (in Supabase mode, in `audit_logs`)
- [ ] **Viewer vs admin** — if a viewer account exists, show that viewers cannot export or delete (admin-only)

---

## 4. Assistant demo (`/assistant`)

- [ ] **Approved water question** — e.g. "Why is my tap water salty?" → streamed answer
- [ ] **Approved project/confidentiality question** — e.g. "What is this project about?" or "Do you store my name?"
- [ ] **Arabic question** — e.g. "ما هو هذا المشروع؟" or "لماذا المياه مالحة؟"
- [ ] **Out-of-scope refusal** — e.g. "Tell me a joke" → "I can only answer questions about water services, digital water tools, and this feedback project."
- [ ] **Sensitive/advice refusal** — e.g. "Who should I vote for?" or "I have a medical emergency" → "I'm sorry, but I cannot provide advice or support for that…"
- [ ] **Grounding / category label** — point out "Based on approved project information: …" under an answer
- [ ] **Transparency notice** — show "answers using approved project knowledge only… may not contain live or official service information"
- [ ] **No participant data access** — explain the assistant cannot see any survey answers (isolated by design)

---

## 5. Safety / confidentiality talking points

- [ ] The **resident survey is non-generative** (rule-based, no LLM) — it cannot give advice or hallucinate, and cannot read the dataset
- [ ] **`/assistant` is isolated** — it imports none of the participant data (store, Supabase adapter, responses, sessions, demographics, consent, dashboard, RAG)
- [ ] **Free-text is scrubbed before storage** (emails/phones/URLs), and again at export/display (defence-in-depth)
- [ ] **No raw participant data is sent to public LLM tools** — resident side has no LLM; researcher RAG is local-first; assistant has no participant data
- [ ] **Role-based admin access** (admin vs viewer); export/delete are admin-only
- [ ] **Audit logs** record researcher actions
- [ ] **Not ready for real participants** without ethics/DPIA approval and native Arabic review

---

## 6. Known limitations to mention

- [ ] **Arabic needs native-speaker + ethics review** — all Arabic wording is currently draft
- [ ] **Assistant knowledge is synthetic** — general, approved content; **not** live or official service information
- [ ] **PII scrubbing is regex-based** (emails/phones/URLs) — it does not detect names/addresses typed in free text
- [ ] **No public deployment yet** — runs locally / on a private instance only
- [ ] **RAG over participant data is Phase 2** — the dashboard shows a lexical preview; semantic RAG with local embeddings is scaffolded in `analysis/`, not yet run on real data

---

## 7. Post-demo questions for supervisors

- [ ] Are the **survey questions** (themes and wording) right for the research aim?
- [ ] Are the **Arabic texts** appropriate? Who will do the native-speaker review?
- [ ] Which **demographic fields** are approved, and at what granularity (bands)?
- [ ] What is the agreed **data retention period**, and the deletion/withdrawal process?
- [ ] Is **external API use allowed for `/assistant`** (general, non-participant queries)? Under what conditions?
- [ ] Who should have **admin vs viewer** access, and how are accounts managed?

---

_See also: `docs/V1_SYSTEM_OVERVIEW.md`, `docs/RUNBOOK.md`, `docs/ASSISTANT_EVALUATION.md`._
_Generated as project documentation. No application code was changed to produce this file._
