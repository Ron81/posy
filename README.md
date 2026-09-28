# Posy - An open, compact protocol for streaming avatar poses over WebRTC.

Stream humanoid avatar poses (body, fingers, face) between many users
in real time. ~116 bytes per frame, ~70× smaller than VMC, built for
WebRTC data channels and lightweight pose synchronization (PoSy).   

## Is this for me?
- ✅ You build multi-user VTuber/avatar apps in the browser or with WebRTC
- ✅ You need many participants over normal internet connections
- ❌ You need lossless studio mocap recording → use VMC/BVH instead

## Try it in 2 minutes
    git clone … && cd examples/loopback-demo && npm i && npm start

## Implement it
1. Read [spec/PoSy-1.0.md] — §3 (coordinates), §4 (bones), §5 (packets)
   are the normative core
2. Validate against [testvectors/] — if these pass, you're conformant
3. Steal from [reference/js/] freely

## Status
1.0-draft — packet format frozen, signaling layer may still change
