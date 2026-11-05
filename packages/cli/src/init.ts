// `shipvo init <dir>`: a new Expo app wired to Shipvo: signed OTA runtime + plugin, the device API, the simulator,
// a publish workflow and a shipvo.json. Everything an agent needs to open it is in place on the first commit.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { b64, keyFromSeed } from "./index.js";
import { args as parse } from "./config.js";
import { adopt, detectProject, isAdoptArgs, positional } from "./adopt.js";

const HOSTED = "https://api.shipvo.dev";
const SDK = { expo: "~58.0.21", camera: "~58.0.14", clipboard: "~58.0.4", localAuth: "~58.0.2", location: "~58.0.20", notifications: "~58.1.7", statusBar: "~58.0.4", constants: "~58.0.0", metroRuntime: "~58.0.15", react: "19.3.0", rn: "0.88.1", rnw: "^0.21.4" };

const TEMPLATES = ["blank", "content", "shop"];

const INIT_NEEDS_DIR = `shipvo: init needs a folder name.
Try:  shipvo init myshop
This creates ./myshop with a ready app. Other options (app id, bundle id, control plane) have defaults; see 'shipvo init --help'.`;

const INIT_HELP = `Usage: shipvo init <dir> [options]
       shipvo init [.] [--dry-run] [--yes] [--device]   (adopt mode, inside an existing Expo app)

Adopt mode: run it inside an Expo app (package.json with expo, plus app.json or app.config.js/ts).
It shows a plan, then applies it after you confirm. It installs @shipvo/runtime, adds the config plugin
and a signing key, writes shipvo.json, adds sim/publish/rollback scripts, and adds a publish workflow if
there is none. It never overwrites a file and never touches ios/ or android/. It refuses apps that use
expo-updates or CodePush. See docs/cli.md.

  --dry-run              Print the plan and change nothing.
  --yes                  Apply the plan without asking.
  --device               Also install @shipvo/device.

Creating a new app:

Creates <dir> with a ready app. Every option is optional.

  --app-id <id>          App id. Default: the folder name.
  --name <name>          Display name. Default: the app id in title case.
  --bundle-id <id>       iOS bundle id and Android package. Default: dev.shipvo.<app id>.
  --control-plane <url>  Where releases are published. Default: ${HOSTED}.
  --public-key <b64>     Signing public key to pin. Default: a new key is made for you.
  --template <name>      Starting app. One of: ${TEMPLATES.join(", ")}. Default: blank.
                           blank    the starter with device API buttons.
                           content  a list screen and a detail screen reading titles and text from src/data/articles.json.
                           shop     a product list, a product page and a cart, reading products and prices from src/data/products.json.
  --help                 Show this text.`;

