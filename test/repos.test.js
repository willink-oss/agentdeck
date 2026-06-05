'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePath, repoNameFromPath, makeRepo, addRepo, removeRepo, findRepo,
} = require('../lib/repos');

test('normalizePath: strips trailing separators', () => {
  assert.equal(normalizePath('/Users/me/repo/'), '/Users/me/repo');
  assert.equal(normalizePath('/Users/me/repo'), '/Users/me/repo');
  assert.equal(normalizePath('C:\\src\\repo\\'), 'C:\\src\\repo');
});

test('normalizePath: trims whitespace', () => {
  assert.equal(normalizePath('  /a/b  '), '/a/b');
});

test('normalizePath: blank / nullish -> empty string', () => {
  assert.equal(normalizePath(''), '');
  assert.equal(normalizePath('   '), '');
  assert.equal(normalizePath(null), '');
  assert.equal(normalizePath(undefined), '');
});

test('normalizePath: lone root survives', () => {
  assert.equal(normalizePath('/'), '/');
  assert.equal(normalizePath('///'), '/');
});

test('repoNameFromPath: last segment', () => {
  assert.equal(repoNameFromPath('/Users/me/agentdeck'), 'agentdeck');
  assert.equal(repoNameFromPath('/Users/me/agentdeck/'), 'agentdeck');
  assert.equal(repoNameFromPath('C:\\src\\tsuu'), 'tsuu');
});

test('repoNameFromPath: degenerate paths fall back', () => {
  assert.equal(repoNameFromPath('/'), '/');
  assert.equal(repoNameFromPath(''), 'repo');
});

test('normalizePath: documents Windows drive-root behavior (separator dropped)', () => {
  // Registering a bare drive root is not a real use case; this locks current behavior.
  assert.equal(normalizePath('C:\\'), 'C:');     // 'C:\' -> 'C:'
  assert.equal(repoNameFromPath('C:\\'), 'C:');
});

test('makeRepo: id equals normalised path', () => {
  const r = makeRepo('/Users/me/repo/');
  assert.deepEqual(r, { id: '/Users/me/repo', path: '/Users/me/repo', name: 'repo' });
});

test('addRepo: appends a new entry', () => {
  const out = addRepo([], '/a/b');
  assert.equal(out.length, 1);
  assert.equal(out[0].id, '/a/b');
  assert.equal(out[0].name, 'b');
});

test('addRepo: de-dups by normalised path (ignores trailing slash)', () => {
  const list = addRepo([], '/a/b');
  const same = addRepo(list, '/a/b/');
  assert.equal(same.length, 1);
});

test('addRepo: ignores blank paths', () => {
  assert.deepEqual(addRepo([], ''), []);
  assert.deepEqual(addRepo([], '   '), []);
});

test('addRepo: does not mutate the input list', () => {
  const list = [];
  const out = addRepo(list, '/a/b');
  assert.equal(list.length, 0);
  assert.equal(out.length, 1);
});

test('removeRepo: drops the matching id, returns new array', () => {
  const list = addRepo(addRepo([], '/a/b'), '/c/d');
  const out = removeRepo(list, '/a/b');
  assert.equal(out.length, 1);
  assert.equal(out[0].id, '/c/d');
  assert.equal(list.length, 2); // original untouched
});

test('removeRepo: unknown id is a no-op (same contents)', () => {
  const list = addRepo([], '/a/b');
  assert.deepEqual(removeRepo(list, '/nope'), list);
});

test('findRepo: returns entry or null', () => {
  const list = addRepo([], '/a/b');
  assert.equal(findRepo(list, '/a/b').name, 'b');
  assert.equal(findRepo(list, '/x'), null);
  assert.equal(findRepo(null, '/x'), null);
});
