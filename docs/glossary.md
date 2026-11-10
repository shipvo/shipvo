# Glossary

Plain-English meanings for the words Shipvo docs and tutorials use. Each tutorial explains a word the first time it appears and links here.

**Accessibility tree.** The list of buttons, headings and text on a screen that a screen reader reads aloud. An assistant uses the same list to see your app, so a button it cannot find is also hard for a person using a screen reader.

**Airplane mode (in the simulator).** A switch that turns the phone's network off. The app's calls to the internet then fail, as they do on a real phone, so you can see what your customers see with no signal.

**Deep link.** A web-style address, such as `myapp://item/42`, that opens a particular screen in an app. In Shipvo Phone it opens the app that owns the address and takes you to that screen once.

**App spec.** A JSON file that describes an app's screens, buttons and data in plain terms. Shipvo checks it, shows it the same on Android and iOS, and lets an assistant use it. See [App spec](spec-blocks.md).

**App id.** A short name for your app with no spaces, such as `tideshop`. Shipvo uses it to find your app.

**App activity.** The record of what an assistant built and changed in an app on the phone: each version with plain lines for what changed, the data sources, and recent events. Ask for it with `app_activity`. See [Phone apps](phone-apps.md#see-what-was-built-and-changed).

**Assistant.** An AI helper such as Claude or ChatGPT. With Shipvo it can open your app and use it like a customer.

**CSV.** A plain text table: the first line names the columns and each line after it is a row, with commas between values. Spreadsheets open it. A spec app makes one with `csv()`. See [Export data as CSV](spec-blocks.md#export-data-as-csv).

**Command.** One line of text you type in the terminal and run by pressing Enter.

**Control plane.** The Shipvo service that keeps your releases and decides who gets them. You can use the hosted one or run your own.

**Crash-loop revert.** What the phone does when a new release keeps crashing on start: after 3 failed runs it drops that release, blocks it and goes back to the one before. See [Crash-loop revert on Android](android-crash-loop-paths.md).

**Eval (agent evaluation).** A scored try-out for an assistant. You give it a task, such as buying one tote bag, and Shipvo records every step and checks the result. See [Score an agent](eval.md).

**Dry run.** A practice run. Shipvo does all the work of a release but sends nothing to anyone.

**JSON.** A plain way to write a list of things in a text file, with curly brackets, quote marks and commas. Shop products live in a JSON file. A missing comma is the usual mistake.

**MCP.** The way an assistant connects to tools such as the Shipvo simulator. You will see the word in settings; you do not need to understand it to use it.

**Node.** A free program that runs the tools behind Shipvo. You install it once. Shipvo needs version 22 or newer.

**npm.** A tool that comes with Node. It downloads the pieces your app is made from.

**Over the air (OTA).** Sending an update to phones through the internet, so people do not have to go to the app store.


**Job.** A slow task, such as publishing a preview, that keeps running after the assistant's request has waited long enough. The assistant gets a job name back and asks `job_status` for the result later. See [Agents](agents.md#troubleshooting).

**Vault.** A safe place for keys you give an app, such as a payment key. You paste a key once into a private page, it is stored encrypted, and the assistant never sees it. You can replace a key, remove it, and see when it was used. See [Self-hosting](self-hosting.md#saved-key-routes-vault).

**Release.** One numbered version of your app that phones can download.

**Secrets screen.** The screen in the Settings app on Shipvo Phone that lists the keys you saved for an app, such as a payment key. You can rotate or remove a key there. See [Phone apps](phone-apps.md#see-saved-keys-in-settings).

**Use log.** The list under a saved key that shows when the key was used, where, and what happened. Use it to check that only your app used the key. See [Phone apps](phone-apps.md#see-saved-keys-in-settings).

**Signing.** Putting a secret stamp on a release so phones can check it really came from you. The stamp comes from a key file kept on your computer.

**Signing seed.** The secret file (`.shipvo/seed.txt`) that makes the stamp. Back it up once: without it you cannot update phones that already have your app. See [Moving to a new machine](new-machine.md).

**Simulator.** A copy of a phone that runs on your computer and opens in your web browser. It shows your app without a real phone.

**State version.** A whole number in `shipvo.json` (`stateVersion`) that says which layout of saved data a release uses. `shipvo rollback` stops if it would send phones to a lower one. See [Rollbacks and stored data](rollbacks-and-stored-data.md).

**Template.** A ready-made app you change into your own, such as the shop template.

**Terminal.** A window where you type commands instead of clicking. On a Mac it is called Terminal. On Windows use "Windows Terminal" or "PowerShell". On Linux it is also called Terminal.

**Audit log.** A list of what happened to your app's releases: who published, who rolled back, when a release was stopped, and when you rotated your release key. You can export it with `shipvo audit`.

**Cohort.** A slice of your users that gets an update before everyone else. See also cohort band.

**Over-the-air update.** A new version of your app that phones download directly, without a new store release. Shipvo signs each one and the phone checks the signature before it runs.

**Cohort band.** A group of people who get a release first (`b0`), then more (`b1`, `b2`). Starting small limits the damage if something is wrong.

**Policy.** Rules you write in `shipvo.json` about releases, such as no publishing on Fridays (`blockedWeekdays`) or after 3pm (`blockedAfterHour`). `shipvo publish --dry-run` checks them, and the control plane enforces them on every real publish.

**Rollback.** Sending people back to the last good release.

**Parquet.** A file format for tables of data. Tools such as DuckDB read it, so you can ask questions about your releases with SQL.

**Test.** A small file that repeats the steps a customer takes and fails if the result changes. It runs on your computer in seconds.

**Attach.** When your assistant uses the phone you already have open in your browser, instead of starting its own hidden one. It happens when `shipvo run` is up.

**Frame.** The phone-shaped picture around your app in the browser, Android style or iPhone style. It says "Simulated" so nobody mistakes it for a real phone.

**MP4.** A common video file. Shipvo can record the simulated phone to one.

**Shipvo Testers.** A group of founders who test each other's apps on Google Play, to help each other reach the 12 testers Google asks for.

**Port.** A number that tells your computer which program a web address belongs to. `shipvo run` picks a free one. If it says the port is in use, pick another number with `--port`.

**Shipvo Phone.** The simulated phone Shipvo shows in your browser, in an Android style or an iPhone style. It runs your app on your computer, so you need no real phone.

**Phone Browser.** A web browser inside the simulated phone, separate from your app. Your app opens web links in it, and your assistant can read and click the pages. See [phone-apps](phone-apps.md).

**Staged rollout.** Sending a release to a small group of phones first, then to more once it looks healthy. Shipvo does this with cohort bands.

**Promote.** Widening a staged release to more phones. `shipvo promote` sends the release you already checked to the next bands.

**Lumi.** The small glowing orb beside the Shipvo Phone camera. It shows each step as a caption, looks worried when something fails, and powers `shipvo lumi`, which tests your app while you watch. See [Lumi](lumi.md).

**Network profile.** A named connection speed and reliability for the simulated phone, such as `2g` or `spotty`, so you can see how your app behaves on a poor connection. See [Device API](device-api.md#network-profiles).

**Behaviour timeline.** A list in your app's admin page of every release and pull request check run, with its flows, findings and screens, so you can compare any two points. See [Behaviour timeline](timeline.md).

**Agents setup.** `shipvo agents setup` gets your coding agent ready in one command: it writes the Shipvo MCP config for each coding agent it finds and copies the Shipvo skills into your project. See [Agents](agents.md).

**Save as test.** A button in Lumi, and the `--save-tests` flag of `shipvo explore`, that turns a bug the walker found into a test file that fails until the bug is fixed. See [Lumi](lumi.md).

**Build.** Turning your app's files into one copy that can run, here a web copy shown on a simulated phone. The first build is the slowest.

**pnpm.** A tool that downloads the parts a project needs. You turn it on with `corepack enable`, which comes with Node.

**Build id.** The short name Shipvo gives a copy of your app you uploaded for the hosted phone. You open it as `myapp@build:<id>`. It is private to you and deleted when it expires. See [Test your build on the hosted phone](test-your-build.md).

**Watch link.** A web address, valid for one hour, that shows one hosted phone session live and read-only. `open_app` returns it as `watch_url`. See [Agents](agents.md#watch-link-on-the-hosted-phone).

**Room.** A name you give `open_app` so two phones share one backend, for example a buyer and a shop owner. Agents in a room can read what the others did with `room_log` and leave notes with `room_note`. See [Agents](agents.md#rooms-several-phones-one-backend) and [Room log and notes](agents.md#room-log-and-notes).

**Vector block.** A small drawing in an app spec, made of shapes (rectangles, circles, lines, text) whose size and colour follow your data. A battery bar is one. See [App spec](spec-blocks.md#vector-drawings).

**Motion (in an app spec).** A short fade, slide, count-up or pulse on a block. It turns off when the theme says `none` or the phone's reduce-motion setting is on. See [App spec](spec-blocks.md#motion).

**Right-to-left (RTL).** Languages such as Arabic and Hebrew that read from right to left. A spec with `strings` for that language lays out right to left. See [App spec](spec-blocks.md#translations-and-right-to-left).

**Playground.** The page at shipvo.dev/playground where a sample app runs on an Android phone and an iPhone in your browser, so you can try Shipvo before you install it. See [Playground](playground.md).

**Calendar block.** A part of an app spec that shows dated rows as a month, a week or an agenda. See [App spec](spec-blocks.md#calendars-and-maps).

**Map block.** A part of an app spec that draws rows with a latitude and longitude as pins on a canvas. It loads no map tiles. See [App spec](spec-blocks.md#calendars-and-maps).

**Live reload.** While `shipvo run` is open, Shipvo rebuilds your app each time you save a file and shows the new version in the phone, with no restart. If the save has a mistake, the phone keeps the last good version and a red bar names the file and line. See [Run your app on a phone](run.md#edit-and-save-the-phone-updates).

**Refresh (data source).** A number of seconds on a web data source in an app spec. Shipvo asks the service again on that timer while the app is installed. See [App spec](spec-blocks.md#keep-a-data-source-fresh).

**Signing seed.** The secret key that signs your releases. Every installed app pins its matching public key and accepts only updates signed with it. Shipvo never holds your seed, so back it up (see [Moving to a new machine](new-machine.md)).

**Publish token.** A key that lets one machine or CI job publish releases for your app. `shipvo app create` issues a new one and revokes the old one.

**Shell.** The app build you install from a store. It carries the runtime and your public key. Over-the-air updates change the code inside it.

**Home-screen layout (`placement`).** How an app sits on the phone's home screen: pinned, hidden, its position and the days and hours it shows. `export_phone_apps` carries it and `import_phone_apps` restores it.

**Root key.** An offline key that only signs rotation statements, never updates. `shipvo keys root` creates it. See [Key rotation](key-rotation.md).

**Rotation statement.** A note signed by the root key that tells phones to trust a new release key. `shipvo keys rotate sign` makes it.

**App permission.** A device permission (such as notifications or location) an app declares and you allow or deny on its install card or in Settings. See [phone apps](phone-apps.md#device-permissions-per-app).

**Held release.** A release Shipvo did not halt on its own because the failures looked fake (mostly brand-new installs, or a sudden burst). It keeps serving until you approve the halt or deny the hold. See [Auto-halt](auto-halt.md#when-the-failures-look-like-an-attack).

**Session inbox.** A private mailbox every test session has, with its own address, so a test or an agent can read an emailed sign-in code or link. See [Test an email sign-in](email-sign-in.md).

**Assistant Inbox.** A first-party phone app where assistants such as ChatGPT and Claude message each other, hand over tasks and share reports. See [phone apps](phone-apps.md#assistants-talking-to-each-other).

**Element ref.** A short label such as `e12` that the simulator gives each button or field on screen so an assistant can tap it. After a restart the labels carry a prefix (`f1e2`), and an old label gives a `stale_ref` message that tells the assistant to read the screen again. See [agents](agents.md).

**Capacitor.** A way to wrap a web app as an Android and iOS app. Shipvo opens a Capacitor project in the simulator on the Android and iOS skins and builds signed `.aab` and `.ipa` files from your own GitHub Actions. See [Capacitor](capacitor.md).

**Gallery (of specs).** Ready-made example app specs, such as a habit tracker or a trip checklist, that you can copy and change. See [App spec](spec-blocks.md#example-specs).

**Caller.** The name Shipvo fills in for the assistant that is talking to a phone app, so a reply goes back to the right assistant. See [phone apps](phone-apps.md#assistants-talking-to-each-other).
**Saved key.** A password or API key you store once so an app's data source can use it without the key appearing in the app. You can rotate or revoke it, and Settings shows its name and use, never its value. See [Spec blocks](spec-blocks.md#data-sources-that-use-a-saved-key).

**Patch.** A small file that holds only what changed between two releases, so a phone downloads far less than the whole bundle. If a phone cannot apply one, it downloads the full release. See [spike results](spike-results.md).

**Gallery.** Ready-made example specs (habit tracker, workout log, expense splitter and more) you can open on a phone and change. See [Spec blocks](spec-blocks.md#example-specs).

**Parity.** How closely the simulator matches an Android emulator and an iOS Simulator: the same buttons with the same names on every screen. Shipvo measures it and publishes the result. See [Simulator vs device parity](parity-results.md).
