# First-party apps research: what leaders do and what users dislike

Slice 1 of #843. Research only, no code. Date of data: 2026-11-06.

The goal is to choose the first five apps for the simulated phone (notes and tasks, calendar, wallet and passes, files and photos, shopping) and the typed actions an assistant can call on each. We take patterns only. We copy no design, icons or text. Review excerpts are short, quoted with a link, and used as evidence.

## How the data was gathered

- **Leaders.** For each category we ran the store search for the category terms (`notes`, `to do list`, `calendar`, `wallet`, `file manager`, `photos gallery`, `shopping`) and took the first 10 results per term, per store, per country. Stores: App Store (iTunes Search API) and Google Play (`google-play-scraper` search). Countries: US, UK, Germany, Brazil, Japan, India. We then counted how many country lists each app appeared in.
- **Complaints.** For 3 to 4 leading Google Play apps per category we read up to 150 of the newest reviews per country and kept those with 1 or 2 stars. Raw count: 3,984. After removing duplicates: 2,666. Counts per category below use the unique reviews, matched by keyword. They are rough, not a survey.
- **App Store charts.** We also read the App Store top-free charts (Productivity, Utilities, Photo & Video, Shopping) in the same six countries. They are useful for shopping and photos. For productivity they are dominated by AI assistants (ChatGPT, Claude, Gemini, Copilot), so they do not rank notes or calendar apps.

Limits you should know about:

- The review fetch returned the same English-language reviews for the US, UK and India, so the review pool covers four distinct locales in practice: US/UK/IN English, Germany, Brazil and Japan. Unique 1 and 2-star reviews per locale, in the order US/UK/IN, DE, JP, BR: notes 128, 217, 177, 81; calendar 164, 154, 143, 61; wallet 145, 207, 109, 111; files 58, 89, 123, 32; shopping 164, 176, 176, 151.
- The App Store review feed was used only for chart discovery, not for quotes. All quoted reviews are from Google Play.
- Apple's own apps (Notes, Reminders, Calendar, Wallet, Files, Photos) have no public reviews, so we cannot quote complaints about them. They appear in rankings only where search returned them.
- Keyword counts can match one review under several themes. Non-English reviews were counted but only English ones are quoted.
- Reviews are a sample of the newest reviews on the day. They show what is loud right now.
- App Store chart data (2026-11-06) is read from `https://itunes.apple.com/{cc}/rss/topfreeapplications/limit=10/genre={id}/json` with genre ids 6007, 6002, 6008, 6024. Search data is from `https://itunes.apple.com/search?term=...&country=...&entity=software&limit=10`.

## 1. Notes and tasks

**Leaders.** Number of the 6 country lists each app appeared in (Google Play unless noted):

