// Handcrafted scenes: plain HTML/CSS/SVG in the Shipvo brand. Each takes the brand symbol markup and returns HTML.
// Animation timing is in seconds from the start of the scene (--d). Audio starts 0.3 s into each scene.
const chip = (t) => `<div class="chip fade">${t}</div>`;
const plane = (w, color = "#FF9A2E") => `<div style="width:${w}px">{{SYMBOL:${color}}}</div>`;

const phone = (x, y, inner, extra = "") => `<div class="phone ${extra}" style="left:${x}px;top:${y}px">${inner}</div>`;

export const SCENES = {
  hook: () => `
${chip("The problem")}
<h1 class="abs in" style="left:72px;top:150px;width:560px;--d:.5s">A bug is live.<br><span class="or">Fix it in minutes.</span></h1>
<div class="abs in mute" style="left:72px;top:540px;width:520px;font-size:30px;line-height:1.35;--d:2.6s">No waiting days for the store.</div>
${phone(860, 70, `
  <div class="scr" style="animation:fade .01s ease 4.6s reverse both;">
    <div class="mute mono" style="font-size:16px">My Shop</div>
    <div style="font-weight:800;font-size:30px;margin:14px 0">Pay 4 200</div>
    <div class="badge in" style="background:#4a1c24;color:var(--red);--d:1.2s">Error: button does nothing</div>
    <div class="btn" style="margin-top:28px;opacity:.5">Pay now</div>
  </div>
  <div class="scr" style="background:#05080f;animation:fade .5s ease 5.3s both">
    <div class="mute mono" style="font-size:16px">My Shop</div>
    <div style="font-weight:800;font-size:30px;margin:14px 0">Pay 4 200</div>
    <div class="badge pop" style="background:#12382b;color:var(--green);--d:5.6s">Fixed</div>
    <div class="btn" style="margin-top:28px">Pay now</div>
  </div>`)}
<div class="abs flight" style="left:560px;top:260px;width:150px;--fx:-380px;--fy:120px;--tx:260px;--ty:-40px;--d:3.2s">${plane(150)}</div>`,

  idea: () => `
${chip("What is OTA?")}
<h1 class="abs in" style="left:72px;top:130px;--d:.4s">OTA = <span class="or">over the air</span></h1>
<div class="abs card in" style="left:72px;top:330px;width:260px;height:190px;--d:1.6s;padding:26px">
  <div class="mono sky" style="font-size:18px">YOU</div><div style="font-weight:800;font-size:36px;margin-top:8px">New version</div></div>
<svg class="abs fade" style="left:330px;top:390px;--d:2.4s" width="480" height="70"><path d="M0 35 H480" stroke="#3a4d78" stroke-width="4" stroke-dasharray="4 14" stroke-linecap="round"/></svg>
<div class="abs flight" style="left:420px;top:320px;width:110px;--fx:-100px;--fy:0px;--tx:230px;--ty:0px;--d:3.2s">${plane(110)}</div>
<div class="abs card in" style="left:810px;top:290px;width:200px;height:270px;--d:1.9s;border-radius:30px;padding:24px">
  <div class="mono sky" style="font-size:18px">PHONE</div><div style="font-weight:800;font-size:30px;margin-top:10px">Gets it by itself</div></div>
<div class="abs pop" style="left:1010px;top:270px;--d:5.6s"><span class="badge" style="background:#12382b;color:var(--green)">Updated</span></div>
<div class="abs in mute" style="left:72px;top:580px;font-size:28px;--d:6.2s">Like opening a web page.</div>`,

  edit: () => `
${chip("Step 1")}
<h2 class="abs in" style="left:72px;top:120px;--d:.4s">Edit your app</h2>
<div class="abs card in mono" style="left:72px;top:250px;width:860px;--d:1.2s;overflow:hidden">
  <div style="padding:14px 26px;background:#141d33;color:var(--sky);font-size:24px">src/release.ts</div>
  <div style="padding:28px 26px;font-size:30px;line-height:1.7">
    <div class="mute">// an example change</div>
    <div class="fade" style="--d:2.4s;background:#3a1620;margin:0 -26px;padding:0 26px"><span style="color:var(--red)">-</span> export const greeting = "Welcome";</div>
    <div class="fade" style="--d:3.6s;background:#10301f;margin:0 -26px;padding:0 26px"><span style="color:var(--green)">+</span> export const greeting = "Welcome back";</div>
  </div></div>
<div class="abs in mute" style="left:72px;top:560px;font-size:26px;--d:4.6s">That is the whole change. Save the file.</div>`,

  publish: () => `
${chip("Step 2")}
<h2 class="abs in" style="left:72px;top:120px;--d:.4s">Run one command</h2>
<div class="abs term mono in" style="left:72px;top:270px;width:900px;--d:1s">
  <div class="dots"><i></i><i></i><i></i></div>
  <span class="or">$</span> <span class="type" style="--n:22;--tt:1.6s;--d:2s">npx shipvo publish</span><span class="cur"></span>
</div>
<div class="abs in mute" style="left:72px;top:520px;font-size:28px;--d:4.2s">You do not need to touch anything else.</div>`,

  build: () => {
    const item = (n, title, sub, d, y) => `<div class="abs card in" style="left:72px;top:${y}px;width:640px;height:150px;padding:26px 30px;--d:${d}s">
      <div class="abs" style="right:30px;top:26px;font-weight:800;font-size:60px;color:#22304d">${n}</div>
      <div style="font-weight:800;font-size:36px">${title}</div><div class="mute" style="font-size:26px;margin-top:8px;width:480px">${sub}</div></div>`;
    return `${chip("What it does")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">Shipvo does the work</h2>
${item(1, "Build and fingerprint", "A hash proves the file is unchanged.", 1.2, 220)}
${item(2, "Make small patches", "Phones download only what changed.", 3.8, 400)}
<div class="abs card fade" style="left:790px;top:220px;width:400px;height:330px;--d:3.6s;padding:28px">
  <div class="mono sky" style="font-size:18px">DOWNLOAD</div>
  <div style="margin-top:34px" class="mono mute">Whole app</div>
  <div style="height:34px;border-radius:8px;background:#3a4d78;margin:8px 0 28px;width:100%"></div>
  <div class="mono or">Patch</div>
  <div class="fade" style="height:34px;border-radius:8px;background:var(--or);margin:8px 0;width:70px;--d:5s"></div>
</div>`;
  },

  sign: () => `
${chip("Trust")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">Signed with <span class="or">your</span> key</h2>
<div class="abs card in" style="left:72px;top:240px;width:330px;height:300px;padding:28px;--d:1.4s">
  <div class="mono sky" style="font-size:18px">YOUR MACHINE</div>
  <svg width="90" height="90" viewBox="0 0 90 90" style="margin:22px 0 10px"><circle cx="28" cy="45" r="16" fill="none" stroke="#FF9A2E" stroke-width="8"/><path d="M44 45 H84 M70 45 v14 M58 45 v10" stroke="#FF9A2E" stroke-width="8" stroke-linecap="round"/></svg>
  <div style="font-weight:800;font-size:30px">Private key</div><div class="mute" style="font-size:22px">Never leaves here</div></div>
<svg class="abs fade" style="left:410px;top:365px;--d:3.4s" width="260" height="50"><path d="M0 25 H250" stroke="#3a4d78" stroke-width="4" stroke-dasharray="4 14" stroke-linecap="round"/></svg>
<div class="abs flight" style="left:440px;top:330px;width:90px;--fx:-20px;--fy:0px;--tx:90px;--ty:0px;--d:3.6s">${plane(90)}</div>
<div class="abs card in" style="left:680px;top:240px;width:320px;height:300px;padding:28px;--d:2.4s;border-radius:34px">
  <div class="mono sky" style="font-size:18px">PHONE</div>
  <div style="font-weight:800;font-size:30px;margin-top:30px">Checks the signature first</div>
  <div class="badge pop" style="background:#12382b;color:var(--green);margin-top:26px;--d:6s">Signature OK</div></div>
<div class="abs card in" style="left:1030px;top:240px;width:190px;height:300px;padding:20px;--d:8s;border-color:#5a2230">
  <div class="mono" style="color:var(--red);font-size:16px">STOLEN TOKEN</div>
  <div style="font-size:60px;color:var(--red);margin:18px 0 6px;font-weight:800">&#x2715;</div>
  <div style="font-size:22px;font-weight:700">Cannot ship code without the key</div></div>`,

  rollout: () => {
    let dots = "";
    for (let i = 0; i < 100; i++) {
      const r = Math.floor(i / 10), c = i % 10;
      const [d, col] = i === 0 ? [2.2, "var(--or)"] : i < 10 ? [4.4, "var(--sky)"] : [6.2 + (i % 10) * 0.03, "var(--green)"];
      dots += `<i class="dot a" style="left:${72 + c * 46}px;top:${180 + r * 38}px;--d:${d}s;--c:${col}"></i>`;
    }
    const lab = (t, sub, col, d, y) => `<div class="abs in" style="left:640px;top:${y}px;--d:${d - .3}s"><span style="font-weight:800;font-size:64px;color:${col}">${t}</span><div class="mute" style="font-size:26px">${sub}</div></div>`;
    return `${chip("Staged rollout")}
<h2 class="abs in" style="left:72px;top:96px;--d:.3s">Three groups of users</h2>${dots}
${lab("1%", "Try it on a few people", "var(--or)", 2.2, 200)}${lab("10%", "Then a few more", "var(--sky)", 4.4, 340)}${lab("Everyone", "Then all of your users", "var(--green)", 6.2, 480)}`;
  },

  safety: () => `
${chip("Safety net")}
<h2 class="abs in" style="left:72px;top:96px;--d:.3s">If it breaks, it goes back</h2>
<div class="abs card in" style="left:72px;top:210px;width:540px;height:360px;padding:28px;--d:.9s">
  <div class="mono sky" style="font-size:18px">ON THE PHONE</div>
  ${[1, 2, 3].map((n, k) => `<div class="in" style="--d:${1.6 + k * 1.1}s;font-size:28px;margin-top:14px"><span class="badge" style="background:#4a1c24;color:var(--red);font-size:20px">Start ${n} failed</span></div>`).join("")}
  <div class="pop" style="--d:5.2s;margin-top:18px;font-weight:800;font-size:30px">Release discarded. <span class="or">Old one stays.</span></div></div>
<div class="abs term mono in" style="left:660px;top:230px;width:550px;height:330px;font-size:28px;--d:6.4s">
  <div class="dots"><i></i><i></i><i></i></div>
  <span class="or">$</span> <span class="type" style="--n:25;--tt:1.8s;--d:7.2s">shipvo rollback --to 7</span><span class="cur"></span>
  <div class="mute fade" style="font-size:24px;margin-top:22px;font-family:sans-serif;--d:9.4s">Release 7 goes out again, for everyone.</div></div>`,

  cta: () => `
<div class="abs pop" style="left:72px;top:140px;width:330px;--d:.3s">{{MARK}}</div>
<h1 class="abs in" style="left:470px;top:130px;--d:.8s">Ship your first<br><span class="or">update today.</span></h1>
<div class="abs card in mono" style="left:470px;top:370px;padding:22px 30px;font-size:30px;--d:2.4s"><span class="sky">shipvo.dev</span>/docs/getting-started</div>
<div class="abs in mute" style="left:470px;top:490px;font-size:28px;line-height:1.4;width:700px;--d:4s">First: back up <span class="mono or">.shipvo/seed.txt</span>.<br>Lose it, and phones will never accept another update.</div>`,
};

