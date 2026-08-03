'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { CODES, createSessionMerge } = require('../lib/session-merge');

/* The gate in front of the two destructive session actions. Identity has already
 * been revalidated by the time these run (see test/worktree-identity.test.js);
 * what is pinned here is the precondition ORDER and the conflict→abort contract:
 * a merge that fails must always leave the base checkout clean. */

const ROOT = '/ws/app';
const WT = '/ws/.agentdeck-worktrees/app--x';
const BRANCH = 'agentdeck/x';

/** Record every git invocation so tests can assert on what actually ran. */
function harness(over = {}) {
  const calls = [];
  const world = {
    base: 'main',
    ahead: '3',
    dirty: '',
    origin: 'git@github.com:acme/app.git\n',
    mergeThrows: null,
    mergeOut: 'Merge made by the "ort" strategy.\n',
    abortThrows: false,
    ...over,
  };
  const git = async (args, cwd) => {
    calls.push({ args: args.join(' '), cwd });
    if (args[0] === 'rev-list') return world.ahead + '\n';
    if (args[0] === 'merge' && args[1] === '--abort') {
      if (world.abortThrows) throw new Error('nothing to abort');
      return '';
    }
    if (args[0] === 'merge') {
      if (world.mergeThrows) throw world.mergeThrows;
      return world.mergeOut;
    }
    throw new Error('unexpected git call: ' + args.join(' '));
  };
  const safeGit = async (args, cwd) => {
    calls.push({ args: args.join(' '), cwd, safe: true });
    if (args[0] === 'remote') return world.origin;
    if (args[0] === 'status') return world.dirty;
    return '';
  };
  const api = createSessionMerge({ git, safeGit, currentBranch: async () => world.base });
  return { ...api, calls, world };
}

const CTX = { root: ROOT, branch: BRANCH, worktree: WT };

// ---- happy paths -----------------------------------------------------------
test('merge preconditions pass and report the base branch and commit count', async () => {
  const h = harness();
  const res = await h.preconditions({ ...CTX, mode: 'merge' });
  assert.deepStrictEqual(res, { ok: true, target: 'main', ahead: 3 });
});

test('pr preconditions pass when an origin remote exists', async () => {
  const h = harness();
  const res = await h.preconditions({ ...CTX, mode: 'pr' });
  assert.deepStrictEqual(res, { ok: true, target: 'main', ahead: 3 });
});

test('merge returns the git summary on success', async () => {
  const h = harness();
  const res = await h.mergeBranch({ root: ROOT, branch: BRANCH });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.summary, 'Merge made by the "ort" strategy.');
  assert.ok(!h.calls.some((c) => c.args === 'merge --abort'), 'a successful merge never aborts');
});

test('merge commits with a message naming the session branch', async () => {
  const h = harness();
  await h.mergeBranch({ root: ROOT, branch: BRANCH });
  const call = h.calls.find((c) => c.args.startsWith('merge --no-ff'));
  assert.ok(call.args.includes(`Merge agentdeck session: ${BRANCH}`), 'merge message names the branch');
  assert.strictEqual(call.cwd, ROOT, 'merge runs in the base checkout, not the worktree');
});

// ---- detached HEAD ---------------------------------------------------------
test('rejects a detached base for merge', async () => {
  const h = harness({ base: 'HEAD' });
  const res = await h.preconditions({ ...CTX, mode: 'merge' });
  assert.strictEqual(res.code, CODES.DETACHED_BASE);
  assert.ok(res.error.includes('merge 先ブランチ'), 'merge wording');
});

test('rejects a detached base for pr with PR-specific wording', async () => {
  const h = harness({ base: 'HEAD' });
  const res = await h.preconditions({ ...CTX, mode: 'pr' });
  assert.strictEqual(res.code, CODES.DETACHED_BASE);
  assert.ok(res.error.includes('PR の base'), 'pr wording');
});

test('rejects an empty base branch', async () => {
  const h = harness({ base: '' });
  assert.strictEqual((await h.preconditions({ ...CTX, mode: 'merge' })).code, CODES.DETACHED_BASE);
});

// ---- same branch -----------------------------------------------------------
test('refuses to merge a branch into itself', async () => {
  const h = harness({ base: BRANCH });
  const res = await h.preconditions({ ...CTX, mode: 'merge' });
  assert.strictEqual(res.code, CODES.SAME_BRANCH);
  assert.ok(res.error.includes(BRANCH), 'the offending branch is named');
});

test('refuses to open a PR from a branch onto itself', async () => {
  const h = harness({ base: BRANCH });
  assert.strictEqual((await h.preconditions({ ...CTX, mode: 'pr' })).code, CODES.SAME_BRANCH);
});

// ---- origin ----------------------------------------------------------------
test('pr requires an origin remote', async () => {
  const h = harness({ origin: '' });
  assert.strictEqual((await h.preconditions({ ...CTX, mode: 'pr' })).code, CODES.NO_ORIGIN);
});

