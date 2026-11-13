// Simulator builds (PN_SIM=1) keep the Android and iOS branches of Platform.OS and Platform.select in the app's own code.
// BUG_BENCH_PHONE_PLATFORM=off builds without that, to measure what it adds.
const phone = process.env.PN_SIM && process.env.BUG_BENCH_PHONE_PLATFORM !== "off";
module.exports = (api) => {
  api.cache.using(() => `${process.env.PN_SIM ?? ""}:${process.env.BUG_BENCH_PHONE_PLATFORM ?? ""}`);
  return { presets: ["babel-preset-expo"], plugins: phone ? ["@shipvo/device/babel"] : [] };
};
