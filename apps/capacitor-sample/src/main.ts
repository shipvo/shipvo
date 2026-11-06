import { ITEMS, findItem, releaseLabel } from "./items.js";
import { startShipvo } from "./shipvo.js";

// Set by startShipvo() when the app runs a staged release. Otherwise the app shows the embedded build.
declare global {
  interface Window {
    __SHIPVO_RELEASE__?: number;
  }
}

const app = document.getElementById("app") as HTMLElement;

function showList(): void {
  app.innerHTML = "";
  const h = document.createElement("h1");
  h.textContent = "Items";
  const ul = document.createElement("ul");
  for (const item of ITEMS) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.textContent = item.name;
    b.addEventListener("click", () => showDetail(item.id));
    li.append(b);
    ul.append(li);
  }
  const rel = document.createElement("button");
  rel.id = "release";
  rel.textContent = "Show release number";
  const out = document.createElement("p");
  out.id = "release-out";
  rel.addEventListener("click", () => {
    out.textContent = releaseLabel(window.__SHIPVO_RELEASE__);
  });
  const check = document.createElement("button");
  check.id = "check";
  check.textContent = "Check for update";
  const checkOut = document.createElement("p");
  checkOut.id = "check-out";
  check.addEventListener("click", async () => {
    const shipvo = await shipvoReady;
    if (!shipvo) { checkOut.textContent = "Updates are not configured in this build."; return; }
    const r = await shipvo.checkForUpdate({ apply: true });
    checkOut.textContent = r.status === "staged" ? `Applying release ${r.release}` : r.status === "error" ? `Error: ${r.error}` : "Up to date";
  });
  app.append(h, ul, rel, out, check, checkOut);
}

function showDetail(id: number): void {
  const item = findItem(id);
  app.innerHTML = "";
  const h = document.createElement("h1");
  h.textContent = item ? item.name : "Not found";
  const p = document.createElement("p");
  p.textContent = item ? item.note : "";
  const back = document.createElement("button");
  back.textContent = "Back";
  back.addEventListener("click", showList);
  app.append(h, p, back);
}

const shipvoReady = startShipvo().catch(() => undefined);
showList();
