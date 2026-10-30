// Puts the trust root and control-plane address in the native shell (AndroidManifest meta-data),
// so an over-the-air bundle can never change which key it is verified against.
const { withAndroidManifest, AndroidConfig } = require("expo/config-plugins");

module.exports = function withLiveo(config, props) {
  const { baseUrl, publicKey, appId, shellMajor = 1 } = props || {};
  if (!baseUrl || !publicKey || !appId) throw new Error("withLiveo: baseUrl, publicKey and appId are required");
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    const set = (name, value) => AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, name, String(value));
    set("dev.purenative.BASE_URL", baseUrl);
    set("dev.purenative.PUBLIC_KEY", publicKey);
    set("dev.purenative.APP_ID", appId);
    set("dev.purenative.SHELL_MAJOR", shellMajor);
    return cfg;
  });
};
