'use strict';

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
  const search = new ((window.SearchAddon && window.SearchAddon.SearchAddon) || window.SearchAddon)();
  term.loadAddon(search);
  term.open(termHost);
  requestAnimationFrame(() => { try { fit.fit(); } catch (_) {} });
  term.onData((d) => window.deck.input(id, d));

  const ro = new ResizeObserver(() => {
    try { fit.fit(); window.deck.resize(id, term.cols, term.rows); } catch (_) {}
  });
  ro.observe(termHost);

  const s = {
    id, term, fit, search, el: pane, ro, name: displayName,
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
  if (!windowFocused) notify(`${s.name} が入力待ちです`);
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
function notify(body) {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') {
      new Notification('Agent Deck', { body });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
  } catch (_) {}
}

/** Last few buffer rows up to the cursor (wrapped rows included), for idle classification. */
function termTailLines(term, n) {
  try {
    const buf = term.buffer.active;
    const end = buf.baseY + buf.cursorY;
    const out = [];
    for (let y = Math.max(0, end - n + 1); y <= end; y++) {
      const line = buf.getLine(y);
      if (line) out.push(line.translateToString(true));
    }
    return out;
  } catch (_) { return []; }
}

const MIN_IDLE_MS = Math.min(...Object.values(window.Attention.THRESHOLDS_MS));
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    const watching = windowFocused && activeSessionId === id;
    // cheap guards first — only read the terminal buffer once a flag is possible
    if (!s.alive || !s.hasOutput || s.attention || watching) continue;
    if (now - s.lastData <= MIN_IDLE_MS) continue;
    // silence alone can't tell "waiting" from "thinking": classify the terminal
    // tail (prompt / question / working / plain) and let the kind pick the cutoff
    const kind = window.Attention.classifyTail(termTailLines(s.term, 4));
    if (window.Attention.shouldFlagAttention({ ...s, watching }, now, kind)) {
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
