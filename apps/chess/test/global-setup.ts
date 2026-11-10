// Builds the web bundle once, before any test file starts. Test files run in parallel, and each one used to run
// `expo export --clear` when sim-dist was missing, so they deleted each other's output.
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export default function setup() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  if (existsSync(`${root}sim-dist/index.html`)) return;
  execSync("pnpm exec expo export --platform web --output-dir sim-dist --clear", { cwd: root, env: { ...process.env, PN_SIM: "1" }, stdio: "inherit" });
}
