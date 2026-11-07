# Behaviour timeline

For app owners who want to see what changed in their app between two releases or pull requests, on Android and iOS, without reading logs. You will get one list of every release and pull request check run, with its flows, explore findings and screen thumbnails, and a side-by-side compare of any two points.

## Start here (no technical background needed)

The timeline is a tab called **Timeline** in your app's admin page. Each row is one moment: a release you published, or a pull request that was checked. Each row shows:

- **Flows**: the steps your tests walk through (for example "checkout"), each marked passed or failed.
- **Findings**: problems found when Shipvo walked every button.
- **Screens**: small pictures of the screens it saw.

To see what changed:

1. Open your app's admin page and sign in as the owner.
2. Open the **Timeline** tab.
3. Pick two rows.
4. Read the compare: flows that changed from passed to failed (or back), findings that appeared or went away, and before and after pictures of every screen that looks different. Android and iOS are shown together.

If the tab is empty, no test results have been uploaded yet. See "Fill the timeline" below.

## Fill the timeline

A row appears when test results reach your control plane.

1. For releases, run your flows with a report and add `--upload`. You need a publish token (`SHIPVO_PUBLISH_TOKEN`) and an `appId` in `shipvo.json`:

   ```bash
   npx shipvo test --report shipvo-report.json --release 42 --upload
   ```

   Expected output ends with `uploaded report for release 42 (android)`.
2. For pull requests, send the report to `POST /r/<app>/pr/<number>/tests` with a publish token. Each run adds a row named `p<number>`.

`shipvo test --report` writes the flows. `findings` and `screens` appear only when the report you send contains them: add them to the report JSON before you upload or post it (limits and format are in the Reference). Without them, a row shows its flows only.

A release row is named `r<number>` and a pull request row `p<number>`. When Android and iOS both report for the same point, they share one row.

## Reference

### Routes

Both routes need the owner's signed-in session. Publish tokens, the owner token and agent keys get `401`, because screens can show your app's content.

| Route | What it returns |
| --- | --- |
| `GET /app/<app>/timeline.json` | `{ app, points }`, newest first. |
| `GET /app/<app>/timeline/compare?from=<point>&to=<point>` | The difference between two points. |
| `POST /r/<app>/pr/<number>/tests` | Stores a pull request run. Needs a publish token or the owner token. |

A point id is `r<release>` or `p<pull request>`, for example `?from=r3&to=p12`.

### A point

| Field | Meaning |
| --- | --- |
| `id`, `kind`, `number` | `r3` is `kind: "release"`, `p12` is `kind: "pr"`. |
| `time`, `commit` | When the newest report arrived, and its commit if sent. |
| `platforms` | `android`, `ios` or both. |
| `flows` | Name, status and platforms. A flow is `failed` when it failed on any platform. |
| `findings` | Title, severity and platforms. |
| `screens` | Name, platform and a small image. |

### A compare

| Field | Meaning |
| --- | --- |
| `flows` | Only flows whose status differs. `before` and `after` are `passed`, `failed` or `absent`. |
| `findings` | `added` and `removed` titles. |
| `screens` | Screens whose picture differs, or that appeared or disappeared, per platform. |

### Report fields

A test report accepts optional `findings` (up to 50) and `screens` (up to 20, each a small `data:image/png`, `jpeg` or `webp` URL). The report size limit is 256 KB by default; `MAX_TEST_REPORT_BYTES` overrides it when you self-host.

## Troubleshooting

| You see | Why | Fix |
| --- | --- | --- |
| "Could not load the timeline." | Your admin session expired. | Sign in again as the owner. |
| `401 unauthorized` from a route | You used a token. | Use the signed-in session. |
| `404 not_found` on compare | One point has no uploaded results. | Pick two rows that appear in the list. |
| `400 bad_request` on compare | The ids are not `r<n>` or `p<n>`. | Use `?from=r3&to=p12`. |
| `413 report_too_large` | The report is over the size limit. | Send fewer flows or screens. |
| A screen is missing from the compare | The picture is the same in both points. | Only screens that differ are listed. |

## Next steps

- [Check every pull request](ci-check.md)
- [Test your app in CI](testing.md)
- [Self-host the control plane](self-hosting.md)
- [Glossary](glossary.md)
