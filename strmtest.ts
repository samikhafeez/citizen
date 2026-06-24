import { streamAnswer } from "./lib/assistant";
(async () => {
  const { stream, source } = await streamAnswer([{ role: "user", content: "What is this project about?" }]);
  const reader = stream.getReader(); const dec = new TextDecoder(); let acc = "";
  for (;;) { const { done, value } = await reader.read(); if (done) break; acc += dec.decode(value); }
  console.log("source:", source);
  console.log("text:", acc.slice(0, 140));
})();
