# Files and Photos

A Shipvo spec app for files and photos. One screen lists Photos and Files, each sorted so items in the same album sit together, with the album, added date and size under every name. A "Find an item form" narrows both lists by name, album or notes. The typed actions are `save_file`, `find_files`, `move_to_album`, `delete_file` and `show_matches`. Items are saved in the person's phone storage as plain fields (name, kind, album, size, added date, notes), so they are easy to read and move elsewhere.

`find_files` takes optional text, kind (`file` or `photo`), album and a `from` and `to` day, and returns matches newest first.

## Make it yours

In `app.json`:

- `app.id`, `app.name`, `app.icon`: the name and icon people see.
- `theme.palette`: colours.
- `data.items.fields`: add a field, then add it to the `save_file` input and `insert` step, and to the "New item form".
- `actions.*.description`: the text an assistant reads to decide when to use each action.

Check it with `pnpm --filter @shipvo/spec test`.
