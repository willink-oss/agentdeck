'use strict';

/* Two ways to start a session, deliberately.
 *
 * The chip bar over the stage is the common case: pick an agent, it launches in
 * the repository you have selected. Its caret opens the profile menu when the
 * plain launch is not what you want.
 *
 * The popover is everything else — a name, a different directory, worktree
 * isolation. It holds the same form that used to sit permanently in the
 * sidebar; keeping it on screen full time cost a column of density for controls
 * most launches never touch.
 */

// ---- form init -------------------------------------------------------------
function buildPresetOptions() {
  presetSel.innerHTML = '';
  for (const [key, p] of Object.entries(PRESETS)) {
    const opt = document.createElement('option');
    opt.value = key; opt.textContent = p.label;
    presetSel.appendChild(opt);
  }
  presetSel.value = 'claude';
  setProfile(Presets.DEFAULT_PROFILE);
}

/** Which profile the launch form is set to. The command field stays the source
 *  of truth for what runs; this records the choice so a restored deck can name it. */
let currentProfileId = Presets.DEFAULT_PROFILE;

/** Refill the profile <select> for the currently selected agent. */
function buildProfileOptions() {
  const key = presetSel.value;
  profileSel.innerHTML = '';
  for (const p of Presets.profilesFor(key)) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = profileLabel(p.id) + (p.danger ? ' ⚠' : '');
    profileSel.appendChild(opt);
  }
  profileSel.disabled = profileSel.options.length <= 1;
}

/** Point the form at a profile: remember it, refill the command, flag the risk. */
function setProfile(id) {
  const key = presetSel.value;
  const known = Presets.profilesFor(key).some((p) => p.id === id);
  currentProfileId = known ? id : Presets.DEFAULT_PROFILE;
  buildProfileOptions();
  profileSel.value = currentProfileId;
  commandInput.value = commandFor(key, currentProfileId);
  refreshDangerHint();
}

/** Show the warning under the command field whenever what is typed there would
 *  run unattended — including a flag the user pasted in by hand. */
function refreshDangerHint() {
  const risky = Presets.looksDangerous(commandInput.value);
  dangerHint.hidden = !risky;
  commandInput.classList.toggle('is-danger', risky);
}

// ---- agent chips (stage toolbar) -------------------------------------------
/** One chip per agent: the body launches, the caret opens the profile menu. */
function buildAgentChips() {
  agentChipsEl.innerHTML = '';
  for (const key of Presets.chipKeys(customPresets)) {
    const preset = PRESETS[key];
    if (!preset) continue;
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.dataset.preset = key;

    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'chip-go';
    go.textContent = preset.label;
    go.addEventListener('click', () => launch({ presetKey: key, profileId: Presets.DEFAULT_PROFILE }));

    const caret = document.createElement('button');
    caret.type = 'button';
    caret.className = 'chip-caret';
    caret.textContent = '▾';
    caret.setAttribute('aria-haspopup', 'menu');
    caret.setAttribute('aria-label', t('chip.profileMenu', { agent: preset.label }));
    caret.addEventListener('click', (e) => { e.stopPropagation(); openProfileMenu(key, caret); });

    chip.append(go, caret);
    agentChipsEl.appendChild(chip);
    // only the plain-launch half carries the destination tooltip
    chip._go = go;
  }
  refreshChipTitles();
}

/** Chip tooltips name where a launch would land, which changes with the repo filter. */
function refreshChipTitles() {
  const repo = activeRepoId ? findEff(activeRepoId) : null;
  for (const chip of agentChipsEl.querySelectorAll('.chip')) {
    const preset = PRESETS[chip.dataset.preset];
    if (!preset || !chip._go) continue;
    chip._go.title = repo
      ? t('chip.launchIn', { agent: preset.label, repo: repo.name })
      : t('chip.launchHome', { agent: preset.label });
  }
}

// ---- profile menu ----------------------------------------------------------
let profileMenuKey = null;

