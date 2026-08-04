'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const https = require('https');
const { execFile } = require('child_process');
const { promisify } = require('util');
const pty = require('node-pty');
const { defaultShell, sanitizeBranch, worktreeFolderName, isFullCommitHash } = require('./lib/git-utils');
const Repos = require('./lib/repos');
const GitStat = require('./lib/gitstat');
const Version = require('./lib/version');
const Schedule = require('./lib/schedule');
const { createValidateWorktreeIdentity } = require('./lib/worktree-identity');
const { createSessionMerge } = require('./lib/session-merge');
const { createLogger } = require('./lib/logger');
const Hooks = require('./lib/hooks');
const http = require('http');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');

const pexec = promisify(execFile);

/** @type {Map<string, import('node-pty').IPty>} */
const ptys = new Map();
/** Authoritative Git metadata keyed by the renderer's opaque session id. Paths,
 *  refs, and bases in privileged Git IPC are read only from this map. */
const gitContexts = new Map();

const shellForHost = () => defaultShell(process.platform, process.env);

/* Lifecycle log under userData (never terminal contents, never transmitted).
 * app.getPath() needs the app to be ready, so the logger is created lazily and
 * every call site can just use log.* without ordering concerns. */
let logger = null;
function logFile() { return path.join(app.getPath('userData'), 'agentdeck.log'); }
const log = new Proxy({}, {
  get(_t, method) {
    return (...args) => {
      try {
        if (!logger) logger = createLogger({ file: logFile(), fs });
        const fn = logger[method];
        if (typeof fn === 'function') fn(...args);
      } catch (_) { /* logging must never be the thing that breaks */ }
    };
  },
});

// ---- git helpers -----------------------------------------------------------
async function git(args, cwd) {
  const { stdout } = await pexec('git', args, { cwd, maxBuffer: 1024 * 1024 * 32 });
  return stdout;
}
async function isRepo(dir) {
  try { await git(['rev-parse', '--is-inside-work-tree'], dir); return true; }
  catch (_) { return false; }
}
async function repoRoot(dir) { return (await git(['rev-parse', '--show-toplevel'], dir)).trim(); }
async function headSha(dir) { return (await git(['rev-parse', 'HEAD'], dir)).trim(); }
async function currentBranch(dir) {
  try { return (await git(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).trim(); }
  catch (_) { return ''; }
}

/** Resolve an existing path through symlinks/case aliases. All worktree restore
 *  metadata originates in renderer localStorage, so paths are untrusted until
 *  they have passed this main-process canonicalisation. */
function canonicalPath(dir) {
  try {
    // The native resolver expands Windows 8.3 aliases (RUNNER~1) to the same
    // final path as their long form. The JS resolver can preserve the alias,
    // which breaks repository affinity even though both names are one directory.
    const resolveRealPath = fs.realpathSync.native || fs.realpathSync;
    return Repos.normalizePath(resolveRealPath(String(dir || '')));
  }
  catch (_) { return ''; }
}
function pathKey(dir) {
  const p = Repos.normalizePath(dir).replace(/\\/g, '/');
  return process.platform === 'win32' ? p.toLowerCase() : p;
}
function samePath(a, b) { return !!a && !!b && pathKey(a) === pathKey(b); }
async function commonGitDir(dir) {
  const raw = (await git(['rev-parse', '--git-common-dir'], dir)).trim();
  return canonicalPath(path.isAbsolute(raw) ? raw : path.resolve(dir, raw));
}
async function commitExists(dir, sha) {
  if (!isFullCommitHash(sha)) return false;
  try { await git(['cat-file', '-e', `${sha}^{commit}`], dir); return true; }
  catch (_) { return false; }
}

/** Re-establish the identity of a saved worktree using live Git state. This is
 *  also called immediately before merge/PR, so stale or renderer-forged metadata
 *  can never select a different repository or branch for a destructive action.
 *  The twelve rejection paths live in lib/worktree-identity.js so they can be
 *  unit-tested against injected Git state; the I/O helpers stay here. */
const validateWorktreeIdentity = createValidateWorktreeIdentity({
  canonicalPath, samePath, isRepo, repoRoot, currentBranch, commonGitDir,
  headSha, git, parseWorktreeList: GitStat.parseWorktreeList, commitExists, isFullCommitHash,
});

/** Resolve a canonical cwd to the most specific registered repository while
 *  preserving the registry's public id/path spelling (e.g. /var vs /private/var). */
function registeredRepoIdFor(dir) {
  const target = canonicalPath(dir);
  if (!target) return '';
  let best = '', bestLen = -1;
  for (const repo of loadRepos()) {
    const base = canonicalPath(repo && (repo.path || repo.id));
    if (!base) continue;
    const t = pathKey(target), b = pathKey(base);
    const owns = t === b || (b === '/' ? t.startsWith('/') : t.startsWith(b + '/'));
    if (owns && b.length > bestLen) { best = repo.id; bestLen = b.length; }
  }
  return best;
}

// ---- repository registry (persisted under userData) ------------------------
function reposFile() { return path.join(app.getPath('userData'), 'repos.json'); }
function loadRepos() {
  try { const v = JSON.parse(fs.readFileSync(reposFile(), 'utf8')); return Array.isArray(v) ? v : []; }
  catch (_) { return []; }
}
// Atomic write (temp + rename) so a crash mid-write can't corrupt the registry.
// Throws on failure so callers can surface it instead of a phantom success.
function saveRepos(list) {
  const file = reposFile();
  const tmp = file + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch (_) {} // don't leave a stray temp behind
    throw err;
  }
}