// --- first-app: real simulator screenshots ({{IMG:name}} is filled with a data URI by the renderer) ---
const shot = (name, x, y, w, over = null, d = 0) => `<div class="abs in" style="left:${x}px;top:${y}px;width:${w}px;--d:${d}s"><div style="position:relative;border:6px solid #2b3a5c;border-radius:36px;overflow:hidden;background:#05080f;line-height:0"><img src="{{IMG:${name}}}" style="width:100%;display:block">${over ? `<img class="fade" src="{{IMG:${over[0]}}}" style="position:absolute;left:0;top:0;width:100%;--d:${over[1]}s">` : ""}</div></div>`;
const tcmd = (cmds, x, y, w, d0, fs = 32) => `<div class="abs term mono in" style="left:${x}px;top:${y}px;width:${w}px;font-size:${fs}px;--d:${d0}s"><div class="dots"><i></i><i></i><i></i></div>${cmds.map((c, k) => `<div><span class="or">$</span> <span class="type" style="--n:${c.t.length};--tt:${c.tt || 1.4}s;--d:${c.d}s">${c.t}</span></div>${c.out ? `<div class="mute fade" style="font-size:${fs - 8}px;--d:${c.od}s">${c.out}</div>` : ""}`).join("")}</div>`;

Object.assign(SCENES, {
  faHook: () => `
${chip("Beginner tutorial")}
<h1 class="abs in" style="left:72px;top:130px;width:640px;--d:.5s">No phone needed.<br><span class="or">Your app, in a browser.</span></h1>
<div class="abs in mute" style="left:72px;top:430px;width:560px;font-size:28px;line-height:1.35;--d:2.2s">No Android Studio. No Xcode.</div>
${shot("01-first-screen", 900, 36, 230, null, 1)}
<div class="abs flight" style="left:640px;top:250px;width:130px;--fx:-200px;--fy:100px;--tx:60px;--ty:-30px;--d:3.4s">${plane(130)}</div>`,

  faCreate: () => `
${chip("Step 1")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">Make your app</h2>
${tcmd([{ t: 'npx -y @shipvo/cli init tideshop --name "Tide Shop"', tt: 2.2, d: 1.2, out: "Created Tide Shop in tideshop", od: 3.8 }], 72, 230, 1000, .8, 30)}
<div class="abs card in" style="left:72px;top:440px;width:760px;padding:22px 28px;--d:5s">
  <div class="mono sky" style="font-size:18px">SIGNING KEY</div>
  <div class="mono" style="font-size:28px;margin:8px 0">tideshop/.shipvo/seed.txt</div>
  <div class="mute" style="font-size:24px">Secret. Do not share it. Back it up.</div></div>`,

  faInstall: () => `
${chip("Step 2")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">Download the pieces</h2>
${tcmd([{ t: "cd tideshop", tt: .9, d: 1.2 }, { t: "npm install", tt: 1, d: 2.6 }, { t: "npx playwright install chromium", tt: 1.8, d: 4.2 }], 72, 230, 960, .8, 34)}
<div class="abs in mute" style="left:72px;top:540px;font-size:28px;--d:6.4s">The last one takes the longest. It is a small browser for the simulator.</div>`,

  faSim: () => `
${chip("Step 3")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">Open the simulator</h2>
${tcmd([{ t: "npm run sim", tt: 1, d: 1.2, out: "Simulator on http://localhost:4545", od: 2.8 }], 72, 230, 700, .8, 30)}
<div class="abs card in mono" style="left:72px;top:440px;padding:18px 26px;font-size:28px;--d:6s"><span class="mute">browser</span>&nbsp; <span class="sky">localhost:4545</span><span class="or">/app/</span></div>
<div class="abs in mute" style="left:72px;top:540px;font-size:24px;--d:7.4s">Do not forget the <span class="mono or">/app/</span> at the end.</div>
${shot("01-first-screen", 900, 36, 230, null, 7)}`,

  faTap: () => `
${chip("Try it")}
<h2 class="abs in" style="left:72px;top:100px;width:600px;--d:.3s">Tap a button</h2>
<div class="abs in mute" style="left:72px;top:260px;width:560px;font-size:30px;line-height:1.4;--d:1.2s">Click <span class="or">Send a notification</span>.</div>
<div class="abs card in" style="left:72px;top:400px;width:560px;padding:22px 28px;--d:3.4s"><div class="mono sky" style="font-size:18px">LOG</div><div style="font-size:30px;margin-top:6px">Notification sent</div></div>
<div class="abs in mute" style="left:72px;top:540px;width:560px;font-size:24px;--d:5s">Pretend only. The simulator labels it.</div>
${shot("01-first-screen", 800, 36, 230, ["02-after-tap", 3], .6)}`,

  faEdit: () => `
${chip("Step 4")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">Change the words</h2>
<div class="abs card in mono" style="left:72px;top:230px;width:700px;overflow:hidden;--d:1s">
  <div style="padding:12px 24px;background:#141d33;color:var(--sky);font-size:22px">src/release.ts</div>
  <div style="padding:22px 24px;font-size:24px;line-height:1.6">
    <div class="fade" style="--d:1.8s;background:#3a1620;margin:0 -24px;padding:0 24px"><span style="color:var(--red)">-</span> headline: "Hello from Tide Shop."</div>
    <div class="fade" style="--d:3.2s;background:#10301f;margin:0 -24px;padding:0 24px"><span style="color:var(--green)">+</span> headline: "Fresh fish, delivered today."</div></div></div>
<div class="abs in mono mute" style="left:72px;top:470px;font-size:26px;--d:5.2s">rebuilt in 7 s</div>
<div class="abs in mute" style="left:72px;top:540px;font-size:26px;--d:6.4s">Then reload the page.</div>
${shot("01-first-screen", 880, 36, 230, ["03-after-edit", 7.2], .6)}`,

  faDry: () => `
${chip("Step 5")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">Check a release</h2>
${tcmd([{ t: "npx shipvo publish --dry-run --skip-web true", tt: 2.4, d: 1.2, out: "Dry run complete. Nothing was sent.", od: 4.2 }], 72, 230, 1100, .8, 30)}
<div class="abs card in" style="left:72px;top:440px;width:520px;padding:20px 28px;--d:5.6s"><div class="mono sky" style="font-size:18px">BUILT AND SIGNED</div><div style="font-size:28px;margin-top:6px">A release, ready to check</div></div>
<div class="abs card in" style="left:640px;top:440px;width:520px;padding:20px 28px;--d:7s"><div class="mono sky" style="font-size:18px">SENT</div><div style="font-size:28px;margin-top:6px;color:var(--green)">Nothing. Safe to try.</div></div>`,

  faCta: () => `
<div class="abs pop" style="left:72px;top:140px;width:330px;--d:.3s">{{MARK}}</div>
<h1 class="abs in" style="left:470px;top:130px;--d:.8s">You made<br><span class="or">your first app.</span></h1>
<div class="abs card in mono" style="left:470px;top:370px;padding:22px 30px;font-size:28px;--d:2.4s"><span class="sky">shipvo.dev</span>/docs/first-app</div>
<div class="abs in mute" style="left:470px;top:490px;font-size:28px;line-height:1.4;width:700px;--d:4s">Next: put it on a real Android phone and send it updates.</div>`,
});

