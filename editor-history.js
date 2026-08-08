/* =========================================================
   WebScan Editor History

   Undo / redo for the document editor.

   The model is non-destructive: a page keeps an immutable
   `originalSrc` plus a set of edit values. History stores
   snapshots of those values, never pixels, so undo is exact
   and cheap regardless of image size.

   Crop is the one operation that must bake pixels. It is
   handled by storing the cropped result separately from the
   original, so undoing a crop restores the untouched capture.
   ========================================================= */

(() => {
  "use strict";

  // Fields that describe how a page is rendered. Everything here is
  // reversible, so a snapshot of these values fully defines the look.
  const EDIT_FIELDS = [
    "filter",
    "brightness",
    "contrast",
    "sharpness",
    "saturation",
    "exposure",
    "rotation",
    "src",
    "corners"
  ];

  const DEFAULTS = {
    filter: "original",
    brightness: 0,
    contrast: 0,
    sharpness: 0,
    saturation: 0,
    exposure: 0,
    rotation: 0
  };

  // Depth is bounded so a long session cannot grow without limit.
  const MAX_HISTORY = 40;

  // pageId -> { stack: [], index: number }
  const histories = new Map();

  function snapshot(page) {
    const out = {};

    for (const field of EDIT_FIELDS) {
      const value = page[field];

      // Corners are an array, so they are copied rather than shared;
      // otherwise a later mutation would silently rewrite history.
      out[field] = Array.isArray(value)
        ? value.map(p => ({ ...p }))
        : value;
    }

    return out;
  }

  function applySnapshot(page, snap) {
    for (const field of EDIT_FIELDS) {
      const value = snap[field];

      page[field] = Array.isArray(value)
        ? value.map(p => ({ ...p }))
        : value;
    }
  }

  function sameSnapshot(a, b) {
    for (const field of EDIT_FIELDS) {
      const x = a[field];
      const y = b[field];

      if (Array.isArray(x) || Array.isArray(y)) {
        if (!Array.isArray(x) || !Array.isArray(y)) return false;
        if (x.length !== y.length) return false;

        for (let i = 0; i < x.length; i++) {
          if (x[i].x !== y[i].x || x[i].y !== y[i].y) return false;
        }

        continue;
      }

      if (x !== y) return false;
    }

    return true;
  }

  function historyFor(page) {
    let entry = histories.get(page.id);

    if (!entry) {
      entry = { stack: [snapshot(page)], index: 0 };
      histories.set(page.id, entry);
    }

    return entry;
  }

  /*
    Records the page's current state as a new history step.

    Called AFTER a change is applied. Identical consecutive states are
    dropped so dragging a slider does not fill the stack with noise --
    callers commit once the interaction settles.
  */
  function commit(page) {
    if (!page) return;

    const entry = historyFor(page);
    const next = snapshot(page);

    if (sameSnapshot(entry.stack[entry.index], next)) {
      return;
    }

    // A new action after undoing discards the redo branch.
    entry.stack.splice(entry.index + 1);
    entry.stack.push(next);

    if (entry.stack.length > MAX_HISTORY) {
      entry.stack.shift();
    }

    entry.index = entry.stack.length - 1;
  }

  function canUndo(page) {
    if (!page) return false;
    const entry = histories.get(page.id);
    return !!entry && entry.index > 0;
  }

  function canRedo(page) {
    if (!page) return false;
    const entry = histories.get(page.id);
    return !!entry && entry.index < entry.stack.length - 1;
  }

  function undo(page) {
    if (!canUndo(page)) return false;

    const entry = histories.get(page.id);
    entry.index--;
    applySnapshot(page, entry.stack[entry.index]);

    return true;
  }

  function redo(page) {
    if (!canRedo(page)) return false;

    const entry = histories.get(page.id);
    entry.index++;
    applySnapshot(page, entry.stack[entry.index]);

    return true;
  }

  /*
    Restores the page to its untouched capture: default adjustments and
    the original, uncropped image. Recorded as a normal step so it can
    itself be undone.
  */
  function reset(page) {
    if (!page) return;

    Object.assign(page, DEFAULTS);

    // originalSrc is never written after capture, so this always
    // recovers the true original even after a crop.
    if (page.originalSrc) {
      page.src = page.originalSrc;
    }

    page.corners = page.originalCorners
      ? page.originalCorners.map(p => ({ ...p }))
      : null;

    commit(page);
  }

  function forget(pageId) {
    histories.delete(pageId);
  }

  /* Drops histories for pages that no longer exist. */
  function prune(livePages) {
    const alive = new Set(livePages.map(p => p.id));

    for (const id of Array.from(histories.keys())) {
      if (!alive.has(id)) histories.delete(id);
    }
  }

  window.WebScanHistory = {
    commit,
    undo,
    redo,
    reset,
    canUndo,
    canRedo,
    forget,
    prune,
    snapshot,
    EDIT_FIELDS,
    DEFAULTS
  };
})();
