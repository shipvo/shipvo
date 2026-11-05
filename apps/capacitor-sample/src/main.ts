import { ITEMS, findItem, releaseLabel } from "./items.js";

// Set by a Shipvo adapter once one exists. Until then the app shows the embedded build.
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
  app.append(h, ul, rel, out);
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

showList();
