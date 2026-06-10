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

  /** Rank palette entries ({id, name, context, attention, lastData}) for `query`.
   *  A name hit (+10) outranks a context-only hit; non-matches are dropped;
   *  attention-flagged entries float to the top; ties break on recent output. */
  function rankSessions(query, entries) {
    var q = String(query == null ? '' : query).trim();
    var out = [];
    var list = Array.isArray(entries) ? entries : [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      var ns = score(q, e.name);
      var cs = score(q, e.context);
      var sc = Math.max(ns != null ? ns + 10 : -Infinity, cs != null ? cs : -Infinity);
      if (sc === -Infinity) continue;
      if (e.attention) sc += 1000;
      out.push({ entry: e, sc: sc });
    }
    out.sort(function (a, b) { return (b.sc - a.sc) || ((b.entry.lastData || 0) - (a.entry.lastData || 0)); });
    return out;
  }

  return { score: score, matches: matches, rankSessions: rankSessions };
}));
