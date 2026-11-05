// Tests set `globalThis.__native` before they import the runtime.
export const requireOptionalNativeModule = () => (globalThis as any).__native;
