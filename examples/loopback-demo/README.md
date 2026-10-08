# Posy loopback demo

Generate a full-body performance, cut it down to what the sender declared, encode it
to Posy wire bytes, push it through a simulated lossy channel (packet-loss + jitter
sliders), decode it and render both avatars side by side: left is the full performance,
right is what the room receives. No server, no signup.

- **Tracker selector.** Full body + toes + tongue, full body + toes, full body, upper
  body, face only. A table shows, per data type, what the tracker delivers, what the
  loaded avatar can show, and what is therefore transmitted (`caps.sends`, spec §2.1).
  The right-hand camera frames the declared region.
- **Poses.** Written as joint angles in `src/poses.ts` and grouped by the part of the body
  they show: standing and arms, legs, hands, feet, face, and the conformance pose vectors
  from `testvectors/poses` (spec §3.4). Pick a group, then one pose of it or a cycle
  through the group; "All" cycles through every pose.
- **Turning.** Drag on either view to turn both cameras around the avatar, or switch on
  "Turn"; a double-click resets. Both views always share one camera position.
- **Extras.** With a model loaded, two lists offer its further bones and its own
  expressions (spec §2.6). A picked bone is declared together with the bones below it
  unless that is switched off; each declared name can be taken out again. Loading another
  avatar starts with nothing declared.
- **Hands, feet and face.** Three poses that run through a sequence: "Count to ten on the
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
  vector (`pose=7` = `p07`), a group name cycles through that group (`pose=Legs`).
  `&extra=<bones>&values=<expressions>`, comma separated, declares those names on every
  loaded avatar that has them. `&look=hands`, `&look=feet` or `&look=head` holds a close-up. Tracker ids: `full-toes-tongue`, `full-toes`, `full`,
  `upper`, `face`.

```sh
npm install
npm start
```

A built-in stick figure is used by default; use "Load your own .vrm" to drive any
VRM. The file is read in the browser and sent nowhere. The codec is imported straight from `../../reference/js/src`.
