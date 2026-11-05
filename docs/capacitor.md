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

The template stops at the signed files. Download them from the run's artifacts and upload them with Play Console and Transporter, or add your own upload step. It uses the certificate and profile route, not an App Store Connect API key.
