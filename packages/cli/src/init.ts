// `shipvo init <dir>`: a new Expo app wired to Shipvo: signed OTA runtime + plugin, the device API, the simulator,
// a publish workflow and a shipvo.json. Everything an agent needs to open it is in place on the first commit.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { b64, keyFromSeed } from "./index.js";
import { args as parse } from "./config.js";

const HOSTED = "https://purenative-control.purenative.workers.dev";
const SDK = { expo: "~58.0.21", camera: "~58.0.14", clipboard: "~58.0.4", localAuth: "~58.0.2", location: "~58.0.20", notifications: "~58.1.7", statusBar: "~58.0.4", constants: "~58.0.0", metroRuntime: "~58.0.15", react: "19.3.0", rn: "0.88.1", rnw: "^0.21.4" };

const title = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export async function init(argv: string[]) {
  const [dirArg] = argv.filter((x) => !x.startsWith("--") && !argv[argv.indexOf(x) - 1]?.startsWith("--"));
  const a = parse(argv);
  if (!dirArg) { console.error("Usage: shipvo init <dir> [--app-id myshop] [--name \"My Shop\"] [--control-plane URL] [--public-key B64] [--bundle-id com.example.myshop]"); process.exit(2); }
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

  w("shipvo.json", JSON.stringify({ appId, name, shellMajor: 1, controlPlane, publicKey }, null, 2) + "\n");
  w("package.json", JSON.stringify({
    name: appId, version: "1.0.0", main: "index.ts", private: true,
    scripts: { start: "expo start", android: "expo run:android", ios: "expo run:ios", web: "expo start --web", sim: "shipvo sim", publish: "shipvo publish", rollback: "shipvo rollback", typecheck: "tsc --noEmit" },
    dependencies: {
      "@expo/metro-runtime": SDK.metroRuntime, expo: SDK.expo, "expo-camera": SDK.camera, "expo-clipboard": SDK.clipboard, "expo-constants": SDK.constants,
      "expo-local-authentication": SDK.localAuth, "expo-location": SDK.location, "expo-notifications": SDK.notifications, "expo-status-bar": SDK.statusBar,
      react: SDK.react, "react-dom": SDK.react, "react-native": SDK.rn, "react-native-web": SDK.rnw,
      "@shipvo/device": "^0.1.0", "@shipvo/runtime": "^0.1.0",
    },
    devDependencies: { "@shipvo/cli": "^0.1.0", "@shipvo/sim": "^0.1.0", "@types/react": "~19.3.0", playwright: "^1.63.0", typescript: "~6.0.3" },
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
export const RELEASE = { headline: "Release 1: hello from ${name}.", note: "Edit src/release.ts and push to main." };
`);
  w("App.tsx", APP_TSX(name, appId));
  w(".github/workflows/publish.yml", WORKFLOW);
  w("README.md", README(name, appId, controlPlane));

  console.log(`
Created ${name} in ${dirArg}

  cd ${dirArg}
  npm install                 # or pnpm / bun
  npx playwright install chromium
  npm run sim                 # the app in the simulator on http://localhost:4545
  npx -y @shipvo/mcp          # point Claude / Cursor / ChatGPT at it and open_app("${appId}")

Phones:  npx expo run:android   (needs Android Studio once; the OTA runtime is Android-first)
Publish: shipvo login, then shipvo app create (hosted), or set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and SHIPVO_KV_ID (self-hosted); then npm run publish
         (self-host the control plane from services/control-plane, or ask for a hosted app id during the beta)

${seedNote}
Public key pinned in the shell: ${publicKey}
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
    try { const h = Runtime.markHealthy(); add(\`Running release \${h.release}\`); } catch {}
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
        <Text style={s.muted}>App id ${appId} · shell {state?.shellVersion ?? "none"} · release {state?.runningRelease ?? 0}</Text>
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

const WORKFLOW = `name: publish
on:
  push:
    branches: [main]
    paths: ["src/**", "App.tsx"]
  workflow_dispatch:
jobs:
  publish:
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

const README = (name: string, appId: string, cp: string) => `# ${name}

A [Shipvo](https://github.com/shipvo/shipvo) app: one React Native codebase that people install from the stores and AI agents operate in a simulator, kept current with signed over-the-air releases.

- \`npm run sim\` opens it in the simulator; \`npx -y @shipvo/mcp\` lets Claude, Cursor or ChatGPT use it (\`open_app("${appId}")\`).
- \`npx expo run:android\` builds the native shell (the trust root and control plane \`${cp}\` are pinned in it).
- Push to \`main\`: the publish workflow signs the new JavaScript and every phone and simulator gets it.
- \`src/release.ts\` is the first thing to edit; \`App.tsx\` shows the device API (camera, location, biometrics, notifications).
`;
