# Launch kit: Describe an app and it appears (`create_app`, `update_app`, `app_activity`)

Drafts for the owner to post. Every statement is from `docs/phone-apps.md` and `changes/1297-*.md`; no numbers are claimed.

Links: [docs](../../phone-apps.md#describe-an-app-and-it-appears), [features page](https://shipvo.dev/features/).

## X post (under 280 characters)

Your agent describes an app and it appears on the phone. `create_app` takes a spec and puts the app on an Android or iOS phone with an icon. `update_app` ships a new version and keeps what people entered. `app_activity` lists what changed. https://shipvo.dev/docs/phone-apps/

## LinkedIn post

What if your AI agent could make a small app and you could hold it a minute later?

On Shipvo Phone, `create_app` takes a short spec and puts the app on the phone, on the Android or the iOS look. It gets an icon on the home screen and opens.

- Every control is labelled, so tap, type and scroll work like in any app.
- A spec with problems is refused, and each problem comes back with its path and a fix.
- `update_app` gives the app a new version. The data and settings a person entered stay.
- `app_activity` lists each version with what changed, such as "added screen 'about'".

Example: ask your agent for a weekly planner, then ask it to add an About screen. The history shows the change and your entries are still there.

https://shipvo.dev/docs/phone-apps/

## Show HN-style description

Shipvo Phone has `create_app { session, id, spec }`: it validates a `shipvo.app/v0` spec, installs the app on the Android or iOS skin and opens it. Apps are HTML with every control labelled, so the same `screen`, `tap`, `type` and `scroll` tools drive them. `update_app` replaces the spec as a new version and keeps entered data; `refresh_app` fetches `http` data sources now; `app_activity` returns each version's change lines, sources and events; `export_phone_apps` and `import_phone_apps` move apps between phones. Docs: https://shipvo.dev/docs/phone-apps/

## 30-second demo script (Video Studio)

1. 0-6 s: Assistant prompt: "Make a weekly planner on the phone." The app icon appears on the home screen and opens.
2. 6-14 s: Tap a day, type a task. The caption reads "Every control is labelled".
3. 14-22 s: Prompt: "Add an About screen." `update_app` runs; the screen changes and the task is still there.
4. 22-27 s: Call `app_activity`; the line "added screen 'about'" shows.
5. 27-30 s: Caption: "Describe an app. It appears. shipvo.dev/docs/phone-apps".
