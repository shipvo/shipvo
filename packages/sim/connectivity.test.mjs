import test from "node:test";
import assert from "node:assert/strict";
import { initialConnectivity, applyConnectivity, networkOf, describeConnectivity, ConnectivityError } from "./connectivity.mjs";

test("starts online on Wi-Fi; Wi-Fi off falls back to mobile data; both off is offline", () => {
  let c = initialConnectivity();
  assert.deepEqual(networkOf(c), { online: true, type: "wifi" });
  c = applyConnectivity(c, { wifi: false });
  assert.deepEqual(networkOf(c), { online: true, type: "cellular" });
  c = applyConnectivity(c, { mobile_data: false });
  assert.deepEqual(networkOf(c), { online: false, type: "none" });
});

test("airplane mode turns both off, Wi-Fi can come back on and is online, and leaving it restores the radios as they were", () => {
  let c = applyConnectivity(initialConnectivity(), { mobile_data: false });
  c = applyConnectivity(c, { airplane: true });
  assert.deepEqual(describeConnectivity(c), { wifi: false, mobile_data: false, airplane: true, online: false, type: "none" });
  c = applyConnectivity(c, { wifi: true });
  assert.deepEqual(networkOf(c), { online: true, type: "wifi" });
  assert.throws(() => applyConnectivity(c, { mobile_data: true }), (e) => e.code === "airplane_on");
  c = applyConnectivity(c, { airplane: false });
  assert.deepEqual(describeConnectivity(c), { wifi: true, mobile_data: false, airplane: false, online: true, type: "wifi" });
});

test("an offline network profile means no network; bad input is named", () => {
  assert.deepEqual(networkOf(initialConnectivity(), "offline"), { online: false, type: "none" });
  assert.throws(() => applyConnectivity(initialConnectivity(), {}), ConnectivityError);
  assert.throws(() => applyConnectivity(initialConnectivity(), { wifi: "off" }), (e) => e.code === "bad_value");
});
