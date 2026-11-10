# Make a shop app with your own products and prices

You will create a shop app from the shop template, open it on a simulated phone in your web browser, replace the sample products with your own, add a product, and check that a release is ready to send. You need no phone and you do not need to know how to code. You will edit one text file.

**Level:** beginner. **Time:** the commands run in about two minutes on our test machine (see "What we measured" at the end). Editing your own products takes as long as you like. If you have not used a terminal before, do [Create your first app](first-app.md) first: this page assumes you have Node 22 and can open a terminal.

New words are explained once, and collected in the [glossary](../glossary.md).

## What you need

- A computer (Mac, Windows or Linux) and an internet connection.
- **Node**, version 22 or newer ([step 1 of the first tutorial](first-app.md#1-open-a-terminal-and-check-node) shows how to check it).
- A web browser and a text editor. Notepad, TextEdit or VS Code all work.
- A list of 3 to 6 things you want to sell, each with a name, a short description and a price.

## 1. Create the shop

A **template** is a ready-made app that you change into your own. The shop template has a list of products, a page for each product and a cart with a total. Open a terminal and type this. The `--name` is the name your customers see.

```bash
npx -y @shipvo/cli init sandbar --template shop --name "Sandbar Shop"
```

You should see `Created Sandbar Shop in sandbar`. Shipvo also made a **signing key**, a secret file at `sandbar/.shipvo/seed.txt`. Phones use it to check that an update really came from you. Do not share it, and copy it somewhere safe such as a password manager.

Now go into the folder and download the pieces the app is made from:

```bash
cd sandbar
npm install
npx playwright install chromium
```

Each command ends when you get your prompt back. The first one takes the longest.

> **If something goes wrong.** Run `npx shipvo doctor` inside the `sandbar` folder. It prints one line per check. A line that starts with `FAIL` ends with the exact fix. When everything is fine, every line says `PASS`.

## 2. See the shop on a simulated phone

A **simulator** is a copy of a phone that runs on your computer. Start it in a way that watches for your changes:

```bash
npx shipvo sim --watch
```

Wait until you see `Simulator on http://localhost:4545/app/`. Leave this terminal window open. Then open your browser and go to:

```text
http://localhost:4545/app/
```

You should see "Sandbar Shop" with five products and a **Cart** link.

The phone below is the finished Tide & Tackle sample shop, not your Sandbar Shop. Try it to see how a shop app works: open a product and add it to the cart.

<div data-shipvo-phone data-app="tide" data-release="latest" data-path="/" data-caption="Try it: the Tide & Tackle sample shop (not your Sandbar Shop)" data-fallback="/tutorials/your-own-shop/01-starter-list.png"></div>

![The shop template on a 390 by 844 phone screen. The heading says Sandbar Shop. Below it are five products with prices: Canvas tote $18.00, Enamel mug $12.00, Pocket notebook $6.50, Wool beanie $24.00 and Steel bottle $29.00.](/tutorials/your-own-shop/01-starter-list.png)

Click a product, click **Add to cart**, click **Back**, then click **Cart**. You should see the product and a total. Nothing is charged: this template has no payment step yet.

> **If something goes wrong.**
> - `Port 4545 is in use`: the simulator is already running in another window. Close that window, or press Ctrl + C in it, and try again.
> - A blank page: wait ten seconds and reload. The first build is the slowest.
> - You see `{"error":"not found"}`: add `/app/` to the end of the address.

## 3. Put in your own products

Your products live in one file: `src/data/products.json` inside the `sandbar` folder. Open it in your text editor. Each product is a block like this:

```json
{
  "id": "canvas-tote",
  "name": "Canvas tote",
  "price": 1800,
  "description": "A sturdy cotton bag with a long strap."
}
```

- `id`: a short name with no spaces. Customers never see it. Each product needs a different one.
- `name`: what customers see on the list. Give every product a different name, and do not make one name a part of another, for example "Mug" and "Mug set".
- `price`: the price **in cents**, with no dollar sign and no dot. `650` shows as `$6.50`. `1800` shows as `$18.00`.
- `description`: one or two sentences on the product page.

This file is **JSON**, a plain way to write a list. Keep the quote marks, the curly brackets `{ }` and the commas exactly as they are. Every block ends with `},` except the last, which ends with `}`.

Replace the whole file with your own products. This example sells fish:

```json
[
  {
    "id": "tilapia",
    "name": "Fresh tilapia",
    "price": 650,
    "description": "One kilo, cleaned and ready to cook. Caught this morning."
  },
  {
    "id": "shrimp",
    "name": "River shrimp",
    "price": 900,
    "description": "Half a kilo of small, sweet shrimp."
  },
  {
    "id": "smoked-catfish",
    "name": "Smoked catfish",
    "price": 800,
    "description": "Smoked over wood. Keeps for a week without a fridge."
  },
  {
    "id": "pepper-sauce",
    "name": "Pepper sauce",
    "price": 300,
    "description": "A small jar of hot pepper sauce, made in our kitchen."
  }
]
```

Save the file. In the terminal, wait for `rebuilt in` and a number of seconds (about 8 on our machine). Then reload `http://localhost:4545/app/`. The page does not reload by itself.

![The shop after the edit. Four products: Fresh tilapia $6.50, River shrimp $9.00, Smoked catfish $8.00 and Pepper sauce $3.00.](/tutorials/your-own-shop/04-edited.png)

Click **Smoked catfish** to see its page.

![The Smoked catfish page with its price, its description and an Add to cart button.](/tutorials/your-own-shop/05-edited-product.png)

> **If something goes wrong.** If the old products are still there, check that you saved the file, that the terminal printed `rebuilt in`, and that you reloaded the page. If the terminal prints `build failed, still serving the last good build` and a long block of text, look at its first line. It names `src/data/products.json` and a line and column. The usual cause is a missing comma or a missing quote mark. Compare your file with the example above. The page keeps showing your last good version until the file is right.

## 4. Add a product and change a price

Add a fifth product. Copy one block, paste it after the last one, and put a comma after the `}` of the block before it:

```json
  {
    "id": "grilled-bream",
    "name": "Grilled bream",
    "price": 1250,
    "description": "Grilled over charcoal, with plantain."
  }
```

Then change a price: find `"price": 650` and make it `"price": 700`. Save, wait for `rebuilt in`, reload the page. Fresh tilapia now shows `$7.00`.

> **If something goes wrong.** The same as step 3. Most mistakes here are a comma missing between two blocks, or a comma left after the last block.

## 5. Check the cart

Open the app again. Click **Fresh tilapia**, **Add to cart**, **Back**, **River shrimp**, **Add to cart**, then **Cart**. The cart lists both, and the total adds up.

The phone below is still the Tide & Tackle sample shop. It does not have your Fresh tilapia or River shrimp. Try adding any two of its products, then open the cart.

<div data-shipvo-phone data-app="tide" data-release="latest" data-path="/" data-caption="Try it: add two sample products, then open the cart" data-fallback="/tutorials/your-own-shop/06-edited-cart.png"></div>

![The cart on the phone screen. It lists Fresh tilapia x 1 and River shrimp x 1, each with a Remove link. The total reads $15.50.](/tutorials/your-own-shop/06-edited-cart.png)

Your shop came with two tests. They open the app in the simulator, check that every product from your file is on the list, and add products to the cart and check the total. Because the tests read your file, they keep working when you change it. Stop the simulator by clicking its window and pressing Ctrl + C, then start it again without watching and run the tests in a second terminal:

```bash
npm run sim
```

In the second terminal window, in the same `sandbar` folder:

```bash
npm test
```

You should see `2 passed`.

> **If something goes wrong.** If a test fails with a name from your list, two of your product names probably overlap, such as "Mug" and "Mug set". Make each name different. If every test fails with a connection error, the simulator is not running: start it first.

## 6. Check that a release is ready

A **release** is one numbered version of your app that phones can download. A **dry run** does all the work of a release but sends nothing, so it is safe. Stop the simulator with Ctrl + C and run:

```bash
npx shipvo publish --dry-run --skip-web true
```

You should see this at the end:

```text
Dry run complete. Nothing was sent.
  Release:  1
  Size:     1.50 MB
  Files:    .shipvo/dry-run
```

Shipvo built your app, signed it with your key and wrote the result to `.shipvo/dry-run`. To check the signature:

```bash
npx shipvo verify .shipvo/dry-run/p/sandbar/1/b2
```

You should see `valid`.

> **If something goes wrong.** If it says `Nothing to publish with`, you left out `--dry-run`. For any other failure, run `npx shipvo doctor`.

## Recap

You:

1. created a shop from the shop template,
2. opened it on a simulated phone,
3. put in your own products and prices by editing one file,
4. added a product and changed a price,
5. checked the cart and ran the tests,
6. built and checked a release without sending it.

## Change the currency

Prices show in dollars until you change `src/data/shop.json`. Set `currency`, `position` (`before` or `after`), `decimals` and `locale`. For FCFA: `{ "currency": "FCFA", "position": "after", "decimals": 0, "locale": "fr-FR" }` shows `6 500 FCFA`. Prices in `products.json` stay whole minor units (6500 with `decimals` 0).

## Troubleshooting

- **The terminal prints `[shop] Fresh tilapia: price 6.5 is not a whole number...` or `...is less than one whole unit...`.** A price is written in dollars, not cents. Write `650` for $6.50 and `2400` for $24.00. The message tells you the number to use. `npm test` fails on the same check until you fix it.

## What we measured

On 2026-11-05, on a GitHub Actions Linux runner with Node 22, packages built from this repository: `npm install` took 34 s, `npx playwright install chromium` 8 s, the first `npx shipvo sim --watch` about 10 s until the page answered, a rebuild after an edit about 8 s, `npm test` about 6 s, and `shipvo publish --dry-run --skip-web true` 11 s. Your times depend on your connection. We did not time how long a first-time reader takes.

## Next steps

- Put the app on a real Android phone and send updates to it: [Build your first app](../getting-started.md), steps 4 and 5.
- Ask Claude or ChatGPT to shop in your app and tell you where it is confusing: [Test with an assistant](../test-with-an-assistant.md).
- Keep your signing key safe: [Moving to a new machine](../new-machine.md).
