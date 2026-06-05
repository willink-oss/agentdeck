/* UMD: shared git-diff parsing (renderer + tests). DOM-free. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GitDiff = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Classify a single unified-diff line into a CSS class. */
  function classifyLine(line) {
    if (/^(diff --git|index |--- |\+\+\+ )/.test(line)) return 'dl dl-file';
    if (line.startsWith('@@')) return 'dl dl-hunk';
    if (line.startsWith('+')) return 'dl dl-add';
    if (line.startsWith('-')) return 'dl dl-del';
    return 'dl';
  }

  /** Turn raw diff text (+ untracked list) into render-ready segments. */
  function diffToSegments(diff, untracked) {
    const segs = [];
    for (const ln of String(diff == null ? '' : diff).split('\n')) {
      segs.push({ cls: classifyLine(ln), text: ln });
    }
    if (untracked && untracked.length) {
      segs.push({ cls: 'dl dl-hunk', text: `@@ untracked (${untracked.length}) @@` });
      for (const f of untracked) segs.push({ cls: 'dl dl-add', text: `+ ${f}` });
    }
    return segs;
  }

  return { classifyLine, diffToSegments };
}));