function openProfileMenu(key, anchor) {
  const preset = PRESETS[key];
  if (!preset) return;
  profileMenuKey = key;
  profileMenu.innerHTML = '';
  for (const p of Presets.profilesFor(key)) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'pm-item' + (p.danger ? ' is-danger' : '');
    item.setAttribute('role', 'menuitem');

    const label = document.createElement('span');
    label.className = 'pm-label';
    label.textContent = profileLabel(p.id);
    item.appendChild(label);

    if (p.danger) {
      const tag = document.createElement('span');
      tag.className = 'pm-danger';
      tag.textContent = t('profile.danger');
      item.appendChild(tag);
    }
    const cmd = document.createElement('span');
    cmd.className = 'pm-cmd';
    cmd.textContent = commandFor(key, p.id) || '(shell)';
    item.appendChild(cmd);

    item.addEventListener('click', () => {
      closeProfileMenu();
      launch({ presetKey: key, profileId: p.id });
    });
    profileMenu.appendChild(item);
  }
  profileMenu.hidden = false;
  positionProfileMenu(anchor);
  const first = profileMenu.querySelector('.pm-item');
  if (first) first.focus();
}

/** Anchor under the caret, clamped so a chip near the right edge stays on screen. */
function positionProfileMenu(anchor) {
  const box = anchor.getBoundingClientRect();
  const menu = profileMenu.getBoundingClientRect();
  const left = Math.max(6, Math.min(box.left, window.innerWidth - menu.width - 6));
  const top = Math.min(box.bottom + 4, window.innerHeight - menu.height - 6);
  profileMenu.style.left = left + 'px';
  profileMenu.style.top = Math.max(6, top) + 'px';
}

function closeProfileMenu() {
  profileMenu.hidden = true;
  profileMenuKey = null;
}

// ---- launch popover --------------------------------------------------------
function openLaunchPopover() {
  launchPopover.hidden = false;
  refreshDangerHint();
  // the agent is the first decision, so start there rather than in a text field
  presetSel.focus();
}
function closeLaunchPopover() {
  launchPopover.hidden = true;
}
function toggleLaunchPopover() {
  if (launchPopover.hidden) openLaunchPopover(); else closeLaunchPopover();
}

/** Re-merge + redraw after a preset change, keeping the current selection (and
 *  typed command) when it still exists. */
function rebuildPresetUI() {
  PRESETS = Presets.merge(customPresets, presetInit, presetOverrides);
  const prevKey = presetSel.value;
  const prevProfile = currentProfileId;
  const prevCmd = commandInput.value;
  buildPresetOptions(); // resets the selection to the claude default
  if (PRESETS[prevKey]) {
    presetSel.value = prevKey;
    setProfile(prevProfile);
    commandInput.value = prevCmd;
    refreshDangerHint();
  }
  buildAgentChips();
}

// switching agent resets to that agent's default profile — a "plan" carried over
// from another CLI would silently mean a different flag, or none at all
presetSel.addEventListener('change', () => setProfile(Presets.DEFAULT_PROFILE));
profileSel.addEventListener('change', () => setProfile(profileSel.value));
commandInput.addEventListener('input', refreshDangerHint);
wtEnable.addEventListener('change', () => { wtBranch.disabled = !wtEnable.checked; if (wtEnable.checked) wtBranch.focus(); });

$('#browse').addEventListener('click', async () => {
  const dir = await window.deck.openDir();
  if (dir) { cwdInput.value = dir; refreshRepoHint(); }
});
cwdInput.addEventListener('change', refreshRepoHint);

$('#new-session').addEventListener('click', toggleLaunchPopover);
$('#lp-close').addEventListener('click', closeLaunchPopover);
$('#lp-backdrop').addEventListener('click', closeLaunchPopover);
$('#sidebar-search').addEventListener('click', () => openPalette());

// a click anywhere else dismisses the anchored profile menu
window.addEventListener('click', () => { if (!profileMenu.hidden) closeProfileMenu(); });
profileMenu.addEventListener('click', (e) => e.stopPropagation());
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!profileMenu.hidden) { e.preventDefault(); e.stopPropagation(); closeProfileMenu(); }
  else if (!launchPopover.hidden) { e.preventDefault(); e.stopPropagation(); closeLaunchPopover(); }
}, true);

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
$('#launch-form').addEventListener('submit', (e) => {
  e.preventDefault();
  closeLaunchPopover();
  launch(currentLaunchOpts());
});
