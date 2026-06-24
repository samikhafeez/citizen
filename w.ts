import { streamAnswer } from "./lib/assistant";
async function drain(s: ReadableStream<Uint8Array>){const r=s.getReader();const d=new TextDecoder();let a="";for(;;){const{done,value}=await r.read();if(done)break;a+=d.decode(value);}return a;}
(async()=>{for(const q of ["Why is my water dirty?","What details should I give when describing a water problem?","How can I report a leak?"]){const {stream,category}=await streamAnswer([{role:"user",content:q}],"en");console.log(`[${category}] ${q}\n -> ${(await drain(stream)).split("\n")[0]}\n`);}})();
