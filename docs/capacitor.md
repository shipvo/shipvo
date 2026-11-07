# Build a Capacitor app in your own GitHub Actions

Shipvo gives you a workflow that builds signed Android and iOS binaries in your own repository. You do not need EAS.

## Add the workflow

From the root of your Capacitor repo:

```bash
npx shipvo ci init --framework capacitor
```

This writes `.github/workflows/shipvo-build.yml`. Use `--dry-run` to print it without writing. Use `--force` to overwrite an existing file.

The workflow runs by hand (Actions tab, "Shipvo build", Run workflow) and on tags that start with `v`. It needs `npm run build` to produce your web build, and an `android/` and `ios/` folder in the repo.

## Add the secrets

In GitHub: Settings, Secrets and variables, Actions, New repository secret. The workflow never contains secret values; it reads them from here.

### Android

Create an upload keystore if you do not have one, then encode it:

```bash
base64 -i upload.keystore | pbcopy        # macOS
base64 -w0 upload.keystore                # Linux
```

| Secret | What it is |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | The keystore file, base64 encoded |
| `ANDROID_KEYSTORE_PASSWORD` | The keystore password |
| `ANDROID_KEY_ALIAS` | The key alias inside the keystore |
| `ANDROID_KEY_PASSWORD` | The key password |

The output is a signed `.aab` in the `android-release` artifact.

### iOS

You need an Apple Distribution certificate exported as a `.p12` file, and an App Store provisioning profile. Encode both with `base64`.

| Secret | What it is |
| --- | --- |
| `IOS_CERTIFICATE_BASE64` | The `.p12` certificate, base64 encoded |
| `IOS_CERTIFICATE_PASSWORD` | The password you set when you exported the `.p12` |
| `IOS_PROFILE_BASE64` | The `.mobileprovision` file, base64 encoded |
| `IOS_PROFILE_NAME` | The profile's name in the Apple developer portal |
| `IOS_TEAM_ID` | Your 10-character Apple team ID |
| `IOS_BUNDLE_ID` | Your app's bundle ID, for example `com.example.app` |
| `IOS_KEYCHAIN_PASSWORD` | Any password; the runner uses it for a temporary keychain |

If your Xcode scheme is not `App`, add a repository variable (not a secret) named `IOS_SCHEME`.

The output is a signed `.ipa` in the `ios-release` artifact.

## Upload to the stores

The iOS job has not been run on a macOS runner in this repo yet; the template is checked by a parse test only. Your first run is the check.

The template stops at the signed files. Download them from the run's artifacts and upload them with Play Console and Transporter, or add your own upload step. It uses the certificate and profile route, not an App Store Connect API key.

---

# Build and submit with your own Expo account

`shipvo eas setup` makes a Capacitor repo ready for `eas build` and `eas submit` on Android and iOS. It uses your own Expo account and your own store credentials. Shipvo writes files and never sees your Expo token.

Please read Expo's acceptable use policy before you use EAS Build for a Capacitor app, and check that your plan allows it: https://expo.dev/terms. Expo's terms limit what you may build with EAS Build, and Shipvo cannot check that for you. Expo's custom build docs: https://docs.expo.dev/custom-builds/get-started/ and https://docs.expo.dev/custom-builds/schema/.

Run it in the repo root. It needs `capacitor.config.*` and an `android/` or `ios/App/App.xcodeproj` folder, and refuses anything else.

```bash
shipvo eas setup --dry-run   # print every file it would write
shipvo eas setup             # write them
shipvo eas setup --run       # write them, then run `eas-cli init` and `eas-cli build:version:set -p ios`
```

What it writes (existing files are kept; running it twice changes nothing):

- `eas.json`: profiles `shipvo-android` (image `latest`) and `shipvo-ios` (image `macos-tahoe-26.5-xcode-26.6`, Node 22), plus matching `submit` profiles. Your own settings in `eas.json` are not changed, but the file is written back with 2-space indentation, so its formatting may change on the first run.
- `.eas/build/android.yml`: JDK 21 install, web build, `npx cap sync android`, `eas/inject_android_credentials`, `eas/run_gradle :app:bundleRelease`.
- `.eas/build/ios.yml`: web build, `npx cap sync ios`, the EAS credential steps (`eas/resolve_apple_team_id_from_credentials`, `eas/configure_ios_credentials`), `ExportOptions.plist` written in a YAML step (method `app-store`, team id from `eas/resolve_apple_team_id_from_credentials`), then `xcodebuild archive` and export with distribution signing. Every `eas/` step is one of [EAS's built-in functions](https://docs.expo.dev/custom-builds/schema/#built-in-eas-functions), and a test checks that.
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
npx eas-cli init
npx eas-cli build:version:set -p ios
```

Then `npx eas-cli submit -p ios --profile shipvo-ios` (or `-p android`) after a build finishes.

The generated YAML has not been run against a live Expo account in this repo yet. Treat the first build as the check, and edit the YAML if a step name differs in your EAS CLI version.
