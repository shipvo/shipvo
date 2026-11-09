// W3C trace context (SEP-414): read `traceparent` from a tool call's `_meta`. Pure: no I/O.
// `tracestate` and `baggage` are never read, stored or logged.
const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export type Trace = { traceparent: string; traceId: string };

/** Returns the trace for a valid traceparent, else undefined. Bad values are ignored. */
export function parseTraceparent(value: unknown): Trace | undefined {
  if (typeof value !== "string") return undefined;
  const m = TRACEPARENT.exec(value.trim());
  if (!m) return undefined;
  const [, version, traceId, parentId] = m;
  if (version === "ff" || /^0+$/.test(traceId!) || /^0+$/.test(parentId!)) return undefined;
  return { traceparent: value.trim(), traceId: traceId! };
}

export function traceFromMeta(meta: unknown): Trace | undefined {
  return meta && typeof meta === "object" ? parseTraceparent((meta as Record<string, unknown>).traceparent) : undefined;
}
