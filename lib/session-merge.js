'use strict';

/* Preconditions and conflict handling for the two destructive session actions:
 * local merge and PR creation. Extracted from main.js for the same reason as
 * lib/worktree-identity.js — these are the checks that decide whether we touch
 * the user's base checkout, and they deserve tests that do not need a real
 * repository. Main-process-only, so plain CommonJS.
 *
 * Identity revalidation happens BEFORE any of this (see lib/worktree-identity.js);
 * everything here assumes an already-validated {root, branch, worktree}.
 *
 * Rejections carry a stable `code` plus the verbatim Japanese `error` the
 * renderer shows today. Assert on codes.
 */

const CODES = {
  DETACHED_BASE: 'session.detachedBase',
  SAME_BRANCH: 'session.sameBranch',
  NO_ORIGIN: 'session.noOrigin',
  DIRTY_WORKTREE: 'session.dirtyWorktree',
  NO_NEW_COMMITS: 'session.noNewCommits',
  MERGE_FAILED: 'session.mergeFailed',
};

/** Per-action copy. `merge` and `pr` share the check sequence but not the wording. */
const COPY = {
  merge: {
    [CODES.DETACHED_BASE]: () => 'ベースが detached HEAD のため merge 先ブランチを特定できません。',
    [CODES.SAME_BRANCH]: (branch) => `ベースと同じブランチ (${branch}) には merge できません。`,
    [CODES.DIRTY_WORKTREE]: () => 'worktree に未コミットの変更があります。セッション内で commit してから merge してください。',
    [CODES.NO_NEW_COMMITS]: () => '取り込む新しいコミットがありません。',
  },
  pr: {
    [CODES.DETACHED_BASE]: () => 'ベースが detached HEAD のため PR の base を特定できません。',
    [CODES.SAME_BRANCH]: (branch) => `ベースと同じブランチ (${branch}) では PR を作成できません。`,
    [CODES.NO_ORIGIN]: () => 'リモート（origin）が設定されていません。',
    [CODES.DIRTY_WORKTREE]: () => 'worktree に未コミットの変更があります。commit してから PR を作成してください。',
    [CODES.NO_NEW_COMMITS]: () => '取り込む新しいコミットがありません。',
  },
};

function reject(mode, code, arg) {
  return { ok: false, code, error: COPY[mode][code](arg) };
}

/**
 * @param {object} deps
 * @param {(args: string[], cwd: string) => Promise<string>} deps.git        throws on non-zero exit
 * @param {(args: string[], cwd: string) => Promise<string>} deps.safeGit    '' on failure
 * @param {(dir: string) => Promise<string>} deps.currentBranch
 */
function createSessionMerge(deps) {
  const { git, safeGit, currentBranch } = deps;

  /** Shared gate for merge and PR. Returns the resolved base branch and how many
   *  commits the session is ahead by, or the first failing precondition.
   *  `mode` selects the wording; for 'pr' an `origin` remote is also required. */
  async function preconditions({ root, branch, worktree, mode }) {
    const target = await currentBranch(root);
    // `git rev-parse --abbrev-ref HEAD` prints the literal "HEAD" when detached (no error),
    // so guard on that too — git forbids a real branch named "HEAD", making this unambiguous.
    if (!target || target === 'HEAD') return reject(mode, CODES.DETACHED_BASE);
    if (target === branch) return reject(mode, CODES.SAME_BRANCH, branch);
    if (mode === 'pr' && !(await safeGit(['remote', 'get-url', 'origin'], root)).trim()) {
      return reject(mode, CODES.NO_ORIGIN);
    }
    // Only committed history moves; tell apart "no commits yet" from "uncommitted work left behind".
    const ahead = parseInt((await git(['rev-list', '--count', `${target}..${branch}`], root)).trim(), 10) || 0;
    if (ahead === 0) {
      const dirty = worktree ? (await safeGit(['status', '--porcelain'], worktree)).trim() : '';
      return reject(mode, dirty ? CODES.DIRTY_WORKTREE : CODES.NO_NEW_COMMITS);
    }
    return { ok: true, target, ahead };
  }

  /** `git merge --no-ff` with a guaranteed abort on conflict, so a failed merge
   *  never leaves the base checkout in a half-merged state. */
  async function mergeBranch({ root, branch }) {
    try {
      const out = await git(['merge', '--no-ff', '-m', `Merge agentdeck session: ${branch}`, branch], root);
      return { ok: true, summary: (out || '').trim() };
    } catch (err) {
      try { await git(['merge', '--abort'], root); } catch (_) {} // best-effort: leave base clean
      const msg = (err && (err.stderr || err.message)) || String(err);
      return { ok: false, code: CODES.MERGE_FAILED, error: 'merge 失敗（中断しました）: ' + String(msg).trim() };
    }
  }

  return { preconditions, mergeBranch };
}

module.exports = { CODES, createSessionMerge };
