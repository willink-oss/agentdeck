'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const I18n = require('../lib/i18n');

test('t: returns the language string and interpolates params', () => {
  I18n.setLang('en');
  assert.equal(I18n.t('common.save'), 'Save');
  assert.equal(I18n.t('count.sessions', { n: 3 }), '3 sessions');
  I18n.setLang('ja');
  assert.equal(I18n.t('common.save'), '保存');
  assert.equal(I18n.t('count.sessions', { n: 3 }), '3 セッション');
});

test('t: explicit lang arg overrides current', () => {
  I18n.setLang('ja');
  assert.equal(I18n.t('repos.title', null, 'en'), 'Repositories');
  assert.equal(I18n.t('repos.title', null, 'ja'), 'リポジトリ');
});

test('t: unknown key returns the key (never throws)', () => {
  assert.equal(I18n.t('no.such.key'), 'no.such.key');
  assert.equal(I18n.t('no.such.key', { x: 1 }), 'no.such.key');
});

test('t: missing param is left as the literal placeholder', () => {
  assert.equal(I18n.t('repo.saveFailed', {}, 'en'), 'Failed to save repositories: {error}');
  assert.equal(I18n.t('repo.saveFailed', { error: 'EACCES' }, 'en'), 'Failed to save repositories: EACCES');
});

test('setLang: ignores unsupported languages, keeps current', () => {
  I18n.setLang('en');
  I18n.setLang('zz');
  assert.equal(I18n.getLang(), 'en');
  assert.deepEqual(I18n.langs(), ['ja', 'en', 'zhHans', 'zhHant', 'ko']);
});

test('resolveLocale: maps OS locale to a supported language, defaults to en', () => {
  assert.equal(I18n.resolveLocale('ja'), 'ja');
  assert.equal(I18n.resolveLocale('ja-JP'), 'ja');
  assert.equal(I18n.resolveLocale('en-US'), 'en');
  assert.equal(I18n.resolveLocale('fr-FR'), 'en'); // unsupported -> fallback
  assert.equal(I18n.resolveLocale(''), 'en');
  assert.equal(I18n.resolveLocale(null), 'en');
});

test('resolveLocale: Korean + Chinese script/region routing (issue #10)', () => {
  // Korean
  assert.equal(I18n.resolveLocale('ko'), 'ko');
  assert.equal(I18n.resolveLocale('ko-KR'), 'ko');
  // Simplified: bare zh, explicit Hans, mainland China, Singapore
  assert.equal(I18n.resolveLocale('zh'), 'zhHans');
  assert.equal(I18n.resolveLocale('zh-CN'), 'zhHans');
  assert.equal(I18n.resolveLocale('zh-Hans'), 'zhHans');
  assert.equal(I18n.resolveLocale('zh-SG'), 'zhHans');
  // Traditional: explicit Hant, Taiwan, Hong Kong, Macau
  assert.equal(I18n.resolveLocale('zh-Hant'), 'zhHant');
  assert.equal(I18n.resolveLocale('zh-TW'), 'zhHant');
  assert.equal(I18n.resolveLocale('zh-HK'), 'zhHant');
  assert.equal(I18n.resolveLocale('zh-MO'), 'zhHant');
  // Unsupported still falls back to en
  assert.equal(I18n.resolveLocale('fr'), 'en');
});

test('resolveLocale: explicit zh Hans script wins over a Traditional region', () => {
  // BCP-47: the script subtag is more specific than the region, so an explicit
  // Hans stays Simplified even when the region is Traditional (HK/TW/MO).
  assert.equal(I18n.resolveLocale('zh-Hans-HK'), 'zhHans');
  assert.equal(I18n.resolveLocale('zh-Hans-TW'), 'zhHans');
  assert.equal(I18n.resolveLocale('zh-Hans-MO'), 'zhHans');
  // regression guards: Hant region/script still Traditional; mainland still Simplified
  assert.equal(I18n.resolveLocale('zh-Hant-CN'), 'zhHant');
  assert.equal(I18n.resolveLocale('zh-Hant'), 'zhHant');
  assert.equal(I18n.resolveLocale('zh-CN'), 'zhHans');
});

