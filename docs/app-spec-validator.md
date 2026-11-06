# App spec validator

`@shipvo/spec` holds the JSON Schema for `shipvo.app/v0` and `validate(spec)`. The format is described in `docs/design/app-spec.md`; usage and the list of checks are in `packages/spec/README.md`.

The schema file ships as `@shipvo/spec/schema.json`.

`permissions.network` lists domains the app reads from (`data` sources). `permissions.write` lists domains action steps may call. They are separate so that reading a service never grants writing to it, and each write needs approval.
