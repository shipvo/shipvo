// A failing content request shows up in the update log on the About screen. The request is made to return 500 with phone.mockNetwork.
import { test, expect } from "@shipvo/test/vitest";

test("a 500 from the content request shows an error in the update log", async ({ phone }) => {
  await phone.mockNetwork([{ url: /\/c\/[^/]+\/content\.json$/, status: 500, body: { error: "down" } }]);
  await phone.tap("About this build");
  await phone.tap("Check for update now");
  await phone.waitFor("Content check failed: HTTP 500");
  expect(phone).toSee("Update log");
  await phone.clearNetworkMocks();
});
