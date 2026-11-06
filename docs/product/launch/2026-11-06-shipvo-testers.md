# Launch kit: Shipvo Testers and `shipvo store testers`

Drafts for the owner to post. Check each claim against the linked docs before posting.

**Links:** [docs](../../store.md#get-your-12-testers), [tutorial](../../tutorials/get-your-12-testers.md), [video](../../videos.md), join page https://shipvo.dev/testers/ , PR #520. Changelog: `changes/517-store-testers.md`.

## X post (under 280 characters)

New Google Play personal accounts need 12 testers opted in to a closed test for 14 days in a row. Shipvo Testers is a group of founders who test each other's apps. `shipvo store testers` prints the steps and adds the group to your track. https://shipvo.dev/testers

## LinkedIn post

If you made your Google Play developer account recently as an individual, Google asks for 12 testers opted in to a closed test for 14 days in a row before you can apply for production.

Finding 12 strangers is the hard part. So we made Shipvo Testers: a Google Group where founders join, install each other's apps and keep each other's counts above 12.

Run `shipvo store testers --package com.example.shop`. It prints the steps for your app. With your own Play service account key, it also adds the group to your closed track. It keeps the groups already there and never stores the key.

We cannot say how many testers will opt in. The community works when everyone tests.

Tutorial and video: https://shipvo.dev/learn/get-your-12-testers/

## Show HN-style description

Shipvo Testers is a Google Group of app makers who test each other's closed-test apps, built for the Google Play rule that new personal accounts need 12 testers opted in for 14 days in a row. `shipvo store testers` (Apache-2.0, part of the Shipvo CLI) prints the steps for your app and, given your own Play service account key, adds the group to your closed track without removing existing groups. Docs: https://shipvo.dev/docs/store/ . Video: https://shipvo.dev/learn/videos/

## 30-second demo script (for the Video Studio)

1. (0-5 s) Title card: "12 testers. 14 days in a row." Voice: "New Google Play personal accounts need 12 testers for 14 days."
2. (5-12 s) Terminal: `npx shipvo store testers --package com.example.shop`. Show the printed steps.
3. (12-20 s) Add `--play-key play-key.json`. Show the line that the group was added to the track.
4. (20-26 s) Browser: shipvo.dev/testers join page. Voice: "Join, and test other founders' apps."
5. (26-30 s) End card: shipvo.dev/learn/get-your-12-testers. Voice: "Everyone tests, everyone passes."
