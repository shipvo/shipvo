# Change your app and watch the phone update as you save

You will start a simulated phone, then change a product's name and price in a text file. When you save the file, the phone shows the change by itself. You will also make a small typo on purpose, read the plain message Shipvo gives you, and fix it. You need no real phone and no coding skills.

**Level:** beginner. **Time:** about 10 minutes. On our test machine each save showed up in the phone in about a second (see "What we measured").

New words are explained once, and collected in the [glossary](../glossary.md).

## What you need

- **Node**, version 22 or newer, and a terminal ([how to check](first-app.md#1-open-a-terminal-and-check-node)).
- A shop app made with `shipvo init`. If you have none, type these three lines. The name after `init` is your app's folder.

```bash
npx -y @shipvo/cli init tidepool --template shop --name "Tidepool Shop"
cd tidepool
npm install
```

- A web browser and a text editor (Notepad, TextEdit or VS Code all work).

## 1. Start the phone

Make sure your terminal is inside your app's folder (the one with `shipvo.json` in it). Type this and press Enter:

```bash
npx shipvo run android
```

Shipvo makes a **build**: a web copy of your app. The first one is the slowest. When it is ready you should see these two lines:

```text
Simulated Android phone at http://127.0.0.1:4600/  (Ctrl+C to stop)
Watching for changes: the phone reloads when you save.
```

Your browser opens on that address. The second line is the new part: Shipvo now watches your files. **Leave this terminal window open** for the rest of the tutorial. The number in the address can be different on your computer.

You can use `npx shipvo run ios` instead. Everything below works the same on an iPhone-style phone.

> **If something goes wrong.**
> - `Port 4600 is in use`: another program has that number. Type `npx shipvo run android --port 4700`.
> - It says it cannot build for web and names a file: ask your assistant to fix that file.
> - Nothing opens: copy the address from the terminal into your browser.

## 2. Look at your shop

You should see a phone with "Tidepool Shop" and five products. Look at the fourth one: **Wool beanie, $24.00**.

![A browser tab with an Android-style phone frame. The app is Tidepool Shop with five products: Canvas tote $18.00, Enamel mug $12.00, Pocket notebook $6.50, Wool beanie $24.00 and Steel bottle $29.00.](/tutorials/watch-your-app-update/01-before.png)

The phone below is the finished Tide & Tackle sample shop, not your Tidepool Shop. Use it to get used to tapping through a shop.

<div data-shipvo-phone data-app="tide" data-release="latest" data-path="/" data-caption="Try it: add two items to the cart, then open the cart. You should see both items and a total." data-fallback="/tutorials/watch-your-app-update/01-before.png"></div>

## 3. Change a name and a price

Your products are in one file, `src/data/products.json`, inside your app folder. Open it in your text editor. Find this block:

```json
{
  "id": "wool-beanie",
  "name": "Wool beanie",
  "price": 2400,
  "description": "A warm hat in undyed wool."
}
```

Prices are written in cents, so `2400` is $24.00. Change two things:

- `"name": "Wool beanie"` becomes `"name": "Merino beanie"`
- `"price": 2400` becomes `"price": 2600`

Leave the quote marks and the commas where they are. Save the file, then look at the terminal and the phone. Do not reload the browser.

In the terminal you should see:

```text
Rebuilding...
rebuilt in 1.0 s
```

In the phone you should see **Merino beanie, $26.00**. The phone reloaded by itself. This is called **live reload**: every time you save, Shipvo rebuilds the copy and shows it.

![The same phone after the save. The fourth product now reads Merino beanie, $26.00. The other four products are unchanged.](/tutorials/watch-your-app-update/02-after.png)

> **If something goes wrong.**
> - Nothing changes: check that you saved the file, and that you edited the one inside the folder where `shipvo run` is running.
> - The phone says "Updating…" for a long time: wait for the `rebuilt in` line in the terminal. A big change can take a few seconds.
> - The phone stays the same and a red bar appears: go to step 4.

## 4. Make a typo and read the message

Everyone makes typos, so let us make one on purpose. In `products.json`, find the first product and change this line:

```json
"price": 1800,
```

to this (delete the comma and add a word):

```json
"price": 1800 oops
```

Save the file. In a few seconds a red bar appears under the phone:

> Your file src/data/products.json has a mistake at line 6, column 18: check for a missing or extra comma. The page still shows your last good version.

The terminal prints the same words. Two things to notice. The message names the file and the place. And the phone did not break: it keeps showing your last good version, so you never stare at a blank screen.

![The same phone with the Merino beanie still shown, and a red bar under the phone with the message about line 6, column 18 of products.json.](/tutorials/watch-your-app-update/03-error.png)

Now fix it: put the line back to `"price": 1800,` and save. The red bar goes away and the phone reloads.

> **If something goes wrong.** The red bar stays after you fix the line: read the new message. It names the next place to look. A **JSON** file (the kind your products are in) needs a comma between items and no extra words.

## 5. Stop the phone

Go to the terminal and press **Ctrl+C**. Your changes stay in the file. Nothing was sent to anyone and no account was used.

## Recap

You started a phone with one command, changed a product name and price, saw the phone update on its own after each save, made a typo, read a message that named the file and line, and fixed it. You did not stop and restart anything between changes.

## What we measured

On 2026-11-10, on a GitHub Actions Linux runner with Node 22.23, we ran `shipvo run android` for a new shop app and changed the name and price of one product in `products.json`. The new name was visible in the Android frame 1.3 s after the file was saved. The terminal printed `rebuilt in 1.0 s`. A typo in the same file showed the red bar with the line and column. The next save with the typo fixed removed it. We took the screenshots from that run. The repository also checks this on the Android and iOS frames in `packages/cli/test/run-live-reload.test.ts`.

## Next steps

- [Make a shop with your own products](your-own-shop.md): put in your own list and prices
- [Ship a fix to your customers' phones](ship-a-fix.md): when the change looks right, send it to real phones
- [Have an AI assistant test your shop before every release](test-with-an-assistant.md)
- [Run your app on a phone in your browser: all options](../run.md)
