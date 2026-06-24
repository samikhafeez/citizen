import { decide } from "./lib/assistant-guardrails";
const qs = [
 "Do I have to answer the gender question?","Is it only for refugees?","Is participation paid?",
 "How long is my data kept?","Is cloudy water safe to drink?","Why do I only get water some days?",
 "Are you a human?","Can you connect me to the water company?","Who should I vote for?","What's the weather?",
 "كم تُحفظ بياناتي؟","لماذا المياه مالحة؟",
];
for (const q of qs){ const d=decide(q); console.log((d.action+"/"+d.category).padEnd(36)+q + (d.entries?`  -> ${d.entries.map(e=>e.id).join(",")}`:"")); }
