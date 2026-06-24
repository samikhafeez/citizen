"""
Local multilingual embeddings for the RAG layer.

Primary backend: `intfloat/multilingual-e5-small` (384-dim, Arabic + English,
runs on CPU, free, nothing leaves the machine).

Fallback backend: a deterministic hashing bag-of-words embedding in pure NumPy.
This needs no model download, so the pipeline is demonstrable fully offline. It
is lower quality and is intended only for prototype/demo runs; use the e5 model
for real analysis.

Nothing here makes a network call to a third party for embedding.
"""

from __future__ import annotations
import re
import hashlib
import numpy as np

FALLBACK_DIM = 256
E5_MODEL = "intfloat/multilingual-e5-small"

_DIACRITICS = re.compile(r"[ً-ْ]")


def _normalize(text: str) -> str:
    t = (text or "").lower()
    t = _DIACRITICS.sub("", t)                 # strip Arabic tashkeel
    t = t.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")
    return t


def _tokens(text: str):
    return [w for w in re.split(r"\W+", _normalize(text), flags=re.UNICODE) if w]


class Embedder:
    """Encodes text to L2-normalised vectors. Cosine similarity == dot product."""

    def __init__(self, prefer_local_model: bool = True):
        self.backend = "hash"
        self.dim = FALLBACK_DIM
        self.model = None
        if prefer_local_model:
            try:
                from sentence_transformers import SentenceTransformer  # type: ignore

                self.model = SentenceTransformer(E5_MODEL)
                self.backend = "e5"
                self.dim = self.model.get_sentence_embedding_dimension()
            except Exception:
                # sentence-transformers not installed / model unavailable → fallback
                self.backend = "hash"

    # ---- public API ----
    def encode(self, texts: list[str], kind: str = "passage") -> np.ndarray:
        """kind is 'passage' (documents) or 'query' (the e5 prefix convention)."""
        if self.backend == "e5":
            prefixed = [f"{kind}: {t}" for t in texts]
            vecs = self.model.encode(prefixed, normalize_embeddings=True)  # type: ignore
            return np.asarray(vecs, dtype=np.float32)
        return np.vstack([self._hash_vec(t) for t in texts]).astype(np.float32)

    # ---- fallback ----
    def _hash_vec(self, text: str) -> np.ndarray:
        vec = np.zeros(self.dim, dtype=np.float32)
        for tok in _tokens(text):
            h = int(hashlib.md5(tok.encode("utf-8")).hexdigest(), 16) % self.dim
            vec[h] += 1.0
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec /= norm
        return vec


def cosine_top_k(query_vec: np.ndarray, matrix: np.ndarray, k: int):
    """Return (indices, scores) of the top-k rows in `matrix` by cosine sim."""
    if matrix.shape[0] == 0:
        return np.array([], dtype=int), np.array([], dtype=float)
    sims = matrix @ query_vec  # both normalised
    k = min(k, sims.shape[0])
    idx = np.argpartition(-sims, k - 1)[:k]
    idx = idx[np.argsort(-sims[idx])]
    return idx, sims[idx]