// --- test-with-an-assistant: real simulator screenshots from the tutorial ---
const chat = (who, text, x, y, w, d, col = "var(--sky)") => `<div class="abs card in" style="left:${x}px;top:${y}px;width:${w}px;padding:18px 24px;--d:${d}s"><div class="mono" style="font-size:16px;color:${col}">${who}</div><div style="font-size:26px;line-height:1.35;margin-top:6px">${text}</div></div>`;
const logLine = (t, d, y, hot = false) => `<div class="fade" style="--d:${d}s;${hot ? "background:#3a2a10;margin:0 -26px;padding:0 26px;" : ""}">${t}</div>`;

Object.assign(SCENES, {
  taHook: () => `
${chip("Beginner tutorial")}
<h1 class="abs in" style="left:72px;top:130px;width:700px;--d:.5s">Who tests your app<br><span class="or">before you ship?</span></h1>
<div class="abs in mute" style="left:72px;top:440px;width:560px;font-size:30px;line-height:1.35;--d:2.4s">Ask an assistant. No phone needed.</div>
${chat("YOU", "Shop like a customer in my app.", 700, 380, 480, 3.4, "var(--or)")}
${chat("ASSISTANT", "Opening the shop. I see five products.", 700, 520, 480, 5.4)}
<div class="abs flight" style="left:820px;top:120px;width:130px;--fx:-100px;--fy:120px;--tx:120px;--ty:-20px;--d:3s">${plane(130)}</div>`,

  taConnect: () => `
${chip("Step 1")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">Connect your assistant</h2>
${tcmd([{ t: "npm run sim", tt: 1, d: 1.2, out: "Simulator on http://localhost:4545/app/", od: 2.6 }], 72, 200, 720, .8, 28)}
<div class="abs card in mono" style="left:72px;top:400px;width:1100px;padding:20px 28px;font-size:20px;line-height:1.6;white-space:nowrap;--d:4.6s">
  <div class="sky" style="font-size:18px">ONE SETTING</div>
  <div>{ "mcpServers": { "shipvo": { "command": "npx", "args": ["-y", "@shipvo/mcp"] } } }</div></div>
<div class="abs pop" style="left:840px;top:220px;--d:7s"><span class="badge" style="background:#12382b;color:var(--green)">MCP: tools for assistants</span></div>
<div class="abs in mute" style="left:840px;top:290px;width:340px;font-size:24px;line-height:1.35;--d:8.2s">Claude Desktop, Claude Code or Cursor.</div>`,

  taShop: () => `
${chip("Step 2")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">Shop like a customer</h2>
${chat("YOU", "Buy the Canvas tote. Make the payment fail, then make it work.", 72, 220, 640, 1.2, "var(--or)")}
<div class="abs card in" style="left:72px;top:400px;width:640px;padding:20px 26px;--d:3.4s">
  <div class="mono sky" style="font-size:16px">ASSISTANT TAPS</div>
  ${["Canvas tote", "Add to cart", "Cart", "Pay (declined)", "Pay (approved)"].map((t, k) => `<span class="badge fade" style="--d:${3.8 + k * .8}s;background:#1a2540;color:var(--paper);font-size:20px;margin:10px 8px 0 0">${t}</span>`).join("")}</div>
<div class="abs in mute" style="left:72px;top:560px;width:640px;font-size:24px;--d:8.4s">Nothing here is a real payment.</div>
${shot("02-cart", 800, 30, 210, ["03-order-placed", 8.6], 1.4)}`,

  taProof: () => `
${chip("Step 3")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">Ask for proof</h2>
<div class="abs term mono in" style="left:72px;top:190px;width:1000px;font-size:26px;line-height:1.4;--d:.9s">
  <div class="dots"><i></i><i></i><i></i></div>
  ${logLine('<span class="sky">device_log</span> <span class="mute">simulated: true</span>', 1.6, 0)}
  ${logLine('payment.request &nbsp;"amount": 18, "currency": "USD"', 2.6, 0)}
  ${logLine('payment.result &nbsp;"reason": "declined"', 3.6, 0)}
  ${logLine('payment.request &nbsp;<span class="or">"to": "My Shop"</span>', 4.8, 0, true)}
</div>
<div class="abs card in" style="left:72px;top:470px;width:1000px;padding:16px 28px;--d:7s;border-color:#6b4a1c">
  <div style="font-size:30px;font-weight:700">This shop is called <span class="or">Sandbar Shop</span>. The code says <span class="or">My Shop</span>.</div>
  <div class="mute" style="font-size:22px;margin-top:6px">A real mistake, caught by the log.</div></div>`,

  taTest: () => `
${chip("Step 4")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">Turn its run into a test</h2>
<div class="abs card in mono" style="left:72px;top:220px;width:820px;overflow:hidden;--d:1s">
  <div style="padding:12px 24px;background:#141d33;color:var(--sky);font-size:22px">tests/checkout.test.ts</div>
  <div style="padding:20px 24px;font-size:24px;line-height:1.65">
    <div>await phone.tap("Canvas tote");</div>
    <div>await phone.tap("Cart");</div>
    <div class="fade" style="--d:3s;background:#3a1620;margin:0 -24px;padding:0 24px"><span style="color:var(--red)">-</span> await phone.waitFor(/\\S/);</div>
    <div class="fade" style="--d:4.4s;background:#10301f;margin:0 -24px;padding:0 24px"><span style="color:var(--green)">+</span> await phone.waitFor("Total: $18.00");</div>
    <div>await phone.tap("Pay");</div></div></div>
<div class="abs in" style="left:72px;top:530px;font-size:28px;--d:2s"><span class="mono or">export_test</span> <span class="mute">gives you the file.</span></div>
<div class="abs pop" style="left:930px;top:300px;--d:6.6s"><span class="badge" style="background:#12382b;color:var(--green);font-size:26px">Tests 5 passed</span></div>`,

  taHabit: () => `
${chip("Step 5")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">Make it a habit</h2>
${tcmd([{ t: "npm test && npx shipvo publish --dry-run --skip-web true", tt: 2.6, d: 1.2, out: "Dry run complete. Nothing was sent.", od: 4.6 }], 72, 230, 1130, .8, 28)}
<div class="abs card in" style="left:72px;top:450px;width:520px;padding:20px 28px;--d:5.6s"><div class="mono sky" style="font-size:18px">TEST PASSES</div><div style="font-size:28px;margin-top:6px;color:var(--green)">Practice release runs</div></div>
<div class="abs card in" style="left:640px;top:450px;width:520px;padding:20px 28px;--d:7s;border-color:#5a2230"><div class="mono" style="color:var(--red);font-size:18px">TEST FAILS</div><div style="font-size:28px;margin-top:6px">The line stops. Nothing ships.</div></div>`,

  taCta: () => `
<div class="abs pop" style="left:72px;top:140px;width:330px;--d:.3s">{{MARK}}</div>
<h1 class="abs in" style="left:470px;top:130px;--d:.8s">Let an assistant<br><span class="or">try it first.</span></h1>
<div class="abs card in mono" style="left:470px;top:370px;padding:22px 30px;font-size:28px;--d:2.4s"><span class="sky">shipvo.dev</span>/docs/test-with-an-assistant</div>
<div class="abs in mute" style="left:470px;top:490px;font-size:28px;line-height:1.4;width:700px;--d:4s">Tested on a simulator. Run it before every release.</div>`,
});

