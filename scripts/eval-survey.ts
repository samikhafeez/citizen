/**
 * Resident-survey response-quality evaluation — local, deterministic.
 *
 *   npm run eval:survey
 *
 * Checks the response-handling helpers used at intake:
 *   - relevance classification (lib/relevance)
 *   - PII scrubbing before storage (lib/scrub)
 *   - low-quality detection (lib/quality)
 * No network, no participant data — pure functions only.
 */
import { checkRelevance } from "../lib/relevance";
import { scrub } from "../lib/scrub";
import { assessQuality } from "../lib/quality";

interface Case {
  name: string;
  text: string;
  relevance?: string; // expected checkRelevance label
  scrubContains?: string[]; // placeholders expected in scrubbed output
  scrubAbsent?: string[]; // raw fragments that must NOT survive scrubbing
  quality?: string; // expected qualityFlag
}

const CASES: Case[] = [
  { name: "relevant water (EN)", text: "The tap water is often cut and the app does not work well", relevance: "relevant" },
  { name: "off-topic (EN)", text: "I really enjoy football and watching movies at night", relevance: "off_topic" },
  { name: "phone number", text: "Please call me on 0791234567 about the water", scrubContains: ["[phone]"], scrubAbsent: ["0791234567"] },
  { name: "email", text: "email me at ali.hassan@example.com about my bill", scrubContains: ["[email]"], scrubAbsent: ["ali.hassan@example.com"] },
  { name: "address-like", text: "I live at building 12 and my water is cut", scrubContains: ["[address]"], scrubAbsent: ["building 12"] },
  { name: "id-like number", text: "my id is 9876543210 and the supply stopped", scrubAbsent: ["9876543210"] },
  { name: "very short", text: "good", quality: "too_short" },
  { name: "repeated/spam", text: "spam spam spam spam spam spam", quality: "repetitive" },
  { name: "repeated chars", text: "aaaaaaaaa", quality: "repetitive" },
  { name: "emoji only", text: "👍👍👍", quality: "emoji_only" },
  { name: "relevant (AR)", text: "المياه تنقطع كثيرًا والتطبيق لا يعمل", relevance: "relevant" },
  { name: "off-topic (AR)", text: "أحب كرة القدم ومشاهدة الأفلام في المساء", relevance: "off_topic" },
];

interface Result { name: string; pass: boolean; reason: string }

function run(): Result[] {
  return CASES.map((c) => {
    const scrubbed = scrub(c.text);
    const reasons: string[] = [];

    if (c.relevance) {
      const got = checkRelevance(c.text);
      if (got !== c.relevance) reasons.push(`relevance: expected ${c.relevance}, got ${got}`);
    }
    if (c.quality) {
      const got = assessQuality(c.text).qualityFlag;
      if (got !== c.quality) reasons.push(`quality: expected ${c.quality}, got ${got}`);
    }
    for (const frag of c.scrubContains ?? []) {
      if (!scrubbed.includes(frag)) reasons.push(`scrub missing ${frag} (got: ${scrubbed})`);
    }
    for (const frag of c.scrubAbsent ?? []) {
      if (scrubbed.includes(frag)) reasons.push(`scrub left raw "${frag}" (got: ${scrubbed})`);
    }
    return { name: c.name, pass: reasons.length === 0, reason: reasons.join("; ") };
  });
}

const results = run();
const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;

console.log("\n=== resident survey response-quality evaluation ===\n");
for (const r of results) {
  console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}${r.pass ? "" : `  — ${r.reason}`}`);
}
console.log(`\nTotal: ${results.length}   Passed: ${passed}   Failed: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