test('weekdayLabels: 7 labels per language, Sunday first', () => {
  assert.deepEqual(I18n.weekdayLabels('ja'), ['日', '月', '火', '水', '木', '金', '土']);
  assert.equal(I18n.weekdayLabels('en')[0], 'Su');
  assert.equal(I18n.weekdayLabels('en').length, 7);
});

test('LANGS: holds exactly the 5 expected locales with no duplicates', () => {
  const expected = ['ja', 'en', 'zhHans', 'zhHant', 'ko'];
  assert.deepEqual(I18n.langs(), expected);
  assert.equal(new Set(I18n.LANGS).size, I18n.LANGS.length, 'LANGS must not contain duplicates');
  for (const lang of expected) {
    assert.ok(I18n.LANGS.includes(lang), `LANGS missing ${lang}`);
  }
});

test('weekdayLabels: every lang has exactly 7 entries (Sunday first)', () => {
  for (const lang of I18n.LANGS) {
    const w = I18n.weekdayLabels(lang);
    assert.ok(Array.isArray(w), `WEEKDAYS[${lang}] must be an array`);
    assert.equal(w.length, 7, `WEEKDAYS[${lang}] must have 7 entries`);
    for (const label of w) {
      assert.ok(typeof label === 'string' && label, `WEEKDAYS[${lang}] has an empty entry`);
    }
  }
});

test('dictionary completeness: every key has a non-empty string for every LANG', () => {
  const missing = [];
  for (const [key, entry] of Object.entries(I18n.DICT)) {
    for (const lang of I18n.LANGS) {
      if (typeof entry[lang] !== 'string' || !entry[lang]) missing.push(`${key}.${lang}`);
    }
  }
  assert.deepEqual(missing, [], 'all keys must be fully translated: ' + missing.join(', '));
});

test('dictionary parity: every locale shares en\'s {param} placeholders per key', () => {
  const ph = (s) => [...new Set((s.match(/\{(\w+)\}/g) || []))].sort().join(',');
  const mismatched = [];
  for (const [key, entry] of Object.entries(I18n.DICT)) {
    const want = ph(entry.en);
    for (const lang of I18n.LANGS) {
      if (lang === 'en') continue;
      if (ph(entry[lang]) !== want) mismatched.push(`${key}.${lang}`);
    }
  }
  assert.deepEqual(mismatched, [], 'placeholder sets must match en: ' + mismatched.join(', '));
});

test('html parity: every data-i18n* key in index.html exists in the dictionary', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  const keys = new Set();
  for (const m of html.matchAll(/\bdata-i18n(?:-ph|-title|-aria-label)?="([^"]+)"/g)) keys.add(m[1]);
  const missing = [...keys].filter((k) => !I18n.DICT[k]);
  assert.deepEqual(missing, [], 'index.html references keys absent from lib/i18n.js: ' + missing.join(', '));
  assert.ok(keys.size >= 40, `expected the chrome to be broadly keyed, got ${keys.size}`);
});

test('js parity: every static t(\'key\') in renderer JS exists in the dictionary', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '..', 'renderer');
  const keys = new Set();
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    // static-literal subset only (mirrors the html-parity guard above); t(variable) and
    // t(cond ? 'a' : 'b') are intentionally out of scope — the quote must follow t( directly
    for (const m of src.matchAll(/\bt\(\s*(['"])([a-zA-Z0-9_.]+)\1/g)) keys.add(m[2]);
  }
  const missing = [...keys].filter((k) => !I18n.DICT[k]);
  assert.deepEqual(missing, [], 'renderer JS references t() keys absent from lib/i18n.js: ' + missing.join(', '));
  assert.ok(keys.size >= 40, `expected renderer JS to be broadly keyed, got ${keys.size}`);
});
