/* UMD: terminal-grid layout logic (renderer + tests). Pure, dependency-free. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Layout = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 'auto' = comfortable responsive tiles; 'fit' = dense rows that keep every
  // visible pane inside the stage; '1'/'2'/'3' = fixed column counts.
  var MODES = ['auto', 'fit', '1', '2', '3'];

  /** Coerce any input to a known layout mode, defaulting to 'auto'. */
  function normalizeLayoutMode(m) {
    var s = String(m == null ? '' : m).trim();
    return MODES.indexOf(s) >= 0 ? s : 'auto';
  }

  /** The CSS `grid-template-columns` value for a layout mode. */
  function gridTemplateFor(mode) {
    switch (normalizeLayoutMode(mode)) {
      // Sized so eight panes land as 2x4 in the default 1440px window, which is
      // what makes `fit` mean "all of them, at once". The stage is 1176px wide
      // now that there is one 264px sidebar instead of two columns totalling
      // 528px; the old 320px floor would fit three columns there (3*320+2 gaps
      // = 962 <= 1176) and quietly break that guarantee. At 420px three columns
      // need 1262px, which the default window cannot reach, while two need only
      // 841px. Still denser than `auto` (440px), which is the point of the mode.
      case 'fit': return 'repeat(auto-fit, minmax(420px, 1fr))';
      case '1': return '1fr';
      case '2': return 'repeat(2, 1fr)';
      case '3': return 'repeat(3, 1fr)';
      default:  return 'repeat(auto-fit, minmax(440px, 1fr))';
    }
  }

  /** Dense fit mode removes the 260px row floor so all visible rows share the
   *  available stage height. Other modes retain the comfortable terminal floor
   *  and rely on grid scrolling when the deck is taller than the window. */
  function gridAutoRowsFor(mode) {
    return normalizeLayoutMode(mode) === 'fit' ? 'minmax(0, 1fr)' : 'minmax(260px, 1fr)';
  }

  return {
    MODES: MODES.slice(), normalizeLayoutMode: normalizeLayoutMode,
    gridTemplateFor: gridTemplateFor, gridAutoRowsFor: gridAutoRowsFor,
  };
}));
