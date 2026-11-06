// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The RadioFoundry Authors
// Adapted from RadioFoundry 75c46ea46d5ebf6406f5b4ce0bbe2443b7649f91,
// site/static/js/editor/undo.js. See ../UPSTREAM.md and LICENSE.RadioFoundry.
// DM32's bounded model contains only plain nested values. Snapshot the complete
// logical model, without the transport, radio identity or programming baseline.
const LIMIT = 60;
function snapshot(model) { return structuredClone(model); }
function restore(model, saved) {
  for (const key of Object.keys(model)) delete model[key];
  Object.assign(model, structuredClone(saved));
}

export class History {
  constructor() { this.past = []; this.future = []; }
  reset() { this.past = []; this.future = []; }
  record(model, label = '') {
    this.past.push({ s: snapshot(model), label });
    if (this.past.length > LIMIT) this.past.shift();
    this.future = [];
  }
  cancel() { this.past.pop(); }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  undo(model) {
    const entry = this.past.pop();
    if (!entry) return null;
    this.future.push({ s: snapshot(model), label: entry.label });
    restore(model, entry.s);
    return entry.label;
  }
  redo(model) {
    const entry = this.future.pop();
    if (!entry) return null;
    this.past.push({ s: snapshot(model), label: entry.label });
    restore(model, entry.s);
    return entry.label;
  }
}
