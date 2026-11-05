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

See the package: [`packages/store`](../packages/store/README.md).
