# purenative

Command-line tools for [PureNative](https://github.com/purenativedev/purenative), the open-source React Native framework for signed over-the-air updates.

```bash
npx purenative keygen --out seed.txt   # Ed25519 release signing key
npx purenative hash bundle.hbc         # SHA-256 and size
npx purenative sign-file bundle.hbc    # signature over bytes
```

Also usable as a library: `signDoc`, `verifyDoc`, `signBytes`, `sha256Hex`, `keyFromSeed`.

License: Apache-2.0
