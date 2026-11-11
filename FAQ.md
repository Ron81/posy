# FAQ

The reasons behind the design. The spec says what, this file says why. If an answer here contradicts the spec, the spec wins.

## Why not just use VMC?

VMC is a local-machine protocol: one sender, one receiver, usually the same LAN, and no size budget. Posy is for many people on ordinary internet connections: one avatar's pose in a single small datagram.

## Why WebRTC data channels?

A data channel can be set to unordered delivery with zero retransmits, which fits data where a late frame is worthless, and it works from browser to browser. An application that already holds a WebRTC connection adds the pose channel to it and needs no second NAT traversal.

## What if my relay can't do server-side WebRTC?

Pose can travel over a WebSocket instead (spec §1.1). That is lighter on a relay than a DTLS/SCTP stack per peer. A WebSocket is reliable and ordered, so the sender re-creates "drop, don't resend" itself: it stops queueing frames while the socket is backed up, so that TCP does not hold a fresh frame behind an old one. The frames are byte for byte the same on either lane, and the lane in use is stated in the `hello`/`session` handshake.

## Does Posy carry audio?

No. Posy defines pose data only. An application that carries voice next to it can use the audio to drive the mouth (spec §8.4).

## Why drop the largest quaternion component?

A unit quaternion has 3 degrees of freedom. "Smallest-three" drops the largest component and rebuilds it on the other side with `sqrt(1 − a² − b² − c²)`. That turns 16 bytes (four floats) into 4 bytes (one `u32`) at a worst-case error of about a quarter of a degree, well below tracker noise.

## Why no delta / keyframe encoding in v1?

It needs reliable resync logic, and at about 115 bytes a frame the saving is not worth the complexity. It is deferred to v2 (§11).

## Why does everything go through one peer instead of a mesh?

Someone has to own the session clock, authorisation and rate tiering. In a mesh every peer would have to implement all of that and upload its pose to every other peer separately, which outgrows a home connection as the room grows. With one routing peer, each sender uploads one small stream.

## Do I need to rent a server to use this with friends?

No. "Server" is a role. One person in the group can run the routing role on their own machine while taking part, like hosting a game server for friends. The router forwards bytes and never re-encodes them, so a small room fits a home connection.

## What if my upload can't keep up?

1. Drop the room to `NORMAL` (15 Hz) or `MINIMAL` (5 Hz). With smoothing on the sender and interpolation on the receiver, 15 Hz looks fine.
2. Let anyone who is not performing join as a receive-only viewer: no capture, no upload.
3. Hand the routing role to whoever has the best upstream.

A VPS or a hosted SFU is needed only for large rooms.

## Can the routing peer modify frames to save bandwidth?

Not in v1. It MUST NOT change a forwarded frame's bytes; it may only drop whole frames. Stripping fields under congestion (dropping the fingers, say) would mean re-encoding packets, so it is deferred to v2.

## Where does the face go, bones or expressions?

Expressions. The expression block (`HAS_EXPRESSIONS`) carries the weights of lids, mouth shapes and moods, and two gaze bytes for the line of sight. The eye and jaw bone bits (6–8) are a fallback for rigs driven by bone rotation; if gaze and eye bones are both present, gaze wins.

## What is `PERFECT_SYNC`?

It selects the size and contents of the face block: off = the 13 VRM presets and the gaze (15 bytes), on = all 52 ARKit blendshapes and the gaze (54 bytes).

## What does a receiver show when frames stop?

It holds the last pose, and after 1.5 s it shows that the peer may have a problem (§8.3). A sender that is still running can say why its frames stopped (`silence`, §2.8: its tracker lost the person, it is loading an avatar); the receiver then holds without the problem cue. Someone who is away declares nothing (`sends: []`) and sends no frames. How an away user is shown is the application's; Posy defines no idle or away pose.

## What if the spec, the reference code and the test vectors disagree?

The spec wins and the others get fixed. The one exception is a spec that is plainly wrong: that is corrected in the spec, in its own commit, with a CHANGELOG entry, and not worked around in code.

## Is there a full server implementation?

Not in this repo: a room server is an application, not the protocol. It is planned as a separate `posy-server-example` repo, easy to run on your own machine for a small group.

## How do I add support in another language?

Read the spec, pass the test vectors, and put it in your own repo. Then open a PR that adds a link to the README.

## What license is this under?

Apache-2.0.
