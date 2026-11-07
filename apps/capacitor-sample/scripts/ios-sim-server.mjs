// Usage: node ios-sim-server.mjs <keys.json> <www dir> <mode file> <events file> <port>
import { readFileSync, readdirSync } from "node:fs";
import { createUpdateServer } from "./ios-sim-lib.mjs";

const [keysFile, www, modeFile, eventsFile, port] = process.argv.slice(2);
const { keys, wrongKeys } = JSON.parse(readFileSync(keysFile, "utf8"));
const wwwFiles = Object.fromEntries(readdirSync(www).filter((n) => /\.(html|js)$/.test(n)).map((n) => [n, readFileSync(`${www}/${n}`)]));
createUpdateServer({ keys, wrongKeys, wwwFiles, modeFile, eventsFile }).listen(Number(port), "127.0.0.1", () => console.log(`listening ${port}`));
