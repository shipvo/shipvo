# Calendar

A Shipvo spec app: a Day tab (today, or a date you pick), a Month tab (last, this or next month), an event form, and the typed actions `create_event`, `list_events`, `show_day` and `delete_event`. Events are saved in the person's phone storage. Times are shown and grouped in the phone's time zone; they are stored as exact instants.

## Make it yours

In `app.json`:

- `app.id`, `app.name`, `app.icon`: the name and icon people see.
- `theme.palette`: colours.
- `data.events.fields`: add a field (for example `notes`), then add it to the `create_event` input and `insert` step, and to the form in the `day` screen.
- `screens`: the `day` screen lists one day and has a "Pick a day form"; the `month` screen lists the month chosen with the "Month" control.
- `actions.*.description`: the text an assistant reads to decide when to use each action.

Check it with `pnpm --filter @shipvo/spec test`.
