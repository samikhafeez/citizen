import { scrub } from "./lib/scrub";
import { checkRelevance } from "./lib/relevance";
const raw = "The water app crashed, email me at ali.h@example.com or call +962 79 123 4567";
const cleaned = scrub(raw);
console.log("raw    :", raw);
console.log("stored :", cleaned);
console.log("relevance:", checkRelevance(cleaned));
console.log("idempotent:", scrub(cleaned) === cleaned);
