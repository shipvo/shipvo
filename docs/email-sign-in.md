# Test an email sign-in on Android and iOS

This page is for developers and for anyone testing an app that signs in by email. You will finish an emailed-code or magic-link sign-in in a test or with an agent, without a real mailbox.

Many apps sign in with a code or a link sent by email. Every Shipvo session has its own private inbox, so a test or an agent can read that mail and finish the sign-in. Nothing leaves your machine and no outside mail service is involved.

The inbox works the same on the Android and iOS phones.

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

## Android and iOS

The inbox, the tools and `phone.inbox` are the same on the Android and iOS phones. With MCP, open the session with `platform: "android"` or `platform: "ios"` in `open_app` and follow the same steps.

## Troubleshooting

| What you see | Why | What to do |
| --- | --- | --- |
| `inbox_timeout` | No mail matched your `subject` or `from` before the timeout. | Check the app really asked for a code. Loosen `subject` (it matches part of the text, any case). Check the `mockNetwork` rule has a `mail` field and its `url` and `method` match the request the app sends. Raise `timeout` (at most 25000 ms). |
| `inbox_no_code` | The mail arrived but holds no 4 to 8 digit number. | Use `waitFor` and read `text`, or check the mail text in your stub. |
| Status 550 from `https://inbox.shipvo.test/send` | The `to` address is not this session's address. | Use the address from `inbox.address()` or `inbox_read`. Each session has its own. |
| The address changed | Each session has its own address, and it is removed when the session ends. | Ask for the address again in the new session. |
| `session_ended` while waiting (MCP) | The session closed during the wait. | Open a new session and start the sign-in again. |

## Next steps

- [Test your app in CI](testing.md): run this test on every pull request.
- [Test with an assistant](test-with-an-assistant.md): set up the MCP tools the steps above use.
- [Agents](agents.md): the full list of MCP tools.
