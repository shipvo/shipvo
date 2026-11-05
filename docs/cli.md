# CLI

## Adopt a bare React Native app

A bare app has committed `ios/` and `android/` folders and no Expo prebuild. `@shipvo/runtime` is an Expo module, so the app needs Expo Modules, and the trust root must be written into the native files by hand. The prebuild config plugin does this for Expo apps; for a bare app the CLI does it directly.

1. **Expo Modules.** The app needs the `expo` package plus the Expo setup in `MainApplication` and `AppDelegate`. If any is missing, the plan lists `npx install-expo-modules@latest`. It runs only after you confirm (or pass `--yes`).
2. **iOS.** Sets `ShipvoBaseURL`, `ShipvoPublicKey`, `ShipvoAppId` and `ShipvoShellMajor` (and, if given, `ShipvoHermesBytecodeVersions` and `ShipvoNativeModules`) in the app target's `Info.plist`. The file is found from the Xcode project, or `ios/<name>/Info.plist`. Other keys keep their values and order. The file is rewritten by a plist parser, so its whitespace may change on the first run.
3. **Android.** Adds or updates the `dev.shipvo.*` `<meta-data>` items inside `<application>` in `android/app/src/main/AndroidManifest.xml`. Nothing else in the file changes.
4. **Next steps.** `cd ios && pod install`, rebuild both apps, then `shipvo publish --dry-run`.

Running it twice changes nothing. The values match what `packages/runtime/app.plugin.js` writes for the same options; a test checks this.

The functions are in `packages/cli/src/adopt-bare.ts`. Wiring them into `shipvo init` adopt mode (with the plan, `--dry-run` and confirmation from #199) follows once #199 is on `main`.
