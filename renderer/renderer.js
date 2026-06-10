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
