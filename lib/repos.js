/* UMD: repository registry logic (Electron main + tests). Pure, dependency-free. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Repos = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Normalise a directory path for storage + de-dup. Strips trailing separators
   *  (but keeps a lone root). Returns '' for nullish/blank input. */
  function normalizePath(p) {
    var s = String(p == null ? '' : p).trim();
    if (!s) return '';
    var stripped = s.replace(/[\\/]+$/g, '');
    return stripped || s.slice(0, 1); // lone "/" or "\" survives
  }

  /** Last path segment, e.g. "/Users/me/myrepo" -> "myrepo". Falls back to the
   *  normalised path itself (then "repo") when no segment can be derived. */
  function repoNameFromPath(p) {
    var norm = normalizePath(p);
    var segs = norm.split(/[\\/]/).filter(Boolean);
    return segs.length ? segs[segs.length - 1] : (norm || 'repo');
  }

  /** Build a registry entry. `id` is the normalised path: deterministic + unique. */
  function makeRepo(p) {
    var norm = normalizePath(p);
    return { id: norm, path: norm, name: repoNameFromPath(norm) };
  }

  /** Append a repo unless its normalised path is already registered.
   *  Blank paths are ignored. Returns a new array (never mutates `list`). */
  function addRepo(list, p) {
    var arr = Array.isArray(list) ? list : [];
    var norm = normalizePath(p);
    if (!norm) return arr.slice();
    if (arr.some(function (r) { return r && r.id === norm; })) return arr.slice();
    return arr.concat([makeRepo(norm)]);
  }

  /** Remove the entry whose id matches. Returns a new array. */
  function removeRepo(list, id) {
    var arr = Array.isArray(list) ? list : [];
    return arr.filter(function (r) { return !r || r.id !== id; });
  }

  /** Find an entry by id, or null. */
  function findRepo(list, id) {
    var arr = Array.isArray(list) ? list : [];
    for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === id) return arr[i];
    return null;
  }

  /** Effective sidebar list: a pinned synthetic entry (e.g. "Home") first, then
   *  the persisted repos with any id-collision dropped (pinned wins, listed once).
   *  Pure; never mutates `list`. Returns a copy of `list` when `pinned` is nullish. */
  function effectiveRepos(list, pinned) {
    var arr = Array.isArray(list) ? list : [];
    if (!pinned) return arr.slice();
    return [pinned].concat(arr.filter(function (r) { return r && r.id !== pinned.id; }));
  }

  /** Find by id across the pinned entry and the persisted list; the pinned entry
   *  wins on id collision. Returns the entry or null. */
  function findEff(list, pinned, id) {
    if (pinned && id === pinned.id) return pinned;
    return findRepo(list, id);
  }

  return {
    normalizePath, repoNameFromPath, makeRepo, addRepo, removeRepo, findRepo,
    effectiveRepos, findEff,
  };
}));