const title = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export async function init(argv: string[]) {
  const [dirArg] = positional(argv);
  const a = parse(argv);
  if (argv.includes("--help") || argv.includes("-h")) { console.log(INIT_HELP); return; }
  if (isAdoptArgs(argv) && (dirArg === "." || detectProject(process.cwd()).isExpo)) { await adopt(argv); return; }
  if (!dirArg) { console.error(INIT_NEEDS_DIR); process.exit(2); }
  if (a.template === "true") { console.error(`shipvo: --template needs a name. Valid templates: ${TEMPLATES.join(", ")}.`); process.exit(2); }
  const template = a.template ?? "blank";
  if (!TEMPLATES.includes(template)) { console.error(`shipvo: unknown template "${template}". Valid templates: ${TEMPLATES.join(", ")}.`); process.exit(2); }
  const dir = resolve(dirArg);
  if (existsSync(dir)) { console.error(`${dir} already exists`); process.exit(1); }
  const appId = (a["app-id"] || dirArg.split("/").pop()!.toLowerCase().replace(/[^a-z0-9-]/g, "-")).slice(0, 32);
  const name = a.name || title(appId);
  const controlPlane = (a["control-plane"] || HOSTED).replace(/\/$/, "");
  const bundleId = a["bundle-id"] || `dev.shipvo.${appId.replace(/-/g, "")}`;

  // Signing key: use the one given, or make one. The seed never enters the repo; the public key is pinned in the shell.
  let publicKey = a["public-key"], seedNote = "";
  if (!publicKey) {
    const seed = b64(randomBytes(32)); publicKey = b64(keyFromSeed(seed).publicKey);
    mkdirSync(join(dir, ".shipvo"), { recursive: true }); writeFileSync(join(dir, ".shipvo", "seed.txt"), seed, { mode: 0o600 });
    seedNote = `A release signing key was created at .shipvo/seed.txt (git-ignored). Back it up offline and put it in the SHIPVO_SIGNING_SEED secret of your CI. Lose it and you cannot publish to installed shells.`;
  }
  const w = (p: string, body: string) => { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), body); };

  w("shipvo.json", JSON.stringify({ appId, name, shellMajor: 1, controlPlane, publicKey, listing: { public: false, tagline: "", description: "", category: "other", icon: "assets/icon.png", screenshots: [], website: "", capabilities: ["camera", "location", "biometrics", "payments", "notifications"] } }, null, 2) + "\n");
  w("package.json", JSON.stringify({
    name: appId, version: "1.0.0", main: "index.ts", private: true,
    scripts: { start: "expo start", test: "vitest run", android: "expo run:android", ios: "expo run:ios", web: "expo start --web", sim: "shipvo sim", publish: "shipvo publish", rollback: "shipvo rollback", typecheck: "tsc --noEmit" },
    dependencies: {
      "@expo/metro-runtime": SDK.metroRuntime, expo: SDK.expo, "expo-camera": SDK.camera, "expo-clipboard": SDK.clipboard, "expo-constants": SDK.constants,
      "expo-local-authentication": SDK.localAuth, "expo-location": SDK.location, "expo-notifications": SDK.notifications, "expo-status-bar": SDK.statusBar,
      react: SDK.react, "react-dom": SDK.react, "react-native": SDK.rn, "react-native-web": SDK.rnw,
      "@shipvo/device": "^0.1.0", "@shipvo/runtime": "^0.1.0",
    },
    devDependencies: { "@shipvo/cli": "^0.1.0", "@shipvo/sim": "^0.1.0", "@shipvo/test": "^0.1.0", "@types/react": "~19.3.0", playwright: "^1.63.0", typescript: "~6.0.3", vitest: "^2.1.4" },
  }, null, 2) + "\n");
  w("app.json", JSON.stringify({ expo: {
    name, slug: appId, version: "1.0.0", orientation: "portrait", userInterfaceStyle: "automatic",
    ios: { bundleIdentifier: bundleId, supportsTablet: false },
    android: { package: bundleId, versionCode: 1, predictiveBackGestureEnabled: false },
    web: { output: "single" },
    plugins: [
      ["@shipvo/runtime", { baseUrl: controlPlane, publicKey, appId, shellMajor: 1 }],
      ["expo-camera", { cameraPermission: `${name} uses the camera to scan codes.` }],
      ["expo-location", { locationWhenInUsePermission: `${name} uses your location to find what is near you.` }],
      ["expo-local-authentication", { faceIDPermission: `${name} uses Face ID to confirm actions.` }],
      ["expo-notifications", {}],
    ],
  } }, null, 2) + "\n");
  w("tsconfig.json", JSON.stringify({ extends: "expo/tsconfig.base", compilerOptions: { strict: true, allowImportingTsExtensions: true, noEmit: true }, exclude: ["node_modules"] }, null, 2) + "\n");
  w("metro.config.js", `// Shipvo: PN_SIM=1 web builds use the simulated device (system sheets in the accessibility tree) instead of Expo's native modules.
const { getDefaultConfig } = require("expo/metro-config");
const withShipvoSim = require("@shipvo/device/metro");
module.exports = withShipvoSim(getDefaultConfig(__dirname));
`);
  w("index.ts", `import { registerRootComponent } from "expo";\nimport App from "./App";\nregisterRootComponent(App);\n`);
  w(".gitignore", `node_modules/\n.expo/\ndist/\ndist-ota/\ndist-web/\nsim-dist/\nweb-build/\n/ios\n/android\n.kotlin/\n*.jks\n*.p8\n*.p12\n*.key\n*.mobileprovision\n*.tsbuildinfo\n.env*.local\n.DS_Store\n# never commit the release signing seed\n.shipvo/\n`);
  w("src/release.ts", `// Edit and push: the publish workflow signs and ships this to every installed phone and to the simulator.
export const RELEASE = { headline: "Hello from ${name}.", note: "Edit src/release.ts and run \`shipvo publish\`." };
`);
  if (template === "content") {
    w("App.tsx", CONTENT_APP_TSX(name));
    w("src/screens/List.tsx", CONTENT_LIST);
    w("src/screens/Detail.tsx", CONTENT_DETAIL);
    w("src/data/articles.json", CONTENT_DATA);
  } else if (template === "shop") {
    w("App.tsx", SHOP_APP_TSX(name));
    w("src/cart.tsx", SHOP_CART_STATE);
    w("src/money.ts", SHOP_MONEY);
    w("src/screens/List.tsx", SHOP_LIST);
    w("src/screens/Detail.tsx", SHOP_DETAIL);
    w("src/screens/Cart.tsx", SHOP_CART);
    w("src/data/products.json", SHOP_DATA);
  } else w("App.tsx", APP_TSX(name, appId));
  w(".github/workflows/publish.yml", WORKFLOW);
  w(".github/workflows/test.yml", TEST_WORKFLOW);
  w("tests/app.test.ts", template === "content" ? CONTENT_TEST : template === "shop" ? SHOP_TEST : TEST_APP(name));
  w("vitest.config.ts", VITEST_CONFIG);
  w("README.md", README(name, appId, controlPlane, template));

  console.log(`
Created ${name} in ${dirArg}

${seedNote}
Public key pinned in the shell: ${publicKey}

Phones:  npx expo run:android   (needs Android Studio once). iOS: npx expo run:ios, then shipvo publish --platform all
Publish: shipvo login, then shipvo app create (hosted), or set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and SHIPVO_KV_ID (self-hosted); then npm run publish
         (self-hosting instead? see docs/self-hosting.md)
AI agents: npx -y @shipvo/mcp points Claude / Cursor / ChatGPT at the simulator; then open_app("${appId}")

Install first: npm install (or pnpm / bun), then npx playwright install chromium

Next steps:
  1. cd ${dirArg}
  2. npx shipvo doctor             # setup checks
  3. npm run sim                   # open the app in the simulator on http://localhost:4545
  4. npx shipvo publish --dry-run  # see what a release would contain
`);
}

