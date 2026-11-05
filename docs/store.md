# Store details

This page is for developers and founders getting ready to submit to Google Play and the App Store. You will draft the answers the stores ask for and check your screenshot sizes. Nothing is uploaded and no store account is touched.

`shipvo store details --dry-run [--out dir]` drafts what Google Play and the App Store will ask, from `shipvo.json`. This is slice 1 of the store work (#249): it only writes files. Nothing is uploaded and no store credentials are read. Without `--dry-run` the command exits 2 with "upload is not available yet; use --dry-run".

## What it reads

The capabilities in `listing.capabilities` in `shipvo.json`. Names match `@shipvo/device`.

| Capability | Data safety row |
|---|---|
| `camera` | Photos |
| `location` | Precise location |
| `contacts` | Contacts |
| `calendar` | Calendar events |
| `files` | Files and docs |
| `payments` | Payment info |
| `notifications` | Device or other IDs |
| `biometrics`, `share`, `clipboard`, `network` | none |

Any other capability is listed as a question for you. It is never dropped.

## What it writes

- `data-safety.csv`: the derived answers in the Play Data safety import layout. With no data-touching capability, the CSV leaves out the "collects data" answer: sign-in or third-party SDKs may still collect data. Check the column and response ids against the template you export from Play Console before you import.
- `privacy-policy.md`: a draft that names only what the app declares. Review it before you publish. It is not legal advice.

The command prints "Filled without you: x of y fields". That counts only the derived Data safety rows, not the questions list, so it does not mean you are done.

It also prints the questions it cannot answer: whether each data type is shared, third-party SDKs, sign-in, data deletion and a contact address.

## Store setup and status

`shipvo store setup` and `shipvo store status` (slice 2 of #249) tell you which accounts to open and what to do next. They make no store calls and read no credentials.

```bash
shipvo store setup --company no
shipvo store status
shipvo store status --mark play-account
shipvo store status --mark apple-account --as waiting
```

`setup` asks if you have a registered company. In a terminal it asks questions. For agents and CI, pass flags: `--company yes|no`, `--android-now`, `--play-account-before-2023-11-13`. With no flags and no terminal it uses the default: no company. A bad flag value exits 2. It writes `store-plan.json`.

| Situation | Google Play | App Store |
|---|---|---|
| Registered company | Organization account, no tester rule | Organization account (D-U-N-S) |
| No company (default) | Personal account: 12 testers opted in for 14 days in a row before production | Individual account |
| No company, needs Android now | Same as above. There is no faster route yet; the output says so | Same as above |
| Play account made before 13 Nov 2023 | Exempt from the tester rule | Same as above |

The tester rule is shown only for personal Play accounts that are not exempt. Apple has no such rule.

`status` reads `store-plan.json` and prints one timeline per store. Each step is `todo`, `waiting` or `done`, followed by what you do next. `--mark <step>` sets a step to `done`; add `--as waiting` for a wait. With no plan file it says to run `setup`.

## Screenshots (fast mode)

`shipvo store screenshots` renders your app in the simulator and writes store-sized files. It prints "fast mode: simulator render, not the native UI". The simulator runs your web build in headless Chromium, so fonts, safe areas and native widgets can differ from a phone.

```bash
shipvo store screenshots            # builds the app, starts the simulator, renders
shipvo store screenshots --sim http://localhost:4546 --out store-assets/raw
```

It renders the start screen and every entry in `routes` in `shipvo.json` (deep links, as for `shipvo explore`). It does this for each set: iPhone (1290x2796), iPad 13-inch (2064x2752), Play phone (1080x1920), Play 7-inch tablet and Play 10-inch tablet (both 1200x1920). Files go to `store-assets/raw/<set>/NN-<screen>.jpg`, in JPEG so there is no alpha channel. The extension comes from the checker's format result, not from the first byte. A file that is not a PNG or JPEG is kept as `.bin` and reported as failed.

Each file gets the checker result from `@shipvo/store`, then each set gets a count check. If a set takes fewer files than you have screens, the extra screens are skipped and the command says so. The exit code is 1 if any file fails. The Play feature graphic and icon are not app screens and are not made here.

Store mode (native capture on an emulator or simulator) is a later slice. Nothing is uploaded.

The size numbers come from the table in `@shipvo/store` and issue #249. They were not re-checked against the Apple and Play pages when this command was added. Check them before you submit.

See the package: [`packages/store`](../packages/store/README.md).

## Troubleshooting

**`upload is not available yet; use --dry-run`** (exit 2). Upload is not built. Add `--dry-run`.

**A screenshot fails the checker (exit 1).** The command lists the files that failed. Fix those files, then run it again. Check the sizes against the store pages before you submit.

## Next steps

- [CLI guide](cli.md)
- [Frameworks and adapters](adapters.md)
- [Glossary](glossary.md)
