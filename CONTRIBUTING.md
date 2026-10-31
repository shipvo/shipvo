# Contributing to Shipvo

Thanks for helping. Shipvo is an open-source React Native framework for signed over-the-air updates and an agent-usable simulator (Apache-2.0).

## Setup

```bash
git clone https://github.com/shipvo/shipvo.git && cd shipvo
corepack enable && pnpm install
pnpm -r build && pnpm -r test
```

Node 22 and pnpm are required. Packages live in `packages/`, hosted services in `services/`, docs in `docs/`, blog posts in `blog/`.

## Good first contributions

- Docs fixes and clearer examples (`docs/`).
- Tests for `@shipvo/test` flows in `packages/test`.
- Measuring OTA on more real phones; add your numbers to `docs/spike-results.md` with the device model.
- Anything labelled [good first issue](https://github.com/shipvo/shipvo/labels/good%20first%20issue).

## Pull requests

1. Open an issue first for anything larger than a small fix.
2. Keep a change focused, add or update tests, and run `pnpm -r test`.
3. Claims need evidence: if a doc states a number, link where it was measured.
4. Sign off nothing special is needed; contributions are accepted under Apache-2.0.

## Reporting security issues

Do not open a public issue. See [SECURITY.md](SECURITY.md).
