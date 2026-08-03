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

  /** Comparison-only path form: normalise separators, collapse dot segments, and
   *  case-fold Windows paths. Stored ids keep their original spelling. Symlink
   *  resolution remains a main-process filesystem responsibility. */
  function comparisonPath(p) {
    var original = normalizePath(p);
    if (!original) return '';
    var windows = /^[A-Za-z]:/.test(original) || original.indexOf('\\') >= 0;
    var s = original.replace(/\\/g, '/');
    var drive = /^[A-Za-z]:/.test(s) ? s.slice(0, 2) : '';
    if (drive) s = s.slice(2);
    var absolute = s.charAt(0) === '/';
    s = s.replace(/^\/+/, '');
    var parts = [], raw = s.split('/');
    for (var i = 0; i < raw.length; i++) {
      var part = raw[i];
      if (!part || part === '.') continue;
      if (part === '..') {
        if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
        else if (!absolute) parts.push(part);
      } else parts.push(part);
    }
    var out = drive + (absolute ? '/' : '') + parts.join('/');
    if (!drive && absolute) out = '/' + parts.join('/');
    if (!out && absolute) out = '/';
    return windows ? out.toLowerCase() : out;
  }

  function ownsPath(target, base) {
    if (target === base) return true;
    if (base === '/') return target.charAt(0) === '/';
    return target.indexOf(base + '/') === 0;
  }

  /** Find the registered repository that owns a working directory. Exact pinned
   *  matches (Home) are allowed, but only persisted repositories match descendants:
   *  otherwise every unregistered directory below Home would swallow the "Other"
   *  group. Longest-prefix wins when repositories are nested. */
  function findForPath(list, pinned, dir) {
    var norm = comparisonPath(dir);
    if (!norm) return null;
    if (pinned && comparisonPath(pinned.path || pinned.id) === norm) return pinned;
    var arr = Array.isArray(list) ? list : [];
    var best = null;
    var bestLen = -1;
    for (var i = 0; i < arr.length; i++) {
      var repo = arr[i];
      if (!repo) continue;
      var candidates = [repo.realPath, repo.path || repo.id];
      for (var j = 0; j < candidates.length; j++) {
        var base = comparisonPath(candidates[j]);
        if (base && ownsPath(norm, base) && base.length > bestLen) {
          best = repo;
          bestLen = base.length;
        }
      }
    }
    return best;
  }

  return {
    normalizePath, repoNameFromPath, makeRepo, addRepo, removeRepo, findRepo,
    effectiveRepos, findEff, findForPath,
  };
}));
