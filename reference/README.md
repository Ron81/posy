# Reference implementations

"Reference" here means exactly one thing: a working, tested implementation you can read, run, and check your own code against. It is **not** the source of truth — the spec is.

If the reference code, the spec and the test vectors ever disagree, the **spec wins** and the code gets fixed (or, if the spec itself is wrong, that gets corrected first — see `CONTRIBUTING.md`).

- [`js/`](js/) — TypeScript encoder/decoder, zero runtime dependencies.

Ports in other languages are welcome as separate repos; pass the test vectors and open a PR adding a link.
