# Videos

Short videos for people who are new to Shipvo. Each one has captions and a written transcript.

## Test your app

### Have an AI assistant test your shop before every release

<video controls preload="metadata" playsinline tabindex="0" data-title="Have an AI assistant test your shop before every release" data-length="1 min 30 s" poster="/videos/test-with-an-assistant.jpg" src="/media/videos/test-with-an-assistant-e368a4d3.mp4"><track kind="captions" src="/videos/test-with-an-assistant.vtt" srclang="en" label="English">Your browser cannot play this video. Read the transcript below.</video>

1 minute 30 seconds. Connect an assistant such as Claude or Cursor to your shop in the simulator, ask it to shop like a customer, check what really happened with the device log, turn its run into a test and run that test before a release. It follows [Have an AI assistant test your shop](tutorials/test-with-an-assistant.md).

[Captions (.vtt)](/videos/test-with-an-assistant.vtt)

Music: "Thrilled hands holding" by Tymphony (Jamendo, CC BY-SA 3.0) https://www.jamendo.com/track/341563

<details>
<summary>Transcript</summary>

Who tests your app before you ship it? You can ask an AI assistant to do it. It taps every button, like a customer. And it needs no phone.

Step one. Start your shop in the simulator. Then give your assistant one setting. It tells Claude, or Cursor, to start the Shipvo tools. That plug is called MCP.

Step two. Ask it to shop like a customer. Buy the tote. Make the payment fail, then make it work. The assistant taps through the app and tells you what the screen said.

Step three. Ask for proof. The device log lists everything the app asked the phone to do. In our run, the log showed the payment going to "My Shop". But this shop is called Sandbar. The assistant caught a real mistake.

Step four. Turn its run into a test. Ask for export test, and save the file. Then write the words that should appear on each screen. Now the check repeats by itself, in seconds.

Step five. Make it a habit. Run your tests, and then a practice release. If a test fails, the line stops. Nothing is sent to your users.

That is a safety check you can run before every release. The full guide is at shipvo.dev/docs/test-with-an-assistant.

</details>

## Get started

### Create your first app on a simulated phone

<video controls preload="metadata" playsinline tabindex="0" data-title="Create your first app on a simulated phone" data-length="1 min 39 s" poster="/videos/first-app.jpg" src="/media/videos/first-app-eb0eb0b3.mp4"><track kind="captions" src="/videos/first-app.vtt" srclang="en" label="English">Your browser cannot play this video. Read the transcript below.</video>

1 minute 39 seconds. Make an app, open it on a simulated phone in your browser, tap a button, change the words on the front page and check a release with a dry run. It follows [Create your first app](tutorials/first-app.md).

[Captions (.vtt)](/videos/first-app.vtt)

Music: "Thrilled hands holding" by Tymphony (Jamendo, CC BY-SA 3.0) https://www.jamendo.com/track/341563

This video, including its soundtrack, is shared under [CC BY-SA 3.0](http://creativecommons.org/licenses/by-sa/3.0/).

<details>
<summary>Transcript</summary>

You do not need a phone, or Android Studio, or Xcode. In a few minutes, you can have a real app running on a simulated phone, in your browser.

Step one. Open a terminal and make your app. Type npx -y @shipvo/cli init, then a name. Shipvo also makes a signing key. Keep it safe, and never share it.

Step two. Go into the new folder. Run npm install, and then install the small browser the simulator uses. The second one takes the longest.

Step three. Run npm run sim. Wait for the line that says Simulator on localhost:4545. Then open your browser at localhost:4545/app/. Your app is on the screen.

Click Send a notification. The log says it was sent. Nothing really went out. The simulator labels everything it pretends to do.

Step four. Change the words. Open src/release.ts, and edit the headline. Save the file, wait for "rebuilt", and reload the page. Your new words are on the screen.

Step five. Check a release. Run shipvo publish --dry-run. Shipvo builds and signs your app, but sends nothing. So it is safe to try.

That is your first app. The full guide, with every command, is at shipvo.dev/docs/first-app.

</details>

## Ship updates

### Ship an update to phones in minutes

<video controls preload="metadata" playsinline tabindex="0" data-title="Ship an update to phones in minutes" data-length="1 min 30 s" poster="/videos/ship-an-update.png" src="/media/videos/ship-an-update-988335b3.mp4"><track kind="captions" src="/videos/ship-an-update.vtt" srclang="en" label="English">Your browser cannot play this video. Read the transcript below.</video>

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