// --- get-your-12-testers ---
const dayCell = (k, d) => `<div class="fade" style="--d:${d + k * .22}s;width:62px;height:62px;border-radius:12px;background:#12382b;color:var(--green);font:700 22px/62px 'JetBrains Mono','DejaVu Sans Mono',monospace;text-align:center">${k + 1}</div>`;
const person = (k, d) => `<div class="pop" style="--d:${d + k * .15}s;width:54px;height:54px;border-radius:50%;background:#1a2540;border:2px solid #22304d;position:relative"><div style="position:absolute;left:18px;top:10px;width:18px;height:18px;border-radius:50%;background:var(--sky)"></div><div style="position:absolute;left:11px;top:31px;width:32px;height:16px;border-radius:16px 16px 4px 4px;background:var(--sky)"></div></div>`;

Object.assign(SCENES, {
  gtHook: () => `
${chip("Google Play")}
<h1 class="abs in" style="left:72px;top:130px;width:700px;--d:.5s">12 testers.<br><span class="or">14 days in a row.</span></h1>
<div class="abs in mute" style="left:72px;top:440px;width:560px;font-size:30px;line-height:1.35;--d:2.4s">The rule for new personal accounts.</div>
<div class="abs" style="left:760px;top:250px;width:440px;display:flex;flex-wrap:wrap;gap:14px">${Array.from({ length: 12 }, (_, k) => person(k, 1.6)).join("")}</div>
<div class="abs flight" style="left:820px;top:110px;width:130px;--fx:-100px;--fy:120px;--tx:120px;--ty:-20px;--d:3.4s">${plane(130)}</div>`,

  gtRule: () => `
${chip("The rule")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">Opted in. Every day.</h2>
<div class="abs" style="left:72px;top:210px;width:1100px;display:flex;flex-wrap:wrap;gap:12px">${Array.from({ length: 14 }, (_, k) => dayCell(k, 1.2)).join("")}</div>
<div class="abs in mute" style="left:72px;top:300px;font-size:24px;--d:4.6s">12 or more testers, 14 days in a row</div>
<div class="abs card in" style="left:72px;top:400px;width:520px;padding:20px 28px;--d:6s;border-color:#5a2230"><div class="mono" style="color:var(--red);font-size:18px">DROPS BELOW 12</div><div style="font-size:28px;margin-top:6px">The clock starts again.</div></div>
<div class="abs card in" style="left:640px;top:400px;width:540px;padding:20px 28px;--d:9s"><div class="mono sky" style="font-size:18px">NO RULE FOR</div><div style="font-size:26px;margin-top:6px;line-height:1.35">Company accounts, and personal accounts made before 13 Nov 2023</div></div>`,

  gtJoin: () => `
${chip("Step 1")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">Join Shipvo Testers</h2>
<div class="abs card in" style="left:72px;top:220px;width:700px;padding:28px 32px;--d:1s">
  <div class="mono sky" style="font-size:18px">A GROUP OF FOUNDERS</div>
  <div style="font-size:30px;margin-top:8px;line-height:1.35">Everyone tests each other's apps.</div>
  <div class="mono" style="font-size:30px;margin-top:22px"><span class="sky">shipvo.dev</span>/testers</div></div>
<div class="abs pop" style="left:72px;top:500px;--d:4.6s"><span class="badge" style="background:#12382b;color:var(--green)">Anyone can join</span></div>
<div class="abs pop" style="left:340px;top:500px;--d:6.4s"><span class="badge" style="background:#1a2540;color:var(--paper)">Emails stay private</span></div>
<div class="abs" style="left:850px;top:240px;width:330px;display:flex;flex-wrap:wrap;gap:14px">${Array.from({ length: 12 }, (_, k) => person(k, 2.4)).join("")}</div>`,

  gtTrack: () => `
${chip("Step 2")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">Make a closed test</h2>
<div class="abs card in" style="left:72px;top:210px;width:1100px;padding:24px 32px;font-size:28px;line-height:1.9;--d:.9s">
  <div class="mono sky" style="font-size:18px">PLAY CONSOLE &gt; TESTING &gt; CLOSED TESTING</div>
  <div class="fade" style="--d:2s">1. Make a track.</div>
  <div class="fade" style="--d:4s">2. Upload your first build <span class="or">by hand</span>.</div>
  <div class="fade" style="--d:8s">3. Add the Google Group:</div>
  <div class="mono fade" style="--d:9.4s;font-size:26px;margin-left:34px;color:var(--sky)">shipvo-testers@googlegroups.com</div></div>
<div class="abs in mute" style="left:72px;top:540px;font-size:24px;--d:5.4s">Play does not allow the upload through the API.</div>`,

  gtCli: () => `
${chip("Or let Shipvo do it")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">One command</h2>
${tcmd([{ t: "shipvo store testers --package com.example.shop", tt: 2.4, d: 1.2, out: "Steps for your app: closed test, group, opt-in link", od: 4 }, { t: "shipvo store testers --play-key play-key.json", tt: 2.4, d: 5.4, out: "Added the Shipvo Testers group. Nothing removed.", od: 8.2 }], 72, 210, 1130, .8, 28)}
<div class="abs in mute" style="left:72px;top:480px;width:1000px;font-size:26px;line-height:1.4;--d:9.2s">Without a key, no network call is made. The key is read once and not stored.</div>`,

  gtLink: () => `
${chip("Step 3")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">Share your opt-in link</h2>
<div class="abs card in mono" style="left:72px;top:230px;width:1100px;padding:24px 30px;font-size:30px;--d:1s"><span class="sky">play.google.com</span>/apps/testing/<span class="or">your.package.name</span></div>
${["Open the link", "Opt in", "Install the app"].map((t, k) => `<div class="abs card pop" style="left:${72 + k * 370}px;top:400px;width:330px;padding:22px 26px;--d:${3 + k * 1.6}s"><div class="mono or" style="font-size:20px">${k + 1}</div><div style="font-size:30px;margin-top:6px;font-weight:700">${t}</div></div>`).join("")}`,

  gtGive: () => `
${chip("Step 4")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">Test other apps</h2>
<div class="abs in" style="left:72px;top:220px;width:620px;font-size:34px;line-height:1.4;--d:1s">The community works<br>because <span class="or">everyone tests</span>.</div>
${["Open an app another founder shared", "Opt in", "Keep it installed for 14 days"].map((t, k) => `<div class="abs card in" style="left:740px;top:${200 + k * 110}px;width:440px;padding:20px 26px;font-size:26px;--d:${3 + k * 1.6}s">${t}</div>`).join("")}`,

  gtCta: () => `
<div class="abs pop" style="left:72px;top:140px;width:330px;--d:.3s">{{MARK}}</div>
<h1 class="abs in" style="left:470px;top:130px;--d:.8s">Get your 12<br><span class="or">testers.</span></h1>
<div class="abs card in mono" style="left:470px;top:370px;padding:22px 30px;font-size:28px;--d:2.4s"><span class="sky">shipvo.dev</span>/testers</div>
<div class="abs in mute" style="left:470px;top:490px;font-size:28px;line-height:1.4;width:700px;--d:4s">We cannot promise how many people will opt in.</div>`,
});

