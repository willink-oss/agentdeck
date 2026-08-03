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
    // a quick chip is deliberately the plain launch — no profile, no surprises
    chip.addEventListener('click', () => launch({ presetKey: key, profileId: Presets.DEFAULT_PROFILE }));
    host.appendChild(chip);
  }
}

/** Which profile the launch form is currently set to. The command field stays
 *  the source of truth for what runs; this records the user's choice so the
 *  restored deck can name it. */
let currentProfileId = Presets.DEFAULT_PROFILE;
/** Point the form at a profile: remember it and refill the command field. */
function setProfile(id) {
  const key = presetSel.value;
  const known = Presets.profilesFor(key).some((p) => p.id === id);
  currentProfileId = known ? id : Presets.DEFAULT_PROFILE;
  commandInput.value = commandFor(key, currentProfileId);
}
/** Re-merge + redraw the select and chips after a custom-preset change, keeping
 *  the user's current selection (and typed command) when it still exists. */
function rebuildPresetUI() {
  PRESETS = Presets.merge(customPresets, presetInit, presetOverrides);
  const prevKey = presetSel.value;
  const prevCmd = commandInput.value;
  buildPresetOptions(); // resets the selection to the claude default
  if (PRESETS[prevKey]) { presetSel.value = prevKey; commandInput.value = prevCmd; }
  buildQuickChips();
}

// switching agent resets to that agent's default profile — a "plan" carried over
// from another CLI would silently mean a different flag, or none at all
presetSel.addEventListener('change', () => setProfile(Presets.DEFAULT_PROFILE));
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
    repoHint.textContent = repo ? t('form.isRepo') : t('form.notRepo');
    repoHint.className = 'field-hint ' + (repo ? 'is-repo' : 'no-repo');
  } catch (_) { repoHint.textContent = ''; }
}

/** Read the launch form into a launch() options object (optional cwd override).
 *  `command` is passed verbatim: the field is freely editable, so whatever is in
 *  it wins over the profile — but `profileId` still records which variant the
 *  user picked, so a restored deck can show it. */
function currentLaunchOpts(cwdOverride) {
  return {
    presetKey: presetSel.value,
    command: commandInput.value,
    profileId: currentProfileId,
    name: nameInput.value.trim(),
    cwd: (cwdOverride != null ? cwdOverride : cwdInput.value.trim()),
    worktree: wtEnable.checked,
    branch: wtBranch.value.trim(),
  };
}
$('#launch-form').addEventListener('submit', (e) => { e.preventDefault(); launch(currentLaunchOpts()); });
