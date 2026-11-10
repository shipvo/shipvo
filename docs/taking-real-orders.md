# Taking real orders

This page is for shop owners and the developers who build their shop. You will learn how an order moves from "received" to "paid" and how to mark it paid.

Shipvo stores the orders your app sends. You decide when an order is really paid, then tell Shipvo.

## Who verifies payment

You do. Shipvo never checks that money arrived. Every new order starts as `unverified`. Check your mobile money or card account, then call `settle` for that order with the owner token. Settling covers every `unverified` row that has that order id.

## Order statuses

| Status | Meaning | Shown as paid? |
| --- | --- | --- |
| `unverified` | Received and price-checked. Payment not confirmed. | No |
| `settled` | You confirmed payment with the owner token (or a signed-in admin session calling the same endpoint). | Yes |
| `price_mismatch` | The prices or total did not match your published content. | No |
| `simulated` | A test order sent with `simulated: true`. | No |

The admin Orders tab shows the status next to each order.

## Idempotency

Sending the same order twice from the same install returns the first result with `duplicate: true` and stores one row. The app may send an `install_id` in the body; without it all callers share one bucket. Orders are also rate limited per IP and per install (HTTP 429).

## Price checks

The server recomputes line prices, promo and delivery fee from the published content version named in `content_version`, and compares the total exactly. A wrong order gets HTTP 422 and is stored as `price_mismatch`. An unknown version or an empty catalogue also gets 422.

## Settle an order

```bash
curl -X POST "$CONTROL_PLANE/app/$APP_ID/api/orders/$ORDER_ID/settle" \
  -H "Authorization: Bearer $OWNER_TOKEN"
```

- `200` with `"status": "settled"`. Calling it again returns `200` with `"already_settled": true` and changes nothing.
- `401` with no token or a wrong token. A publish token is not an owner token and is refused. Nothing changes.
- `409` if the order is `simulated` or `price_mismatch`. These cannot be settled.
- `404` if the order id is unknown.

Each settle is written to the app's audit log with who did it.

## Troubleshooting

| You see | Why | What to do |
| --- | --- | --- |
| Order shows `unverified` after the customer paid | Settling is a step you do. | Check your payment account, then call `settle` for that order id. |
| `401` on settle | No token, a wrong token, or a publish token. | Use the owner token. |
| `409` on settle | The order is `simulated` or `price_mismatch`. | These cannot be settled. For a mismatch, republish your content and ask the customer to order again. |
| `422` on a new order | The total did not match the published content version, or the catalogue is empty. | Publish your content, then retry from the app. |
| `429` on a new order | Too many orders from one IP or install. | Wait and retry. |
| `404` on settle | The order id is wrong. | Check the id you used. |

## Next steps

- [Getting started](getting-started.md) to create a shop and publish it.
- [Device API](device-api.md) for the simulated payment flow you can test before going live.
- [Self-hosting](self-hosting.md) for running the control plane yourself.
