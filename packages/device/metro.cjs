// Metro helper: in a Shipvo simulator build (platform web with PN_SIM=1), route raw Expo native-module imports
// to the simulated device, so apps that import expo-camera / expo-location directly still run in the simulator.
const path = require("node:path");
const SHIMS = { "expo-camera": "camera", "expo-location": "location", "expo-local-authentication": "auth", "expo-notifications": "notifications", "expo-clipboard": "clipboard", "expo-contacts": "contacts", "expo-calendar": "calendar", "expo-document-picker": "document-picker", "expo-sharing": "share" };
// options.nativeFiles: in a simulator build, the app's own relative imports pick `X.native.js` over `X.js`, as they do on a phone.
// A `X.web.js` file still wins. Files in node_modules are not affected.
module.exports = function withShipvoSim(config, options = {}) {
  const prev = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (ctx, moduleName, platform) => {
    if (platform === "web" && process.env.PN_SIM && SHIMS[moduleName]) return { type: "sourceFile", filePath: path.join(__dirname, "src", "shims", `${SHIMS[moduleName]}.ts`) };
    const native = options.nativeFiles === true && platform === "web" && process.env.PN_SIM && moduleName.startsWith(".") && !/[\\/]node_modules[\\/]/.test(ctx.originModulePath || "");
    const c = native ? { ...ctx, preferNativePlatform: true } : ctx;
    return prev ? prev(c, moduleName, platform) : c.resolveRequest(c, moduleName, platform);
  };
  return config;
};
