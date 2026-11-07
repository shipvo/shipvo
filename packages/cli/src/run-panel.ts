// The device panel on the `shipvo run` page (slice 3 of #442). It sets the same simulated `@shipvo/device` state the app
// reads (`__pnDevice` in the app iframe) and writes each change to the page's event log, labelled "simulated".
// The controls follow the preview panel in preview.ts.

const PLACES: [string, number, number][] = [["Douala", 4.0511, 9.7679], ["Paris", 48.8566, 2.3522], ["New York", 40.7128, -74.006], ["Nairobi", -1.2921, 36.8219]];
/** Network states on the panel, named as in the profile table in @shipvo/sim. */
export const PANEL_NETWORKS: [string, string][] = [["online", "Online"], ["offline", "Offline"], ["2g", "2G"], ["slow-4g", "Slow 4G"]];
/** The test image the camera control puts in the file picker. */
export const TEST_IMAGE = { name: "test-photo.svg", mimeType: "image/svg+xml", content: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#2563eb"/><circle cx="32" cy="32" r="16" fill="#fff"/></svg>' };

export const runPanelCss = (): string => `
#dpanel{position:fixed;right:12px;top:44px;width:264px;max-width:calc(100vw - 24px);max-height:calc(100vh - 64px);overflow:auto;box-sizing:border-box;border-radius:12px;background:#fff;color:#111;box-shadow:0 2px 12px #0003;z-index:8}
#dpanel>summary{cursor:pointer;padding:8px 12px;font-weight:600}
#dpanel .body{display:grid;gap:10px;padding:0 12px 12px}
#dpanel fieldset{border:0;margin:0;padding:0;display:grid;gap:6px}#dpanel legend{font-weight:600;padding:0 0 4px}
#dpanel .row{display:flex;gap:6px;flex-wrap:wrap}
#dpanel input,#dpanel select,#dpanel button{font:inherit;padding:4px 8px;border:1px solid #888;border-radius:8px;background:#fff;color:inherit;min-width:0;cursor:pointer}
#dpanel input{flex:1 1 70px;cursor:text}#dpanel button[aria-pressed=true]{background:#2563eb;border-color:#2563eb;color:#fff}
#dpanel .sim{margin:0;font-size:12px;opacity:.7}
@media(prefers-color-scheme:dark){#dpanel{background:#1c1c1e;color:#f2f2f7}#dpanel input,#dpanel select,#dpanel button{background:#2c2c2e;border-color:#666}}`;

export function runPanelHtml(): string {
  const b = (c: string, t: string) => `<button type="button" data-control="${c}">${t}</button>`;
  return `<details id="dpanel" aria-label="Device controls" data-part="device-panel"><summary>Device panel</summary><div class="body">
<fieldset><legend>Location</legend><div class="row"><select data-control="location-list" aria-label="Place">${PLACES.map(([n, a, o]) => `<option value="${a},${o}">${n}</option>`).join("")}</select>${b("location-set", "Set")}</div>
<div class="row"><input data-control="lat" placeholder="Latitude" inputmode="decimal" aria-label="Latitude"><input data-control="lng" placeholder="Longitude" inputmode="decimal" aria-label="Longitude">${b("coords-set", "Go")}</div></fieldset>
<fieldset><legend>Camera</legend><div class="row">${b("camera-image", "Pick test image")}</div></fieldset>
<fieldset><legend>Biometrics</legend><div class="row">${b("bio-success", "Succeed")}${b("bio-fail", "Fail")}${b("bio-none", "Not enrolled")}</div></fieldset>
<fieldset><legend>Payment</legend><div class="row">${b("pay-approve", "Succeed")}${b("pay-cancel", "Cancel")}${b("pay-decline", "Decline")}</div></fieldset>
<fieldset><legend>Network</legend><div class="row">${PANEL_NETWORKS.map(([k, t]) => b("net-" + k, t)).join("")}</div></fieldset>
<fieldset><legend>Push</legend><div class="row"><input data-control="push-title" placeholder="Title" aria-label="Notification title"><input data-control="push-body" placeholder="Message" aria-label="Notification message">${b("push-send", "Send test")}</div></fieldset>
<p class="sim" id="dstatus" role="status">All changes here are simulated.</p></div></details>`;
}

/** Page script. Runs before the bridge loads; the log function is looked up at click time. */
export function runPanelScript(): string {
  return `(function(){
var P=document.getElementById("dpanel"),S=document.getElementById("dstatus"),F=document.getElementById("app");
var IMG=${JSON.stringify(TEST_IMAGE)};
P.open=innerWidth>=900;
window.__runPanelWidth=function(){return P.open?276:0};
P.addEventListener("toggle",function(){if(window.fit)fit()});
function val(c){return document.querySelector('[data-control="'+c+'"]').value}
function say(m){S.textContent=m+" (simulated)";if(window.shipvoStep)window.shipvoStep("Device: "+m,true)}
function dev(){var d=F.contentWindow&&F.contentWindow.__pnDevice;if(!d)S.textContent="The app is still loading (simulated)";return d||null}
function set(patch,m){var d=dev();if(d){d.set(patch);say(m)}}
var A={
"location-set":function(){var v=val("location-list").split(",");set({location:{latitude:+v[0],longitude:+v[1],accuracy:20}},"location set to "+v[0]+", "+v[1])},
"coords-set":function(){var a=val("lat").trim(),o=val("lng").trim(),x=a===""?NaN:+a,y=o===""?NaN:+o;if(!(x>=-90&&x<=90&&y>=-180&&y<=180)){S.textContent="Enter latitude -90 to 90 and longitude -180 to 180 (simulated)";return}set({location:{latitude:x,longitude:y,accuracy:20}},"location set to "+x+", "+y)},
"camera-image":function(){set({files:[{name:IMG.name,mimeType:IMG.mimeType,content:IMG.content}]},"test image ready for the camera and photo picker")},
"bio-success":function(){set({biometrics:{enrolled:true,nextResult:"success"}},"biometrics succeed")},
"bio-fail":function(){set({biometrics:{enrolled:true,nextResult:"fail"}},"biometrics fail")},
"bio-none":function(){set({biometrics:{enrolled:false}},"biometrics not enrolled")},
"pay-approve":function(){set({payment:{nextResult:"approve"}},"payments succeed")},
"pay-cancel":function(){set({payment:{nextResult:"cancel"}},"payments are cancelled")},
"pay-decline":function(){set({payment:{nextResult:"decline"}},"payments are declined")},
"push-send":function(){var d=dev();if(!d)return;var ok=d.push({title:val("push-title")||"Notification",body:val("push-body")})!==null;if(ok)say("test notification sent");else S.textContent="Not delivered: the app has not been granted notification permission (simulated)"}
};
${JSON.stringify(PANEL_NETWORKS)}.forEach(function(n){A["net-"+n[0]]=function(){set({networkProfile:n[0]},"network "+n[1])}});
var groups=[["bio-success","bio-fail","bio-none"],["pay-approve","pay-cancel","pay-decline"],${JSON.stringify(PANEL_NETWORKS.map(([k]) => "net-" + k))}];
document.querySelectorAll("#dpanel [data-control]").forEach(function(e){var c=e.dataset.control;if(!A[c])return;e.onclick=function(){A[c]();groups.forEach(function(g){if(g.indexOf(c)<0)return;g.forEach(function(k){document.querySelector('[data-control="'+k+'"]').setAttribute("aria-pressed",k===c)})})}});
})()`;
}
