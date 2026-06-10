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

const Fuzzy = require('../lib/fuzzy');

test('rankSessions: name hits outrank context-only hits', () => {
  const ranked = Fuzzy.rankSessions('api', [
    { id: 'a', name: 'worker', context: 'api-repo · main', attention: false, lastData: 1 },
    { id: 'b', name: 'api server', context: 'other', attention: false, lastData: 1 },
  ]);
  assert.deepEqual(ranked.map((r) => r.entry.id), ['b', 'a']);
});

test('rankSessions: non-matches are dropped entirely', () => {
  const ranked = Fuzzy.rankSessions('zzz', [
    { id: 'a', name: 'worker', context: 'repo', attention: true, lastData: 9 },
  ]);
  assert.equal(ranked.length, 0);
});

test('rankSessions: attention floats to the top; ties break on recency', () => {
  const ranked = Fuzzy.rankSessions('', [
    { id: 'old', name: 'a', context: '', attention: false, lastData: 100 },
    { id: 'hot', name: 'b', context: '', attention: true, lastData: 1 },
    { id: 'new', name: 'c', context: '', attention: false, lastData: 200 },
  ]);
  assert.deepEqual(ranked.map((r) => r.entry.id), ['hot', 'new', 'old']);
});

test('rankSessions: empty query matches everything (score 0 base)', () => {
  const ranked = Fuzzy.rankSessions('  ', [
    { id: 'a', name: 'x', context: '', attention: false, lastData: 1 },
  ]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].sc, 10); // empty query scores 0 on name +10 bonus
});

test('rankSessions: tolerates a non-array input', () => {
  assert.deepEqual(Fuzzy.rankSessions('q', null), []);
});
