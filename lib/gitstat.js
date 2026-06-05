/* UMD: git diff-stat + worktree parsing (Electron main + renderer + tests).
   Pure string->data transforms, dependency-free. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GitStat = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Sum `git diff --numstat` output -> { insertions, deletions, files }.
   *  Lines are "<added>\t<deleted>\t<path>"; binary files use "-" for counts. */
  function parseNumstat(text) {
    var ins = 0, del = 0, files = 0;
    var lines = String(text == null ? '' : text).split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line.trim()) continue;
      var parts = line.split('\t');
      if (parts.length < 3) continue;
      files++;
      if (parts[0] !== '-') ins += (parseInt(parts[0], 10) || 0);
      if (parts[1] !== '-') del += (parseInt(parts[1], 10) || 0);
    }
    return { insertions: ins, deletions: del, files: files };
  }

  /** Parse `git worktree list --porcelain` into [{ path, branch, detached }]. */
  function parseWorktreeList(text) {
    var out = [], cur = null;
    var lines = String(text == null ? '' : text).split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/\s+$/, '');
      if (line.indexOf('worktree ') === 0) {
        if (cur) out.push(cur);
        cur = { path: line.slice('worktree '.length), branch: '', detached: false, bare: false };
      } else if (cur && line.indexOf('branch ') === 0) {
        cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
      } else if (cur && line === 'detached') {
        cur.detached = true;
      } else if (cur && line === 'bare') {
        cur.bare = true;
      } else if (line === '') {
        if (cur) { out.push(cur); cur = null; }
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  /** "+12 -3" for the badge, or "" when there are no line changes. */
  function formatStat(stat) {
    if (!stat) return '';
    var parts = [];
    if (stat.insertions) parts.push('+' + stat.insertions);
    if (stat.deletions) parts.push('-' + stat.deletions);
    return parts.join(' ');
  }

  /** True for worktrees Agent Deck created (under .agentdeck-worktrees). */
  function isAgentdeckWorktreePath(p) {
    return String(p == null ? '' : p).indexOf('.agentdeck-worktrees') !== -1;
  }

  return { parseNumstat, parseWorktreeList, formatStat, isAgentdeckWorktreePath };
}));
