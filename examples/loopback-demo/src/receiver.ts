// The "receiver": decodes bytes back into Frames and runs a small jitter buffer
// (spec §8). It holds a short reordering window, releases the oldest frame once
// the window is full or a deadline passes, and discards anything older than the
// newest frame already released for playout (spec §5.7 / §8.1, corrected wording).
//
// The avatar interpolates toward `target()` every render tick, so the buffer only
// has to hand over "the latest pose that survived", not drive rendering directly.
import { decode, type Frame } from 'posy';
import type { ChannelPacket } from './channel.ts';

// seq is a u16 that wraps. Compare on the shortest signed distance so 65535 → 0
// reads as "newer", not a 65k jump backwards.
function seqNewer(a: number, b: number): boolean {
  return ((a - b) & 0xffff) < 0x8000 && a !== b;
}

interface Buffered {
  frame: Frame;
  arrivedAt: number;
}

export class Receiver {
  /** How long a frame may wait to let a slightly-late neighbour catch up. */
  bufferMs = 60;

  private buffer: Buffered[] = [];
  private newestReleasedSeq = -1;
  private current: Frame | null = null;

  decodeErrors = 0;

  /** Feed a delivered packet. Malformed frames are counted and dropped. */
  receive(packet: ChannelPacket, nowMs: number): void {
    let frame: Frame;
    try {
      frame = decode(packet.bytes);
    } catch {
      this.decodeErrors++;
      return;
    }

    // Already played something at least this new? Too late — discard (§5.7).
    if (this.newestReleasedSeq >= 0 && !seqNewer(frame.seq, this.newestReleasedSeq)) {
      return;
    }

    // Insert keeping the buffer ordered by seq (§8.1 reordering).
    let i = this.buffer.length;
    while (i > 0 && seqNewer(this.buffer[i - 1].frame.seq, frame.seq)) i--;
    this.buffer.splice(i, 0, { frame, arrivedAt: nowMs });
  }

  /** Release any frames whose hold time has elapsed; returns the latest pose. */
  target(nowMs: number): Frame | null {
    while (this.buffer.length > 0 && nowMs - this.buffer[0].arrivedAt >= this.bufferMs) {
      const released = this.buffer.shift()!;
      if (this.newestReleasedSeq < 0 || seqNewer(released.frame.seq, this.newestReleasedSeq)) {
        this.newestReleasedSeq = released.frame.seq;
        this.current = released.frame;
      }
    }
    return this.current;
  }
}
