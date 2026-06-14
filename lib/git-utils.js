/* UMD: usable from Electron main (require), renderer (script tag), and tests (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GitUtils = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Pick a default shell per platform. Pure: inject platform + env.
   *  $SHELL wins when set; otherwise fall back per-platform. zsh is macOS's
   *  default and always present at /bin/zsh, but it is NOT installed by default
   *  on common Linux distros (Debian/Ubuntu/Alpine) — falling back to /bin/zsh
   *  there spawns a missing binary (ENOENT) and the session fails to launch, so
   *  use the universally-present POSIX /bin/sh for non-macOS Unix. */
  function defaultShell(platform, env) {
    env = env || {};
    if (platform === 'win32') return 'powershell.exe';
    if (env.SHELL) return env.SHELL;
    return platform === 'darwin' ? '/bin/zsh' : '/bin/sh';
  }

  /** Make a string safe to use as a git branch name. The result satisfies
   *  `git check-ref-format` — no ".." run, no consecutive "//", no path component
   *  beginning with "." or ending in ".lock", and no leading/trailing "/", "-", or
   *  "." — otherwise `git worktree add -b` rejects it and the session never launches. */
  function sanitizeBranch(name) {
    var s = String(name == null ? '' : name)
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^A-Za-z0-9._\/-]/g, ''); // strip chars git forbids (may empty a component)
    // The component-level rules interact: stripping ".lock"/leading-dots can expose a
    // fresh ".lock" or create a new "//", so normalize until the string stops changing
    // (each pass only removes/collapses, so this always terminates).
    var prev;
    do {
      prev = s;
      s = s
        .replace(/\.{2,}/g, '.')        // no ".." anywhere
        .replace(/\/{2,}/g, '/')        // no consecutive slashes
        .replace(/(^|\/)\.+/g, '$1')    // no path component beginning with "."
        .replace(/\.lock(?=$|\/)/g, ''); // no path component ending in ".lock"
    } while (s !== prev);
    return s.replace(/^[-.\/]+|[-.\/]+$/g, '') // no leading/trailing "/", "-", or "."
      || 'session';
  }

  /** Folder name for a worktree, e.g. "myrepo__agentdeck-feature-x". */
  function worktreeFolderName(repoBasename, branch) {
    return `${repoBasename}__${String(branch).replace(/\//g, '-')}`;
  }

  return { defaultShell, sanitizeBranch, worktreeFolderName };
}));
