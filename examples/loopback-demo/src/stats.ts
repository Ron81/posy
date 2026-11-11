// Live frame-size / rate / bitrate readout, plus the channel delivery counters.

export class Stats {
  private readonly bytesEl = document.getElementById('stat-bytes')!;
  private readonly hzEl = document.getElementById('stat-hz')!;
  private readonly bitrateEl = document.getElementById('stat-bitrate')!;
  private readonly compareEl = document.getElementById('stat-compare')!;
  private readonly deliveredEl = document.getElementById('stat-delivered')!;
  private readonly droppedEl = document.getElementById('stat-dropped')!;

  private lastBytes = 0;

  // The active connection preset's bandwidth and its name, or null when the
  // user is driving the sliders by hand (no named connection to compare against).
  private connMbit: number | null = null;
  private connQuip: string | null = null;

  frame(bytes: number): void {
    this.lastBytes = bytes;
  }

  setConnection(mbit: number | null, quip: string | null): void {
    this.connMbit = mbit;
    this.connQuip = quip;
  }

  render(rateHz: number, delivered: number, dropped: number): void {
    this.bytesEl.textContent = String(this.lastBytes);
    this.hzEl.textContent = String(rateHz);
    // bytes * 8 bits * rate, in kbit/s.
    const kbits = (this.lastBytes * 8 * rateHz) / 1000;
    this.bitrateEl.textContent = kbits.toFixed(1);
    this.deliveredEl.textContent = String(delivered);
    this.droppedEl.textContent = String(dropped);

    // The raw number is about 0.03 Mbit/s, so it is shown as a share of the chosen line.
    if (kbits <= 0) return;
    const mbits = kbits / 1000;
    if (this.connMbit && this.connQuip) {
      const fraction = Math.round((this.connMbit * 1000) / kbits);
      this.compareEl.innerHTML =
        `${this.connQuip} <b>${mbits.toFixed(3)} Mbit/s</b>, ` +
        `about <b>1/${fraction}</b> of a ${this.connMbit} Mbit/s line.`;
    } else {
      this.compareEl.innerHTML =
        `≈ <b>${mbits.toFixed(3)} Mbit/s</b> up. Pick a connection above to compare it with a line.`;
    }
  }
}
