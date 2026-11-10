# Launch kit: test an email sign-in without a mailbox

Drafts for the owner to post. Every statement is from `docs/email-sign-in.md` and `changes/1415-session-inbox.md`; no numbers beyond those are claimed.

Links: [docs](../../email-sign-in.md), [docs on the site](https://shipvo.dev/docs/email-sign-in/), [features page](https://shipvo.dev/features/).

## X post (under 280 characters)

Does your app sign in with an emailed code or magic link? Every Shipvo session now has a private inbox. Your test or agent reads the mail with phone.inbox or inbox_wait and finishes the sign-in. Android and iOS, no real mailbox. https://shipvo.dev/docs/email-sign-in/

## LinkedIn post

Testing an email sign-in usually means a real mailbox, a shared test account and a flaky wait.

Every Shipvo session now has its own private inbox with its own address, for example `s-1a2b3c4d5e6f@inbox.shipvo.test`. Nothing leaves your machine.

In a typed test:
- Type the address into the app's email field.
- Tap "Send code".
- Call `phone.inbox.code({ subject: "sign-in code" })` and type the result.

An agent does the same with three tools: `inbox_read`, `inbox_wait` and `inbox_clear`. For a magic link, take `links[0]` and open it. If no mail arrives you get the typed error `inbox_timeout`, not a hang.

Mail is kept in memory only and is removed when the session ends. It works the same on the Android and iOS phones.

https://shipvo.dev/docs/email-sign-in/

## Show HN-style description

Every Shipvo simulator session has a private, in-memory inbox. Mail arrives from `mockNetwork` rules with a `mail` field, or from a POST to `https://inbox.shipvo.test/send` (other addresses get 550). `@shipvo/test` exposes `phone.inbox` (`address`, `waitFor`, `code`, `list`, `clear`); MCP exposes `inbox_wait`, `inbox_read` and `inbox_clear`. `waitFor` returns subject, text, 4 to 8 digit codes and links, or fails with `inbox_timeout`. Same behaviour on the Android and iOS phones. Docs: https://shipvo.dev/docs/email-sign-in/

## 30-second demo script (Video Studio)

1. 0-5 s: Shipvo Phone showing a sign-in screen with an Email field. Caption: "Sign in by email code."
2. 5-12 s: The test types the session address (`inbox_read`) and taps "Send code".
3. 12-20 s: Terminal: `phone.inbox.code({ subject: "sign-in code" })` returns the code.
4. 20-27 s: The code is typed and "Verify" is tapped; the signed-in screen appears.
5. 27-30 s: Caption: "Android and iOS. No mailbox. shipvo.dev/docs/email-sign-in"
