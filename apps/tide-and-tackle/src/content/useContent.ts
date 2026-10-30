// Live content: bundled default, then the cached copy, then the latest published version from the control plane.
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { DEFAULT_CONTENT } from "../domain/catalog";
import { setContent } from "../domain/shop";
import type { AppContent } from "./types";

type Store = { read(): string | null; write(s: string): void };
function cacheStore(): Store {
  if (Platform.OS === "web") return { read: () => { try { return globalThis.localStorage?.getItem("pn.content") ?? null; } catch { return null; } }, write: (s) => { try { globalThis.localStorage?.setItem("pn.content", s); } catch {} } };
  try {
    // expo-file-system ships inside the Expo shell, so this needs no new native code.
    const { File, Paths } = require("expo-file-system");
    const f = new File(Paths.document, "purenative-content.json");
    return { read: () => (f.exists ? f.textSync() : null), write: (s) => { f.write(s).catch?.(() => {}); } };
  } catch { return { read: () => null, write: () => {} }; }
}

/** Never apply content that would break rendering: a bad publish or a mangled response keeps the last good copy. */
export function isUsableContent(c: unknown): c is AppContent {
  const x = c as AppContent;
  return !!x && typeof x === "object" && typeof x.version === "number" && !!x.theme && /^#[0-9A-Fa-f]{6}$/.test(x.theme.accent ?? "")
    && !!x.brand && typeof x.brand.name === "string" && Array.isArray(x.products) && Array.isArray(x.departments)
    && Array.isArray(x.promos) && Array.isArray(x.slots) && !!x.screens && Array.isArray(x.screens.home)
    && x.screens.home.every((b) => b && typeof b.id === "string" && typeof b.type === "string");
}

export function useContent(baseUrl: string | undefined, appId: string | undefined) {
  const store = useRef<Store>(cacheStore());
  const [content, setC] = useState<AppContent>(() => {
    try { const cached = store.current.read(); if (cached) { const c = JSON.parse(cached); if (isUsableContent(c) && c.version >= DEFAULT_CONTENT.version) { setContent(c); return c; } } } catch {}
    setContent(DEFAULT_CONTENT); return DEFAULT_CONTENT;
  });
  const versionRef = useRef(content.version);

  const refresh = useCallback(async (): Promise<{ changed: boolean; version: number; ms: number }> => {
    const t0 = Date.now();
    if (!baseUrl || !appId) return { changed: false, version: versionRef.current, ms: 0 };
    try {
      const r = await fetch(`${baseUrl}/c/${appId}/content.json`, { headers: { "If-None-Match": `"${versionRef.current}"` } });
      if (r.status !== 200) return { changed: false, version: versionRef.current, ms: Date.now() - t0 };
      const text = await r.text(); const c = JSON.parse(text);
      if (!isUsableContent(c) || c.version <= versionRef.current) return { changed: false, version: versionRef.current, ms: Date.now() - t0 };
      versionRef.current = c.version; setContent(c); setC(c); store.current.write(text);
      return { changed: true, version: c.version, ms: Date.now() - t0 };
    } catch { return { changed: false, version: versionRef.current, ms: Date.now() - t0 }; }
  }, [baseUrl, appId]);

  return { content, refresh };
}
