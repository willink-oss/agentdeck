'use strict';

/* Presets. `cmd` is auto-typed + run when the session starts. */
const PRESETS = {
  claude:      { label: 'Claude Code',  cmd: 'claude', badge: 'CLAUDE' },
  antigravity: { label: 'Antigravity',  cmd: 'agy',    badge: 'ANTIGRAVITY' },
  codex:       { label: 'Codex CLI',    cmd: 'codex',  badge: 'CODEX' },
  gemini:      { label: 'Gemini CLI',   cmd: 'gemini', badge: 'GEMINI' },
  shell:       { label: 'Plain shell',  cmd: '',       badge: 'SHELL' },
};

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
  for (const key of ['claude', 'antigravity', 'codex', 'gemini']) {
    const chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'chip'; chip.textContent = PRESETS[key].label;
    chip.addEventListener('click', () => launch({ presetKey: key, command: PRESETS[key].cmd }));
    host.appendChild(chip);
  }
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
function focusSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  try { s.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (_) {}
  try { s.term.focus(); } catch (_) {}
  activeSessionId = id;
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
    '<span class="status-dot live"></span>' +
    '<span class="pane-name"></span>' +
    `<span class="pane-badge">${preset.badge}</span>` +
    '<span class="pane-cwd"></span>' +
    '<button class="pane-diff" title="Review git diff">diff</button>' +
    '<button class="pane-kill" title="Kill session">kill</button>';
  head.querySelector('.pane-name').textContent = displayName;
  head.querySelector('.pane-cwd').textContent = workdir || '~';

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
  };
  sessions.set(id, s);
  updateCount();
  renderRepos();

  const setActive = () => { activeSessionId = id; clearAttention(s); };
  pane.addEventListener('mousedown', setActive);
  termHost.addEventListener('focusin', setActive);

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
  activeSessionId = id;
}

function killSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  window.deck.kill(id);
  try { s.ro.disconnect(); } catch (_) {}
  try { s.term.dispose(); } catch (_) {}
  s.el.remove();
  sessions.delete(id);
  if (diffSessionId === id) closeDiff();
  updateCount();
  updateWaitingTitle();
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
  // merge-to-base only makes sense for a worktree-isolated session (has its own branch + root)
  diffMerge.hidden = !(s.gitRoot && s.branch);
  diffMerge.disabled = false;
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
  for (const seg of segs) html += `<span class="${seg.cls}">${esc(seg.text) || '&nbsp;'}</span>`;
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
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !diffOverlay.hidden) closeDiff(); });

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
})();
