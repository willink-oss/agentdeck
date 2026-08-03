'use strict';

// ---- grid layout (column count, persisted in localStorage) -----------------
const LAYOUT_KEY = 'agentdeck.layout';
let layoutMode = 'auto';
function applyLayout(mode, persist) {
  layoutMode = Layout.normalizeLayoutMode(mode);
  grid.style.gridTemplateColumns = Layout.gridTemplateFor(layoutMode);
  grid.style.gridAutoRows = Layout.gridAutoRowsFor(layoutMode);
  grid.dataset.layout = layoutMode;
  for (const b of layoutSwitchEl.querySelectorAll('.ls-btn')) {
    const active = b.dataset.cols === layoutMode;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  }
  if (persist) {
    try { localStorage.setItem(LAYOUT_KEY, layoutMode); } catch (_) {}
    if (sessions.size) saveWorkspace();
  }
}
layoutSwitchEl.addEventListener('click', (e) => {
  const b = e.target.closest('.ls-btn');
  if (b) applyLayout(b.dataset.cols, true);
});
applyLayout((() => { try { return localStorage.getItem(LAYOUT_KEY); } catch (_) { return null; } })(), false);

// ---- pane drag-to-reorder (HTML5 DnD; drag a pane header onto another) ------
let dragPaneId = null;
grid.addEventListener('dragover', (e) => {
  if (dragPaneId == null) return;
  e.preventDefault();
  try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
});
grid.addEventListener('drop', (e) => {
  if (dragPaneId == null) return;
  e.preventDefault();
  const dragged = sessions.get(dragPaneId);
  const targetPane = e.target.closest ? e.target.closest('.pane') : null;
  if (!dragged || !targetPane || targetPane === dragged.el) return;
  const box = targetPane.getBoundingClientRect();
  const before = (e.clientX - box.left) < box.width / 2; // left half = drop before, else after
  grid.insertBefore(dragged.el, before ? targetPane : targetPane.nextSibling);
  saveWorkspace();
});

// ---- workspace: persist the live deck + re-spawn it on a later start --------
/** Snapshot the current deck (every pane in on-screen order) as launch configs.
 *  Intentionally captures exited panes too: restore rebuilds the prior layout by
 *  re-running each session's command, so an exited-but-kept pane comes back. */
function buildWorkspace() {
  const cfgs = [];
  for (const pane of grid.querySelectorAll('.pane')) {
    const s = sessions.get(pane.dataset.id);
    if (s) cfgs.push(Workspace.toConfig(s));
  }
  return Workspace.createSnapshot(cfgs, layoutMode);
}
function saveWorkspace() {
  try { localStorage.setItem(Workspace.KEY, JSON.stringify(buildWorkspace())); } catch (_) {}
}
function loadWorkspace() {
  try { return Workspace.normalizeSnapshot(JSON.parse(localStorage.getItem(Workspace.KEY) || '[]'), layoutMode); }
  catch (_) { return Workspace.createSnapshot([], layoutMode); }
}
/** Show the empty-state restore button only when nothing is running and a deck was saved. */
function refreshRestoreButton() {
  const n = sessions.size === 0 ? loadWorkspace().sessions.length : 0;
  if (n > 0) {
    const label = t('deck.restore', { n });
    restoreBtnEl.textContent = label;
    restoreBtnEl.setAttribute('aria-label', label);
    restoreBtnEl.hidden = false;
  }
  else { restoreBtnEl.hidden = true; }
}
async function restoreWorkspace() {
  const snapshot = loadWorkspace();
  restoreBtnEl.hidden = true;
  applyLayout(snapshot.layout, true);
  let restored = 0, failed = 0;
  // worktree:false — the saved cwd is already the (existing) worktree dir, so just reopen a shell there
  for (const c of snapshot.sessions) {
    const result = await launch({
      presetKey: c.presetKey, command: c.command, name: c.name, cwd: c.cwd, worktree: false, branch: '',
      restoreMeta: {
        gitCwd: c.cwd, launchCwd: c.launchCwd || c.cwd, repoId: c.repoId || '',
        baseSha: c.baseSha || '', branch: c.branch || '', baseBranch: c.baseBranch || '', gitRoot: c.gitRoot || '',
        worktreePath: c.worktreePath || '',
      },
    });
    if (result && result.ok) restored++; else failed++;
  }
  // launch() saves each successful step; take one final coherent snapshot so a
  // failed pane also remains visible/retryable on the next restart.
  saveWorkspace();
  if (failed) flashRepoMsg(t('deck.restorePartial', { ok: restored, failed: failed }));
}
restoreBtnEl.addEventListener('click', restoreWorkspace);
