# Videos

Short videos for people who are new to Shipvo. Each one has captions and a written transcript.

## Put your app in the stores

### From working app to Google Play and the App Store

<video controls preload="metadata" playsinline tabindex="0" data-title="From working app to Google Play and the App Store" data-length="2 min 4 s" poster="/videos/from-app-to-both-stores.jpg" src="/media/videos/from-app-to-both-stores-6ada6c3a.mp4"><track kind="captions" src="/videos/from-app-to-both-stores.vtt" srclang="en" label="English">Your browser cannot play this video. Read the transcript below.</video>

2 minutes 4 seconds. The store path in four commands: `shipvo store setup` for your plan, `shipvo store status` for one timeline per store, `shipvo store details --dry-run` for draft data safety answers and a privacy policy, and `shipvo store screenshots` for checked store sizes. It ends on the Google Play tester rule and `shipvo store testers`. It follows [Store details](store.md).

[Captions (.vtt)](/videos/from-app-to-both-stores.vtt)

<details class="credits"><summary>ⓘ Copyright credits</summary>Music: "Cinematic" by Matti Paalanen (<a href="https://www.jamendo.com">Jamendo</a>, <a href="http://creativecommons.org/licenses/by-nc-nd/3.0/">CC BY-NC-ND 3.0</a>). Source: <a href="https://www.jamendo.com/track/1221581">https://www.jamendo.com/track/1221581</a></details>

<details>
<summary>Transcript</summary>

Your app works. Now you need Google Play and the App Store. By the end, you have a plan for both stores, draft answers, and screenshots. And one rule on Google Play, that catches most founders.

Step one. Make your plan. Type shipvo store setup. It asks if you have a registered company. With a company, you get organization accounts, and no tester rule on Google Play. Without one, you get a personal account, and the tester rule applies.

Step two. Type shipvo store status. You see one timeline for each store. Every step is to do, waiting, or done. It tells you what to do next. When you finish a step, mark it done.

Step three. The stores ask what data your app collects. Type shipvo store details, --dry-run. Shipvo reads the features your app uses, and drafts the data safety answers and a privacy policy. Some questions only you can answer, like third party tools and a contact address.

Step four. Screenshots. Type shipvo store screenshots. Shipvo shows your app in the simulator, and saves files in the sizes the stores ask for. It checks each one.

Now, the rule. On Google Play with a personal account, you need twelve testers for fourteen days in a row. Type shipvo store testers for the steps. Shipvo Testers is a group of founders who test each other's apps. We have a video about it.

So here is what you have. A plan for each store, in order. Data safety answers, and a privacy policy draft. Screenshots in every store size, checked. And the tester steps. You press submit.

Start with your plan. Type shipvo store setup in your app folder. Next, get your twelve testers. The guide is at shipvo.dev/learn.

</details>

## Run your app

### See your app on a phone in your browser with shipvo run

<video controls preload="metadata" playsinline tabindex="0" data-title="See your app on a phone in your browser with shipvo run" data-length="1 min 33 s" poster="/videos/run-your-app-on-a-phone.jpg" src="/media/videos/run-your-app-on-a-phone-e56797e1.mp4"><track kind="captions" src="/videos/run-your-app-on-a-phone.vtt" srclang="en" label="English">Your browser cannot play this video. Read the transcript below.</video>

1 minute 33 seconds. One command, `npx shipvo run android`, opens a simulated phone in your browser with no account and no Android Studio or Xcode. It covers the iPhone look, the dark frame, how your AI assistant drives the same phone with `open_app`, and the `--port` and `--native` options. It follows [Run your app on a phone in your browser](run.md).

[Captions (.vtt)](/videos/run-your-app-on-a-phone.vtt)

<details class="credits"><summary>ⓘ Copyright credits</summary>Music: "Princess of my heart" by Zero-project (<a href="https://www.jamendo.com">Jamendo</a>, <a href="https://creativecommons.org/licenses/by/3.0/">CC BY 3.0</a>). Source: <a href="https://www.jamendo.com/track/633200">https://www.jamendo.com/track/633200</a></details>

<details>
<summary>Transcript</summary>

Want to see your app on a phone? You do not need a phone. You do not need Android Studio, or Xcode. One command opens a phone in your browser.

Open a terminal in your app folder. Type npx shipvo run android, and press Enter. Shipvo builds a web copy of your app. It needs no account.

Your browser opens on a page with a phone in the middle. A label says Simulated, because this is a copy of a phone, not a real one. Click it like you would tap.

Want an iPhone instead? Type ios. You get the iPhone look, with its Dynamic Island. The page scales the phone to your window. Add ?dark=1 to the address for the dark frame.

Now the best part. Your AI assistant can drive the same phone while you watch. While shipvo run is up, the assistant calls open_app, and finds your live phone. It taps, types and scrolls. You see every move.

Need another port? Add --port. Want a real emulator later? Add --native. When you are done, press Ctrl+C in the terminal.

That is it. A phone in your browser, in seconds. Try npx shipvo run android in your app folder. The guide is at shipvo.dev/learn.

</details>

## Get your app on Google Play

### Get your 12 Google Play testers with Shipvo Testers

<video controls preload="metadata" playsinline tabindex="0" data-title="Get your 12 Google Play testers with Shipvo Testers" data-length="1 min 42 s" poster="/videos/get-your-12-testers.jpg" src="/media/videos/get-your-12-testers-75848c18.mp4"><track kind="captions" src="/videos/get-your-12-testers.vtt" srclang="en" label="English">Your browser cannot play this video. Read the transcript below.</video>

1 minute 42 seconds. The Google Play rule for new personal accounts (12 testers, 14 days in a row), how to join Shipvo Testers, set up a closed test, let `shipvo store testers` add the group, share your opt-in link and test other founders' apps. It follows [Get your 12 testers](tutorials/get-your-12-testers.md).

[Captions (.vtt)](/videos/get-your-12-testers.vtt)

<details class="credits"><summary>ⓘ Copyright credits</summary>Music: "Beyond time" by InternalEye (<a href="https://www.jamendo.com">Jamendo</a>, <a href="http://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA 3.0</a>). Source: <a href="https://www.jamendo.com/track/1178100">https://www.jamendo.com/track/1178100</a></details>

<details>
<summary>Transcript</summary>

Want your app on Google Play? New personal accounts have a rule. You need twelve testers, for fourteen days in a row. Here is how to find them.

Google asks for twelve people to opt in to a closed test. They must stay opted in for fourteen days in a row. If the count drops below twelve, the clock starts again. Company accounts skip this rule. So do personal accounts made before 13 November 2023.

Step one. Join Shipvo Testers. It is a group of founders who test each other's apps. Anyone can join. Members cannot see each other's emails.

Step two. In Play Console, make a closed test track. Upload your first build by hand. Play does not allow that step through the API. Then add the Shipvo Testers group to the track.

Or let Shipvo do it. Run shipvo store testers. It prints the steps for your app. Add your Play key, and it adds the group for you. It never removes a group.

Step three. Share your opt-in link with your own people. They open it, opt in, and install your app.

Step four. Test other apps. The community works because everyone tests. Keep them installed for the fourteen days.

We cannot promise how many people will opt in. But now you have a plan. Join at shipvo.dev/testers.

</details>

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
