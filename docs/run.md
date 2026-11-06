# Run your app on a phone in your browser

For anyone who has made an app with `shipvo init` and wants to see it on a phone-shaped screen in seconds, without installing Android Studio, Xcode or Playwright. You will get a simulated Android or iPhone in a browser tab. Your AI assistant can drive the same phone while you watch.

## Start here (no technical background needed)

You need the app folder from [Build your first app](getting-started.md) and a terminal open in it. A terminal is a window where you type commands (see the [glossary](glossary.md)).

1. Type this and press Enter:

   ```bash
   npx shipvo run android
   ```

   Use `ios` instead of `android` for an iPhone-style phone.
2. Wait while Shipvo builds a web copy of your app. It does not need an account or a phone.
3. Your browser opens on a page with a phone in the middle. A label says **Simulated**, because this is a copy of a phone and not a real one.
4. Click around in the phone like you would tap. When you are done, go back to the terminal and press **Ctrl+C**.

**If it fails:**
- The terminal says it cannot build for web and names a file: the named file uses something that only works on a real phone. Ask your assistant to fix that file.
- The terminal says the port is in use: run `npx shipvo run android --port 4600` (any free number works).
- A message about `@shipvo/sim`: your app is older than this feature. Run `npm install --save-dev @shipvo/sim` and try again.

## What you get

| | Android | iOS |
| --- | --- | --- |
| Phone size | 412x915 | 393x852 |
| Look | Punch-hole camera, gesture bar | Dynamic Island, home indicator |
| System sheet | "Show Android system sheet" button | "Show iOS system sheet" button |

The page scales the phone to your window. Add `?dark=1` to the address to see the dark frame.

## Let your assistant drive the phone you are watching

While `shipvo run` is up, it writes `.shipvo/run.json` in your project (port, platform, app, a secret session token and the process id) and adds `.shipvo/` to `.gitignore`. The token only works from your own computer.

When an assistant calls the Shipvo MCP tool `open_app` for the same app, it finds that file and drives your live phone. The result says `attached to the live shipvo run phone`. If no live phone is found, it says `headless session` and uses its own hidden phone. Attached sessions support `screen`, `tap`, `type`, `scroll` and `back`; other tools return `not_supported_attached`. Attaching needs Node 22 or newer. Full tool list: [Agents](agents.md).

The assistant sees the same list of buttons and text as in the simulator, with `[ref=eN]` numbers it can tap. Refs are numbered differently from the simulator's, and a ref from an earlier page returns `stale_ref` so it never taps the wrong thing.

## Options

```bash
shipvo run android|ios [--no-open] [--port <n>] [--native]
```

| Option | What it does |
| --- | --- |
| `--no-open` | Print the address and do not open a browser. |
| `--port <n>` | Use port `n`, 0 to 65535. Default: any free port. |
| `--native` | Run on a real emulator or simulator with `npx expo run:android` or `run:ios` instead. Needs Android Studio or Xcode. |

## Troubleshooting

| You see | Why | Fix |
| --- | --- | --- |
| `Port 4600 is in use. Pass another --port <n>.` | Another program uses that port. | Choose another number. |
| `--port needs a number from 0 to 65535` | The value is not a port. | Use digits only. |
| `Unknown argument` | A flag is mistyped. | The message shows the usage line. |
| Assistant says `headless session` | `shipvo run` is not running in that project, or the app name differs. | Start `shipvo run` in the project, then call `open_app` again. Pass `attach: "always"` to get an error instead of a fallback. |
| `no_live_run` | You passed `attach: "always"` and no `shipvo run` is live. | Start `shipvo run` in the project, then call `open_app` again. |
| `attach_failed` with "attach needs Node 22+" | Old Node. | Install Node 22. |

## Next steps

- [Test with an assistant](test-with-an-assistant.md)
- [Record a demo video of the phone](record.md)
- [CLI guide](cli.md)
