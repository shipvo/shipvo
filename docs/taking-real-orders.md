# Taking real orders

An order sent by an app or an agent is a claim, not a fact. The control plane stores it, checks the prices, and keeps it `unverified` until **your backend** confirms the payment.

## Who verifies payment

You do. The control plane never sees money. Your payment backend (or the payment provider's callback that you handle) tells the control plane an order is paid:

```bash
curl -X POST https://<control-plane>/app/<app>/api/orders/<order-id>/settle \
  -H "authorization: Bearer $OWNER_TOKEN" \
  -d '{"reference":"mobile-money-receipt-123"}'
```

Only the owner token can settle. The admin cookie, the app and the simulator cannot. Settling twice is safe. A signed provider webhook is not built yet.

## Statuses

| Status | Meaning |
| --- | --- |
| `unverified` | Prices match the published content. Payment is **not** confirmed. |
| `settled` | Your backend confirmed payment. |
| `price_mismatch` | The totals do not match the content the order names. Never settle or fulfil. |
| `simulated` | Placed from the simulator. Never real, cannot be settled. |

The admin Orders tab shows these labels. It only says "Payment confirmed by merchant" for `settled`.

## Idempotency

Order ids are not unique across customers: an app may number each customer's orders from 1001. So the control plane does not key on `order.id` alone. A repeat is recognised by, in this order:

1. `idempotency_key` in the body (a UUID your app makes once per order), else
2. `install_id` + `order.id`, else
3. the caller's IP (hashed) + `order.id` + a hash of the order body.

In the third case only a byte-identical retry is a duplicate. Two different orders with the same id from one IP (shared Wi-Fi, carrier NAT) are both stored.

A repeat returns the first result (`duplicate: true`) and stores nothing new. A reused key with a different order returns the first order's result. Another install or key never collides with it, so nobody can send a fake order with your id first to block a real one. Send `idempotency_key` if you can. To settle when several orders share an id, send the same `idempotency_key` or `install_id` in the settle body; otherwise the answer is `409 ambiguous`. You can also send `amount` and it must equal the stored total.

## Price checks

The server recomputes each order from the content version in `content_version`: unit prices, quantities, the promo (it must be active), the delivery slot fee and the total. A mismatch is stored as `price_mismatch` and the request returns `422`. An unknown content version also counts as a mismatch.

## Rate limits

Per app, per minute: 20 orders per IP and 10 per install. Send `install_id` in the body to use the install limit. Over the limit returns `429`.

The install limit applies only if the app sends `install_id`. The Tide app does not send one today, so only the IP limit applies to it. `install_id` is supplied by the client and can be changed on every request, so it does not stop a determined sender. `simulated` is set by the client and is not proof of where an order came from; it can only lower trust, since simulated orders cannot be settled. Limits count stored orders only, so duplicates and rejected (`bad_order`) requests are not limited. Treat the limits as protection against mistakes and bursts, and rely on settling for trust.
