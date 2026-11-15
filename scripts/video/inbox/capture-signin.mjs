#!/usr/bin/env node
// Captures the real email sign-in screens for the "Test an email sign-in" video.
//   node scripts/video/inbox/capture-signin.mjs <outdir>
// Starts the simulator with a small sign-in page, then drives it on an Android and an iOS session the way an agent does:
// inbox_read, type the address, tap Send code, inbox_wait, type the code, tap Verify. Framed screenshots and the tool
// results (log.json) land in <outdir>.
import { mkdirSync, copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const out = resolve(process.argv[2] || "/tmp/agent/signin-shots"); mkdirSync(out, { recursive: true });
const PORT = 4793, tmp = mkdtempSync(join(tmpdir(), "signin-cap-")), dist = join(tmp, "dist");
const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tide and Tackle</title>
<style>body{margin:0;font:18px system-ui,sans-serif;background:#0b1630;color:#f4efe4;padding:34px 22px}h1{font-size:30px;margin:0 0 6px}p{color:#9fb3d9;margin:0 0 24px}
input{display:block;width:100%;box-sizing:border-box;padding:14px;font-size:18px;border-radius:12px;border:2px solid #2b3a5c;background:#12203f;color:#f4efe4;margin:6px 0 18px}
button{width:100%;padding:15px;font-size:19px;font-weight:700;border:0;border-radius:12px;background:#ff9a2e;color:#0b1630;margin-bottom:14px}label{color:#7fb2ff;font-size:14px}</style></head>
<body><h1 id="h">Sign in</h1><p id="p">We email you a code.</p>
<label>Email</label><input id="email" aria-label="Email">
<button onclick="send()">Send code</button>
<label>Code</label><input id="code" aria-label="Code">
<button onclick="verify()">Verify</button>
<script>
window.sent = null;
async function send(){ const to=document.getElementById("email").value; const code="482913";
  const r=await fetch("https://inbox.shipvo.test/send",{method:"POST",body:JSON.stringify({to,from:"login@tideandtackle.test",subject:"Your sign-in code",text:"Your code is "+code+". It expires in 10 minutes."})});
  window.sent=code; document.getElementById("h").textContent=r.status===202?"Check your email":"Mail refused"; document.getElementById("p").textContent="We sent a code to "+to.split("@")[0].slice(0,6)+"...";}
function verify(){ const ok=document.getElementById("code").value===window.sent; document.getElementById("h").textContent=ok?"Welcome back":"Wrong code"; document.getElementById("p").textContent=ok?"You are signed in.":"Try again."; }
</script></body></html>`;
mkdirSync(dist); writeFileSync(join(dist, "index.html"), PAGE);
const proc = spawn(process.execPath, [join(root, "packages/sim/server.mjs"), "--port", String(PORT), "--dir", join(tmp, "state"), "--dist", dist, "--host", "127.0.0.1"], { stdio: "inherit", cwd: join(root, "packages/sim") });
const call = async (p, b) => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: "POST", body: JSON.stringify(b) })).json();
for (let i = 0; i < 300; i++) { try { await fetch(`http://127.0.0.1:${PORT}/`); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
const log = {};
try {
  for (const style of ["android", "ios"]) {
    const s = "signin-" + style;
    await call("/session", { session: s, fit_frame: true, skin: style });
    const act = (b) => call("/act", { session: s, ...b });
    const shot = async (n) => { const r = await act({ action: "screenshot", frame: true }); copyFileSync(r.path, join(out, `${style}-${n}.png`)); };
    const ref = async (name) => { const sc = (await act({ action: "screen" })).screen; const m = new RegExp(`${name}[^\\n]*\\[ref=(\\w+)\\]`).exec(sc); if (!m) throw new Error(`no ${name}\n${sc}`); return m[1]; };
    const until = async (re) => { for (let i = 0; i < 40; i++) { const sc = (await act({ action: "screen" })).screen; if (re.test(sc)) return sc; await new Promise((r) => setTimeout(r, 100)); } throw new Error("never saw " + re); };
    await shot("01-form");
    const read = await act({ action: "inbox_read" }); log[style] = { inbox_read: read };
    await act({ action: "type", ref: await ref('"Email"'), text: read.address }); await shot("02-address");
    await act({ action: "tap", ref: await ref("Send code") }); await until(/Check your email/); await shot("03-sent");
    const w = await act({ action: "inbox_wait", subject: "sign-in", timeout_ms: 5000 }); log[style].inbox_wait = w;
    await act({ action: "type", ref: await ref('"Code"'), text: w.message.codes[0] }); await shot("04-code");
    await act({ action: "tap", ref: await ref("Verify") }); await until(/Welcome back/); await shot("05-signedin");
    log[style].timeout = await act({ action: "inbox_wait", subject: "no such mail", timeout_ms: 300 });
  }
} finally { proc.kill("SIGKILL"); }
writeFileSync(join(out, "log.json"), JSON.stringify(log, null, 1));
console.log("wrote", out);
process.exit(0);
