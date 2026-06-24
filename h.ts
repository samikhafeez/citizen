import { streamAnswer } from "./lib/assistant";
async function drain(s: ReadableStream<Uint8Array>){const r=s.getReader();const d=new TextDecoder();let a="";for(;;){const{done,value}=await r.read();if(done)break;a+=d.decode(value);}return a;}
(async()=>{
 const qs = [
  "There is water shortage in Jordan, what can I do to preserve water?",
  "Why is my water dirty?",
  "How can I report a leak?",
  "Is my water safe to drink?",
  "I need a lawyer for my eviction",
  "Who should I vote for?",
 ];
 for(const q of qs){ const {stream,source,category}=await streamAnswer([{role:"user",content:q}],"en"); const t=await drain(stream); console.log(`[${source}/${category}] ${q}\n  -> ${t.replace(/\n/g," ").slice(0,150)}\n`);}
})();
