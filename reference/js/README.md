# posy-protocol (reference JS/TS)

TypeScript reference encoder/decoder for the Posy pose protocol. Zero runtime dependencies, Node ≥ 18. Published on npm as [`posy-protocol`](https://www.npmjs.com/package/posy-protocol).

```sh
npm install posy-protocol
```

```ts
import { encode, decode } from 'posy-protocol';

const bytes = encode({
  version: 1, seq: 1, timestampMs: 0, idle: false,
  bones: new Map([[0, { x: 0, y: 0, z: 0, w: 1 }]]), // hips, identity
});
const frame = decode(bytes); // throws on any malformed frame
```

Build and test:

```sh
npm ci && npm test   # builds, then runs the unit tests + test vectors
```

The spec is the source of truth: if this code ever disagrees with `spec/Posy-1.0.md`, the spec wins and the code gets fixed.
