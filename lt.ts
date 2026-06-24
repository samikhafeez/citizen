import { streamAnswer } from "./lib/assistant";
async function read(s: ReadableStream<Uint8Array>) { const r=s.getReader(); const d=new TextDecoder(); let a=""; for(;;){const{done,value}=await r.read(); if(done)break; a+=d.decode(value);} return a; }
(async () => {
  for (const [q,lang] of [["why is my water salty","ar"],["why is my water salty","en"],["tell me a joke","ar"],["who should I vote for","ar"]] as const) {
    const { stream, source } = await streamAnswer([{role:"user",content:q}], lang as any);
    const txt = await read(stream);
    console.log(`[lang=${lang} src=${source}] "${q}"\n   -> ${txt.slice(0,90)}\n`);
  }
})();