// ---- scheduled launches (persisted under userData) --------------------------
function schedulesFile() { return path.join(app.getPath('userData'), 'schedules.json'); }
function loadSchedules() {
  // normalize() drops malformed entries, so one corrupt record can't break loading.
  try { return Schedule.normalize(JSON.parse(fs.readFileSync(schedulesFile(), 'utf8'))); }
  catch (_) { return []; }
}
// Same atomic write as saveRepos: a crash mid-write can't corrupt the file.
function saveSchedules(list) {
  const file = schedulesFile();
  const tmp = file + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch (_) {}
    throw err;
  }
}

const GIT_INFO_TTL = 4000;
const gitInfoCache = new Map(); // path -> { at, info }
async function safeGit(args, cwd) { try { return await git(args, cwd); } catch (_) { return ''; } }

/** Merge / PR preconditions + conflict-safe merge (lib/session-merge.js). */
const sessionMerge = createSessionMerge({ git, safeGit, currentBranch });
async function worktreeStat(dir) {
  return GitStat.parseNumstat(await safeGit(['diff', '--numstat', 'HEAD'], dir));
}
async function gitInfoFor(dir) {
  const hit = gitInfoCache.get(dir);
  if (hit && (Date.now() - hit.at) < GIT_INFO_TTL) return hit.info;
  let info;
  try {
    if (!(await isRepo(dir))) {
      info = { isRepo: false, branch: '', stat: null, worktrees: [] };
    } else {
      const branch = await currentBranch(dir);
      const stat = await worktreeStat(dir);
      let root = dir;
      try { root = (await repoRoot(dir)) || dir; } catch (_) {}
      const rootNorm = Repos.normalizePath(root);
      const wts = GitStat.parseWorktreeList(await safeGit(['worktree', 'list', '--porcelain'], root))
        .filter((w) => !w.bare && Repos.normalizePath(w.path) !== rootNorm);
      const worktrees = await Promise.all(wts.map(async (w) => ({
        path: w.path,
        branch: w.detached ? '' : w.branch,
        isAgentdeck: GitStat.isAgentdeckWorktreePath(w.path),
        stat: await worktreeStat(w.path),
      })));
      info = { isRepo: true, branch, stat, worktrees };
    }
  } catch (_) { info = { isRepo: false, branch: '', stat: null, worktrees: [] }; }
  gitInfoCache.set(dir, { at: Date.now(), info });
  return info;
}
async function enrichRepos(list) {
  return Promise.all(list.map(async (r) => ({
    ...r, realPath: canonicalPath(r.path) || r.path, ...(await gitInfoFor(r.path)),
  })));
}

// ---- window ----------------------------------------------------------------
function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 900, minHeight: 600,
    backgroundColor: '#0c0d10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  // The deck is a single local page for its whole lifetime. Anything that would
  // replace it — a dropped file/folder (Chromium navigates to file:// by default),
  // a stray link, window.open — would tear down every live terminal with it, so
  // navigation is denied outright. External URLs go through update:open, which
  // validates them before handing them to the OS browser.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });
  win.webContents.on('will-frame-navigate', (e) => {
    if (!e.isMainFrame) e.preventDefault();
  });
  attachCloseGuard(win);
  attachCrashReap(win);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  return win;
}

/* If the renderer dies, every PTY it was driving keeps running with nothing
 * attached to it: an agent that carries on spending tokens and editing the
 * repository while nobody can see or stop it. The session ids only exist in the
 * dead renderer, so there is no recovering the deck — reap the processes and
 * let the reloaded window start clean. */
function attachCrashReap(win) {
  win.webContents.on('render-process-gone', (_e, details) => {
    const reason = (details && details.reason) || 'unknown';
    log.error('renderer.gone', { reason, ptys: ptys.size });
    if (reason === 'clean-exit') return; // ordinary teardown, ptys already closed
    reapAllPtys('renderer-gone');
  });
  win.webContents.on('unresponsive', () => log.warn('renderer.unresponsive', { ptys: ptys.size }));
  win.webContents.on('responsive', () => log.info('renderer.responsive'));
}

// ---- hook listener ---------------------------------------------------------
/* Agents report their own state here (permission needed, turn finished) instead
 * of us inferring it from terminal output. See lib/hooks.js for the protocol and
 * the reasoning about what a local listener has to refuse.
 *
 * Bound to loopback on an ephemeral port, started on first use and never
 * advertised. Each session gets its own token; an event naming a session that is
 * not live, or carrying the wrong token, is indistinguishable from a 404. */
