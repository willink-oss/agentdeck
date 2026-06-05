/* UMD: "needs attention" heuristic (renderer + tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Attention = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Decide whether a session should be flagged as waiting for input.
   * @param {{alive:boolean,hasOutput:boolean,attention:boolean,lastData:number,watching:boolean}} s
   */
  function shouldFlagAttention(s, now, thresholdMs) {
    if (!s || !s.alive || !s.hasOutput || s.attention) return false;
    if (s.watching) return false;
    return (now - s.lastData) > thresholdMs;
  }

  return { shouldFlagAttention };
}));