// --- run-your-app-on-a-phone ---
const bigPhone = (x, y, ios, inner, scale = 1) => `<div class="abs pop" style="left:${x}px;top:${y}px;width:${ios ? 262 : 275}px;height:${ios ? 568 : 610}px;--d:.6s;transform-origin:top left;scale:${scale}"><div style="position:absolute;inset:0;border-radius:${ios ? 48 : 36}px;background:#05080f;border:7px solid #2b3a5c;overflow:hidden">
  ${ios ? `<div style="position:absolute;left:50%;top:10px;width:84px;height:24px;margin-left:-42px;border-radius:14px;background:#000"></div><div style="position:absolute;left:50%;bottom:8px;width:90px;height:5px;margin-left:-45px;border-radius:3px;background:#B6BDCB"></div>` : `<div style="position:absolute;left:50%;top:12px;width:14px;height:14px;margin-left:-7px;border-radius:50%;background:#000"></div><div style="position:absolute;left:50%;bottom:8px;width:90px;height:5px;margin-left:-45px;border-radius:3px;background:#B6BDCB"></div>`}
  <div style="position:absolute;inset:0;padding:52px 20px 24px">${inner}</div></div></div>`;
const shopScr = (d0, tapAt) => `<div class="mute mono" style="font-size:18px">Tide and Tackle</div>
  <div style="font-weight:800;font-size:30px;margin:10px 0 14px">Fishing line</div>
  <div class="card" style="padding:12px 12px;font-size:22px;margin-bottom:10px">Net, large <span class="or" style="float:right">4 200</span></div>
  <div class="card" style="padding:12px 12px;font-size:22px;margin-bottom:18px">Hook set <span class="or" style="float:right">1 500</span></div>
  <div class="btn" style="font-size:24px">Add to cart</div>
  <div class="badge pop" style="--d:${tapAt}s;margin-top:18px;background:#12382b;color:var(--green);font-size:22px">1 in cart</div>`;
