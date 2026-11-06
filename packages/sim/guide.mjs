// Lumi's first-run guide on the Shipvo Phone: three short steps (home screen, the Store, connecting an assistant).
// It can be skipped, and once it is finished or skipped it never shows again on this browser. It sits in the phone frame
// over the bottom of the screen, never in the app's own page, so the simulator's screenshots and screen tree do not see it.
// It is drawn only when Lumi is drawn and the page asks for it (`guide: true`).

export const GUIDE_KEY = "shipvo.lumi.guide";

export const GUIDE_STEPS = [
  { title: "Your home screen", text: "Go home to see your apps. Go home at any time to come back." },
  { title: "The Store", text: "The Store icon on the home screen installs more apps on this phone." },
  { title: "Connect an assistant", text: "To let an AI assistant drive this phone, run: claude mcp add shipvo -- npx -y @shipvo/mcp" },
];

/** Markup for the guide. Hidden until the page script finds that this browser has not seen it. */
export function guideHtml() {
  const steps = GUIDE_STEPS.map((s, i) => `<div class="sf-guide-step" data-step="${i + 1}"${i ? " hidden" : ""}><b>${s.title}</b><p>${s.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p></div>`).join("");
  return `<div class="sf-guide" data-part="lumi-guide" role="dialog" aria-live="polite" aria-label="Welcome to Shipvo Phone" hidden>`
    + `<span class="sf-guide-count" data-part="guide-count">1 of ${GUIDE_STEPS.length}</span>${steps}`
    + `<div class="sf-guide-actions"><button type="button" data-part="guide-skip">Skip</button><button type="button" data-part="guide-next">Next</button></div></div>`;
}

export const guideCss = [
  `.sf-guide{position:absolute;left:12px;right:12px;bottom:40px;z-index:4;box-sizing:border-box;padding:12px 14px;border-radius:16px;background:#10151c;color:#fff;border:1px solid #7fd6f5aa;box-shadow:0 0 14px #7fd6f555,0 6px 20px #0008;font:14px/1.4 system-ui,sans-serif}`,
  `.sf-guide[hidden],.sf-guide [hidden]{display:none}`,
  `.sf-guide p{margin:4px 0 0;overflow-wrap:anywhere}.sf-guide-count{float:right;font-size:11px;opacity:.7}`,
  `.sf-guide-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}`,
  `.sf-guide button{padding:6px 16px;border:1px solid #fff6;border-radius:999px;background:transparent;color:#fff;font:600 13px system-ui,sans-serif;cursor:pointer}`,
  `.sf-guide [data-part=guide-next]{background:#7fd6f5;border-color:#7fd6f5;color:#10151c}.sf-guide button:focus-visible{outline:3px solid #4da3ff;outline-offset:2px}`,
].join("\n");

/** Browser script. Shows the guide on first launch, steps through it, and remembers a finish or a skip in localStorage. */
export function guideClientScript() {
  return `(function(){var K=${JSON.stringify(GUIDE_KEY)},g=document.querySelector('[data-part="lumi-guide"]');if(!g)return;
function seen(){try{return localStorage.getItem(K)==="done"}catch(x){return false}}
function save(){try{localStorage.setItem(K,"done")}catch(x){}}
var s=g.querySelectorAll(".sf-guide-step"),i=0,c=g.querySelector('[data-part="guide-count"]'),n=g.querySelector('[data-part="guide-next"]');
function lumi(st){if(window.shipvoLumi)window.shipvoLumi.set(st)}
function draw(){for(var j=0;j<s.length;j++)s[j].hidden=j!==i;c.textContent=(i+1)+" of "+s.length;n.textContent=i===s.length-1?"Done":"Next"}
function close(happy){save();g.hidden=true;lumi(happy?"happy":"idle")}
g.querySelector('[data-part="guide-skip"]').addEventListener("click",function(){close(false)});
n.addEventListener("click",function(){if(i>=s.length-1)return close(true);i++;draw()});
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!g.hidden)close(false)});
if(seen())return;draw();g.hidden=false})();`;
}
