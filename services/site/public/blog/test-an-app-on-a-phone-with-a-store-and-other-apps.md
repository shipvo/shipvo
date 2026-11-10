# Test your app on a phone that has a Store, a Browser and other apps

> Install, hide, pin and schedule apps on Shipvo Phone, on Android and iOS, and test the home screen by the phone's clock. Real calls and output.

By Shipvo team, 2026-11-10. Canonical: https://shipvo.dev/blog/test-an-app-on-a-phone-with-a-store-and-other-apps/

A real phone is never just your app. It has a home screen, a store, a browser, settings and a dozen other apps. Most bugs that users report happen in the gaps between them: the app was opened from a link, a different app was in front, or the home screen did not show what the person expected.

This post shows how to test them on Shipvo Phone, the simulated Android or iOS phone you get in a browser tab. The search phrase we wrote it for is **test a mobile app with other apps installed**. Every call below was run against the simulator in this repo, and the output is what it printed.

## What is on a Shipvo Phone besides your app

Shipvo Phone has a home screen, an app switcher, a lock screen, a notification shade, a Settings app, a Browser and a Store. All of them are in the accessibility tree, so a person can tap them and an AI assistant can read and use them through MCP.

| Part | Tools |
| --- | --- |
| Store | `find_apps`, `list_store_apps`, `install_app`, `uninstall_app` |
| Several apps on one phone | `switch_app`, `pin_app`, `hide_app`, `arrange_apps` |
| Phone clock | `set_phone_time` |
| Settings | `get_settings`, `set_setting` |
| Browser | `browser_open` and the other `browser_*` tools |

