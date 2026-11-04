# Glossary

Plain-English meanings for the words used in the Shipvo docs and tutorials.

## Terminal
A window where you type commands instead of clicking. On Windows, open "Terminal" or "PowerShell". On a Mac, open "Terminal". Type a command, press Enter, and the computer runs it.

## Node
A free program that runs the tools Shipvo uses. Shipvo needs version 22. Get it from [nodejs.org](https://nodejs.org). `npx` and `npm` come with it.

## Command
One line you type in the terminal. Every command in these docs is in a grey box. Copy it exactly.

## Simulator
A phone that lives inside your computer. It shows your app and lets you tap it, with no real phone. Shipvo's simulator also lets an AI assistant tap through your app.

## Assistant
An AI helper such as Claude, ChatGPT or Cursor. With Shipvo it can open your app in the simulator and try it like a customer.

## MCP
A way to plug an assistant into a tool. You paste a small block of settings into the assistant once, and it can then use Shipvo. You do not need to understand more than that.

## Accessibility tree
The list of what is on a screen, written as text: headings, buttons, their names. Blind people's screen readers use it, and so do assistants. If your button has a clear name, both can find it.

## Release
One numbered version of your app's code. Release 1 is the first, release 2 is your next change.

## Over-the-air update
A new release that reaches phones through the internet, with no trip to the app store. Phones download it, check it, and use it.

## Publish
Build a release, sign it and send it to your users.

## Dry run
A practice publish. Shipvo builds and signs the release into a folder on your computer and sends nothing anywhere. Use it to check a release is ready.

## Signing seed
A secret file (`.shipvo/seed.txt`) that proves a release came from you. Phones refuse a release that is not signed with it. Keep a copy somewhere safe and offline. Never share it. See [Moving to a new machine](new-machine.md).

## Public key
The matching code phones use to check your signature. It is safe to share. Shipvo puts it in your app for you.

## Control plane
The server that stores your releases and tells phones which one to use. Shipvo hosts one for you, or you can [host your own](self-hosting.md).

## Cohort band
A slice of your users who get a release first. Shipvo writes three: `b0` (1 % of users), `b1` (10 %) and `b2` (everyone). Releasing to a small slice first limits the damage if something is wrong. See [Publish over the air](getting-started.md#5-publish-over-the-air).

## Rollback
Going back to an earlier release. `shipvo rollback --to 7` republishes release 7's code as a new release.
