import { describe, expect, it } from "vitest";
import { createServer } from "node:net";
import { openApp } from "../src/phone.js";

async function closedPort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
  });
}

describe("simulator not running", () => {
  it("says how to start it instead of a raw network error", async () => {
    const sim = `http://127.0.0.1:${await closedPort()}`;
    await expect(openApp({ app: "demo", sim, driver: "phone" })).rejects.toThrow(`Cannot reach the simulator at ${sim}. Start it with: npx shipvo sim`);
  });
});