/** agentdeck session id -> { token, settingsPath } */
const hookTokens = new Map();
let hookServer = null;
let hookPort = 0;

function hookLookup(sessionId) {
  const entry = hookTokens.get(sessionId);
  return entry ? entry.token : null;
}

function startHookServer() {
  if (hookServer) return Promise.resolve(hookPort);
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const reply = (code) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end('{}'); };
      let auth;
      try { auth = Hooks.authorize({ method: req.method, pathname: req.url, lookup: hookLookup }); }
      catch (err) { log.fail('hook.authorizeFailed', err); reply(500); return; }
      if (!auth.ok) { reply(auth.code); return; }

      let body = '';
      let tooBig = false;
      req.on('data', (chunk) => {
        if (tooBig) return;
        body += chunk;
        // a hook payload carries a transcript PATH, not a transcript
        if (body.length > Hooks.MAX_BODY_BYTES) { tooBig = true; body = ''; req.destroy(); }
      });
      req.on('error', () => {});
      req.on('end', () => {
        if (tooBig) { log.warn('hook.bodyTooLarge', { id: auth.sessionId }); return; }
        const evt = Hooks.normalizeEvent(body);
        // Always 200: a non-2xx is a non-blocking error on the agent's side, but
        // there is no reason to make it retry an event we simply do not act on.
        reply(200);
        if (!evt) return;
        const win = liveWindow();
        if (win) win.webContents.send('hook:event', { id: auth.sessionId, event: evt.event, state: evt.state });
      });
    });
    server.on('error', (err) => { log.fail('hook.serverFailed', err); resolve(0); });
    // 127.0.0.1 explicitly, not localhost: no DNS, no accidental ::/0
    server.listen(0, '127.0.0.1', () => {
      hookServer = server;
      hookPort = server.address().port;
      log.info('hook.listening', { port: hookPort });
      resolve(hookPort);
    });
  });
}

/** Register a session and write the settings file its agent will be pointed at.
 *  Returns the path, or '' when hooks are unavailable for this launch. */
async function registerHooks(sessionId) {
  const port = await startHookServer();
  if (!port) return '';
  const token = crypto.randomBytes(Hooks.TOKEN_BYTES).toString('hex');
  const settings = Hooks.buildClaudeSettings({ url: Hooks.hookUrl({ port, sessionId, token }) });
  if (!settings) return '';
  const dir = path.join(app.getPath('userData'), 'hooks');
  const file = path.join(dir, `${sessionId}.json`);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    // 0600: the token lives here rather than in argv, where `ps` would show it
    fs.writeFileSync(file, JSON.stringify(settings), { mode: 0o600 });
  } catch (err) { log.fail('hook.settingsWriteFailed', err); return ''; }
  hookTokens.set(sessionId, { token, settingsPath: file });
  return file;
}

/** Forget a session's token and remove its settings file. */
function unregisterHooks(sessionId) {
  const entry = hookTokens.get(sessionId);
  if (!entry) return;
  hookTokens.delete(sessionId);
  try { fs.unlinkSync(entry.settingsPath); } catch (_) { /* already gone */ }
}

/** Kill every tracked PTY and forget its Git context. */
function reapAllPtys(why) {
  if (!ptys.size) return;
  log.warn('pty.reap', { why, count: ptys.size });
  for (const p of ptys.values()) { try { p.kill(); } catch (err) { log.fail('pty.killFailed', err); } }
  ptys.clear();
  gitContexts.clear();
}

// ---- close guard -----------------------------------------------------------
// Closing the window kills every PTY (see window-all-closed). On macOS that
// collides with the "closing the window keeps the app alive" convention, so a
// user who closes the deck out of habit silently loses every running agent.
// Ask first — but only when there is something to lose. The prompt is a
// renderer-side confirm() rather than a native dialog so it is translated by
// lib/i18n.js and stays scriptable from e2e like every other confirmation.
const CLOSE_CONFIRM_TIMEOUT_MS = 5000;
/** win.id -> { timer } while a confirmation is outstanding. */
const pendingClose = new Map();
/** win.id of windows the user has already agreed to close. */
const closeApproved = new Set();
/** Quitting (Cmd+Q, app.quit()) is an explicit "end everything" — only the
 *  window-close path carries the macOS ambiguity this guard exists for, and
 *  preventing a close mid-quit would abort the quit sequence. */
let appQuitting = false;
app.on('before-quit', () => { appQuitting = true; });

function attachCloseGuard(win) {
  win.on('close', (e) => {
    if (appQuitting || closeApproved.has(win.id) || ptys.size === 0) return;
    e.preventDefault();
    if (pendingClose.has(win.id)) return; // already asking
    // A wedged renderer must not make the window unclosable: fall through to a
    // normal close if the answer does not come back in time.
    const timer = setTimeout(() => resolveClose(win, true), CLOSE_CONFIRM_TIMEOUT_MS);
    pendingClose.set(win.id, { timer });
    try { win.webContents.send('app:confirm-close', { sessions: ptys.size }); }
    catch (_) { resolveClose(win, true); }
  });
  win.on('closed', () => {
    const p = pendingClose.get(win.id);
    if (p) clearTimeout(p.timer);
    pendingClose.delete(win.id);
    closeApproved.delete(win.id);
  });
}

