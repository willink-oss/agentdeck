'use strict';
/* End-to-end check of the hook listener against the real main process:
 * launch a claude-preset session, find the settings file it wrote, POST a
 * Notification to the URL inside it, and confirm the pane lights up — plus that
 * a forged token and a foreign session id do not. */
const { _electron: electron } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const ok = (c, m) => { if (!c) throw new Error('HOOK FAIL: ' + m); console.log('  ✓ ' + m); };

const postTo = (url, body) => new Promise((resolve) => {
  const u = new URL(url);
  const req = require('http').request({
    hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  req.on('error', () => resolve(0));
  req.end(JSON.stringify(body));
});

(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-ud-'));
  const app = await electron.launch({
    args: [path.join(ROOT, 'main.js'), `--user-data-dir=${ud}`],
    env: { ...process.env, AGENTDECK_UPDATE_FEED: 'https://127.0.0.1:9/none' },
    timeout: 60000,
  });
  const win = await app.firstWindow({ timeout: 60000 });
  win.on('dialog', (d) => d.accept());
  await win.waitForFunction(() => document.querySelectorAll('#preset option').length > 0, null, { timeout: 60000 });

  // a claude-preset session; the command is a harmless stand-in for the real CLI
  await win.click('#new-session');
  await win.waitForSelector('#launch-popover .lp-panel', { state: 'visible', timeout: 20000 });
  await win.selectOption('#preset', 'claude');
  await win.fill('#command', 'claude');
  await win.fill('#name', 'hooked');
  await win.fill('#cwd', os.homedir());
  await win.click('#launch');
  await win.waitForFunction(() =>
    [...document.querySelectorAll('.pane .pane-name')].some((e) => e.textContent === 'hooked'), null, { timeout: 60000 });
  await win.waitForTimeout(2500); // the settings file is written as the startup command is issued

  const hooksDir = path.join(ud, 'hooks');
  const files = fs.existsSync(hooksDir) ? fs.readdirSync(hooksDir) : [];
  ok(files.length === 1, `a settings file was written for the session (${files.join(',')})`);
  const settingsPath = path.join(hooksDir, files[0]);
  const mode = (fs.statSync(settingsPath).mode & 0o777).toString(8);
  ok(mode === '600', `the settings file is 0600, not world-readable (${mode})`);

  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const url = settings.hooks.Notification[0].hooks[0].url;
  ok(/^http:\/\/127\.0\.0\.1:\d+\/hook\//.test(url), `the hook URL is loopback-only (${url.replace(/\/[a-f0-9]{20,}$/, '/<token>')})`);

  const sessionId = await win.evaluate(() => [...sessions.keys()][0]);
  ok(url.includes(sessionId), 'the URL names this session');

  // the real thing
  const code = await postTo(url, { hook_event_name: 'Notification', session_id: 'x' });
  ok(code === 200, `a genuine Notification is accepted (${code})`);
  await win.waitForFunction((id) => (sessions.get(id) || {}).attention === true, sessionId, { timeout: 10000 });
  ok(true, 'the pane is flagged as needing attention, without any terminal heuristic');
  ok(await win.evaluate((id) => sessions.get(id).hookDriven === true, sessionId),
    'the session is marked hook-driven, so the heuristic stops guessing');

  // a busy event clears it again
  await postTo(url, { hook_event_name: 'PreToolUse' });
  await win.waitForFunction((id) => (sessions.get(id) || {}).attention === false, sessionId, { timeout: 10000 });
  ok(true, 'a busy event clears the flag');

  // and the things that must not work
  const forged = url.replace(/\/[a-f0-9]+$/, '/' + 'f'.repeat(64));
  ok(await postTo(forged, { hook_event_name: 'Notification' }) === 404, 'a forged token is refused');
  const foreign = url.replace(sessionId, 'sess_9_zzzz');
  ok(await postTo(foreign, { hook_event_name: 'Notification' }) === 404, 'an unknown session is refused');
  const traversal = url.replace(/\/hook\//, '/hook/../');
  ok(await postTo(traversal, { hook_event_name: 'Notification' }) !== 200, 'a traversal-shaped path is refused');
  ok(await win.evaluate((id) => (sessions.get(id) || {}).attention === false, sessionId),
    'none of the refused requests changed the pane');

  // killing the session revokes the token and removes the file
  await win.evaluate((id) => killSession(id), sessionId);
  await win.waitForTimeout(800);
  ok(!fs.existsSync(settingsPath), 'killing the session removes its settings file');
  ok(await postTo(url, { hook_event_name: 'Notification' }) === 404, 'a killed session is no longer addressable');

  try { await app.close(); } catch (_) {}
  try { const p = app.process(); if (p && !p.killed) p.kill('SIGKILL'); } catch (_) {}
  console.log('HOOK PASS');
  process.exit(0);
})().catch((e) => { console.error('HOOK ERROR:', e.message); process.exit(1); });