The full list, with typed errors, is in the [phone apps guide](https://shipvo.dev/docs/phone-apps/). Two earlier posts cover the Browser ([links that leave your app](https://shipvo.dev/blog/test-links-that-leave-your-app/)) and Settings ([dark mode, large text and right-to-left](https://shipvo.dev/blog/test-dark-mode-large-text-and-rtl-in-react-native/)). This one is about the apps themselves.

## Start from a phone you define

A `phone.json` says what is installed when the simulator starts, so every run begins with the same phone:

```json
{
  "apps": [
    { "id": "plan", "name": "Weekly planner", "url": "fixture://plan" },
    { "id": "wknd", "name": "Weekend plans", "url": "fixture://wknd" },
    { "id": "mail", "name": "Mail", "url": "fixture://mail" }
  ],
  "settings": { "dark_mode": true }
}
```

Put it in the folder where the simulator starts, or pass `--phone <path>`. A bad file fails the session with `bad_profile` and tells you why. An app can carry a `placement` object too, so pinned, hidden and scheduled apps can be part of the starting state.

## Install an app from the Store

The home screen has a Store icon. In a browser tab from `shipvo run` you tap Install. Through MCP you ask for it by need:

```text
find_apps { session, query: "split a bill with friends" }   -> id, name, description, version, installed
install_app { session, id: "splitly" }                      -> its icon appears on the home screen
switch_app { session, id: "splitly" }                       -> it is now current_app
uninstall_app { session, id: "splitly" }                    -> the phone goes home
```

Installing from the marketplace is a real fetch of the published app. `device_log` records the install with `source: "real"` and the `sha256` of the bundle, so a test can check that the bytes it got are the bytes that were published. If the bundle cannot be fetched, the app is not installed and `install_app` returns `store_app_unreachable` (or `too_large`, `host_not_allowed`). `list_store_apps` and `find_apps` return `store_unreachable` when the marketplace cannot be reached, and `install_app` then uses the phone's own Store list. Set `PN_STORE_FIXTURE=1` for a local list of four apps and no network.

## Pin and hide apps, and see what the home screen shows

After a session is open, `arrange_apps` places an app:

```text
arrange_apps { session, id: "mail", pinned: true }
```

The home screen text that came back:

```text
Home screen
Installed apps
- button "Mail" (mail 0.0.0, pinned: switch_app opens it)
- button "Weekend plans" (wknd 0.0.0: switch_app opens it)
- "Weekly planner" (plan): not showing now, scheduled mon,tue,wed,thu,fri 06:00-20:00; switch_app still opens it
```

Pinned apps come first. Then come apps by `position`, then install order. A hidden app leaves the home screen and the app list, but it keeps its data and `switch_app` still opens it. That matters for a test: "the app is not on the home screen" and "the app is gone" are different states, and now you can check each one.

## Show an app only at certain times, and test it with a fake clock

Some apps should appear only when they are useful. A weekly planner belongs on weekdays. Weekend plans belong on Saturday. `arrange_apps` takes a `schedule`:

```text
arrange_apps { session, id: "plan", schedule: { days: ["mon","tue","wed","thu","fri"], from: "06:00", to: "20:00" } }
arrange_apps { session, id: "wknd", schedule: { days: ["sat","sun"] } }
```

To test it without waiting for Saturday, set the phone's clock with `set_phone_time`. We set it to Monday 9 Nov 2026, 09:00:

```text
set_phone_time { session, at: "2026-11-09T09:00:00" }
```

```text
- button "Weekly planner" (plan 0.0.0: switch_app opens it)
- button "Mail" (mail 0.0.0: switch_app opens it)
- "Weekend plans" (wknd): not showing now, scheduled sat,sun 00:00-23:59; switch_app still opens it
```

Then Saturday 14 Nov at 09:00:

```text
- button "Weekend plans" (wknd 0.0.0: switch_app opens it)
- button "Mail" (mail 0.0.0: switch_app opens it)
- "Weekly planner" (plan): not showing now, scheduled mon,tue,wed,thu,fri 06:00-20:00; switch_app still opens it
```

The planner swapped out for the weekend plans. A window that crosses midnight belongs to the day it starts, so `days: ["fri"], from: "22:00", to: "06:00"` shows Friday 22:00 until Saturday 06:00. In `shipvo run` the home screen follows your computer's clock and updates when a schedule starts or ends.

Errors are typed, so a test can assert them:

```text
arrange_apps { session, id: "ghost", pinned: true }   -> not_installed: 'ghost' is not installed
set_phone_time { session, at: "tomorrow-ish" }        -> bad_time: at must be a time like 2026-11-14T09:00:00, or null
```

Every change is also in `device_log`, with `simulated` set on the ones that only change state, so you can read back exactly what the test did.

## Check that an update keeps what people typed

An app on a phone gets updated. `update_app { session, id, spec }` replaces an app's spec as a new version; entered data and settings stay, and a bad spec changes nothing. To check that data survives, call `export_phone_apps { session }` before and after the update and compare the `data` of each app. `import_phone_apps` recreates the apps on another phone, Android and iOS styles alike.

## Why this is worth doing

- **You test what the user has.** A phone with five apps behaves differently from a phone with one.
- **You test the state, not the story.** Hidden, pinned, scheduled and uninstalled are four different states, each readable in the tree.
- **It is fast and repeatable.** The same `phone.json` and the same fake clock give the same home screen every run.
- **Android and iOS use the same calls.** Pass `style: "ios"` or open the page with `&skin=ios`; the tools do not change.

## Next steps

1. Run `npx shipvo run android` or `npx shipvo run ios`, and open the Store icon on the phone. The [run guide](https://shipvo.dev/docs/run/) has the details.
2. Write a `phone.json` for the phone your users have, and read the [phone apps guide](https://shipvo.dev/docs/phone-apps/).
3. Ask your assistant to install an app, set the clock to Saturday, and report what the home screen shows. The [assistant tutorial](https://shipvo.dev/docs/test-with-an-assistant/) shows how to connect it.

If you want the Browser side of the same phone, read [Test the links that leave your app](https://shipvo.dev/blog/test-links-that-leave-your-app/).
