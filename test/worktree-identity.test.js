'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { CODES, createValidateWorktreeIdentity } = require('../lib/worktree-identity');

/* The guard that protects merge / PR / restore from renderer-forged metadata.
 * Every Git touch is injected, so each of the twelve rejection paths is pinned
 * here without a real repository — which is what makes this runnable on the
 * dependency-free 3-OS unit job. Paths are built with path.join so the
 * containment check exercises the host separator (Windows included). */

const ABS = process.platform === 'win32' ? 'C:\\ws' : path.sep + 'ws';
const ROOT = path.join(ABS, 'app');
const MANAGED = path.join(ABS, '.agentdeck-worktrees');
const WT = path.join(MANAGED, 'app--agentdeck-x');
const OTHER_WT = path.join(ABS, 'elsewhere', 'app--agentdeck-x');
const GIT_DIR = path.join(ROOT, '.git');
const BRANCH = 'agentdeck/x';
const BASE_BRANCH = 'main';
const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);

/** A world where every check passes; each test overrides one slice of it. */
function makeWorld(over = {}) {
  return {
    // canonicalPath: '' means "does not resolve" (missing path)
    missing: [],
    repos: [ROOT, WT],
    roots: { [ROOT]: ROOT, [WT]: WT },
    commonDirs: { [ROOT]: GIT_DIR, [WT]: GIT_DIR },
    branches: { [ROOT]: BASE_BRANCH, [WT]: BRANCH },
    worktreeList: [
      { path: ROOT, branch: BASE_BRANCH, bare: false, detached: false },
      { path: WT, branch: BRANCH, bare: false, detached: false },
    ],
    heads: { [WT]: HEAD_SHA },
    refs: { [`refs/heads/${BRANCH}`]: HEAD_SHA },
    mergeBases: [BASE_SHA],
    existingCommits: [BASE_SHA],
    ...over,
  };
}

function validatorFor(world) {
  const key = (p) => (process.platform === 'win32' ? String(p || '').toLowerCase() : String(p || ''));
  return createValidateWorktreeIdentity({
    canonicalPath: (p) => (!p || world.missing.includes(p) ? '' : String(p)),
    samePath: (a, b) => !!a && !!b && key(a) === key(b),
    isRepo: async (dir) => world.repos.includes(dir),
    repoRoot: async (dir) => world.roots[dir] || '',
    currentBranch: async (dir) => world.branches[dir] || '',
    commonGitDir: async (dir) => world.commonDirs[dir] || '',
    headSha: async (dir) => world.heads[dir] || '',
    git: async (args) => {
      if (args[0] === 'worktree') return 'PORCELAIN';
      if (args[0] === 'rev-parse') return (world.refs[args[1]] || '') + '\n';
      if (args[0] === 'merge-base') return world.mergeBases.join('\n') + '\n';
      throw new Error('unexpected git call: ' + args.join(' '));
    },
    parseWorktreeList: () => world.worktreeList,
    commitExists: async (_dir, sha) => world.existingCommits.includes(sha),
    isFullCommitHash: (sha) => typeof sha === 'string' && /^[0-9a-f]{40}$/i.test(sha),
  });
}

const CONTEXT = {
  root: ROOT, worktree: WT, branch: BRANCH, baseBranch: BASE_BRANCH,
  baseSha: BASE_SHA, expectedCwd: WT,
};

/** Run the validator against a world + optional context override. */
const run = (worldOver, ctxOver) =>
  validatorFor(makeWorld(worldOver))({ ...CONTEXT, ...ctxOver });

test('accepts a worktree whose live Git state matches the saved metadata', async () => {
  const res = await run();
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.root, ROOT);
  assert.strictEqual(res.worktree, WT);
  assert.strictEqual(res.branch, BRANCH);
  assert.strictEqual(res.baseBranch, BASE_BRANCH);
  assert.strictEqual(res.baseSha, BASE_SHA);
});

// ---- 1. path mismatch ------------------------------------------------------
test('rejects when the saved root does not resolve', async () => {
  const res = await run({ missing: [ROOT] });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.code, CODES.PATH_MISMATCH);
});

test('rejects when the saved worktree does not resolve', async () => {
  assert.strictEqual((await run({ missing: [WT] })).code, CODES.PATH_MISMATCH);
});

test('rejects when root and worktree are the same directory', async () => {
  assert.strictEqual((await run({}, { worktree: ROOT, expectedCwd: ROOT })).code, CODES.PATH_MISMATCH);
});

test('rejects when the live cwd is not the saved worktree', async () => {
  assert.strictEqual((await run({}, { expectedCwd: ROOT })).code, CODES.PATH_MISMATCH);
});

