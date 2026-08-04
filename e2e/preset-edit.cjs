'use strict';
const { _electron: electron } = require('playwright');
const fs=require('fs'), os=require('os'), path=require('path');
const ROOT = path.join(__dirname, '..');
const ok=(c,m)=>{if(!c)throw new Error('PE FAIL: '+m);console.log('  ✓ '+m);};
(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(),'pe-ud-'));
  const launch = () => electron.launch({ args:[path.join(ROOT,'main.js'),`--user-data-dir=${ud}`],
    env:{...process.env,AGENTDECK_UPDATE_FEED:'https://127.0.0.1:9/none',AGENTDECK_HEADLESS:'1'}, timeout:60000 });
  let app = await launch();
  let win = await app.firstWindow({timeout:60000});
  win.on('pageerror',e=>console.log('PAGEERROR:',e.message));
  await win.waitForFunction(()=>document.querySelectorAll('#preset option').length>0,null,{timeout:60000});
  await win.evaluate(()=>setLanguage('ja'));

  await win.click('#preset-manage');
  await win.waitForFunction(()=>!document.querySelector('#preset-overlay').hidden,null,{timeout:20000});

  // built-ins now offer 編集, and the command field is writable
  await win.evaluate(()=>{ [...document.querySelectorAll('#preset-list .preset-row')]
      .find(r=>r.textContent.includes('Claude Code')).querySelector('.ghost-btn').click(); });
  await win.waitForTimeout(300);
  ok(await win.evaluate(()=>!document.querySelector('#preset-cmd-input').disabled),
    'a built-in command field is editable');
  ok(await win.evaluate(()=>document.querySelector('#preset-cmd-input').value)==='claude',
    'it starts at the shipped default');
  ok(await win.evaluate(()=>document.querySelector('#preset-reset').hidden),
    'no "reset" offered while it is still the default');

  const CUSTOM = 'claude --model opus --effort ultracode';
  await win.fill('#preset-cmd-input', CUSTOM);
  await win.click('#preset-submit');
  await win.waitForTimeout(400);

  ok(await win.evaluate(()=>commandFor('claude','default'))===CUSTOM, 'the launch command now carries the options');
  ok(await win.evaluate(()=>commandFor('claude','plan'))===CUSTOM+' --permission-mode plan',
    'profiles append to the edited base, not the shipped one');
  ok(await win.evaluate(()=>[...document.querySelectorAll('#preset-list .preset-row')]
      .find(r=>r.textContent.includes('Claude Code')).textContent.includes('変更済み')),
    'the list marks it as edited');
  ok(await win.evaluate(()=>document.querySelector('#command').value)===CUSTOM,
    'the launch form picks up the new command');

  // survives a restart
  await app.close(); app = await launch(); win = await app.firstWindow({timeout:60000});
  await win.waitForFunction(()=>document.querySelectorAll('#preset option').length>0,null,{timeout:60000});
  await win.evaluate(()=>setLanguage('ja'));
  ok(await win.evaluate(()=>commandFor('claude','default'))===CUSTOM, 'the edit survives a restart');

  // reset restores the shipped default
  await win.click('#preset-manage');
  await win.waitForFunction(()=>!document.querySelector('#preset-overlay').hidden,null,{timeout:20000});
  await win.evaluate(()=>{ [...document.querySelectorAll('#preset-list .preset-row')]
      .find(r=>r.textContent.includes('Claude Code')).querySelector('.ghost-btn').click(); });
  await win.waitForTimeout(300);
  ok(!(await win.evaluate(()=>document.querySelector('#preset-reset').hidden)), '"reset to default" is offered once edited');
  await win.click('#preset-reset');
  await win.waitForTimeout(400);
  ok(await win.evaluate(()=>commandFor('claude','default'))==='claude', 'reset restores the shipped command');
  ok(await win.evaluate(()=>Presets.BUILTINS.claude.cmd)==='claude', 'the shipped table was never mutated');

  await app.close(); console.log('PE PASS'); process.exit(0);
})().catch(e=>{console.error('PE ERROR:',e.message);process.exit(1);});
