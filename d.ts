import { streamAnswer } from "./lib/assistant";
async function drain(s: ReadableStream<Uint8Array>){const r=s.getReader();const d=new TextDecoder();let a="";for(;;){const{done,value}=await r.read();if(done)break;a+=d.decode(value);}return a;}
(async()=>{for(const q of ["Why is my water dirty?","How is water supplied to homes?"]){const {stream,category}=await streamAnswer([{role:"user",content:q}],"en");console.log(`[${category}] ${q}\n -> `+(await drain(stream)).replace(/\n/g," ").slice(0,140)+"\n");}})();