test('falls back to the worktree path when no expectedCwd is supplied', async () => {
  // merge/PR call the validator with the stored context and no expectedCwd
  const res = await run({}, { expectedCwd: undefined });
  assert.strictEqual(res.ok, true);
});

// ---- 2. repo missing -------------------------------------------------------
test('rejects when the saved root is no longer a repository', async () => {
  assert.strictEqual((await run({ repos: [WT] })).code, CODES.REPO_MISSING);
});

test('rejects when the saved worktree is no longer a repository', async () => {
  assert.strictEqual((await run({ repos: [ROOT] })).code, CODES.REPO_MISSING);
});

// ---- 3. root mismatch ------------------------------------------------------
test('rejects when the saved root is a subdirectory, not the repo top level', async () => {
  const res = await run({ roots: { [ROOT]: path.join(ABS, 'other'), [WT]: WT } });
  assert.strictEqual(res.code, CODES.ROOT_MISMATCH);
});

test('rejects when the saved worktree is a subdirectory of its worktree top level', async () => {
  const res = await run({ roots: { [ROOT]: ROOT, [WT]: path.join(ABS, 'other') } });
  assert.strictEqual(res.code, CODES.ROOT_MISMATCH);
});

// ---- 4. different repository ----------------------------------------------
test('rejects a worktree belonging to a different repository', async () => {
  const res = await run({ commonDirs: { [ROOT]: GIT_DIR, [WT]: path.join(ABS, 'other', '.git') } });
  assert.strictEqual(res.code, CODES.DIFFERENT_REPO);
});

// ---- 5. branch mismatch ----------------------------------------------------
test('rejects when the worktree branch moved since the deck was saved', async () => {
  const res = await run({ branches: { [ROOT]: BASE_BRANCH, [WT]: 'agentdeck/other' } });
  assert.strictEqual(res.code, CODES.BRANCH_MISMATCH);
});

test('rejects when the saved branch is empty', async () => {
  assert.strictEqual((await run({}, { branch: '' })).code, CODES.BRANCH_MISMATCH);
});

// ---- 6. base branch mismatch ----------------------------------------------
test('rejects when the base checkout switched branches', async () => {
  const res = await run({ branches: { [ROOT]: 'release', [WT]: BRANCH } });
  assert.strictEqual(res.code, CODES.BASE_BRANCH_MISMATCH);
});

test('rejects when the base checkout is on a detached HEAD', async () => {
  const res = await run(
    { branches: { [ROOT]: 'HEAD', [WT]: BRANCH } },
    { baseBranch: 'HEAD' },
  );
  assert.strictEqual(res.code, CODES.BASE_BRANCH_MISMATCH);
});

test('rejects when the saved base branch is empty', async () => {
  assert.strictEqual((await run({}, { baseBranch: '' })).code, CODES.BASE_BRANCH_MISMATCH);
});

// ---- 7. base is not the primary worktree ----------------------------------
test('rejects when the saved base is not the primary worktree', async () => {
  const res = await run({
    worktreeList: [
      { path: path.join(ABS, 'primary'), branch: BASE_BRANCH, bare: false, detached: false },
      { path: WT, branch: BRANCH, bare: false, detached: false },
    ],
  });
  assert.strictEqual(res.code, CODES.NOT_PRIMARY);
});

test('rejects when the registry lists only a bare repository', async () => {
  const res = await run({
    worktreeList: [{ path: ROOT, branch: '', bare: true, detached: false }],
  });
  assert.strictEqual(res.code, CODES.NOT_PRIMARY);
});

// ---- 8. registry mismatch --------------------------------------------------
test('rejects when the worktree is absent from the Git registry', async () => {
  const res = await run({
    worktreeList: [{ path: ROOT, branch: BASE_BRANCH, bare: false, detached: false }],
  });
  assert.strictEqual(res.code, CODES.REGISTRY_MISMATCH);
});

test('rejects when the registry reports the worktree as detached', async () => {
  const res = await run({
    worktreeList: [
      { path: ROOT, branch: BASE_BRANCH, bare: false, detached: false },
      { path: WT, branch: BRANCH, bare: false, detached: true },
    ],
  });
  assert.strictEqual(res.code, CODES.REGISTRY_MISMATCH);
});

test('rejects when the registry branch disagrees with the live branch', async () => {
  const res = await run({
    worktreeList: [
      { path: ROOT, branch: BASE_BRANCH, bare: false, detached: false },
      { path: WT, branch: 'agentdeck/stale', bare: false, detached: false },
    ],
  });
  assert.strictEqual(res.code, CODES.REGISTRY_MISMATCH);
});

