// Shipvo config plugin: puts the trust root and control-plane address in the native shell (AndroidManifest
// meta-data, and expo.extra.shipvo for platforms without the OTA runtime), so an over-the-air bundle can never
// change which key it is verified against.
const { withAndroidManifest, withInfoPlist, AndroidConfig } = require("expo/config-plugins");

// Returns the comma list for the Hermes bytecode versions, or undefined when the prop is omitted.
function formatBytecodeVersions(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("@shipvo/runtime: hermesBytecodeVersions must be an array of integers");
  for (const v of value) {
    if (!Number.isInteger(v) || v < 0) {
      throw new Error(`@shipvo/runtime: hermesBytecodeVersions must be non-negative integers, got ${JSON.stringify(v)}`);
    }
  }
  return value.join(",");
}

// Returns "name@version,..." for the native modules, or undefined when the prop is omitted.
function formatNativeModules(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("@shipvo/runtime: nativeModules must be an object of package name to version");
  }
  return Object.entries(value)
    .map(([name, version]) => {
      if (!name.trim()) throw new Error("@shipvo/runtime: nativeModules has an empty package name");
      if (typeof version !== "string" || !version.trim()) {
        throw new Error(`@shipvo/runtime: nativeModules version for "${name}" must be a non-empty string`);
      }
      if (/[,\s]/.test(version) || /[,\s]/.test(name)) {
        throw new Error(`@shipvo/runtime: nativeModules entry "${name}": "${version}" has a comma or space where it cannot`);
      }
      return `${name}@${version}`;
    })
    .join(",");
}

module.exports = function withShipvo(config, props) {
  const { baseUrl, publicKey, appId, shellMajor = 1 } = props || {};
  if (!baseUrl || !publicKey || !appId) throw new Error("@shipvo/runtime: baseUrl, publicKey and appId are required");
  const hbc = formatBytecodeVersions(props.hermesBytecodeVersions);
  const nm = formatNativeModules(props.nativeModules);
  config.extra = { ...(config.extra ?? {}), shipvo: { baseUrl, appId, shellMajor } };
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.ShipvoBaseURL = baseUrl;
    cfg.modResults.ShipvoPublicKey = publicKey;
    cfg.modResults.ShipvoAppId = appId;
    cfg.modResults.ShipvoShellMajor = String(shellMajor);
    if (hbc !== undefined) cfg.modResults.ShipvoHermesBytecodeVersions = hbc;
    if (nm !== undefined) cfg.modResults.ShipvoNativeModules = nm;
    return cfg;
  });
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    const set = (name, value) => AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, name, String(value));
    set("dev.shipvo.BASE_URL", baseUrl);
    set("dev.shipvo.PUBLIC_KEY", publicKey);
    set("dev.shipvo.APP_ID", appId);
    set("dev.shipvo.SHELL_MAJOR", shellMajor);
    if (hbc !== undefined) set("dev.shipvo.HERMES_BYTECODE_VERSIONS", hbc);
    if (nm !== undefined) set("dev.shipvo.NATIVE_MODULES", nm);
    return cfg;
  });
};
