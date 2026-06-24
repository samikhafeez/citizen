import { streamAnswer } from "./lib/assistant";
async function drain(s: ReadableStream<Uint8Array>){const r=s.getReader();const d=new TextDecoder();let a="";for(;;){const{done,value}=await r.read();if(done)break;a+=d.decode(value);}return a;}
(async()=>{
 const qs = ["What is this project about?","Why does the survey ask for my age band?","Do you store my name or phone number?","Why is my tap water salty sometimes?","Tell me a joke.","Who should I vote for?"];
 for(const q of qs){
   const {stream,source,category}=await streamAnswer([{role:"user",content:q}],"en");
   const txt=await drain(stream);
   console.log(`src=${source} cat=${category}\n  Q: ${q}\n  A: ${txt.slice(0,80).replace(/\n/g," ")}\n`);
 }
})();
