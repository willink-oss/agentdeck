'use strict';

/* Presets. Built-ins live in lib/presets.js; user-defined presets are merged
 * in from localStorage (custom list only). `cmd` is auto-typed + run on start. */
const Presets = window.Presets;
let customPresets = loadCustomPresets();
let PRESETS = Presets.merge(customPresets);

function loadCustomPresets() {
  try { return Presets.normalizeCustom(JSON.parse(localStorage.getItem(Presets.KEY) || '[]')); }
  catch (_) { return []; }
}
function saveCustomPresets() {
  try { localStorage.setItem(Presets.KEY, JSON.stringify(customPresets)); } catch (_) {}
}

const TERM_THEME = {
  background: '#0c0d10', foreground: '#e6e8ee', cursor: '#f0883e',
  cursorAccent: '#0c0d10', selectionBackground: '#33384a',
  black: '#1b1e25', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
  blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
  brightBlack: '#5b616d', brightRed: '#e06c75', brightGreen: '#98c379',
  brightYellow: '#ffb454', brightBlue: '#61afef', brightMagenta: '#c678dd',
  brightCyan: '#56b6c2', brightWhite: '#e6e8ee',
};

const ATTENTION_IDLE_MS = 6000; // 出力が止まってこの時間で「入力待ち」とみなす

/** @type {Map<string, object>} */
const sessions = new Map();
const FitAddonCtor = (window.FitAddon && window.FitAddon.FitAddon) || window.FitAddon;

const $ = (s) => document.querySelector(s);
const presetSel = $('#preset');
const commandInput = $('#command');
const nameInput = $('#name');
const cwdInput = $('#cwd');
const wtEnable = $('#wt-enable');
const wtBranch = $('#wt-branch');
const repoHint = $('#repo-hint');
const grid = $('#grid');
const emptyState = $('#empty');
const countEl = $('#count');
const sysInfoEl = $('#sys-info');
const repoListEl = $('#repo-list');
const repoEmptyEl = $('#repo-empty');
const repoMsgEl = $('#repo-msg');
const launchBtn = $('#launch');
const stageFilterEl = $('#stage-filter');
const stageFilterLabel = $('#stage-filter-label');
const stageAllBtn = $('#stage-all');
const layoutSwitchEl = $('#layout-switch');
const restoreBtnEl = $('#restore-deck');
const paletteEl = $('#palette');
const paletteInput = $('#palette-input');
const paletteList = $('#palette-list');
const emptyTitleEl = $('#empty h2');
const emptyDescEl = $('#empty p');
const EMPTY_DEFAULT_TITLE = emptyTitleEl ? emptyTitleEl.textContent : 'No agents running';
const EMPTY_DEFAULT_DESC = emptyDescEl ? emptyDescEl.innerHTML : '';

// diff drawer refs
const diffOverlay = $('#diff-overlay');
const diffName = $('#diff-name');
const diffBranch = $('#diff-branch');
const diffMeta = $('#diff-meta');
const diffBody = $('#diff-body');
const diffMerge = $('#diff-merge');
const diffPr = $('#diff-pr');
let diffSessionId = null;

let seq = 0;
let activeSessionId = null;
let windowFocused = true;

/** Registered repositories (persisted in main). @type {Array<{id,path,name,isRepo,branch}>} */
let repos = [];
let activeRepoId = null;
let homeDir = '';
/** Synthetic, always-pinned "Home" entry so CLIs can run in the home directory
 *  without registering a repo (e.g. operating on the whole computer). Not persisted. */
let homeRepo = null;

window.addEventListener('focus', () => { windowFocused = true; });
window.addEventListener('blur', () => { windowFocused = false; });

// ---- form init -------------------------------------------------------------
function buildPresetOptions() {
  presetSel.innerHTML = '';
  for (const [key, p] of Object.entries(PRESETS)) {
    const opt = document.createElement('option');
    opt.value = key; opt.textContent = p.label;
    presetSel.appendChild(opt);
  }
  presetSel.value = 'claude';
  commandInput.value = PRESETS.claude.cmd;
}
function buildQuickChips() {
  const host = $('#quick-chips');
  host.innerHTML = '';
  for (const key of Presets.chipKeys(customPresets)) {
    const chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'chip'; chip.textContent = PRESETS[key].label;
    chip.addEventListener('click', () => launch({ presetKey: key, command: PRESETS[key].cmd }));
    host.appendChild(chip);
  }
}
/** Re-merge + redraw the select and chips after a custom-preset change, keeping
 *  the user's current selection (and typed command) when it still exists. */
function rebuildPresetUI() {
  PRESETS = Presets.merge(customPresets);
  const prevKey = presetSel.value;
  const prevCmd = commandInput.value;
  buildPresetOptions(); // resets the selection to the claude default
  if (PRESETS[prevKey]) { presetSel.value = prevKey; commandInput.value = prevCmd; }
  buildQuickChips();
}

presetSel.addEventListener('change', () => { commandInput.value = PRESETS[presetSel.value].cmd; });
wtEnable.addEventListener('change', () => { wtBranch.disabled = !wtEnable.checked; if (wtEnable.checked) wtBranch.focus(); });

$('#browse').addEventListener('click', async () => {
  const dir = await window.deck.openDir();
  if (dir) { cwdInput.value = dir; refreshRepoHint(); }
});
cwdInput.addEventListener('change', refreshRepoHint);

