'use strict';

/* Worktree identity revalidation — the guard that stands between renderer-supplied
 * (therefore untrusted) worktree metadata and destructive Git operations.
 *
 * This is main-process-only code, so it is plain CommonJS rather than the UMD
 * wrapper the renderer-shared lib/ modules use. Every filesystem/Git touch is
 * injected, which is the whole point of the split: the twelve rejection paths
 * below are the security-critical part and each one is unit-testable without a
 * real repository, while the injected helpers stay in main.js where they belong.
 *
 * Each rejection carries a stable `code` alongside the human-readable `error`.
 * Assert on codes, never on the Japanese strings — the strings move to lib/i18n.js
 * later and the codes are what survives that.
 */

const path = require('path');

/** Rejection reasons, in the order the checks run. */
const CODES = {
  PATH_MISMATCH: 'worktree.pathMismatch',
  REPO_MISSING: 'worktree.repoMissing',
  ROOT_MISMATCH: 'worktree.rootMismatch',
  DIFFERENT_REPO: 'worktree.differentRepo',
  BRANCH_MISMATCH: 'worktree.branchMismatch',
  BASE_BRANCH_MISMATCH: 'worktree.baseBranchMismatch',
  NOT_PRIMARY: 'worktree.notPrimary',
  REGISTRY_MISMATCH: 'worktree.registryMismatch',
  OUTSIDE_MANAGED: 'worktree.outsideManaged',
  HEAD_REF_MISMATCH: 'worktree.headRefMismatch',
  BASE_COMMIT_MISSING: 'worktree.baseCommitMissing',
  MERGE_BASE_CHANGED: 'worktree.mergeBaseChanged',
};

/** Japanese copy kept verbatim from the pre-extraction implementation so the
 *  renderer surface does not change in this refactor. */
const MESSAGES = {
  [CODES.PATH_MISMATCH]: 'worktree の保存パスが現在の作業ツリーと一致しません。',
  [CODES.REPO_MISSING]: '保存された repository / worktree が見つかりません。',
  [CODES.ROOT_MISMATCH]: '保存された repository / worktree の root が一致しません。',
  [CODES.DIFFERENT_REPO]: '保存された worktree は別の repository に属しています。',
  [CODES.BRANCH_MISMATCH]: 'worktree の現在 branch が保存時と一致しません。',
  [CODES.BASE_BRANCH_MISMATCH]: 'base checkout の現在 branch が保存時と一致しません。',
  [CODES.NOT_PRIMARY]: '保存された base は primary worktree ではありません。',
  [CODES.REGISTRY_MISMATCH]: 'Git worktree registry と保存情報が一致しません。',
  [CODES.OUTSIDE_MANAGED]: 'worktree は Agent Deck の管理ディレクトリ外です。',
  [CODES.HEAD_REF_MISMATCH]: 'worktree HEAD と branch ref が一致しません。',
  [CODES.BASE_COMMIT_MISSING]: '保存された diff base commit が見つかりません。',
  [CODES.MERGE_BASE_CHANGED]: 'worktree の merge-base が保存時から変わっています。',
};

/** Managed-worktree directory name — worktrees outside it are never accepted. */
const MANAGED_DIR = '.agentdeck-worktrees';

function reject(code) {
  return { ok: false, code, error: MESSAGES[code] };
}

/**
 * Build the validator around a set of injected Git/filesystem helpers.
 *
 * @param {object} deps
 * @param {(dir: string) => string} deps.canonicalPath        realpath + normalise; '' when absent
 * @param {(a: string, b: string) => boolean} deps.samePath   platform-correct path equality
 * @param {(dir: string) => Promise<boolean>} deps.isRepo
 * @param {(dir: string) => Promise<string>} deps.repoRoot
 * @param {(dir: string) => Promise<string>} deps.currentBranch
 * @param {(dir: string) => Promise<string>} deps.commonGitDir
 * @param {(dir: string) => Promise<string>} deps.headSha
 * @param {(args: string[], cwd: string) => Promise<string>} deps.git
 * @param {(text: string) => Array<object>} deps.parseWorktreeList
 * @param {(dir: string, sha: string) => Promise<boolean>} deps.commitExists
 * @param {(sha: string) => boolean} deps.isFullCommitHash
 */