function resolveClose(win, proceed) {
  const pending = pendingClose.get(win.id);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingClose.delete(win.id);
  if (!proceed || win.isDestroyed()) return;
  closeApproved.add(win.id);
  win.close();
}

ipcMain.on('app:close-decision', (e, { proceed } = {}) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) resolveClose(win, !!proceed);
});

app.whenReady().then(() => {
  createWindow();
  scheduleUpdateChecks();
  startScheduler();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  for (const p of ptys.values()) { try { p.kill(); } catch (_) {} }
  ptys.clear();
  gitContexts.clear();
  if (process.platform !== 'darwin') app.quit();
});

// Post-launch init timing. The startup command is typed STARTUP_DELAY_MS after
// spawn; any preset `init` commands (e.g. `/effort ultracode` for Claude) are
// typed only once the agent has finished booting. We detect "booted" as output
// going quiet for INIT_QUIET_MS — far more robust than a fixed delay across slow
// cold starts — bounded by INIT_MAX_WAIT_MS so we always fire eventually, and
// stagger multiple lines by INIT_STEP_MS so the REPL processes them in order.
const STARTUP_DELAY_MS = 700;
const INIT_QUIET_MS = 1200;
const INIT_STEP_MS = 450;
const INIT_MAX_WAIT_MS = 12_000;

