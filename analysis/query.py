"""
Phase 2 — RAG query + grounded summary (RESEARCHERS ONLY).

Can run in two modes:
1. Local File Mode (Default):
   Queries local index/ vectors.
2. Database Mode (--db):
   Queries Supabase using the match_embeddings RPC.
"""

from __future__ import annotations
import os
import sys
import json
import argparse

import numpy as np
from embeddings import Embedder, cosine_top_k

# Load environment variables
from dotenv import load_dotenv
load_dotenv()
load_dotenv(dotenv_path="../.env.local")

INDEX_DIR = os.path.join(os.path.dirname(__file__), "index")

SYSTEM_CONTRACT = (
    "You are a research assistant summarising anonymised survey free-text answers about "
    "digital technology in water management. Use ONLY the provided answers. Do not invent "
    "facts, give advice, or add anything not present. Every claim must cite the response_ref(s) "
    "it comes from in square brackets, e.g. [a1b2c3d4:chal_comment]. If the answers do not "
    "support a conclusion, say so plainly."
)


def load_index_local():
    try:
        vectors = np.load(os.path.join(INDEX_DIR, "vectors.npy"))
        with open(os.path.join(INDEX_DIR, "chunks.json"), "r", encoding="utf-8") as fh:
            chunks = json.load(fh)
        with open(os.path.join(INDEX_DIR, "meta.json"), "r", encoding="utf-8") as fh:
            meta = json.load(fh)
        return vectors, chunks, meta
    except FileNotFoundError:
        sys.exit("No index found. Run:  python pipeline.py --source sample_store.json")


def retrieve_local(question: str, k: int, use_model: bool):
    vectors, chunks, meta = load_index_local()
    embedder = Embedder(prefer_local_model=use_model and meta.get("backend") == "e5")
    if embedder.dim != vectors.shape[1]:
        embedder = Embedder(prefer_local_model=meta.get("backend") == "e5")
    qvec = embedder.encode([question], kind="query")[0]
    idx, scores = cosine_top_k(qvec, vectors, k)
    hits = []
    for i, sc in zip(idx, scores):
        c = dict(chunks[int(i)])
        c["score"] = float(sc)
        hits.append(c)
    return hits


def retrieve_db(question: str, k: int, use_model: bool, url: str, key: str):
    """Retrieve similar answers using Supabase vector database (pgvector RPC)."""
    from supabase import create_client
    supabase = create_client(url, key)
    
    # 1. Compute embedding vector
    embedder = Embedder(prefer_local_model=use_model)
    qvec = embedder.encode([question], kind="query")[0]
    
    # 2. Call pgvector similarity search RPC
    res = supabase.rpc("match_embeddings", {
        "query_embedding": qvec.tolist(),
        "match_threshold": 0.0,
        "match_count": k
    }).execute()
    
    hits = []
    for r in res.data:
        hits.append({
            "response_ref": r["response_ref"],
            "question_id": r["question_id"],
            "theme": r["theme"],
            "language": r["language"],
            "text": r["text"],
            "score": r["similarity"],
            "created_at": r.get("created_at")
        })
    return hits


# ---------------------------------------------------------------------------
# Generation backends
# ---------------------------------------------------------------------------
def summarise_extractive(question: str, hits: list[dict]) -> str:
    if not hits:
        return "No matching answers were found, so no conclusion can be drawn."
    by_theme: dict[str, list[dict]] = {}
    for h in hits:
        by_theme.setdefault(h.get("theme") or "other", []).append(h)
    lines = [f'Grounded summary for: "{question}"',
             f"(extractive — drawn directly from {len(hits)} retrieved answer(s); no model used)\n"]
    for theme, items in by_theme.items():
        lines.append(f"• {theme or 'other'} ({len(items)}):")
        for h in items:
            date_str = f" [{h['created_at'][:16]}]" if h.get("created_at") else ""
            lines.append(f"    - \"{h['text']}\"  [{h['response_ref']}]{date_str}")
    return "\n".join(lines)


def summarise_ollama(question: str, hits: list[dict], model: str) -> str:
    import urllib.request
    context = "\n".join(f"[{h['response_ref']}] ({h['language']}) {h['text']}" for h in hits)
    prompt = (
        f"{SYSTEM_CONTRACT}\n\nQuestion: {question}\n\nAnswers:\n{context}\n\n"
        "Write a short grounded summary with citations."
    )
    body = json.dumps({"model": model, "prompt": prompt, "stream": False}).encode()
    req = urllib.request.Request(
        "http://localhost:11434/api/generate", data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read()).get("response", "").strip()
    except Exception as e:
        return f"Error calling local Ollama server: {e}"


def summarise_api(question: str, hits: list[dict], approved: bool) -> str:
    if not approved:
        sys.exit(
            "Refusing to send data to an external API without --i-have-approval. "
            "Use the default extractive backend or a local LLM (ollama)."
        )
    from openai import OpenAI
    client = OpenAI()
    context = "\n".join(f"[{h['response_ref']}] ({h['language']}) {h['text']}" for h in hits)
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": SYSTEM_CONTRACT},
            {"role": "user", "content": f"Question: {question}\n\nAnswers:\n{context}"},
        ],
        temperature=0.2,
    )
    return resp.choices[0].message.content or ""


def format_sources(hits: list[dict]) -> str:
    lines = ["", "Sources:"]
    for h in hits:
        date_str = f" @ {h['created_at'][:16]}" if h.get("created_at") else ""
        lines.append(f"  [{h['response_ref']}] ({h['language']}{date_str}, sim={h['score']:.2f}) {h['text']}")
    return "\n".join(lines)


def main():
    # Reconfigure stdout to use UTF-8 to prevent Windows terminal character mapping errors
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument("question", help="natural-language research question")
    ap.add_argument("--backend", choices=["extractive", "ollama", "api"], default="extractive")
    ap.add_argument("--model", default="llama3", help="local model name for ollama backend")
    ap.add_argument("--k", type=int, default=6)
    ap.add_argument("--no-model", action="store_true", help="force offline hashing embeddings")
    ap.add_argument("--i-have-approval", action="store_true", help="required for --backend api")
    ap.add_argument("--db", action="store_true", help="query Supabase vector database instead of local files")
    ap.add_argument("--json", action="store_true", help="output result as JSON instead of plaintext format")
    args = ap.parse_args()

    sb_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if args.db:
        if not sb_url or not sb_key:
            sys.exit("Supabase environment variables are required for DB operations.")
        hits = retrieve_db(args.question, args.k, use_model=not args.no_model, url=sb_url, key=sb_key)
    else:
        hits = retrieve_local(args.question, args.k, use_model=not args.no_model)

    if args.backend == "extractive":
        summary = summarise_extractive(args.question, hits)
    elif args.backend == "ollama":
        summary = summarise_ollama(args.question, hits, args.model)
    else:
        summary = summarise_api(args.question, hits, args.i_have_approval)

    if args.json:
        # Structured JSON output for API bridges (e.g. Next.js backend)
        output = {
            "summary": summary,
            "sources": hits
        }
        print(json.dumps(output, ensure_ascii=False))
    else:
        print(summary)
        print(format_sources(hits))


if __name__ == "__main__":
    main()
