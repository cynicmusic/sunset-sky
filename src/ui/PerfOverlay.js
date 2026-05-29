// Minimal perf overlay using the ported .ff-perf styling (sunset/fractal-fire
// visual identity). Reads renderer.info each tick. Toggled with F.

export class PerfOverlay {
  constructor({ scene, rows }) {
    this.scene = scene;
    this.rows = rows || null;
    this.hidden = true;                       // hidden by default — F reveals
    this.root = document.createElement('div');
    this.root.className = 'ff-perf hidden';
    this.root.innerHTML = `
      <span class="ff-perf-key">fps</span><span class="ff-perf-val" data-k="fps">—</span>
      <span class="ff-perf-key">scene tris</span><span class="ff-perf-val" data-k="tris">—</span>
      <span class="ff-perf-key">draws</span><span class="ff-perf-val" data-k="calls">—</span>
      <span class="ff-perf-key">trees</span><span class="ff-perf-val" data-k="trees">—</span>
    `;
    this.cells = {};
    for (const el of this.root.querySelectorAll('[data-k]')) this.cells[el.dataset.k] = el;

    this._frames = 0;
    this._acc = 0;
    this._fps = 0;
    requestAnimationFrame((t) => { this._last = t; this._tick(t); });
  }

  toggle() {
    this.hidden = !this.hidden;
    this.root.classList.toggle('hidden', this.hidden);
  }

  _tick(now) {
    requestAnimationFrame((t) => this._tick(t));
    const dt = (now - this._last) / 1000;
    this._last = now;
    this._frames++;
    this._acc += dt;
    if (this._acc >= 0.5) {
      this._fps = this._frames / this._acc;
      this._frames = 0;
      this._acc = 0;
      if (this.hidden) return;
      const info = this.scene?.renderer?.info;
      const fps = this._fps;
      this.cells.fps.textContent = fps.toFixed(0);
      this.cells.fps.className = 'ff-perf-val' + (fps < 24 ? ' bad' : fps < 45 ? ' warn' : '');
      if (info) {
        this.cells.tris.textContent = info.render.triangles.toLocaleString();
        this.cells.calls.textContent = String(info.render.calls);
      }
      this.cells.trees.textContent = String(this.scene?.treeCount ?? 0);
      if (this.rows) this._syncRows(this.rows());
    }
  }

  _syncRows(rows = []) {
    const seen = new Set();
    for (const row of rows) {
      if (!row?.key) continue;
      seen.add(row.key);
      let label = this.root.querySelector(`[data-extra-label="${row.key}"]`);
      let value = this.root.querySelector(`[data-extra-val="${row.key}"]`);
      if (!label || !value) {
        label = document.createElement('span');
        label.className = 'ff-perf-key';
        label.dataset.extraLabel = row.key;
        value = document.createElement('span');
        value.className = 'ff-perf-val';
        value.dataset.extraVal = row.key;
        this.root.append(label, value);
      }
      label.textContent = row.label;
      value.textContent = row.value;
    }
    for (const el of [...this.root.querySelectorAll('[data-extra-label]')]) {
      if (!seen.has(el.dataset.extraLabel)) {
        this.root.querySelector(`[data-extra-val="${el.dataset.extraLabel}"]`)?.remove();
        el.remove();
      }
    }
  }
}
