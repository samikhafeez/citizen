/**
 * Lightweight PII scrubbing for free-text answers.
 *
 * Replaces obvious personal identifiers with placeholders:
 *   emails → [email], URLs → [url], simple addresses → [address],
 *   phone-like sequences → [phone], other long digit runs (IDs) → [number].
 *
 * Pure and dependency-free, so it is safe to call on the resident write path.
 * Defence-in-depth: applied BEFORE storage and AGAIN at export/display.
 * Scrubbing is idempotent — re-running on scrubbed text is harmless.
 *
 * Deliberately conservative regex, NOT full NER: it will not catch every name
 * or address. Stronger detection (spaCy NER) is a Phase 2 analysis-side task,
 * and the resident UI reminds people not to share personal details.
 */
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const URL = /https?:\/\/\S+/g;
// "building 12", "apt 3", "street 5", "house no 7" → [address] (EN)
const ADDRESS_EN = /\b(?:apartment|apt|flat|building|bldg|block|street|st|house|home|no)\.?\s*#?\s*\d{1,5}\b/gi;
// Arabic: شارع/بناية/عمارة/حي/منزل/بيت/رقم + number → [address]
const ADDRESS_AR = /(?:شارع|بنايه|بناية|عماره|عمارة|حي|منزل|بيت|رقم)\s*#?\s*\d{1,5}/g;
// Phone-like sequence (8+ chars incl. separators).
const PHONE = /\+?\d[\d\s().-]{6,}\d/g;
// Remaining standalone long digit runs (e.g. ID/registration numbers).
const ID_NUM = /\b\d{5,}\b/g;

export function scrub(t: string): string {
  return (t || "")
    .replace(EMAIL, "[email]")
    .replace(URL, "[url]")
    .replace(ADDRESS_EN, "[address]")
    .replace(ADDRESS_AR, "[address]")
    .replace(PHONE, "[phone]")
    .replace(ID_NUM, "[number]")
    .trim();
}