const APP_TSX = (name: string, appId: string) => `import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Runtime } from "@shipvo/runtime";
import { device } from "@shipvo/device";
import { ScanHost } from "@shipvo/device/scan";
import { RELEASE } from "./src/release";

const POLL_MS = 10_000;

export default function App() {
  const [state] = useState(() => { try { return Runtime.getState(); } catch { return null; } });
  const [log, setLog] = useState<string[]>([]);
  const busy = useRef(false);
  const add = (t: string) => setLog((l) => [t, ...l].slice(0, 20));

  // Over-the-air updates: tell the runtime the first screen rendered (so this release is kept), then poll while open.
  useEffect(() => {
    try { const h = Runtime.markHealthy(); add(h.release ? \`Running release \${h.release}\` : "Running local build"); } catch {}
    const check = async () => {
      if (busy.current || !state?.baseUrl) return; busy.current = true;
      try { const r = await Runtime.checkForUpdate(true); if (r.status === "staged") add(\`Applied release \${r.release} (\${r.via ?? "full"})\`); }
      finally { busy.current = false; }
    };
    check(); const id = setInterval(() => { if (AppState.currentState === "active") check(); }, POLL_MS);
    return () => clearInterval(id);
  }, []);

  // Device API: real on phones, simulated in the simulator (agents answer the system sheets and set what the camera sees).
  const scan = async () => { try { const r = await device.camera.scan({ prompt: "Point at a code" }); add(r ? \`Scanned \${r.data}\` : "Scan cancelled"); } catch (e: any) { add(String(e.message)); } };
  const locate = async () => { try { const c = await device.location.current(); add(\`At \${c.latitude.toFixed(4)}, \${c.longitude.toFixed(4)}\`); } catch (e: any) { add(String(e.message)); } };
  const notify = async () => { await device.notifications.show({ title: "${name}", body: "Hello from a notification.", data: {} }); add("Notification sent"); };
  const confirm = async () => { const r = await device.auth.confirm("Confirm it is you"); add(r.ok ? "Confirmed" : \`Not confirmed (\${r.reason})\`); };

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={s.page}>
        <Text style={s.h1} accessibilityRole="header">${name}</Text>
        <View style={s.hero}><Text style={s.heroText}>{RELEASE.headline}</Text><Text style={s.heroNote}>{RELEASE.note}</Text></View>
        <Text style={s.h2} accessibilityRole="header">Try the device</Text>
        <Btn label="Scan a code" onPress={scan} />
        <Btn label="Use my location" onPress={locate} />
        <Btn label="Confirm with fingerprint" onPress={confirm} />
        <Btn label="Send a notification" onPress={notify} />
        <Text style={s.h2} accessibilityRole="header">Log</Text>
        {log.length === 0 ? <Text style={s.muted}>Nothing yet.</Text> : log.map((l, i) => <Text key={i} style={s.line}>{l}</Text>)}
        <Text style={s.muted}>App id ${appId} · shell {state?.shellVersion ?? "none"} · {state?.runningRelease ? \`release \${state.runningRelease}\` : "local build"}</Text>
      </ScrollView>
      <ScanHost accent="#1F4E5F" />
    </View>
  );
}

function Btn({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={s.btn}><Text style={s.btnText}>{label}</Text></Pressable>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F6F8F7" },
  page: { padding: 20, paddingTop: 56, gap: 12 },
  h1: { fontSize: 28, fontWeight: "800", color: "#111" }, h2: { fontSize: 17, fontWeight: "700", color: "#111", marginTop: 8 },
  hero: { backgroundColor: "#1F4E5F", borderRadius: 16, padding: 20, gap: 6 },
  heroText: { color: "#fff", fontSize: 20, fontWeight: "800" }, heroNote: { color: "#fff", opacity: 0.9 },
  btn: { minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: "#CBD5D1", alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  btnText: { fontSize: 16, fontWeight: "700", color: "#111" },
  line: { fontSize: 14, color: "#111" }, muted: { fontSize: 13, color: "#5B6B66" },
});
`;

