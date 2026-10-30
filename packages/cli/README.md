# @shipvo/cli

Command-line tools for [Shipvo](https://github.com/shipvo/shipvo), the open-source React Native framework for signed over-the-air updates.

```bash
npx @shipvo/cli keygen --out seed.txt   # Ed25519 release signing key
npx @shipvo/cli hash bundle.hbc         # SHA-256 and size
npx @shipvo/cli sign-file bundle.hbc    # signature over bytes
```

Also usable as a library: `signDoc`, `verifyDoc`, `signBytes`, `sha256Hex`, `keyFromSeed`.

License: Apache-2.0