async function refreshRepoHint() {
  const dir = cwdInput.value.trim();
  if (!dir) { repoHint.textContent = ''; return; }
  try {
    const { repo } = await window.deck.isRepo(dir);
    repoHint.textContent = repo ? '✓ git repository' : 'not a git repository';
    repoHint.className = 'field-hint ' + (repo ? 'is-repo' : 'no-repo');
  } catch (_) { repoHint.textContent = ''; }
}

/** Read the launch form into a launch() options object (optional cwd override). */
function currentLaunchOpts(cwdOverride) {
  return {
    presetKey: presetSel.value,
    command: commandInput.value,
    name: nameInput.value.trim(),
    cwd: (cwdOverride != null ? cwdOverride : cwdInput.value.trim()),
    worktree: wtEnable.checked,
    branch: wtBranch.value.trim(),
  };
}
$('#launch-form').addEventListener('submit', (e) => { e.preventDefault(); launch(currentLaunchOpts()); });

// ---- repository panel ------------------------------------------------------
/* Share the path-normalisation logic with main (lib/repos.js, loaded via <script>)
   so repo ids computed here and in the main process can never drift. */
const Repos = window.Repos;
const GitStat = window.GitStat;
const Layout = window.Layout;
const Workspace = window.Workspace;
const Fuzzy = window.Fuzzy;
function normRepoPath(p) { return Repos.normalizePath(p); }
/** Persisted repos plus the pinned synthetic Home entry (Home first, deduped).
 *  Pure list logic lives in lib/repos.js (CI-covered); these just bind state. */
function effectiveRepos() { return Repos.effectiveRepos(repos, homeRepo); }
function findEff(id) { return Repos.findEff(repos, homeRepo, id); }
function repoIdForCwd(dir) {
  const hit = findEff(normRepoPath(dir));
  return hit ? hit.id : null;
}
/** Re-derive every live session's repoId from its launch dir, so sessions snap
 *  into (or out of) a repo group whenever the registry changes. */
function retagSessions() {
  for (const s of sessions.values()) s.repoId = repoIdForCwd(s.launchCwd);
}
function flashRepoMsg(text) {
  if (!repoMsgEl) return;
  repoMsgEl.textContent = text;
  repoMsgEl.hidden = false;
  clearTimeout(flashRepoMsg._t);
  flashRepoMsg._t = setTimeout(() => { repoMsgEl.hidden = true; }, 4500);
}

/** Signature of the git-derived fields, to skip re-renders when nothing changed. */
let reposSig = '';
function computeSig(list) {
  return JSON.stringify((list || []).map((r) => ({ id: r.id, branch: r.branch, stat: r.stat, worktrees: r.worktrees })));
}
function setRepos(list) { repos = list || []; reposSig = computeSig(repos); }

async function loadReposUI() {
  try { const res = await window.deck.reposList(); setRepos((res && res.repos) || []); }
  catch (_) { setRepos([]); }
  retagSessions();
  renderRepos();
}
async function addRepoFlow() {
  const dir = await window.deck.openDir();
  if (!dir) return;
  // The home dir is already pinned as the synthetic Home entry; registering it
  // would persist a duplicate that Home shadows and hides the remove button on.
  if (homeRepo && normRepoPath(dir) === homeRepo.id) {
    flashRepoMsg('ホームディレクトリは常に「Home」として表示されています。'); return;
  }
  const res = await window.deck.reposAdd(dir);
  setRepos((res && res.repos) || []);
  retagSessions();
  if (res && res.ok === false) { flashRepoMsg('リポジトリの保存に失敗しました: ' + (res.error || '')); renderRepos(); return; }
  renderRepos();
  const added = Repos.findRepo(repos, normRepoPath(dir));
  if (added) selectRepo(added.id);
}
async function removeRepoFromList(id) {
  const res = await window.deck.reposRemove(id);
  setRepos((res && res.repos) || []);
  if (activeRepoId === id) activeRepoId = null;
  retagSessions();
  if (res && res.ok === false) flashRepoMsg('リポジトリの保存に失敗しました: ' + (res.error || ''));
  renderRepos();
}
/** Poll/refresh git status (branch + diff stats + worktrees); re-render only on change.
 *  Skipped while the window is blurred — the focus listener refreshes on return. */
