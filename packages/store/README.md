# @shipvo/store

Work out what Google Play and the App Store will ask about your app, before you are stuck on a form. It reads `shipvo.json` and writes Data safety answers, a draft privacy policy and a list of questions only you can answer. It runs offline. Nothing is uploaded and no credentials are read.

## Install

```bash
npm install @shipvo/store
```

From an app folder you can also run `npx @shipvo/cli store details --dry-run`.

## Example

```ts
import { deriveStoreDetails, renderPrivacyPolicy, dataSafetyCsv } from "@shipvo/store";

const manifest = { appId: "shop", name: "Shop", listing: { capabilities: ["contacts", "location"] } };
const details = deriveStoreDetails(manifest);
console.log(details.rows.map((r) => r.dataType.type));   // ["Contacts", "Precise location"]
console.log(details.unknown.map((u) => u.question));     // what you still have to answer
const policy = renderPrivacyPolicy(details, manifest);   // Markdown
const csv = dataSafetyCsv(details);                      // Data safety CSV
```

## API

- `deriveStoreDetails(manifest)` returns `{ appId, appName, rows, noDataCapabilities, unknown }`. There is one row per declared capability that reads user data (`contacts`, `location`, `camera`, `payments`, `notifications`). `biometrics`, `share`, `clipboard` and `network` read no data and are listed in `noDataCapabilities`. Any other capability is never dropped: it appears in `unknown`. Whether data leaves the device is not in `shipvo.json`, so every row has `shared: "unknown"` and a matching question.
- `renderPrivacyPolicy(details, manifest?)` returns Markdown that names only the declared data. It starts with a "Review before publishing" note, is not legal advice, and marks gaps with `[TO FILL IN]`.
- `dataSafetyCsv(details)` returns CSV with the columns of Play Console's Data safety template. It holds only derived answers. Check the result in Play Console when you import it; the question IDs are written from the template and have not been run against the console from this repo.
- `formatSummary(details)` returns the text the CLI prints.

## CLI

```bash
shipvo store details --dry-run [--out store-details]
```

Writes `data-safety.csv` and `privacy-policy.md` to `--out` and prints the answers and the unknown list. Without `--dry-run` it exits 2: upload is not available yet.
