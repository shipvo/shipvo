# Store details

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

## Screenshots (fast mode)

`shipvo store screenshots [--out dir]` renders each route of your app at each store size and checks every file. It prints "fast mode: simulator render, not the native UI". It draws the web build in `sim-dist` (the one `shipvo sim` serves) in headless Chromium, so fonts, safe areas and native controls can differ from a phone. Store mode (capture on an emulator or the iOS Simulator, with the native UI) is a later slice.

Needs `sim-dist` (run `shipvo sim` once) and `playwright` installed in the app, as for `shipvo sim`.

- Screens: `routes` in `shipvo.json`, a list of paths such as `["/", "/cart"]`. Default is `["/"]`. Each must be a path starting with `/`; anything else exits 2.
- Too few screens: with fewer routes than a set needs (Play needs 2), the command prints "needs N screens" as a note and does not fail, so a fresh app exits 0. Too many (over 10 for Apple, over 8 for Play) is a failure.
- Output: `store-assets/raw/<set>/<route>.jpg`. JPEG is used because it can never carry an alpha channel.
- Nothing is uploaded and no store credentials are read.

| Set | Size | Count |
|---|---|---|
| `iphone-1206x2622`, `iphone-1179x2556` | exact | 1 to 10 |
| `ipad-2064x2752`, `ipad-2048x2732` | exact | 1 to 10 |
| `play-phone` | at least 1080x1920, 9:16, each side up to 3840 px | 2 to 8 |
| `play-tablet-7`, `play-tablet-10` | each side 1080 to 7680 px, 9:16 or 16:9 (we render 1080x1920 and 1440x2560) | 2 to 8 |
| `play-feature` | exactly 1024x500 | 1 (first route) |
| `play-icon` | exactly 512x512 | 1 |

The checker (`checkScreenshot` in `@shipvo/store`) fails a file with the wrong size, an alpha channel, or a type other than PNG or JPEG, and fails a set with the wrong count. The Play icon is your own file: it is checked at `listing.icon` if present, never drawn. Exit code is 1 if any check fails.

The sizes come from the Apple and Google Play spec pages named in `packages/store/src/screenshots.ts`. Check them before you submit; the stores change them. The Play tablet rule (1,080 to 7,680 px, 9:16 or 16:9) and the phone rule (9:16, 1080x1920 or more, sides 320 to 3840 px) follow the Play page. Not checked yet: text outside the app on tablet shots, which Google may crop. The feature graphic is a placeholder render of the first route; replace it with your own artwork.

See the package: [`packages/store`](../packages/store/README.md).
