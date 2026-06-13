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
  diffMeta.textContent = t('diff.loading');
  diffBody.innerHTML = '';
  const res = await window.deck.gitDiff(s.gitCwd, s.baseSha);
  if (!res || !res.ok) {
    diffMeta.textContent = res ? res.error : t('diff.failed');
    return;
  }
  const stat = (res.stat || '').trim();
  diffMeta.textContent = stat || t('diff.noChanges');
  paintDiff(res.diff, res.untracked);
}
function paintDiff(diff, untracked) {
  // escaping + assembly live in lib/diff.js (segmentsToHtml) so CI covers the XSS path
  const segs = window.GitDiff.diffToSegments(diff, untracked);
  const html = window.GitDiff.segmentsToHtml(segs, window.Syntax);
  diffBody.innerHTML = html || '<span class="dl">(no changes)</span>';
  renderFileNav(window.GitDiff.fileIndex(segs));
}

// ---- per-file navigation (chips + prev/next + scroll-spy) -------------------
let diffFiles = [];   // [{path, idx}] — idx doubles as the #diff-body child index
let diffFileIdx = -1;
function renderFileNav(files) {
  diffFiles = files;
  diffFileIdx = files.length ? 0 : -1;
  diffFileList.innerHTML = '';
  diffFilesBar.hidden = files.length < 2; // single-file diffs need no nav
  files.forEach((f, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'df-item' + (i === 0 ? ' active' : '');
    b.textContent = f.path;
    b.title = f.path;
    b.addEventListener('click', () => jumpToFile(i));
    diffFileList.appendChild(b);
  });
}
function setActiveFile(i) {
  if (i < 0 || i >= diffFiles.length) return;
  diffFileIdx = i;
  [...diffFileList.children].forEach((el, idx) => el.classList.toggle('active', idx === i));
  const chip = diffFileList.children[i];
  if (chip) chip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function jumpToFile(i) {
  if (i < 0 || i >= diffFiles.length) return;
  // the .dl spans aren't offsetParent-ed to the <pre>, so position via rects
  const target = diffBody.children[diffFiles[i].idx];
  if (target) diffBody.scrollTop += target.getBoundingClientRect().top - diffBody.getBoundingClientRect().top;
  setActiveFile(i);
}
$('#diff-prev-file').addEventListener('click', () => jumpToFile(Math.max(0, diffFileIdx - 1)));
$('#diff-next-file').addEventListener('click', () => jumpToFile(Math.min(diffFiles.length - 1, diffFileIdx + 1)));
let diffSpyRaf = 0;
diffBody.addEventListener('scroll', () => {
  if (diffSpyRaf || diffFiles.length < 2) return;
  diffSpyRaf = requestAnimationFrame(() => {
    diffSpyRaf = 0;
    let cur;
    if (diffBody.scrollTop + diffBody.clientHeight >= diffBody.scrollHeight - 1) {
      cur = diffFiles.length - 1; // at the bottom the last file wins, even if its header can't reach the top
    } else {
      cur = 0;
      const top = diffBody.getBoundingClientRect().top + 4;
      for (let i = 0; i < diffFiles.length; i++) {
        const el = diffBody.children[diffFiles[i].idx];
        if (el && el.getBoundingClientRect().top <= top) cur = i; else break;
      }
    }
    if (cur !== diffFileIdx) setActiveFile(cur);
  });
});

$('#diff-close').addEventListener('click', closeDiff);
$('#diff-backdrop').addEventListener('click', closeDiff);
$('#diff-refresh').addEventListener('click', () => {
  const s = sessions.get(diffSessionId);
  if (s) renderDiff(s);
});
diffMerge.addEventListener('click', async () => {
  const s = sessions.get(diffSessionId);
  if (!s || !s.gitRoot || !s.branch) return;
  if (!confirm(t('diff.confirmMerge', { branch: s.branch }))) return;
  diffMerge.disabled = true;
  diffMeta.textContent = t('diff.merging', { branch: s.branch });
  const res = await window.deck.gitMerge({ root: s.gitRoot, branch: s.branch, worktree: s.worktreePath });
  if (!res || !res.ok) {
    diffMeta.textContent = '⚠ ' + (res ? res.error : t('diff.mergeFailed'));
    diffMerge.disabled = false;
    return;
  }
  diffMeta.textContent = t('diff.merged', { ahead: res.ahead, branch: res.branch, target: res.target });
  refreshReposGit(); // base branch advanced → refresh sidebar git stats
});
diffPr.addEventListener('click', async () => {
  const s = sessions.get(diffSessionId);
  if (!s || !s.gitRoot || !s.branch) return;
  if (!confirm(t('diff.confirmPr', { branch: s.branch }))) return;
  diffPr.disabled = diffMerge.disabled = true;
  diffMeta.textContent = t('diff.creatingPr', { branch: s.branch });
  const res = await window.deck.gitPr({ root: s.gitRoot, branch: s.branch, worktree: s.worktreePath });
  diffPr.disabled = diffMerge.disabled = false;
  if (!res || !res.ok) { diffMeta.textContent = '⚠ ' + (res ? res.error : t('diff.prFailed')); return; }
  diffMeta.textContent = res.url ? t('diff.prCreated', { url: res.url }) : t('diff.prCreatedNoUrl');
  if (res.url) window.deck.openExternal(res.url); // open the PR in the browser
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !diffOverlay.hidden) closeDiff(); });
