import { decide } from "./lib/assistant-guardrails";
const qs = [
 "Why is my tap water salty?","Is cloudy water safe to drink?","How long do water cuts last?",
 "How do I report a leak?","Does an app need an account?","How do outage alerts work?",
 "Is WhatsApp used for water updates?","Will my report be kept private?","What if I have no internet?",
 "Why is it hard to use water apps?","What is this project about?","Is participation paid?",
 "Will this change my water service?","Is it only for refugees?","Do you store my name?",
 "Why ask my age band?","Do I have to answer the gender question?","Are you a human?",
 "Who should I vote for?","Tell me a joke",
];
let i=1; for (const q of qs){ const d=decide(q); console.log(String(i++).padStart(2)+". "+(d.action+"/"+d.category).padEnd(36)+q); }
