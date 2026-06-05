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
    term, fit, el: pane, ro, name: displayName,
    alive: true, hasOutput: false, attention: false, lastData: Date.now(),
    gitCwd: null, baseSha: null, branch: null,
  };
  sessions.set(id, s);
  updateCount();

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
  if (!windowFocused) notify(s.name);
}
function clearAttention(s) {
  if (!s.attention) return;
  s.attention = false;
  s.el.classList.remove('attention');
  const dot = s.el.querySelector('.status-dot');
  if (dot && s.alive) { dot.classList.remove('waiting'); dot.classList.add('live'); }
  updateWaitingTitle();
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
