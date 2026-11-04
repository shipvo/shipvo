# Make your first app, change it and get it ready to ship

You will make a phone app, see it run on your computer, change its words, and prepare a signed release. You need no phone and no coding. Plan for about 30 minutes. Most of that is installing Node and waiting for downloads: the commands themselves took under two minutes on our test machine.

You will use a **terminal**: a window where you type commands. Words in **bold** are explained once and listed in the [glossary](../glossary.md).

At the end you will have:

- an app called "Mama Ngozi Bakery" (use your own name),
- a **simulator** showing it, with an AI **assistant** able to tap through it,
- a changed headline, and
- a signed **release** in a folder, checked with a **dry run**, with nothing sent to anyone.

The starter app is not a shop yet. It is one screen with a headline and four buttons (scan, location, fingerprint, notification) that show how a phone's features work. You will change the words. Building shop screens comes in a later tutorial.

## What you need

- A computer (Windows, Mac or Linux) with an internet connection.
- **Node** version 22. Go to [nodejs.org](https://nodejs.org), download the LTS or "Current" installer for version 22 or later, and click through it.
- About 1 GB of free disk space.
- Optional: Claude Desktop, Claude Code, Cursor or ChatGPT, for step 5.

## 1. Open a terminal and check Node

- Windows: press the Start key, type `PowerShell`, press Enter.
- Mac: press Cmd + Space, type `Terminal`, press Enter.

Type this and press Enter:

```bash
node --version
```

You should see a number starting with `v22` or higher, such as `v22.11.0`.

> **If something goes wrong:** "node is not recognized" or "command not found" means Node is not installed, or the terminal was open during the install. Close the terminal, open a new one and try again. A number below 22 means you need the newer installer.

## 2. Create your app

Pick a short name with no spaces for the folder (`mybakery`), and the real name in quotes after `--name`:

```bash
npx -y @shipvo/cli init mybakery --name "Mama Ngozi Bakery"
```

You should see `Created Mama Ngozi Bakery in mybakery` and a long note. It ends with a line starting `Public key pinned in the shell`. This took under a second on our test machine, after the first download.

The command also made a **signing seed**: a secret file at `mybakery/.shipvo/seed.txt`. Phones only accept releases signed with it. Copy that one file to a USB stick or a password manager now. If you lose it, phones that already have your app will never accept an update. Never email it or post it.

> **If something goes wrong:** "already exists" means that folder name is taken. Choose another name. "Unknown command" or a download error usually means no internet. Check your connection and run it again.

## 3. Install what the app needs

Go into the folder, then install. These are two commands. Type each, press Enter, and wait for it to finish:

```bash
cd mybakery
npm install
npx playwright install chromium
```

`npm install` downloads the app's parts. It took about 30 seconds on our test machine, and may take a few minutes on slow internet. It ends with a few lines about "vulnerabilities" or "audit". You can ignore those. The second command downloads a hidden web browser (about 120 MB) that draws the simulated phone. It took about 8 seconds for us.

> **If something goes wrong:** red lines starting with `npm error` and the word `EACCES` mean you lack permission to write in that folder. Make the app in your own Documents folder, not inside a system folder. If `npm install` stops with a network error, run it again.

## 4. Start the simulator and see your app

```bash
npm run sim
```

Wait about 10 seconds. You should see this, and the terminal will stay busy. That is correct:

```text
Simulator on http://localhost:4545  (open_app("mybakery") from @shipvo/mcp; Ctrl-C to stop)
```

Open your browser, go to `http://localhost:4545/app/` and make the browser window narrow, or press F12 and pick a phone size. You should see this:

![The Mama Ngozi Bakery app in a 390 by 844 phone-sized window: a dark teal banner reading "Release 1: hello from Mama Ngozi Bakery", four buttons (Scan a code, Use my location, Confirm with fingerprint, Send a notification) and a log that says "Running release 0".](/tutorials/first-app/01-first-screen.png)

Click **Scan a code**. A phone asks "Allow This app to take pictures and record video?" exactly as an Android phone would:

![The same screen dimmed, with a bottom sheet asking permission to use the camera and three buttons: While using the app, Only this time and Deny.](/tutorials/first-app/02-camera-permission.png)

Click **Deny** for now. Then click **Send a notification**. The log now says "Notification sent" and a banner shows the message:

![The app after tapping Send a notification: the log reads "Notification sent" and a banner reads "Mama Ngozi Bakery: Hello from a notification."](/tutorials/first-app/03-notification.png)

Nothing here is a real camera or a real notification. The simulator says so in its records, and it never pretends otherwise.

Leave this terminal window open. Open a **second** terminal window for the next steps and go to your app again: `cd mybakery` (you may need the full path, such as `cd Documents/mybakery`).

> **If something goes wrong:** "Port 4545 is in use" means a simulator is already running, perhaps in another window. Close that window, or press Ctrl + C in it, and try again. If the page does not load, wait 10 more seconds and refresh. Do not run `npm run sim` twice on the same port: the second run can leave you looking at an older build.

## 5. Let an assistant use your app (optional)

An assistant can open your app and tap it like a customer. In Claude Desktop, Claude Code or Cursor, open the settings for MCP servers and add:

```json
{ "mcpServers": { "shipvo": { "command": "npx", "args": ["-y", "@shipvo/mcp"] } } }
```

Restart the assistant, then ask:

```text
Open the Shipvo app "mybakery". Tell me what is on the first screen, then tap
"Send a notification" and tell me what changed.
```

The assistant should first list `mybakery` and then describe the headline, the four buttons and the log. We drove the same tools from a script on our test machine and got the screen as a list of named items (`button "Send a notification"`), which is what the assistant reads. We did not run a particular chat assistant in this tutorial.

> **If something goes wrong:** if the assistant says it has no Shipvo tools, you probably did not restart it after pasting the settings. If it says "simulator /session → 500" or "Is it running at http://localhost:4545?", the simulator from step 4 is not running. Start it again. For ChatGPT and the hosted version, follow [Test with an assistant](../test-with-an-assistant.md).

## 6. Change the words

In your second terminal, open the file `src/release.ts` in any plain text editor (on Windows, Notepad: `notepad src/release.ts`; on a Mac, `open -e src/release.ts`). Replace the whole second line so it reads like this, with your own words between the quote marks:

```ts
export const RELEASE = { headline: "Fresh bread every morning from 6am.", note: "Order by 10pm for next-day pickup." };
```

Save the file. Then go to the first terminal (the one running the simulator), press Ctrl + C to stop it, and start it again with `npm run sim`. Wait about 10 seconds and refresh the browser page. The simulator does not refresh by itself yet, so you must restart it after each change.

![The app after the change: the banner now reads "Fresh bread every morning from 6am." with the note "Order by 10pm for next-day pickup."](/tutorials/first-app/04-edited-text.png)

> **If something goes wrong:** if the old words still show, the old simulator is still running. Make sure you pressed Ctrl + C, saw the prompt return, and ran `npm run sim` again. If the page is blank, check that the line still starts with `export const RELEASE` and ends with `};`, and that every quote mark is still there.

## 7. Prepare a release with a dry run

A **dry run** builds and signs your release into a folder on your computer and sends nothing. In the second terminal:

```bash
npx shipvo publish --dry-run --skip-web true --platform android
```

(`--skip-web true` skips the browser copy so it runs faster. `--platform android` builds the Android release only.) It took about 12 seconds for us. You should see lines about "Bundled" and "Exported: dist-ota", and then one line of text in curly brackets ending in `"dry_run":true`, with the size in bytes. A size of about 1.75 million bytes (1.7 MB) is normal for the first release.

Now look at what it made:

```bash
npx shipvo pubkey
```

```text
8KUIQ0NAuHJMPO9ZfuME2sI3wBabwxt3xwJC7VDC/Us=
```

Your own line of letters will differ. That is your **public key**. The files in `.shipvo/dry-run` are:

| File | What it is |
| --- | --- |
| `b/mybakery/r1.hbc` | Your app's code for release 1, ready for phones. |
| `p/mybakery/1/b0`, `b1`, `b2` | Three signed notes that say "use release 1", for 1 %, 10 % and all of your users. |
| `h/mybakery/r1` | The record of the release. |

Phones check the signature on those notes with the public key in your app before they use anything. A release with a wrong signature is ignored.

> **If something goes wrong:** "Nothing to publish with" means the `--dry-run` part was left out, so Shipvo looked for a real place to publish. Type the command again exactly as shown. A long stack of red text that mentions `expo export` usually means `npm install` in step 3 did not finish. Run it again.

## What you did not do yet

You have not put the app on a phone, signed in, or sent a release to real users. The dry run proves the release builds and is signed. The next tutorials cover each of those.

## Recap

- `shipvo init` made a complete app and a secret signing seed. You backed up the seed.
- `npm run sim` showed the app in a simulated phone, and an assistant can tap it through MCP.
- You changed the words in `src/release.ts`.
- `shipvo publish --dry-run` built and signed a release into a folder without sending anything.

## Next steps

- Let an assistant check your app before every release: [Test with an assistant](../test-with-an-assistant.md).
- Put the app on an Android phone and publish for real: [Build your first Shipvo app](../getting-started.md), steps 4 and 5.
- Moving to another computer? [Move your signing seed](../new-machine.md).
- Words you did not know: [Glossary](../glossary.md).
