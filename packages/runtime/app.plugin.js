// Shipvo config plugin: puts the trust root and control-plane address in the native shell (AndroidManifest
// meta-data, and expo.extra.shipvo for platforms without the OTA runtime), so an over-the-air bundle can never
// change which key it is verified against.
const { withAndroidManifest, withInfoPlist, AndroidConfig } = require("expo/config-plugins");

function validateHermesBytecodeVersions(versions) {
  if (versions === undefined || versions === null) return;
  if (!Array.isArray(versions)) throw new Error("@shipvo/runtime: hermesBytecodeVersions must be an array");
  for (const v of versions) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`@shipvo/runtime: hermesBytecodeVersions must be non-negative integers, got ${v}`);
  }
}

function validateNativeModules(modules) {
  if (modules === undefined || modules === null) return;
  if (typeof modules !== "object" || Array.isArray(modules)) throw new Error("@shipvo/runtime: nativeModules must be an object");
  for (const [name, version] of Object.entries(modules)) {
    if (!name || typeof name !== "string" || name.trim() === "") throw new Error("@shipvo/runtime: nativeModules keys must be non-empty strings");
    if (typeof version !== "string" || version.trim() === "") throw new Error(`@shipvo/runtime: nativeModules[\"${name}\"] must be a non-empty string version`);
  }
}

function formatHermesBytecodeVersions(versions) {
  return versions.join(",");
}

function formatNativeModules(modules) {
  return Object.entries(modules).map(([name, version]) => `${name}@${version}`).join(",");
}

module.exports = function withShipvo(config, props) {
  const { baseUrl, publicKey, appId, shellMajor = 1, hermesBytecodeVersions, nativeModules } = props || {};
  if (!baseUrl || !publicKey || !appId) throw new Error("@shipvo/runtime: baseUrl, publicKey and appId are required");

  validateHermesBytecodeVersions(hermesBytecodeVersions);
  validateNativeModules(nativeModules);

  config.extra = { ...(config.extra ?? {}), shipvo: { baseUrl, appId, shellMajor, hermesBytecodeVersions, nativeModules } };

  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.ShipvoBaseURL = baseUrl;
    cfg.modResults.ShipvoPublicKey = publicKey;
    cfg.modResults.ShipvoAppId = appId;
    cfg.modResults.ShipvoShellMajor = String(shellMajor);
    if (hermesBytecodeVersions) cfg.modResults.ShipvoHermesBytecodeVersions = formatHermesBytecodeVersions(hermesBytecodeVersions);
    if (nativeModules) cfg.modResults.ShipvoNativeModules = formatNativeModules(nativeModules);
    return cfg;
  });

  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    const set = (name, value) => AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, name, String(value));
    set("dev.shipvo.BASE_URL", baseUrl);
    set("dev.shipvo.PUBLIC_KEY", publicKey);
    set("dev.shipvo.APP_ID", appId);
    set("dev.shipvo.SHELL_MAJOR", shellMajor);
    if (hermesBytecodeVersions) set("dev.shipvo.HERMES_BYTECODE_VERSIONS", formatHermesBytecodeVersions(hermesBytecodeVersions));
    if (nativeModules) set("dev.shipvo.NATIVE_MODULES", formatNativeModules(nativeModules));
    return cfg;
  });
};
