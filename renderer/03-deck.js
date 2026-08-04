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

// Chromium's default drop behaviour is to navigate to the dropped file — which
// unloads the deck and takes every live terminal with it. Dropping a folder on
// the window while reaching for "add repository" is an easy way to hit that, so
// anything that is not our own pane drag gets swallowed here. Registered in the
// capture phase so it also covers targets whose own handlers bail out early.
// (main.js denies will-navigate too; this stops the page from ever getting there.)
for (const type of ['dragover', 'drop']) {
  document.addEventListener(type, (e) => {
    if (dragPaneId != null) return; // internal reorder — the #grid handlers own it
    e.preventDefault();
    if (type === 'dragover') { try { e.dataTransfer.dropEffect = 'none'; } catch (_) {} }
  }, true);
}

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
      profileId: c.profileId || '',
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

// ---- sidebar width (dragged divider, persisted) -----------------------------
// A fixed sidebar truncated exactly the part that identifies a repository — its
// name — so the width is the user's to set. Bounds live in lib/sidebar.js: too
// narrow and the rows stop being readable, too wide and the stage can no longer
// hold the two terminal columns `fit` promises.
const Sidebar = window.Sidebar;
const sidebarResizeEl = $('#sidebar-resize');
let sidebarWidth = Sidebar.DEFAULT;

function applySidebarWidth(px, persist) {
  sidebarWidth = Sidebar.clampWidth(px);
  document.documentElement.style.setProperty('--sidebar-w', sidebarWidth + 'px');
  sidebarResizeEl.setAttribute('aria-valuenow', String(sidebarWidth));
  sidebarResizeEl.setAttribute('aria-valuemin', String(Sidebar.MIN));
  sidebarResizeEl.setAttribute('aria-valuemax', String(Sidebar.MAX));
  if (persist) { try { localStorage.setItem(Sidebar.KEY, String(sidebarWidth)); } catch (_) {} }
}
applySidebarWidth(
  Sidebar.normalizeStored((() => { try { return localStorage.getItem(Sidebar.KEY); } catch (_) { return null; } })()),
  false,
);

sidebarResizeEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  // keep the divider under the cursor rather than snapping its left edge there
  const grabOffset = e.clientX - sidebarResizeEl.getBoundingClientRect().left;
  sidebarResizeEl.setPointerCapture(e.pointerId);
  document.body.classList.add('is-resizing');
  const onMove = (ev) => applySidebarWidth(Sidebar.widthFromPointer(ev.clientX, grabOffset), false);
  const onUp = () => {
    sidebarResizeEl.removeEventListener('pointermove', onMove);
    sidebarResizeEl.removeEventListener('pointerup', onUp);
    sidebarResizeEl.removeEventListener('pointercancel', onUp);
    document.body.classList.remove('is-resizing');
    applySidebarWidth(sidebarWidth, true); // persist once, at the end of the drag
  };
  sidebarResizeEl.addEventListener('pointermove', onMove);
  sidebarResizeEl.addEventListener('pointerup', onUp);
  sidebarResizeEl.addEventListener('pointercancel', onUp);
});
// a divider that only a mouse can move is not a divider for everyone
sidebarResizeEl.addEventListener('keydown', (e) => {
  const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
  if (!dir) return;
  e.preventDefault();
  applySidebarWidth(Sidebar.stepWidth(sidebarWidth, dir, e.shiftKey), true);
});
sidebarResizeEl.addEventListener('dblclick', () => applySidebarWidth(Sidebar.DEFAULT, true));
