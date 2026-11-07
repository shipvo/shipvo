# See your app on a phone in your browser with one command

You will type one command and get a phone, Android or iPhone style, in a browser tab, running your app. You will tap through your shop, look at the pretend Android system sheet, switch to the iPhone style and stop it again. You need no real phone, no Android Studio and no Xcode.

**Level:** beginner. **Time:** about 10 minutes to read and follow. On our test machine the first start took within a minute (see "What we measured" at the end).

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

The page also has a label at the top left that gives the phone size (412 by 915 on Android) and a button at the top right that says **Show Android system sheet**. You will use it in step 4.

## 3. Tap through your shop

Click works like a tap. Do these in the phone:

1. Click **Wool beanie**. You should see its name, its price and the words "A warm hat in undyed wool."
2. Click **Add to cart**, then **Back**, then **Cart**. You should see "Wool beanie x 1", "Total: $24.00" and a **Pay** button.

![The cart screen inside the Android phone. It says Cart, Wool beanie x 1 with a Remove link, Total: $24.00, and a dark Pay button.](/tutorials/run-your-app-on-a-phone/03-cart.png)

Below is a live phone with the finished Tide & Tackle sample shop, so you can try the same moves now. It is not your app.

<div data-shipvo-phone data-app="tide" data-release="latest" data-path="/" data-caption="Try it: add two items to the cart, then open the cart. You should see both items and a total." data-fallback="/tutorials/run-your-app-on-a-phone/02-product.png"></div>

![A product screen in the Android phone. The heading is Wool beanie, the price is $24.00, and there is an Add to cart button.](/tutorials/run-your-app-on-a-phone/02-product.png)

> **If something goes wrong.** A click does nothing: wait two seconds and click again. The page is a copy of your app, and the first click can arrive while it is still loading. If the phone stays blank, reload the browser tab.

## 4. See the system sheet

On a real phone, some questions come from the phone itself, not from your app. An example is "Allow access?" when an app asks for your location. The simulated phone can show this too, so you can see how your app looks while it is covered.

Click **Show Android system sheet** at the top right of the page. You should see the screen go grey and a white sheet rise from the bottom with the question **Allow access?** and two buttons, **While using the app** and **Don't allow**. Click one to close it.

![The cart screen dimmed behind a white sheet at the bottom of the phone. The sheet asks Allow access? and has two buttons, While using the app and Don't allow.](/tutorials/run-your-app-on-a-phone/04-system-sheet.png)

## 5. Change a word and watch the phone update

Leave the phone running. While it runs, Shipvo watches your app's files. When you save a change, it rebuilds your app by itself and reloads the phone. You do not stop and start anything.

1. Open your app's folder in a text editor (Notepad, TextEdit or any code editor). Open the file `src/data/products.json`. It is a plain list of your products.
2. Find `"name": "Wool beanie"` and change the words inside the quotes to `Merino beanie`. Keep the quote marks. Save the file.
3. Look at the terminal. After a few seconds it prints one line, like `rebuilt in 6.6 s`.
4. Look at the phone. The product in the list now says **Merino beanie**. The page did not change address and you did not click anything.

![The Android phone showing the Tidepool Shop list. The fourth product now reads Merino beanie, $24.00.](/tutorials/run-your-app-on-a-phone/08-after-edit.png)

Now make a mistake on purpose, to see what Shipvo does. In the same file, delete the comma straight after `"name": "Merino beanie"`, so the line ends with a quote mark, and save. The phone keeps showing your last good version. A small red bar appears at the bottom of the phone and the terminal prints the same message, for example `Your file src/data/products.json has a mistake at line 23, column 26: check for a missing or extra comma.`

![The same phone with a red message bar at the bottom. It says the file src/data/products.json has a mistake at line 23, column 26, and that the page still shows your last good version.](/tutorials/run-your-app-on-a-phone/09-error-bar.png)

Put the comma back and save. The red bar goes away and the phone reloads.

> **If something goes wrong.**
> - Nothing changes after you save: check that the terminal still shows the `Watching for changes` line and that you saved the file (most editors show a dot on an unsaved tab).
> - The red bar is there: read the message. It names the file and the line. Fix that line and save again.
> - The rebuild takes a while: a bigger app takes longer. The phone stays usable while it works.

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

You ran your app on a simulated phone in your browser with one command, tapped through the shop, saw the system sheet, changed a product name and watched the phone update, switched to the iPhone style and stopped it. You used no real phone and no account.

Every time you save a change while the phone is on, it updates by itself.

## What we measured

On 2026-11-07, on a GitHub Actions Linux runner, we saved a name change in `src/data/products.json` while `shipvo run android` was open. The terminal printed `rebuilt in 6.6 s` and the phone showed the new name. A file with a missing comma printed the error and showed the red bar, and the fixed file reloaded the phone (`rebuilt in 6.9 s`). The screenshots in step 5 come from that run. The browser test `packages/cli/test/run-live-reload.test.ts` checks the same behaviour on the Android and iOS frames.

On 2026-11-06, on a GitHub Actions Linux runner with Node 22.23, a first start of `shipvo run android` for a new shop app, with an empty cache, bundled 204 modules in 6.0 s and was serving the phone within the 60 seconds we waited. We did not time it more closely than that. A start-to-tappable timing on a clean machine is tracked in issue #676. We took every screenshot in this tutorial from that run.

## Next steps

- [Have an AI assistant test your shop before every release](test-with-an-assistant.md)
- [Run your app on a phone in your browser: all options](../run.md) (including `--port`, `--no-open` and `--native`)
- [Record a demo video of the phone](../record.md)
