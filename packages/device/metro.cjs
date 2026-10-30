// Metro helper: in a Liveo simulator build (platform web with PN_SIM=1), route raw Expo native-module imports
// to the simulated device, so apps that import expo-camera / expo-location directly still run in the simulator.
const path = require("node:path");
const SHIMS = { "expo-camera": "camera", "expo-location": "location", "expo-local-authentication": "auth", "expo-notifications": "notifications", "expo-clipboard": "clipboard", "expo-sharing": "share" };
module.exports = function withLiveoSim(config) {
  const prev = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (ctx, moduleName, platform) => {
    if (platform === "web" && process.env.PN_SIM && SHIMS[moduleName]) return { type: "sourceFile", filePath: path.join(__dirname, "src", "shims", `${SHIMS[moduleName]}.ts`) };
    return prev ? prev(ctx, moduleName, platform) : ctx.resolveRequest(ctx, moduleName, platform);
  };
  return config;
};