const TEST_WORKFLOW = `name: test
# Runs your app in the Shipvo simulator on a plain Linux runner (no emulator, no device) and fails the build if it breaks.
on:
  pull_request:
  push:
    branches: [main]
  workflow_call:
jobs:
  simulator:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - name: Build the app for the simulator and serve it
        run: |
          npx shipvo sim --port 4545 > sim.log 2>&1 &
          for i in $(seq 1 180); do curl -sf localhost:4545/app/ >/dev/null && break; sleep 1; done
          curl -sf localhost:4545/app/ >/dev/null || { cat sim.log; exit 1; }
      - name: Test the app in the simulator
        run: npx vitest run
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: simulator-log, path: sim.log }
`;

const TEST_APP = (name: string) => `// Tests that run your app in the Shipvo simulator: a phone-sized, headless copy of the real app. No emulator, no device.
// Run them with "npm test" (start the simulator first: npm run sim) and in CI (.github/workflows/test.yml).
import { test, expect } from "@shipvo/test/vitest";
import { RELEASE } from "../src/release";

test("the app opens and shows its headline", async ({ phone }) => {
  expect(phone).toSee(RELEASE.headline);
  expect(phone.screen).not.toMatch(/something went wrong|unhandled|exception/i);
});

test("location: the app asks, then reads the phone's location", async ({ phone }) => {
  await phone.device.set({ location: { latitude: 4.0511, longitude: 9.7679 } });
  await phone.tap("Use my location");
  expect(phone).toSee("access this device's location");
  await phone.tap("While using the app");
  await phone.waitFor(/4\\.05/);
});

test("camera: scanning reads what is in front of it", async ({ phone }) => {
  await phone.device.set({ camera: { barcode: { type: "qr", data: "HELLO-123" } } });
  await phone.tap("Scan a code");
  await phone.tap("While using the app");
  await phone.waitFor(/HELLO-123/);
});

test("fingerprint: success and failure are both handled", async ({ phone }) => {
  await phone.device.set({ biometrics: { enrolled: true, nextResult: "success" } });
  await phone.tap("Confirm with fingerprint");
  await phone.tap("Use fingerprint");
  await phone.waitFor("Confirmed");
  await phone.device.set({ biometrics: { nextResult: "fail" } });
  await phone.tap("Confirm with fingerprint");
  await phone.tap("Use fingerprint");
  await phone.waitFor(/Not confirmed/);
});

test("notifications: a push can be opened from the shade", async ({ phone }) => {
  await phone.tap("Send a notification");
  expect(await phone.notifications()).toHaveLength(1);
  await phone.openNotification();
  expect(await phone.deviceLog()).toContainEqual(expect.objectContaining({ kind: "notification_opened" }));
});
`;

