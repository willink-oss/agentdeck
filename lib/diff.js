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

  function tokenize(s) { return String(s == null ? '' : s).match(/\w+|\s+|[^\w\s]/g) || []; }

  /** Merge neighbouring parts that share the same `changed` flag. */
  function mergeParts(parts) {
    const out = [];
    for (const p of parts) {
      const last = out[out.length - 1];
      if (last && last.changed === p.changed) last.text += p.text;
      else out.push({ text: p.text, changed: p.changed });
    }
    return out;
  }

  /** Intra-line (word-level) diff of two strings via a token LCS. Returns the
   *  per-side parts, each marked `changed:true` where the token isn't shared. */
  function wordDiff(a, b) {
    const ta = tokenize(a), tb = tokenize(b);
    const n = ta.length, m = tb.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = ta[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const ap = [], bp = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (ta[i] === tb[j]) { ap.push({ text: ta[i], changed: false }); bp.push({ text: tb[j], changed: false }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ap.push({ text: ta[i], changed: true }); i++; }
      else { bp.push({ text: tb[j], changed: true }); j++; }
    }
    while (i < n) { ap.push({ text: ta[i++], changed: true }); }
    while (j < m) { bp.push({ text: tb[j++], changed: true }); }
    return { a: mergeParts(ap), b: mergeParts(bp) };
  }

  const isDel = (s) => s.cls === 'dl dl-del';
  const isAdd = (s) => s.cls === 'dl dl-add';

  /** Turn raw diff text (+ untracked list) into render-ready segments.
   *  Equal-length blocks of removed-then-added lines also get a `parts` array
   *  (the line split into common vs changed spans) for word-level highlighting. */
  function diffToSegments(diff, untracked) {
    const segs = [];
    for (const ln of String(diff == null ? '' : diff).split('\n')) {
      segs.push({ cls: classifyLine(ln), text: ln });
    }
    // word-level pass: pair a run of `-` lines with an equal-length run of `+` lines
    for (let k = 0; k < segs.length; k++) {
      if (!isDel(segs[k])) continue;
      let d = k; while (d < segs.length && isDel(segs[d])) d++;
      let a = d; while (a < segs.length && isAdd(segs[a])) a++;
      const count = d - k;
      if (count > 0 && count === a - d) {
        for (let p = 0; p < count; p++) {
          const del = segs[k + p], add = segs[d + p];
          if (del.text.length > 1500 || add.text.length > 1500) continue; // skip huge lines: LCS is O(n*m)
          const wd = wordDiff(del.text.slice(1), add.text.slice(1)); // drop leading -/+
          del.parts = [{ text: del.text.slice(0, 1), changed: false }, ...wd.a];
          add.parts = [{ text: add.text.slice(0, 1), changed: false }, ...wd.b];
        }
      }
      k = a - 1;
    }
    if (untracked && untracked.length) {
      segs.push({ cls: 'dl dl-hunk', text: `@@ untracked (${untracked.length}) @@` });
      for (const f of untracked) segs.push({ cls: 'dl dl-add', text: `+ ${f}` });
    }
    return segs;
  }

  function escapeHtml(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** The b-side path of a 'diff --git a/x b/x' header (handles git's quoted
   *  form for paths with spaces), or null for any other line. */
  function parseFileHeader(line) {
    const s = String(line == null ? '' : line);
    if (!s.startsWith('diff --git ')) return null;
    const m = s.match(/ "b\/(.+)"$/) || s.match(/ b\/(.+)$/);
    return m ? m[1] : null;
  }

  /** Per-file jump points: [{path, idx}] where idx is the segment index —
   *  segmentsToHtml emits one block <span> per segment, so idx doubles as the
   *  #diff-body child index for scroll targeting. */
  function fileIndex(segs) {
    const out = [];
    (segs || []).forEach((seg, idx) => {
      const path = seg && seg.cls === 'dl dl-file' ? parseFileHeader(seg.text) : null;
      if (path !== null) out.push({ path, idx });
    });
    return out;
  }

  const SX_CLS = { kw: 'sx-kw', str: 'sx-str', com: 'sx-com', num: 'sx-num' }; // trusted

  /** Tokens -> escaped HTML; plain tokens stay bare text (smaller output). */
  function tokensToHtml(tokens) {
    let html = '';
    for (const t of tokens) html += t.type ? `<span class="${SX_CLS[t.type]}">${escapeHtml(t.text)}</span>` : escapeHtml(t.text);
    return html;
  }

  /** Word-diff parts × syntax tokens for one line: both lists concatenate to the
   *  full line text (invariants of diffToSegments and tokenizeLine), so walk them
   *  in lockstep, slicing tokens at part boundaries — changed parts keep their
   *  .dl-word background with the syntax spans nested inside. */
  function overlayHtml(parts, tokens) {
    let html = '', ti = 0, tOff = 0;
    for (const part of parts) {
      let need = part.text.length, inner = '';
      while (need > 0 && ti < tokens.length) {
        const t = tokens[ti];
        const take = Math.min(t.text.length - tOff, need);
        const slice = t.text.substr(tOff, take);
        inner += t.type ? `<span class="${SX_CLS[t.type]}">${escapeHtml(slice)}</span>` : escapeHtml(slice);
        tOff += take; need -= take;
        if (tOff >= t.text.length) { ti++; tOff = 0; }
      }
      if (need > 0) inner += escapeHtml(part.text.slice(part.text.length - need)); // defensive: lists out of sync
      html += part.changed ? `<span class="dl-word">${inner}</span>` : inner;
    }
    return html;
  }

  /** Render segments to the diff-drawer HTML string. The only place diff text
   *  meets innerHTML, so escaping lives (and is unit-tested) here: `cls` comes
   *  from classifyLine / SX_CLS (trusted), everything else is escaped content.
   *  Pass `syntax` ({langFromPath, tokenizeLine} — lib/syntax.js) to colour code
   *  lines; the language follows the current 'diff --git' file header. Omitted,
   *  the output is byte-identical to the pre-syntax version. */
  function segmentsToHtml(segs, syntax) {
    let html = '';
    let lang = null;
    for (const seg of segs || []) {
      if (syntax) {
        if (seg.cls === 'dl dl-file') {
          const path = parseFileHeader(seg.text);
          if (path !== null) lang = syntax.langFromPath(path);
        } else if (seg.cls === 'dl dl-hunk' && seg.text.startsWith('@@ untracked')) {
          lang = null; // the untracked list is filenames, not code
        }
      }
      const code = lang && (seg.cls === 'dl' || seg.cls === 'dl dl-add' || seg.cls === 'dl dl-del');
      if (seg.parts) {
        const inner = code
          ? overlayHtml(seg.parts, syntax.tokenizeLine(seg.text, lang))
          : seg.parts.map((p) => p.changed ? `<span class="dl-word">${escapeHtml(p.text)}</span>` : escapeHtml(p.text)).join('');
        html += `<span class="${seg.cls}">${inner || '&nbsp;'}</span>`;
      } else {
        const inner = code ? tokensToHtml(syntax.tokenizeLine(seg.text, lang)) : escapeHtml(seg.text);
        html += `<span class="${seg.cls}">${inner || '&nbsp;'}</span>`;
      }
    }
    return html;
  }

  return { classifyLine, diffToSegments, wordDiff, escapeHtml, segmentsToHtml, parseFileHeader, fileIndex };
}));
