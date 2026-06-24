-- 0003 — enable pgvector and add embeddings table
--
-- Note: The vector extension was enabled by the user in the database.
-- This script creates the embeddings table to store RAG vector embeddings
-- matching the dimensions of the local intfloat/multilingual-e5-small model (384).

CREATE TABLE IF NOT EXISTS embeddings (
  id        BIGSERIAL PRIMARY KEY,
  chunk_id  BIGINT REFERENCES rag_chunks(id) ON DELETE CASCADE,
  model     TEXT NOT NULL,
  vector    VECTOR(384)
);

-- Cosine distance index for faster matching
CREATE INDEX IF NOT EXISTS embeddings_vector_cosine_idx ON embeddings USING hnsw (vector vector_cosine_ops);

-- Reload Supabase API schema cache to expose the new table immediately
notify pgrst, 'reload schema';

