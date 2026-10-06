# Posy loopback demo

Generate a full-body performance, cut it down to what the sender declared, encode it
to Posy wire bytes, push it through a simulated lossy channel (packet-loss + jitter
sliders), decode it and render both avatars side by side: left is the full performance,
right is what the room receives. No server, no signup.

- **Tracker selector.** Full body + toes + tongue, full body + toes, full body, upper
  body, face only. A table shows, per data type, what the tracker delivers, what the
  loaded avatar can show, and what is therefore transmitted (`caps.sends`, spec §2.1).
  The right-hand camera frames the declared region.
- **Poses.** One dropdown of whole-body poses (standing, moving, seated), written as joint
  angles in `src/poses.ts`; "Auto" cycles through them. The last group holds the
  conformance pose vectors from `testvectors/poses` (spec §3.4).
- **Hands, feet and face.** Three poses outside the Auto cycle: "Count to ten on the
  fingers" (one hand opens finger by finger, thumb first, then the other), "Toes up" (each
  foot, then both on tiptoe) and "Face" (lids, mouth shapes, tongue, gaze, one at a time).
  A view selector next to the pose moves both cameras to the hands, the feet or the face;
  on "auto" these three poses do it themselves.
- **The stick figure shows every data type**: fingers, one toe piece per foot (what the
  wire carries), lids, mouth, a tongue with direction, and pupils that follow the gaze.
  Tongue direction is visible only there; VRM has no expression for it.
- **Hands and face fit the pose.** Relaxed, flat on the lap, on the hips, open for a wave;
  the mouth moves where the pose speaks. Nothing else moves but blinking and the eyes
  following the head.
- **Hips height.** The sender estimates `h` from the lowest point of the legs (spec
  Appendix D); poses where nothing touches the floor supply it. Both avatars apply it.
- **Links.** `?tracker=<id>&pose=<id>` preselects both, e.g. `?tracker=full&pose=p07`
  holds the ankle-on-knee vector and `?pose=squat` the squat. A bare number means that
  vector (`pose=7` = `p07`). `&look=hands`, `&look=feet` or `&look=head` holds a close-up. Tracker ids: `full-toes-tongue`, `full-toes`, `full`,
  `upper`, `face`.

```sh
npm install
npm start
```

A built-in stick figure is used by default; use "Load your own .vrm" to drive any
VRM (nothing is uploaded). The codec is imported straight from `../../reference/js/src`.
