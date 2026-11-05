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

- `data-safety.csv`: the derived answers in the Play Data safety import layout. Check the column and response ids against the template you export from Play Console before you import.
- `privacy-policy.md`: a draft that names only what the app declares. Review it before you publish. It is not legal advice.

It also prints the questions it cannot answer: whether each data type is shared, third-party SDKs, sign-in, data deletion and a contact address.

See the package: [`packages/store`](../packages/store/README.md).
