// Live frame-size / rate / bitrate readout, plus the channel delivery counters.

export class Stats {
  private readonly bytesEl = document.getElementById('stat-bytes')!;
  private readonly hzEl = document.getElementById('stat-hz')!;
  private readonly bitrateEl = document.getElementById('stat-bitrate')!;
  private readonly deliveredEl = document.getElementById('stat-delivered')!;
  private readonly droppedEl = document.getElementById('stat-dropped')!;

  private lastBytes = 0;

  frame(bytes: number): void {
    this.lastBytes = bytes;
  }

  render(rateHz: number, delivered: number, dropped: number): void {
    this.bytesEl.textContent = String(this.lastBytes);
    this.hzEl.textContent = String(rateHz);
    // bytes * 8 bits * rate, in kbit/s.
    const kbits = (this.lastBytes * 8 * rateHz) / 1000;
    this.bitrateEl.textContent = kbits.toFixed(1);
    this.deliveredEl.textContent = String(delivered);
    this.droppedEl.textContent = String(dropped);
  }
}
