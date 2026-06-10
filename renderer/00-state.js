'use strict';

/* Presets. Built-ins live in lib/presets.js; user-defined presets are merged
 * in from localStorage (custom list only). `cmd` is auto-typed + run on start. */
const Presets = window.Presets;
let customPresets = loadCustomPresets();
let PRESETS = Presets.merge(customPresets);

function loadCustomPresets() {
  try { return Presets.normalizeCustom(JSON.parse(localStorage.getItem(Presets.KEY) || '[]')); }
  catch (_) { return []; }
}
function saveCustomPresets() {
  try { localStorage.setItem(Presets.KEY, JSON.stringify(customPresets)); } catch (_) {}
}

const TERM_THEME = {
  background: '#0c0d10', foreground: '#e6e8ee', cursor: '#f0883e',
  cursorAccent: '#0c0d10', selectionBackground: '#33384a',
  black: '#1b1e25', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
  blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
  brightBlack: '#5b616d', brightRed: '#e06c75', brightGreen: '#98c379',
  brightYellow: '#ffb454', brightBlue: '#61afef', brightMagenta: '#c678dd',
  brightCyan: '#56b6c2', brightWhite: '#e6e8ee',
};

const ATTENTION_IDLE_MS = 6000; // 出力が止まってこの時間で「入力待ち」とみなす

/** @type {Map<string, object>} */
const sessions = new Map();
const FitAddonCtor = (window.FitAddon && window.FitAddon.FitAddon) || window.FitAddon;

const $ = (s) => document.querySelector(s);
const presetSel = $('#preset');
const commandInput = $('#command');
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
const layoutSwitchEl = $('#layout-switch');
const restoreBtnEl = $('#restore-deck');
const paletteEl = $('#palette');
const paletteInput = $('#palette-input');
const paletteList = $('#palette-list');
const emptyTitleEl = $('#empty h2');
const emptyDescEl = $('#empty p');
const EMPTY_DEFAULT_TITLE = emptyTitleEl ? emptyTitleEl.textContent : 'No agents running';
const EMPTY_DEFAULT_DESC = emptyDescEl ? emptyDescEl.innerHTML : '';

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
