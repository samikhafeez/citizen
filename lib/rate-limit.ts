/**
 * Lightweight in-memory rate limiter for the prototype.
 *
 * Counts requests per key within a rolling window. Suitable for a local /
 * single-instance prototype only — the counters live in process memory, so they
 * reset on restart and are NOT shared across serverless instances. For real
 * public deployment, back this with a shared store (e.g. Redis / Upstash).
 *
 * Used ONLY by the /assistant endpoint. It does not touch participant data.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit(key: string, max: number, windowMs: number): RateResult {
  const now = Date.now();

  // Opportunistic cleanup so the map can't grow without bound.
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (now > b.resetAt) buckets.delete(k);
  }

  let b = buckets.get(key);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  if (b.count >= max) {
    return { allowed: false, remaining: 0, resetAt: b.resetAt };
  }
  b.count += 1;
  return { allowed: true, remaining: max - b.count, resetAt: b.resetAt };
}
