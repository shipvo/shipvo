// Shipvo config plugin: puts the trust root and control-plane address in the native shell (AndroidManifest
// meta-data, and expo.extra.shipvo for platforms without the OTA runtime), so an over-the-air bundle can never
// change which key it is verified against.
const { withAndroidManifest, withInfoPlist, AndroidConfig } = require("expo/config-plugins");

function validateHermesBytecodeVersions(versions) {
  if (versions == null) return null;
  if (!Array.isArray(versions)) throw new Error("@shipvo/runtime: hermesBytecodeVersions must be an array of integers");
  if (versions.length === 0) throw new Error("@shipvo/runtime: hermesBytecodeVersions must not be empty");
  for (const v of versions) {
    if (!Number.isInteger(v) || v <= 0) throw new Error("@shipvo/runtime: hermesBytecodeVersions must contain positive integers only");
  }
  return [...new Set(versions)].join(",");
}

function validateNativeModules(mods) {
  if (mods == null) return null;
  if (typeof mods !== "object" || Array.isArray(mods)) throw new Error("@shipvo/runtime: nativeModules must be an object");
  const entries = [];
  for (const [name, version] of Object.entries(mods)) {
    if (!name || /\s/.test(name) || name.includes(",")) throw new Error("@shipvo/runtime: nativeModules package name must be a non-empty string without whitespace or commas");
    if (typeof version !== "string" || !version || /\s/.test(version) || version.includes(",")) throw new Error("@shipvo/runtime: nativeModules version must be a non-empty string without whitespace or commas");
    entries.push(`${name}@${version}`);
  }
  return entries.join(",");
}

module.exports = function withShipvo(config, props) {
  const { baseUrl, publicKey, appId, shellMajor = 1, hermesBytecodeVersions, nativeModules } = props || {};
  if (!baseUrl || !publicKey || !appId) throw new Error("@shipvo/runtime: baseUrl, publicKey and appId are required");
  const hbc = validateHermesBytecodeVersions(hermesBytecodeVersions);
  const nm = validateNativeModules(nativeModules);
  config.extra = { ...(config.extra ?? {}), shipvo: { baseUrl, appId, shellMajor } };
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.ShipvoBaseURL = baseUrl;
    cfg.modResults.ShipvoPublicKey = publicKey;
    cfg.modResults.ShipvoAppId = appId;
    cfg.modResults.ShipvoShellMajor = String(shellMajor);
    if (hbc != null) cfg.modResults.ShipvoHermesBytecodeVersions = hbc;
    if (nm != null) cfg.modResults.ShipvoNativeModules = nm;
    return cfg;
  });
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    const set = (name, value) => AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, name, String(value));
    set("dev.shipvo.BASE_URL", baseUrl);
    set("dev.shipvo.PUBLIC_KEY", publicKey);
    set("dev.shipvo.APP_ID", appId);
    set("dev.shipvo.SHELL_MAJOR", shellMajor);
    if (hbc != null) set("dev.shipvo.HERMES_BYTECODE_VERSIONS", hbc);
    if (nm != null) set("dev.shipvo.NATIVE_MODULES", nm);
    return cfg;
  });
};