// ---- IPC: spawn (with optional git worktree isolation) ---------------------
ipcMain.handle('pty:spawn', async (event, opts) => {
  const { id, cwd, shell, cols, rows, startupCommand, initCommands, worktree, restoreGit, hookBinary } = opts || {};
  const home = os.homedir();
  let effectiveCwd = cwd && cwd.trim() ? cwd : home;
  let gitMeta = null;

  try {
    if (worktree && worktree.enabled) {
      if (!(await isRepo(effectiveCwd))) {
        return { ok: false, error: 'Working directory is not a git repository (worktree isolation requires one).' };
      }
      const root = await repoRoot(effectiveCwd);
      const base = await headSha(root);
      const baseBranch = await currentBranch(root);
      const branch = sanitizeBranch(worktree.branch);
      const wtBase = path.join(path.dirname(root), '.agentdeck-worktrees');
      fs.mkdirSync(wtBase, { recursive: true });
      const wtPath = path.join(wtBase, worktreeFolderName(path.basename(root), branch));
      if (fs.existsSync(wtPath)) return { ok: false, error: `Worktree path already exists: ${wtPath}` };
      await git(['worktree', 'add', '-b', branch, wtPath, base], root);
      effectiveCwd = wtPath;
      gitMeta = { cwd: wtPath, baseSha: base, branch, baseBranch, worktree: wtPath, root };
    } else if (restoreGit && restoreGit.worktreePath) {
      const restored = await validateWorktreeIdentity({
        root: restoreGit.gitRoot, branch: restoreGit.branch, worktree: restoreGit.worktreePath,
        baseBranch: restoreGit.baseBranch, baseSha: restoreGit.baseSha, expectedCwd: effectiveCwd,
      });
      if (restored.ok) {
        effectiveCwd = restored.worktree;
        gitMeta = {
          cwd: restored.worktree, baseSha: restored.baseSha, branch: restored.branch,
          baseBranch: restored.baseBranch, worktree: restored.worktree, root: restored.root, restored: true,
          repoId: registeredRepoIdFor(restored.root),
        };
      } else {
        // Opening the shell remains safe/useful, but stale metadata must not
        // re-enable historical diff/merge/PR controls.
        const base = await headSha(effectiveCwd);
        gitMeta = {
          cwd: effectiveCwd, baseSha: base, branch: await currentBranch(effectiveCwd),
          worktree: null, restoreRejected: true,
        };
      }
    } else if (await isRepo(effectiveCwd)) {
      const base = await headSha(effectiveCwd);
      gitMeta = {
        cwd: effectiveCwd, baseSha: base, branch: await currentBranch(effectiveCwd), worktree: null,
        repoId: registeredRepoIdFor(effectiveCwd),
      };
    }
  } catch (err) {
    return { ok: false, error: 'git: ' + String(err && err.message ? err.message : err) };
  }

  let proc;
  try {
    proc = pty.spawn(shell || shellForHost(), [], {
      name: 'xterm-256color',
      cols: cols || 80, rows: rows || 24,
      cwd: effectiveCwd, env: process.env,
    });
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }

  ptys.set(id, proc);
  if (gitMeta) gitContexts.set(id, { ...gitMeta });
  const sender = event.sender;

  // Post-launch init: type the preset's `init` commands once the agent settles.
  const initLines = Array.isArray(initCommands)
    ? initCommands.map((s) => String(s == null ? '' : s)).filter((s) => s.trim())
    : [];
  let initSettleTimer = null;
  let initHardTimer = null;
  const initWriteTimers = [];
  let initDone = initLines.length === 0;
  const clearInitTimers = () => {
    clearTimeout(initSettleTimer);
    clearTimeout(initHardTimer);
    for (const tmr of initWriteTimers) clearTimeout(tmr);
  };
  const fireInit = () => {
    if (initDone) return;
    initDone = true;
    clearTimeout(initSettleTimer);
    clearTimeout(initHardTimer);
    initLines.forEach((line, i) => {
      initWriteTimers.push(setTimeout(() => { const live = ptys.get(id); if (live) live.write(line + '\r'); }, i * INIT_STEP_MS));
    });
  };
  const bumpInit = () => { // (re)arm the quiescence timer on each chunk of boot output
    if (initDone) return;
    clearTimeout(initSettleTimer);
    initSettleTimer = setTimeout(fireInit, INIT_QUIET_MS);
  };

  // Guard every send: pty events arrive asynchronously, so a shell's final output /
  // exit can land AFTER the webContents died (closing the window kills the ptys in
  // window-all-closed, but their exit events fire a tick later; a renderer reload
  // orphans old sessions the same way). An unguarded send then throws
  // "Object has been destroyed" as an uncaught exception in the main process.
  proc.onData((data) => {
    if (!sender.isDestroyed()) sender.send('pty:data', { id, data });
    bumpInit();
  });
  proc.onExit(({ exitCode }) => {
    initDone = true; // short-circuit any orphaned settle/hard timer that outraced this exit
    clearInitTimers();
    if (!sender.isDestroyed()) sender.send('pty:exit', { id, exitCode });
    ptys.delete(id);
    unregisterHooks(id);
  });

  if (startupCommand && startupCommand.trim()) {
    // Point the agent's hooks at us, so the pane learns "waiting for you" from
    // the agent rather than from guessing at terminal output. Only when the
    // command really is that binary (see canInjectSettings) — otherwise the
    // heuristic stays in charge, which is what happens for every other agent too.
    let command = startupCommand;
    if (hookBinary && Hooks.canInjectSettings(command, hookBinary)) {
      const settingsPath = await registerHooks(id);
      if (settingsPath) {
        command += ` --settings ${JSON.stringify(settingsPath)}`;
        log.info('hook.injected', { id });
      }
    }
    setTimeout(() => { const live = ptys.get(id); if (live) live.write(command + '\r'); }, STARTUP_DELAY_MS);
  }
  if (!initDone) {
    // start watching for quiet only after the startup command has been issued (so
    // we wait on the agent booting, not the shell warming up); fire regardless once
    // INIT_MAX_WAIT_MS passes, in case the agent's output never goes quiet
    setTimeout(bumpInit, STARTUP_DELAY_MS + 300);
    initHardTimer = setTimeout(fireInit, INIT_MAX_WAIT_MS);
  }

  const repoId = (gitMeta && gitMeta.repoId) || registeredRepoIdFor((gitMeta && gitMeta.root) || effectiveCwd);
  const registered = repoId ? loadRepos().find((repo) => repo && repo.id === repoId) : null;
  return {
    ok: true, shell: shell || shellForHost(), cwd: effectiveCwd,
    canonicalCwd: canonicalPath(effectiveCwd) || effectiveCwd,
    repoId, repoCwd: registered ? (canonicalPath(registered.path) || registered.path) : '', git: gitMeta,
  };
});

ipcMain.on('pty:input', (_e, { id, data }) => { const p = ptys.get(id); if (p) { try { p.write(data); } catch (_) {} } });
ipcMain.on('pty:resize', (_e, { id, cols, rows }) => {
  const p = ptys.get(id);
  if (p) { try { p.resize(Math.max(1, cols), Math.max(1, rows)); } catch (_) {} }
});
ipcMain.on('pty:kill', (_e, { id }) => {
  const p = ptys.get(id);
  if (p) { try { p.kill(); } catch (_) {} ptys.delete(id); }
  gitContexts.delete(id);
  unregisterHooks(id);
});

