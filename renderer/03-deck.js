'use strict';

// ---- grid layout (column count, persisted in localStorage) -----------------
const LAYOUT_KEY = 'agentdeck.layout';
let layoutMode = 'auto';
function applyLayout(mode, persist) {
  layoutMode = Layout.normalizeLayoutMode(mode);
  grid.style.gridTemplateColumns = Layout.gridTemplateFor(layoutMode);
  for (const b of layoutSwitchEl.querySelectorAll('.ls-btn')) b.classList.toggle('active', b.dataset.cols === layoutMode);
  if (persist) { try { localStorage.setItem(LAYOUT_KEY, layoutMode); } catch (_) {} }
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
  return cfgs;
}
function saveWorkspace() {
  try { localStorage.setItem(Workspace.KEY, JSON.stringify(buildWorkspace())); } catch (_) {}
}
function loadWorkspace() {
  try { return Workspace.normalize(JSON.parse(localStorage.getItem(Workspace.KEY) || '[]')); }
  catch (_) { return []; }
}
/** Show the empty-state restore button only when nothing is running and a deck was saved. */
function refreshRestoreButton() {
  const n = sessions.size === 0 ? loadWorkspace().length : 0;
  if (n > 0) { restoreBtnEl.textContent = t('deck.restore', { n }); restoreBtnEl.hidden = false; }
  else { restoreBtnEl.hidden = true; }
}
async function restoreWorkspace() {
  const cfgs = loadWorkspace();
  restoreBtnEl.hidden = true;
  // worktree:false — the saved cwd is already the (existing) worktree dir, so just reopen a shell there
  for (const c of cfgs) {
    await launch({ presetKey: c.presetKey, command: c.command, name: c.name, cwd: c.cwd, worktree: false, branch: '' });
  }
}
restoreBtnEl.addEventListener('click', restoreWorkspace);