const VITEST_CONFIG = `import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/**/*.test.ts"], testTimeout: 30_000 } });
`;

const WORKFLOW = `name: publish
on:
  push:
    branches: [main]
    paths: ["src/**", "App.tsx"]
  workflow_dispatch:
jobs:
  test:
    uses: ./.github/workflows/test.yml   # the simulator test must pass before anything ships to phones
  publish:
    needs: test
    runs-on: ubuntu-latest
    concurrency: shipvo-publish
    if: \${{ github.event_name != 'push' || !contains(github.event.head_commit.message, '[no-ota]') }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: pip install --break-system-packages bsdiff4
      - name: Build, sign and publish over the air
        env:
          SHIPVO_PUBLISH_TOKEN: \${{ secrets.SHIPVO_PUBLISH_TOKEN }}   # from \`shipvo app create\`; self-hosting instead: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, SHIPVO_KV_ID
          SHIPVO_SIGNING_SEED: \${{ secrets.SHIPVO_SIGNING_SEED }}
        run: npx shipvo publish | tee -a "$GITHUB_STEP_SUMMARY"
`;

const README = (name: string, appId: string, cp: string, template = "blank") => `# ${name}

A [Shipvo](https://github.com/shipvo/shipvo) app: one React Native codebase that people install from the stores and AI agents operate in a simulator, kept current with signed over-the-air releases.

- \`npm run sim\` opens it in the simulator; \`npx -y @shipvo/mcp\` lets Claude, Cursor or ChatGPT use it (\`open_app("${appId}")\`).
- \`npx expo run:android\` builds the native shell (the trust root and control plane \`${cp}\` are pinned in it).
- Push to \`main\`: the publish workflow signs the new JavaScript and every phone and simulator gets it.
- ${template === "content" ? "`src/data/articles.json` is the first thing to edit: it holds the titles and text. `src/screens/` has the list and detail screens." : template === "shop" ? "`src/data/products.json` is the first thing to edit: it holds the product names, prices (in cents) and descriptions. `src/screens/` has the list, detail and cart screens." : "`src/release.ts` is the first thing to edit; `App.tsx` shows the device API (camera, location, biometrics, notifications)."}
`;

const CONTENT_DATA = JSON.stringify([
  { id: "welcome", title: "Welcome", body: "This is the first article. Edit src/data/articles.json to change the titles and text." },
  { id: "add-more", title: "Add more articles", body: "Each article has an id, a title and a body. Add an object to the list and it shows up on the first screen." },
  { id: "ship-it", title: "Ship it", body: "Run shipvo publish and every installed phone gets your new articles over the air." },
], null, 2) + "\n";

