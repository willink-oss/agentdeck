/* UMD: sidebar width logic. Pure, dependency-free.
 *
 * The sidebar was a fixed 264px, which is fine until a repository is called
 * `i-willink-crew` and sits under `/Users/…/GitHub/` — then the name that
 * identifies it is the part that gets truncated. Rather than pick a wider
 * number and lose it from the stage instead, the divider is draggable.
 *
 * The bounds are not decoration: below MIN the repo rows stop being readable at
 * all, and above MAX the stage can no longer hold two 420px terminal columns,
 * which is what `fit` promises (see lib/layout.js). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sidebar = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEY = 'agentdeck.sidebarWidth';
  var DEFAULT = 264;
  var MIN = 200;
  var MAX = 480;

  /** Coerce anything (stored string, drag position, junk) to a usable width. */
  function clampWidth(value) {
    var n = typeof value === 'number' ? value : parseFloat(value);
    if (!isFinite(n)) return DEFAULT;
    return Math.max(MIN, Math.min(MAX, Math.round(n)));
  }

  /** Width from a pointer position, given where the drag started. The sidebar's
   *  left edge is the window edge, so the pointer's x IS the width — but the
   *  grab offset is kept so the divider does not jump under the cursor. */
  function widthFromPointer(clientX, grabOffset) {
    return clampWidth(clientX - (grabOffset || 0));
  }

  /** Load a persisted width, falling back to the default on anything unusable. */
  function normalizeStored(raw) {
    if (raw === null || raw === undefined || raw === '') return DEFAULT;
    var n = parseFloat(raw);
    // a stored value outside the bounds is clamped rather than discarded: the
    // bounds can change between releases and the user's intent was "wide"
    return isFinite(n) ? clampWidth(n) : DEFAULT;
  }

  /** Keyboard resize step, so the divider is not mouse-only. */
  function stepWidth(current, direction, large) {
    return clampWidth(clampWidth(current) + direction * (large ? 32 : 8));
  }

  return {
    KEY: KEY, DEFAULT: DEFAULT, MIN: MIN, MAX: MAX,
    clampWidth: clampWidth, widthFromPointer: widthFromPointer,
    normalizeStored: normalizeStored, stepWidth: stepWidth,
  };
}));
