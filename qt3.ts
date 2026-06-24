import { decide } from "./lib/assistant-guardrails";
const qs = [
 "لماذا المياه مالحة؟","كم تُحفظ بياناتي؟","هل التطبيق مجاني؟","ما هي المعلومات الشخصية؟",
 "Is cloudy water safe?","How are reported leaks handled?","Do apps need an account?","Why ask my age band?",
];
for (const q of qs){ const d=decide(q); console.log((d.action+"/"+d.category).padEnd(34)+q + (d.entries?`  -> ${d.entries.map(e=>e.id).join(",")}`:"")); }
