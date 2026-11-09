# Shop

A Shipvo spec app for a small seller. Four screens: Catalogue (find, add and open products), Product (detail), Cart (choose a product and place an order) and Orders (every order with its status and total). The typed actions are `add_product`, `find_products`, `place_order` and `list_orders`. `set_currency`, `show_matches` and `pick_product` drive the forms on screen.

Prices and order totals use the currency in the `settings` collection (`USD` to start). Change it with `set_currency` or the "Currency form". Each order stores the currency it was placed in. No payment is taken: `place_order` records the order with status `placed` and lowers stock by the quantity. If the product is missing, the quantity is below 1 or stock is too low, it returns status `rejected` and records nothing.

## Make it yours

In `app.json`:

- `app.id`, `app.name`, `app.icon`: the name and icon people see.
- `theme.palette`: colours.
- `data.settings.seed`: the starting currency.
- `data.products.fields`: add a field, then add it to the `add_product` input and `insert` step, and to the "New product form".
- `actions.*.description`: the text an assistant reads to decide when to use each action.

Check it with `pnpm --filter @shipvo/spec test`.
