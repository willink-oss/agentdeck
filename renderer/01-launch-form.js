'use strict';

// ---- form init -------------------------------------------------------------
function buildPresetOptions() {
  presetSel.innerHTML = '';
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
  host.innerHTML = '';
  for (const key of Presets.chipKeys(customPresets)) {
    const chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'chip'; chip.textContent = PRESETS[key].label;
    chip.addEventListener('click', () => launch({ presetKey: key, command: PRESETS[key].cmd }));
    host.appendChild(chip);
  }
}
/** Re-merge + redraw the select and chips after a custom-preset change, keeping
 *  the user's current selection (and typed command) when it still exists. */
function rebuildPresetUI() {
  PRESETS = Presets.merge(customPresets);
  const prevKey = presetSel.value;
  const prevCmd = commandInput.value;
  buildPresetOptions(); // resets the selection to the claude default
  if (PRESETS[prevKey]) { presetSel.value = prevKey; commandInput.value = prevCmd; }
  buildQuickChips();
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
