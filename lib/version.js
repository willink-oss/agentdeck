/* UMD: semver-ish version comparison for the update checker. Pure, dependency-free.
 * Handles "v1.2.3", "1.2.3", and prereleases ("1.2.3-beta.1"). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Version = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Parse a version string into {major,minor,patch,pre} or null if unparseable. */
  function parse(v) {
    var s = String(v == null ? '' : v).trim().replace(/^v/i, '');
    var m = s.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
    if (!m) return null;
    return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || '' };
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
    return pa.pre < pb.pre ? -1 : (pa.pre > pb.pre ? 1 : 0);
  }

  /** True when `candidate` is a strictly newer version than `current`. */
  function isNewer(candidate, current) { return compare(candidate, current) > 0; }

  return { parse: parse, compare: compare, isNewer: isNewer };
}));