// ---- IPC: git diff review --------------------------------------------------
ipcMain.handle('git:diff', async (_e, { id }) => {
  try {
    const context = gitContexts.get(id);
    if (!context || !context.cwd) return { ok: false, error: 'Git session context が見つかりません。' };
    if (context.worktree) {
      const identity = await validateWorktreeIdentity({ ...context, expectedCwd: context.cwd });
      if (!identity.ok) return identity;
    }
    const ref = context.baseSha || 'HEAD';
    const stat = await git(['diff', '--stat', ref], context.cwd);
    const diff = await git(['diff', ref], context.cwd);
    let untracked = [];
    try {
      const u = await git(['ls-files', '--others', '--exclude-standard'], context.cwd);
      untracked = u.split('\n').map((s) => s.trim()).filter(Boolean);
    } catch (_) {}
    return { ok: true, stat, diff, untracked };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

// Merge a worktree-isolated session's branch back into the base branch checked
// out at the repo root (local `git merge --no-ff`; no remote/PR). Conflicts abort
// cleanly so the base tree is left untouched.
ipcMain.handle('git:merge', async (_e, { id }) => {
  try {
    const context = gitContexts.get(id);
    if (!context || !context.root || !context.branch || !context.worktree) {
      return { ok: false, error: 'merge には検証済み worktree session が必要です。' };
    }
    const identity = await validateWorktreeIdentity(context);
    if (!identity.ok) return identity;
    const { root, branch, worktree } = identity;
    const pre = await sessionMerge.preconditions({ root, branch, worktree, mode: 'merge' });
    if (!pre.ok) return pre;
    const merged = await sessionMerge.mergeBranch({ root, branch });
    if (!merged.ok) return merged;
    return { ok: true, target: pre.target, branch, ahead: pre.ahead, summary: merged.summary };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

// Push a worktree-isolated session's branch and open a PR against the base branch
// via the GitHub CLI (`gh pr create`). Requires an `origin` remote + an authenticated gh.
ipcMain.handle('git:pr', async (_e, { id }) => {
  try {
    const context = gitContexts.get(id);
    if (!context || !context.root || !context.branch || !context.worktree) {
      return { ok: false, error: 'PR には検証済み worktree session が必要です。' };
    }
    const identity = await validateWorktreeIdentity(context);
    if (!identity.ok) return identity;
    const { root, branch, worktree } = identity;
    const pre = await sessionMerge.preconditions({ root, branch, worktree, mode: 'pr' });
    if (!pre.ok) return pre;
    const { target, ahead } = pre;
    try {
      // push from root: worktrees share one object store, so the session branch ref resolves here
      await git(['push', '-u', 'origin', branch], root);
    } catch (err) {
      return { ok: false, error: 'push 失敗: ' + String((err && (err.stderr || err.message)) || err).trim() };
    }
    let out;
    try {
      out = await pexec('gh', ['pr', 'create', '--base', target, '--head', branch, '--fill'],
        { cwd: root, maxBuffer: 1024 * 1024, timeout: 30000 });
    } catch (err) {
      if (err && err.code === 'ENOENT') return { ok: false, error: 'gh CLI が見つかりません。GitHub CLI をインストール／認証してください。' };
      return { ok: false, error: 'gh pr create 失敗: ' + String((err && (err.stderr || err.message)) || err).trim() };
    }
    const url = ((out && out.stdout) || '').split('\n').map((l) => l.trim()).filter((l) => /^https?:\/\//.test(l)).pop() || '';
    return { ok: true, url, branch, target, ahead };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('git:isRepo', async (_e, { dir }) => ({ repo: await isRepo(dir) }));

// ---- IPC: repository registry ----------------------------------------------
ipcMain.handle('repos:list', async () => ({ ok: true, repos: await enrichRepos(loadRepos()) }));
ipcMain.handle('repos:add', async (_e, { path: dir }) => {
  const list = Repos.addRepo(loadRepos(), dir);
  try { saveRepos(list); }
  catch (err) {
    return { ok: false, error: String((err && err.message) || err), repos: await enrichRepos(loadRepos()) };
  }
  return { ok: true, repos: await enrichRepos(list) };
});
ipcMain.handle('repos:remove', async (_e, { id }) => {
  const list = Repos.removeRepo(loadRepos(), id);
  try { saveRepos(list); }
  catch (err) {
    return { ok: false, error: String((err && err.message) || err), repos: await enrichRepos(loadRepos()) };
  }
  return { ok: true, repos: await enrichRepos(list) };
});

// ---- IPC: scheduled launches -------------------------------------------------
function makeScheduleId() {
  return 'sched_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
}
/** List shape for the renderer: each entry carries its next firing time (FR-12). */
function withNextFire(list) {
  const now = Date.now();
  return list.map((s) => ({ ...s, nextFireAt: Schedule.nextFireAt(s, now) }));
}
function saveSchedulesOr(list) {
  try { saveSchedules(list); return null; }
  catch (err) { return String((err && err.message) || err); }
}

ipcMain.handle('schedules:list', () => ({ ok: true, schedules: withNextFire(loadSchedules()) }));
ipcMain.handle('schedules:add', (_e, raw) => {
  const v = Schedule.validate(raw, Date.now());
  if (!v.ok) return { ok: false, error: v.error, schedules: withNextFire(loadSchedules()) };
  const list = loadSchedules().concat([{ id: makeScheduleId(), ...v.value }]);
  const err = saveSchedulesOr(list);
  if (err) return { ok: false, error: err, schedules: withNextFire(loadSchedules()) };
  return { ok: true, schedules: withNextFire(list) };
});
ipcMain.handle('schedules:update', (_e, { id, patch }) => {
  const list = loadSchedules();
  const cur = list.find((s) => s.id === id);
  if (!cur) return { ok: false, error: 'スケジュールが見つかりません', schedules: withNextFire(list) };
  // Re-validate the merged result; an edit resets lastFiredAt (it's a new contract).
  const v = Schedule.validate({ ...cur, ...patch }, Date.now());
  if (!v.ok) return { ok: false, error: v.error, schedules: withNextFire(list) };
  const next = list.map((s) => (s.id === id ? { id, ...v.value } : s));
  const err = saveSchedulesOr(next);
  if (err) return { ok: false, error: err, schedules: withNextFire(loadSchedules()) };
  return { ok: true, schedules: withNextFire(next) };
});
ipcMain.handle('schedules:remove', (_e, { id }) => {
  const next = loadSchedules().filter((s) => s.id !== id);
  const err = saveSchedulesOr(next);
  if (err) return { ok: false, error: err, schedules: withNextFire(loadSchedules()) };
  return { ok: true, schedules: withNextFire(next) };
});
ipcMain.handle('schedules:toggle', (_e, { id, enabled }) => {
  const next = loadSchedules().map((s) => (s.id === id ? { ...s, enabled: !!enabled } : s));
  const err = saveSchedulesOr(next);
  if (err) return { ok: false, error: err, schedules: withNextFire(loadSchedules()) };
  return { ok: true, schedules: withNextFire(next) };
});

// ---- scheduler (main-resident: fires even with all windows closed on macOS) --
const SCHED_TICK_MS = 30_000;
const SCHED_GRACE_MS = 5 * 60_000; // §5.4 startup grace for missed one-shots
const schedReadyContents = new Set(); // webContents ids whose renderer finished boot
let schedLastTick = Date.now();
let schedGraceChecked = false;

ipcMain.on('schedule:ready', (e) => {
  const wc = e.sender;
  schedReadyContents.add(wc.id);
  wc.once('destroyed', () => schedReadyContents.delete(wc.id));
  if (!schedGraceChecked) {
    schedGraceChecked = true;
    const now = Date.now();
    const list = loadSchedules();
    const due = list.filter((s) => Schedule.missedOnce(s, now, SCHED_GRACE_MS));
    if (due.length) fireSchedules(due, list, now);
  }
});

/** Resolve a live window whose renderer can handle schedule:fire — reuse the
 *  first window if one exists, otherwise create one and wait for its boot
 *  (schedule:ready), with a timeout fallback so a wedged renderer can't block. */
function ensureWindow() {
  const win = BrowserWindow.getAllWindows()[0] || createWindow();
  return new Promise((resolve) => {
    if (schedReadyContents.has(win.webContents.id)) { resolve(win, true); return; }
    const timer = setTimeout(() => done(false), 10_000);
    function onReady(e) { if (e.sender.id === win.webContents.id) done(true); }
    function done(ready) {
      clearTimeout(timer);
      ipcMain.removeListener('schedule:ready', onReady);
      resolve({ win, ready });
    }
    ipcMain.on('schedule:ready', onReady);
  });
}

async function fireSchedules(due, list, now) {
  // Record firings (one-shots self-disable) and persist BEFORE launching, so a
  // crash between the two can't replay the same firing on the next start. The
  // cost of that ordering is that a firing which then fails to reach the
  // renderer is gone for good — so say so, loudly, instead of losing a 3am run
  // with no trace of it ever having been due.
  let next = list;
  for (const s of due) next = next.map((x) => (x.id === s.id ? Schedule.markFired(x, now) : x));
  try { saveSchedules(next); } catch (err) { log.fail('schedule.saveFailed', err); }
  const ids = due.map((s) => s.id);
  const { win, ready } = await ensureWindow();
  if (!win || win.isDestroyed()) {
    log.error('schedule.lost', { ids, why: 'no-window' });
    return;
  }
  if (!ready) {
    // sent anyway: a renderer that booted just after the timeout still handles it
    log.warn('schedule.rendererNotReady', { ids });
  }
  for (const s of due) {
    try { win.webContents.send('schedule:fire', { schedule: s }); log.info('schedule.fired', { id: s.id }); }
    catch (err) { log.fail('schedule.sendFailed', { id: s.id, error: String(err && err.message) }); }
  }
}

function startScheduler() {
  // Wall-clock polling (not setTimeout-until-target): survives sleep/clock drift.
  // shouldFire() checks the (lastTick, now] window, so a delayed tick still fires
  // exactly once. Schedules are re-read each tick — the file is tiny and this
  // keeps the loop in sync with CRUD edits with no in-memory state to reconcile.
  setInterval(() => {
    const now = Date.now();
    const list = loadSchedules();
    const due = list.filter((s) => Schedule.shouldFire(s, now, schedLastTick));
    schedLastTick = now;
    if (due.length) fireSchedules(due, list, now);
  }, SCHED_TICK_MS);
}

// ---- IPC: misc -------------------------------------------------------------
ipcMain.handle('dialog:openDir', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});
ipcMain.handle('app:info', () => ({
  platform: process.platform, home: os.homedir(), defaultShell: shellForHost(),
}));

// ---- IPC: clipboard (terminal copy/paste) ----------------------------------
ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text == null ? '' : text)); return true; });
ipcMain.handle('clipboard:read', () => clipboard.readText());

// ---- update: in-app download+install via electron-updater, feed fallback ----
// Strategy:
//   * Packaged builds use electron-updater (Squirrel.Mac / NSIS / AppImage) to
//     download AND install the update inside the app — no browser round-trip.
//   * Dev runs (electron .) and anything electron-updater can't handle (older
//     releases with no update metadata, network/signature errors, or an UNSIGNED
//     mac build where Squirrel.Mac refuses to self-install) degrade gracefully to
//     the lightweight feed checker below, which notifies with a browser link.
const RELEASES_PAGE = 'https://github.com/willink-oss/agentdeck/releases';
const UPDATE_FEED = process.env.AGENTDECK_UPDATE_FEED
  || 'https://api.github.com/repos/willink-oss/agentdeck/releases/latest';
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000; // re-check every 6h while running

// electron-updater only works in a packaged app; in dev it throws "not packed".
const CAN_AUTO_UPDATE = app.isPackaged;
const liveWindow = () => { const w = BrowserWindow.getAllWindows()[0]; return w && !w.isDestroyed() ? w : null; };
const sendUpdate = (channel, payload) => { const w = liveWindow(); if (w) w.webContents.send(channel, payload); };
const stripV = (v) => String(v == null ? '' : v).replace(/^v/i, '');
let updateCheckInFlight = false; // true while checkForUpdates() is intentionally awaited

autoUpdater.autoDownload = false;        // download only after the user clicks ダウンロード
autoUpdater.autoInstallOnAppQuit = true; // if downloaded but not yet installed, apply on next quit
autoUpdater.on('update-available', (info) => {
  sendUpdate('update:available', { latest: stripV(info && info.version), current: app.getVersion(), canInApp: true });
});
autoUpdater.on('download-progress', (p) => {
  sendUpdate('update:progress', { percent: Math.round((p && p.percent) || 0) });
});
autoUpdater.on('update-downloaded', (info) => {
  sendUpdate('update:downloaded', { latest: stripV(info && info.version) });
});
autoUpdater.on('error', (err) => {
  // While a check is intentionally awaited, checkForUpdate()'s catch owns the failure
  // (feed fallback). Only forward download-time errors so the UI can revert.
  if (updateCheckInFlight) return;
  sendUpdate('update:error', { message: String((err && err.message) || err) });
});

function fetchJson(url, redirects) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'AgentDeck-Updater', Accept: 'application/vnd.github+json' } }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location && (redirects || 0) < 5) {
        res.resume(); resolve(fetchJson(res.headers.location, (redirects || 0) + 1)); return;
      }
      if (code !== 200) { res.resume(); reject(new Error('HTTP ' + code)); return; }
      let data = ''; res.setEncoding('utf8');
      res.on('data', (c) => { data += c; if (data.length > 2_000_000) req.destroy(new Error('response too large')); });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
  });
}

