import { logAudit } from "./lib/audit";
(async () => { await logAudit("login","role=admin","tester@uni"); await logAudit("export","sessions=3","role:admin"); console.log("audit ok"); })();
