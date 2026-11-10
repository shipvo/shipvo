# Test an email sign-in on Android and iOS

This page is for anyone testing an app that signs in with a code or a link sent by email, whether you write the test yourself or ask an AI assistant to do it. You will get a test or an agent run that requests the email, reads the code, and finishes the sign-in on Android and iOS.

Every Shipvo session has its own private inbox, so a test or an agent can read that mail and finish the sign-in. Nothing leaves your machine and no outside mail service is involved. The inbox works the same on the Android and iOS phones.

## How it works

- Each session gets one address, for example `s-1a2b3c4d5e6f@inbox.shipvo.test`. No other session can read its mail.
- Mail is kept in memory only. It is not written to disk or to logs, and it is removed when the session ends.
- Reading is free of side effects: reading twice gives the same result.
- Mail reaches the inbox in two ways:
  - A `mockNetwork` rule with a `mail` field delivers that mail when the rule answers a request.
  - The app (or your mock backend) can `POST` JSON `{ "to", "from", "subject", "text" }` to `https://inbox.shipvo.test/send`. Mail sent to any address except the session's own is refused with status 550.

## In a test

```ts
import { openApp } from "@shipvo/test";

const phone = await openApp({ app: "my-app" });

// The app calls this when it asks for a code. The stub also emails the code.
await phone.mockNetwork([
  { url: "https://api.example.test/auth/request-code", method: "POST", status: 200, body: { sent: true },
    mail: { from: "login@example.test", subject: "Your sign-in code", text: "Your code is 482913. It expires in 10 minutes." } },
]);

await phone.type({ role: "textbox", name: "Email" }, await phone.inbox.address());
await phone.tap({ role: "button", name: "Send code" });

const code = await phone.inbox.code({ subject: "sign-in code", timeout: 5000 });
await phone.type({ role: "textbox", name: "Code" }, code);
await phone.tap({ role: "button", name: "Verify" });
```

`phone.inbox` has:

| Call | Result |
| --- | --- |
| `address()` | The session's address |
| `waitFor({ subject, from, timeout })` | The first matching mail: `from`, `subject`, `text`, `codes` (4 to 8 digits) and `links`. `subject` and `from` match part of the text, any case. `timeout` is in ms (default 10000, at most 25000). Throws a `PhoneError` with code `inbox_timeout` when nothing matches in time |
| `code({ subject, from, timeout })` | The first code in the first matching mail. Code `inbox_no_code` if it has none |
| `list({ subject, from })` | Every mail so far, oldest first |
| `clear()` | Empties the inbox |

For a magic link, take `mail.links[0]` from `waitFor` and pass it to `phone.openUrl(link)`.

## With an agent over MCP

Agents use three tools. Each takes the `session` from `open_app`.

1. Call `inbox_read` to get the session's address, and type it into the app's email field.
2. Tap the button that sends the code.
3. Call `inbox_wait` with `subject` (and/or `from`) and `timeout_ms`. It returns the first match, with `codes` and `links`, or fails with the typed error `inbox_timeout`.
4. Type the code (or open the link) and read the screen.

`inbox_clear` empties the inbox between attempts.

## What you will see

`inbox_read` returns the address and the mail so far as `{ address, messages }`. In a test, `phone.inbox.address()` gives the address and `phone.inbox.list()` gives the messages array. After the sign-in request in the example above, one message is there:

```json
{ "address": "s-1a2b3c4d5e6f@inbox.shipvo.test",
  "messages": [ { "id": "m1", "from": "login@example.test",
                  "to": "s-1a2b3c4d5e6f@inbox.shipvo.test", "subject": "Your sign-in code",
                  "text": "Your code is 482913. It expires in 10 minutes.",
                  "codes": ["482913"], "links": [], "received_at": "2026-11-10T09:00:00.000Z" } ] }
```

## Troubleshooting

| You see | Why | What to do |
| --- | --- | --- |
| `inbox_timeout` | No mail matched `subject` or `from` before `timeout` ran out. The message names the address it waited on | Check the app used the address from `inbox.address()`. Call `inbox_read` with no filter to see what did arrive, then loosen the filter. Filters match part of the text and ignore case |
| `inbox_no_code` | The mail has no standalone 4 to 8 digit number. Raised by `phone.inbox.code()`; `inbox_wait` returns an empty `codes` list instead | Read `text` from `waitFor`. A code inside a longer number or a word is not picked up. Links are not codes: use `links` |
| Status 550 from `inbox.shipvo.test/send` | The `to` address is not this session's address | Send to the address `inbox.address()` returns. Each session has its own |
| `session_ended` | The session closed while you were waiting | Open a new session and request the mail again. The inbox does not carry over |
| An old code is returned | An earlier mail in the same session still matches | Call `inbox_clear` before each sign-in attempt |
| `bad_timeout` | `timeout_ms` is outside 0 to 25000 | Use a value in that range |

## Android and iOS

The inbox, the tools and `phone.inbox` are the same on the Android and iOS phones. With MCP, open the session with `platform: "android"` or `platform: "ios"` in `open_app` and follow the same steps.

## Troubleshooting

| You see | Cause | Fix |
| --- | --- | --- |
| `inbox_timeout` | No mail matched `subject` or `from` before `timeout` ran out | Call `inbox_read` (or `phone.inbox.list()`) to see what arrived. If it is empty, check that the app tapped the send button and that your `mockNetwork` rule has a `mail` field. If mail is there, loosen `subject`. |
| `inbox_no_code` | The matching mail has no 4 to 8 digit number | Read the mail with `waitFor` and look at `text`. For a link, use `links[0]` instead. |
| `bad_timeout` | `timeout_ms` is above 25000 or not a whole number | Use a whole number from 0 to 25000. |
| `session_ended` | The session closed while you waited | Open the app again. The inbox and its address are new for each session. |
| Status 550 from `https://inbox.shipvo.test/send` | The `to` address is not this session's address | Send to the address from `inbox_read` or `phone.inbox.address()`. |
| An old code is picked up | The inbox still holds mail from an earlier attempt | Call `inbox_clear` (or `phone.inbox.clear()`) before each attempt. |

## Next steps

- [Testing](testing.md) for `mockNetwork` and the rest of the typed test API.
- [Agents](agents.md) for the other tools an assistant can call on the phone.
- [Phone apps](phone-apps.md) for the apps on the phone that send and read mail.
