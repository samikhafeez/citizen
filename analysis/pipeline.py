"""
Phase 2 — RAG ingestion pipeline (RESEARCHERS ONLY).

Can run in two modes:
1. Local File Mode (Default):
   Reads from JSON, embeds, writes locally to index/.
2. Database Mode (--db):
   Reads from Supabase (or JSON), embeds locally, and writes chunks/embeddings to Supabase.

Advanced Scrubbing:
Uses spacy Named Entity Recognition (NER) model 'xx_ent_wiki_sm' to automatically
redact person names, locations, and organizations if spacy is installed.
"""

from __future__ import annotations
import os
import re
import json
import argparse
from dataclasses import dataclass, asdict

import numpy as np
from embeddings import Embedder

# Try loading environment variables
from dotenv import load_dotenv
load_dotenv()
load_dotenv(dotenv_path="../.env.local")

INDEX_DIR = os.path.join(os.path.dirname(__file__), "index")

# question_id -> theme (mirrors lib/survey-data.ts). Used to tag chunks.
THEME_BY_Q = {
    "acc_comment": "accessibility",
    "trust_comment": "trust",
    "rel_comment": "relevance",
    "chal_comment": "challenges",
    "imp_comment": "impact",
}


# ---------------------------------------------------------------------------
# 1. PII scrubbing (regex patterns + spaCy NER)
# ---------------------------------------------------------------------------
_PATTERNS = [
    (re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b"), "[email]"),
    (re.compile(r"\+?\d[\d\s().-]{6,}\d"), "[phone]"),
    (re.compile(r"https?://\S+"), "[url]"),
]

# Load spacy model for advanced NER scrubbing if available
_nlp = None
try:
    import spacy
    _nlp = spacy.load("xx_ent_wiki_sm")
    print("Loaded spaCy model 'xx_ent_wiki_sm' successfully for advanced scrubbing.")
except Exception:
    print("Warning: spaCy model 'xx_ent_wiki_sm' not loaded. Falling back to regex scrubbing only.")


def scrub(text: str) -> str:
    out = text or ""
    # 1. Standard regex scrubbing
    for pat, repl in _PATTERNS:
        out = pat.sub(repl, out)
        
    # 2. Advanced NER scrubbing
    if _nlp is not None and out.strip():
        try:
            doc = _nlp(out)
            # Process entities in reverse order of start_char to modify the string in place safely
            for ent in sorted(doc.ents, key=lambda e: e.start_char, reverse=True):
                if ent.label_ in ["PER", "LOC", "ORG"]:
                    label = f"[{ent.label_.lower()}]"
                    out = out[:ent.start_char] + label + out[ent.end_char:]
        except Exception as e:
            # Fallback gracefully if spacy processing fails
            print(f"Warning: spacy scrubbing failed on block: {e}")
            
    return out.strip()


# ---------------------------------------------------------------------------
# 2. Chunk model with metadata for source references
# ---------------------------------------------------------------------------
@dataclass
class Chunk:
    response_ref: str   # pseudonymous: f"{session_id[:8]}:{question_id}"
    question_id: str
    theme: str
    language: str
    text: str           # scrubbed
    response_id: int | None = None  # Supabase response ID reference
    created_at: str | None = None   # Submission date and time


def load_free_text(source_json: str) -> list[Chunk]:
    """Read free-text answers from the app's store.json shape (or an export)."""
    with open(source_json, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    sessions = data.get("sessions", data)
    if isinstance(sessions, dict):
        sessions = list(sessions.values())

    chunks: list[Chunk] = []
    for s in sessions:
        sid = str(s.get("id", "unknown"))
        for a in s.get("answers", []):
            ft = a.get("freeText")
            if not ft or not ft.strip():
                continue
            qid = a.get("questionId", "")
            chunks.append(
                Chunk(
                    response_ref=f"{sid[:8]}:{qid}",
                    question_id=qid,
                    theme=a.get("theme") or THEME_BY_Q.get(qid, ""),
                    language=a.get("language", s.get("language", "")),
                    text=scrub(ft),
                    created_at=a.get("at") or s.get("startedAt")
                )
            )
    return chunks


def load_from_supabase(url: str, key: str) -> list[Chunk]:
    """Fetch all non-skipped responses containing free text directly from Supabase."""
    from supabase import create_client
    supabase = create_client(url, key)
    
    print("Fetching raw responses from Supabase...")
    res = (
        supabase.table("responses")
        .select("id, session_id, question_id, free_text, language, skipped, created_at")
        .eq("skipped", False)
        .not_.is_("free_text", "null")
        .execute()
    )
    
    chunks: list[Chunk] = []
    for r in res.data:
        rid = r["id"]
        sid = str(r["session_id"])
        qid = r["question_id"]
        ft = r["free_text"]
        lang = r["language"]
        created = r["created_at"]
        if not ft or not ft.strip():
            continue
            
        chunks.append(
            Chunk(
                response_ref=f"{sid[:8]}:{qid}",
                question_id=qid,
                theme=THEME_BY_Q.get(qid, ""),
                language=lang,
                text=scrub(ft),
                response_id=rid,
                created_at=created
            )
        )
    return chunks


# ---------------------------------------------------------------------------
# 3. Embed and 4. Store
# ---------------------------------------------------------------------------
def store_index_local(chunks: list[Chunk], vectors: np.ndarray, backend: str) -> None:
    os.makedirs(INDEX_DIR, exist_ok=True)
    np.save(os.path.join(INDEX_DIR, "vectors.npy"), vectors)
    with open(os.path.join(INDEX_DIR, "chunks.json"), "w", encoding="utf-8") as fh:
        json.dump([asdict(c) for c in chunks], fh, ensure_ascii=False, indent=2)
    with open(os.path.join(INDEX_DIR, "meta.json"), "w", encoding="utf-8") as fh:
        json.dump({"backend": backend, "dim": int(vectors.shape[1]), "count": len(chunks)}, fh)


def store_index_db(chunks: list[Chunk], vectors: np.ndarray, backend: str, url: str, key: str) -> None:
    """Store chunks and vector embeddings directly in the Supabase tables."""
    from supabase import create_client
    supabase = create_client(url, key)
    
    print(f"Uploading {len(chunks)} chunks and vectors to Supabase...")
    
    # Avoid duplicate chunks: clear existing RAG chunks for these responses
    response_ids = [c.response_id for c in chunks if c.response_id is not None]
    if response_ids:
        supabase.table("rag_chunks").delete().in_("response_id", response_ids).execute()
        
    for i, c in enumerate(chunks):
        if c.response_id is None:
            # We need a response ID reference to link to the responses table
            print(f"Skipping chunk '{c.response_ref}' (No response_id; cannot link to DB).")
            continue
            
        # 1. Insert chunk metadata
        chunk_res = supabase.table("rag_chunks").insert({
            "response_id": c.response_id,
            "question_id": c.question_id,
            "theme": c.theme,
            "language": c.language,
            "text": c.text
        }).execute()
        
        if not chunk_res.data:
            print(f"Failed to insert chunk '{c.response_ref}'.")
            continue
            
        chunk_id = chunk_res.data[0]["id"]
        
        # 2. Insert vector embedding (as JSON float list)
        vec_list = vectors[i].tolist()
        supabase.table("embeddings").insert({
            "chunk_id": chunk_id,
            "model": backend,
            "vector": vec_list
        }).execute()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="sample_store.json", help="responses JSON")
    ap.add_argument("--dry-run", action="store_true", help="scrub + count, no embedding")
    ap.add_argument("--no-model", action="store_true", help="force offline hashing embeddings")
    ap.add_argument("--db", action="store_true", help="write chunks and embeddings to Supabase")
    ap.add_argument("--db-load", action="store_true", help="load raw responses from Supabase (requires --db)")
    args = ap.parse_args()

    sb_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if args.db_load or (args.db and not args.source):
        if not sb_url or not sb_key:
            raise ValueError("Supabase environment variables (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY) are required for DB operations.")
        chunks = load_from_supabase(sb_url, sb_key)
    else:
        chunks = load_free_text(args.source)

    print(f"Loaded {len(chunks)} free-text chunks (scrubbed).")
    if not chunks:
        print("Nothing to embed. Collect some free-text answers first.")
        return
        
    if args.dry_run:
        for c in chunks[:5]:
            print(" ", json.dumps(asdict(c), ensure_ascii=False))
        return

    embedder = Embedder(prefer_local_model=not args.no_model)
    print(f"Embedding with backend: {embedder.backend} (dim={embedder.dim})")
    vectors = embedder.encode([c.text for c in chunks], kind="passage")
    
    if args.db:
        if not sb_url or not sb_key:
            raise ValueError("Supabase environment variables (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY) are required for DB operations.")
        store_index_db(chunks, vectors, embedder.backend, sb_url, sb_key)
        print("Successfully stored chunks and vector embeddings in Supabase.")
    else:
        store_index_local(chunks, vectors, embedder.backend)
        print(f"Stored {len(chunks)} vectors locally in {INDEX_DIR}/")


if __name__ == "__main__":
    main()