const CONTENT_APP_TSX = (name: string) => `import { useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Runtime } from "@shipvo/runtime";
import { List } from "./src/screens/List";
import { Detail } from "./src/screens/Detail";
import articles from "./src/data/articles.json";

export default function App() {
  const [openId, setOpenId] = useState<string | null>(null);
  // Tell the runtime the first screen rendered, so this release is kept.
  // Then check for new releases now and while the app is open.
  const busy = useRef(false);
  useEffect(() => {
    try { Runtime.markHealthy(); } catch {}
    const check = async () => {
      if (busy.current) return; busy.current = true;
      try { await Runtime.checkForUpdate(true); } catch {}
      finally { busy.current = false; }
    };
    check(); const id = setInterval(() => { if (AppState.currentState === "active") check(); }, 60000);
    return () => clearInterval(id);
  }, []);
  const open = articles.find((a) => a.id === openId);
  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      {open ? <Detail article={open} onBack={() => setOpenId(null)} /> : <List title="${name}" articles={articles} onOpen={setOpenId} />}
    </View>
  );
}

const s = StyleSheet.create({ root: { flex: 1, backgroundColor: "#F6F8F7" } });
`;

const CONTENT_LIST = `import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

export type Article = { id: string; title: string; body: string };

export function List({ title, articles, onOpen }: { title: string; articles: Article[]; onOpen: (id: string) => void }) {
  return (
    <ScrollView contentContainerStyle={s.page}>
      <Text style={s.h1} accessibilityRole="header">{title}</Text>
      {articles.map((a) => (
        <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={a.title} onPress={() => onOpen(a.id)} style={s.row}>
          <Text style={s.rowText}>{a.title}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 20, paddingTop: 56, gap: 12 },
  h1: { fontSize: 28, fontWeight: "800", color: "#111" },
  row: { minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: "#CBD5D1", justifyContent: "center", paddingHorizontal: 16, backgroundColor: "#fff" },
  rowText: { fontSize: 16, fontWeight: "700", color: "#111" },
});
`;

const CONTENT_DETAIL = `import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import type { Article } from "./List";

export function Detail({ article, onBack }: { article: Article; onBack: () => void }) {
  return (
    <ScrollView contentContainerStyle={s.page}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={s.back}><Text style={s.backText}>Back</Text></Pressable>
      <Text style={s.h1} accessibilityRole="header">{article.title}</Text>
      <Text style={s.body}>{article.body}</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 20, paddingTop: 56, gap: 12 },
  back: { minHeight: 48, justifyContent: "center" }, backText: { fontSize: 16, fontWeight: "700", color: "#1F4E5F" },
  h1: { fontSize: 24, fontWeight: "800", color: "#111" },
  body: { fontSize: 16, lineHeight: 24, color: "#111" },
});
`;

const CONTENT_TEST = `// Runs the app in the Shipvo simulator. Start it first: npm run sim.
import { test, expect } from "@shipvo/test/vitest";
import articles from "../src/data/articles.json";

test("the list shows every title", async ({ phone }) => {
  for (const a of articles) expect(phone).toSee(a.title);
  expect(phone.screen).not.toMatch(/something went wrong|unhandled|exception/i);
});

test("opening a title shows its text, and Back returns to the list", async ({ phone }) => {
  await phone.tap(articles[0].title);
  await phone.waitFor(articles[0].body);
  await phone.tap("Back");
  await phone.waitFor(articles[1].title);
});
`;

const SHOP_DATA = JSON.stringify([
  { id: "canvas-tote", name: "Canvas tote", price: 1800, description: "A sturdy cotton bag with a long strap." },
  { id: "enamel-mug", name: "Enamel mug", price: 1200, description: "A light mug that keeps coffee warm on a walk." },
  { id: "pocket-notebook", name: "Pocket notebook", price: 650, description: "Sixty plain pages and a soft cover." },
  { id: "wool-beanie", name: "Wool beanie", price: 2400, description: "A warm hat in undyed wool." },
  { id: "steel-bottle", name: "Steel bottle", price: 2900, description: "A one litre bottle with a screw cap." },
], null, 2) + "\n";

const SHOP_MONEY = `// Prices are whole cents in src/data/products.json. This is the one place that turns them into text.
export const formatPrice = (cents: number) => "$" + (cents / 100).toFixed(2);
`;

