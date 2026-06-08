'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { score, matches } = require('../lib/fuzzy');

test('empty query is a neutral match (score 0) for any text', () => {
  assert.equal(score('', 'anything'), 0);
  assert.equal(score('', ''), 0);
  assert.equal(matches('', 'x'), true);
});

test('subsequence matches; non-subsequence returns null', () => {
  assert.equal(matches('ac', 'abc'), true);
  assert.equal(matches('abc', 'abc'), true);
  assert.equal(score('xyz', 'abc'), null);
  assert.equal(score('cba', 'abc'), null); // order matters
  assert.equal(matches('aclean', 'agent-cleanup'), true); // a-c-l-e-a-n in order
  assert.equal(matches('agz', 'agent-cleanup'), false);   // no 'z'
});

test('case-insensitive', () => {
  assert.equal(matches('AB', 'ab'), true);
  assert.equal(matches('ab', 'AB'), true);
  assert.equal(score('Ab', 'aB'), score('ab', 'ab'));
});

test('consecutive run scores higher than a spread-out match', () => {
  assert.ok(score('ab', 'abxx') > score('ab', 'axbx'));
});

test('word-boundary hit scores higher than mid-word', () => {
  assert.ok(score('c', 'a-c') > score('c', 'ac'));   // after a separator
  assert.ok(score('a', 'abc') > score('b', 'abc'));  // start-of-string beats interior
});

test('returns positive number on match', () => {
  assert.ok(score('a', 'abc') > 0);
  assert.equal(typeof score('agent', 'my-agent-1'), 'number');
});
