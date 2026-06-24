-- 0004 — match_embeddings RPC for pgvector similarity search
--
-- This function is used by both the python query script and Next.js
-- to execute similarity searches over embeddings.

CREATE OR REPLACE FUNCTION match_embeddings(
  query_embedding vector(384),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  chunk_id bigint,
  response_ref text,
  question_id text,
  theme text,
  language text,
  text text,
  similarity float,
  created_at timestamptz
)
LANGUAGE sql STABLE
AS $$
  SELECT
    rc.id AS chunk_id,
    CONCAT(SUBSTRING(CAST(res.session_id AS text) FROM 1 FOR 8), ':', rc.question_id) AS response_ref,
    rc.question_id,
    rc.theme,
    rc.language,
    rc.text,
    CAST(1 - (e.vector <=> query_embedding) AS float) AS similarity,
    res.created_at AS created_at
  FROM embeddings e
  JOIN rag_chunks rc ON e.chunk_id = rc.id
  JOIN responses res ON rc.response_id = res.id
  WHERE 1 - (e.vector <=> query_embedding) > match_threshold
  ORDER BY e.vector <=> query_embedding
  LIMIT match_count;
$$;

-- Reload Supabase API schema cache to expose the function immediately
notify pgrst, 'reload schema';