async function refreshReposGit() {
  if (!windowFocused) return;
  let res;
  try { res = await window.deck.reposList(); } catch (_) { return; }
  const next = (res && res.repos) || [];
  if (computeSig(next) === reposSig) return;
  setRepos(next);
  retagSessions();
  renderRepos();
}
function updateLaunchLabel() {
  const r = activeRepoId ? findEff(activeRepoId) : null;
  launchBtn.textContent = r ? `▶ ${r.name} で起動` : '▶ Launch agent';
}
function updateActiveHighlight() {
  for (const el of repoListEl.querySelectorAll('.repo-item[data-repo-id]')) {
    el.classList.toggle('active', el.dataset.repoId === activeRepoId);
  }
}
function setEmptyState(filteredRepoName) {
  if (filteredRepoName == null) {
    emptyTitleEl.textContent = EMPTY_DEFAULT_TITLE;
    emptyDescEl.innerHTML = EMPTY_DEFAULT_DESC;
  } else {
    emptyTitleEl.textContent = filteredRepoName;
    emptyDescEl.textContent = 'このリポジトリには起動中のエージェントがありません。▶ Launch で起動できます。';
  }
}
/** Apply the repo focus-filter to the terminal grid, the filter pill, and the empty state. */
function updateStage() {
  let total = 0, visible = 0;
  for (const s of sessions.values()) {
    total++;
    const show = !activeRepoId || s.repoId === activeRepoId;
    s.el.style.display = show ? '' : 'none';
    if (show) visible++;
  }
  const r = activeRepoId ? findEff(activeRepoId) : null;
  if (r && total > 0 && visible < total) {
    stageFilterLabel.textContent = `▦ ${r.name} のみ表示中`;
    stageFilterEl.hidden = false;
  } else {
    stageFilterEl.hidden = true;
  }
  if (total === 0) { setEmptyState(null); emptyState.style.display = 'flex'; }
  else if (visible === 0) { setEmptyState(r ? r.name : null); emptyState.style.display = 'flex'; }
  else { emptyState.style.display = 'none'; }
  refreshRestoreButton();
}
function clearRepoSelection() {
  activeRepoId = null;
  updateActiveHighlight();
  updateLaunchLabel();
  updateStage();
}
function selectRepo(id) {
  activeRepoId = id;
  const r = findEff(id);
  if (r) { cwdInput.value = r.path; refreshRepoHint(); }
  updateActiveHighlight();
  updateLaunchLabel();
  updateStage();
}
/** Set the active session and reflect it as the highlighted (.active) pane. */
function markActive(id) {
  activeSessionId = id;
  for (const el of grid.querySelectorAll('.pane.active')) el.classList.remove('active');
  const s = sessions.get(id);
  if (s) s.el.classList.add('active');
}
function focusSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  try { s.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (_) {}
  try { s.term.focus(); } catch (_) {}
  markActive(id);
  clearAttention(s);
}

// --- rendering: full rebuild (structural) + in-place state refresh ----------
let repoRowEls = new Map();   // session id -> session row element
let repoBadgeEls = new Map(); // group key   -> repo count badge element

function groupKeyForSession(s) {
  return (s.repoId && findEff(s.repoId)) ? s.repoId : '';
}
function sessionDotClass(s) {
  return 'status-dot' + (s.alive ? (s.attention ? ' waiting' : ' live') : '');
}
function sessionRow(id, s) {
  const row = document.createElement('div');
  row.className = 'repo-session' + (s.alive ? '' : ' exited') + (s.attention ? ' attention' : '');
  const dot = document.createElement('span');
  dot.className = sessionDotClass(s);
  const nm = document.createElement('span');
  nm.className = 'repo-session-name';
  nm.textContent = s.name;
  row.appendChild(dot);
  row.appendChild(nm);
  row.addEventListener('click', (e) => { e.stopPropagation(); focusSession(id); });
  repoRowEls.set(id, row);
  return row;
}
function sessionsByRepo() {
  const byRepo = new Map();
  for (const [id, s] of sessions) {
    const key = groupKeyForSession(s);
    if (!byRepo.has(key)) byRepo.set(key, []);
    byRepo.get(key).push([id, s]);
  }
  return byRepo;
}
/** "+X" / "-Y" coloured chip, or null when there are no line changes. */
function statBadge(stat) {
  if (!GitStat.formatStat(stat)) return null;
  const st = document.createElement('span');
  st.className = 'repo-stat';
  if (stat.insertions) {
    const a = document.createElement('span');
    a.className = 'stat-add'; a.textContent = '+' + stat.insertions; st.appendChild(a);
  }
  if (stat.deletions) {
    const d = document.createElement('span');
    d.className = 'stat-del'; d.textContent = '-' + stat.deletions; st.appendChild(d);
  }
  return st;
}
/** A git worktree row (branch + diff stat) under a repo. Informational. */
function worktreeRow(w) {
  const row = document.createElement('div');
  row.className = 'repo-worktree' + (w.isAgentdeck ? ' is-agentdeck' : '');
  const icon = document.createElement('span');
  icon.className = 'wt-icon'; icon.textContent = '⎇';
  const br = document.createElement('span');
  br.className = 'wt-branch';
  br.textContent = w.branch || '(detached)';
  br.title = w.path;
  row.appendChild(icon);
  row.appendChild(br);
  const st = statBadge(w.stat);
  if (st) row.appendChild(st);
  return row;
}
/** Build one group box — a registered repo, or the orphan "Other" group. */
function buildGroup({ key, name, nameDim, path, branch, repoId, stat, worktrees, home, sessList }) {
  const item = document.createElement('div');
  item.className = 'repo-item' + (repoId && repoId === activeRepoId ? ' active' : '') + (home ? ' is-home' : '');
  if (repoId) item.dataset.repoId = repoId;

  const row = document.createElement('div');
  row.className = 'repo-row';
  if (home) {
    const ic = document.createElement('span');
    ic.className = 'repo-home-icon'; ic.textContent = '⌂';
    row.appendChild(ic);
  }
  const nameEl = document.createElement('span');
  nameEl.className = 'repo-name';
  nameEl.textContent = name;
  if (nameDim) nameEl.style.color = 'var(--text-dim)';
  if (path) nameEl.title = path;
  row.appendChild(nameEl);
  if (branch) {
    const b = document.createElement('span');
    b.className = 'repo-branch';
    b.textContent = '⎇ ' + branch;
    b.title = branch;
    row.appendChild(b);
  }
  const st = statBadge(stat);
  if (st) row.appendChild(st);
  if (sessList.length) {
    const c = document.createElement('span');
    c.className = 'repo-count' + (sessList.some(([, s]) => s.attention) ? ' attention' : '');
    c.textContent = String(sessList.length);
    row.appendChild(c);
    repoBadgeEls.set(key, c);
  }
  if (repoId && !home) {
    const rm = document.createElement('button');
    rm.className = 'repo-remove';
    rm.textContent = '×';
    rm.title = 'Remove from list';
    rm.addEventListener('click', (e) => { e.stopPropagation(); removeRepoFromList(repoId); });
    row.appendChild(rm);
  }
  item.appendChild(row);

  if (path) {
    const pathEl = document.createElement('div');
    pathEl.className = 'repo-path';
    pathEl.textContent = path;
    item.appendChild(pathEl);
  }
  if (worktrees && worktrees.length) {
    const wtWrap = document.createElement('div');
    wtWrap.className = 'repo-worktrees';
    for (const w of worktrees) wtWrap.appendChild(worktreeRow(w));
    item.appendChild(wtWrap);
  }
  if (sessList.length) {
    const wrap = document.createElement('div');
    wrap.className = 'repo-sessions';
    for (const [id, s] of sessList) wrap.appendChild(sessionRow(id, s));
    item.appendChild(wrap);
  }
  if (repoId) {
    item.addEventListener('click', () => selectRepo(repoId));
    // double-click = launch the current Agent straight into this repo
    item.addEventListener('dblclick', () => { selectRepo(repoId); launch(currentLaunchOpts(path)); });
  }
  return item;
}
/** Full structural rebuild — use on add/remove/select repo and launch/kill session. */
function renderRepos() {
  repoRowEls = new Map();
  repoBadgeEls = new Map();
  repoListEl.innerHTML = '';
  repoEmptyEl.style.display = repos.length ? 'none' : 'block';
  const byRepo = sessionsByRepo();
  for (const repo of effectiveRepos()) {
    repoListEl.appendChild(buildGroup({
      key: repo.id, name: repo.name, path: repo.path, branch: repo.branch,
      repoId: repo.id, stat: repo.stat, worktrees: repo.worktrees,
      home: !!repo.isHome, sessList: byRepo.get(repo.id) || [],
    }));
  }
  const orphans = byRepo.get('') || [];
  if (orphans.length) {
    repoListEl.appendChild(buildGroup({ key: '', name: 'Other', nameDim: true, sessList: orphans }));
  }
  updateLaunchLabel();
  updateStage();
}
/** In-place update for attention/exit transitions — avoids a full tree rebuild. */
function refreshSessionState(s) {
  if (!s) return;
  const row = repoRowEls.get(s.id);
  if (!row) return; // not currently rendered (e.g. just killed)
  row.className = 'repo-session' + (s.alive ? '' : ' exited') + (s.attention ? ' attention' : '');
  const dot = row.querySelector('.status-dot');
  if (dot) dot.className = sessionDotClass(s);
  const key = groupKeyForSession(s);
  const badge = repoBadgeEls.get(key);
  if (badge) {
    let attn = false;
    for (const o of sessions.values()) {
      if (groupKeyForSession(o) === key && o.attention) { attn = true; break; }
    }
    badge.classList.toggle('attention', attn);
  }
}