const SHOP_CART_STATE = `import { createContext, useContext, useState, type ReactNode } from "react";
import products from "./data/products.json";

export type Line = { id: string; qty: number };
type Cart = { lines: Line[]; add: (id: string) => void; remove: (id: string) => void; totalCents: number };

const Ctx = createContext<Cart | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<Line[]>([]);
  const add = (id: string) => setLines((l) => l.some((x) => x.id === id) ? l.map((x) => x.id === id ? { ...x, qty: x.qty + 1 } : x) : [...l, { id, qty: 1 }]);
  const remove = (id: string) => setLines((l) => l.filter((x) => x.id !== id));
  const totalCents = lines.reduce((sum, x) => sum + x.qty * (products.find((p) => p.id === x.id)?.price ?? 0), 0);
  return <Ctx.Provider value={{ lines, add, remove, totalCents }}>{children}</Ctx.Provider>;
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart needs a CartProvider");
  return c;
}
`;

const SHOP_APP_TSX = (name: string) => `import { useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Runtime } from "@shipvo/runtime";
import { CartProvider } from "./src/cart";
import { List } from "./src/screens/List";
import { Detail } from "./src/screens/Detail";
import { Cart } from "./src/screens/Cart";
import products from "./src/data/products.json";

type Route = { name: "list" } | { name: "detail"; id: string } | { name: "cart" };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: "list" });
  // Tell the runtime the first screen rendered, so this release is kept.
  // Then check for new releases now and while the app is open.
  const busy = useRef(false);
  useEffect(() => {
    try { Runtime.markHealthy(); } catch {}
    const check = async () => {
      if (busy.current) return; busy.current = true;
      try { await Runtime.checkForUpdate(true); } catch {}
      finally { busy.current = false; }
    };
    check(); const id = setInterval(() => { if (AppState.currentState === "active") check(); }, 60000);
    return () => clearInterval(id);
  }, []);
  const product = route.name === "detail" ? products.find((p) => p.id === route.id) : undefined;
  const toList = () => setRoute({ name: "list" });
  const toCart = () => setRoute({ name: "cart" });
  return (
    <CartProvider>
      <View style={s.root}>
        <StatusBar style="dark" />
        {route.name === "cart" ? <Cart onBack={toList} />
          : product ? <Detail product={product} onBack={toList} onCart={toCart} />
          : <List title="${name}" products={products} onOpen={(id) => setRoute({ name: "detail", id })} onCart={toCart} />}
      </View>
    </CartProvider>
  );
}

const s = StyleSheet.create({ root: { flex: 1, backgroundColor: "#F6F8F7" } });
`;

const SHOP_LIST = `import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { formatPrice } from "../money";

export type Product = { id: string; name: string; price: number; description: string };

export function List({ title, products, onOpen, onCart }: { title: string; products: Product[]; onOpen: (id: string) => void; onCart: () => void }) {
  return (
    <ScrollView contentContainerStyle={s.page}>
      <View style={s.head}>
        <Text style={s.h1} accessibilityRole="header">{title}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Cart" onPress={onCart} style={s.cart}><Text style={s.cartText}>Cart</Text></Pressable>
      </View>
      {products.map((p) => (
        <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={p.name} onPress={() => onOpen(p.id)} style={s.row}>
          <Text style={s.rowText}>{p.name}</Text>
          <Text style={s.price}>{formatPrice(p.price)}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 20, paddingTop: 56, gap: 12 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  h1: { fontSize: 28, fontWeight: "800", color: "#111" },
  cart: { minHeight: 48, justifyContent: "center", paddingHorizontal: 8 }, cartText: { fontSize: 16, fontWeight: "700", color: "#1F4E5F" },
  row: { minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: "#CBD5D1", flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, backgroundColor: "#fff" },
  rowText: { fontSize: 16, fontWeight: "700", color: "#111" },
  price: { fontSize: 16, color: "#111" },
});
`;

