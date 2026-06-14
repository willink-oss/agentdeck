/* UMD: "needs attention" heuristic (renderer + tests). Pure, dependency-free. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Attention = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Silence alone can't tell "waiting for input" from "thinking/building", so the
   * terminal's tail lines classify the idle and pick a per-kind threshold:
   *   prompt   — a shell/agent prompt is on screen: flag fast
   *   question — an explicit y/n-style confirmation: flag fastest
   *   working  — the agent says it's busy (spinner / "esc to interrupt"): hold off
   *   plain    — no signal either way: be slower than the old default to cut
   *              false positives from long builds */
  var THRESHOLDS_MS = { question: 2500, prompt: 3000, plain: 12000, working: 30000 };

  // $/%/# must not follow a digit ("Downloading 67%", "costs 100$" are progress/
  // text, not prompts); > stays digit-tolerant for PowerShell paths ("PS C:\x>").
  var PROMPT_TAIL = /(?:(?<!\d)[$%#]|[>❯])\s*$/;
  var TAG_TAIL = /<\/?[\w!-][^<]*\/?>$/;    // "</div>", "<done/>" — markup, not a prompt
  var BOXED_PROMPT = /^[│|]\s*>/;           // Claude Code-style boxed input line
  var QUESTION = /\((?:y\/n|yes\/no)\)|\[(?:y\/n|y\/N|Y\/n)\]|\?\s*$/i;
  var OPTION_ITEM = /^[│|]?\s*❯?\s*\d+\.\s/; // numbered choice list ("❯ 1. Yes")
  var WORKING = /esc to interrupt|ctrl\+?-?c to (?:cancel|stop)/i;
  var SPINNER = /[⠁-⣿]/;          // braille spinner frames; U+2800 (blank pad) excluded

  /** Classify the last few terminal lines into prompt/question/working/plain. */
  function classifyTail(lines) {
    // Trim trailing whitespace AND U+2800 (the blank braille some TUIs pad lines
    // with) per line: \s misses U+2800, so a padded "Proceed? ⠀" or "$ ⠀" would
    // otherwise hit SPINNER ('working') and never match its \s*$-anchored pattern.
    var tail = (lines || [])
      .map(function (l) { return (l == null ? '' : String(l)).replace(/[\s⠀]+$/, ''); })
      .filter(function (l) { return l; })
      .slice(-4);
    if (!tail.length) return 'plain';
    var last = tail[tail.length - 1];
    for (var i = 0; i < tail.length; i++) {
      if (WORKING.test(tail[i])) return 'working';
    }
    if (SPINNER.test(last)) return 'working';
    for (var j = 0; j < tail.length; j++) {
      if (QUESTION.test(tail[j]) || OPTION_ITEM.test(tail[j])) return 'question';
    }
    if ((PROMPT_TAIL.test(last) && !TAG_TAIL.test(last)) || BOXED_PROMPT.test(last)) return 'prompt';
    return 'plain';
  }

  /**
   * Decide whether a session should be flagged as waiting for input.
   * `threshold` is either a number (legacy fixed cutoff) or the string kind
   * returned by classifyTail (per-kind cutoffs from THRESHOLDS_MS).
   * @param {{alive:boolean,hasOutput:boolean,attention:boolean,lastData:number,watching:boolean}} s
   */
  function shouldFlagAttention(s, now, threshold) {
    if (!s || !s.alive || !s.hasOutput || s.attention) return false;
    if (s.watching) return false;
    var ms = typeof threshold === 'number' ? threshold : (THRESHOLDS_MS[threshold] || THRESHOLDS_MS.plain);
    return (now - s.lastData) > ms;
  }

  return { shouldFlagAttention: shouldFlagAttention, classifyTail: classifyTail, THRESHOLDS_MS: THRESHOLDS_MS };
}));
