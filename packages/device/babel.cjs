// Babel plugin for Shipvo simulator builds (web builds with PN_SIM=1). In the app's own files it makes `Platform.OS` and
// `Platform.select` follow the phone the session simulates (android or ios), read when the code runs.
// Expo's production build otherwise replaces `Platform.OS` with "web" and removes the Android and iOS branches,
// so a bug inside one never reaches the simulator. Files in node_modules are left alone: libraries keep their web code.
const PLATFORM = '(globalThis.__PN_SIM__ && globalThis.__PN_SIM__.device && globalThis.__PN_SIM__.device.platform || "android")';

module.exports = function shipvoSimPlatform({ types: t, template }) {
  const active = (state) => !!process.env.PN_SIM && !/[\\/]node_modules[\\/]/.test(state.filename || "");
  const isPlatform = (node, prop) => t.isMemberExpression(node) && !node.computed && t.isIdentifier(node.object, { name: "Platform" }) && t.isIdentifier(node.property, { name: prop });
  // ARG is the only placeholder: without this, Babel reads __PN_SIM__ as one too.
  const select = template.expression(`((o, p) => p in o ? o[p] : "native" in o ? o.native : o.default)(ARG, ${PLATFORM})`, { placeholderPattern: false, placeholderWhitelist: new Set(["ARG"]) });
  return {
    name: "shipvo-sim-platform",
    visitor: {
      MemberExpression(path, state) {
        if (!active(state) || !isPlatform(path.node, "OS")) return;
        if (path.parentPath.isAssignmentExpression({ left: path.node })) return;
        path.replaceWith(template.expression.ast(PLATFORM));
      },
      CallExpression(path, state) {
        if (!active(state) || !isPlatform(path.node.callee, "select") || path.node.arguments.length !== 1) return;
        // The same order React Native uses: the platform's own key, then "native", then "default".
        path.replaceWith(select({ ARG: path.node.arguments[0] }));
      },
    },
  };
};
