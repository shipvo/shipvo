import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("www", { recursive: true });
copyFileSync("src/index.html", "www/index.html");
