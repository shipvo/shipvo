# Glossary

Plain-English meanings for the words Shipvo docs and tutorials use. Each tutorial explains a word the first time it appears and links here.

**Accessibility tree.** The list of buttons, headings and text on a screen that a screen reader reads aloud. An assistant uses the same list to see your app, so a button it cannot find is also hard for a person using a screen reader.

**Airplane mode (in the simulator).** A switch that turns the phone's network off. The app's calls to the internet then fail, as they do on a real phone, so you can see what your customers see with no signal.

**Deep link.** A web-style address, such as `myapp://item/42`, that opens a particular screen in an app. In Shipvo Phone it opens the app that owns the address and takes you to that screen once.

**App spec.** A JSON file that describes an app's screens, buttons and data in plain terms. Shipvo checks it, shows it the same on Android and iOS, and lets an assistant use it. See [App spec](spec-blocks.md).

**App id.** A short name for your app with no spaces, such as `tideshop`. Shipvo uses it to find your app.

**App activity.** The record of what an assistant built and changed in an app on the phone: each version with plain lines for what changed, the data sources, and recent events. Ask for it with `app_activity`. See [Phone apps](phone-apps.md#see-what-was-built-and-changed).

**Assistant.** An AI helper such as Claude or ChatGPT. With Shipvo it can open your app and use it like a customer.

**Command.** One line of text you type in the terminal and run by pressing Enter.

**Control plane.** The Shipvo service that keeps your releases and decides who gets them. You can use the hosted one or run your own.

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

**Signing.** Putting a secret stamp on a release so phones can check it really came from you. The stamp comes from a key file kept on your computer.

**Simulator.** A copy of a phone that runs on your computer and opens in your web browser. It shows your app without a real phone.

**Template.** A ready-made app you change into your own, such as the shop template.

**Terminal.** A window where you type commands instead of clicking. On a Mac it is called Terminal. On Windows use "Windows Terminal" or "PowerShell". On Linux it is also called Terminal.

**Audit log.** A list of what happened to your app's releases: who published, who rolled back, and when a release was stopped. You can export it with `shipvo audit`.

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

**Room.** A name you give `open_app` so two phones share one backend, for example a buyer and a shop owner. See [Agents](agents.md#rooms-several-phones-one-backend).

**Vector block.** A small drawing in an app spec, made of shapes (rectangles, circles, lines, text) whose size and colour follow your data. A battery bar is one. See [App spec](spec-blocks.md#vector-drawings).

**Motion (in an app spec).** A short fade, slide, count-up or pulse on a block. It turns off when the theme says `none` or the phone's reduce-motion setting is on. See [App spec](spec-blocks.md#motion).

**Right-to-left (RTL).** Languages such as Arabic and Hebrew that read from right to left. A spec with `strings` for that language lays out right to left. See [App spec](spec-blocks.md#translations-and-right-to-left).

**Playground.** The page at shipvo.dev/playground where a sample app runs on an Android phone and an iPhone in your browser, so you can try Shipvo before you install it.

**Calendar block.** A part of an app spec that shows dated rows as a month, a week or an agenda. See [App spec](spec-blocks.md#calendars-and-maps).

**Map block.** A part of an app spec that draws rows with a latitude and longitude as pins on a canvas. It loads no map tiles. See [App spec](spec-blocks.md#calendars-and-maps).

**Live reload.** While `shipvo run` is open, Shipvo rebuilds your app each time you save a file and shows the new version in the phone, with no restart. If the save has a mistake, the phone keeps the last good version and a red bar names the file and line. See [Run your app on a phone](run.md#edit-and-save-the-phone-updates).

**Refresh (data source).** A number of seconds on a web data source in an app spec. Shipvo asks the service again on that timer while the app is installed. See [App spec](spec-blocks.md#keep-a-data-source-fresh).

**Describe an app.** Ask your assistant for a small app in plain words. It writes a spec, `create_app` puts the app on an Android or iOS phone with an icon, and `update_app` changes it later while keeping what people entered. See [Describe an app and it appears](describe-an-app.md).

**Signing seed.** The secret key that signs your releases. Every installed app pins its matching public key and accepts only updates signed with it. Shipvo never holds your seed, so back it up (see [Moving to a new machine](new-machine.md)).

**Publish token.** A key that lets one machine or CI job publish releases for your app. `shipvo app create` issues a new one and revokes the old one.

**Shell.** The app build you install from a store. It carries the runtime and your public key. Over-the-air updates change the code inside it.

**Home-screen layout (`placement`).** How an app sits on the phone's home screen: pinned, hidden, its position and the days and hours it shows. `export_phone_apps` carries it and `import_phone_apps` restores it.
