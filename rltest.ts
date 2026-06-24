import { rateLimit } from "./lib/rate-limit";
const key = "assistant:1.2.3.4";
for (let i = 1; i <= 5; i++) {
  const r = rateLimit(key, 3, 60000);
  console.log(`req ${i}: allowed=${r.allowed} remaining=${r.remaining}`);
}
// different IP unaffected
console.log("other IP:", rateLimit("assistant:9.9.9.9", 3, 60000).allowed);
