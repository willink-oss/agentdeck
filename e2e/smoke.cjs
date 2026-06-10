'use strict';
/*
 * Headless launch smoke test — Windows / Linux / macOS.
 *
 * Docker can't faithfully run the Electron GUI cross-OS (no Windows containers on
 * Linux/macOS hosts; Linux containers have no real display/GPU), so the runtime is
 * verified on real CI runners instead. This proves the four things that actually
 * differ per OS and that unit tests (lib/ only) never exercise:
 *   1. the Electron main process boots and opens a window,
 *   2. the preload bridge (window.deck) loads under contextIsolation,
 *   3. IPC round-trips main <-> renderer (app:info),
 *   4. the node-pty NATIVE module spawns a real shell and streams bytes
 *      (ConPTY on Windows, forkpty on *nix) — the dep most likely to break per-OS.
 * It also confirms the renderer scripts executed (boot fills the #preset <select>).
 * This is a boot/runtime smoke, NOT a visual/rendering check.
 *
 * Run locally:
 *   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i --no-save playwright
 *   npm run rebuild          # build node-pty against Electron's ABI
 *   node e2e/smoke.cjs       # Linux needs a display: xvfb-run node e2e/smoke.cjs
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TIMEOUT = 60000;
const fail = (msg) => { console.error('SMOKE FAIL:', msg); process.exitCode = 1; throw new Error(msg); };

/** Close the app but never let teardown decide the test's fate: a graceful close
 *  gets 15s, then the Electron child is SIGKILLed (app.close() has wedged after
 *  fully green runs on both CI and local machines). */
async function closeHard(app) {
  if (!app) return;
  try { await Promise.race([app.close(), new Promise((r) => setTimeout(r, 15000))]); } catch (_) {}
  try { const p = app.process(); if (p && !p.killed) p.kill('SIGKILL'); } catch (_) {}
}

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-smoke-'));
  const app = await electron.launch({
    // main.js is the app entry; --user-data-dir is a Chromium switch consumed by
    // Electron itself (not by main.js) so each run gets an isolated, throwaway profile.
    args: [path.join(ROOT, 'main.js'), `--user-data-dir=${userDataDir}`],
    // Fail the update check fast instead of reaching GitHub (and possibly hanging on rate limits) in CI.
    env: { ...process.env, AGENTDECK_UPDATE_FEED: 'https://127.0.0.1:9/none' },
    timeout: TIMEOUT,
  });

  try {
    const win = await app.firstWindow({ timeout: TIMEOUT });
    // collect renderer errors and FAIL on them: with the renderer split across multiple
    // classic <script>s, one file throwing no longer stops boot, so a green "#preset
    // option" wait alone could mask a broken script — pageerror is the reliable signal.
    const pageErrors = [];
    win.on('pageerror', (e) => { pageErrors.push(e && e.message); console.error('renderer pageerror:', e && e.message); });
    await win.waitForLoadState('domcontentloaded');

    // 1) Renderer shell is present and the renderer scripts ran (boot builds #preset options).
    await win.waitForSelector('#repo-list', { timeout: TIMEOUT });
    const title = (await win.textContent('.repos-title')) || '';
    if (!/Repositories/i.test(title)) fail('repo sidebar did not render');
    await win.waitForFunction(() => document.querySelectorAll('#preset option').length > 0, null, { timeout: 20000 });

    // 2) Preload bridge is wired under contextIsolation.
    const hasDeck = await win.evaluate(() => !!(window.deck && typeof window.deck.appInfo === 'function'));
    if (!hasDeck) fail('preload bridge (window.deck) missing');

    // 3) IPC round-trip main <-> renderer.
    const info = await win.evaluate(() => window.deck.appInfo());
    if (!info || !info.platform) fail('app:info IPC returned nothing');
    console.log(`SMOKE: platform=${info.platform} shell=${info.defaultShell}`);

    // 4) node-pty native module: spawn a shell in a temp dir and see bytes flow.
    const pty = await win.evaluate(() => new Promise((resolve) => {
      const id = 'smoke-pty';
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      window.deck.onData((p) => { if (p && p.id === id) finish({ ok: true }); });
      window.deck.spawn({ id, cwd: '', cols: 80, rows: 24 }).then((r) => {
        if (!r || !r.ok) return finish({ ok: false, error: (r && r.error) || 'spawn rejected' });
        // Nudge a silent shell into emitting something; a prompt usually arrives first anyway.
        setTimeout(() => window.deck.input(id, 'echo agentdeck-smoke\r'), 300);
        setTimeout(() => finish({ ok: false, error: 'no pty data within 10s' }), 10000);
      }, (e) => finish({ ok: false, error: String(e) }));
    }));
    if (!pty.ok) fail('node-pty spawn failed: ' + pty.error);
    console.log('SMOKE: node-pty spawned a shell and streamed output');

    if (pageErrors.length) fail(`renderer threw ${pageErrors.length} error(s): ${pageErrors.join(' | ')}`);
    console.log('SMOKE PASS');
  } finally {
    await closeHard(app);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
  }
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = process.exitCode || 1;
}).finally(() => process.exit(process.exitCode || 0)); // teardown must never wedge a green run
