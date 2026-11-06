# Get your 12 testers

<video controls preload="metadata" playsinline tabindex="0" data-title="Get your 12 Google Play testers with Shipvo Testers" data-length="1 min 42 s" poster="/videos/get-your-12-testers.jpg" src="/media/videos/get-your-12-testers-75848c18.mp4"><track kind="captions" src="/videos/get-your-12-testers.vtt" srclang="en" label="English">Your browser cannot play this video. Read the captions and transcript on the Videos page.</video>

Prefer to watch first? This 1 minute 42 second video covers the same steps. [Captions and transcript](../videos.md).

**Level:** beginner. **Time:** about 15 minutes of setup, then 14 days of waiting.

New personal Google Play accounts need at least 12 testers opted in to a closed test for 14 days in a row before you can apply for production. This is Google's rule; see [Google's help page](https://support.google.com/googleplay/android-developer/answer/14151465). Organization accounts skip it, and so do personal accounts made before 13 Nov 2023.

## Join Shipvo Testers

Shipvo Testers is a Google Group of founders who test each other's apps. Join at [shipvo.dev/testers](https://shipvo.dev/testers/). Anyone can join. Members cannot see each other's emails.

## Add the group to your closed test

1. In Play Console, open Testing, then Closed testing, and make a track.
2. Upload your first build by hand. Play does not allow this step through the API.
3. Add `shipvo-testers@googlegroups.com` as a Google Group on the track, along with any group of your own people.

Or run `shipvo store testers --play-key <file>` with your own Play service account key to add the group for you. See [Store details](../store.md) for how.

## Share your opt-in link

Send `https://play.google.com/apps/testing/<your package name>` to your testers. They open it, opt in and install the app.

## Test other apps

The community works because everyone tests. Open the apps other founders share, opt in, and keep them installed for the 14 days.

The clock needs 12 testers opted in for 14 days in a row. If the count drops below 12, it starts again. We cannot promise how many people will opt in.
