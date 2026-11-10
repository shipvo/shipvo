# Test an email sign-in on Android and iOS

This page is for developers and for assistants that test apps. You will finish a sign-in by email code or magic link, without a real mailbox.

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

| You see | Cause | Fix |
| --- | --- | --- |
| `inbox_timeout` | No mail matched `subject` or `from` before `timeout` ends | Check the app really called the stubbed request. Use `list()` (or `inbox_read`) to see what arrived, and loosen `subject`. Raise `timeout` (at most 25000 ms). |
| `inbox_no_code` | The mail has no 4 to 8 digit number | Read `text` from `waitFor`, and fix the stub's mail text. For a link, use `links[0]`. |
| Status 550 from `/send` | The mail was addressed to someone other than the session's own address | Send to the address from `address()` or `inbox_read`. |
| Mail from an earlier attempt is picked up | The inbox keeps mail until the session ends | Call `clear()` (or `inbox_clear`) before each attempt. |
| The address changed | A new session has a new address | Read the address again after every `open_app`. |

## Next steps

- [Test with an assistant](test-with-an-assistant.md): give your assistant the phone and the inbox.
- [Test your app in CI](testing.md): run the sign-in test on every pull request.
- [Agents and MCP tools](agents.md): every tool, including the inbox tools.
