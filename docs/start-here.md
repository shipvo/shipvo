# Start here

For founders and makers who want to know what Shipvo does and how to take the first step, with no coding background assumed. You will learn what Shipvo is for, what you need, and what you will see when it works. Developers who want exact options can go straight to the [developer path](getting-started.md).

New words are explained in the [glossary](glossary.md).

## What Shipvo does for you

1. **It fixes your phone app without an app store wait.** When you change your app, you run one command. People who already installed the app can get the change without a new store release.
2. **It keeps updates safe.** Every update is signed with a secret only you hold. A phone refuses an update that is not signed by you. If an update breaks the app, the phone goes back to the last good version on its own.
3. **It lets an AI assistant try your app.** Shipvo runs your app on a pretend phone on a computer. Claude or ChatGPT can tap through it like a customer and tell you where it breaks.

## What you need

- A computer (Mac, Windows or Linux).
- Node 22, a free program that runs the Shipvo tools. Get it from nodejs.org. To check it, open a terminal (on Mac: Terminal; on Windows: PowerShell) and type `node --version`. You should see a number starting with `v22`.
- A GitHub account, if you want to publish updates with the hosted service. It is free.

You do not need a phone, Android Studio or Xcode to try the pretend phone.

## Step 1. Make an app

Type this in the terminal. It makes a folder called `myshop` with a small working app inside.

```bash
npx -y @shipvo/cli init myshop --name "My Shop"
```

You will see "Created My Shop in myshop" and some next steps. It also made a secret key in `myshop/.shipvo/seed.txt`.

**Why this matters:** that key is what proves updates come from you. Make a copy and keep it somewhere safe and offline, such as a password manager. If you lose it, apps already installed cannot take another update.

**If it fails:** if you see `command not found: npx`, Node is not installed. Install it, close the terminal, open it again and retry.

## Step 2. Start the pretend phone

```bash
cd myshop
npm install
npx playwright install chromium
npm run sim
```

The first two commands download the pieces the app needs. The third downloads a browser the pretend phone runs in. The last one starts it. When it is ready you will see `Simulator on http://localhost:4545`.

**If it fails:** `Port 4545 is in use` means the pretend phone is already running in another terminal window. Close that one, or run `npm run sim -- --port 4546`.

## Step 3. Let an assistant try it

Follow [Test with an assistant](test-with-an-assistant.md). It takes you through connecting Claude, ChatGPT or Cursor, and what to ask. A good first request is: "Open my shop app and buy something. Tell me anything confusing."

## Step 4. Check an update before you send it

```bash
npx shipvo publish --dry-run
```

This builds and signs an update on your computer and sends it nowhere. It is safe to run any time. It writes its files to `.shipvo/dry-run`. The first line it prints is `dry run: nothing is sent anywhere; files go to .shipvo/dry-run`. It runs `expo export`, so it can take a few minutes. It ends without an error.

## Next steps

- Put the app on a phone and send real updates: [Build your first app](getting-started.md), sections 4 and 5.
- Make a backup of your key: [Moving to a new machine](new-machine.md).
- Look up a word: [Glossary](glossary.md).
