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

test('compare: unparseable inputs are treated as equal (no false update)', () => {
  assert.equal(compare('garbage', '0.1.0'), 0);
  assert.equal(isNewer('garbage', '0.1.0'), false);
});
