'use strict';

// ---- diff drawer -----------------------------------------------------------
async function openDiff(id) {
  const s = sessions.get(id);
  if (!s || !s.gitCwd) return;
  diffSessionId = id;
  clearAttention(s);
  diffName.textContent = s.name;
  diffBranch.textContent = s.branch || '';
  // merge-to-base / PR only make sense for a worktree-isolated session (own branch + root)
  diffMerge.hidden = diffPr.hidden = !(s.gitRoot && s.branch);
  diffMerge.disabled = diffPr.disabled = false;
  diffOverlay.hidden = false;
  await renderDiff(s);
}
function closeDiff() { diffOverlay.hidden = true; diffSessionId = null; }

async function renderDiff(s) {
  diffMeta.textContent = 'loading…';
  diffBody.innerHTML = '';
  const res = await window.deck.gitDiff(s.gitCwd, s.baseSha);
  if (!res || !res.ok) {
    diffMeta.textContent = res ? res.error : 'diff failed';
    return;
  }
  const stat = (res.stat || '').trim();
  diffMeta.textContent = stat || 'no tracked changes vs base';
  paintDiff(res.diff, res.untracked);
}
function paintDiff(diff, untracked) {
  // escaping + assembly live in lib/diff.js (segmentsToHtml) so CI covers the XSS path
  const html = window.GitDiff.segmentsToHtml(window.GitDiff.diffToSegments(diff, untracked));
  diffBody.innerHTML = html || '<span class="dl">(no changes)</span>';
}

$('#diff-close').addEventListener('click', closeDiff);
$('#diff-backdrop').addEventListener('click', closeDiff);
$('#diff-refresh').addEventListener('click', () => {
  const s = sessions.get(diffSessionId);
  if (s) renderDiff(s);
});
diffMerge.addEventListener('click', async () => {
  const s = sessions.get(diffSessionId);
  if (!s || !s.gitRoot || !s.branch) return;
  if (!confirm(`セッションのブランチ「${s.branch}」をベースブランチへ merge します。よろしいですか？`)) return;
  diffMerge.disabled = true;
  diffMeta.textContent = `merging ${s.branch} …`;
  const res = await window.deck.gitMerge({ root: s.gitRoot, branch: s.branch, worktree: s.worktreePath });
  if (!res || !res.ok) {
    diffMeta.textContent = '⚠ ' + (res ? res.error : 'merge failed');
    diffMerge.disabled = false;
    return;
  }
  diffMeta.textContent = `✓ merged ${res.ahead} commit(s): ${res.branch} → ${res.target}`;
  refreshReposGit(); // base branch advanced → refresh sidebar git stats
});
diffPr.addEventListener('click', async () => {
  const s = sessions.get(diffSessionId);
  if (!s || !s.gitRoot || !s.branch) return;
  if (!confirm(`「${s.branch}」を origin に push して PR を作成します。よろしいですか？`)) return;
  diffPr.disabled = diffMerge.disabled = true;
  diffMeta.textContent = `creating PR for ${s.branch} …`;
  const res = await window.deck.gitPr({ root: s.gitRoot, branch: s.branch, worktree: s.worktreePath });
  diffPr.disabled = diffMerge.disabled = false;
  if (!res || !res.ok) { diffMeta.textContent = '⚠ ' + (res ? res.error : 'PR 作成に失敗しました'); return; }
  diffMeta.textContent = res.url ? `✓ PR 作成: ${res.url}` : '✓ PR を作成しました';
  if (res.url) window.deck.openExternal(res.url); // open the PR in the browser
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !diffOverlay.hidden) closeDiff(); });
