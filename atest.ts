import { ask } from "./lib/assistant";
(async () => {
  for (const q of ["What is this project about?", "كيف أبلغ عن تسرب مياه؟", "random hello"]) {
    const r = await ask([{ role: "user", content: q }]);
    console.log(`Q: ${q}\n  [${r.source}] ${r.answer.slice(0,90)}...\n`);
  }
})();
