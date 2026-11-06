---
name: shipvo-cli
description: Use the shipvo command line. Use when the project depends on @shipvo/cli and you need the right command to set up, check status, publish, roll back or configure agents.
---

# @shipvo/cli

Run from the app's root folder. Use `npx -y @shipvo/cli <command>` if `shipvo` is not on the path.

When unsure, run these two:

```bash
shipvo doctor
shipvo status --json
```

`status --json` prints `ok`, `code`, `summary`, `data` and `next`. `next` is a list of `{ command, why }`: run those. Exit codes: 0 ok, 1 action needed, 2 error. `data.skills` lists the package skills and whether each is synced.

## Common commands

```bash
shipvo init --dry-run     # print the plan, change nothing
shipvo init --yes         # apply it
shipvo sim                # simulator on http://localhost:4545
shipvo publish --dry-run  # check a release before you publish
shipvo rollback --to <release>
shipvo agents setup       # AGENTS.md, .mcp.json and package skills
shipvo skills sync        # only copy package skills
```

Add `--dry-run` to `agents setup` and `skills sync` to see what would change. Both are safe to run again. Run `shipvo help` for every command.
