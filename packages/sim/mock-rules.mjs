// Network mock rules sent by a test (`phone.mockNetwork` in @shipvo/test).
// The wire format here and the encoder in packages/test/src/phone.ts (encodeMockRules) must stay in sync.
// Wire rule: { url: string } or { urlRegex: { source, flags } }, optional method,
// and response: { status, body (string), headers (object of strings), delayMs }.
export class MockRuleError extends Error { constructor(message) { super(message); this.code = "mock_invalid"; } }

export function parseMockRules(raw) {
  if (!Array.isArray(raw)) throw new MockRuleError("mock rules must be an array");
  return raw.map((r, i) => {
    const bad = (why) => new MockRuleError(`mock rule ${i}: ${why}`);
    if (!r || typeof r !== "object") throw bad("must be an object");
    let match;
    if (typeof r.url === "string" && r.url) { const exact = r.url; match = (u) => u === exact; }
    else if (r.urlRegex && typeof r.urlRegex.source === "string") {
      let re; try { re = new RegExp(r.urlRegex.source, String(r.urlRegex.flags ?? "").replace(/[gy]/g, "")); } catch { throw bad("url is not a valid pattern"); }
      match = (u) => re.test(u);
    } else throw bad("url must be a non-empty string or a RegExp");
    if (r.method !== undefined && (typeof r.method !== "string" || !r.method)) throw bad("method must be a non-empty string");
    const resp = r.response;
    if (!resp || typeof resp !== "object") throw bad("response is required");
    if (!Number.isInteger(resp.status) || resp.status < 100 || resp.status > 599) throw bad("status must be an integer from 100 to 599");
    if (typeof resp.body !== "string") throw bad("body must be a string");
    if (resp.delayMs !== undefined && (typeof resp.delayMs !== "number" || !(resp.delayMs >= 0) || resp.delayMs > 60000)) throw bad("delayMs must be a number from 0 to 60000");
    const headers = resp.headers ?? {};
    if (typeof headers !== "object" || Array.isArray(headers) || Object.values(headers).some((v) => typeof v !== "string")) throw bad("headers must be an object of strings");
    return { match, method: r.method?.toUpperCase(), status: resp.status, body: resp.body, headers, delayMs: resp.delayMs ?? 0 };
  });
}
