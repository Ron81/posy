# Posy loopback demo

Encode a procedurally-animated pose to Posy wire bytes, push it through a
simulated lossy channel (packet-loss + jitter sliders), decode it and render both
the ground-truth and the received avatar side by side. No server, no signup.

```sh
npm install
npm start
```

A built-in stick figure is used by default; use "Load your own .vrm" to drive any
VRM (nothing is uploaded). The codec is imported straight from `../../reference/js/src`.