/** Feed fallback: notify (with a browser link) when a newer version exists but in-app update isn't usable. */
async function feedCheck() {
  const current = app.getVersion();
  try {
    const rel = await fetchJson(UPDATE_FEED);
    const latestRaw = rel && (rel.tag_name || rel.name);
    const url = (rel && rel.html_url) || RELEASES_PAGE;
    if (latestRaw && Version.isNewer(latestRaw, current)) {
      sendUpdate('update:available', { latest: stripV(latestRaw), current, url, canInApp: false });
      return { ok: true, update: true, latest: stripV(latestRaw), url, current };
    }
    return { ok: true, update: false, current, latest: latestRaw ? stripV(latestRaw) : null };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err), current };
  }
}

/** Check for an update: electron-updater first (packaged), feed fallback otherwise. */
async function checkForUpdate() {
  if (CAN_AUTO_UPDATE) {
    updateCheckInFlight = true;
    try { await autoUpdater.checkForUpdates(); return { ok: true }; }
    catch (_) { return feedCheck(); } // no metadata yet / unreachable feed → browser link
    finally { updateCheckInFlight = false; }
  }
  return feedCheck();
}

ipcMain.handle('update:check', () => checkForUpdate());
ipcMain.handle('update:download', async () => {
  if (!CAN_AUTO_UPDATE) return { ok: false, reason: 'not-packaged' };
  try { await autoUpdater.downloadUpdate(); return { ok: true }; }
  catch (_) { return { ok: false }; } // the autoUpdater 'error' event forwards the message
});
ipcMain.on('update:install', () => { try { autoUpdater.quitAndInstall(); } catch (_) {} });
ipcMain.on('update:open', (_e, url) => {
  shell.openExternal(typeof url === 'string' && /^https:\/\//.test(url) ? url : RELEASES_PAGE);
});

function scheduleUpdateChecks() {
  // Resolve the live window each tick — on macOS the first window can be closed and
  // recreated (app.activate), so a captured reference would go stale. The renderer
  // triggers the initial check itself on boot (window.deck.checkUpdate()).
  setInterval(() => { checkForUpdate(); }, UPDATE_INTERVAL_MS);
}
