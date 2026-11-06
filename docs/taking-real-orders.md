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

`POST /o/:app` takes one order per `order.id` (up to 40 characters). Sending the same id again returns the first result (`duplicate: true`) and stores nothing new.

## Price checks

The server recomputes each order from the content version in `content_version`: unit prices, quantities, the promo (it must be active), the delivery slot fee and the total. A mismatch is stored as `price_mismatch` and the request returns `422`. An unknown content version also counts as a mismatch.

## Rate limits

Per app, per minute: 20 orders per IP and 10 per install. Send `install_id` in the body to use the install limit. Over the limit returns `429`.
