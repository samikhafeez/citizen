import { streamAnswer } from "./lib/assistant";
async function drain(s: ReadableStream<Uint8Array>){const r=s.getReader();let n=0;for(;;){const{done}=await r.read();if(done)break;n++;}return n;}
(async()=>{
 for(const q of ["ما هو هذا المشروع؟","لماذا المياه مالحة؟","هل تحتفظون باسمي أو رقم هاتفي؟","tell me a joke","who should I vote for"]){
   const {stream,source}=await streamAnswer([{role:"user",content:q}],"ar");
   const chunks=await drain(stream);
   console.log(`done=OK  src=${source}  chunks=${chunks}  "${q}"`);
 }
})();
