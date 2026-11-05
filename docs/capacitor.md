# Capacitor

## Build and submit with your own Expo account

`shipvo eas setup` makes a Capacitor repo ready for `eas build` and `eas submit` on Android and iOS. It uses your own Expo account and your own store credentials. Shipvo writes files and never sees your Expo token.

Please read Expo's acceptable use policy before you use EAS Build for a Capacitor app, and check that your plan allows it: https://expo.dev/terms (see the AUP note in epic #297). Expo's custom build docs: https://docs.expo.dev/custom-builds/get-started/ and https://docs.expo.dev/custom-builds/schema/.

Run it in the repo root. It needs `capacitor.config.*` and an `android/` or `ios/App/App.xcodeproj` folder, and refuses anything else.

```bash
shipvo eas setup --dry-run   # print every file it would write
shipvo eas setup             # write them
shipvo eas setup --run       # write them, then run `eas init` and `eas build:version:set -p ios`
```

What it writes (existing files are kept; running it twice changes nothing):

- `eas.json`: profiles `shipvo-android` (image `latest`) and `shipvo-ios` (image `macos-tahoe-26.5-xcode-26.6`, Node 22), plus matching `submit` profiles. Your own settings in `eas.json` are not changed.
- `.eas/build/android.yml`: JDK 21 install, web build, `npx cap sync android`, `eas/inject_android_credentials`, `eas/run_gradle :app:bundleRelease`.
- `.eas/build/ios.yml`: web build, `npx cap sync ios`, EAS credential steps, `xcodebuild archive` with distribution signing.
- `ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme`, the shared scheme, if it is missing.
- A `.gitignore` line for `ios/App.xcodeproj`.

### The scheme link

EAS looks for the Xcode project at `ios/*.xcodeproj`, but Capacitor puts it at `ios/App/App.xcodeproj`. Build with `shipvo eas build`. It creates the link `ios/App.xcodeproj -> App/App.xcodeproj` when it is missing, then runs `eas build` with your arguments. The link is git-ignored. Do not commit it.

```bash
shipvo eas build -p ios --profile shipvo-ios
shipvo eas build -p android --profile shipvo-android
```

### One-time steps

```bash
npx eas init
npx eas build:version:set -p ios
```

Then `npx eas submit -p ios --profile shipvo-ios` (or `-p android`) after a build finishes.

The generated YAML has not been run against a live Expo account in this repo yet. Treat the first build as the check, and edit the YAML if a step name differs in your EAS CLI version.
