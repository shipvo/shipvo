# Test your build on the hosted phone

For anyone whose app is on their own computer and who wants an AI assistant on the hosted phone (sim.shipvo.dev) to test that exact build, before anything is published. You build once, upload, and open the build by its id. It works on Android and iOS phones.

## What you need

- A Shipvo key: run `npx -y @shipvo/cli login` and set it as `SHIPVO_API_KEY`.
- An app folder with `shipvo.json` (made by `shipvo init`).
- For the assistant route: the local MCP server (`npx @shipvo/mcp`) added next to the hosted one. `upload_build` reads your project, so it runs only on the local server.

## Upload from the terminal

1. In your app folder, run:

   ```bash
   export SHIPVO_API_KEY=<your key>
   shipvo sim --hosted
   ```

2. Shipvo builds the app the way `shipvo sim` does, packs the `sim-dist` folder and uploads it for your key. It prints:

   ```text
   Uploaded. It expires <date>. On the hosted phone: open_app("myshop@build:<id>")
   ```

3. Give that `open_app(...)` line to your assistant on the hosted server.

Add `--skip-build` to upload the `sim-dist` folder you already have. If there is no `sim-dist/index.html`, Shipvo builds anyway.

## Upload from your assistant

1. Ask: "Upload my build and open it."
2. The assistant calls `upload_build`. The result gives the build id, the app, the expiry time and the size.
3. The assistant calls `open_app("<app>@build:<id>")` on the hosted server. The phone opens with your build, and `screen`, `tap`, `type` and the other session tools work on it as usual. The result shows `release: build:<id>`.

| `upload_build` option | Meaning |
| --- | --- |
| `dir` | Project folder. Default: the server's working directory. |
| `app` | App id. Default: read from `shipvo.json`. |
| `skip_build` | Upload the existing `sim-dist` folder without building again. |

## Who can see a build

A build is private to your account and is deleted when it expires. Another account asking for your build id gets `build_not_found`, the same answer as for an id that never existed.

## Troubleshooting

| Code | What it means | What to do |
| --- | --- | --- |
| `no_api_key` | `SHIPVO_API_KEY` is not set. | Run `shipvo login`, then export the key. |
| `build_failed` | The web build did not finish, or no app id was found. | Run `shipvo sim` and fix the first error it shows. Run from the folder with `shipvo.json`, or pass `app`. |
| `build_too_large` | The upload is over the size the service accepts. | Remove unused images, fonts and large assets, drop unused dependencies, and upload again. |
| `upload_failed` | The hosted service could not be reached or refused the upload. | Check your network and run again. |
| `stdio_only` | You called `upload_build` on the hosted server. | Add the local server (`npx @shipvo/mcp`) and call it there. |
| `unknown_app` | Your key does not open that app. | Use an app id your key lists. |
| `build_not_found` | No build with that id for your key, or it was uploaded for another app. | Run `upload_build` again and use the id it returns, with the app it names. |
| `build_expired` | The build expired and was deleted. | Upload again. |
| `build_not_supported` | The simulator did not load that build, so no session was opened. | Open the app without `@build` to use the published copy, or upload again. |

## Next steps

- [Agents and Shipvo apps](agents.md): every MCP tool.
- [Test with an assistant](test-with-an-assistant.md): hosted and local setup.
- [Run on a phone in your browser](run.md): the same build on your own computer.
