'use strict';
/*
 * E2E UI test — the interactive surfaces of the renderer, on a real runner.
 *
 * smoke proves the runtime boots and flow proves the git workflow; this covers
 * the renderer's interaction layer — exactly the glue that a renderer refactor
 * (module split, listener rewiring) is most likely to break:
 *   keyboard shortcuts (⌘1-9 / ⌘[ ⌘] / ⌘Enter / ⌘W), the ⌘K palette,
 *   inline rename, the repo focus-filter, the layout switch, the terminal
 *   context menu, the diff-drawer open/close glue, the preset manager,
 *   and the deck save/restore cycle across a reload.
 *
 * Run locally:
 *   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i --no-save playwright
 *   npm run rebuild && node e2e/ui.cjs   # Linux: xvfb-run node e2e/ui.cjs
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TIMEOUT = 60000;
// the app's shortcut chord is per-platform (⌘ on mac, Ctrl+Shift elsewhere) — test the real one
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control+Shift';
setTimeout(() => { console.error('UI FAIL: global 5min deadline exceeded'); process.exit(1); }, 300000).unref();
const ok = (cond, msg) => { if (!cond) throw new Error('UI FAIL: ' + msg); console.log('  ✓ ' + msg); };
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

/** Close the app but never let teardown decide the test's fate: a graceful close
 *  gets 15s, then the Electron child is SIGKILLed (the macOS CI runner has shown
 *  app.close() wedging after a fully green run). */
async function closeHard(app) {
  if (!app) return;
  try { await Promise.race([app.close(), new Promise((r) => setTimeout(r, 15000))]); } catch (_) {}
  try { const p = app.process(); if (p && !p.killed) p.kill('SIGKILL'); } catch (_) {}
}

