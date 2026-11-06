# Launch kit: Shipvo Phone apps (Store, Settings, Browser, updates)

Drafts for the owner to post. Every statement is from `docs/phone-apps.md`, `docs/phone-updates.md` and `changes/466-*.md`, `changes/524-*.md`; no numbers are claimed.

Links: [docs](../../phone-apps.md), [features page](https://shipvo.dev/features/).

## X post (under 280 characters)

Shipvo Phone now has a Store, a Settings screen, a Browser and OTA update states. Your agent sets dark mode, text size and language, opens a web page, installs a second app, and checks an update applies or reverts. https://shipvo.dev/docs/phone-apps/

## LinkedIn post

A phone is more than your app.

Shipvo Phone, the simulated phone in your browser, now has the parts around it. Your AI agent can:

- change dark mode, text size, bold text and language, and see how your app reacts
- open a web page in the phone's own Browser, for example a payment page, and come back to the app
- install a second app from the Store and switch between apps
- check for an update, apply it, and watch it revert after 3 failed boots

Every one of these is labelled Simulated and recorded in the device log.

Ask your assistant: "Does the shop still work in dark mode with large text?"

https://shipvo.dev/docs/phone-apps/

## Show HN-style description

Shipvo Phone is a headless phone simulator that AI agents drive over MCP, shown in a phone frame in your browser with `shipvo run`. It now includes Settings (`get_settings`, `set_setting` for dark mode, font size, language and RTL), a Browser (`browser_*` tools, private addresses refused by default), a Store with installed apps (`list_store_apps`, `install_app`, `switch_app`) and OTA update states (`check_for_update`, `apply_update`, revert after 3 failed boots). Docs: https://shipvo.dev/docs/phone-apps/

## 30-second demo script (Video Studio)

1. 0-6 s: `npx shipvo run android` and `npx shipvo run ios`; the Android and iOS phones open in the browser.
2. 6-14 s: Agent calls `set_setting dark_mode true` and `font_size largest`; the shop screen changes.
3. 14-21 s: Agent opens the Store, installs a second app, switches back.
4. 21-27 s: Agent calls `check_for_update` then `apply_update`; the Simulated banner shows "applied".
5. 27-30 s: Caption: "Shipvo Phone. shipvo.dev/docs/phone-apps".
