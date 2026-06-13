'use strict';
/*
 * E2E flow test — the worktree → diff → merge loop, end to end, on a real runner.
 *
 * Where e2e/smoke.cjs proves the per-OS runtime boots, this proves the app's core
 * workflow actually works against a real git repo on each OS:
 *   1. register a repository (mocked folder dialog -> repos:add IPC),
 *   2. launch a worktree-isolated session (git worktree add on a new branch),
 *   3. commit a change in the worktree, open the diff drawer, and see line- and
 *      word-level highlighting of exactly that change,
 *   4. merge the session branch back into the base checkout from the drawer
 *      (confirm() auto-accepted) and verify the merge landed in the base repo.
 * Worktree paths and git behaviour are the bits most likely to differ on Windows,
 * which is why this runs in CI on all three OSes (Linux under xvfb).
 *
 * Run locally:
 *   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i --no-save playwright
 *   npm run rebuild && npm run e2e     # Linux: xvfb-run npm run e2e
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TIMEOUT = 60000;
// hard deadline: a hung run dies with a clear message instead of eating the CI job timeout
setTimeout(() => { console.error('FLOW FAIL: global 5min deadline exceeded'); process.exit(1); }, 300000).unref();
const ok = (cond, msg) => { if (!cond) throw new Error('FLOW FAIL: ' + msg); console.log('  ✓ ' + msg); };
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

/** Close the app but never let teardown decide the test's fate: a graceful close
 *  gets 15s, then the Electron child is SIGKILLed (app.close() has wedged after
 *  fully green runs on both CI and local machines). */
async function closeHard(app) {
  if (!app) return;
  try { await Promise.race([app.close(), new Promise((r) => setTimeout(r, 15000))]); } catch (_) {}
  try { const p = app.process(); if (p && !p.killed) p.kill('SIGKILL'); } catch (_) {}
}

(async () => {
  // -- a throwaway repo with one committed file ------------------------------
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-flow-'));
  const repo = path.join(base, 'my-service');
  fs.mkdirSync(repo);
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.email', 'e2e@agentdeck.test');
  git(repo, 'config', 'user.name', 'agentdeck e2e');
  const serverJs = 'const port = 3000;\nconst host = "localhost";\nconsole.log("boot", host, port);\n';
  fs.writeFileSync(path.join(repo, 'server.js'), serverJs);
  fs.writeFileSync(path.join(repo, 'util.js'), 'function add(a, b) { return a + b; }\n');
  git(repo, 'add', 'server.js', 'util.js');
  git(repo, 'commit', '-m', 'initial');

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-flow-ud-'));
  const app = await electron.launch({
    args: [path.join(ROOT, 'main.js'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env, AGENTDECK_UPDATE_FEED: 'https://127.0.0.1:9/none' },
    timeout: TIMEOUT,
  });

  try {
    const win = await app.firstWindow({ timeout: TIMEOUT });
    win.on('dialog', (d) => d.accept()); // auto-accept the merge confirm()
    win.on('pageerror', (e) => console.error('renderer pageerror:', e && e.message));
    await win.waitForFunction(() => document.querySelectorAll('#preset option').length > 0, null, { timeout: TIMEOUT });
    await win.evaluate(() => { try { setLanguage('en'); } catch (_) {} }); // deterministic UI language for assertions

    // 1) register the repo through the real flow, with only the OS dialog mocked
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, repo);
    await win.click('#repo-add');
    await win.waitForFunction(() =>
      [...document.querySelectorAll('#repo-list .repo-name')].some((el) => el.textContent === 'my-service'),
      null, { timeout: TIMEOUT });
    ok(true, 'repo registered and listed in the sidebar');

    // 2) launch a worktree-isolated plain-shell session in it
    await win.selectOption('#preset', 'shell');
    await win.fill('#cwd', repo);
    await win.check('#wt-enable');
    await win.fill('#wt-branch', 'agentdeck/e2e-flow');
    await win.click('#launch');
    await win.waitForSelector('.pane .status-dot.live', { timeout: TIMEOUT });
    await win.waitForFunction(() =>
      (document.querySelector('.pane .pane-cwd') || {}).textContent === '⌥ agentdeck/e2e-flow',
      null, { timeout: TIMEOUT });
    const wt = await win.getAttribute('.pane .pane-cwd', 'title'); // worktree path
    ok(wt && fs.existsSync(path.join(wt, 'server.js')), `worktree created at ${wt}`);
    ok(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD') === 'agentdeck/e2e-flow', 'worktree is on the session branch');

    // 3) commit a change in the worktree, then review it in the diff drawer
    fs.writeFileSync(path.join(wt, 'server.js'), serverJs.replace('3000', '8080'));
    fs.appendFileSync(path.join(wt, 'util.js'), 'function sub(a, b) { return a - b; }\n');
    git(wt, 'add', 'server.js', 'util.js');
    git(wt, 'commit', '-m', 'tune: listen on 8080; add sub()');
    await win.click('.pane .pane-diff');
    await win.waitForFunction(() => {
      const o = document.querySelector('#diff-overlay');
      return o && !o.hidden && document.querySelectorAll('#diff-body .dl-add').length > 0;
    }, null, { timeout: TIMEOUT });
    ok(true, 'diff drawer shows the change');
    const words = await win.evaluate(() =>
      [...document.querySelectorAll('#diff-body .dl-word')].map((el) => el.textContent));
    ok(words.includes('3000') && words.includes('8080'), `word-level highlight marks exactly the port (${words.join(',')})`);
    ok(await win.evaluate(() => document.querySelectorAll('#diff-body .sx-kw').length > 0),
      'syntax highlighting colours js keywords');
    // per-file navigation: two files changed -> bar visible with two chips; the
    // second chip jumps and becomes active
    ok(await win.evaluate(() => !document.querySelector('#diff-files').hidden), 'file nav bar shown for a 2-file diff');
    const chips = await win.evaluate(() => [...document.querySelectorAll('.df-item')].map((el) => el.textContent));
    ok(chips.length === 2 && chips.includes('server.js') && chips.includes('util.js'),
      `file nav lists both files (${chips.join(',')})`);
    await win.evaluate(() => document.querySelectorAll('.df-item')[1].click());
    ok(await win.evaluate(() => document.querySelectorAll('.df-item')[1].classList.contains('active')),
      'clicking a file chip activates it (jump)');
    ok(await win.evaluate(() => !document.querySelector('#diff-merge').hidden), 'merge button offered for the worktree session');

    // 4) merge back into the base checkout from the drawer
    await win.click('#diff-merge');
    await win.waitForFunction(() =>
      (document.querySelector('#diff-meta') || {}).textContent.startsWith('✓ merged'),
      null, { timeout: TIMEOUT });
    ok(fs.readFileSync(path.join(repo, 'server.js'), 'utf8').includes('8080'), 'base checkout has the merged change');
    ok(/agentdeck\/e2e-flow/.test(git(repo, 'log', '-1', '--pretty=%s')), 'base history has the merge commit');

    console.log('FLOW PASS');
  } finally {
    await closeHard(app);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(base, { recursive: true, force: true }); } catch (_) {}
  }
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = process.exitCode || 1;
}).finally(() => process.exit(process.exitCode || 0)); // teardown must never wedge a green run