const simLabel = (d) => `<div class="abs pop" style="--d:${d}s"><span class="badge" style="background:#3a2a10;color:var(--or);font-size:24px">Simulated</span></div>`;

Object.assign(SCENES, {
  rpHook: () => `
${chip("Shipvo Phone")}
<h1 class="abs in" style="left:72px;top:130px;width:700px;--d:.5s">A phone in<br><span class="or">your browser.</span></h1>
<div class="abs in mute" style="left:72px;top:400px;width:620px;font-size:30px;line-height:1.35;--d:2.4s">No Android Studio. No Xcode. No phone.</div>
${bigPhone(880, 36, false, shopScr(0, 5.6), .9)}
<div class="abs flight" style="left:640px;top:110px;width:130px;--fx:-100px;--fy:120px;--tx:120px;--ty:-20px;--d:3.4s">${plane(130)}</div>`,

  rpCmd: () => `
${chip("Step 1")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">One command</h2>
${tcmd([{ t: "npx shipvo run android", tt: 1.8, d: 1.4, out: "Building a web copy of your app...<br>Ready. Opening your browser.", od: 3.8 } ], 72, 230, 1100, .8, 38)}
<div class="abs in mute" style="left:72px;top:510px;font-size:28px;--d:8s">No account. No phone.</div>`,

  rpPhone: () => `
${chip("Step 2")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">Click it like a tap</h2>
<div class="abs in" style="left:72px;top:230px;width:560px;font-size:32px;line-height:1.45;--d:1s">A page with a phone in the middle.<br><span class="mute">The label says it is a copy.</span></div>
<div class="abs" style="left:72px;top:470px">${simLabel(2.4)}</div>
${bigPhone(800, 20, false, shopScr(0, 7), .9)}
<div class="abs pop" style="left:895px;top:232px;width:44px;height:44px;border-radius:50%;border:4px solid var(--or);--d:6.4s"></div>`,

  rpIos: () => `
${chip("Or an iPhone")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">Type <span class="or">ios</span></h2>
${tcmd([{ t: "npx shipvo run ios", tt: 1.4, d: 1, out: "", od: 3 }], 72, 230, 620, .6, 30)}
<div class="abs in mute" style="left:72px;top:400px;width:600px;font-size:30px;line-height:1.45;--d:3.6s">The page scales the phone to your window.</div>
<div class="abs card in mono" style="left:72px;top:490px;padding:14px 22px;font-size:28px;--d:7s">...?<span class="or">dark=1</span> for the dark frame</div>
${bigPhone(800, 20, true, shopScr(0, 99), .9)}`,

  rpAssistant: () => `
${chip("Your assistant too")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">It drives the same phone</h2>
${chat("You", "Add the net to my cart.", 72, 230, 640, 1.2, "var(--or)")}
<div class="abs card in mono" style="left:72px;top:370px;width:640px;padding:18px 24px;font-size:28px;line-height:1.6;--d:4s"><div class="sky">open_app</div><div class="mute fade" style="--d:5.4s;font-size:24px">attached to the live shipvo run phone</div><div class="fade" style="--d:9s">tap [ref=e3]</div></div>
<div class="abs in mute" style="left:72px;top:610px;font-size:28px;--d:11s">You watch every move.</div>
${bigPhone(840, 20, false, shopScr(0, 10), .9)}`,

  rpStop: () => `
${chip("Options")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">Two flags, one key</h2>
${[["--port 4600", "Pick the port"], ["--native", "A real emulator, later"], ["Ctrl+C", "Stop the phone"]].map(([a, b], k) => `<div class="abs card in" style="left:72px;top:${240 + k * 130}px;width:900px;padding:22px 30px;--d:${1.6 + k * 3}s"><span class="mono or" style="font-size:34px">${a}</span> <span class="mute" style="font-size:28px;margin-left:24px">${b}</span></div>`).join("")}`,

  rpCta: () => `
<div class="abs pop" style="left:72px;top:140px;width:330px;--d:.3s">{{MARK}}</div>
<h1 class="abs in" style="left:470px;top:130px;--d:.8s">A phone,<br><span class="or">in seconds.</span></h1>
<div class="abs card in mono" style="left:470px;top:370px;padding:22px 30px;font-size:28px;--d:2.4s"><span class="sky">npx</span> shipvo run android</div>
<div class="abs in mute" style="left:470px;top:490px;font-size:28px;line-height:1.4;width:700px;--d:4s">The guide: <span class="sky">shipvo.dev</span>/learn</div>`,
});

