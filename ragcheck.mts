import { ragQuery } from "./lib/rag-lexical";
const r = await ragQuery("what challenges do people face with digital water tools", 5);
console.log(r.summary);
console.log("\nSOURCES:", r.sources.length, "/ totalFreeText:", r.totalFreeText);
