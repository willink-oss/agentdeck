'use strict';

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
// Platform chord: ⌘ on macOS, Ctrl+Shift elsewhere. Plain Ctrl-combos (Ctrl+W,
// Ctrl+[, Ctrl+1 …) are terminal/readline keys — hijacking them would break the
// shell — so Windows/Linux follow the terminal-app convention (Windows Terminal,
// gnome-terminal etc.) of reserving Ctrl+Shift for the app itself.
const IS_MAC = window.deck.platform === 'darwin';
const appChord = IS_MAC
  ? (e) => e.metaKey && !e.ctrlKey && !e.altKey
  : (e) => e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey;
/** Normalise the pressed key to a Digit1/BracketLeft/KeyW-style token.
 *  mac (no Shift in the chord): match on e.key — layout-aware, so ⌘[ is the key
 *  *labelled* [ on JIS keyboards (whose physical code is BracketRight).
 *  non-mac (Ctrl+Shift): Shift mutates e.key ('1' -> '!'), so match the physical
 *  e.code instead — stable under the chord, at the cost of layout-blindness. */
function chordKey(e) {
  if (!IS_MAC) return e.code;
  const k = e.key;
  if (k >= '1' && k <= '9') return 'Digit' + k;
  if (k === '[') return 'BracketLeft';
  if (k === ']') return 'BracketRight';
  if (k === 'Enter') return 'Enter';
  const u = typeof k === 'string' ? k.toUpperCase() : '';
  if (u === 'W' || u === 'K' || u === 'C' || u === 'A') return 'Key' + u;
  return '';
}
// Capture phase: with a terminal focused, xterm handles some Ctrl+Shift combos
// itself (Ctrl+Shift+2 = the classic Ctrl+@ NUL) and stops propagation, so a
// bubble-phase listener never hears them. Capturing first — and stopping
// propagation whenever we act — makes app chords always win over xterm (and
// keeps stray bytes like ^@ / \r out of the shell).
window.addEventListener('keydown', (e) => {
  if (!appChord(e)) return;
  if (document.activeElement && document.activeElement.isContentEditable) return; // editing a name
  if (!paletteEl.hidden) return; // the open palette handles its own keys
  if (!presetOverlay.hidden) return; // modal: keep ⌘W/⌘Enter/⌘K away from the deck behind it
  const code = chordKey(e);
  if (code === 'KeyK') { e.preventDefault(); e.stopPropagation(); openPalette(); }
  else if (code >= 'Digit1' && code <= 'Digit9') {
    const p = visiblePanes()[Number(code.slice(5)) - 1];
    if (p) { e.preventDefault(); e.stopPropagation(); focusSession(p.dataset.id); }
  } else if (code === 'BracketRight') { e.preventDefault(); e.stopPropagation(); cyclePane(1); }
  else if (code === 'BracketLeft') { e.preventDefault(); e.stopPropagation(); cyclePane(-1); }
  // chord+Enter deliberately works even while a form input is focused (quick launch from anywhere)
  else if (code === 'Enter') { e.preventDefault(); e.stopPropagation(); launch(currentLaunchOpts()); }
  else if (code === 'KeyW') {
    if (activeSessionId && sessions.has(activeSessionId)) { e.preventDefault(); e.stopPropagation(); killSession(activeSessionId); }
  } else if (code === 'KeyC') {
    // copy the terminal's visual selection (xterm's selection isn't in the textarea, so a plain copy wouldn't catch it)
    const s = focusedSession();
    if (s && s.term.hasSelection()) { e.preventDefault(); e.stopPropagation(); window.deck.clipboardWrite(s.term.getSelection()); }
  } else if (code === 'KeyA') {
    const s = focusedSession();
    if (s) { e.preventDefault(); e.stopPropagation(); s.term.selectAll(); }
  }
}, true);
// the static hint markup is written for macOS; relabel for the Ctrl+Shift chord
if (!IS_MAC) {
  const kbdHint = document.querySelector('.kbd-hint');
  if (kbdHint) kbdHint.textContent = 'Ctrl+Shift+K 検索 · Ctrl+Shift+1–9 ペイン · Ctrl+Shift+[ ] 移動 · Ctrl+Shift+Enter 起動 · Ctrl+Shift+W 終了';
}
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
