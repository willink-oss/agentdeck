/* UMD: tiny fuzzy (subsequence) matcher + score for the session palette. Pure. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Fuzzy = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BOUNDARY = '/ _-.';

  /** Subsequence score of `query` in `text` (case-insensitive).
   *  Returns null when `query` is not a subsequence of `text`.
   *  Empty query returns 0 (neutral match). Higher = better:
   *  consecutive runs, start-of-string and word-boundary hits are rewarded. */
  function score(query, text) {
    var q = String(query == null ? '' : query).toLowerCase();
    var t = String(text == null ? '' : text).toLowerCase();
    if (!q) return 0;
    var qi = 0, sc = 0, streak = 0, prev = -1;
    for (var ti = 0; ti < t.length && qi < q.length; ti++) {
      if (t.charAt(ti) === q.charAt(qi)) {
        var pt = 1;
        if (ti === prev + 1) { streak += 1; pt += streak * 2; } else { streak = 0; }
        if (ti === 0) pt += 5;
        else if (BOUNDARY.indexOf(t.charAt(ti - 1)) >= 0) pt += 3;
        sc += pt; prev = ti; qi += 1;
      }
    }
    return qi < q.length ? null : sc;
  }

  /** True when `query` is a (case-insensitive) subsequence of `text`. */
  function matches(query, text) { return score(query, text) !== null; }

  return { score: score, matches: matches };
}));
