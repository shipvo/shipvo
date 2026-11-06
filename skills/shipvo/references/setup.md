# Setup details

- Needs an Expo app (`expo` in `package.json` and an `app.json` or `app.config.js/ts`) or a bare React Native app.
- With `app.config.js` or `app.config.ts`, `shipvo init` prints the lines to add to `plugins` instead of editing your code.
- Bare apps: `init` can run `npx install-expo-modules@latest` and edits `AndroidManifest.xml` and `Info.plist`. Then run `cd ios && pod install` and rebuild.
- Running `shipvo init` again changes nothing.
- `init` adds a publish workflow that runs by hand only. Nothing ships to phones by surprise.
- Full guide: `docs/cli.md` in the Shipvo repo.
- `--json` on `init`, `login`, `audit` and `keys` (status, export, import, rotate) prints one envelope on stdout: `{ ok, code, summary, data, next }`. Exit 0 ok, 1 failed, 2 usage error. Run the first command in `next`.
- `init --json` gives `code` `created` (or `adopted`, `dry_run`) and `data` `{ mode, app_id, public_key, seed_file }`; `seed_file` is a path, never the seed. In an existing app it needs `--yes` or `--dry-run`. After it: `npm install`, `npx shipvo run android`, `npx shipvo publish --json`.
- `login --json` shows the device URL and code on stderr, then waits; the final `data.device` repeats `{ verification_uri, user_code }`. Show them to the person. `data` has `key_prefix`, never the key.
- `keys export --json` needs `--out <file>`. Failure codes: `usage`, `no_project`, `not_signed_in`, `key_expired`, `no_seed`, `seed_mismatch`, `invalid_seed`, `no_credentials`, `auth_failed`, `remote_failed`, `login_failed`, `rotate_failed`. All codes: `docs/cli.md`.