// ---- 9. outside the managed directory -------------------------------------
test('rejects a worktree outside .agentdeck-worktrees', async () => {
  const res = await run({
    repos: [ROOT, OTHER_WT],
    roots: { [ROOT]: ROOT, [OTHER_WT]: OTHER_WT },
    commonDirs: { [ROOT]: GIT_DIR, [OTHER_WT]: GIT_DIR },
    branches: { [ROOT]: BASE_BRANCH, [OTHER_WT]: BRANCH },
    worktreeList: [
      { path: ROOT, branch: BASE_BRANCH, bare: false, detached: false },
      { path: OTHER_WT, branch: BRANCH, bare: false, detached: false },
    ],
    heads: { [OTHER_WT]: HEAD_SHA },
  }, { worktree: OTHER_WT, expectedCwd: OTHER_WT });
  assert.strictEqual(res.code, CODES.OUTSIDE_MANAGED);
});

test('rejects the managed directory itself (empty relative path)', async () => {
  const res = await run({
    repos: [ROOT, MANAGED],
    roots: { [ROOT]: ROOT, [MANAGED]: MANAGED },
    commonDirs: { [ROOT]: GIT_DIR, [MANAGED]: GIT_DIR },
    branches: { [ROOT]: BASE_BRANCH, [MANAGED]: BRANCH },
    worktreeList: [
      { path: ROOT, branch: BASE_BRANCH, bare: false, detached: false },
      { path: MANAGED, branch: BRANCH, bare: false, detached: false },
    ],
    heads: { [MANAGED]: HEAD_SHA },
  }, { worktree: MANAGED, expectedCwd: MANAGED });
  assert.strictEqual(res.code, CODES.OUTSIDE_MANAGED);
});

// ---- 10. HEAD / branch ref divergence -------------------------------------
test('rejects when the worktree HEAD has drifted from the branch ref', async () => {
  const res = await run({ heads: { [WT]: 'c'.repeat(40) } });
  assert.strictEqual(res.code, CODES.HEAD_REF_MISMATCH);
});

// ---- 11. base commit missing ----------------------------------------------
test('rejects a forged (non-hash) base sha without touching Git', async () => {
  assert.strictEqual((await run({}, { baseSha: 'not-a-sha' })).code, CODES.BASE_COMMIT_MISSING);
});

test('rejects a base sha that no longer exists in the repository', async () => {
  assert.strictEqual((await run({ existingCommits: [] })).code, CODES.BASE_COMMIT_MISSING);
});

// ---- 12. merge-base changed -----------------------------------------------
test('rejects when the merge-base moved away from the saved base', async () => {
  const res = await run({ mergeBases: ['d'.repeat(40)] });
  assert.strictEqual(res.code, CODES.MERGE_BASE_CHANGED);
});

test('rejects an ambiguous (multiple) merge-base', async () => {
  const res = await run({ mergeBases: [BASE_SHA, 'd'.repeat(40)] });
  assert.strictEqual(res.code, CODES.MERGE_BASE_CHANGED);
});

test('rejects when there is no merge-base at all', async () => {
  assert.strictEqual((await run({ mergeBases: [] })).code, CODES.MERGE_BASE_CHANGED);
});

// ---- guard ordering --------------------------------------------------------
test('every rejection carries both a stable code and a human-readable message', async () => {
  const res = await run({ missing: [ROOT] });
  assert.strictEqual(typeof res.code, 'string');
  assert.ok(res.error && res.error.length > 0, 'error message is present');
  assert.strictEqual(res.ok, false);
});

test('all twelve rejection codes are distinct', () => {
  const values = Object.values(CODES);
  assert.strictEqual(values.length, 12);
  assert.strictEqual(new Set(values).size, 12);
});

test('cheap path checks run before any Git call', async () => {
  let gitCalls = 0;
  const validate = createValidateWorktreeIdentity({
    canonicalPath: () => '',
    samePath: () => false,
    isRepo: async () => { gitCalls++; return true; },
    repoRoot: async () => { gitCalls++; return ''; },
    currentBranch: async () => { gitCalls++; return ''; },
    commonGitDir: async () => { gitCalls++; return ''; },
    headSha: async () => { gitCalls++; return ''; },
    git: async () => { gitCalls++; return ''; },
    parseWorktreeList: () => [],
    commitExists: async () => { gitCalls++; return false; },
    isFullCommitHash: () => false,
  });
  const res = await validate(CONTEXT);
  assert.strictEqual(res.code, CODES.PATH_MISMATCH);
  assert.strictEqual(gitCalls, 0, 'an unresolvable path is rejected without spawning git');
});

test('an empty context object is rejected, not thrown', async () => {
  const res = await validatorFor(makeWorld())({});
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.code, CODES.PATH_MISMATCH);
});

test('a missing context argument is rejected, not thrown', async () => {
  const res = await validatorFor(makeWorld())();
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.code, CODES.PATH_MISMATCH);
});
