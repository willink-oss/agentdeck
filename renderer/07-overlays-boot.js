'use strict';

// ---- update: in-app download/install (electron-updater) + browser fallback ---
// State machine driven by main's IPC events:
//   available  → button "ダウンロード"     (in-app)  / "ダウンロードページを開く" (feed/dev)
//   downloading→ button "ダウンロード中 N%"
//   downloaded → button "再起動してインストール" → quitAndInstall()
const updateToast = $('#update-toast');
const updateToastText = $('#update-toast-text');
const updateBtn = $('#update-download');
let updateUrl = '';            // browser fallback link (feed / dev mode)
let updateCanInApp = false;    // true → electron-updater can download+install in-app
let updatePhase = 'idle';      // idle | available | downloading | downloaded
let lastNotifiedUpdate = '';   // dedup: the 6h re-poll must not re-notify the same version

function showUpdate(p) {
  updateUrl = p.url || '';
  updateCanInApp = !!p.canInApp;
  updatePhase = 'available';
  updateToastText.textContent = t('update.toast', { latest: p.latest, current: p.current });
  updateBtn.textContent = t(updateCanInApp ? 'update.download' : 'update.openPage');
  updateToast.hidden = false;
  // OS notification once per version so a backgrounded window still notices the update
  if (p.latest && p.latest !== lastNotifiedUpdate) {
    lastNotifiedUpdate = p.latest;
    notify(t(updateCanInApp ? 'update.notif' : 'update.notifBrowser', { latest: p.latest }),
      () => { updateToast.hidden = false; if (!updateCanInApp && updateUrl) window.deck.openExternal(updateUrl); });
  }
}

async function onUpdateClick() {
  if (updatePhase === 'downloaded') { window.deck.installUpdate(); return; } // restart & install
  if (updatePhase === 'downloading') return;                                  // already in flight
  if (updateCanInApp) {
    updatePhase = 'downloading';
    updateBtn.textContent = t('update.downloading', { percent: 0 });
    const r = await window.deck.downloadUpdate();
    if (r && r.ok === false) onUpdateError();        // revert to a browser link on failure
  } else if (updateUrl) {
    window.deck.openExternal(updateUrl);             // feed / dev → browser
  }
}

function onUpdateError() {
  // Only meaningful once an in-app download has started; discovery-time errors
  // (e.g. a release without update metadata) are handled by main's feed fallback.
  if (updatePhase !== 'downloading') return;
  updatePhase = 'available';
  updateCanInApp = false;
  if (!updateUrl) updateUrl = 'https://github.com/willink-oss/agentdeck/releases';
  updateBtn.textContent = t('update.openPage');
}

window.deck.onUpdateAvailable(showUpdate);
window.deck.onUpdateProgress((p) => {
  updatePhase = 'downloading';
  updateBtn.textContent = t('update.downloading', { percent: (p && p.percent != null) ? p.percent : 0 });
});
window.deck.onUpdateDownloaded(() => {
  updatePhase = 'downloaded';
  updateBtn.textContent = t('update.install');
});
window.deck.onUpdateError(onUpdateError);
updateBtn.addEventListener('click', onUpdateClick);
$('#update-dismiss').addEventListener('click', () => { updateToast.hidden = true; });
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
      const tag = document.createElement('span');
      tag.className = 'preset-row-tag'; tag.textContent = t('presets.builtin');
      li.appendChild(tag);
    } else {
      const edit = document.createElement('button');
      edit.type = 'button'; edit.className = 'ghost-btn'; edit.textContent = t('common.edit');
      edit.addEventListener('click', () => startPresetEdit(key));
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'ghost-btn'; del.textContent = t('common.delete');
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
  presetSubmitBtn.textContent = t('common.save');
  presetCancelBtn.hidden = false;
  presetFormMsg.hidden = true;
  presetLabelInput.focus();
}
function deletePreset(key) {
  const c = customPresets.find((p) => p.key === key);
  if (!c) return;
  if (!confirm(t('presets.confirmDelete', { label: c.label }))) return;
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
  // repos are loaded and the schedule:fire handler (08) is registered — tell main
  // it may deliver scheduled launches (it queues window creation on this signal)
  try { window.deck.scheduleReady(); } catch (_) {}
})();
