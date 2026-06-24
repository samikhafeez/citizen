/**
 * Lightweight, pure free-text quality assessment for survey answers.
 *
 * No external calls, no participant data — safe to run on the client (to nudge
 * the resident) and on the server (to derive researcher indicators). It FLAGS
 * low-quality answers; it never blocks them.
 */
import type { RelevanceLabel } from "./types";

export type QualityFlag = "ok" | "too_short" | "repetitive" | "emoji_only";
export type LengthBand = "empty" | "short" | "medium" | "long";

const EMOJI = /\p{Extended_Pictographic}/gu;
const NON_CONTENT = /[\p{P}\p{S}\s]/gu; // punctuation, symbols, whitespace

export function lengthBand(text: string): LengthBand {
  const t = (text || "").trim();
  if (!t) return "empty";
  if (t.length < 15) return "short";
  if (t.length < 80) return "medium";
  return "long";
}

export function assessQuality(text: string): { qualityFlag: QualityFlag; lengthBand: LengthBand } {
  const t = (text || "").trim();
  const band = lengthBand(t);
  if (!t) return { qualityFlag: "too_short", lengthBand: band };

  // Emoji-only / no real content: stripping emoji + punctuation leaves nothing.
  const content = t.replace(EMOJI, "").replace(NON_CONTENT, "");
  if (content.length === 0) return { qualityFlag: "emoji_only", lengthBand: band };

  // Repeated characters ("aaaaaa") or a single word/phrase pasted repeatedly.
  if (/(.)\1{5,}/u.test(t)) return { qualityFlag: "repetitive", lengthBand: band };
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 4) {
    const unique = new Set(words.map((w) => w.toLowerCase()));
    if (unique.size <= Math.ceil(words.length / 3)) {
      return { qualityFlag: "repetitive", lengthBand: band };
    }
  }

  // Very short ("good", "bad", "yes"): few words and little content.
  if (words.length <= 2 && content.length <= 6) {
    return { qualityFlag: "too_short", lengthBand: band };
  }

  return { qualityFlag: "ok", lengthBand: band };
}

export function isRelevant(relevance?: RelevanceLabel | string | null): boolean {
  return relevance === "relevant" || relevance === "partially_relevant";
}
