# Posy loopback demo

A full-body performance is cut down to what the sender declared, encoded to Posy frames, sent
through a simulated lossy channel, decoded and rendered. Left: the performance. Right: what the
room receives. Everything runs in one browser tab; there is no server.

- **Tracker.** Full body + toes, full body, upper body, face only. A table shows per data type
  what the tracker delivers, what the avatar can show and what is therefore sent (`caps.sends`,
  spec §2.1). The right-hand camera frames the declared region.
- **Fingers.** The 24-byte finger block (spec §5.5), or one rotation per joint (`finger_bones`).
  The pose "Claw" shows the difference: the block bends all three joints of a finger together.
- **Poses.** Written as joint angles in `src/poses.ts` and grouped by the part of the body they
  show; the last group holds the leg pose vectors from `testvectors/poses` (spec §3.4). Hold one
  pose or let a group cycle.
- **Extras.** An avatar's bones beyond the humanoid body, and the expressions the face block does
  not carry, are declared by their names in the avatar file (spec §2.6). The tongue is one of
  them.
- **Hips height.** The sender estimates `h` from the lowest point of the legs (spec Appendix D);
  poses where nothing touches the floor supply it.
- **Channel.** Packet loss, jitter and send rate, with four presets.
- **Avatar.** A stick figure with a part for every data type, or your own `.vrm` (VRM 1.0 or
  0.x). The file is read in the browser and sent nowhere.
- **Views.** Drag to turn both cameras, double-click to reset; the view selector holds a close-up
  of the hands, the feet or the face.
- **Links.** `?tracker=<id>&pose=<id>&fingers=joints&look=hands|feet|head&extra=<bones>&values=<expressions>`.
  Tracker ids: `full-toes`, `full`, `upper`, `face`. `pose` takes a pose id (`squat`), a bare
  number for a pose vector (`7` = `p07`) or a group name (`Legs`). `extra` and `values` are comma
  separated and apply to every avatar that has those names.

```sh
npm install
npm start
```

The codec is imported from `../../reference/js/src`, the finger synthesis from
`../../reference/js/scripts/finger-fk.mjs`: the demo has no copy of either.
