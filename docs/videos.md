# Videos

Short videos for people who are new to Shipvo. Each one has captions and a written transcript.

## Ship an update to phones in minutes

<video controls preload="metadata" poster="/videos/ship-an-update.jpg" src="/media/videos/ship-an-update-dacbf9ea.mp4"><track kind="captions" src="/videos/ship-an-update.vtt" srclang="en" label="English" default></video>

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