$('#repo-add').addEventListener('click', addRepoFlow);
$('#repo-refresh').addEventListener('click', refreshReposGit);
stageAllBtn.addEventListener('click', clearRepoSelection);

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
  if (n > 0) { restoreBtnEl.textContent = `↻ 前回のデッキを復元 (${n})`; restoreBtnEl.hidden = false; }
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

// ---- update notification (main checks the feed; we just surface it) ---------
const updateToast = $('#update-toast');
const updateToastText = $('#update-toast-text');
let updateUrl = '';
function showUpdate(p) {
  updateUrl = p.url || '';
  updateToastText.textContent = `新しいバージョン v${p.latest} が利用できます（現在 v${p.current}）`;
  updateToast.hidden = false;
}
window.deck.onUpdateAvailable(showUpdate);
$('#update-download').addEventListener('click', () => { if (updateUrl) window.deck.openExternal(updateUrl); });
$('#update-dismiss').addEventListener('click', () => { updateToast.hidden = true; });

setInterval(refreshReposGit, 7000);
window.addEventListener('focus', refreshReposGit);

// ---- session creation ------------------------------------------------------
async function launch({ presetKey, command, name, cwd, worktree, branch }) {
  const preset = PRESETS[presetKey] || PRESETS.shell;
  const id = 'sess_' + (++seq) + '_' + Math.random().toString(36).slice(2, 6);
  const displayName = name || `${preset.label} #${seq}`;
  const workdir = cwd || cwdInput.value.trim() || '';
  const wantWorktree = !!worktree;
  const wtName = (branch && branch.trim()) || `agentdeck/${presetKey}-${seq}`;

  emptyState.style.display = 'none';

  const pane = document.createElement('section');
  pane.className = 'pane';
  pane.dataset.id = id;
  const head = document.createElement('div');
  head.className = 'pane-head';
  head.innerHTML =
    '<span class="pane-grip" title="ドラッグで並べ替え">⠿</span>' +
    '<span class="status-dot live"></span>' +
    '<span class="pane-name"></span>' +
    `<span class="pane-badge">${preset.badge}</span>` +
    '<span class="pane-cwd"></span>' +
    '<button class="pane-diff" title="Review git diff">diff</button>' +
    '<button class="pane-kill" title="Kill session">kill</button>';
  const nameEl = head.querySelector('.pane-name');
  nameEl.textContent = displayName;
  nameEl.title = 'ダブルクリックで名前変更';
  nameEl.addEventListener('dblclick', (e) => { e.stopPropagation(); startRename(id, nameEl); });
  head.querySelector('.pane-cwd').textContent = workdir || '~';
  // drag the grip handle (not the whole header) to reorder panes — keeps diff/kill clickable
  const grip = head.querySelector('.pane-grip');
  grip.draggable = true;
  grip.addEventListener('dragstart', (e) => {
    dragPaneId = id; pane.classList.add('dragging');
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); } catch (_) {}
  });
  grip.addEventListener('dragend', () => { dragPaneId = null; pane.classList.remove('dragging'); });

  const termHost = document.createElement('div');
  termHost.className = 'term-host';
  pane.appendChild(head);
  pane.appendChild(termHost);
  grid.appendChild(pane);

  const term = new window.Terminal({
    fontFamily: '"JetBrains Mono","SF Mono","Menlo","Consolas",monospace',
    fontSize: 12, lineHeight: 1.15, cursorBlink: true, scrollback: 5000,
    theme: TERM_THEME, allowProposedApi: true,
  });
  const fit = new FitAddonCtor();
  term.loadAddon(fit);
  term.open(termHost);
  requestAnimationFrame(() => { try { fit.fit(); } catch (_) {} });
  term.onData((d) => window.deck.input(id, d));

  const ro = new ResizeObserver(() => {
    try { fit.fit(); window.deck.resize(id, term.cols, term.rows); } catch (_) {}
  });
  ro.observe(termHost);

  const s = {
    id, term, fit, el: pane, ro, name: displayName,
    alive: true, hasOutput: false, attention: false, lastData: Date.now(),
    gitCwd: null, baseSha: null, branch: null, gitRoot: null, worktreePath: null,
    repoId: repoIdForCwd(workdir), launchCwd: workdir,
    presetKey, command,            // remembered so the deck can be saved + re-spawned
  };
  sessions.set(id, s);
  updateCount();
  renderRepos();

  const setActive = () => { markActive(id); clearAttention(s); };
  pane.addEventListener('mousedown', setActive);
  termHost.addEventListener('focusin', setActive);
  termHost.addEventListener('contextmenu', (e) => { e.preventDefault(); markActive(id); openTermMenu(id, e.clientX, e.clientY); });

  head.querySelector('.pane-kill').addEventListener('click', () => killSession(id));
  const diffBtn = head.querySelector('.pane-diff');
  diffBtn.addEventListener('click', () => openDiff(id));

  const res = await window.deck.spawn({
    id, cwd: workdir, cols: term.cols, rows: term.rows,
    startupCommand: command,
    worktree: { enabled: wantWorktree, branch: wtName },
  });

  if (!res || !res.ok) {
    term.write(`\r\n\x1b[31m[failed: ${res ? res.error : 'unknown'}]\x1b[0m\r\n`);
    setExited(id);
    diffBtn.disabled = true;
    return;
  }

  if (res.git) {
    s.gitCwd = res.git.cwd;
    s.baseSha = res.git.baseSha;
    s.branch = res.git.branch;
    s.gitRoot = res.git.root || null;        // present only for worktree-isolated sessions
    s.worktreePath = res.git.worktree || null;
    if (res.git.worktree) {
      head.querySelector('.pane-cwd').textContent = `⌥ ${res.git.branch}`;
      head.querySelector('.pane-cwd').title = res.git.worktree;
    } else if (res.git.branch) {
      head.querySelector('.pane-cwd').title = res.git.cwd;
    }
  } else {
    diffBtn.disabled = true;
    diffBtn.title = 'not a git repository';
  }
  term.focus();
  markActive(id);
  saveWorkspace(); // remember this session (cwd/git info now resolved) for restore
}

function killSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  window.deck.kill(id);
  try { s.ro.disconnect(); } catch (_) {}
  try { s.term.dispose(); } catch (_) {}
  s.el.remove();
  sessions.delete(id);
  if (activeSessionId === id) activeSessionId = null;
  if (diffSessionId === id) closeDiff();
  updateCount();
  updateWaitingTitle();
  saveWorkspace(); // persist the post-kill deck before the empty-state restore button refreshes
  renderRepos(); // -> updateStage() restores empty state / clears filter pill as needed
}

function setExited(id) {
  const s = sessions.get(id);
  if (!s) return;
  s.alive = false;
  clearAttention(s);
  s.el.classList.add('exited');
  const dot = s.el.querySelector('.status-dot');
  if (dot) { dot.classList.remove('live', 'waiting'); }
  refreshSessionState(s);
}

function updateCount() {
  const n = sessions.size;
  countEl.textContent = `${n} session${n === 1 ? '' : 's'}`;
}

// ---- attention detection ---------------------------------------------------
function setAttention(s, id) {
  s.attention = true;
  s.el.classList.add('attention');
  const dot = s.el.querySelector('.status-dot');
  if (dot) { dot.classList.remove('live'); dot.classList.add('waiting'); }
  updateWaitingTitle();
  refreshSessionState(s);
  if (!windowFocused) notify(s.name);
}
function clearAttention(s) {
  if (!s.attention) return;
  s.attention = false;
  s.el.classList.remove('attention');
  const dot = s.el.querySelector('.status-dot');
  if (dot && s.alive) { dot.classList.remove('waiting'); dot.classList.add('live'); }
  updateWaitingTitle();
  refreshSessionState(s);
}
function updateWaitingTitle() {
  let n = 0;
  for (const s of sessions.values()) if (s.attention) n++;
  document.title = n > 0 ? `(${n}) Agent Deck — needs attention` : 'Agent Deck';
}
function notify(name) {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') {
      new Notification('Agent Deck', { body: `${name} が入力待ちです` });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
  } catch (_) {}
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    const watching = windowFocused && activeSessionId === id;
    if (window.Attention.shouldFlagAttention({ ...s, watching }, now, ATTENTION_IDLE_MS)) {
      setAttention(s, id);
    }
  }
}, 1500);

