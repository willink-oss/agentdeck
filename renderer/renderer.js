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

// diff drawer refs
const diffOverlay = $('#diff-overlay');
const diffName = $('#diff-name');
const diffBranch = $('#diff-branch');
const diffMeta = $('#diff-meta');
const diffBody = $('#diff-body');
let diffSessionId = null;

let seq = 0;
let activeSessionId = null;
let windowFocused = true;

/** Registered repositories (persisted in main). @type {Array<{id,path,name,isRepo,branch}>} */
let repos = [];
let activeRepoId = null;

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

$('#launch-form').addEventListener('submit', (e) => {
  e.preventDefault();
  launch({
    presetKey: presetSel.value,
    command: commandInput.value,
    name: nameInput.value.trim(),
    cwd: cwdInput.value.trim(),
    worktree: wtEnable.checked,
    branch: wtBranch.value.trim(),
  });
});

// ---- repository panel ------------------------------------------------------
/* Share the path-normalisation logic with main (lib/repos.js, loaded via <script>)
   so repo ids computed here and in the main process can never drift. */
const Repos = window.Repos;
function normRepoPath(p) { return Repos.normalizePath(p); }
function repoIdForCwd(dir) {
  const hit = Repos.findRepo(repos, normRepoPath(dir));
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

async function loadReposUI() {
  try { const res = await window.deck.reposList(); repos = (res && res.repos) || []; }
  catch (_) { repos = []; }
  retagSessions();
  renderRepos();
}
async function addRepoFlow() {
  const dir = await window.deck.openDir();
  if (!dir) return;
  const res = await window.deck.reposAdd(dir);
  repos = (res && res.repos) || [];
  retagSessions();
  if (res && res.ok === false) { flashRepoMsg('リポジトリの保存に失敗しました: ' + (res.error || '')); renderRepos(); return; }
  const added = Repos.findRepo(repos, normRepoPath(dir));
  if (added) selectRepo(added.id); else renderRepos();
}
async function removeRepoFromList(id) {
  const res = await window.deck.reposRemove(id);
  repos = (res && res.repos) || [];
  if (activeRepoId === id) activeRepoId = null;
  retagSessions();
  if (res && res.ok === false) flashRepoMsg('リポジトリの保存に失敗しました: ' + (res.error || ''));
  renderRepos();
}
function selectRepo(id) {
  activeRepoId = id;
  const r = Repos.findRepo(repos, id);
  if (r) { cwdInput.value = r.path; refreshRepoHint(); }
  renderRepos();
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
  return (s.repoId && Repos.findRepo(repos, s.repoId)) ? s.repoId : '';
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
/** Build one group box — a registered repo, or the orphan "Other" group. */
function buildGroup({ key, name, nameDim, path, branch, repoId, sessList }) {
  const item = document.createElement('div');
  item.className = 'repo-item' + (repoId && repoId === activeRepoId ? ' active' : '');
  if (repoId) item.dataset.repoId = repoId;

  const row = document.createElement('div');
  row.className = 'repo-row';
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
  if (sessList.length) {
    const c = document.createElement('span');
    c.className = 'repo-count' + (sessList.some(([, s]) => s.attention) ? ' attention' : '');
    c.textContent = String(sessList.length);
    row.appendChild(c);
    repoBadgeEls.set(key, c);
  }
  if (repoId) {
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
  if (sessList.length) {
    const wrap = document.createElement('div');
    wrap.className = 'repo-sessions';
    for (const [id, s] of sessList) wrap.appendChild(sessionRow(id, s));
    item.appendChild(wrap);
  }
  if (repoId) item.addEventListener('click', () => selectRepo(repoId));
  return item;
}
/** Full structural rebuild — use on add/remove/select repo and launch/kill session. */
function renderRepos() {
  repoRowEls = new Map();
  repoBadgeEls = new Map();
  repoListEl.innerHTML = '';
  repoEmptyEl.style.display = repos.length ? 'none' : 'block';
  const byRepo = sessionsByRepo();
  for (const repo of repos) {
    repoListEl.appendChild(buildGroup({
      key: repo.id, name: repo.name, path: repo.path, branch: repo.branch,
      repoId: repo.id, sessList: byRepo.get(repo.id) || [],
    }));
  }
  const orphans = byRepo.get('') || [];
  if (orphans.length) {
    repoListEl.appendChild(buildGroup({ key: '', name: 'Other', nameDim: true, sessList: orphans }));
  }
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
    gitCwd: null, baseSha: null, branch: null,
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
  renderRepos();
  if (sessions.size === 0) emptyState.style.display = 'flex';
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
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !diffOverlay.hidden) closeDiff(); });

// ---- boot ------------------------------------------------------------------
(async function boot() {
  buildPresetOptions();
  buildQuickChips();
  loadReposUI();
  try {
    const info = await window.deck.appInfo();
    cwdInput.value = info.home;
    cwdInput.placeholder = info.home;
    sysInfoEl.textContent = `${info.platform} · ${info.defaultShell.split(/[\\/]/).pop()}`;
    refreshRepoHint();
  } catch (_) { sysInfoEl.textContent = '—'; }
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    try { Notification.requestPermission(); } catch (_) {}
  }
})();
