// The same app, tested with plain-language lines (see cart.steps.txt) instead of typed calls.
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { openApp, parseSteps, runSteps } from "@shipvo/test";

test("plain-language cart flow: open the cart, go to checkout, come back", async () => {
  const phone = await openApp({ seedCart: [{ product_id: "rod-surf-36", quantity: 1 }] });
  await runSteps(phone, parseSteps(readFileSync(new URL("./cart.steps.txt", import.meta.url), "utf8")));
});
