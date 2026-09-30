// A stand-in for a real WebRTC data channel. It carries opaque bytes and can
// drop them (packet loss) or hold them for a random extra delay (jitter), so the
// receiver's jitter buffer and interpolation have something to cope with.

export interface ChannelPacket {
  bytes: Uint8Array;
}

export interface ChannelStats {
  delivered: number;
  dropped: number;
}

export class LossyChannel {
  lossPct = 0; // 0..100
  jitterMs = 0; // max extra random delay on top of the base latency
  baseLatencyMs = 30;

  readonly stats: ChannelStats = { delivered: 0, dropped: 0 };

  constructor(private readonly onDeliver: (packet: ChannelPacket) => void) {}

  /** Offer a packet to the channel. It may vanish, and it may arrive late. */
  send(bytes: Uint8Array): void {
    if (Math.random() * 100 < this.lossPct) {
      this.stats.dropped++;
      return;
    }
    const delay = this.baseLatencyMs + Math.random() * this.jitterMs;
    setTimeout(() => {
      this.stats.delivered++;
      // Copy so a later mutation of the source buffer can't reach the receiver.
      this.onDeliver({ bytes: bytes.slice() });
    }, delay);
  }
}
