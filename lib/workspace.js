/* UMD: workspace (session-deck) persistence logic. Pure, dependency-free.
 * Live PTYs can't be serialised — only each session's *launch config* is, so a
 * saved deck can be re-spawned on the next start. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Workspace = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEY = 'agentdeck.workspace';

  function str(v, dflt) { return typeof v === 'string' ? v : (v == null ? dflt : String(v)); }

  /** Pick the persistable launch config from a live session object. For worktree
   *  sessions cwd is the worktree path (gitCwd) so restore reopens it in place. */
  function toConfig(s) {
    s = s || {};
    return {
      presetKey: s.presetKey ? String(s.presetKey) : 'shell',
      command: str(s.command, ''),
      name: str(s.name, ''),
      cwd: str(s.gitCwd || s.launchCwd, ''),
    };
  }

  /** Validate a loaded workspace (array of configs); drop malformed entries. */
  function normalize(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var c = raw[i];
      if (c && typeof c === 'object' && typeof c.presetKey === 'string' && c.presetKey) {
        out.push({
          presetKey: c.presetKey,
          command: str(c.command, ''),
          name: str(c.name, ''),
          cwd: str(c.cwd, ''),
        });
      }
    }
    return out;
  }

  return { KEY: KEY, toConfig: toConfig, normalize: normalize };
}));
