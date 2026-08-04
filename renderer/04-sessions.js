'use strict';

// ---- session creation ------------------------------------------------------
async function launch({ presetKey, command, name, cwd, worktree, branch, profileId, restoreMeta }) {
  const preset = PRESETS[presetKey] || PRESETS.shell;
  const restored = restoreMeta || {};
  const profile = profileId || Presets.DEFAULT_PROFILE;
  // An explicit command wins (the form lets you type anything, and restore
  // replays the exact string that ran last time); otherwise the profile decides.
  if (command == null) command = commandFor(presetKey, profile);
  // Handing an agent unattended write/exec authority is worth one keystroke.
  // Judged on the resolved command, so a typed-in --dangerously-… is caught too,
  // and skipped on restore — the user already agreed when they first launched it.
  if (!restoreMeta && Presets.looksDangerous(command)) {
    if (!confirm(t('profile.dangerConfirm', { label: profileLabel(profile), command }))) {
      return { ok: false, error: 'cancelled' };
    }
  }
  const id = 'sess_' + (++seq) + '_' + Math.random().toString(36).slice(2, 6);
  const displayName = name || `${preset.label} #${seq}`;
  const workdir = cwd || cwdInput.value.trim() || '';
  const wantWorktree = !!worktree;
  const wtName = (branch && branch.trim()) || `agentdeck/${presetKey}-${seq}`;

  emptyState.style.display = 'none';

  const pane = document.createElement('section');
  pane.className = 'pane';
  pane.dataset.id = id;
  // Which agent this is has to survive a glance across eight panes, so it is
  // said three ways: a coloured rail down the left edge, a glyph, and the badge.
  // Colour alone would fail anyone who cannot separate the hues (WCAG 1.4.1).
  pane.dataset.tone = preset.tone || Presets.toneFor(presetKey);
  const head = document.createElement('div');
  head.className = 'pane-head';
  head.innerHTML =
    '<span class="pane-grip" data-i18n-title="pane.drag">⠿</span>' +
    '<span class="status-dot live"></span>' +
    '<span class="pane-glyph" aria-hidden="true"></span>' +
    '<span class="pane-name"></span>' +
    `<span class="pane-badge">${preset.badge}</span>` +
    '<span class="pane-repo" hidden></span>' +
    '<span class="pane-cwd"></span>' +
    '<button class="pane-diff" data-i18n-title="pane.diff">diff</button>' +
    '<button class="pane-kill" data-i18n-title="pane.kill">kill</button>';
  head.querySelector('.pane-glyph').textContent = preset.glyph || Presets.glyphFor(presetKey);
  const nameEl = head.querySelector('.pane-name');
  nameEl.textContent = displayName;
  nameEl.setAttribute('data-i18n-title', 'pane.rename');
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
  applyI18n(pane); // fill pane-head tooltips (and re-fill on language switch)

  const term = new window.Terminal({
    fontFamily: '"JetBrains Mono","SF Mono","Menlo","Consolas",monospace',
    fontSize: 12, lineHeight: 1.15, cursorBlink: true, scrollback: 5000,
    theme: TERM_THEME, allowProposedApi: true,
    // Without this xterm renders to a canvas that assistive tech cannot see, so
    // the app's entire reason for existing — the terminals — is invisible to a
    // screen reader. It mirrors the visible rows into a live region instead.
    screenReaderMode: true,
  });
  const fit = new FitAddonCtor();
  term.loadAddon(fit);
  const search = new ((window.SearchAddon && window.SearchAddon.SearchAddon) || window.SearchAddon)();
  term.loadAddon(search);
  term.open(termHost);
  requestAnimationFrame(() => { try { fit.fit(); } catch (_) {} });
  term.onData((d) => window.deck.input(id, d));
  // Enter submits; Shift+Enter has to mean "newline, don't submit". xterm would
  // otherwise send a plain CR for both. lib/hooks.js holds the sequence.
  term.attachCustomKeyEventHandler((e) => {
    if (!Hooks.isShiftEnter(e)) return true;
    // Returning false stops xterm handling the key, but NOT the browser: the
    // helper textarea would still take the Enter and emit its own CR, which
    // submits the continuation line we just opened. Both have to be silenced.
    e.preventDefault();
    window.deck.input(id, Hooks.SHIFT_ENTER);
    return false;
  });

  // Dropping a file on a terminal types its path, which is how these agents take
  // an image or a file reference. The document-level guard in 03-deck.js has
  // already called preventDefault (so Chromium cannot navigate to it); this adds
  // the useful behaviour on top.
  termHost.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); e.stopPropagation();
    try { e.dataTransfer.dropEffect = 'copy'; } catch (_) {}
    termHost.classList.add('drop-target');
  });
  termHost.addEventListener('dragleave', () => termHost.classList.remove('drop-target'));
  termHost.addEventListener('drop', (e) => {
    termHost.classList.remove('drop-target');
    if (!hasFiles(e)) return;
    e.preventDefault(); e.stopPropagation();
    const paths = [...(e.dataTransfer.files || [])].map((f) => window.deck.pathForFile(f));
    const text = Hooks.dropText(paths);
    if (!text) return;
    markActive(id);
    // a trailing space so the next dropped path (or typed word) does not run into it
    window.deck.input(id, text + ' ');
    try { term.focus(); } catch (_) {}
  });


  const ro = new ResizeObserver(() => {
    try { fit.fit(); window.deck.resize(id, term.cols, term.rows); } catch (_) {}
  });
  ro.observe(termHost);

  const s = {
    id, term, fit, search, el: pane, ro, name: displayName,
    alive: true, hasOutput: false, attention: false, lastData: Date.now(),
    // Saved Git metadata remains untrusted until pty:spawn validates it in main.
    gitCwd: null, baseSha: null, branch: null, baseBranch: null, gitRoot: null, worktreePath: null,
    repoId: repoIdForCwd(workdir), repoMatchCwd: workdir, launchCwd: workdir,
    presetKey, command,            // remembered so the deck can be saved + re-spawned
    profileId: profile,            // which variant produced `command`, for the restored UI
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
    // post-launch commands are preset-level: derived from the resolved preset so
    // every entry point (form, chips, deck restore, schedule) gets them for free
    initCommands: (preset.init && preset.init.length) ? preset.init : [],
    // Claude Code is the one CLI whose hooks we speak so far. Naming the binary
    // (rather than the preset key) lets main refuse to edit a command that is
    // not actually an invocation of it.
    hookBinary: presetKey === 'claude' ? 'claude' : '',
    worktree: { enabled: wantWorktree, branch: wtName },
    restoreGit: restored.worktreePath ? {
      baseSha: restored.baseSha, branch: restored.branch, baseBranch: restored.baseBranch,
      gitRoot: restored.gitRoot,
      worktreePath: restored.worktreePath,
    } : null,
  });

  // the pane can be killed (kill button / chord+W / restore) during the spawn await;
  // killSession() then disposed `term` and removed the session — bail before touching them
  if (!sessions.has(id)) {
    // pty:kill may have raced ahead of the async spawn's registration. Once a
    // successful invoke resolves, a second idempotent kill closes that orphan.
    if (res && res.ok) window.deck.kill(id);
    return { ok: false, id, error: 'cancelled' };
  }

  if (!res || !res.ok) {
    term.write(`\r\n\x1b[31m[failed: ${res ? res.error : 'unknown'}]\x1b[0m\r\n`);
    setExited(id);
    diffBtn.disabled = true;
    return { ok: false, id, error: res ? res.error : 'unknown' };
  }

  if (res.git) {
    s.gitCwd = res.git.cwd;
    // The main process has re-derived these fields from live Git state. Never
    // prefer localStorage metadata here: it may be stale or renderer-forged.
    s.baseSha = res.git.baseSha;
    s.branch = res.git.branch;
    s.baseBranch = res.git.baseBranch || null;
    s.gitRoot = res.git.root || null; // present only for validated worktree-isolated sessions
    s.worktreePath = res.git.worktree || null;
    s.repoId = res.repoId || res.git.repoId || (res.git.restored ? repoIdForCwd(res.git.root) : repoIdForCwd(s.launchCwd));
    const registeredForResult = s.repoId ? findEff(s.repoId) : null;
    s.repoMatchCwd = res.repoCwd || (registeredForResult && (registeredForResult.realPath || registeredForResult.path)) ||
      res.canonicalCwd || s.launchCwd;
    if (res.git.restored) {
      const registered = s.repoId ? findEff(s.repoId) : null;
      s.launchCwd = registered ? registered.path : res.git.root;
    }
    if (s.worktreePath) {
      head.querySelector('.pane-cwd').textContent = `⌥ ${s.branch}`;
      head.querySelector('.pane-cwd').title = s.worktreePath;
    } else if (s.branch) {
      head.querySelector('.pane-cwd').title = res.git.cwd;
    }
    if (res.git.restoreRejected) flashRepoMsg(t('deck.restoreMetadataRejected', { name: s.name }));
  } else {
    s.repoId = res.repoId || repoIdForCwd(res.canonicalCwd || s.launchCwd);
    const registered = s.repoId ? findEff(s.repoId) : null;
    s.repoMatchCwd = res.repoCwd || (registered && (registered.realPath || registered.path)) ||
      res.canonicalCwd || s.launchCwd;
    diffBtn.disabled = true;
    diffBtn.title = t('form.notRepo');
  }
  // spawn may canonicalise a symlinked cwd or validate a restored worktree back
  // to its parent repository; rebuild the sidebar with that authoritative tag.
  renderRepos();
  term.focus();
  markActive(id);
  saveWorkspace(); // remember this session (cwd/git info now resolved) for restore
  return { ok: true, id };
}

function killSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  // Kill is irreversible — saveWorkspace() runs after the delete and the restore button
  // only appears at sessions.size===0, so a killed 1-of-N pane can't be brought back.
  // Confirm only when there's real loss at stake: a live agent mid-interaction, or
  // unmerged work in an isolated worktree. Exited/plain shells stay one-click.
  const risky = s.alive && (s.worktreePath || s.attention);
  if (risky && !confirm(t('pane.confirmKill', { name: s.name }))) return;
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
  countEl.textContent = t('count.sessions', { n });
}

// ---- attention detection ---------------------------------------------------
function setAttention(s, id) {
  s.attention = true;
  s.el.classList.add('attention');
  const dot = s.el.querySelector('.status-dot');
  if (dot) { dot.classList.remove('live'); dot.classList.add('waiting'); }
  updateWaitingTitle();
  refreshSessionState(s);
  if (!windowFocused) notify(t('notify.attention', { name: s.name }));
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
  document.title = n > 0 ? t('title.attention', { n }) : 'Agent Deck';
}
function notify(body, onClick) {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') {
      const n = new Notification('Agent Deck', { body });
      if (onClick) n.onclick = onClick;
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

// ---- state from the agent itself (hooks) ------------------------------------
// When an agent reports its own state, that is authoritative and the heuristic
// below stops second-guessing it for that session. The heuristic remains for
// every agent that has no hooks surface, and for a session whose hooks never
// arrive (a wrapper script, an older CLI) — hookDriven only flips on the first
// event actually received, so nothing is lost by trying.
window.deck.onHookEvent(({ id, event, state } = {}) => {
  const s = sessions.get(id);
  if (!s) return;
  s.hookDriven = true;
  s.lastHookEvent = event;
  if (state === 'attention') { if (!s.attention) setAttention(s, id); }
  else if (state === 'busy') { clearAttention(s); }
  else if (state === 'ended') { clearAttention(s); }
});

const MIN_IDLE_MS = Math.min(...Object.values(window.Attention.THRESHOLDS_MS));
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    const watching = windowFocused && activeSessionId === id;
    // cheap guards first — only read the terminal buffer once a flag is possible
    if (!s.alive || !s.hasOutput || s.attention || watching) continue;
    if (s.hookDriven) continue; // the agent tells us; no need to guess
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
