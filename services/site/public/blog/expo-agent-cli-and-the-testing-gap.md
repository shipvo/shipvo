# Expo's new agent CLI, and the part of the loop it leaves to someone else

> On 27 October, Expo introduced a CLI built for coding agents. What it does, what it deliberately does not, and where an agent that uses an app differs from an agent that builds one.

By Hans Ade, 2026-10-31. Canonical: https://shipvo.dev/blog/expo-agent-cli-and-the-testing-gap/

On 27 October 2026, Expo announced `@expo/agent-cli`, which it describes as "a new experimental CLI built by agents and designed for agents." We build on Expo, so we read it closely.

## What it is for

Expo's stated problem is that agents "can write Expo apps, but they don't always know when to use Expo Go," or when a change needs a development build or a native rebuild. The CLI is meant to remove that guesswork. Its commands, per the announcement, include:

- `status`, which reports whether the project works in Expo Go and what to do next
- `dev`, which starts the app with the right setup
- `smoke`, described as "a quick check that your development environment is working": it starts or reuses the app, checks it loads and looks for runtime errors
- `navigate` and `runtime:*` commands to open a route, reload and read what is on screen
- a simulator or emulator per git worktree, so parallel agents do not collide

It runs locally by default. Cloud use is opt-in: "EAS builds and simulator sessions consume credits," so the CLI does not switch to EAS on its own.

## The layer it works at

Read as a whole, it is about getting an agent from code to a running app: choosing the right runtime, starting it, confirming nothing is on fire. That is a real gap, and anyone who has watched an agent try to start a native project will recognise it.

The announcement does not describe an agent operating the app the way a user does, working through a purchase screen by screen and checking the result. It is about the development environment, not the customer's journey.

## The layer Shipvo works at

That second layer is what Shipvo's simulator is for. An agent reads the running app as an accessibility tree and taps, types and scrolls by reference, with device conditions set on request: a denied permission, a failed payment, no network. What it reports back is checked against what the app actually sent to its backend.

So the two sit at different places in the loop:

| Step | Concern | Tool |
| --- | --- | --- |
| Start the app correctly | Right runtime, right build | Expo's agent CLI |
| Check it launches | Loads, no runtime errors | `smoke` |
| Use the app like a customer | Flows, permissions, payments | Shipvo simulator |
| Guard the flows on every PR | Repeatable, typed | `@shipvo/test` in CI |

We have not tested the two together, and we do not claim an integration. Both are young. Expo's CLI is explicitly experimental, and Shipvo is a beta.

## One real difference

Expo's CLI starts a real native runtime, so it can surface what a simulated one cannot, such as native crashes. Shipvo's simulator renders on the web, so it cannot, but it runs on a plain Linux runner without a Mac or an emulator. Which matters more depends on the question you are asking. For many teams, the answer is both. See [the side-by-side comparison](https://shipvo.dev/compare/).

## Sources

- Expo, [Introducing @expo/agent-cli](https://expo.dev/blog/introducing-expo-agent-cli), 27 October 2026.
- Shipvo, [Test with an assistant](https://shipvo.dev/docs/test-with-an-assistant/).