// ---- PTY routing -----------------------------------------------------------
window.deck.onData(({ id, data }) => {
  const s = sessions.get(id);
  if (!s) return;
  s.term.write(data);
  s.lastData = Date.now();
  s.hasOutput = true;
  if (s.attention) clearAttention(s);
});
window.deck.onExit(({ id, exitCode }) => {
  const s = sessions.get(id);
  if (!s) return;
  s.term.write(`\r\n\x1b[90m[process exited (${exitCode})]\x1b[0m\r\n`);
  setExited(id);
});

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
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const segs = window.GitDiff.diffToSegments(diff, untracked);
  let html = '';
  for (const seg of segs) {
    if (seg.parts) {
      // word-level: wrap changed tokens so they stand out within the +/- line
      let inner = '';
      for (const p of seg.parts) inner += p.changed ? `<span class="dl-word">${esc(p.text)}</span>` : esc(p.text);
      html += `<span class="${seg.cls}">${inner || '&nbsp;'}</span>`;
    } else {
      html += `<span class="${seg.cls}">${esc(seg.text) || '&nbsp;'}</span>`;
    }
  }
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

// ---- keyboard shortcuts: ⌘/Ctrl + 1-9 focus pane / [ ] cycle / Enter launch / W kill ----
function visiblePanes() {
  return [...grid.querySelectorAll('.pane')].filter((p) => p.style.display !== 'none');
}
function cyclePane(dir) {
  const panes = visiblePanes();
  if (!panes.length) return;
  let i = panes.findIndex((p) => p.dataset.id === activeSessionId);
  if (i < 0) i = dir > 0 ? -1 : 0;
  focusSession(panes[(i + dir + panes.length) % panes.length].dataset.id);
}
window.addEventListener('keydown', (e) => {
  // ⌘ only (macOS): Ctrl-combos (Ctrl+W, Ctrl+[, Ctrl+1 …) are terminal/readline keys —
  // hijacking them would break the shell. Windows/Linux builds will need a different binding.
  if (!e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.activeElement && document.activeElement.isContentEditable) return; // editing a name
  if (!paletteEl.hidden) return; // the open palette handles its own keys
  if (!presetOverlay.hidden) return; // modal: keep ⌘W/⌘Enter/⌘K away from the deck behind it
  if (e.key === 'k' || e.key === 'K') { e.preventDefault(); openPalette(); }
  else if (e.key >= '1' && e.key <= '9') {
    const p = visiblePanes()[Number(e.key) - 1];
    if (p) { e.preventDefault(); focusSession(p.dataset.id); }
  } else if (e.key === ']') { e.preventDefault(); cyclePane(1); }
  else if (e.key === '[') { e.preventDefault(); cyclePane(-1); }
  // ⌘Enter deliberately works even while a form input is focused (quick launch from anywhere)
  else if (e.key === 'Enter') { e.preventDefault(); launch(currentLaunchOpts()); }
  else if (e.key === 'w' || e.key === 'W') {
    if (activeSessionId && sessions.has(activeSessionId)) { e.preventDefault(); killSession(activeSessionId); }
  } else if (e.key === 'c' || e.key === 'C') {
    // copy the terminal's visual selection (xterm's selection isn't in the textarea, so ⌘C wouldn't catch it)
    const s = focusedSession();
    if (s && s.term.hasSelection()) { e.preventDefault(); window.deck.clipboardWrite(s.term.getSelection()); }
  } else if (e.key === 'a' || e.key === 'A') {
    const s = focusedSession();
    if (s) { e.preventDefault(); s.term.selectAll(); }
  }
});
/** The session whose terminal currently holds keyboard focus, or null. */
function focusedSession() {
  const ae = document.activeElement;
  if (!ae || !ae.classList || !ae.classList.contains('xterm-helper-textarea')) return null;
  const pane = ae.closest ? ae.closest('.pane') : null;
  return pane ? sessions.get(pane.dataset.id) : null;
}

