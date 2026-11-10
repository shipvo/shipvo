# Test your own build on the hosted phone

This page is for you if your app runs on your computer and you want your AI assistant to test that exact version on the hosted Shipvo Phone, on Android and iOS, without publishing it. You will upload your build, get a build id and open it as a phone session.

## What you need

- A Shipvo project (a folder with `shipvo.json`).
- A Shipvo API key. Run `shipvo login` to sign in with GitHub, then `shipvo mcp` prints your config with the key in it.
- `SHIPVO_API_KEY` set to that key in the terminal where you run the command, or in the environment of your coding agent's `@shipvo/mcp` server.

## Upload from the terminal

1. Open a terminal in your project folder.
2. Run:

   ```bash
   export SHIPVO_API_KEY=<your key>
   shipvo sim --hosted
   ```

3. Shipvo builds the app with the simulated device, the same build `shipvo sim` makes. It packs the result and uploads it for your key.
4. It prints when the build expires and the line to open it:

   ```text
   Uploaded. It expires 2026-11-07T12:00:00.000Z. On the hosted phone: open_app("tide@build:b1")
   ```

   The date and id here are an example. Yours differ.

Add `--skip-build` to upload the existing `sim-dist` folder without building again. Add `--json` for the usual `{ ok, code, summary, data, next }` envelope. `data` holds `{ id, app, expires_at, open }`.

## Upload from your assistant

If your coding agent runs the local `@shipvo/mcp` server (`shipvo agents setup` adds it), ask it: "Upload my build and test it on the hosted phone." The agent:

1. Calls `upload_build`. It returns the build id, the app, the expiry and the size in bytes.
2. Calls `open_app("<app>@build:<id>")` on the hosted server.
3. Drives the phone with the usual tools (`screen`, `tap`, `type`, `wait_for`).

`upload_build` options:

| Option | Type | What it does |
| --- | --- | --- |
| `dir` | string | Project folder. Default: the server's working directory. |
| `app` | string | App id. Default: read from `shipvo.json`. |
| `skip_build` | boolean | Upload the existing `sim-dist` folder without building again. |

`upload_build` reads your project, so it runs only on the local (stdio) server. Add `npx @shipvo/mcp` next to the hosted one. A key with read scope cannot upload.

## Who can see a build

A build is private to your account. A key from another account gets `build_not_found`, the same answer as for a build that never existed. A build is deleted when it expires.

## Open a build from a link

The simulator's `POST /session` also takes a `build_url`: a link to a `.tar.gz` of your built app. The simulator fetches it into its size-capped build cache (stored by sha256 content id), unpacks it (an archive that contains links is refused) and serves it at `/b/<id>/`. The reply has `build`: the id you sent, or the content id. `open_app("<app>@build:<id>")` sends it for you. The host must be an allowed host. This is checked again on every redirect. If the fetch fails, the reply is `{ ok: false, code, error }`, no session is created and no file is left behind. The codes:

| Code | Meaning | What to do |
| --- | --- | --- |
| `bad_url` | The URL is not a valid `http(s)` URL. | Check the address. |
| `host_not_allowed` | The host (or a redirect target) is not an allowed host. | Use an allowed host. To host a build without a link, use [Upload from the terminal](#upload-from-the-terminal). |
| `too_large` | The file is over the size cap. | Remove unused assets and try again. |
| `unreachable` | The fetch timed out or the host did not answer. | Check the link opens in a browser, then retry. |
| `bad_build` | The file must be a `.tar.gz` with `index.html` at the top level and no links. | Fix the archive and try again. |

## Errors

| Code | Meaning | What to do |
| --- | --- | --- |
| `no_api_key` | `SHIPVO_API_KEY` is not set. The key is read from the environment, not from the saved login. | Run `shipvo login`, then `shipvo mcp` to see your key, and set the variable. |
| `stdio_only` | You called `upload_build` on the hosted server. | Add the local server: `npx @shipvo/mcp`. |
| `build_failed` | The web build failed, or there is no app id. | Run `shipvo sim` and fix the first error it shows. Or pass `app`. |
| `build_too_large` | The upload is over the size limit. | Remove unused images, fonts and large assets, drop unused dependencies, upload again. |
| `upload_failed` | The hosted service could not be reached or refused the upload. | Check your connection and the key, then try again. |
| `build_not_found` | No such build for this key, or it was uploaded for another app. | Run `upload_build` again and use the id it returns. |
| `build_expired` | The build was deleted after it expired. | Run `upload_build` again. |
| `unknown_app` | Your key does not open that app. | Use an app the key lists. |

## Troubleshooting

**`shipvo sim --hosted` says `no_api_key`.** The variable is set in another terminal. Export it in this one, or put it in your agent's MCP server `env`.

**The phone opens the old version of my app.** `open_app("tide")` opens the published release. Use the full `tide@build:<id>` form with the id from your latest upload.

## Next steps

- [Test with an assistant](test-with-an-assistant.md): connect Claude, ChatGPT or Cursor.
- [Agents and Shipvo apps](agents.md): every tool.
- [Run on a phone in your browser](run.md): watch a local phone instead.
- [CLI guide](cli.md): every command.
