// Monorepo Metro config, plus the Shipvo simulator aliases (PN_SIM=1 web builds use the simulated device).
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");
const withShipvoSim = require("@shipvo/device/metro");
const root = path.resolve(__dirname, "../..");
const config = getDefaultConfig(__dirname);
config.watchFolders = [root];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules"), path.resolve(root, "node_modules")];
// The sources import "./engine.js" (ES module style); Metro needs to find engine.ts.
const sim = withShipvoSim(config);
const inner = sim.resolver.resolveRequest;
sim.resolver.resolveRequest = (context, name, platform) => {
  const resolve = inner ?? ((c, n, p) => c.resolveRequest(c, n, p));
  if (name.startsWith(".") && name.endsWith(".js")) {
    try { return resolve(context, name.slice(0, -3), platform); } catch { /* fall through */ }
  }
  return resolve(context, name, platform);
};
module.exports = sim;
