'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const https = require('https');
const { execFile } = require('child_process');
const { promisify } = require('util');
const pty = require('node-pty');
const { defaultShell, sanitizeBranch, worktreeFolderName } = require('./lib/git-utils');
const Repos = require('./lib/repos');
const GitStat = require('./lib/gitstat');
const Version = require('./lib/version');

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
async function safeGit(args, cwd) { try { return await git(args, cwd); } catch (_) { return ''; } }
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
  scheduleUpdateChecks();
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

// Merge a worktree-isolated session's branch back into the base branch checked
// out at the repo root (local `git merge --no-ff`; no remote/PR). Conflicts abort
// cleanly so the base tree is left untouched.
ipcMain.handle('git:merge', async (_e, { root, branch, worktree }) => {
  try {
    if (!root || !branch) return { ok: false, error: 'merge には worktree セッション（ブランチ）が必要です。' };
    const target = await currentBranch(root);
    // `git rev-parse --abbrev-ref HEAD` prints the literal "HEAD" when detached (no error),
    // so guard on that too — git forbids a real branch named "HEAD", making this unambiguous.
    if (!target || target === 'HEAD') return { ok: false, error: 'ベースが detached HEAD のため merge 先ブランチを特定できません。' };
    if (target === branch) return { ok: false, error: `ベースと同じブランチ (${branch}) には merge できません。` };
    // Only committed history merges; tell apart "no commits yet" from "uncommitted work left in the session".
    const ahead = parseInt((await git(['rev-list', '--count', `${target}..${branch}`], root)).trim(), 10) || 0;
    if (ahead === 0) {
      const dirty = worktree ? (await safeGit(['status', '--porcelain'], worktree)).trim() : '';
      return dirty
        ? { ok: false, error: 'worktree に未コミットの変更があります。セッション内で commit してから merge してください。' }
        : { ok: false, error: '取り込む新しいコミットがありません。' };
    }
    let out;
    try {
      out = await git(['merge', '--no-ff', '-m', `Merge agentdeck session: ${branch}`, branch], root);
    } catch (err) {
      try { await git(['merge', '--abort'], root); } catch (_) {} // best-effort: leave base clean
      const msg = (err && (err.stderr || err.message)) || String(err);
      return { ok: false, error: 'merge 失敗（中断しました）: ' + String(msg).trim() };
    }
    return { ok: true, target, branch, ahead, summary: (out || '').trim() };
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

// ---- update check (manual distribution: we only check the feed + notify) ----
const RELEASES_PAGE = 'https://github.com/willink-oss/agentdeck/releases';
const UPDATE_FEED = process.env.AGENTDECK_UPDATE_FEED
  || 'https://api.github.com/repos/willink-oss/agentdeck/releases/latest';
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000; // re-check every 6h while running

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

/** Fetch the latest published version and, if newer than this build, notify the renderer. */
async function checkForUpdate(win) {
  const current = app.getVersion();
  try {
    const rel = await fetchJson(UPDATE_FEED);
    const latestRaw = rel && (rel.tag_name || rel.name);
    const url = (rel && rel.html_url) || RELEASES_PAGE;
    if (latestRaw && Version.isNewer(latestRaw, current)) {
      const latest = String(latestRaw).replace(/^v/i, '');
      if (win && !win.isDestroyed()) win.webContents.send('update:available', { latest, url, current });
      return { ok: true, update: true, latest, url, current };
    }
    return { ok: true, update: false, current, latest: latestRaw ? String(latestRaw).replace(/^v/i, '') : null };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err), current };
  }
}

ipcMain.handle('update:check', () => checkForUpdate(BrowserWindow.getAllWindows()[0]));
ipcMain.on('update:open', (_e, url) => {
  shell.openExternal(typeof url === 'string' && /^https:\/\//.test(url) ? url : RELEASES_PAGE);
});

function scheduleUpdateChecks() {
  // Resolve the live window each tick — on macOS the first window can be closed and
  // recreated (app.activate), so a captured reference would go stale. The renderer
  // triggers the initial check itself on boot (window.deck.checkUpdate()).
  setInterval(() => checkForUpdate(BrowserWindow.getAllWindows()[0]), UPDATE_INTERVAL_MS);
}
