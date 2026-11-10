# See your app on a phone in your browser with one command

You will type one command and get a phone, Android or iPhone style, in a browser tab, running your app. You will tap through your shop, change a product name and watch the phone update, look at the pretend Android system sheet, switch to the iPhone style and stop it again. You need no real phone, no Android Studio and no Xcode.

**Level:** beginner. **Time:** about 20 minutes to read and follow. On our test machine the first start took within a minute (see "What we measured" at the end).

New words are explained once, and collected in the [glossary](../glossary.md).

## What you need

- **Node**, version 22 or newer, and a terminal ([how to check](first-app.md#1-open-a-terminal-and-check-node)).
- An app made with `shipvo init`. If you have none, make the shop in [Make a shop with your own products](your-own-shop.md), steps 1 and 2, or run these three lines (the name after `init` is your app's folder):

```bash
npx -y @shipvo/cli init tidepool --template shop --name "Tidepool Shop"
cd tidepool
npm install
```

- A web browser.

## 1. Start the phone

Make sure your terminal is inside your app's folder (the one with `shipvo.json` in it). Type this and press Enter:

```bash
npx shipvo run android
```

Shipvo now builds a web copy of your app. This is called a **build**. The first one is the slowest because nothing is saved yet. You will see lines about "Metro Bundler", which is the tool that gathers your app's files. You do not need to read them.

When it is ready you should see a line like this:

```text
Simulated Android phone at http://127.0.0.1:4600/  (Ctrl+C to stop)
```

Your browser opens on that address by itself. If it does not, copy the address into your browser. The number can be different on your computer.

> **If something goes wrong.**
> - The terminal says `Port 4600 is in use`: another program has that number. Type `npx shipvo run android --port 4700` (any free number works).
> - It says it cannot build for web and names a file: that file uses something that only works on a real phone. Ask your assistant to fix that file.
> - It mentions `@shipvo/sim`: your app is older than this feature. Type `npm install --save-dev @shipvo/sim` and try again.
> - Nothing opens: open the address from the terminal in your browser yourself.

## 2. Look at your phone

You should see a phone in the middle of the page. A small label at the bottom of the frame says **SIMULATED**, because this is a copy of a phone, not a real one. Your app is inside it.

![A browser tab with a phone-shaped frame, Android style, with a camera hole at the top. Inside the phone the app is titled Tidepool Shop and lists five products with prices: Canvas tote $18.00, Enamel mug $12.00, Pocket notebook $6.50, Wool beanie $24.00 and Steel bottle $29.00. The word SIMULATED is under the phone.](/tutorials/run-your-app-on-a-phone/01-android.png)

The page also has a label at the top left that gives the phone size (412 by 915 on Android) and a button at the top right that says **Show Android system sheet**. You will use it in step 5.

## 3. Tap through your shop

Click works like a tap. Do these in the phone:

1. Click **Wool beanie**. You should see its name, its price and the words "A warm hat in undyed wool."
2. Click **Add to cart**, then **Back**, then **Cart**. You should see "Wool beanie x 1", "Total: $24.00" and a **Pay** button.

![The cart screen inside the Android phone. It says Cart, Wool beanie x 1 with a Remove link, Total: $24.00, and a dark Pay button.](/tutorials/run-your-app-on-a-phone/03-cart.png)

Below is a live phone with the finished Tide & Tackle sample shop, so you can try the same moves now. It is not your app.

<div data-shipvo-phone data-app="tide" data-release="latest" data-path="/" data-caption="Try it: add two items to the cart, then open the cart. You should see both items and a total." data-fallback="/tutorials/run-your-app-on-a-phone/02-product.png"></div>

![A product screen in the Android phone. The heading is Wool beanie, the price is $24.00, and there is an Add to cart button.](/tutorials/run-your-app-on-a-phone/02-product.png)

> **If something goes wrong.** A click does nothing: wait two seconds and click again. The page is a copy of your app, and the first click can arrive while it is still loading. If the phone stays blank, reload the browser tab.

## 4. Change your app and watch the phone update

You do not need to stop the phone to change your app. While it runs, Shipvo watches your files. When you save one, the phone updates by itself. This is called **live reload**.

Leave the terminal running. Open your app's folder in any text editor and open the file `src/data/products.json`. It holds your products. If you started from the shop template, find this line:

```json
    "name": "Wool beanie",
```

Change `Wool beanie` to `Merino beanie` and save the file.

Look at the terminal. You should see `Rebuilding...` and, a moment later, a line such as `rebuilt in 1.2 s` (your number will differ). The phone shows a small "Updating..." hint and then reloads. The list now says **Merino beanie**. You did not touch the browser tab. Live reload works the same way in the iPhone style: [switch the frame](#6-try-the-iphone-style-and-dark-frame) and save again, and the iPhone updates too.

![The Android phone before the edit. The product list shows Canvas tote, Enamel mug, Pocket notebook, Wool beanie at $24.00 and Steel bottle.](/tutorials/run-your-app-on-a-phone/07-before-edit.png)

![The same phone after the edit. The fourth product now says Merino beanie, still at $24.00.](/tutorials/run-your-app-on-a-phone/08-after-edit.png)

Now make a mistake on purpose. In the same file, break one line. Before:

```json
    "name": "Merino beanie",
```

After (a stray word `oops` where the colon was):

```json
    "name" oops "Merino beanie",
```

Save. The phone keeps showing your last good version. A red bar under the phone names the file, `src/data/products.json`, gives a line and column number, and says the page still shows your last good version. The terminal prints the same message. Put the colon back and save: the bar goes away and the phone reloads.

> **If something goes wrong.**
> - Nothing happens after you save: check that the terminal still shows `Watching for changes: the phone reloads when you save.` and that you saved the file in the app folder that `shipvo run` started in.
> - The red bar stays after you fixed the file: save once more, then wait for `rebuilt in` in the terminal.
> - You are not sure what to change: ask your assistant to open `src/data/products.json` and change one product name.

## 5. See the system sheet

On a real phone, some questions come from the phone itself, not from your app. An example is "Allow access?" when an app asks for your location. The simulated phone can show this too, so you can see how your app looks while it is covered.

Click **Show Android system sheet** at the top right of the page. You should see the screen go grey and a white sheet rise from the bottom with the question **Allow access?** and two buttons, **While using the app** and **Don't allow**. Click one to close it.

![The cart screen dimmed behind a white sheet at the bottom of the phone. The sheet asks Allow access? and has two buttons, While using the app and Don't allow.](/tutorials/run-your-app-on-a-phone/04-system-sheet.png)

## 6. Try the iPhone style and dark frame

Go back to the terminal and press **Ctrl+C** to stop the phone. The terminal gives your prompt back. Now type:

```bash
npx shipvo run ios
```

The phone is now an iPhone style (393 by 852), with a Dynamic Island at the top and a home bar at the bottom.

![A browser tab with an iPhone-style frame. The app inside is the same Tidepool Shop product list. The top of the frame has a pill-shaped Dynamic Island and the word SIMULATED is under the phone.](/tutorials/run-your-app-on-a-phone/05-iphone.png)

To see the dark frame, add `?dark=1` to the end of the address in your browser, so it looks like `http://127.0.0.1:4600/?dark=1`. The frame and the page behind it turn dark. Your app keeps its own colours.

![The Android phone frame on a dark page. The app inside still has its light colours.](/tutorials/run-your-app-on-a-phone/06-dark.png)

Want a different size? The page scales the phone to fit your browser window, so make the window smaller or larger.

## 7. Stop the phone

Go to the terminal and press **Ctrl+C**. The page stops answering. Your files are not changed. Nothing was sent to anyone.

## What happens to your files

While the phone is on, Shipvo writes a small file called `.shipvo/run.json` in your app folder. It holds the port, the phone type and a secret code that only your computer can use. Shipvo also adds `.shipvo/` to `.gitignore`, so it does not get shared by accident.

## Recap

You ran your app on a simulated phone in your browser with one command, tapped through the shop, saw the system sheet, switched to the iPhone style and stopped it. You used no real phone and no account.

Keep the phone open while you work. Each time you save a file, it shows the change.

## What we measured

On 2026-11-06, on a GitHub Actions Linux runner with Node 22.23, a first start of `shipvo run android` for a new shop app, with an empty cache, bundled 204 modules in 6.0 s and was serving the phone within the 60 seconds we waited. We did not time it more closely than that. A start-to-tappable timing on a clean machine is tracked in issue #676. We took every screenshot in this tutorial from that run.

On 2026-11-10, on a GitHub Actions Linux runner, the test [`packages/cli/test/run-live-reload.test.ts`](https://github.com/shipvo/shipvo/blob/main/packages/cli/test/run-live-reload.test.ts) saved a one-word change in a small app and printed `save-to-visible android: 194 ms` and `save-to-visible ios: 190 ms`: the time from the save to the new text showing in the Android and iPhone frames. A shop app bundles more modules, so its rebuild takes longer. Screenshots 07 and 08 come from a `shipvo run android` session on a shop app.

## Next steps

- [Have an AI assistant test your shop before every release](test-with-an-assistant.md)
- [Run your app on a phone in your browser: all options](../run.md) (including `--port`, `--no-open` and `--native`)
- [Record a demo video of the phone](../record.md)
