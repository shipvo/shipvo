// Shipvo config plugin: puts the trust root and control-plane address in the native shell (AndroidManifest
// meta-data, and expo.extra.shipvo for platforms without the OTA runtime), so an over-the-air bundle can never
// change which key it is verified against.
const { withAndroidManifest, withInfoPlist, AndroidConfig } = require("expo/config-plugins");

module.exports = function withShipvo(config, props) {
  const { baseUrl, publicKey, appId, shellMajor = 1 } = props || {};
  if (!baseUrl || !publicKey || !appId) throw new Error("@shipvo/runtime: baseUrl, publicKey and appId are required");
  config.extra = { ...(config.extra ?? {}), shipvo: { baseUrl, appId, shellMajor } };
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.ShipvoBaseURL = baseUrl;
    cfg.modResults.ShipvoPublicKey = publicKey;
    cfg.modResults.ShipvoAppId = appId;
    cfg.modResults.ShipvoShellMajor = String(shellMajor);
    return cfg;
  });
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    const set = (name, value) => AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, name, String(value));
    set("dev.shipvo.BASE_URL", baseUrl);
    set("dev.shipvo.PUBLIC_KEY", publicKey);
    set("dev.shipvo.APP_ID", appId);
    set("dev.shipvo.SHELL_MAJOR", shellMajor);
    return cfg;
  });
};
