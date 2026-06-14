'use strict';

// ---- update notification (main checks the feed; we just surface it) ---------
const updateToast = $('#update-toast');
const updateToastText = $('#update-toast-text');
let updateUrl = '';
let lastNotifiedUpdate = ''; // dedup: the 6h re-poll must not re-notify the same version
function showUpdate(p) {
  updateUrl = p.url || '';
  updateToastText.textContent = t('update.toast', { latest: p.latest, current: p.current });
  updateToast.hidden = false;
  // also raise an OS notification (once per version) so an update is noticed even
  // when the window is in the background; clicking it opens the download page
  if (p.latest && p.latest !== lastNotifiedUpdate) {
    lastNotifiedUpdate = p.latest;
    notify(t('update.notif', { latest: p.latest }),
      () => { if (updateUrl) window.deck.openExternal(updateUrl); });
  }
}
window.deck.onUpdateAvailable(showUpdate);
$('#update-download').addEventListener('click', () => { if (updateUrl) window.deck.openExternal(updateUrl); });
$('#update-dismiss').addEventListener('click', () => { updateToast.hidden = true; });
// ---- agent preset manager (⚙): add / edit / delete user-defined presets -----
const presetOverlay = $('#preset-overlay');
const presetListEl = $('#preset-list');
const presetForm = $('#preset-form');
const presetFormTitle = $('#preset-form-title');
const presetLabelInput = $('#preset-label-input');
const presetCmdInput = $('#preset-cmd-input');
const presetInitInput = $('#preset-init-input');
const presetSubmitBtn = $('#preset-submit');
const presetCancelBtn = $('#preset-cancel');
const presetFormMsg = $('#preset-form-msg');
let editingPresetKey = null;
let editingBuiltin = false; // built-ins: only their post-launch init is editable (label/cmd are read-only)

/** Re-apply edit-mode chrome (submit label + built-in init title) after a live
 *  language switch — applyI18n() resets #preset-submit to its data-i18n default
 *  ("Add") and never touches the imperatively-set title, so refresh both here. */
function refreshPresetFormChrome() {
  if (!editingPresetKey) return;
  presetSubmitBtn.textContent = t('common.save');
  if (editingBuiltin && !presetFormTitle.hidden) {
    presetFormTitle.textContent = t('presets.initTitle', { label: (PRESETS[editingPresetKey] || {}).label || '' });
  }
}
function resetPresetForm() {
  editingPresetKey = null;
  editingBuiltin = false;
  presetForm.reset();
  presetLabelInput.disabled = false;
  presetCmdInput.disabled = false;
  presetFormTitle.hidden = true;
  presetSubmitBtn.textContent = t('common.add');
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
      // built-ins are read-only except their post-launch init commands
      const initBtn = document.createElement('button');
      initBtn.type = 'button'; initBtn.className = 'ghost-btn'; initBtn.textContent = t('presets.editInit');
      initBtn.addEventListener('click', () => startInitEdit(key));
      const tag = document.createElement('span');
      tag.className = 'preset-row-tag'; tag.textContent = t('presets.builtin');
      li.append(initBtn, tag);
    } else {
      const edit = document.createElement('button');
      edit.type = 'button'; edit.className = 'ghost-btn'; edit.textContent = t('common.edit');
      edit.addEventListener('click', () => startPresetEdit(key));
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'ghost-btn'; del.textContent = t('common.delete');
      del.addEventListener('click', () => deletePreset(key));
      li.append(edit, del);
    }
    // post-launch init preview, wrapped to its own line (only when configured)
    if (p.init && p.init.length) {
      const init = document.createElement('span');
      init.className = 'preset-row-init';
      init.textContent = '↳ ' + p.init.join(' · ');
      init.title = p.init.join('\n');
      li.appendChild(init);
    }
    presetListEl.appendChild(li);
  }
}
function startPresetEdit(key) {
  const c = customPresets.find((p) => p.key === key);
  if (!c) return;
  editingPresetKey = key;
  editingBuiltin = false;
  presetLabelInput.disabled = false;
  presetCmdInput.disabled = false;
  presetLabelInput.value = c.label;
  presetCmdInput.value = c.cmd;
  presetInitInput.value = (presetInit[key] || []).join('\n');
  presetFormTitle.hidden = true;
  presetSubmitBtn.textContent = t('common.save');
  presetCancelBtn.hidden = false;
  presetFormMsg.hidden = true;
  presetLabelInput.focus();
}
/** Edit only a built-in's post-launch init commands; its label/cmd stay read-only. */
function startInitEdit(key) {
  const p = PRESETS[key];
  if (!p) return;
  editingPresetKey = key;
  editingBuiltin = true;
  presetLabelInput.value = p.label;
  presetCmdInput.value = p.cmd;
  presetLabelInput.disabled = true;
  presetCmdInput.disabled = true;
  presetInitInput.value = (presetInit[key] || []).join('\n');
  presetFormTitle.textContent = t('presets.initTitle', { label: p.label });
  presetFormTitle.hidden = false;
  presetSubmitBtn.textContent = t('common.save');
  presetCancelBtn.hidden = false;
  presetFormMsg.hidden = true;
  presetInitInput.focus();
}
function deletePreset(key) {
  const c = customPresets.find((p) => p.key === key);
  if (!c) return;
  if (!confirm(t('presets.confirmDelete', { label: c.label }))) return;
  customPresets = customPresets.filter((p) => p.key !== key);
  saveCustomPresets();
  setPresetInit(key, []); // drop any init so a later same-slug preset can't inherit it
  if (editingPresetKey === key) resetPresetForm();
  rebuildPresetUI();
  renderPresetList();
}
/** Store (or clear) a preset's post-launch init commands and persist the map. */
function setPresetInit(key, lines) {
  if (lines && lines.length) presetInit[key] = lines;
  else delete presetInit[key];
  savePresetInit();
}
presetForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const init = Presets.parseInit(presetInitInput.value);
  if (editingBuiltin) {
    // built-in: only its init is editable; label/cmd are fixed in lib/presets.js
    setPresetInit(editingPresetKey, init);
  } else {
    const v = Presets.validate(presetLabelInput.value, presetCmdInput.value);
    if (!v.ok) { presetFormMsg.textContent = v.error; presetFormMsg.hidden = false; return; }
    if (editingPresetKey) {
      // edits keep the key so saved decks / live sessions stay attached to it
      const c = customPresets.find((p) => p.key === editingPresetKey);
      if (c) { c.label = v.label; c.cmd = v.cmd; }
      saveCustomPresets();
      setPresetInit(editingPresetKey, init);
    } else {
      const key = Presets.keyFor(v.label, Object.keys(PRESETS));
      customPresets.push({ key, label: v.label, cmd: v.cmd });
      saveCustomPresets();
      setPresetInit(key, init);
    }
  }
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
  // repos are loaded and the schedule:fire handler (08) is registered — tell main
  // it may deliver scheduled launches (it queues window creation on this signal)
  try { window.deck.scheduleReady(); } catch (_) {}
})();
