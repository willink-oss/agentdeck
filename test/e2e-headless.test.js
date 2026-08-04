'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/* e2e drives a real Electron app. Without AGENTDECK_HEADLESS the window takes
 * over the developer's screen for the length of the run, which on a full suite
 * is minutes of not being able to work. That is not a preference to remember —
 * it is a rule a new harness must not be able to forget, so it fails here.
 *
 * (Linux CI additionally runs under xvfb; this covers macOS, Windows, and every
 * local run.) */

const DIR = path.join(__dirname, '..', 'e2e');
const harnesses = fs.readdirSync(DIR).filter((f) => f.endsWith('.cjs'));

test('there are e2e harnesses to check', () => {
  assert.ok(harnesses.length >= 4, `expected the suite to exist, found ${harnesses.join(', ')}`);
});

for (const file of harnesses) {
  test(`${file} launches Electron headless`, () => {
    const src = fs.readFileSync(path.join(DIR, file), 'utf8');
    if (!/electron\.launch\(/.test(src)) return; // a helper, not a harness
    assert.match(src, /AGENTDECK_HEADLESS:\s*'1'/,
      `${file} calls electron.launch() without AGENTDECK_HEADLESS — it would open a window on the developer's screen`);
  });
}

test('main.js honours the flag', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /show:\s*process\.env\.AGENTDECK_HEADLESS !== '1'/,
    'main.js must map AGENTDECK_HEADLESS=1 to a hidden window');
});
