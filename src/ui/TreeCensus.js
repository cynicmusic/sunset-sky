// Tree census — per-species planted counts (palm 96 · conifer 128 · …).
// Same .ff-perf visual grammar as PerfOverlay; polls scene.treeCounts and
// re-renders when the grove changes (reseed / param edit re-plants). Toggle T.

const ORDER = ['palm', 'summer', 'autumn', 'conifer', 'winter'];

export class TreeCensus {
  constructor({ scene }) {
    this.scene = scene;
    this.hidden = true;                        // off by default — T reveals
    this.root = document.createElement('div');
    this.root.className = 'ff-perf ff-census hidden';
    this.root.style.top = '92px';              // sit below the perf overlay
    this._sig = '';
    this._render({});
    requestAnimationFrame((t) => { this._last = t; this._tick(t); });
  }

  toggle() {
    this.hidden = !this.hidden;
    this.root.classList.toggle('hidden', this.hidden);
  }

  _render(counts) {
    let total = 0;
    let html = '';
    for (const k of ORDER) {
      const n = counts[k] || 0;
      total += n;
      html += `<span class="ff-perf-key">${k}</span><span class="ff-perf-val">${n}</span>`;
    }
    html += `<span class="ff-perf-key">total</span><span class="ff-perf-val">${total}</span>`;
    this.root.innerHTML = html;
  }

  _tick(now) {
    requestAnimationFrame((t) => this._tick(t));
    if (now - this._last < 400) return;        // cheap poll, ~2.5 Hz
    this._last = now;
    if (this.hidden) return;
    const c = this.scene?.treeCounts || {};
    const sig = ORDER.map((k) => c[k] || 0).join(',');
    if (sig === this._sig) return;             // only repaint on change
    this._sig = sig;
    this._render(c);
  }
}
