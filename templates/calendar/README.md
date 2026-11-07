# Calendar

A Shipvo spec app: day and month views, an event form, and the typed actions `create_event`, `list_events` and `delete_event`. Events are saved in the person's phone storage. Times are shown and grouped in the phone's time zone; they are stored as exact instants.

## Make it yours

In `app.json`:

- `app.id`, `app.name`, `app.icon`: the name and icon people see.
- `theme.palette`: colours.
- `data.events.fields`: add a field (for example `notes`), then add it to the `create_event` input and `insert` step, and to the form in the `day` screen.
- `screens`: the `day` list shows today's events; the `month` timeline ("All events") shows every event.
- `actions.*.description`: the text an assistant reads to decide when to use each action.

Check it with `pnpm --filter @shipvo/spec test`.