// ---- inline session rename (double-click the pane name) --------------------
function renameSession(id, name) {
  const s = sessions.get(id);
  if (!s) return;
  s.name = name;
  const nm = s.el.querySelector('.pane-name'); if (nm) nm.textContent = name;
  const row = repoRowEls.get(id);
  if (row) { const rn = row.querySelector('.repo-session-name'); if (rn) rn.textContent = name; }
  saveWorkspace(); // restore should bring the renamed deck back
}
function startRename(id, nameEl) {
  const s = sessions.get(id);
  if (!s || nameEl.isContentEditable) return; // ignore re-entry while already editing
  nameEl.contentEditable = 'true';
  nameEl.spellcheck = false;
  nameEl.focus();
  const range = document.createRange(); range.selectNodeContents(nameEl);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  const onKey = (ev) => {
    ev.stopPropagation(); // keep global shortcuts from firing while typing a name
    if (ev.key === 'Enter') { ev.preventDefault(); nameEl.blur(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); nameEl.textContent = s.name; nameEl.blur(); }
  };
  const onBlur = () => {
    nameEl.removeEventListener('keydown', onKey);
    nameEl.removeEventListener('blur', onBlur);
    nameEl.contentEditable = 'false';
    const txt = nameEl.textContent.replace(/\s+/g, ' ').trim();
    if (txt && txt !== s.name) renameSession(id, txt);
    else nameEl.textContent = s.name; // revert blank / unchanged
  };
  nameEl.addEventListener('keydown', onKey);
  nameEl.addEventListener('blur', onBlur);
}

// ---- session command palette (⌘K): fuzzy-find a session and jump to it -----
let paletteResults = []; // session ids in current display order
let paletteIndex = 0;
function paletteContext(s) {
  const repo = s.repoId ? findEff(s.repoId) : null;
  const preset = PRESETS[s.presetKey];
  return [repo ? repo.name : '', s.branch || '', preset ? preset.label : ''].filter(Boolean).join(' · ');
}
function rankSessions(query) {
  const q = query.trim();
  const out = [];
  for (const [id, s] of sessions) {
    const ns = Fuzzy.score(q, s.name);
    const cs = Fuzzy.score(q, paletteContext(s));
    // a name hit (+10) outranks a context-only hit; -Infinity means "no match on that field"
    let sc = Math.max(ns != null ? ns + 10 : -Infinity, cs != null ? cs : -Infinity);
    if (sc === -Infinity) continue;
    if (s.attention) sc += 1000;                 // sessions waiting for input float to the top
    out.push({ id, s, sc });
  }
  out.sort((a, b) => (b.sc - a.sc) || (b.s.lastData - a.s.lastData));
  return out;
}
function setPaletteSel(i) {
  if (i < 0 || i >= paletteResults.length) return;
  paletteIndex = i;
  const rows = paletteList.querySelectorAll('.palette-row');
  rows.forEach((el, idx) => el.classList.toggle('sel', idx === i));
  if (rows[i]) rows[i].scrollIntoView({ block: 'nearest' });
}
function movePalette(delta) {
  if (paletteResults.length) setPaletteSel((paletteIndex + delta + paletteResults.length) % paletteResults.length);
}
function renderPalette(query) {
  const ranked = rankSessions(query);
  paletteResults = ranked.map((r) => r.id);
  paletteIndex = 0;
  paletteList.innerHTML = '';
  if (!ranked.length) {
    const li = document.createElement('li');
    li.className = 'palette-empty';
    li.textContent = sessions.size ? '該当なし' : '起動中のセッションがありません';
    paletteList.appendChild(li);
    return;
  }
  ranked.forEach((r, i) => {
    const li = document.createElement('li');
    li.className = 'palette-row' + (i === 0 ? ' sel' : '');
    const dot = document.createElement('span');
    dot.className = 'status-dot' + (r.s.alive ? (r.s.attention ? ' waiting' : ' live') : '');
    const nm = document.createElement('span');
    nm.className = 'palette-name'; nm.textContent = r.s.name;
    const ctx = document.createElement('span');
    ctx.className = 'palette-ctx'; ctx.textContent = paletteContext(r.s);
    li.append(dot, nm, ctx);
    li.addEventListener('mousedown', (e) => { e.preventDefault(); paletteIndex = i; commitPalette(); });
    li.addEventListener('mousemove', () => setPaletteSel(i));
    paletteList.appendChild(li);
  });
}
function commitPalette() {
  const id = paletteResults[paletteIndex];
  closePalette();
  if (!id) return;
  const s = sessions.get(id);
  if (s && s.el.style.display === 'none') clearRepoSelection(); // reveal a filter-hidden pane
  focusSession(id);
}
function openPalette() {
  if (!sessions.size) return;
  paletteEl.hidden = false;
  paletteInput.value = '';
  renderPalette('');
  paletteInput.focus();
}
function closePalette() { paletteEl.hidden = true; }
paletteInput.addEventListener('input', () => renderPalette(paletteInput.value));
paletteInput.addEventListener('keydown', (e) => {
  e.stopPropagation(); // keep keys away from the global ⌘ shortcut handler
  if (e.key === 'ArrowDown') { e.preventDefault(); movePalette(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); movePalette(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); commitPalette(); }
  else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
});
$('#palette-backdrop').addEventListener('click', closePalette);

// ---- agent preset manager (⚙): add / edit / delete user-defined presets -----
const presetOverlay = $('#preset-overlay');
const presetListEl = $('#preset-list');
const presetForm = $('#preset-form');
const presetLabelInput = $('#preset-label-input');
const presetCmdInput = $('#preset-cmd-input');
const presetSubmitBtn = $('#preset-submit');
const presetCancelBtn = $('#preset-cancel');
const presetFormMsg = $('#preset-form-msg');
let editingPresetKey = null;

