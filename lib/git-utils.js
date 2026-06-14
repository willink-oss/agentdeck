/* UMD: usable from Electron main (require), renderer (script tag), and tests (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GitUtils = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Pick a default shell per platform. Pure: inject platform + env. */
  function defaultShell(platform, env) {
    env = env || {};
    if (platform === 'win32') return 'powershell.exe';
    return env.SHELL || '/bin/zsh';
  }

  /** Make a string safe to use as a git branch name. The result satisfies
   *  `git check-ref-format`: no ".." run, no ".lock" component suffix, and no
   *  leading/trailing "/", "-", or "." — otherwise `git worktree add -b` rejects it. */
  function sanitizeBranch(name) {
    return String(name == null ? '' : name)
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^A-Za-z0-9._\/-]/g, '')
      .replace(/\.{2,}/g, '.')            // git forbids ".." anywhere in a ref name
      .replace(/\.lock(?=$|\/)/g, '')     // git forbids a path component ending in ".lock"
      .replace(/^[-.\/]+|[-.\/]+$/g, '')  // no leading/trailing "/", "-", or "."
      || 'session';
  }

  /** Folder name for a worktree, e.g. "myrepo__agentdeck-feature-x". */
  function worktreeFolderName(repoBasename, branch) {
    return `${repoBasename}__${String(branch).replace(/\//g, '-')}`;
  }

  return { defaultShell, sanitizeBranch, worktreeFolderName };
}));
