# Setup details

- Needs an Expo app (`expo` in `package.json` and an `app.json` or `app.config.js/ts`) or a bare React Native app.
- With `app.config.js` or `app.config.ts`, `shipvo init` prints the lines to add to `plugins` instead of editing your code.
- Bare apps: `init` can run `npx install-expo-modules@latest` and edits `AndroidManifest.xml` and `Info.plist`. Then run `cd ios && pod install` and rebuild.
- Running `shipvo init` again changes nothing.
- `init` adds a publish workflow that runs by hand only. Nothing ships to phones by surprise.
- Full guide: `docs/cli.md` in the Shipvo repo.