| App | Lists |
| --- | --- |
| [Google Keep](https://play.google.com/store/apps/details?id=com.google.android.keep) | 12 (two search terms) |
| [ColorNote](https://play.google.com/store/apps/details?id=com.socialnmobile.dictapps.notepad.color.note) | 7 |
| [Samsung Notes](https://play.google.com/store/apps/details?id=com.samsung.android.app.notes) | 6 |
| [Google Tasks](https://play.google.com/store/apps/details?id=com.google.android.apps.tasks) | 6 |
| [Microsoft To Do](https://play.google.com/store/apps/details?id=com.microsoft.todos) (also on App Store) | 6 and 6 |
| [Todoist](https://play.google.com/store/apps/details?id=com.todoist) | 6 |
| [TickTick](https://play.google.com/store/apps/details?id=com.ticktick.task) | 6 |
| [Microsoft OneNote](https://play.google.com/store/apps/details?id=com.microsoft.office.onenote) | App Store 6 |
| [Any.do](https://play.google.com/store/apps/details?id=com.anydo) | 5 |

**What the leaders do (patterns).** A note is a list of cards or a flat list with a title, body, and a checklist mode. Tasks have a due date, a reminder, a list and a "done" state. Notes and tasks share one account and sync across devices. Sharing a list with another person is a main feature. A home-screen widget is expected. Pro tiers sell reminders, labels and sharing limits. Source: the listings above.

**Most common complaints** (1 and 2 stars; 603 unique reviews; of these about 55 mention sync or lost data, 36 sign-in or account, 38 bugs or slowness, 33 updates or redesigns, 24 reminders):

- Saving and sync break, and data goes missing. "Keep Notes doesn't work correctly. I've synced it several times, installed, -uninstalled. I've had it several years, but now can't save lists." ([Google Keep, US](https://play.google.com/store/apps/details?id=com.google.android.keep&reviewId=17377222-1e71-46b0-983d-098eb8f66aa6))
- Updates remove features. "sharing option is gone in the new update. I can't see collaborators option to share notes." ([Google Keep, US](https://play.google.com/store/apps/details?id=com.google.android.keep&reviewId=2ad99aab-a72c-4abf-9ffa-0ec7e12b508d))
- Accounts block sharing. "I can't join or share lists because it says I have an organization account, which is not true" ([Microsoft To Do, US](https://play.google.com/store/apps/details?id=com.microsoft.todos&reviewId=e5e1df11-dab8-490e-9744-56a983689838))
- Reminders are weak. "app doesn't have an reminder tone. just it appears in notification" ([Microsoft To Do, US](https://play.google.com/store/apps/details?id=com.microsoft.todos&reviewId=daa283ad-e2e6-47cf-9a7f-d53a819d7e48))
- Widgets are unreliable. "Widget flackert, das macht die app fast unbrauchbar" (the widget flickers, which makes the app nearly unusable) ([Microsoft To Do, DE](https://play.google.com/store/apps/details?id=com.microsoft.todos&reviewId=740314da-d17c-4b0f-a840-ff19fc2ecfb7))
- Cancelling a paid plan is hard. "can't cancel pro version I've bought, can't reach support, it is not in Google subscription." ([Todoist, US](https://play.google.com/store/apps/details?id=com.todoist&reviewId=7496fcb5-5dbc-4369-988b-af90842f8b40))

**What an assistant needs.**

- State: list of notes (id, title, body text, checklist items, labels, pinned, archived, updated time), list of tasks (id, title, notes, due, reminder, list, done, repeat), the lists themselves, sync status.
- Actions: create, read, edit and delete notes and tasks; tick items; set due and reminder; move between lists; search.
- Data: seeded notes and tasks with due dates in the past, today and later; a repeating task; a checklist note.

**Typed actions to ship.** `notes.list`, `notes.get`, `notes.create`, `notes.update`, `notes.delete` (to trash), `notes.restore`, `notes.pin`, `notes.search`, `checklist.toggle`, `tasks.list`, `tasks.create`, `tasks.update`, `tasks.complete`, `tasks.reopen`, `tasks.setDue`, `tasks.setReminder`, `tasks.move`. Each result should say whether the change is saved, so a test can check the "can't save" failure above.

## 2. Calendar

**Leaders.** Lists in which each app appeared:

| App | Lists |
| --- | --- |
| [Google Calendar](https://play.google.com/store/apps/details?id=com.google.android.calendar) (also on App Store) | 6 and 2 |
| [Samsung Calendar](https://play.google.com/store/apps/details?id=com.samsung.android.calendar) | 6 |
| [Business Calendar 2](https://play.google.com/store/apps/details?id=com.appgenix.bizcal) | 6 |
| [Jorte](https://play.google.com/store/apps/details?id=jp.co.johospace.jorte) | 6 |
| [TimeTree](https://play.google.com/store/apps/details?id=works.jubilee.timetree) (also top 10 Productivity in Japan on the App Store) | 5 |
| [Proton Calendar](https://play.google.com/store/apps/details?id=me.proton.android.calendar) | 5 |
| Apple Calendar | App Store 3 |

**What the leaders do.** Month, week, day and agenda views. Events have title, start, end, all-day, place, repeat, guests, reminders. Several calendars (work, home, shared) with colours that can be turned on and off. Invitations with accept, maybe, decline. TimeTree and Jorte lead in Japan with shared family calendars.

**Most common complaints** (522 unique reviews; about 37 sync, 34 sign-in, 38 update or redesign, 18 reminders, 11 bugs):

- Sync stops. "my app is not updating google provider should solve this issue" ([Google Calendar, US](https://play.google.com/store/apps/details?id=com.google.android.calendar&reviewId=29bc9e6e-028c-44e8-a095-f96d298212c9))
- Freezes. "the app freezes, it does not populate." ([Google Calendar, US](https://play.google.com/store/apps/details?id=com.google.android.calendar&reviewId=fa102257-b1ff-40af-92af-0f21b52b121b))
- Reminders are hard to set and do not stay saved. One reviewer says the setting "kee0s reverting and not saving" ([Samsung Calendar, US](https://play.google.com/store/apps/details?id=com.samsung.android.calendar&reviewId=5c40023b-5259-4738-aad6-1dffb8e11932)).
- Third-party accounts fail. "Doesn't sync o365 or allow it to sign in." ([Business Calendar 2, US](https://play.google.com/store/apps/details?id=com.appgenix.bizcal&reviewId=fc69c934-d5b1-4dd2-9bcd-f9c0e63b0ffd))
- Ads and shrinking free tiers. "Atrocious unskippable full screen ads in the free version." ([Business Calendar 2, US](https://play.google.com/store/apps/details?id=com.appgenix.bizcal&reviewId=b27b2b81-d9c0-48d5-ace8-016f2bb7e1a1))
- Redesigns. "new design sucks! don't look elegant anymore." ([Samsung Calendar, US](https://play.google.com/store/apps/details?id=com.samsung.android.calendar&reviewId=c3b6ffc7-0de5-4ce2-8865-463aad3147c6))

**What an assistant needs.**

- State: visible range and view, calendars (id, name, colour, visible), events, invitations pending, time zone, "now".
- Actions: find free time, create and edit events, answer invitations, change reminders.
- Data: events across two calendars, an all-day event, a repeating event, an overlap, an event in another time zone, one pending invitation. A controllable clock is key.

**Typed actions to ship.** `calendar.listCalendars`, `calendar.setVisible`, `events.list` (range), `events.get`, `events.create`, `events.update`, `events.delete`, `events.setReminder`, `events.respond` (accept, maybe, decline), `calendar.findFree` (duration, range), `calendar.goTo` (date, view).

## 3. Wallet and passes

**Leaders.** The wallet lists are split between payment wallets and crypto wallets; crypto wallets are out of scope. Payment and pass wallets:

| App | Lists |
| --- | --- |
| [Samsung Wallet](https://play.google.com/store/apps/details?id=com.samsung.android.spay) | 6 |
| [Google Wallet](https://play.google.com/store/apps/details?id=com.google.android.apps.walletnfcrel) | 5 |
| [Apple Wallet](https://apps.apple.com/us/app/apple-wallet/id1160481993) | App Store 6 |
| [Nect Wallet](https://apps.apple.com/de/app/nect-wallet/id1331065474) (ID wallet; #2 Productivity, Germany) | chart |
| [DigiLocker](https://apps.apple.com/in/app/digilocker/id1320618078) (documents; #4 Productivity, India) | chart |
| [Aadhaar](https://apps.apple.com/in/app/aadhaar/id6744029871), [マイナアプリ](https://apps.apple.com/jp/app/id1476359069) (government IDs; Utilities charts, India and Japan) | chart |

**What the leaders do.** Cards (payment, loyalty, membership), tickets and boarding passes with a barcode or QR, ID documents, keys. A pass shows a code the user can scan, an expiry, and updates pushed by the issuer (gate, delay). Tap to pay needs the phone unlocked. Government and ID wallets lead in Germany, India and Japan, so the pass idea is wider than cards.

**Most common complaints** (572 unique reviews; about 74 about tap or card problems, 56 about updates, 27 bugs, 26 pricing or paid plans, 18 support or cancel):

- Payment fails at the till. "having issues when going to pay, not working and having to pull out my physical card. no issues before the update" ([Google Wallet, US](https://play.google.com/store/apps/details?id=com.google.android.apps.walletnfcrel&reviewId=2418ec0d-693d-4e66-8e6b-fadc5b43b9c2))
- Too many steps to pay. "open app, tap to pay, put in pin, tap to pay again. Why not open app, put in pin, tap to pay." ([Google Wallet, US](https://play.google.com/store/apps/details?id=com.google.android.apps.walletnfcrel&reviewId=6f99418e-b2d1-4f6e-9ff9-d9c24b38af51))
- Account errors with no way out. "Says my account is encrypted, sends me to link that offers no way to fix it." ([Google Wallet, US](https://play.google.com/store/apps/details?id=com.google.android.apps.walletnfcrel&reviewId=2ca2978f-d343-49f1-aea3-47bd1827ce0c))
- Card selection redesign. "redesign zur kartenauswahl absolut schlechte usability" (card picker redesign, very bad usability) ([Google Wallet, DE](https://play.google.com/store/apps/details?id=com.google.android.apps.walletnfcrel&reviewId=9a6a9c89-fe04-4176-8e75-16455da8142b))
- Slower after an update. "new update have slowed the speed of payment pls immediately roll back the update" ([Samsung Wallet, US](https://play.google.com/store/apps/details?id=com.samsung.android.spay&reviewId=22e04e25-45df-4180-b0c6-ceb6e6a38016))
- Notification spam. "kept spamming me with notifications to make shopping more secure for a couple months until I eventually uninstalled it." ([Google Wallet, US](https://play.google.com/store/apps/details?id=com.google.android.apps.walletnfcrel&reviewId=0e136804-0721-4281-aa54-e707473fd86f))

**What an assistant needs.**

- State: list of passes (kind, issuer, label, last four digits only, barcode payload, valid from and to, state), default card, lock state.
- Actions: add, remove and reorder passes; set default; show a pass code; simulate a tap result.
- Data: a card, a boarding pass with a gate change, an event ticket that expires, a loyalty card, an expired pass. Never real card numbers.

**Typed actions to ship.** `wallet.listPasses`, `wallet.getPass`, `wallet.addPass` (from a pass file), `wallet.removePass`, `wallet.setDefault`, `wallet.showCode`, `wallet.pay` (to a simulated terminal; returns `approved`, `declined` or `needs_unlock`), `wallet.listTransactions`, `wallet.updatePass` (issuer push, simulated).

## 4. Files and photos

**Leaders.**

| App | Lists |
| --- | --- |
| [Google Photos](https://play.google.com/store/apps/details?id=com.google.android.apps.photos) (also App Store; top 10 Photo & Video in the US, UK, Germany, Brazil, India and Japan) | Play 6, chart 6 of 6 |
| [Files by Google](https://play.google.com/store/apps/details?id=com.google.android.apps.nbu.files) | 6 |
| [Cx File Explorer](https://play.google.com/store/apps/details?id=com.cxinventor.file.explorer) | 6 |
| [Amazon Photos](https://play.google.com/store/apps/details?id=com.amazon.clouddrive.photos) | 6 |
| [Google Drive](https://apps.apple.com/us/app/google-drive/id507874739) | Productivity chart, US, Brazil, India, Japan |
| [File Manager](https://play.google.com/store/apps/details?id=com.alphainventor.filemanager) | many generic results |

**What the leaders do.** Photos: a timeline grouped by day, albums, backup status, search by text or person, edit, share, delete with a trash. Files: browse folders, sort, copy, move, rename, delete, share, storage meter, cleanup suggestions.

**Most common complaints** (302 unique reviews, fewer than other categories; about 15 updates or redesigns, 8 storage or backup, 5 sync, 5 bugs):

- Storage fills up and the cloud plan is the fix. "terrible app that literally just seeks to take all your space until you pay for more" ([Google Photos, US](https://play.google.com/store/apps/details?id=com.google.android.apps.photos&reviewId=bc30892d-6ee6-4724-8b80-164e67a95894))
- Files lost after a move or rename. "It deletes few files automatically.I lost my many important documents that i renamed or moved to another folder using this app." ([File Manager, US](https://play.google.com/store/apps/details?id=com.alphainventor.filemanager&reviewId=594486c2-f53b-40c9-a92e-ba41b072c7fe))
- Search got worse. "the search option especially for text search is completely useless now" ([Google Photos, US](https://play.google.com/store/apps/details?id=com.google.android.apps.photos&reviewId=46b89ca1-2817-4b9e-831c-7067712b9645))
- Settings change by themselves. "Changing features and settings on its own against what the users wanted and what has been set." ([Google Photos, US](https://play.google.com/store/apps/details?id=com.google.android.apps.photos&reviewId=972d7c6e-413d-4211-897d-4b530fe57438))
- Ads in a utility. "now its bloatware with ads" ([File Manager, DE](https://play.google.com/store/apps/details?id=com.alphainventor.filemanager&reviewId=d5d63c2b-c27c-42ef-87c3-cf8973d96adb))
- Friction to empty trash. "I want an easy way to empty trash without having to remember a password" ([Files by Google, US](https://play.google.com/store/apps/details?id=com.google.android.apps.nbu.files&reviewId=cb98afac-8756-4be5-8063-3a3e33ad6d7c))

**What an assistant needs.**

- State: folders and files (path, name, type, size, modified), photo library (id, taken at, album, favourite, backed up), storage used and free, trash.
- Actions: list, search, open, move, rename, delete to trash, restore, share, create album, free up space with a preview of what will go.
- Data: nested folders, a few PDFs, 30 or so photos with dates, a duplicate, a low-storage scenario.

**Typed actions to ship.** `files.list`, `files.search`, `files.stat`, `files.move`, `files.rename`, `files.copy`, `files.delete` (to trash), `files.restore`, `files.emptyTrash`, `storage.usage`, `photos.list` (range, album), `photos.search`, `photos.get`, `albums.create`, `albums.add`, `photos.delete`, `photos.share`, `storage.suggestCleanup` (returns a plan; nothing is removed until `storage.applyCleanup`).

## 5. Shopping

**Leaders.**

| App | Evidence |
| --- | --- |
| [Amazon Shopping](https://apps.apple.com/us/app/amazon-shopping/id297606951) | Top 10 Shopping on the App Store in the US, UK, Germany, Brazil, Japan; Play list 5 |
| [Temu](https://apps.apple.com/us/app/temu-shop-like-a-billionaire/id1641486558) | Top 10 in the US, Brazil, Japan; Play list 5 |
| [AliExpress](https://apps.apple.com/us/app/aliexpress-shopping-app/id436672029) | Top 10 in Brazil and the UK; Play list 5, App Store 4 |
| [SHEIN](https://apps.apple.com/br/app/shein-compras-online/id878577184) | Top 10 in Brazil; Play list 5 |
| [Flipkart](https://apps.apple.com/in/app/flipkart-online-shopping-app/id742044692) | India chart #3; Play list 6 |
| [Mercado Livre](https://apps.apple.com/br/app/mercado-livre-compras-e-11-11/id463624852) | Brazil #2 |
| [Vinted](https://apps.apple.com/us/app/vinted-pre-loved-marketplace/id632064380) | US #1, UK #4, Germany #3 |
| [Shop](https://apps.apple.com/us/app/shop-track-pay-discover/id1223471316) | US, UK, Germany, Japan |
| [Rakuten Ichiba](https://apps.apple.com/jp/app/id419267350), [ZOZOTOWN](https://apps.apple.com/jp/app/id404529222) | Japan |

**What the leaders do.** Search with filters, product page with price, options and reviews, cart, checkout with saved address and payment, order tracking, returns. Regional leaders add groceries in minutes (India), marketplace chat (Vinted, Mercado Livre), live selling and points. Big apps now put an AI assistant in the search box.

**Most common complaints** (667 unique reviews; about 103 about orders, refunds, delivery or support, 24 about AI or assistant features, 21 about price or payment, 11 sign-in or bans):

- Orders arrive short. "I placed a lot of order and paid for my order and only get part of my or or none at all" ([Temu, US](https://play.google.com/store/apps/details?id=com.einnovation.temu&reviewId=d1acd688-f548-4929-a265-ef0170c06a74))
- Surprise charges. "signed me up for prime without my authorization." ([Amazon Shopping, US](https://play.google.com/store/apps/details?id=com.amazon.mShop.android.shopping&reviewId=6a68d5ff-d2bc-45bb-9894-ce8f43ed81ca))
- An assistant in the way of search. "Forced to see the alexa ai information instead of the products and result of my search." ([Amazon Shopping, US](https://play.google.com/store/apps/details?id=com.amazon.mShop.android.shopping&reviewId=5f67629c-03a4-490c-9bf5-8092dfd056a0))
- No way to reach a person. "Unable to contact customer care directly for anything. where is the option in the app for direct chat?" ([Amazon Shopping, US](https://play.google.com/store/apps/details?id=com.amazon.mShop.android.shopping&reviewId=f6ffb0aa-86a7-4622-bfdd-b6738aa744c7))
- Accounts closed without reason. "I was banned twice without any valid reason, and as a result, I was unable to make any purchases." ([Amazon Shopping, US](https://play.google.com/store/apps/details?id=com.amazon.mShop.android.shopping&reviewId=dc980135-31cd-43e6-8ce5-178fae2d4639))
- Search breaks. "Search function is broken, you can't search for anything." ([Amazon Shopping, US](https://play.google.com/store/apps/details?id=com.amazon.mShop.android.shopping&reviewId=87ee4150-8f70-4679-b396-ee6df655ecad))

**What an assistant needs.**

- State: catalogue, current search and filters, product detail, cart (lines, price, tax, shipping), checkout step, orders with status and tracking, return eligibility.
- Actions: search, filter, open a product, add and remove from cart, check out with confirmation, track, return.
- Data: products with options and stock, one out of stock, a sale price, a past order that is late, a returnable order. Payment is simulated only.

**Typed actions to ship.** `shop.search`, `shop.filter`, `shop.getProduct`, `cart.get`, `cart.add`, `cart.update`, `cart.remove`, `checkout.preview` (totals, no charge), `checkout.confirm` (needs the preview id, so an assistant cannot buy by accident), `orders.list`, `orders.get`, `orders.track`, `orders.requestReturn`, `orders.cancel`, `support.contact`.

## Patterns across all five

1. **Sync and "saved" state** is the top complaint for notes, calendar and files. Every write action should return a clear `saved`, `pending` or `failed`. Tests can then check that the app never hides a failed save.
2. **Updates that take features away** show up in all five. Our apps should keep actions stable: an action does not vanish when the screen changes. This is a reason for typed actions over screen scraping.
3. **Money and cancelling** (plans, subscriptions, charges) is the top shopping and wallet problem. Charging actions should be two steps: preview, then confirm.
4. **Sign-in and account blocks** appear in every category. Ship a signed-in and a signed-out state, and an account-problem state.
5. **Notifications and reminders** are both wanted (calendar, tasks) and hated (wallet, ads). Ship a notification per app that can be turned off per kind.

## Final list: actions for each of our five apps

**Notes and tasks:** `notes.list`, `notes.get`, `notes.create`, `notes.update`, `notes.delete`, `notes.restore`, `notes.pin`, `notes.search`, `checklist.toggle`, `tasks.list`, `tasks.create`, `tasks.update`, `tasks.complete`, `tasks.reopen`, `tasks.setDue`, `tasks.setReminder`, `tasks.move`.

**Calendar:** `calendar.listCalendars`, `calendar.setVisible`, `calendar.goTo`, `calendar.findFree`, `events.list`, `events.get`, `events.create`, `events.update`, `events.delete`, `events.setReminder`, `events.respond`.

**Wallet and passes:** `wallet.listPasses`, `wallet.getPass`, `wallet.addPass`, `wallet.removePass`, `wallet.setDefault`, `wallet.showCode`, `wallet.pay`, `wallet.listTransactions`, `wallet.updatePass`.

**Files and photos:** `files.list`, `files.search`, `files.stat`, `files.move`, `files.rename`, `files.copy`, `files.delete`, `files.restore`, `files.emptyTrash`, `storage.usage`, `storage.suggestCleanup`, `storage.applyCleanup`, `photos.list`, `photos.search`, `photos.get`, `photos.delete`, `photos.share`, `albums.create`, `albums.add`.

**Shopping:** `shop.search`, `shop.filter`, `shop.getProduct`, `cart.get`, `cart.add`, `cart.update`, `cart.remove`, `checkout.preview`, `checkout.confirm`, `orders.list`, `orders.get`, `orders.track`, `orders.requestReturn`, `orders.cancel`, `support.contact`.

Names are proposals for the slices that follow. Actions that change data should share the result shape in pattern 1; actions that charge or delete in bulk should use the preview-then-confirm shape in pattern 3.

## What this research did not cover

- Apple's first-party apps have no public reviews, so we have no complaints about them.
- Reviews are from Google Play only. App Store reviews were not read.
- Reviews were gathered in English, German, Japanese and Portuguese. We quoted English and translated German once; the Japanese and Portuguese reviews were counted but not read closely.
- Ranking is by store search order, not by download counts, which the stores do not publish.
