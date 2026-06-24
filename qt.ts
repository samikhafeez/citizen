import { decide } from "./lib/assistant-guardrails";
const qs = [
 "Is participation paid?","Are you a human?","Is the app free to use?","How long is my data kept?",
 "Can I withdraw after submitting?","Do I have to answer the gender question?","Is it only for refugees?",
 "Why do I only get water some days?","Is cloudy water safe to drink?","How long do water cuts last?",
 "Can you connect me to the water company?","Can someone help me use the app?","هل المشاركة مدفوعة؟","كم تُحفظ بياناتي؟",
];
for (const q of qs){ const d=decide(q); console.log((d.action+"/"+d.category).padEnd(36)+q + (d.entries?`  -> ${d.entries.map(e=>e.id).join(",")}`:"")); }
