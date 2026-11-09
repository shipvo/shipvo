# Wallet

A Shipvo spec app for tickets, receipts and passes. One screen lists them grouped by kind (Tickets, Passes, Receipts), shows an "Expiring soon" list for tickets and passes dated within the next 7 days, and has a "Find a pass form" that narrows every list by title, issuer or notes. The typed actions are `save_pass`, `find_pass`, `delete_pass` and `show_matches`. Passes are saved in the person's phone storage as plain fields, so they are easy to read and move elsewhere.

`find_pass` takes optional text, kind (`ticket`, `receipt` or `pass`) and a `from` and `to` day, and returns matches newest first.

Amounts and barcode text are stored as plain fields.

## Make it yours

In `app.json`:

- `app.id`, `app.name`, `app.icon`: the name and icon people see.
- `theme.palette`: colours.
- `data.passes.fields`: add a field, then add it to the `save_pass` input and `insert` step, and to the "New pass form".
- `data.soon` and the badge text (`"{{ count(soon) }} expiring within 7 days"`): change `7` in both places to change how early a pass counts as expiring soon.
- `actions.*.description`: the text an assistant reads to decide when to use each action.

Check it with `pnpm --filter @shipvo/spec test`.
