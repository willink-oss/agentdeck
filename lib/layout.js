/* UMD: terminal-grid layout logic (renderer + tests). Pure, dependency-free. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Layout = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 'auto' = responsive auto-fit; '1'/'2'/'3' = fixed column counts.
  var MODES = ['auto', '1', '2', '3'];

  /** Coerce any input to a known layout mode, defaulting to 'auto'. */
  function normalizeLayoutMode(m) {
    var s = String(m == null ? '' : m).trim();
    return MODES.indexOf(s) >= 0 ? s : 'auto';
  }

  /** The CSS `grid-template-columns` value for a layout mode. */
  function gridTemplateFor(mode) {
    switch (normalizeLayoutMode(mode)) {
      case '1': return '1fr';
      case '2': return 'repeat(2, 1fr)';
      case '3': return 'repeat(3, 1fr)';
      default:  return 'repeat(auto-fit, minmax(440px, 1fr))';
    }
  }

  return { MODES: MODES.slice(), normalizeLayoutMode: normalizeLayoutMode, gridTemplateFor: gridTemplateFor };
}));
