'use strict';

/* Presets. Built-ins live in lib/presets.js; user-defined presets are merged
 * in from localStorage (custom list only). `cmd` is auto-typed + run on start;
 * `init` (post-launch commands, kept per preset key in a separate map) is typed
 * into the agent once it has booted. */
const Presets = window.Presets;
let customPresets = loadCustomPresets();
let presetInit = loadPresetInit();
let presetOverrides = loadPresetOverrides();
let PRESETS = Presets.merge(customPresets, presetInit, presetOverrides);

function loadCustomPresets() {
  try { return Presets.normalizeCustom(JSON.parse(localStorage.getItem(Presets.KEY) || '[]')); }
  catch (_) { return []; }
}
function saveCustomPresets() {
  try { localStorage.setItem(Presets.KEY, JSON.stringify(customPresets)); } catch (_) {}
}
function loadPresetInit() {
  try {
    const map = Presets.normalizeInitMap(JSON.parse(localStorage.getItem(Presets.KEY_INIT) || '{}'));
    // drop init for keys that are neither a built-in nor a surviving custom preset
    // (e.g. a custom preset normalizeCustom silently dropped) so the map self-heals
    // instead of accumulating dead keys; the next savePresetInit() persists the prune
    for (const key of Object.keys(map)) {
      if (!Presets.isBuiltin(key) && !customPresets.some((p) => p.key === key)) delete map[key];
    }
    return map;
  } catch (_) { return {}; }
}
function savePresetInit() {
  try { localStorage.setItem(Presets.KEY_INIT, JSON.stringify(presetInit)); } catch (_) {}
}
/* Edits to the built-in presets (base command / per-profile arguments). Stored
 * apart from the built-in table so "reset to default" is a deletion and the
 * defaults are always recoverable — and so an older build, which never reads
 * this key, simply sees the stock presets instead of breaking. */
function loadPresetOverrides() {
  try {
    return Presets.normalizeOverrides(
      JSON.parse(localStorage.getItem(Presets.KEY_OVERRIDES) || '{}'),
      customPresets.map((p) => p.key),
    );
  } catch (_) { return {}; }
}
function savePresetOverrides() {
  try { localStorage.setItem(Presets.KEY_OVERRIDES, JSON.stringify(presetOverrides)); } catch (_) {}
}
/** The command a launch will actually type, for a preset + profile. */
function commandFor(presetKey, profileId) {
  return Presets.resolveCommand(presetKey, profileId, PRESETS, presetOverrides);
}
/** Whether that command hands the agent unattended write/exec authority. */
function profileIsDangerous(presetKey, profileId) {
  return Presets.isDangerous(presetKey, profileId, PRESETS, presetOverrides);
}
/** Translated name of a profile. Built by concatenation rather than a literal so
 *  the i18n parity guard (which only scans static t('…') literals) is not fed a
 *  half-key; the keys themselves are asserted to exist by profile-key coverage. */
function profileLabel(profileId) {
  const key = 'profile.' + (profileId || Presets.DEFAULT_PROFILE);
  return I18n.DICT[key] ? t(key) : String(profileId || '');
}

/**
 * Read a resolved color out of the PULSE stylesheet.
 *
 * xterm paints to a canvas, so it needs a literal color rather than a CSS
 * variable. Reading the variable back at startup is what keeps the terminal's
 * frame in step with the rest of the chrome without Agent Deck restating a hue
 * the design system already owns.
 *
 * Custom properties compute with `var()` already substituted, so this returns a
 * literal. If that ever stops being true the value would be a string xterm
 * silently ignores, leaving the terminal on its own defaults — so say so.
 */
function pulseColor(name) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  if (!/^(#|rgb|hsl|color\()/.test(value)) {
    console.warn(`[agentdeck] ${name} did not resolve to a color: "${value}"`);
  }
  return value;
}

