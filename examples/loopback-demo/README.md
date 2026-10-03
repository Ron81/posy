# Posy loopback demo

Generate a full-body performance, cut it down to what the sender declared, encode it
to Posy wire bytes, push it through a simulated lossy channel (packet-loss + jitter
sliders), decode it and render both avatars side by side: left is the full performance,
right is what the room receives. No server, no signup.

- **Tracker selector.** Full body + toes + tongue, full body + toes, full body, upper
  body, face only. A table shows, per data type, what the tracker delivers, what the
  loaded avatar can show, and what is therefore transmitted (`caps.sends`, spec §2.1).
  The right-hand camera frames the declared region.
- **Leg poses.** The legs play the conformance pose vectors from `testvectors/poses`
  (spec §3.4), cycling by default; a button holds any one of them. Hips height `h` is
  applied to the avatar.
- **Links.** `?tracker=<id>&pose=<n>` preselects both, e.g. `?tracker=full&pose=7` holds
  the ankle-on-knee pose. Tracker ids: `full-toes-tongue`, `full-toes`, `full`, `upper`,
  `face`. Pose 0 is standing, 1–9 are the pose vectors in order.

```sh
npm install
npm start
```

A built-in stick figure is used by default; use "Load your own .vrm" to drive any
VRM (nothing is uploaded). The codec is imported straight from `../../reference/js/src`.