// --- from-app-to-both-stores ---
const step = (t, st, d, y, x = 72, w = 520) => `<div class="abs card in" style="left:${x}px;top:${y}px;width:${w}px;padding:10px 18px;font-size:21px;--d:${d}s"><span class="mono" style="font-size:16px;color:${st === "wait" ? "var(--or)" : "var(--sky)"}">${st === "wait" ? "WAIT" : "TODO"}</span> &nbsp;${t}</div>`;
const storeTag = (name, x, y, d) => `<div class="abs pop" style="left:${x}px;top:${y}px;--d:${d}s"><span class="badge" style="background:#1a2540;color:var(--paper);font-size:26px">${name}</span></div>`;

Object.assign(SCENES, {
  stHook: () => `
${chip("The store path")}
<h1 class="abs in" style="left:72px;top:130px;width:700px;--d:.5s">Your app works.<br><span class="or">Now, both stores.</span></h1>
<div class="abs in mute" style="left:72px;top:440px;width:600px;font-size:30px;line-height:1.35;--d:2.6s">Google Play and the App Store, step by step.</div>
${storeTag("Google Play", 800, 200, 1.6)}${storeTag("App Store", 800, 300, 2.4)}
<div class="abs flight" style="left:820px;top:430px;width:130px;--fx:-100px;--fy:120px;--tx:140px;--ty:-30px;--d:3.4s">${plane(130)}</div>`,

  stSetup: () => `
${chip("Step 1")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">Make your plan</h2>
${tcmd([{ t: "shipvo store setup --company no", tt: 2, d: 1.2, out: "Wrote store-plan.json. Run `shipvo store status` to see what to do next. Nothing was uploaded.", od: 3.6 }], 72, 210, 1130, .8, 30)}
<div class="abs card in" style="left:72px;top:450px;width:540px;padding:20px 28px;--d:5.4s"><div class="mono sky" style="font-size:18px">A COMPANY</div><div style="font-size:26px;margin-top:6px;line-height:1.35">Organization accounts. No tester rule on Google Play.</div></div>
<div class="abs card in" style="left:650px;top:450px;width:540px;padding:20px 28px;--d:8.4s"><div class="mono or" style="font-size:18px">NO COMPANY</div><div style="font-size:26px;margin-top:6px;line-height:1.35">Personal Google Play account. The 12 tester rule applies.</div></div>`,

  stStatus: () => `
${chip("Step 2")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">See what is next</h2>
${storeTag("Google Play", 72, 190, .8)}${storeTag("App Store", 690, 190, .8)}
${step("Open a Google Play personal account", "todo", 1.6, 260, 72, 590)}${step("Start the closed test with 12 testers", "todo", 2.6, 325, 72, 590)}${step("Apply for production access", "todo", 3.6, 390, 72, 590)}${step("Production review", "todo", 4.6, 455, 72, 590)}
${step("Open an Apple Developer individual account", "todo", 2, 260, 690, 520)}${step("Submit to App Store review", "todo", 3.4, 325, 690, 520)}${step("App Store review", "todo", 4.4, 390, 690, 520)}
<div class="abs mono in" style="left:72px;top:580px;font-size:26px;--d:7s"><span class="or">$</span> shipvo store status --mark play-account</div>`,

  stDetails: () => `
${chip("Step 3")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">Draft the store forms</h2>
${tcmd([{ t: "shipvo store details --dry-run", tt: 1.8, d: 1, out: "Filled without you: 8 of 12 fields.", od: 3.2 }], 72, 200, 1130, .6, 30)}
<div class="abs card in" style="left:72px;top:380px;width:540px;padding:20px 28px;--d:5s"><div class="mono sky" style="font-size:18px">FROM YOUR APP</div><div style="font-size:26px;margin-top:6px;line-height:1.4">data-safety.csv<br>privacy-policy.md</div></div>
<div class="abs card in" style="left:650px;top:380px;width:540px;padding:20px 28px;--d:8s"><div class="mono or" style="font-size:18px">STILL YOURS TO ANSWER</div><div style="font-size:26px;margin-top:6px;line-height:1.4">Third-party SDKs, sign-in, data deletion, a contact address</div></div>`,

  stShots: () => `
${chip("Step 4")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">Store screenshots</h2>
${tcmd([{ t: "shipvo store screenshots", tt: 1.6, d: 1, out: "fast mode: simulator render, not the native UI", od: 2.8 }], 72, 200, 1130, .6, 30)}
${["iPhone", "iPad", "Play phone", "Play tablets"].map((t, k) => `<div class="abs card pop" style="left:${72 + k * 280}px;top:400px;width:250px;padding:22px 24px;--d:${4.6 + k * 1.2}s"><div class="mono sky" style="font-size:16px">SIZE CHECKED</div><div style="font-size:28px;font-weight:700;margin-top:8px">${t}</div></div>`).join("")}`,

  stTesters: () => `
${chip("Google Play only")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">The tester rule</h2>
<div class="abs" style="left:72px;top:230px;width:640px;display:flex;flex-wrap:wrap;gap:14px">${Array.from({ length: 12 }, (_, k) => person(k, 1.2)).join("")}</div>
<div class="abs in" style="left:72px;top:370px;font-size:32px;--d:3.6s">12 testers. <span class="or">14 days in a row.</span></div>
${tcmd([{ t: "shipvo store testers", tt: 1.4, d: 5.6, out: "Get your 12 testers for com.example.app (closed track \"alpha\"):", od: 7.2 }], 72, 430, 1130, 5.2, 28)}
<div class="abs card in" style="left:790px;top:230px;width:390px;padding:22px 28px;--d:4.4s"><div class="mono sky" style="font-size:18px">SHIPVO TESTERS</div><div style="font-size:26px;margin-top:6px;line-height:1.35">Founders who test each other's apps</div></div>`,

  stHonest: () => `
${chip("What you get")}
<h2 class="abs in" style="left:72px;top:100px;--d:.3s">Your store checklist</h2>
<div class="abs card in" style="left:72px;top:230px;width:1100px;padding:26px 34px;font-size:30px;line-height:1.7;--d:1s">
  <div class="fade" style="--d:1.8s"><span style="color:var(--green)">&check;</span> A plan for each store, in order.</div>
  <div class="fade" style="--d:3.6s"><span style="color:var(--green)">&check;</span> Data safety answers and a privacy policy draft.</div>
  <div class="fade" style="--d:5.4s"><span style="color:var(--green)">&check;</span> Screenshots in every store size, checked.</div>
  <div class="fade" style="--d:7.2s"><span style="color:var(--green)">&check;</span> The tester steps for Google Play.</div></div>`,

  stCta: () => `
<div class="abs pop" style="left:72px;top:140px;width:330px;--d:.3s">{{MARK}}</div>
<h1 class="abs in" style="left:470px;top:130px;--d:.8s">Start with<br><span class="or">your plan.</span></h1>
<div class="abs card in mono" style="left:470px;top:370px;padding:22px 30px;font-size:28px;--d:2.4s"><span class="or">$</span> shipvo store setup</div>
<div class="abs in mute" style="left:470px;top:490px;font-size:28px;line-height:1.4;width:700px;--d:4s">The guide is at shipvo.dev/learn.</div>`,
});
