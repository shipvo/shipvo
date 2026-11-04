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