(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-ui-'));
  const repo = path.join(base, 'svc-a');
  fs.mkdirSync(repo);
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.email', 'e2e@agentdeck.test');
  git(repo, 'config', 'user.name', 'agentdeck e2e');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'hello\n');
  git(repo, 'add', 'a.txt');
  git(repo, 'commit', '-m', 'initial');

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-ui-ud-'));
  const launchApp = () => electron.launch({
    args: [path.join(ROOT, 'main.js'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env, AGENTDECK_UPDATE_FEED: 'https://127.0.0.1:9/none' },
    timeout: TIMEOUT,
  });
  let app = await launchApp();
  let win;

  try {
    const attachWindow = async () => {
      win = await app.firstWindow({ timeout: TIMEOUT });
      win.on('dialog', (d) => d.accept());
      win.on('pageerror', (e) => console.error('renderer pageerror:', e && e.message));
      await win.waitForFunction(() => document.querySelectorAll('#preset option').length > 0, null, { timeout: TIMEOUT });
      await win.evaluate(() => { try { setLanguage('en'); } catch (_) {} }); // deterministic UI language for assertions
    };
    await attachWindow();

    // -- i18n: switching language flips the static chrome and <html lang> ---------
    ok(await win.evaluate(() => document.querySelector('[data-i18n="repos.title"]').textContent) === 'Repositories', 'en: repos label is English');
    await win.evaluate(() => setLanguage('ja'));
    ok(await win.evaluate(() => document.querySelector('[data-i18n="repos.title"]').textContent) === 'リポジトリ', 'ja: repos label switches to Japanese');
    ok(await win.evaluate(() => document.documentElement.lang) === 'ja', 'ja: <html lang> updated');
    ok(await win.evaluate(() => document.querySelector('#launch').textContent.includes('エージェント')), 'ja: dynamic launch button label translated');
    await win.evaluate(() => setLanguage('en')); // back to English for the rest of the run

    // -- setup: register the repo, launch "alpha" (repo) and "beta" (home) ----
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, repo);
    await win.click('#repo-add');
    await win.waitForFunction(() =>
      [...document.querySelectorAll('#repo-list .repo-name')].some((el) => el.textContent === 'svc-a'),
      null, { timeout: TIMEOUT });

    const launchShell = async (name, cwd) => {
      await win.selectOption('#preset', 'shell');
      await win.fill('#name', name);
      await win.fill('#cwd', cwd);
      await win.click('#launch');
      await win.waitForFunction((n) =>
        [...document.querySelectorAll('.pane.active .pane-name')].some((el) => el.textContent === n),
        name, { timeout: TIMEOUT }); // serialise launches on the new pane becoming active
    };
    await launchShell('alpha', repo);
    await launchShell('beta', os.homedir());
    // registering the repo auto-selected it, so the home-launched beta is filter-hidden
    // and the filter pill is showing — clear it for a both-visible baseline
    ok(await win.evaluate(() => !document.querySelector('#stage-filter').hidden),
      'setup: repo auto-select filters the home session (pill visible)');
    await win.click('#stage-all');
    await win.waitForFunction(() =>
      [...document.querySelectorAll('.pane')].every((p) => p.style.display !== 'none'),
      null, { timeout: 10000 });
    ok(await win.evaluate(() => document.querySelectorAll('.pane').length) === 2, 'setup: two sessions running');

    const activeName = () => win.evaluate(() =>
      (document.querySelector('.pane.active .pane-name') || {}).textContent);

    // -- keyboard shortcuts ----------------------------------------------------
    await win.keyboard.press(`${MOD}+Digit1`);
    ok(await activeName() === 'alpha', '⌘1 focuses the first pane');
    await win.keyboard.press(`${MOD}+Digit2`);
    ok(await activeName() === 'beta', '⌘2 focuses the second pane');
    await win.keyboard.press(`${MOD}+BracketLeft`);
    ok(await activeName() === 'alpha', '⌘[ cycles back');
    await win.keyboard.press(`${MOD}+BracketRight`);
    ok(await activeName() === 'beta', '⌘] cycles forward');
    await win.fill('#name', 'gamma');
    await win.keyboard.press(`${MOD}+Enter`);
    // the pane is appended synchronously but markActive lands after the spawn resolves
    await win.waitForFunction(() =>
      (document.querySelector('.pane.active .pane-name') || {}).textContent === 'gamma',
      null, { timeout: TIMEOUT });
    ok(await win.evaluate(() => document.querySelectorAll('.pane').length) === 3, '⌘Enter launches from the form');
    await win.keyboard.press(`${MOD}+KeyW`);
    await win.waitForFunction(() => document.querySelectorAll('.pane').length === 2, null, { timeout: TIMEOUT });
    ok(true, '⌘W kills the active pane');
    await win.fill('#name', '');

    // -- attention detection: an idle shell prompt flags fast --------------------
    // focus beta so alpha is unwatched; its tail is a shell prompt (zsh % / bash $ /
    // PowerShell >) -> classified 'prompt'; the 15s wait covers any kind's cutoff
    await win.keyboard.press(`${MOD}+Digit2`);
    // pin the precondition (beta watched, alpha unwatched) so a timeout below can
    // only mean the detector itself didn't fire
    await win.waitForFunction(() =>
      (document.querySelector('.pane.active .pane-name') || {}).textContent === 'beta',
      null, { timeout: 10000 });
    await win.waitForFunction(() => {
      const panes = [...document.querySelectorAll('.pane')];
      const alpha = panes.find((p) => p.querySelector('.pane-name').textContent === 'alpha');
      return alpha && alpha.querySelector('.status-dot.waiting');
    }, null, { timeout: 25000 });
    ok(true, 'idle prompt flags attention (waiting dot)');
    // focusing the session clears the flag
    await win.keyboard.press(`${MOD}+Digit1`);
    await win.waitForFunction(() => {
      const panes = [...document.querySelectorAll('.pane')];
      const alpha = panes.find((p) => p.querySelector('.pane-name').textContent === 'alpha');
      return alpha && !alpha.querySelector('.status-dot.waiting');
    }, null, { timeout: 10000 });
    ok(true, 'focusing the session clears attention');

    // -- in-terminal search (chord+F) ---------------------------------------------
    await win.evaluate(() => window.deck.input(document.querySelector('.pane.active').dataset.id, 'echo find-me-target\r'));
    await win.waitForFunction(() => {
      const s = sessions.get(document.querySelector('.pane.active').dataset.id);
      return s && termTailLines(s.term, 6).join('\n').includes('find-me-target');
    }, null, { timeout: 15000 });
    await win.keyboard.press(`${MOD}+KeyF`);
    ok(await win.evaluate(() => !document.querySelector('#term-search').hidden), 'chord+F opens the search bar');
    await win.fill('#term-search-input', 'find-me');
    await win.keyboard.press('Enter');
    await win.waitForFunction(() =>
      [...sessions.values()].some((s) => (s.term.getSelection() || '').includes('find-me')),
      null, { timeout: 10000 });
    ok(true, 'search selects the match in the terminal');
    await win.keyboard.press('Escape');
    ok(await win.evaluate(() => document.querySelector('#term-search').hidden), 'Escape closes the search bar');

    // -- ⌘K palette --------------------------------------------------------------
    await win.keyboard.press(`${MOD}+KeyK`);
    ok(await win.evaluate(() => !document.querySelector('#palette').hidden), '⌘K opens the palette');
    await win.keyboard.type('alp');
    await win.waitForFunction(() => {
      const rows = document.querySelectorAll('#palette-list .palette-row');
      return rows.length === 1 && rows[0].querySelector('.palette-name').textContent === 'alpha';
    }, null, { timeout: 10000 });
    ok(true, 'palette filters by fuzzy query');
    await win.keyboard.press('Enter');
    ok(await win.evaluate(() => document.querySelector('#palette').hidden), 'Enter commits and closes the palette');
    ok(await activeName() === 'alpha', 'palette jump focuses the matched session');
    await win.keyboard.press(`${MOD}+KeyK`);
    await win.keyboard.press('Escape');
    ok(await win.evaluate(() => document.querySelector('#palette').hidden), 'Escape closes the palette');

    // -- inline rename -----------------------------------------------------------
    await win.dblclick('.pane .pane-name');
    await win.keyboard.type('alpha-x');
    await win.keyboard.press('Enter');
    await win.waitForFunction(() =>
      [...document.querySelectorAll('.pane .pane-name')].some((el) => el.textContent === 'alpha-x'),
      null, { timeout: 10000 });
    ok(await win.evaluate(() =>
      [...document.querySelectorAll('#repo-list .repo-session-name')].some((el) => el.textContent === 'alpha-x')),
      'rename reflects in the pane and the sidebar');

    // -- repo focus-filter ---------------------------------------------------------
    await win.click('#repo-list .repo-name');
    await win.waitForFunction(() => {
      const panes = [...document.querySelectorAll('.pane')];
      const hidden = panes.filter((p) => p.style.display === 'none');
      return hidden.length === 1 && !document.querySelector('#stage-filter').hidden;
    }, null, { timeout: 10000 });
    ok(true, 'selecting a repo filters the stage and shows the pill');
    await win.click('#stage-all');
    await win.waitForFunction(() =>
      [...document.querySelectorAll('.pane')].every((p) => p.style.display !== 'none'),
      null, { timeout: 10000 });
    ok(true, '「すべて表示」 clears the filter');

    // -- layout switch ----------------------------------------------------------
    await win.click('.ls-btn[data-cols="2"]');
    ok(await win.evaluate(() => document.querySelector('#grid').style.gridTemplateColumns.includes('repeat(2')),
      'layout switch applies a 2-column grid');

    // -- terminal context menu ----------------------------------------------------
    await win.click('.pane .term-host', { button: 'right' });
    ok(await win.evaluate(() => !document.querySelector('#term-menu').hidden), 'right-click opens the terminal menu');
    await win.keyboard.press('Escape');
    ok(await win.evaluate(() => document.querySelector('#term-menu').hidden), 'Escape closes the terminal menu');

    // -- diff drawer open/close glue ----------------------------------------------
    await win.keyboard.press(`${MOD}+Digit1`); // alpha-x (repo session)
    await win.click('.pane .pane-diff');
    await win.waitForFunction(() => !document.querySelector('#diff-overlay').hidden, null, { timeout: TIMEOUT });
    ok(true, 'diff drawer opens for a repo session');
    await win.keyboard.press('Escape');
    ok(await win.evaluate(() => document.querySelector('#diff-overlay').hidden), 'Escape closes the diff drawer');

    // -- preset manager (persisted custom preset) ----------------------------------
    await win.click('#preset-manage');
    await win.fill('#preset-label-input', 'Aider');
    await win.fill('#preset-cmd-input', 'aider');
    await win.click('#preset-submit');
    ok(await win.evaluate(() => document.querySelectorAll('#preset option').length) === 6, 'custom preset lands in the select');
    await win.keyboard.press('Escape');

    // -- real restart: layout + presets persist; the saved deck restores -------------
    // a full close + relaunch (same user-data-dir), not win.reload(): reload keeps the
    // main process alive, orphaning the live PTYs (a state real usage can't produce —
    // and one that wedged app.close() on CI). Restart also tests true persistence.
    await closeHard(app);
    app = await launchApp();
    await attachWindow();
    ok(await win.evaluate(() => document.querySelectorAll('#preset option').length) === 6, 'restart: custom preset persisted');
    ok(await win.evaluate(() => document.querySelector('#grid').style.gridTemplateColumns.includes('repeat(2')),
      'restart: layout choice persisted');
    await win.waitForFunction(() => {
      const b = document.querySelector('#restore-deck');
      return b && !b.hidden && b.textContent.includes('(2)');
    }, null, { timeout: TIMEOUT });
    await win.click('#restore-deck');
    // restore launches sequentially and ends by activating the last config (beta) —
    // waiting for that means every spawn has settled before we close the app
    await win.waitForFunction(() =>
      document.querySelectorAll('.pane').length === 2 &&
      (document.querySelector('.pane.active .pane-name') || {}).textContent === 'beta',
      null, { timeout: TIMEOUT });
    const names = await win.evaluate(() => [...document.querySelectorAll('.pane .pane-name')].map((el) => el.textContent));
    ok(names.includes('alpha-x') && names.includes('beta'), `restore: deck re-spawned with kept names (${names.join(',')})`);

    console.log('UI PASS');
  } finally {
    await closeHard(app);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(base, { recursive: true, force: true }); } catch (_) {}
  }
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = process.exitCode || 1;
}).finally(() => process.exit(process.exitCode || 0)); // teardown must never wedge a green run
