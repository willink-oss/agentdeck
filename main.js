'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const pty = require('node-pty');
const { defaultShell, sanitizeBranch, worktreeFolderName } = require('./lib/git-utils');
const Repos = require('./lib/repos');

const pexec = promisify(execFile);

/** @type {Map<string, import('node-pty').IPty>} */
const ptys = new Map();

const shellForHost = () => defaultShell(process.platform, process.env);

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

const GIT_INFO_TTL = 4000;
const gitInfoCache = new Map(); // path -> { at, info }
async function gitInfoFor(dir) {
  const hit = gitInfoCache.get(dir);
  if (hit && (Date.now() - hit.at) < GIT_INFO_TTL) return hit.info;
  let info;
  try {
    info = (await isRepo(dir))
      ? { isRepo: true, branch: await currentBranch(dir) }
      : { isRepo: false, branch: '' };
  } catch (_) { info = { isRepo: false, branch: '' }; }
  gitInfoCache.set(dir, { at: Date.now(), info });
  return info;
}
async function enrichRepos(list) {
  return Promise.all(list.map(async (r) => ({ ...r, ...(await gitInfoFor(r.path)) })));
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
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  return win;
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  for (const p of ptys.values()) { try { p.kill(); } catch (_) {} }
  ptys.clear();
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC: spawn (with optional git worktree isolation) ---------------------
ipcMain.handle('pty:spawn', async (event, opts) => {
  const { id, cwd, shell, cols, rows, startupCommand, worktree } = opts || {};
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
      const branch = sanitizeBranch(worktree.branch);
      const wtBase = path.join(path.dirname(root), '.agentdeck-worktrees');
      fs.mkdirSync(wtBase, { recursive: true });
      const wtPath = path.join(wtBase, worktreeFolderName(path.basename(root), branch));
      if (fs.existsSync(wtPath)) return { ok: false, error: `Worktree path already exists: ${wtPath}` };
      await git(['worktree', 'add', '-b', branch, wtPath, base], root);
      effectiveCwd = wtPath;
      gitMeta = { cwd: wtPath, baseSha: base, branch, worktree: wtPath, root };
    } else if (await isRepo(effectiveCwd)) {
      const base = await headSha(effectiveCwd);
      gitMeta = { cwd: effectiveCwd, baseSha: base, branch: await currentBranch(effectiveCwd), worktree: null };
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
  const sender = event.sender;
  proc.onData((data) => sender.send('pty:data', { id, data }));
  proc.onExit(({ exitCode }) => { sender.send('pty:exit', { id, exitCode }); ptys.delete(id); });

  if (startupCommand && startupCommand.trim()) {
    setTimeout(() => { const live = ptys.get(id); if (live) live.write(startupCommand + '\r'); }, 700);
  }

  return { ok: true, shell: shell || shellForHost(), cwd: effectiveCwd, git: gitMeta };
});

ipcMain.on('pty:input', (_e, { id, data }) => { const p = ptys.get(id); if (p) p.write(data); });
ipcMain.on('pty:resize', (_e, { id, cols, rows }) => {
  const p = ptys.get(id);
  if (p) { try { p.resize(Math.max(1, cols), Math.max(1, rows)); } catch (_) {} }
});
ipcMain.on('pty:kill', (_e, { id }) => {
  const p = ptys.get(id);
  if (p) { try { p.kill(); } catch (_) {} ptys.delete(id); }
});

// ---- IPC: git diff review --------------------------------------------------
ipcMain.handle('git:diff', async (_e, { cwd, baseRef }) => {
  try {
    const ref = baseRef || 'HEAD';
    const stat = await git(['diff', '--stat', ref], cwd);
    const diff = await git(['diff', ref], cwd);
    let untracked = [];
    try {
      const u = await git(['ls-files', '--others', '--exclude-standard'], cwd);
      untracked = u.split('\n').map((s) => s.trim()).filter(Boolean);
    } catch (_) {}
    return { ok: true, stat, diff, untracked };
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

// ---- IPC: misc -------------------------------------------------------------
ipcMain.handle('dialog:openDir', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});
ipcMain.handle('app:info', () => ({
  platform: process.platform, home: os.homedir(), defaultShell: shellForHost(),
}));