function createValidateWorktreeIdentity(deps) {
  const {
    canonicalPath, samePath, isRepo, repoRoot, currentBranch, commonGitDir,
    headSha, git, parseWorktreeList, commitExists, isFullCommitHash,
  } = deps;

  /** Re-establish the identity of a saved worktree using live Git state. Called
   *  on restore AND immediately before merge/PR, so stale or renderer-forged
   *  metadata can never select a different repository or branch for a
   *  destructive action. */
  return async function validateWorktreeIdentity({ root, branch, baseBranch, worktree, baseSha, expectedCwd } = {}) {
    const rootReal = canonicalPath(root);
    const worktreeReal = canonicalPath(worktree);
    const cwdReal = expectedCwd ? canonicalPath(expectedCwd) : worktreeReal;
    if (!rootReal || !worktreeReal || !cwdReal || samePath(rootReal, worktreeReal) || !samePath(cwdReal, worktreeReal)) {
      return reject(CODES.PATH_MISMATCH);
    }
    if (!(await isRepo(rootReal)) || !(await isRepo(worktreeReal))) {
      return reject(CODES.REPO_MISSING);
    }
    const rootTop = canonicalPath(await repoRoot(rootReal));
    const worktreeTop = canonicalPath(await repoRoot(worktreeReal));
    if (!samePath(rootTop, rootReal) || !samePath(worktreeTop, worktreeReal)) {
      return reject(CODES.ROOT_MISMATCH);
    }
    if (!samePath(await commonGitDir(rootReal), await commonGitDir(worktreeReal))) {
      return reject(CODES.DIFFERENT_REPO);
    }
    const liveBranch = await currentBranch(worktreeReal);
    if (!branch || liveBranch !== branch) {
      return reject(CODES.BRANCH_MISMATCH);
    }
    const liveBaseBranch = await currentBranch(rootReal);
    if (!baseBranch || liveBaseBranch !== baseBranch || liveBaseBranch === 'HEAD') {
      return reject(CODES.BASE_BRANCH_MISMATCH);
    }
    const listed = parseWorktreeList(await git(['worktree', 'list', '--porcelain'], rootReal));
    const primary = listed.find((w) => !w.bare);
    if (!primary || !samePath(canonicalPath(primary.path), rootReal)) {
      return reject(CODES.NOT_PRIMARY);
    }
    const liveEntry = listed.find((w) => samePath(canonicalPath(w.path), worktreeReal));
    if (!liveEntry || liveEntry.detached || liveEntry.branch !== liveBranch) {
      return reject(CODES.REGISTRY_MISMATCH);
    }
    const managedBase = canonicalPath(path.join(path.dirname(rootReal), MANAGED_DIR));
    const relative = managedBase ? path.relative(managedBase, worktreeReal) : '..';
    if (!managedBase || !relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      return reject(CODES.OUTSIDE_MANAGED);
    }
    const worktreeHead = await headSha(worktreeReal);
    const branchHead = (await git(['rev-parse', `refs/heads/${liveBranch}`], rootReal)).trim();
    if (worktreeHead !== branchHead) {
      return reject(CODES.HEAD_REF_MISMATCH);
    }
    // A worktree context without its exact launch base is not authoritative: using
    // HEAD as a fallback would hide committed changes while still enabling merge.
    if (!isFullCommitHash(baseSha) || !(await commitExists(rootReal, baseSha))) {
      return reject(CODES.BASE_COMMIT_MISSING);
    }
    const bases = (await git(['merge-base', '--all', 'HEAD', `refs/heads/${liveBranch}`], rootReal))
      .split('\n').map((s) => s.trim()).filter(Boolean);
    if (bases.length !== 1 || bases[0] !== baseSha) {
      return reject(CODES.MERGE_BASE_CHANGED);
    }
    return {
      ok: true, root: rootReal, worktree: worktreeReal, branch: liveBranch,
      baseBranch: liveBaseBranch, baseSha,
    };
  };
}

module.exports = { CODES, MESSAGES, MANAGED_DIR, createValidateWorktreeIdentity };
