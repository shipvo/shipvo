# Glossary

Every Shipvo word in plain English, in alphabetical order. If a page uses a word you do not know, look for it here.

**Accessibility tree.** A text list of what is on a screen: buttons, labels, fields. Screen readers use it. Shipvo gives it to AI agents so they can "see" your app without looking at pixels. See [Agents](agents.md).

**Agent.** An AI assistant, such as Claude or ChatGPT, that can use tools. In Shipvo an agent uses your app through the simulator.

**Band.** A slice of your users. A release goes to band `b0` (1 %) first, then `b1` (10 %), then `b2` (everyone).

**bsdiff patch.** A small file that describes only what changed between two bundles. Phones download the patch instead of the whole bundle, so most updates are small.

**Bundle.** The JavaScript file that holds your app's screens and logic. An over-the-air update replaces the bundle.

**Control plane.** The server that stores your releases and tells phones which one to run. You can use the hosted one (`api.shipvo.dev`) or [run your own](self-hosting.md).

**Crash-loop rollback.** If a new release fails to start three times in a row on a phone, that phone throws it away and goes back to the last good one.

**Device API.** One set of functions for the camera, location, fingerprint, payments and notifications. On a phone they are real. In the simulator they are pretend and labelled that way. See [Device API](device-api.md).

**Dry run.** `shipvo publish --dry-run`. It builds and signs a release but sends nothing anywhere. Use it to check a release safely.

**Hermes.** The engine React Native uses to run JavaScript on a phone. It runs a pre-compiled bundle (bytecode).

**Hermes bytecode version.** A number that says which Hermes build made a bundle. A phone can only run bundles with a matching number. Shipvo records it so a bundle is not sent to a phone that cannot run it.

**MCP (Model Context Protocol).** A standard way for an AI assistant to use outside tools. `@shipvo/mcp` is the tool that lets an assistant open and tap through your app. See [@shipvo/mcp](/docs/mcp/).

**OTA (over-the-air) update.** A new version of your app that reaches phones without an app store release. Only JavaScript and assets change. Native code does not.

**Pointer.** A small signed file that says "the current release is number N, and here is its hash". Phones read the pointer first.

**Publish token.** A key made by `shipvo app create`. It can write your app's files and nothing else. It lasts 90 days.

**Ref.** A short name such as `e11` for one item on the screen. An agent says "tap e11".

**Release.** One published version of your bundle, numbered 1, 2, 3 and so on.

**Rollback.** Going back to older code. `shipvo rollback --to 7` publishes release 7's code again as a new release, so every phone moves to it.

**Seed (signing seed).** The secret that signs your releases. It lives in `.shipvo/seed.txt`. Lose it and installed apps will never accept another update, so back it up with `shipvo keys export`. See [Moving to a new machine](new-machine.md).

**Shell.** The installed app on the phone (the APK or iOS app). It holds your public key and the control plane address. The shell changes only through an app store. The bundle inside it changes over the air.

**Signature.** A check value made with your seed. A phone uses your public key to confirm a release came from you and was not changed.

**Simulator.** A pretend phone that runs on a computer with no phone attached. Shipvo's simulator runs your app in a headless browser (one with no window) and shows it to agents as an accessibility tree. See [@shipvo/sim](/docs/sim/).

**Staged release.** Sending a release to a few users first, then more. Shipvo does this with bands.
