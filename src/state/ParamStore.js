// Tiny reactive store. Path-addressed, listener-broadcasting.
// Path is "section.field" or "section.field.0" for indexed (range tuple).
// Subscribers get { path, value, prev } on every set.
// Ported verbatim from sunset/src/state/ParamStore.js.

import { defaultParams } from '../config/defaults.js';

function clone(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clone);
  const out = {};
  for (const k in value) out[k] = clone(value[k]);
  return out;
}

function getAt(state, path) {
  const parts = path.split('.');
  let node = state;
  for (const p of parts) {
    if (node == null) return undefined;
    node = node[p];
  }
  return node;
}

function setAt(state, path, value) {
  const parts = path.split('.');
  const last = parts.pop();
  let node = state;
  for (const p of parts) {
    if (node[p] == null) node[p] = isNaN(Number(p)) ? {} : [];
    node = node[p];
  }
  const prev = node[last];
  node[last] = value;
  return prev;
}

export class ParamStore {
  constructor(initial) {
    this.state = clone(initial ?? defaultParams);
    this.defaults = clone(defaultParams);
    this.listeners = new Set();
  }

  get(path) { return getAt(this.state, path); }

  set(path, value) {
    const prev = setAt(this.state, path, clone(value));
    this._notify(path, value, prev);
  }

  fromJSON(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    this.state = clone(snapshot);
    this._notify('*', this.state, null);
  }

  _mergeInto(target, source) {
    for (const k in source) {
      const sv = source[k];
      if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
        if (target[k] == null) target[k] = {};
        this._mergeInto(target[k], sv);
      } else {
        target[k] = clone(sv);
      }
    }
  }

  toJSON() { return clone(this.state); }

  reset() {
    this.state = clone(this.defaults);
    this._notify('*', this.state, null);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _notify(path, value, prev) {
    for (const fn of this.listeners) {
      try { fn({ path, value, prev, store: this }); }
      catch (err) { console.error('store listener error', err); }
    }
  }
}
