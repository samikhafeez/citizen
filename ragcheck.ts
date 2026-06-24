import { ragQuery } from "./lib/rag-lexical";
ragQuery("what challenges do people face with digital water tools", 5).then((r) => {
  console.log(r.summary);
  console.log("\nSOURCES:", r.sources.length, "/ totalFreeText:", r.totalFreeText);
});
