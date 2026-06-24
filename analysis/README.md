# Phase 2 — RAG / text-mining (researchers only)

Local-first, confidentiality-first analysis of the **free-text** answers. Never
exposed to respondents. Runs on collected data in July.

```
extract free-text → scrub PII → add metadata → embed locally → vector index
research question → retrieve → grounded, cited summary → researcher verifies
```

## Setup

```bash
cd analysis
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt          # numpy is enough to run offline
```

`sentence-transformers` is recommended (downloads the local multilingual model
`intfloat/multilingual-e5-small`). Without it, the pipeline automatically falls
back to a pure-NumPy hashing embedding so you can still run end-to-end offline.

## Run (with the included synthetic sample)

```bash
# 1. Build the index from sample data (offline fallback embeddings)
python pipeline.py --source sample_store.json --no-model

# 2. Ask a question — grounded, cited, no LLM needed (extractive)
python query.py "what challenges do people face with digital water tools?"
python query.py "هل التبليغ يؤدي إلى تحسن؟" --k 5
```

Use real data by pointing `--source` at the app's dev store
(`../.data/store.json`) or a Supabase export with the same shape. For real
analysis, install `sentence-transformers` and drop `--no-model`.

## Generation backends (`query.py --backend`)

| Backend | What it does | Confidentiality | Needs |
|---------|--------------|-----------------|-------|
| `extractive` (default) | Groups retrieved answers by theme, with citations. **No LLM.** Strictly grounded. | Highest — nothing leaves the machine | nothing |
| `ollama` | Summary via a **local** LLM at `localhost:11434` | High — local only | `ollama run llama3` |
| `api` | Approved external model (`gpt-4o-mini`); only scrubbed chunks are sent | Conditional | `--i-have-approval` + `OPENAI_API_KEY` |

The `api` backend refuses to run without `--i-have-approval`. **Never** send raw,
unscrubbed data anywhere, and never paste participant data into public chatbot tools.

## Files

- `embeddings.py` — local embedder (e5 model, NumPy hashing fallback) + cosine search
- `pipeline.py` — load → scrub → embed → write `index/`
- `query.py` — retrieve → grounded summary (extractive / ollama / api) → cite sources
- `sample_store.json` — synthetic data so you can try the flow immediately
- `index/` — generated private vector store (git-ignored)

## Guarantees

- PII scrubbing happens **before** embedding.
- Embeddings are produced **locally**; no text is sent out to embed.
- Every summary cites its `response_ref` sources; an uncited summary is not evidence.
- This layer runs only on **anonymised** data and only after ethics/DP approval.
