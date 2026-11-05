# Store details

`shipvo store details --dry-run` shows what Google Play and the App Store will ask about your app, from what `shipvo.json` already declares.

```bash
cd myshop
npx shipvo store details --dry-run --out store-details
```

It prints the Data safety answers it could fill in, and a list of questions you must answer yourself. It writes two files to `--out` (default `store-details`):

- `data-safety.csv`: derived answers in the Play Data safety import format.
- `privacy-policy.md`: a draft policy. It names only the data your capabilities declare, and starts with a "Review before publishing" note. It is not legal advice.

The input is `listing.capabilities` in `shipvo.json`:

| Capability | Result |
| --- | --- |
| `contacts`, `location`, `camera`, `payments`, `notifications` | A Data safety row, plus a question on whether the data leaves the device |
| `biometrics`, `share`, `clipboard`, `network` | No data collected by the app |
| anything else | Listed as unknown. Nothing is guessed |

Nothing is uploaded and no store credentials are read. Without `--dry-run` the command exits 2. See [`@shipvo/store`](../packages/store/README.md) for the API.
