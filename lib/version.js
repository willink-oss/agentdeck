/* UMD: semver-ish version comparison for the update checker. Pure, dependency-free.
 * Handles "v1.2.3", "1.2.3", and prereleases ("1.2.3-beta.1"). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Version = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Parse a version string into {major,minor,patch,pre} or null if unparseable.
   *  Build metadata (SemVer §10, "+...") is accepted but dropped — it must be
   *  ignored for precedence — so an external release tag like "v1.0.0+ci.42"
   *  still compares correctly instead of failing to parse (no update offered). */
  function parse(v) {
    var s = String(v == null ? '' : v).trim().replace(/^v/i, '');
    var m = s.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
    if (!m) return null;
    return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || '' };
  }

  /** Compare two NON-EMPTY prerelease strings per semver §11.
   * Dot-separated identifiers compared left to right:
   *   - both numeric  -> numeric compare ("beta.10" > "beta.2", not string compare)
   *   - numeric vs alphanumeric -> numeric ranks lower
   *   - both alphanumeric -> ASCII lexical compare
   *   - all equal so far -> the larger identifier set wins ("beta.1" > "beta"). */
  function comparePre(a, b) {
    var ai = a.split('.'), bi = b.split('.');
    var n = Math.min(ai.length, bi.length);
    for (var i = 0; i < n; i++) {
      if (ai[i] === bi[i]) continue;
      var na = /^\d+$/.test(ai[i]), nb = /^\d+$/.test(bi[i]);
      if (na && nb) {
        // Numeric identifiers compare by value. Equal values (e.g. a leading-zero
        // form "01" vs "1" — invalid semver but tolerated as equal) fall through.
        // Real prerelease counters stay far below Number's 2^53 safe-integer limit.
        if (+ai[i] !== +bi[i]) return +ai[i] < +bi[i] ? -1 : 1;
        continue;
      }
      if (na) return -1;
      if (nb) return 1;
      return ai[i] < bi[i] ? -1 : 1;
    }
    return ai.length === bi.length ? 0 : (ai.length < bi.length ? -1 : 1);
  }

  /** -1 / 0 / 1 like a comparator. Unparseable inputs compare as equal (0). */
  function compare(a, b) {
    var pa = parse(a), pb = parse(b);
    if (!pa || !pb) return 0;
    var keys = ['major', 'minor', 'patch'];
    for (var i = 0; i < keys.length; i++) {
      if (pa[keys[i]] !== pb[keys[i]]) return pa[keys[i]] < pb[keys[i]] ? -1 : 1;
    }
    // a release outranks a prerelease of the same x.y.z (1.0.0 > 1.0.0-beta)
    if (pa.pre === pb.pre) return 0;
    if (!pa.pre) return 1;
    if (!pb.pre) return -1;
    return comparePre(pa.pre, pb.pre);
  }

  /** True when `candidate` is a strictly newer version than `current`. */
  function isNewer(candidate, current) { return compare(candidate, current) > 0; }

  return { parse: parse, compare: compare, isNewer: isNewer };
}));