function resetPresetForm() {
  editingPresetKey = null;
  presetForm.reset();
  presetSubmitBtn.textContent = '＋ 追加';
  presetCancelBtn.hidden = true;
  presetFormMsg.hidden = true;
}
function renderPresetList() {
  presetListEl.innerHTML = '';
  for (const [key, p] of Object.entries(PRESETS)) {
    const li = document.createElement('li');
    li.className = 'preset-row';
    const nm = document.createElement('span');
    nm.className = 'preset-row-name'; nm.textContent = p.label;
    const cmd = document.createElement('span');
    cmd.className = 'preset-row-cmd'; cmd.textContent = p.cmd || '(shell)';
    li.append(nm, cmd);
    if (Presets.isBuiltin(key)) {
      const tag = document.createElement('span');
      tag.className = 'preset-row-tag'; tag.textContent = 'ビルトイン';
      li.appendChild(tag);
    } else {
      const edit = document.createElement('button');
      edit.type = 'button'; edit.className = 'ghost-btn'; edit.textContent = '編集';
      edit.addEventListener('click', () => startPresetEdit(key));
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'ghost-btn'; del.textContent = '削除';
      del.addEventListener('click', () => deletePreset(key));
      li.append(edit, del);
    }
    presetListEl.appendChild(li);
  }
}
function startPresetEdit(key) {
  const c = customPresets.find((p) => p.key === key);
  if (!c) return;
  editingPresetKey = key;
  presetLabelInput.value = c.label;
  presetCmdInput.value = c.cmd;
  presetSubmitBtn.textContent = '保存';
  presetCancelBtn.hidden = false;
  presetFormMsg.hidden = true;
  presetLabelInput.focus();
}
function deletePreset(key) {
  const c = customPresets.find((p) => p.key === key);
  if (!c) return;
  if (!confirm(`プリセット「${c.label}」を削除しますか？`)) return;
  customPresets = customPresets.filter((p) => p.key !== key);
  saveCustomPresets();
  if (editingPresetKey === key) resetPresetForm();
  rebuildPresetUI();
  renderPresetList();
}
presetForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = Presets.validate(presetLabelInput.value, presetCmdInput.value);
  if (!v.ok) { presetFormMsg.textContent = v.error; presetFormMsg.hidden = false; return; }
  if (editingPresetKey) {
    // edits keep the key so saved decks / live sessions stay attached to it
    const c = customPresets.find((p) => p.key === editingPresetKey);
    if (c) { c.label = v.label; c.cmd = v.cmd; }
  } else {
    const key = Presets.keyFor(v.label, Object.keys(PRESETS));
    customPresets.push({ key, label: v.label, cmd: v.cmd });
  }
  saveCustomPresets();
  resetPresetForm();
  rebuildPresetUI();
  renderPresetList();
  presetLabelInput.focus();
});
presetCancelBtn.addEventListener('click', resetPresetForm);
function openPresetManager() {
  presetOverlay.hidden = false;
  resetPresetForm();
  renderPresetList();
  presetLabelInput.focus();
}
function closePresetManager() { presetOverlay.hidden = true; }
$('#preset-manage').addEventListener('click', openPresetManager);
$('#preset-close').addEventListener('click', closePresetManager);
$('#preset-backdrop').addEventListener('click', closePresetManager);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !presetOverlay.hidden) closePresetManager();
});

// ---- terminal context menu (right-click: copy / paste / select all / clear) ----
const termMenu = $('#term-menu');
let termMenuSession = null;
function openTermMenu(id, x, y) {
  termMenuSession = id;
  termMenu.hidden = false;
  const mw = termMenu.offsetWidth || 150, mh = termMenu.offsetHeight || 140;
  termMenu.style.left = Math.max(6, Math.min(x, window.innerWidth - mw - 6)) + 'px';
  termMenu.style.top = Math.max(6, Math.min(y, window.innerHeight - mh - 6)) + 'px';
}
function closeTermMenu() { termMenu.hidden = true; termMenuSession = null; }
async function termMenuAction(act) {
  const s = sessions.get(termMenuSession);
  closeTermMenu();
  if (!s) return;
  if (act === 'copy') { const sel = s.term.getSelection(); if (sel) window.deck.clipboardWrite(sel); }
  else if (act === 'paste') { const t = await window.deck.clipboardRead(); if (t) window.deck.input(s.id, t); }
  else if (act === 'selectall') { focusSession(s.id); s.term.selectAll(); }
  else if (act === 'clear') { s.term.clear(); }
}
termMenu.addEventListener('click', (e) => { const b = e.target.closest('button[data-act]'); if (b) termMenuAction(b.dataset.act); });
termMenu.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('click', () => { if (!termMenu.hidden) closeTermMenu(); });
// capture phase: the focused xterm consumes Escape as terminal input, so intercept it first
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !termMenu.hidden) { e.preventDefault(); e.stopPropagation(); closeTermMenu(); }
}, true);

// ---- boot ------------------------------------------------------------------
(async function boot() {
  buildPresetOptions();
  buildQuickChips();
  try {
    const info = await window.deck.appInfo();
    homeDir = info.home;
    homeRepo = { id: normRepoPath(homeDir), path: homeDir, name: 'Home', isHome: true };
    cwdInput.value = info.home;
    cwdInput.placeholder = info.home;
    sysInfoEl.textContent = `${info.platform} · ${info.defaultShell.split(/[\\/]/).pop()}`;
    refreshRepoHint();
  } catch (_) { sysInfoEl.textContent = '—'; }
  await loadReposUI();
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    try { Notification.requestPermission(); } catch (_) {}
  }
  // trigger the initial update check now that the onUpdateAvailable listener is registered
  try { window.deck.checkUpdate().catch(() => {}); } catch (_) {}
})();
