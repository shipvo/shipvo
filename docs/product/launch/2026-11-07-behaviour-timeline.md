# Launch kit: behaviour timeline

Drafts for the owner to post. Every statement is from `docs/timeline.md`, `changes/` entries for #1084 and the tests in `services/control-plane/test/timeline.test.ts`. No numbers are claimed.

Links: [docs](../../timeline.md), [features page](https://shipvo.dev/features/).

## X post (under 280 characters)

What changed in your app between two releases? The Timeline tab in your Shipvo app admin lists every release and pull request check. Pick two: flows that flipped, findings that appeared, and before and after screens for Android and iOS. https://shipvo.dev/docs/timeline/

## LinkedIn post

What changed in your app between release 41 and release 42?

The Timeline tab in your Shipvo app admin page lists each release you published and each pull request that was checked. Each row shows:

- the flows your tests walk through, passed or failed
- the problems found when Shipvo walked every button
- small pictures of the screens it saw

Pick two rows and read the compare: flows that changed from passed to failed or back, findings that appeared or went away, and before and after pictures of every screen that looks different. Android and iOS sit together in one row.

Rows appear when test results reach your control plane, for example `npx shipvo test --report shipvo-report.json --release 42 --upload`.

https://shipvo.dev/docs/timeline/

## Show HN-style description

The control plane keeps the test report of each release and each checked pull request, and the admin page has a Timeline tab that compares any two. A compare lists flows that changed result, explore findings added or removed, and before/after screen pairs per skin (Android and iOS). Reports are uploaded with `shipvo test --report ... --upload` or `POST /r/<app>/pr/<n>/tests`; the routes need the owner's signed-in session, and publish tokens get 401 because screens can show app content. Tests cover storage, release-to-release and PR-to-release compare, access and size limits. Docs: https://shipvo.dev/docs/timeline/

## 30-second demo script (Video Studio)

1. 0-6 s: Open the app admin page, click the Timeline tab; rows r41, r42 and p7 with pass and fail marks.
2. 6-14 s: Select r41 and r42. The compare shows a flow that went from passed to failed.
3. 14-24 s: Scroll to the before and after screens; Android and iOS pairs side by side.
4. 24-28 s: Terminal: `npx shipvo test --report shipvo-report.json --release 43 --upload` prints `uploaded report for release 43 (android)`.
5. 28-30 s: Caption: "See what changed. shipvo.dev/docs/timeline".
