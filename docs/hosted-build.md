# Test your own build on the hosted phone

Upload the app from your machine and let your assistant test it on the hosted Shipvo phone, without publishing a release first. You will upload a build, get a build id, and open it on the phone. It works the same for Android and iOS phone frames.

Founders: ask your assistant "upload my app and test it on the hosted phone". It runs the steps below for you.

## Before you start

- A Shipvo API key. Run `npx -y @shipvo/cli login`, then export it: `export SHIPVO_API_KEY=<your key>`.
- An app folder with `shipvo.json` (made by `shipvo init`).
- The hosted server added to your assistant (`shipvo mcp` prints the config). For the upload tool, also add the local server next to it: `npx @shipvo/mcp`.

## Upload from your assistant

1. Ask your assistant to call `upload_build`. It builds your project the same way `shipvo sim` does and uploads it.
2. You see the build id and when it expires:

   ```
   build: <id>
   app: myshop
   expires: <date and time>
   size: <bytes> bytes

   Open it on the hosted phone: open_app("myshop@build:<id>")
   ```

3. On the hosted server, call `open_app("myshop@build:<id>")`. Every session tool (`screen`, `tap`, `device_log` and the rest) now works on your build.

## Upload from the terminal

Run this inside your app folder:

```bash
shipvo sim --hosted
```

It builds, uploads and prints `Uploaded. It expires <time>. On the hosted phone: open_app("<app>@build:<id>")`. Add `--skip-build` to upload the existing `sim-dist` folder without building again. With `--json` you get `data.id`, `data.app`, `data.expires_at` and `data.open`.

## Options of `upload_build`

| Option | Type | Meaning |
| --- | --- | --- |
| `dir` | string | Project folder. Default: the server's working directory. |
| `app` | string | App id. Default: read from `shipvo.json`. |
| `skip_build` | boolean | Upload the existing `sim-dist` folder without building again. |

Builds are private to your account. A key from another account gets `build_not_found`, the same as for an id that never existed. Builds are deleted when they expire.

## Troubleshooting

| Code | What it means | What to do |
| --- | --- | --- |
| `no_api_key` | `SHIPVO_API_KEY` is not set. | Run `shipvo login` and export the key. |
| `stdio_only` | You called `upload_build` on the hosted server. It needs your files. | Add the local server (`npx @shipvo/mcp`) and call it there. |
| `build_failed` | The web build did not finish, or there is no app id. | Run `shipvo sim` and fix the first error it prints; check `shipvo.json`. |
| `build_too_large` | The upload was refused for size. | Remove unused images, fonts and large assets and unused dependencies, then upload again. |
| `upload_failed` | The hosted service could not be reached. | Check your network and try again. |
| `build_not_found` | The id is wrong, belongs to another key, or belongs to another app. | Use the exact `open_app` line `upload_build` printed. |
| `build_expired` | The build was deleted after it expired. | Run `upload_build` again. |
| `build_not_supported` | The simulator did not load that build, so no session was opened. | Open the app without `@build` to use the published release. |
| `unknown_app` | Your key does not open that app. | Use an app from `list_apps`. |

If you see "this key is read-only: it cannot upload builds", use a key with write access.

## Next steps

- [Agents and MCP tools](agents.md): every tool the hosted phone has.
- [Run on a phone in your browser](run.md): the same app on your own machine with `shipvo run`.
- [Test with an assistant](test-with-an-assistant.md): the founder walk-through.
