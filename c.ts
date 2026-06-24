import { streamAnswer } from "./lib/assistant";
async function drain(s: ReadableStream<Uint8Array>){const r=s.getReader();const d=new TextDecoder();let a="";for(;;){const{done,value}=await r.read();if(done)break;a+=d.decode(value);}return a;}
(async()=>{for(const q of ["There is water shortage, what can I do to preserve water?","Why is my water dirty?","How can I report a leak?","Can this assistant fix my water problem?"]){const {stream}=await streamAnswer([{role:"user",content:q}],"en");const t=await drain(stream);console.log(`Q: ${q}\nA: ${t}\n  [chars=${t.length}]\n`);}})();
