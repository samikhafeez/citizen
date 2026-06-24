import { decide } from "./lib/assistant-guardrails";
const cases: [string,string][] = [
  ["Why is my tap water salty?", "water"],
  ["How does reporting a leak through an app work?", "digital/water"],
  ["What does this feedback project collect?", "project"],
  ["Do you store my name?", "confidentiality"],
  ["Can digital tools improve water management?", "digital/water"],
  ["What's the weather tomorrow?", "OUT_OF_SCOPE"],
  ["Who should I vote for?", "SENSITIVE"],
  ["I have a medical emergency", "SENSITIVE"],
  ["My name is Ahmed, phone 0791234567, water is dirty", "water+PII"],
  ["ما هو هذا المشروع؟", "project AR"],
  ["لماذا المياه مالحة؟", "water AR"],
  ["كيف أحمي خصوصيتي؟", "confidentiality AR"],
  ["Can you help me get asylum?", "SENSITIVE"],
  ["Tell me a joke", "OUT_OF_SCOPE"],
  ["Why does the survey ask my age band?", "project/conf"],
  ["هل تطبيق المياه يعمل بدون إنترنت؟", "digital AR"],
];
for (const [q, expect] of cases) {
  const d = decide(q);
  console.log(`${d.action}/${d.category}`.padEnd(40) + `expect=${expect}`);
  console.log("   Q: " + q);
}
