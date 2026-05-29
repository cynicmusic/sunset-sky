export class BuildConsole {
  constructor({ parent = document.body, label = 'sim build', settleMs = 600 } = {}) {
    this.label = label;
    this.settleMs = settleMs;
    this._lines = [];
    this._active = false;
    this._count = 0;
    this._total = 1;
    this._t0 = performance.now();
    this._last = this._t0;
    this._hideTimer = null;

    this.root = document.createElement('div');
    this.root.className = 'iso-build-console';
    this.root.innerHTML = `
      <div class="iso-build-row">
        <span class="iso-build-spin">|</span>
        <span class="iso-build-title"></span>
        <span class="iso-build-time"></span>
      </div>
      <div class="iso-build-track"><i></i></div>
      <div class="iso-build-lines"></div>
    `;
    this.spinEl = this.root.querySelector('.iso-build-spin');
    this.titleEl = this.root.querySelector('.iso-build-title');
    this.timeEl = this.root.querySelector('.iso-build-time');
    this.barEl = this.root.querySelector('.iso-build-track i');
    this.linesEl = this.root.querySelector('.iso-build-lines');
    parent.appendChild(this.root);
    this._mode = 'transition';
    this._renderIdle();
  }

  start(label = this.label, total = 8, options = {}) {
    if (this._hideTimer) {
      clearTimeout(this._hideTimer);
      this._hideTimer = null;
    }
    this.label = label;
    this._mode = options.mode || this._mode || 'transition';
    this._active = true;
    this._count = 0;
    this._total = Math.max(1, total | 0);
    this._t0 = performance.now();
    this._last = this._t0;
    this._lines = [];
    this.root.classList.remove('boot', 'transition');
    this.root.classList.add(this._mode, 'visible', 'active');
    this.step('start');
  }

  step(name, detail = '') {
    const now = performance.now();
    const sinceStart = now - this._t0;
    const delta = now - this._last;
    this._last = now;
    this._count = Math.min(this._total, this._count + 1);
    const msg = `${String(this._count).padStart(2, '0')} ${name.padEnd(16, ' ')} +${delta.toFixed(1)}ms  ${sinceStart.toFixed(1)}ms${detail ? `  ${detail}` : ''}`;
    this._lines.push(msg);
    if (this._lines.length > 4) this._lines.shift();
    this._render();
  }

  done(name = 'ready') {
    this.step(name);
    this._active = false;
    this._count = this._total;
    this.root.classList.remove('active');
    this._render();
    this._hideTimer = setTimeout(() => {
      this.root.classList.remove('visible');
      this._hideTimer = null;
    }, this.settleMs);
  }

  _render() {
    const now = performance.now();
    const t = Math.max(0, now - this._t0);
    const frames = '|/-\\';
    this.spinEl.textContent = this._active ? frames[(Math.floor(now / 120) % frames.length)] : ' ';
    this.titleEl.textContent = this.label;
    this.timeEl.textContent = `${t.toFixed(0)}ms`;
    this.barEl.style.transform = `scaleX(${Math.max(0.04, Math.min(1, this._count / this._total))})`;
    this.linesEl.textContent = this._lines.join('\n');
  }

  _renderIdle() {
    this.titleEl.textContent = this.label;
    this.timeEl.textContent = 'idle';
    this.barEl.style.transform = 'scaleX(0.04)';
    this.linesEl.textContent = 'waiting';
    this.root.classList.remove('visible', 'active', 'boot', 'transition');
    this.root.classList.add(this._mode || 'transition');
  }
}
