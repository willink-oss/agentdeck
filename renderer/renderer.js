'use strict';

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
  // escaping + assembly live in lib/diff.js (segmentsToHtml) so CI covers the XSS path
  const html = window.GitDiff.segmentsToHtml(window.GitDiff.diffToSegments(diff, untracked));
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
  // scoring/ordering live in lib/fuzzy.js (rankSessions) so CI covers them
  const entries = [...sessions].map(([id, s]) =>
    ({ id, s, name: s.name, context: paletteContext(s), attention: s.attention, lastData: s.lastData }));
  return Fuzzy.rankSessions(query, entries).map((r) => ({ id: r.entry.id, s: r.entry.s, sc: r.sc }));
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
