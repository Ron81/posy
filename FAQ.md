# FAQ

The "why is it like this?" file. It lives here so the spec can stay lean — the spec says *what*, this says *why*. If an answer here ever contradicts the spec, the spec wins.

## Why not just use VMC?

VMC is great, but it's fundamentally a local-machine protocol: one sender, one receiver, same LAN, and no real size budget. Posy is for the case VMC never targeted — many people on ordinary internet connections, one avatar's pose squeezed into a single small datagram.

## Why WebRTC data channels?

Voice already needs WebRTC for Opus. Reusing the same peer connection for pose means one NAT traversal and one negotiation, plus a data channel you can configure as unordered with zero retransmits — ideal for data where a late frame is worthless.

## Why drop the largest quaternion component?

A unit quaternion only has 3 degrees of freedom. "Smallest-three" drops the largest component and rebuilds it on the other side with `sqrt(1 − a² − b² − c²)`. That turns 16 bytes (four floats) into 4 bytes (one `u32`) at a worst-case error of roughly a tenth of a degree — far below what any tracker can actually resolve.

## Why no delta / keyframe encoding in v1?

It needs reliable resync logic, and at ~116 bytes a frame the saving isn't worth the complexity. It's parked for v2 (§11), not designed out.

## Why does everything go through one peer instead of a mesh?

Someone has to own the session clock, authorisation and rate tiering. In a mesh every peer would have to re-implement all of that — and upload its pose separately to everyone else, which is exactly what melts a home connection as the room grows. With one routing peer, each sender uploads one small stream.

## Do I need to rent a server to use this with friends?

No. "Server" is a role. One person in the group can run the routing role on their own machine while still taking part normally — like hosting a game server for friends. Because the router only forwards bytes and never re-encodes them, a small room is very manageable on home fibre.

## What if my upload can't keep up?

You've got levers before giving up:

1. Drop the room to `NORMAL` (15 Hz) or `MINIMAL` (5 Hz). With smoothing on the sender and slerp on the receiver, 15 Hz already looks fine.
2. Let anyone who isn't performing join as a receive-only **viewer** — no capture, no upload.
3. Hand the routing role to whoever has the best upstream.

Only once a room gets genuinely large does a VPS or hosted SFU start to make sense.

## Can the routing peer modify frames to save bandwidth?

Not in v1. It MUST NOT change a forwarded frame's bytes — it may only drop whole frames. Stripping fields under congestion (say, dropping just the fingers) would mean re-encoding packets, so it's deferred to v2.

## Where does the face go — bones or expressions?

Expressions. The expression block (`HAS_EXPRESSIONS`) carries blendshape weights (blinks, mouth shapes, emotions) plus two gaze bytes for eye direction. The eye and jaw *bone* bits (6–8) are a fallback for rigs driven by literal bone rotation; if both gaze and eye bones are present, gaze wins.

## What are `PERFECT_SYNC` and `IDLE`?

`PERFECT_SYNC` only changes the *size and contents of the face block*: off = 16 VRM expressions (18 bytes), on = all 52 ARKit blendshapes (54 bytes). `IDLE` is a zero-byte hint that the sender is AFK, so receivers can skip interpolation work; it never changes the layout.

## What if the spec, the reference code and the test vectors disagree?

The spec wins and the others get fixed. The one exception is when the spec itself is plainly wrong — then that gets called out and corrected explicitly (in the spec, in its own commit, with a CHANGELOG entry), not quietly worked around in code.

## Is there a full server implementation?

Not in this repo, on purpose: a room server is an application, not the protocol. It's planned as a separate `posy-server-example` repo so room-logic bugs don't drown out spec issues. The goal is that it's easy to run yourself, including on your own machine for a small group.

## How do I add support in another language?

Read the spec, pass the test vectors, and put it in your own repo. Then open a PR adding a link to the README.

## What license is this under?

Apache-2.0.
