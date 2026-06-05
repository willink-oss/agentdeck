'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseNumstat, parseWorktreeList, formatStat, isAgentdeckWorktreePath,
} = require('../lib/gitstat');

test('parseNumstat: sums insertions/deletions/files', () => {
  const text = '3\t1\tsrc/a.js\n10\t0\tsrc/b.js\n0\t5\tREADME.md\n';
  assert.deepEqual(parseNumstat(text), { insertions: 13, deletions: 6, files: 3 });
});

test('parseNumstat: binary files (- -) count as a file but no lines', () => {
  const text = '-\t-\timg/logo.png\n2\t2\tx.js\n';
  assert.deepEqual(parseNumstat(text), { insertions: 2, deletions: 2, files: 2 });
});

test('parseNumstat: empty / nullish -> zeroes', () => {
  assert.deepEqual(parseNumstat(''), { insertions: 0, deletions: 0, files: 0 });
  assert.deepEqual(parseNumstat(null), { insertions: 0, deletions: 0, files: 0 });
  assert.deepEqual(parseNumstat('   \n\n'), { insertions: 0, deletions: 0, files: 0 });
});

test('parseWorktreeList: parses porcelain blocks with branches', () => {
  const text = [
    'worktree /repo',
    'HEAD aaaa',
    'branch refs/heads/main',
    '',
    'worktree /repo/.agentdeck-worktrees/repo__feat-x',
    'HEAD bbbb',
    'branch refs/heads/agentdeck/feat-x',
    '',
  ].join('\n');
  const out = parseWorktreeList(text);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { path: '/repo', branch: 'main', detached: false, bare: false });
  assert.equal(out[1].path, '/repo/.agentdeck-worktrees/repo__feat-x');
  assert.equal(out[1].branch, 'agentdeck/feat-x');
});

test('parseWorktreeList: handles a detached worktree and trailing block', () => {
  const text = 'worktree /repo\nHEAD aaaa\nbranch refs/heads/main\n\nworktree /tmp/d\nHEAD cccc\ndetached';
  const out = parseWorktreeList(text);
  assert.equal(out.length, 2);
  assert.equal(out[1].detached, true);
  assert.equal(out[1].branch, '');
});

test('parseWorktreeList: flags a bare entry (so callers can exclude it)', () => {
  const text = 'worktree /repo.git\nbare\n\nworktree /repo/wt\nHEAD aaaa\nbranch refs/heads/x';
  const out = parseWorktreeList(text);
  assert.equal(out.length, 2);
  assert.equal(out[0].bare, true);
  assert.equal(out[1].bare, false);
  assert.equal(out[1].branch, 'x');
});

test('parseWorktreeList: empty -> []', () => {
  assert.deepEqual(parseWorktreeList(''), []);
});

test('formatStat: only non-zero parts, blank when clean', () => {
  assert.equal(formatStat({ insertions: 12, deletions: 3 }), '+12 -3');
  assert.equal(formatStat({ insertions: 5, deletions: 0 }), '+5');
  assert.equal(formatStat({ insertions: 0, deletions: 7 }), '-7');
  assert.equal(formatStat({ insertions: 0, deletions: 0 }), '');
  assert.equal(formatStat(null), '');
});

test('isAgentdeckWorktreePath: matches the managed worktree folder', () => {
  assert.equal(isAgentdeckWorktreePath('/x/.agentdeck-worktrees/repo__b'), true);
  assert.equal(isAgentdeckWorktreePath('/x/repo'), false);
  assert.equal(isAgentdeckWorktreePath(''), false);
});