/**
 * The terminal's own theme.
 *
 * Chrome (background / foreground / cursor / selection) follows PULSE. The
 * ANSI 16 deliberately do NOT: they are a terminal contract, not app styling —
 * a program emitting ANSI 1 means "error" and ANSI 2 means "success", and users
 * read them against decades of muscle memory. A design system governs the frame
 * around the terminal, not the meaning of the bytes inside it.
 */
const TERM_THEME = {
  background: pulseColor('--pulse-color-bg'),
  foreground: pulseColor('--pulse-color-fg'),
  // The brand role is a fill meant to carry white text; xterm paints the cursor
  // as a block and draws the character under it in cursorAccent, so the pair has
  // to read the other way round — brand-600 against the terminal background is
  // 3.5:1 and the glyph inside it is barely there. The on-dark brand step is
  // 7.5:1, which also keeps the cursor distinct from ANSI blue output.
  cursor: pulseColor('--pulse-color-brand-active'),
  cursorAccent: pulseColor('--pulse-color-bg'),
  selectionBackground: pulseColor('--pulse-color-neutral-700'),
  black: '#1b1e25', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
  blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
  brightBlack: '#5b616d', brightRed: '#e06c75', brightGreen: '#98c379',
  brightYellow: '#ffb454', brightBlue: '#61afef', brightMagenta: '#c678dd',
  brightCyan: '#56b6c2', brightWhite: '#e6e8ee',
};

// 入力待ち判定の閾値は lib/attention.js の THRESHOLDS_MS（末尾分類ごとに可変）

/** @type {Map<string, object>} */
const sessions = new Map();
const FitAddonCtor = (window.FitAddon && window.FitAddon.FitAddon) || window.FitAddon;

const $ = (s) => document.querySelector(s);
const presetSel = $('#preset');
const profileSel = $('#profile');
const commandInput = $('#command');
const dangerHint = $('#danger-hint');
const launchPopover = $('#launch-popover');
const profileMenu = $('#profile-menu');
const agentChipsEl = $('#agent-chips');
const nameInput = $('#name');
const cwdInput = $('#cwd');
const wtEnable = $('#wt-enable');
const wtBranch = $('#wt-branch');
const repoHint = $('#repo-hint');
const grid = $('#grid');
const emptyState = $('#empty');
const countEl = $('#count');
const sysInfoEl = $('#sys-info');
const repoListEl = $('#repo-list');
const repoEmptyEl = $('#repo-empty');
const repoMsgEl = $('#repo-msg');
const launchBtn = $('#launch');
const stageFilterEl = $('#stage-filter');
const stageFilterLabel = $('#stage-filter-label');
const stageAllBtn = $('#stage-all');
const stateFilterEl = $('#state-filter');
const layoutSwitchEl = $('#layout-switch');
const restoreBtnEl = $('#restore-deck');
const paletteEl = $('#palette');
const paletteInput = $('#palette-input');
const paletteList = $('#palette-list');
const emptyTitleEl = $('#empty-title');
const emptyDescEl = $('#empty-desc');

// diff drawer refs
const diffOverlay = $('#diff-overlay');
const diffName = $('#diff-name');
const diffBranch = $('#diff-branch');
const diffMeta = $('#diff-meta');
const diffBody = $('#diff-body');
const diffMerge = $('#diff-merge');
const diffPr = $('#diff-pr');
const diffFilesBar = $('#diff-files');
const diffFileList = $('#diff-file-list');
let diffSessionId = null;

let seq = 0;
let activeSessionId = null;
let windowFocused = true;

/** Registered repositories (persisted in main). @type {Array<{id,path,name,isRepo,branch}>} */
let repos = [];
let activeRepoId = null;
let homeDir = '';
/** Synthetic, always-pinned "Home" entry so CLIs can run in the home directory
 *  without registering a repo (e.g. operating on the whole computer). Not persisted. */
let homeRepo = null;

window.addEventListener('focus', () => { windowFocused = true; });
window.addEventListener('blur', () => { windowFocused = false; });

/* Share the path-normalisation logic with main (lib/repos.js, loaded via <script>)
   so repo ids computed here and in the main process can never drift. */