test('merge does not require an origin remote', async () => {
  const h = harness({ origin: '' });
  assert.strictEqual((await h.preconditions({ ...CTX, mode: 'merge' })).ok, true);
  assert.ok(!h.calls.some((c) => c.args.startsWith('remote')), 'merge never asks about remotes');
});

test('pr checks origin before counting commits', async () => {
  const h = harness({ origin: '' });
  await h.preconditions({ ...CTX, mode: 'pr' });
  assert.ok(!h.calls.some((c) => c.args.startsWith('rev-list')), 'no commit count when origin is missing');
});

// ---- nothing to take -------------------------------------------------------
test('reports uncommitted work when the session is not ahead but the worktree is dirty', async () => {
  const h = harness({ ahead: '0', dirty: ' M src/a.js\n' });
  const res = await h.preconditions({ ...CTX, mode: 'merge' });
  assert.strictEqual(res.code, CODES.DIRTY_WORKTREE);
  assert.ok(res.error.includes('セッション内で commit'), 'merge wording tells the user where to commit');
});

test('pr uses its own wording for an uncommitted worktree', async () => {
  const h = harness({ ahead: '0', dirty: '?? new.txt\n' });
  const res = await h.preconditions({ ...CTX, mode: 'pr' });
  assert.strictEqual(res.code, CODES.DIRTY_WORKTREE);
  assert.ok(res.error.includes('PR を作成'), 'pr wording');
});

test('reports no new commits when the session is not ahead and the worktree is clean', async () => {
  const h = harness({ ahead: '0', dirty: '' });
  assert.strictEqual((await h.preconditions({ ...CTX, mode: 'merge' })).code, CODES.NO_NEW_COMMITS);
});

test('treats an unparseable commit count as zero', async () => {
  const h = harness({ ahead: 'not-a-number' });
  assert.strictEqual((await h.preconditions({ ...CTX, mode: 'merge' })).code, CODES.NO_NEW_COMMITS);
});

test('checks worktree cleanliness in the worktree, not the base checkout', async () => {
  const h = harness({ ahead: '0', dirty: ' M a\n' });
  await h.preconditions({ ...CTX, mode: 'merge' });
  const status = h.calls.find((c) => c.args.startsWith('status'));
  assert.strictEqual(status.cwd, WT);
});

test('reports no new commits when there is no worktree to inspect', async () => {
  const h = harness({ ahead: '0' });
  const res = await h.preconditions({ root: ROOT, branch: BRANCH, worktree: null, mode: 'merge' });
  assert.strictEqual(res.code, CODES.NO_NEW_COMMITS);
});

// ---- conflict → abort ------------------------------------------------------
test('aborts the merge when it conflicts, leaving the base checkout clean', async () => {
  const err = new Error('merge failed');
  err.stderr = 'CONFLICT (content): Merge conflict in src/a.js\n';
  const h = harness({ mergeThrows: err });
  const res = await h.mergeBranch({ root: ROOT, branch: BRANCH });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.code, CODES.MERGE_FAILED);
  const abort = h.calls.find((c) => c.args === 'merge --abort');
  assert.ok(abort, 'merge --abort ran');
  assert.strictEqual(abort.cwd, ROOT, 'abort targets the base checkout');
});

test('surfaces git stderr in the conflict message', async () => {
  const err = new Error('exit 1');
  err.stderr = 'CONFLICT (content): Merge conflict in src/a.js';
  const h = harness({ mergeThrows: err });
  const res = await h.mergeBranch({ root: ROOT, branch: BRANCH });
  assert.ok(res.error.includes('中断しました'), 'the message says the merge was aborted');
  assert.ok(res.error.includes('CONFLICT'), 'git stderr is included for diagnosis');
});

test('falls back to the error message when git provides no stderr', async () => {
  const h = harness({ mergeThrows: new Error('spawn ENOENT') });
  const res = await h.mergeBranch({ root: ROOT, branch: BRANCH });
  assert.ok(res.error.includes('spawn ENOENT'));
});

test('a failing abort still returns the merge failure rather than throwing', async () => {
  const err = new Error('merge failed');
  err.stderr = 'CONFLICT';
  const h = harness({ mergeThrows: err, abortThrows: true });
  const res = await h.mergeBranch({ root: ROOT, branch: BRANCH });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.code, CODES.MERGE_FAILED);
});

// ---- codes -----------------------------------------------------------------
test('all rejection codes are distinct', () => {
  const values = Object.values(CODES);
  assert.strictEqual(new Set(values).size, values.length);
});

test('every rejection carries both a code and a message', async () => {
  const cases = [
    [{ base: 'HEAD' }, 'merge'],
    [{ base: BRANCH }, 'merge'],
    [{ origin: '' }, 'pr'],
    [{ ahead: '0', dirty: ' M a' }, 'merge'],
    [{ ahead: '0' }, 'merge'],
  ];
  for (const [over, mode] of cases) {
    const res = await harness(over).preconditions({ ...CTX, mode });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(typeof res.code, 'string');
    assert.ok(res.error && res.error.length > 0, `message present for ${res.code}`);
  }
});