const SHOP_DETAIL = `import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useCart } from "../cart";
import { formatPrice } from "../money";
import type { Product } from "./List";

export function Detail({ product, onBack, onCart }: { product: Product; onBack: () => void; onCart: () => void }) {
  const { add } = useCart();
  return (
    <ScrollView contentContainerStyle={s.page}>
      <View style={s.head}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={s.link}><Text style={s.linkText}>Back</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Cart" onPress={onCart} style={s.link}><Text style={s.linkText}>Cart</Text></Pressable>
      </View>
      <Text style={s.h1} accessibilityRole="header">{product.name}</Text>
      <Text style={s.price}>{formatPrice(product.price)}</Text>
      <Text style={s.body}>{product.description}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Add to cart" onPress={() => add(product.id)} style={s.add}><Text style={s.addText}>Add to cart</Text></Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 20, paddingTop: 56, gap: 12 },
  head: { flexDirection: "row", justifyContent: "space-between" },
  link: { minHeight: 48, justifyContent: "center" }, linkText: { fontSize: 16, fontWeight: "700", color: "#1F4E5F" },
  h1: { fontSize: 24, fontWeight: "800", color: "#111" },
  price: { fontSize: 18, fontWeight: "700", color: "#111" },
  body: { fontSize: 16, lineHeight: 24, color: "#111" },
  add: { minHeight: 48, borderRadius: 10, backgroundColor: "#1F4E5F", alignItems: "center", justifyContent: "center" }, addText: { fontSize: 16, fontWeight: "700", color: "#fff" },
});
`;

const SHOP_CART = `import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useCart } from "../cart";
import { formatPrice } from "../money";
import products from "../data/products.json";

export function Cart({ onBack }: { onBack: () => void }) {
  const { lines, remove, totalCents } = useCart();
  return (
    <ScrollView contentContainerStyle={s.page}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={s.back}><Text style={s.backText}>Back</Text></Pressable>
      <Text style={s.h1} accessibilityRole="header">Cart</Text>
      {lines.length === 0 ? <Text style={s.body}>Your cart is empty</Text> : null}
      {lines.map((l) => {
        const p = products.find((x) => x.id === l.id);
        if (!p) return null;
        return (
          <View key={l.id} style={s.row}>
            <Text style={s.body}>{p.name} x {l.qty}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={"Remove " + p.name} onPress={() => remove(l.id)} style={s.remove}><Text style={s.backText}>Remove</Text></Pressable>
          </View>
        );
      })}
      <Text style={s.total}>{"Total: " + formatPrice(totalCents)}</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 20, paddingTop: 56, gap: 12 },
  back: { minHeight: 48, justifyContent: "center" }, backText: { fontSize: 16, fontWeight: "700", color: "#1F4E5F" },
  h1: { fontSize: 24, fontWeight: "800", color: "#111" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  remove: { minHeight: 48, justifyContent: "center" },
  body: { fontSize: 16, color: "#111" },
  total: { fontSize: 20, fontWeight: "800", color: "#111" },
});
`;

const SHOP_TEST = `// Runs the app in the Shipvo simulator. Start it first: npm run sim.
// Names and prices come from src/data/products.json, so editing that file does not break this test.
// Keep product names unique and not a substring of each other: tap(name) fails if two elements match.
// The total is computed with formatPrice from the app, so this test does not check that function.
import { test, expect } from "@shipvo/test/vitest";
import products from "../src/data/products.json";
import { formatPrice } from "../src/money";

test("the list shows every product", async ({ phone }) => {
  for (const p of products) expect(phone).toSee(p.name);
  expect(phone.screen).not.toMatch(/something went wrong|unhandled|exception/i);
});

test("adding two products puts their total in the cart, and Remove takes one out", async ({ phone }) => {
  const [a, b] = products;
  await phone.tap(a.name);
  await phone.waitFor(a.description);
  await phone.tap("Add to cart");
  await phone.tap("Back");
  await phone.waitFor(b.name);
  await phone.tap(b.name);
  await phone.tap("Add to cart");
  await phone.tap("Cart");
  await phone.waitFor("Total: " + formatPrice(a.price + b.price));
  await phone.tap("Remove " + b.name);
  await phone.waitFor("Total: " + formatPrice(a.price));
});
`;
