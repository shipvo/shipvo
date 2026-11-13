# busy-apply

Applies a staged update many times while the JS thread is busy, and checks that a native module's global state survives every reload. It runs on the Android emulator and the iOS Simulator and is started by `.github/workflows/busy-apply-reload.yml`.

```bash
pnpm --filter "@shipvo/cli..." build
node scripts/busy-apply/run.mjs --platform android --applies 50 --out busy-apply-android.json
```

- `native/` is a small Expo module, `BusyState`. Its state is set when the module is created and cleared when it is destroyed on a reload. The harness copies it into `apps/tide-and-tackle/modules/` for the build and removes it afterwards, together with its other temporary edits to `app.json` and `index.ts`.
- The app reports the state twice after every load (1.5 s and 5 s) and runs a loop that keeps the JS thread about 80% busy.
- Two bundles that differ in bytes are exported once and published as releases 1 to N in turn. The release number in each report comes from the runtime.
- Output: `{"platform","applies","crashes","reloadMs":[...],"emptyModuleState":<n>}`, plus `timeouts` and `completed`. `reloadMs` runs from the runtime's "staged" telemetry to the first report of the new load.
- Exit codes: 0 clean, 1 module state was empty after a reload, 2 crash or timeout, 3 setup error.

Tests for the pure parts: `node --test scripts/busy-apply/*.test.mjs`.
