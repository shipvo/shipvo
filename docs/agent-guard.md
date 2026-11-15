# Ask a person before an agent pays or deletes

This page is for anyone who lets an AI assistant tap through an app on Shipvo Phone. You will turn on a guard so the assistant cannot spend money or delete an account until a person says yes. You will also see how typed passwords stay out of transcripts.

A phone session can reach real services. One tap on **Pay now** or **Delete account** is enough to spend money or lose data. The guard is off by default, so existing tests and agent runs behave as before.

## Turn the guard on

1. Set `SHIPVO_GUARD=on` where the Shipvo MCP server runs. For a local server:

   ```bash
   SHIPVO_GUARD=on npx shipvo mcp
   ```

2. Ask your assistant to tap a payment button, for example **Place order** in the shop template.
3. You are asked first. Nothing is tapped until you answer.

`on` guards two kinds of button. The server knows a button by its label:

| Kind | Labels it matches |
| --- | --- |
| `pay` | Pay, Pay now, Pay with …, Buy, Buy now, Buy with …, Place order, Confirm purchase, Confirm payment, Complete purchase, Start subscription, Subscribe, Transfer, Send money, Purchase |
| `delete` | Delete account, Close account, Delete everything, Erase all data |
| `send` | Send, Post, Publish, Reply, Share, Submit review |

`SHIPVO_GUARD=on` means `pay` and `delete`. To choose kinds, give a list: `SHIPVO_GUARD=pay,delete,send`. `off`, `0`, `false` or unset turns the guard off.

## What you see

**In a client that can ask questions** (MCP elicitation), you get a prompt: `Allow`, `Allow for this session` or `Decline`. The model never sees the question and cannot answer it.

- `Allow` taps once.
- `Allow for this session` stops asking about that kind of button for the rest of the session.
- `Decline` returns `tap_declined`. The assistant is told to stop and say what it stopped at.

**In any other client**, `tap` returns the error `approval_needed` and nothing is tapped. The assistant asks you in chat. After you say yes, it calls `tap` again with `approved: true`.

A tap path (`then`) stops at a guarded step in the same way.

## Passwords and codes stay out of the record

Text typed into a password field or a one-time-code field is typed, then kept out of the tool result, the watch page and exported tests. The result says `Value of <ref>: hidden (a secret field)`. The simulator spots these fields from `type=password`, or an `autocomplete` of a password or one-time code. For any other field that holds a secret, pass `secret: true` to `type`.

## Set a monthly spend limit per app

On the hosted phone, the signed-in person sets a monthly limit for each installed app with `PUT /phone/apps/<app>/spend-limit` (read it with `GET`). The limit is `{ "amount": 2000, "currency": "USD", "period": "month" }` in minor units (cents). It starts at 0. An assistant token gets `403`. A money action over the limit is refused with `spend_limit`, and the answer carries `limit` and `spent`. Every change and every refusal is written to an audit table. See the [threat model](threat-model.md) for the checks behind it.

## Troubleshooting

**The assistant says `approval_needed`.** Your client cannot show questions. Reply yes in chat and ask the assistant to tap again with `approved: true`.

**A button is not guarded.** The guard matches the whole label. A button named "Pay $12.50 now" is not in the list. Rename it to a label above, or add the kind `send` if it sends or publishes.

**A secret still shows in an exported test.** The field was not a password or code field. Call `type` with `secret: true` for it, then export again.

**Existing tests now stop at checkout.** They were run with `SHIPVO_GUARD` set. Unset it for test runs, or reply `Allow for this session`.

## Next steps

- [Agents and Shipvo apps](agents.md): every tool an assistant can call.
- [Email sign-in](email-sign-in.md): test a sign-in without exposing a code.
- [Phone apps](phone-apps.md): the apps on Shipvo Phone.
