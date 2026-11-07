# @shipvo/store

Know what Google Play and the App Store will ask before you are stuck on a form. `@shipvo/store` reads the capabilities your app declares in `shipvo.json` and drafts the Play Data safety answers and a privacy policy. It uploads nothing and reads no store credentials.

## Install

```bash
npm install @shipvo/store
```

## Use it from the CLI

```bash
shipvo store details --dry-run [--out dir]
```

It prints the answers and the questions only you can answer, and writes `data-safety.csv` and `privacy-policy.md` to `--out` (default `.shipvo/store`). Without `--dry-run` it exits 2: upload is not available yet.

## Use it from code

```ts
import { deriveStoreDetails, renderDataSafetyCsv, renderPrivacyPolicy } from "@shipvo/store";

const details = deriveStoreDetails({ appId: "shop", name: "Shop", listing: { capabilities: ["contacts", "location"] } });
console.log(details.rows);     // one Data safety row per capability that touches user data
console.log(details.unknown);  // what you must answer yourself
const csv = renderDataSafetyCsv(details);
const policy = renderPrivacyPolicy(details);
```

## API

- `deriveStoreDetails(manifest)`: pure. Returns `{ appId, appName, rows, noDataCapabilities, unknown, fill }`. A row has `capability`, `category`, `dataType`, `collected`, `shared`, `purpose`. Capabilities in the mapping table get a row; `biometrics`, `share`, `clipboard` and `network` get none; any other capability is listed in `unknown`, never dropped. `shared` is always `"unknown"` in this version, because shipvo.json does not say where data goes.
- `renderPrivacyPolicy(details)`: Markdown draft. It names only declared data types and starts with a "review before publishing" note. It is not legal advice.
- `renderDataSafetyCsv(details)`: CSV in the Play Data safety import layout, with the derived answers only. Import it from Play Console's Data safety page.
- Mapping table: `DATA_CAPABILITIES`, `NO_DATA_CAPABILITIES`.
