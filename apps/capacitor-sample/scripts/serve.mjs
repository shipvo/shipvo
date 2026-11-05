// Static server for www/ so you can open the app in a browser.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const types = { ".html": "text/html", ".js": "text/javascript" };
const port = Number(process.env.PORT ?? 5173);

createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname;
  const rel = normalize(path === "/" ? "/index.html" : path).replace(/^(\.\.[/\\])+/, "");
  try {
    const body = await readFile(join("www", rel));
    res.writeHead(200, { "content-type": types[extname(rel)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
