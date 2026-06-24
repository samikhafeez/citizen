import type { RelevanceLabel } from "./types";

/**
 * Local, rule-based relevance checker for resident free-text answers.
 *
 * Confidentiality note: this runs entirely on the server (or client preview)
 * with no external calls. Raw participant text is NEVER sent to an external
 * model to judge relevance. The check is intentionally simple and auditable.
 *
 * It returns one of: relevant | partially_relevant | off_topic | sensitive | unclear
 */

// Water-management vocabulary (English + Arabic), lowercased.
const WATER_TERMS = [
  // English
  "water", "tap", "faucet", "pipe", "leak", "bill", "billing", "app", "report",
  "supply", "tank", "quality", "outage", "cut", "pressure", "drink", "drinking",
  "shortage", "meter", "provider", "delivery", "truck", "well", "pump", "sewage",
  "clean", "dirty", "salty", "smell", "ration", "tanker", "miyahuna",
  "yarmouk", "utility", "service", "alert", "notification", "sms", "whatsapp",
  // digital tools / trust / barriers / project (still within feedback scope)
  "online", "internet", "website", "application", "message", "update", "digital",
  "trust", "privacy", "data", "survey", "project", "feedback", "language",
  "afford", "expensive", "cost", "coverage", "signal", "literacy", "access",
  // Arabic
  "ماء", "مياه", "صنبور", "حنفية", "أنبوب", "انبوب", "تسرب", "تسريب", "فاتورة",
  "فواتير", "تطبيق", "إبلاغ", "ابلاغ", "تبليغ", "بلاغ", "خزان", "جودة", "انقطاع",
  "ضغط", "شرب", "نقص", "عداد", "مزود", "صهريج", "تنكر", "بئر", "مضخة", "صرف",
  "نظيف", "وسخ", "مالح", "رائحة", "خدمة", "تنبيه", "إشعار",
  "إنترنت", "انترنت", "موقع", "ثقة", "خصوصية", "بيانات", "استبيان", "مشروع",
  "لغة", "تغطية", "إشارة", "تكلفة", "غالي", "وصول",
];

// Distress / safety signals (English + Arabic). Triggers the sensitive path.
const DISTRESS_TERMS = [
  // English
  "suicide", "kill myself", "want to die", "end my life", "hurt myself",
  "abuse", "abused", "violence", "beaten", "threat", "threatened", "danger",
  "unsafe", "afraid for my life", "no food", "starving", "die",
  // Arabic
  "انتحار", "أقتل نفسي", "اريد ان اموت", "أريد أن أموت", "أؤذي نفسي", "اذي نفسي",
  "عنف", "ضرب", "تهديد", "خطر", "خائف على حياتي", "لا يوجد طعام", "أموت", "اموت",
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    // strip Arabic diacritics (tashkeel)
    .replace(/[ً-ْ]/g, "")
    // normalise alef variants and ta marbuta to improve matching
    .replace(/[آأإ]/g, "ا")
    .trim();
}

function containsAny(text: string, terms: string[]): boolean {
  const t = normalize(text);
  return terms.some((term) => t.includes(normalize(term)));
}

export function checkRelevance(input: string): RelevanceLabel {
  const text = (input || "").trim();

  // Empty or trivially short → unclear (the caller may also treat empty as skip).
  if (text.length === 0) return "unclear";

  // Safety first.
  if (containsAny(text, DISTRESS_TERMS)) return "sensitive";

  const hasWater = containsAny(text, WATER_TERMS);
  const words = text.split(/\s+/).filter(Boolean).length;

  if (hasWater) {
    // Has at least one on-topic term.
    return words <= 2 ? "partially_relevant" : "relevant";
  }

  // No on-topic term.
  if (words <= 2) return "unclear"; // too little to judge
  return "off_topic";
}
