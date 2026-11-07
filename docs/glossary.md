# Glossary

Plain-English meanings for the words Shipvo docs and tutorials use. Each tutorial explains a word the first time it appears and links here.

**Accessibility tree.** The list of buttons, headings and text on a screen that a screen reader reads aloud. An assistant uses the same list to see your app, so a button it cannot find is also hard for a person using a screen reader.

**Airplane mode (in the simulator).** A switch that turns the phone's network off. The app's calls to the internet then fail, as they do on a real phone, so you can see what your customers see with no signal.

**Deep link.** A web-style address, such as `myapp://item/42`, that opens a particular screen in an app. In Shipvo Phone it opens the app that owns the address and takes you to that screen once.

**App spec.** A JSON file that describes an app's screens, buttons and data in plain terms. Shipvo checks it, shows it the same on Android and iOS, and lets an assistant use it. See [App spec](spec-blocks.md).

**App id.** A short name for your app with no spaces, such as `tideshop`. Shipvo uses it to find your app.

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

**Build.** Turning your app's files into one copy that can run, here a web copy shown on a simulated phone. The first build is the slowest.

**pnpm.** A tool that downloads the parts a project needs. You turn it on with `corepack enable`, which comes with Node.
