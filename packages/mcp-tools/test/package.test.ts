// The package is published: it must be public, ship only built code, and its README example must run.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { describeTools, tools } from "../src/index.js";

const root = resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

describe("@shipvo/mcp-tools as a published package", () => {
  it("is public, licensed and ships dist and the README only", () => {
    expect(pkg.private).toBeUndefined();
    expect(pkg.publishConfig.access).toBe("public");
    expect(pkg.license).toBe("Apache-2.0");
    expect(pkg.files).toEqual(["dist", "README.md"]);
    expect(pkg.repository.directory).toBe("packages/mcp-tools");
    expect(pkg.keywords.length).toBeGreaterThan(0);
  });
  it("the README says how to install it and its example holds", () => {
    const readme = readFileSync(resolve(root, "README.md"), "utf8");
    expect(readme).toContain("npm install @shipvo/mcp-tools");
    expect(tools.tap.name).toBe("tap");
    expect(tools.owner_command.needsApproval).toBe(true);
    expect(describeTools().every((t) => typeof t.inputSchema === "object")).toBe(true);
    expect(z.object(tools.open_app.input).safeParse({ app: "myshop", model: "iPhone 16 Pro" }).success).toBe(true);
  });
});
