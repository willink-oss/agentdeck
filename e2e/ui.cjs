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
const realPathKey = (value) => {
  try {
    const resolveRealPath = fs.realpathSync.native || fs.realpathSync;
    const key = resolveRealPath(String(value || '')).replace(/\\/g, '/').replace(/\/+$/, '');
    return process.platform === 'win32' ? key.toLowerCase() : key;
  } catch (_) { return ''; }
};
const fileIdentityKey = (value) => {
  try {
    const stat = fs.statSync(String(value || ''), { bigint: true });
    return stat.ino ? `${stat.dev}:${stat.ino}` : '';
  } catch (_) { return ''; }
};
const sameRealPath = (left, right) => {
  const a = realPathKey(left), b = realPathKey(right);
  if (a && b && a === b) return true;
  const leftId = fileIdentityKey(left), rightId = fileIdentityKey(right);
  return !!leftId && leftId === rightId;
};

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
    env: { ...process.env, AGENTDECK_UPDATE_FEED: 'https://127.0.0.1:9/none', AGENTDECK_HEADLESS: '1' },
    timeout: TIMEOUT,
  });
  let app = await launchApp();
  let win;
  let dialogAction = 'accept'; // e2e flips this to 'dismiss' to test a confirm() being declined

  try {
    const attachWindow = async () => {
      win = await app.firstWindow({ timeout: TIMEOUT });
      win.on('dialog', (d) => (dialogAction === 'dismiss' ? d.dismiss() : d.accept()));
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

    // The launch form lives in a popover now. Opening it is idempotent, so every
    // block that touches a form field can just ask for it; submitting closes it.
    const openForm = async () => {
      if (await win.evaluate(() => document.querySelector('#launch-popover').hidden)) {
        await win.click('#new-session');
        await win.waitForSelector('#launch-popover .lp-panel', { state: 'visible', timeout: TIMEOUT });
      }
    };
    const launchShell = async (name, cwd) => {
      await openForm();
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
    await openForm();
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
    await openForm();
    await win.fill('#name', '');

    // -- ⌘W on a RISKY session (isolated worktree) confirms first; dismiss cancels --
    await win.selectOption('#preset', 'shell');
    await win.fill('#name', 'wtkill');
    await win.fill('#cwd', repo);
    await win.check('#wt-enable');
    await win.fill('#wt-branch', 'agentdeck/e2e-killconfirm');
    await win.click('#launch');
    await win.waitForFunction(() =>
      [...document.querySelectorAll('.pane.active .pane-name')].some((el) => el.textContent === 'wtkill'),
      null, { timeout: TIMEOUT });
    // The pane becomes active before the async main-process spawn has resolved.
    // Wait for the authoritative Git metadata to be saved instead of racing the
    // worktree creation on slower platforms (notably Windows CI).
    await win.waitForFunction(() => {
      try {
        const snapshot = JSON.parse(localStorage.getItem(Workspace.KEY) || 'null');
        const session = snapshot && Array.isArray(snapshot.sessions)
          ? snapshot.sessions.find((s) => s.name === 'wtkill')
          : null;
        return snapshot && snapshot.version === 2 && session && session.repoId &&
          session.launchCwd && session.gitRoot && session.baseSha && session.branch &&
          session.baseBranch && session.worktreePath;
      } catch (_) { return false; }
    }, null, { timeout: TIMEOUT });
    const savedWt = await win.evaluate(() => {
      const snapshot = JSON.parse(localStorage.getItem(Workspace.KEY));
      return { snapshot, session: snapshot.sessions.find((s) => s.name === 'wtkill') };
    });
    const savedWtValid = savedWt.snapshot.version === 2 &&
      sameRealPath(savedWt.session.repoId, repo) && sameRealPath(savedWt.session.launchCwd, repo) &&
      sameRealPath(savedWt.session.gitRoot, repo) &&
      savedWt.session.baseSha && savedWt.session.branch === 'agentdeck/e2e-killconfirm' &&
      savedWt.session.baseBranch === 'main' && savedWt.session.worktreePath;
    if (!savedWtValid) {
      throw new Error(`UI FAIL: invalid saved worktree metadata: ${JSON.stringify({
        repo, repoKey: realPathKey(repo), session: savedWt.session,
        repoIdKey: realPathKey(savedWt.session.repoId),
        launchCwdKey: realPathKey(savedWt.session.launchCwd),
        gitRootKey: realPathKey(savedWt.session.gitRoot),
        repoIdFile: fileIdentityKey(savedWt.session.repoId),
        gitRootFile: fileIdentityKey(savedWt.session.gitRoot),
      })}`);
    }
    ok(true, 'worktree launch saves v2 parent-repo/base/branch metadata');
    const paneCount = () => win.evaluate(() => document.querySelectorAll('.pane').length);
    const withWt = await paneCount();
    dialogAction = 'dismiss';
    await win.keyboard.press(`${MOD}+KeyW`);
    await win.waitForTimeout(400); // a cancelled kill must NOT drop the pane
    ok(await paneCount() === withWt, '⌘W on a worktree session asks first; dismiss keeps the pane');
    dialogAction = 'accept';
    await win.keyboard.press(`${MOD}+KeyW`);
    await win.waitForFunction((n) => document.querySelectorAll('.pane').length === n, withWt - 1, { timeout: TIMEOUT });
    ok(true, '⌘W on a worktree session: confirm accepted kills it');
    // reset the form so later steps are unaffected. Clear #wt-branch FIRST: unchecking
    // #wt-enable disables it, and fill() on a disabled input hangs until timeout.
    await openForm();
    await win.fill('#wt-branch', '');
    await win.uncheck('#wt-enable');
    await win.fill('#name', '');
    await win.click('#lp-close'); // its backdrop would otherwise swallow the next sidebar click

    // -- modals swallow app chords: ⌘Enter/⌘K behind the schedule manager must not reach the deck --
    await win.click('#sched-manage');
    await win.waitForFunction(() => !document.querySelector('#sched-overlay').hidden, null, { timeout: TIMEOUT });
    const panesBeforeModalChord = await win.evaluate(() => document.querySelectorAll('.pane').length);
    await win.focus('#sched-command');
    await win.keyboard.press(`${MOD}+Enter`); // missing guard would launch a stray session from the main form
    await win.keyboard.press(`${MOD}+KeyK`);  // missing guard would pop the palette over the modal
    const panesAfterModalChord = await win.evaluate(() => document.querySelectorAll('.pane').length);
    const paletteStillHidden = await win.evaluate(() => document.querySelector('#palette').hidden);
    ok(panesAfterModalChord === panesBeforeModalChord && paletteStillHidden,
      'schedule modal swallows app chords (no stray launch / palette behind it)');
    await win.click('#sched-close');
    await win.waitForFunction(() => document.querySelector('#sched-overlay').hidden, null, { timeout: TIMEOUT });

    // -- attention detection: an idle shell prompt flags fast --------------------
    // focus beta so alpha is unwatched; its tail is a shell prompt (zsh % / bash $ /
    // PowerShell >) -> classified 'prompt'; the 15s wait covers any kind's cutoff
    await win.keyboard.press(`${MOD}+Digit2`);
    // pin the precondition (beta watched, alpha unwatched) so a timeout below can
    // only mean the detector itself didn't fire
    await win.waitForFunction(() =>
      (document.querySelector('.pane.active .pane-name') || {}).textContent === 'beta',
      null, { timeout: 10000 });
    // Emit an explicit confirmation tail instead of depending on each runner's
    // shell prompt theme; the attention path remains a real PTY/output flow.
    await win.evaluate(() => {
      const alpha = [...sessions.values()].find((s) => s.name === 'alpha');
      window.deck.input(alpha.id, "printf '\\nProceed? [y/N] '");
      window.deck.input(alpha.id, '\r');
    });
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

    // -- agent identity: each pane says which agent it is three ways ------------
    const identity = await win.evaluate(() => {
      const pane = document.querySelector('.pane');
      const cs = getComputedStyle(pane, '::before');
      return {
        tone: pane.dataset.tone,
        railWidth: cs.width,
        railColour: cs.backgroundColor,
        glyph: (pane.querySelector('.pane-glyph') || {}).textContent,
        badge: (pane.querySelector('.pane-badge') || {}).textContent,
      };
    });
    ok(identity.tone && identity.glyph && identity.badge && identity.railWidth === '2px' &&
      /^rgb/.test(identity.railColour),
    `pane identifies its agent by rail + glyph + badge (${identity.tone}/${identity.glyph}/${identity.badge})`);

    // -- state filter: narrow the stage to what is waiting, then clear ----------
    // All in one evaluate, with no round-trip in the middle: any terminal output
    // clears the attention flag (onData does that deliberately), so a test that
    // sets the flag, awaits, then reads is racing the shell. Set, filter, and
    // compare synchronously — and assert the invariant rather than a count.
    const filtered = await win.evaluate(() => {
      for (const s of sessions.values()) clearAttention(s);
      const [id, s] = [...sessions][0];
      setAttention(s, id);
      setStateFilter('attention');
      const visible = [...document.querySelectorAll('.pane')]
        .filter((p) => p.style.display !== 'none').map((p) => p.dataset.id).sort();
      const flagged = [...sessions].filter(([, e]) => e.attention).map(([k]) => k).sort();
      return {
        matches: visible.length === 1 && JSON.stringify(visible) === JSON.stringify(flagged),
        visible: visible.length,
        flagged: flagged.length,
        pressed: document.querySelector('.stf-btn[data-state="attention"]').getAttribute('aria-pressed'),
      };
    });
    ok(filtered.matches && filtered.pressed === 'true',
      `state filter shows exactly the sessions needing attention (${filtered.visible} visible / ${filtered.flagged} flagged)`);
    await win.click('.stf-btn[data-state="attention"]'); // clicking the active filter clears it
    await win.waitForFunction(() =>
      [...document.querySelectorAll('.pane')].every((p) => p.style.display !== 'none'),
      null, { timeout: 10000 });
    ok(await win.evaluate(() => document.querySelector('.stf-btn[data-state="all"]').classList.contains('active')),
      'clicking the active state filter again clears it');
    await win.evaluate(() => { for (const s of sessions.values()) clearAttention(s); });

    // -- keyboard reachability: the sidebar rows are not mouse-only ------------
    const reachable = await win.evaluate(() => {
      const row = document.querySelector('.repo-item[data-repo-id] .repo-row');
      const sess = document.querySelector('.repo-session');
      return {
        repoFocusable: row && row.tabIndex === 0 && row.getAttribute('role') === 'button',
        sessionFocusable: sess && sess.tabIndex === 0 && sess.getAttribute('role') === 'button',
        termAccessible: [...document.querySelectorAll('.pane .xterm')].every((el) => el.querySelector('.xterm-accessibility')),
      };
    });
    ok(reachable.repoFocusable && reachable.sessionFocusable && reachable.termAccessible,
      'repo/session rows are keyboard-reachable and terminals expose an accessibility tree');

    const setWindowMetrics = async (width, height, zoom) => {
      const applied = await app.evaluate(({ BrowserWindow, screen }, metrics) => {
        const bw = BrowserWindow.getAllWindows()[0];
        const display = screen.getDisplayMatching(bw.getBounds());
        const [outerWidth, outerHeight] = bw.getSize();
        const [currentContentWidth, currentContentHeight] = bw.getContentSize();
        const frameWidth = Math.max(0, outerWidth - currentContentWidth);
        const frameHeight = Math.max(0, outerHeight - currentContentHeight);
        // Hosted macOS runners expose a smaller desktop than 1440x920. Preserve
        // the requested CSS viewport by scaling both the physical content size
        // and Chromium zoom together; width*scale / (zoom*scale) is unchanged.
        const maxContentWidth = Math.max(1, display.workArea.width - frameWidth - 16);
        const maxContentHeight = Math.max(1, display.workArea.height - frameHeight - 16);
        const scale = Math.min(1, maxContentWidth / metrics.width, maxContentHeight / metrics.height);
        const contentWidth = Math.max(1, Math.floor(metrics.width * scale));
        const contentHeight = Math.max(1, Math.floor(metrics.height * scale));
        bw.setContentSize(contentWidth, contentHeight);
        bw.webContents.setZoomFactor(metrics.zoom * scale);
        return {
          scale, contentWidth, contentHeight,
          workArea: display.workArea,
          zoomFactor: metrics.zoom * scale,
        };
      }, { width, height, zoom });
      try {
        await win.waitForFunction((expected) =>
          Math.abs(window.innerWidth - expected.width / expected.zoom) < 30 &&
          Math.abs(window.innerHeight - expected.height / expected.zoom) < 30,
        { width, height, zoom }, { timeout: TIMEOUT });
      } catch (err) {
        const actual = await win.evaluate(() => ({
          width: window.innerWidth, height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
        }));
        throw new Error(`UI FAIL: window metrics did not settle: ${JSON.stringify({
          requested: { width, height, zoom }, applied, actual,
        })}`);
      }
    };

    // -- fit layout: eight real PTYs stay inside the stage at 1440x920 ----------
    // BrowserWindow's constructor size is an outer-window request and hosted
    // runners can constrain it differently. Set the content viewport explicitly
    // so this assertion measures the documented 1440x920 layout on every OS.
    await setWindowMetrics(1440, 920, 1);
    for (let i = 0; i < 6; i++) await launchShell(`fit-${i + 1}`, i % 2 ? repo : os.homedir());
    await win.click('.ls-btn[data-cols="fit"]');
    const collectFitState = () => win.evaluate(() => {
      const host = document.querySelector('#grid');
      const gridRect = host.getBoundingClientRect();
      const items = [...host.querySelectorAll('.pane')].map((pane) => {
        const rect = pane.getBoundingClientRect();
        const head = pane.querySelector('.pane-head').getBoundingClientRect();
        const termHost = pane.querySelector('.term-host').getBoundingClientRect();
        const session = sessions.get(pane.dataset.id);
        return {
          left: Math.round(rect.left), top: Math.round(rect.top),
          paneInside: rect.left >= gridRect.left - 1 && rect.right <= gridRect.right + 1 &&
            rect.top >= gridRect.top - 1 && rect.bottom <= gridRect.bottom + 1,
          headerInside: head.top >= rect.top - 1 && head.bottom <= rect.bottom + 1,
          termHeight: termHost.height, rows: session.term.rows, cols: session.term.cols,
        };
      });
      return {
        mode: host.dataset.layout,
        rows: new Set(items.map((item) => item.top)).size,
        cols: new Set(items.map((item) => item.left)).size,
        noScroll: host.scrollHeight <= host.clientHeight + 1 && host.scrollWidth <= host.clientWidth + 1,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        grid: {
          width: gridRect.width, height: gridRect.height,
          clientWidth: host.clientWidth, clientHeight: host.clientHeight,
          scrollWidth: host.scrollWidth, scrollHeight: host.scrollHeight,
        },
        items,
        savedMode: JSON.parse(localStorage.getItem(Workspace.KEY)).layout,
        fitPressed: document.querySelector('.ls-btn[data-cols="fit"]').getAttribute('aria-pressed'),
        autoPressed: document.querySelector('.ls-btn[data-cols="auto"]').getAttribute('aria-pressed'),
      };
    });
    const fitReady = (state) => state.mode === 'fit' && state.savedMode === 'fit' &&
      state.viewport.width >= 1410 && state.viewport.height >= 890 &&
      state.cols === 2 && state.rows === 4 && state.noScroll &&
      state.items.length === 8 && state.items.every((item) =>
        item.paneInside && item.headerInside && item.termHeight > 0 && item.rows >= 8 && item.cols >= 30);
    const fitDeadline = Date.now() + TIMEOUT;
    let fitState = await collectFitState();
    while (!fitReady(fitState) && Date.now() < fitDeadline) {
      await win.waitForTimeout(100);
      fitState = await collectFitState();
    }
    if (!fitReady(fitState)) {
      throw new Error(`UI FAIL: fit layout did not settle: ${JSON.stringify(fitState)}`);
    }
    ok(true, 'fit layout keeps eight usable real terminals in a 2x4 grid');
    ok(fitState.fitPressed === 'true' && fitState.autoPressed === 'false',
      'layout buttons expose the selected state with aria-pressed');

    // Remove only the six fit fixtures so deck persistence keeps alpha-x + beta.
    await win.evaluate(() => {
      for (const [id, s] of [...sessions]) {
        if (s.name.startsWith('fit-')) { clearAttention(s); killSession(id); }
      }
    });
    await win.waitForFunction(() => sessions.size === 2, null, { timeout: TIMEOUT });

    // -- narrow/200% reflow: the sidebar stacks and every surface stays reachable --
    // Two stacked rows since the launch form became a popover (it used to be a
    // third column, and a third row here).
    await setWindowMetrics(900, 600, 1);
    const narrowState = await win.evaluate(() => {
      const sidebarRect = document.querySelector('#sidebar').getBoundingClientRect();
      const stageRect = document.querySelector('#stage').getBoundingClientRect();
      return {
        media: matchMedia('(max-width: 960px)').matches,
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
        stacked: sidebarRect.top < stageRect.top,
        chipsVisible: document.querySelectorAll('#agent-chips .chip').length > 0,
      };
    });
    ok(narrowState.media && narrowState.noHorizontalOverflow && narrowState.stacked && narrowState.chipsVisible,
      '900x600 stacks the sidebar over the stage without horizontal clipping');
    await setWindowMetrics(1440, 920, 2);
    // the popover is fixed-position; open it so its reachability is measured too
    await openForm();
    const zoomState = await win.evaluate(() => {
      const reachable = (selector) => {
        const el = document.querySelector(selector);
        el.scrollIntoView({ block: 'start' });
        const rect = el.getBoundingClientRect();
        return rect.top >= -1 && rect.top < window.innerHeight && rect.right <= window.innerWidth + 1;
      };
      const launchReachable = reachable('#launch');
      const stageReachable = reachable('#stage');
      const newSessionReachable = reachable('#new-session');
      return {
        media: matchMedia('(max-width: 960px)').matches,
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
        launchReachable, stageReachable, newSessionReachable,
        terminalsSized: [...sessions.values()].every((s) => s.term.rows > 0 && s.term.cols > 0),
      };
    });
    ok(zoomState.media && zoomState.noHorizontalOverflow && zoomState.launchReachable &&
      zoomState.newSessionReachable && zoomState.stageReachable && zoomState.terminalsSized,
    '200% zoom reflows without clipping and keeps launch/stage/terminals reachable');
    await win.click('#lp-close');
    await setWindowMetrics(1440, 920, 1);
    await win.evaluate(() => window.scrollTo(0, 0));

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
    ok(await win.evaluate(() => document.querySelectorAll('#preset option').length) === 5, 'custom preset lands in the select');
    await win.keyboard.press('Escape');

    // Keep one real worktree session across the restart. Deck v2 must restore it
    // as a child of svc-a and retain the original diff/merge metadata.
    await openForm();
    await win.selectOption('#preset', 'shell');
    await win.fill('#name', 'wtpersist');
    await win.fill('#cwd', repo);
    await win.check('#wt-enable');
    await win.fill('#wt-branch', 'agentdeck/e2e-persist');
    await win.click('#launch');
    await win.waitForFunction(() =>
      (document.querySelector('.pane.active .pane-name') || {}).textContent === 'wtpersist',
      null, { timeout: TIMEOUT });
    const persistWorktree = await win.evaluate(() =>
      [...sessions.values()].find((s) => s.name === 'wtpersist').worktreePath);
    fs.writeFileSync(path.join(persistWorktree, 'restored.txt'), 'survives restart\n');
    git(persistWorktree, 'add', 'restored.txt');
    git(persistWorktree, 'commit', '-m', 'persisted worktree change');
    const persistHead = git(persistWorktree, 'rev-parse', 'HEAD');

    // -- close guard: live sessions must not vanish on a stray window close ---------
    // Closing the window kills every PTY, which on macOS collides with "closing the
    // window keeps the app running". Declining the prompt has to leave the deck intact.
    const closeWindow = () => app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) w.close();
    });
    dialogAction = 'dismiss';
    await closeWindow();
    await win.waitForTimeout(400);
    ok(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length) === 1,
      'declining the close prompt keeps the window (and its sessions) alive');
    ok(await win.evaluate(() => document.querySelectorAll('.pane').length) > 0,
      'declining the close prompt leaves the panes untouched');
    dialogAction = 'accept';

    // -- real restart: layout + presets persist; the saved deck restores -------------
    // a full close + relaunch (same user-data-dir), not win.reload(): reload keeps the
    // main process alive, orphaning the live PTYs (a state real usage can't produce —
    // and one that wedged app.close() on CI). Restart also tests true persistence.
    await closeHard(app);
    app = await launchApp();
    await attachWindow();
    ok(await win.evaluate(() => document.querySelectorAll('#preset option').length) === 5, 'restart: custom preset persisted');
    ok(await win.evaluate(() => document.querySelector('#grid').dataset.layout) === 'fit',
      'restart: fit layout choice persisted');
    await win.waitForFunction(() => {
      const b = document.querySelector('#restore-deck');
      return b && !b.hidden && b.textContent.includes('(3)');
    }, null, { timeout: TIMEOUT });
    await win.click('#restore-deck');
    // restore launches sequentially and ends by activating the last config (wtpersist) —
    // waiting for that means every spawn has settled before we close the app
    await win.waitForFunction(() =>
      document.querySelectorAll('.pane').length === 3 &&
      (document.querySelector('.pane.active .pane-name') || {}).textContent === 'wtpersist',
      null, { timeout: TIMEOUT });
    const names = await win.evaluate(() => [...document.querySelectorAll('.pane .pane-name')].map((el) => el.textContent));
    ok(names.includes('alpha-x') && names.includes('beta') && names.includes('wtpersist'),
      `restore: deck re-spawned with kept names (${names.join(',')})`);
    const restoredWt = await win.evaluate((repoId) => {
      const s = [...sessions.values()].find((entry) => entry.name === 'wtpersist');
      const group = document.querySelector(`.repo-item[data-repo-id="${CSS.escape(repoId)}"]`);
      const grouped = !!(group && [...group.querySelectorAll('.repo-session-name')]
        .some((el) => el.textContent === 'wtpersist'));
      return {
        ok: !!(s && s.repoId === repoId && s.gitRoot && s.baseSha && s.worktreePath &&
          s.branch === 'agentdeck/e2e-persist' && grouped),
        session: s && {
          repoId: s.repoId, gitRoot: s.gitRoot, baseSha: s.baseSha,
          worktreePath: s.worktreePath, branch: s.branch, baseBranch: s.baseBranch,
        },
        grouped,
        repoMessage: document.querySelector('#repo-msg').textContent,
      };
    }, repo);
    ok(restoredWt.ok, 'restart: restored worktree stays grouped under its parent repo with diff metadata' +
      (restoredWt.ok ? '' : ' ' + JSON.stringify(restoredWt)));
    const staleRestore = await win.evaluate(async (wrongBase) => {
      const good = [...sessions.values()].find((entry) => entry.name === 'wtpersist');
      let safe = true;
      for (const baseSha of ['', wrongBase]) {
        const result = await launch({
          presetKey: 'shell', command: '', name: 'stale-restore', cwd: good.worktreePath,
          worktree: false, branch: '',
          restoreMeta: {
            gitCwd: good.worktreePath, launchCwd: good.launchCwd, repoId: good.repoId,
            baseSha, branch: good.branch, baseBranch: good.baseBranch, gitRoot: good.gitRoot,
            worktreePath: good.worktreePath,
          },
        });
        const stale = sessions.get(result.id);
        safe = safe && !!(result.ok && stale && !stale.gitRoot && !stale.worktreePath);
        if (stale) { clearAttention(stale); killSession(stale.id); }
      }
      focusSession(good.id);
      return safe;
    }, persistHead);
    ok(staleRestore, 'missing or forged non-merge-base restore hints open only safe shells');
    await win.click('.pane.active .pane-diff');
    await win.waitForFunction(() => !document.querySelector('#diff-overlay').hidden, null, { timeout: TIMEOUT });
    ok(await win.evaluate(() => !document.querySelector('#diff-merge').hidden),
      'restart: restored worktree still offers merge/PR actions');
    await win.waitForFunction(() => document.querySelector('#diff-body').textContent.includes('restored.txt'),
      null, { timeout: TIMEOUT });
    ok(true, 'restart: diff still uses the saved base and shows committed worktree changes');
    const rejectedMerge = await win.evaluate(() => window.deck.gitMerge('not-a-live-session'));
    ok(!rejectedMerge.ok, 'main process rejects an unknown Git session before merge');
    git(repo, 'switch', '-c', 'unexpected-base');
    const changedContext = await win.evaluate(() => {
      const s = [...sessions.values()].find((entry) => entry.name === 'wtpersist');
      return window.deck.gitMerge(s.id);
    });
    ok(!changedContext.ok, 'main process rejects merge after the base checkout branch changes');
    git(repo, 'switch', 'main');
    git(repo, 'branch', '-D', 'unexpected-base');
    await win.click('#diff-merge');
    await win.waitForFunction(() => document.querySelector('#diff-meta').textContent.startsWith('✓ merged'),
      null, { timeout: TIMEOUT });
    const mergedFile = fs.readFileSync(path.join(repo, 'restored.txt'), 'utf8').replace(/\r\n/g, '\n');
    ok(mergedFile === 'survives restart\n' &&
      /agentdeck\/e2e-persist/.test(git(repo, 'log', '-1', '--pretty=%s')),
    'restart: validated worktree branch merges successfully into the base checkout');

    // -- sidebar width: the divider is draggable, bounded, and persisted -------
    const sidebarWidthOf = () => win.evaluate(() => document.querySelector('#sidebar').getBoundingClientRect().width);
    await win.focus('#sidebar-resize');
    await win.keyboard.press('ArrowRight');
    ok(Math.round(await sidebarWidthOf()) === 272, 'arrow keys resize the sidebar');
    await win.evaluate(() => applySidebarWidth(9999, true));
    const atMax = Math.round(await sidebarWidthOf());
    const stageAtMax = await win.evaluate(() => document.querySelector('#stage').getBoundingClientRect().width);
    ok(atMax === 480 && stageAtMax >= 841,
      `the sidebar is bounded so the stage keeps two fit columns (${atMax}px / stage ${Math.round(stageAtMax)}px)`);
    await win.evaluate(() => applySidebarWidth(264, true));

    // -- renderer crash: PTYs must not outlive the window that was driving them --
    // Last, because it destroys the renderer. A surviving PTY is an agent that
    // keeps spending tokens and editing the repo with nobody able to see it.
    const logPath = path.join(userDataDir, 'agentdeck.log');
    const livePtys = await win.evaluate(() => sessions.size);
    ok(livePtys > 0, `crash test starts with ${livePtys} live sessions`);
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) w.webContents.forcefullyCrashRenderer();
    }).catch(() => {});
    // main writes the reap synchronously from the render-process-gone handler
    const deadline = Date.now() + 15000;
    let logged = '';
    while (Date.now() < deadline) {
      logged = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
      if (/pty\.reap/.test(logged)) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    ok(/renderer\.gone/.test(logged), 'a renderer crash is recorded in the log');
    const reapLine = (logged.split('\n').find((l) => l.includes('pty.reap')) || '').trim();
    ok(new RegExp(`"count":${livePtys}\\b`).test(reapLine),
      `every PTY is reaped when the renderer dies (${reapLine})`);

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
