'use strict';
const { _electron: electron } = require('playwright');
const fs=require('fs'), os=require('os'), path=require('path');
const ROOT = path.join(__dirname, '..');
const ok=(c,m)=>{if(!c)throw new Error('KD FAIL: '+m);console.log('  ✓ '+m);};
const termText = (win) => win.evaluate(() => {
  const s=[...sessions.values()][0], b=s.term.buffer.active, out=[];
  for (let y=0; y<b.length; y++) { const l=b.getLine(y); if (l) out.push(l.translateToString(true)); }
  return out.filter(Boolean).join('\n');
});
(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(),'kd-ud-'));
  const app = await electron.launch({ args:[path.join(ROOT,'main.js'),`--user-data-dir=${ud}`],
    env:{...process.env,AGENTDECK_UPDATE_FEED:'https://127.0.0.1:9/none',AGENTDECK_HEADLESS:'1'}, timeout:60000 });
  const win = await app.firstWindow({timeout:60000});
  win.on('pageerror',e=>console.log('PAGEERROR:',e.message));
  await win.waitForFunction(()=>document.querySelectorAll('#preset option').length>0,null,{timeout:60000});

  ok(await win.evaluate(()=>document.querySelectorAll('#preset option').length)===4,
    'the preset select lists four built-ins (gemini removed)');
  ok(await win.evaluate(()=>[...document.querySelectorAll('#agent-chips .chip')].map(c=>c.dataset.preset).join(','))==='claude,antigravity,codex',
    'the chip bar no longer offers Gemini');

  await win.click('#new-session');
  await win.waitForSelector('#launch-popover .lp-panel',{state:'visible',timeout:20000});
  await win.selectOption('#preset','shell');
  await win.fill('#name','kd');
  await win.fill('#cwd', os.homedir());
  await win.click('#launch');
  await win.waitForFunction(()=>[...document.querySelectorAll('.pane .pane-name')].some(e=>e.textContent==='kd'),null,{timeout:60000});
  await win.waitForTimeout(2000);

  // Through a REAL shell: backslash+CRLF is a line continuation, so `echo A` +
  // Shift+Enter + `B` + Enter must run as one command and print AB. A plain CR
  // would instead run `echo A` and then fail on `B`.
  await win.click('.pane .term-host');
  await win.keyboard.type('echo A');
  await win.keyboard.press('Shift+Enter');
  await win.waitForTimeout(200);
  await win.keyboard.type('B');
  await win.keyboard.press('Enter');
  await win.waitForTimeout(1200);
  const out = await termText(win);
  console.log('--- terminal ---\n' + out.slice(-500) + '\n---------------');
  if (process.platform === 'win32') {
    // PowerShell continues lines with a backtick, not a backslash, so the shell
    // semantics differ. What Agent Deck is responsible for is the sequence
    // reaching the PTY — and the agents this exists for (Claude Code et al)
    // read backslash-continuation in their own input box regardless of host shell.
    ok(/echo A\\/.test(out.replace(/\n/g, '')), 'Shift+Enter typed the continuation sequence into the PTY');
  } else {
    ok(/^AB$/m.test(out), 'Shift+Enter continues the line instead of submitting (shell printed AB)');
    ok(!/command not found/i.test(out), 'the shell never saw a premature submit');
  }

  // A file drop types the quoted path into the same shell.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'kd files-'));
  const img = path.join(dir, 'shot.png');
  fs.writeFileSync(img, 'x');
  const typed = await win.evaluate((p) => {
    // window.deck is frozen by contextBridge and DataTransfer.files is read-only,
    // so drive the same code path the handler uses: quote the path and type it.
    const text = Hooks.dropText([p]);
    const s = [...sessions.values()][0];
    window.deck.input(s.id, text + ' ');
    return text;
  }, img);
  console.log('  dropText ->', JSON.stringify(typed));
  await win.waitForTimeout(800);
  // the terminal wraps long lines, so compare with wrapping removed
  const afterDrop = (await termText(win)).replace(/\n/g, '');
  // the pane is narrow, so only the tail of a long path stays on screen
  ok(afterDrop.includes("shot.png' "),
    'the quoted path reaches the shell line buffer, with its closing quote');
  ok(typed.startsWith("'") && typed.endsWith("'"), `the path is quoted (${typed})`);

  await app.close(); console.log('KD PASS'); process.exit(0);
})().catch(e=>{console.error('KD ERROR:',e.message);process.exit(1);});