const Repos = window.Repos;
const GitStat = window.GitStat;
const Layout = window.Layout;
const Workspace = window.Workspace;
const Fuzzy = window.Fuzzy;
const Hooks = window.Hooks;

/** True when a drag carries actual files (rather than text or an internal pane drag). */
function hasFiles(e) {
  const dt = e && e.dataTransfer;
  if (!dt) return false;
  // `types` is the only thing readable during dragover; `files` is empty until drop
  return Array.prototype.includes.call(dt.types || [], 'Files');
}

// ---- i18n (ja / en) ---------------------------------------------------------
// Every user-facing string is keyed in lib/i18n.js; t(key, params) returns the
// current language. Static markup carries data-i18n / data-i18n-ph / data-i18n-title;
// applyI18n() fills them. Dynamic strings call t() at render time.
const I18n = window.I18n;
const LANG_KEY = 'agentdeck.lang';
const t = (key, params) => I18n.t(key, params);
function initLang() {
  let saved = null;
  try { saved = localStorage.getItem(LANG_KEY); } catch (_) {}
  const lang = (saved && I18n.langs().indexOf(saved) !== -1)
    ? saved : I18n.resolveLocale((navigator && navigator.language) || 'en');
  I18n.setLang(lang);
  document.documentElement.lang = lang;
  return lang;
}
/** Fill every translatable node under root (default: document) for the current language. */
function applyI18n(root) {
  const r = root || document;
  for (const el of r.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of r.querySelectorAll('[data-i18n-ph]')) el.setAttribute('placeholder', t(el.dataset.i18nPh));
  for (const el of r.querySelectorAll('[data-i18n-title]')) el.setAttribute('title', t(el.dataset.i18nTitle));
  for (const el of r.querySelectorAll('[data-i18n-aria-label]')) el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
}
function setKbdHint() {
  const el = $('#kbd-hint');
  if (el) el.textContent = t(IS_MAC ? 'hint.kbdMac' : 'hint.kbdOther');
  const kbd = $('#search-kbd');
  if (kbd) kbd.textContent = IS_MAC ? '⌘K' : 'Ctrl+Shift+K';
}
function setDayChipLabels() {
  const labels = I18n.weekdayLabels(); // index by getDay (0=Sun)
  for (const b of document.querySelectorAll('#sched-days .day-chip')) b.textContent = labels[Number(b.dataset.day)];
}
/** Switch language live: persist, re-fill static markup, and refresh the dynamic
 *  chrome that's already on screen (toasts etc. pick up the new language next time). */
function setLanguage(lang) {
  if (I18n.langs().indexOf(lang) === -1) return;
  try { localStorage.setItem(LANG_KEY, lang); } catch (_) {}
  I18n.setLang(lang);
  document.documentElement.lang = lang;
  if (langSwitch) langSwitch.value = lang; // keep the selector in sync on programmatic calls
  applyI18n();
  setKbdHint();
  setDayChipLabels();
  updateCount();
  updateLaunchLabel();
  refreshRepoHint();
  renderRepos();           // sidebar + empty state
  updateWaitingTitle();    // document.title
  // 08-schedules.js loads after 07, and boot() populates the preset select before
  // its first await — so setLanguage() can genuinely run before 08 has executed.
  if (typeof renderSchedList === 'function') renderSchedList();
  // chips and the profile <select> carry translated labels built in JS, so they
  // have to be rebuilt here — applyI18n() only refills data-i18n markup
  if (typeof buildAgentChips === 'function') buildAgentChips();
  if (typeof setProfile === 'function') setProfile(currentProfileId);
  if (typeof renderPresetList === 'function') renderPresetList();
  if (typeof refreshPresetFormChrome === 'function') refreshPresetFormChrome(); // re-apply edit-mode title/button text
}
initLang();
applyI18n(); // static chrome is in the DOM already (scripts load at body end)
setDayChipLabels();
const langSwitch = $('#lang-switch');
if (langSwitch) {
  langSwitch.value = I18n.getLang();
  langSwitch.addEventListener('change', () => setLanguage(langSwitch.value));
}
