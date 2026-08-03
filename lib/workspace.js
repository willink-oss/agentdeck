/* UMD: workspace (session-deck) persistence logic. Pure, dependency-free.
 * Live PTYs can't be serialised — only each session's *launch config* is, so a
 * saved deck can be re-spawned on the next start. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Workspace = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEY = 'agentdeck.workspace';
  var VERSION = 2;
  var LAYOUTS = ['auto', 'fit', '1', '2', '3'];
  var META_KEYS = ['launchCwd', 'repoId', 'baseSha', 'branch', 'baseBranch', 'gitRoot', 'worktreePath'];

  function str(v, dflt) { return typeof v === 'string' ? v : (v == null ? dflt : String(v)); }
  function layout(v, fallback) {
    var value = str(v, '').trim();
    if (LAYOUTS.indexOf(value) >= 0) return value;
    var safeFallback = str(fallback, '').trim();
    return LAYOUTS.indexOf(safeFallback) >= 0 ? safeFallback : 'auto';
  }
  function copyOptional(out, source, key) {
    if (source && typeof source[key] === 'string' && source[key]) out[key] = source[key];
  }

  /** Pick the persistable launch config from a live session object. For worktree
   *  sessions cwd is the worktree path (gitCwd) so restore reopens it in place. */
  function toConfig(s) {
    s = s || {};
    var cwd = str(s.gitCwd || s.launchCwd, '');
    var out = {
      presetKey: s.presetKey ? String(s.presetKey) : 'shell',
      command: str(s.command, ''),
      name: str(s.name, ''),
      cwd: cwd,
    };
    // v2 keeps restore hints for the parent repository and original diff/base
    // branches. The main process revalidates every hint against live Git state;
    // empty fields are omitted so legacy/plain decks stay small.
    copyOptional(out, s, 'repoId');
    if (typeof s.worktreePath === 'string' && s.worktreePath) {
      if (typeof s.launchCwd === 'string' && s.launchCwd && s.launchCwd !== cwd) out.launchCwd = s.launchCwd;
      for (var i = 2; i < META_KEYS.length; i++) copyOptional(out, s, META_KEYS[i]);
    }
    return out;
  }

  /** Validate a loaded workspace (array of configs); drop malformed entries. */
  function normalize(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var c = raw[i];
      if (c && typeof c === 'object' && typeof c.presetKey === 'string' && c.presetKey) {
        var entry = {
          presetKey: c.presetKey,
          command: str(c.command, ''),
          name: str(c.name, ''),
          cwd: str(c.cwd, ''),
        };
        for (var j = 0; j < META_KEYS.length; j++) copyOptional(entry, c, META_KEYS[j]);
        out.push(entry);
      }
    }
    return out;
  }

  /** Build the persisted v2 envelope. The session array remains the same shape as
   *  v1 so older hand-edited data is easy to inspect and migration is lossless. */
  function createSnapshot(configs, layoutMode) {
    return { version: VERSION, layout: layout(layoutMode), sessions: normalize(configs) };
  }

  /** Read both the legacy raw array and the v2 envelope. Legacy data inherits the
   *  separately persisted layout choice supplied by the renderer. */
  function normalizeSnapshot(raw, fallbackLayout) {
    if (Array.isArray(raw)) return createSnapshot(raw, layout(fallbackLayout));
    if (raw && typeof raw === 'object' && Array.isArray(raw.sessions)) {
      return createSnapshot(raw.sessions, layout(raw.layout, fallbackLayout));
    }
    return createSnapshot([], layout(fallbackLayout));
  }

  return {
    KEY: KEY, VERSION: VERSION, toConfig: toConfig, normalize: normalize,
    createSnapshot: createSnapshot, normalizeSnapshot: normalizeSnapshot,
  };
}));
