'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parse, compare, isNewer } = require('../lib/version');

test('parse: strips leading v, splits parts and prerelease', () => {
  assert.deepEqual(parse('v1.2.3'), { major: 1, minor: 2, patch: 3, pre: '' });
  assert.deepEqual(parse('0.1.0'), { major: 0, minor: 1, patch: 0, pre: '' });
  assert.deepEqual(parse('1.2.3-beta.1'), { major: 1, minor: 2, patch: 3, pre: 'beta.1' });
});

test('parse: unparseable -> null', () => {
  assert.equal(parse(''), null);
  assert.equal(parse('latest'), null);
  assert.equal(parse(null), null);
});

test('compare: numeric precedence major>minor>patch', () => {
  assert.equal(compare('1.0.0', '0.9.9'), 1);
  assert.equal(compare('0.2.0', '0.1.9'), 1);
  assert.equal(compare('0.1.2', '0.1.1'), 1);
  assert.equal(compare('0.1.1', '0.1.1'), 0);
  assert.equal(compare('0.1.0', '0.2.0'), -1);
});

test('compare: release outranks prerelease of same x.y.z', () => {
  assert.equal(compare('1.0.0', '1.0.0-beta.1'), 1);
  assert.equal(compare('1.0.0-beta.1', '1.0.0'), -1);
  assert.equal(compare('1.0.0-beta.2', '1.0.0-beta.1'), 1);
  assert.equal(compare('1.0.0-beta.1', '1.0.0-beta.1'), 0);
});

test('compare: prerelease identifiers follow semver §11 precedence (#13)', () => {
  // numeric identifiers compare numerically, not as strings ("beta.10" > "beta.2")
  assert.equal(compare('1.0.0-beta.10', '1.0.0-beta.2'), 1);
  assert.equal(compare('1.0.0-beta.2', '1.0.0-beta.10'), -1);
  assert.equal(compare('0.4.0-beta.1', '0.4.0-beta.10'), -1);
  assert.equal(isNewer('0.4.0-beta.10', '0.4.0-beta.2'), true);
  // numeric identifiers rank lower than alphanumeric
  assert.equal(compare('1.0.0-alpha.1', '1.0.0-alpha.beta'), -1);
  // a larger set of pre-release fields wins when the shared prefix is equal
  assert.equal(compare('1.0.0-beta', '1.0.0-beta.1'), -1);
  assert.equal(compare('1.0.0-alpha.1.1', '1.0.0-alpha.1'), 1);
  // the canonical semver §11 ordering chain
  assert.equal(compare('1.0.0-alpha', '1.0.0-alpha.1'), -1);
  assert.equal(compare('1.0.0-alpha.beta', '1.0.0-beta'), -1);
  assert.equal(compare('1.0.0-beta.2', '1.0.0-beta.11'), -1);
  assert.equal(compare('1.0.0-rc.1', '1.0.0-beta.11'), 1);
  // a leading-zero numeric form (invalid semver) is tolerated as an equal value,
  // not mis-ranked above the canonical form
  assert.equal(compare('1.0.0-beta.01', '1.0.0-beta.1'), 0);
});

test('compare: tolerates a leading v on either side', () => {
  assert.equal(compare('v0.1.1', '0.1.0'), 1);
  assert.equal(compare('0.1.0', 'v0.1.1'), -1);
});

test('isNewer: true only when strictly greater', () => {
  assert.equal(isNewer('0.1.1', '0.1.0'), true);
  assert.equal(isNewer('v0.2.0', '0.1.9'), true);
  assert.equal(isNewer('0.1.0', '0.1.0'), false);
  assert.equal(isNewer('0.1.0', '0.1.1'), false);
  assert.equal(isNewer('1.0.0-beta.1', '1.0.0'), false); // prerelease is not newer than release
});

test('parse: rejects trailing junk after patch (regex is end-anchored)', () => {
  assert.equal(parse('1.2.3foo'), null);
  assert.equal(parse('1.2.3.4'), null);
  assert.equal(parse('1.2.3.4.5'), null);
  assert.equal(compare('1.2.3', '1.2.3foo'), 0); // unparseable -> equal, no false update
  // a well-formed prerelease still parses fully (no false rejection)
  assert.deepEqual(parse('1.2.3-beta.1'), { major: 1, minor: 2, patch: 3, pre: 'beta.1' });
});

test('parse: accepts but ignores SemVer build metadata (+...)', () => {
  // SemVer §10: build metadata is valid syntax and MUST be ignored for precedence.
  assert.deepEqual(parse('1.0.0+build'), { major: 1, minor: 0, patch: 0, pre: '' });
  assert.equal(parse('1.2.3-beta.1+exp.sha.5114f85').pre, 'beta.1'); // pre kept, build dropped
  assert.equal(parse('1.0.0+'), null);          // empty build still rejected (end-anchor intact)
  assert.equal(parse('1.2.3foo'), null);        // trailing junk still rejected
  // ...so an external release tag with build metadata still compares correctly
  assert.equal(isNewer('1.0.1', '1.0.0+build'), true);  // was false (no update offered)
  assert.equal(compare('1.0.0', '1.0.0+xyz'), 0);       // build ignored for precedence
});

test('compare: unparseable inputs are treated as equal (no false update)', () => {
  assert.equal(compare('garbage', '0.1.0'), 0);
  assert.equal(isNewer('garbage', '0.1.0'), false);
});

test('parse: tolerates surrounding whitespace and uppercase V (feed normalization)', () => {
  // the feed checker passes raw tag_name into compare/isNewer; these normalization
  // paths (.trim() and /^v/i) were exercised by no prior test
  assert.deepEqual(parse(' v1.2.3 '), parse('1.2.3'));
  assert.deepEqual(parse('\t1.2.3\n'), { major: 1, minor: 2, patch: 3, pre: '' });
  assert.deepEqual(parse('V0.4.0-beta.4'), { major: 0, minor: 4, patch: 0, pre: 'beta.4' });
  assert.equal(compare('V1.0.1', 'v1.0.0'), 1);
});

test('compare: antisymmetric, incl. across the release/prerelease boundary', () => {
  const pairs = [
    ['1.0.0', '0.9.9'], ['1.0.0', '1.0.0-beta.1'], ['1.0.0-beta.2', '1.0.0-beta.1'],
    ['1.0.0-alpha.1', '1.0.0-alpha.beta'], ['1.0.0-rc.1', '1.0.0-beta.11'],
    ['v0.4.0-beta.4', '0.4.0-beta.3'], ['1.0.0', '1.0.0'],
  ];
  // use the JS === operator, NOT assert.equal: assert/strict treats 0 !== -0 (Object.is),
  // but the plain === we want here considers 0 === -0 true
  for (const [a, b] of pairs) assert.ok(compare(a, b) === -compare(b, a), `${a} vs ${b}`);
});
