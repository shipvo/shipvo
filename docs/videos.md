# Videos

Short videos for people who are new to Shipvo. Each one has captions and a written transcript.

## Get started

### Create your first app on a simulated phone

<video controls preload="metadata" playsinline tabindex="0" data-title="Create your first app on a simulated phone" data-length="1 min 37 s" poster="/videos/first-app.jpg" src="/media/videos/first-app-c7c64eb7.mp4"><track kind="captions" src="/videos/first-app.vtt" srclang="en" label="English" default>Your browser cannot play this video. Read the transcript below.</video>

1 minute 37 seconds. Make an app, open it on a simulated phone in your browser, tap a button, change the words on the front page and check a release with a dry run. It follows [Create your first app](tutorials/first-app.md).

[Captions (.vtt)](/videos/first-app.vtt)

<details>
<summary>Transcript</summary>

You do not need a phone, or Android Studio, or Xcode. In a few minutes, you can have a real app running on a simulated phone, in your browser.

Step one. Open a terminal and make your app. Type npx shipvo init, then a name. Shipvo also makes a signing key. Keep it safe, and never share it.

Step two. Go into the new folder. Run npm install, and then install the small browser the simulator uses. The second one takes the longest.

Step three. Run npm run sim. Wait for the line that says Simulator on localhost:4545. Then open your browser at localhost:4545/app/. Your app is on the screen.

Click Send a notification. The log says it was sent. Nothing really went out. The simulator labels everything it pretends to do.

Step four. Change the words. Open src/release.ts, and edit the headline. Save the file, wait for "rebuilt", and reload the page. Your new words are on the screen.

Step five. Check a release. Run shipvo publish --dry-run. Shipvo builds and signs your app, but sends nothing. So it is safe to try.

That is your first app. The full guide, with every command, is at shipvo.dev/docs/first-app.

</details>

## Ship updates

### Ship an update to phones in minutes

<video controls preload="metadata" playsinline tabindex="0" data-title="Ship an update to phones in minutes" data-length="1 min 30 s" poster="/videos/ship-an-update.png" src="/media/videos/ship-an-update-988335b3.mp4"><track kind="captions" src="/videos/ship-an-update.vtt" srclang="en" label="English" default>Your browser cannot play this video. Read the transcript below.</video>

1 minute 30 seconds. What an over-the-air (OTA) update is, and what happens when you run `shipvo publish`: build, small patches, signing, three rollout groups and rollback. It follows [step 5 of Build your first app](getting-started.md).

[Captions (.vtt)](/videos/ship-an-update.vtt)

<details>
<summary>Transcript</summary>

You found a bug. Your app is already on people's phones. Do you wait days to fix it? With Shipvo, you fix it in minutes.

This is called an OTA update. OTA means over the air. The phone gets the new version straight from you, like a web page.

Step one. Edit your app. In a Shipvo app, the first file to change is src/release.ts.

Step two. Run one command. shipvo publish.

Shipvo builds your new bundle and takes its fingerprint. Then it builds small patches, so phones download only what changed.

Then it signs the release with your private key. That key stays on your machine. Phones check the signature before they apply anything. So a stolen publish token cannot ship code to your users.

Releases go out in three groups. One percent of users. Then ten percent. Then everyone.

If a release fails to start three times on a phone, that phone throws it away. And if you need to go back, one command, shipvo rollback, sends an older release to everyone.

Back up your signing seed first. Then try it yourself. The full guide is at shipvo.dev/docs/getting-started.

</details>
