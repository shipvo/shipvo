import { describe, it, expect } from "vitest";
import { negotiateProtocolHeader, SUPPORTED_PROTOCOLS } from "../src/protocol";

describe("negotiateProtocolHeader", () => {
  it("replaces a version the server does not know with the newest it speaks", () => {
    const h = new Headers({ "mcp-protocol-version": "2026-07-28" });
    negotiateProtocolHeader(h);
    expect(h.get("mcp-protocol-version")).toBe(SUPPORTED_PROTOCOLS[0]);
  });
  it("keeps every version it does speak", () => {
    for (const v of SUPPORTED_PROTOCOLS) {
      const h = new Headers({ "mcp-protocol-version": v });
      negotiateProtocolHeader(h);
      expect(h.get("mcp-protocol-version")).toBe(v);
    }
  });
  it("adds nothing when the client sent no version", () => {
    const h = new Headers();
    negotiateProtocolHeader(h);
    expect(h.has("mcp-protocol-version")).toBe(false);
  });
});
