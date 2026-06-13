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
  assert.deepEqual(I18n.langs(), ['ja', 'en']);
});

test('resolveLocale: maps OS locale to a supported language, defaults to en', () => {
  assert.equal(I18n.resolveLocale('ja'), 'ja');
  assert.equal(I18n.resolveLocale('ja-JP'), 'ja');
  assert.equal(I18n.resolveLocale('en-US'), 'en');
  assert.equal(I18n.resolveLocale('fr-FR'), 'en'); // unsupported -> fallback
  assert.equal(I18n.resolveLocale(''), 'en');
  assert.equal(I18n.resolveLocale(null), 'en');
});

test('weekdayLabels: 7 labels per language, Sunday first', () => {
  assert.deepEqual(I18n.weekdayLabels('ja'), ['日', '月', '火', '水', '木', '金', '土']);
  assert.equal(I18n.weekdayLabels('en')[0], 'Su');
  assert.equal(I18n.weekdayLabels('en').length, 7);
});

test('dictionary completeness: every key has a non-empty ja AND en string', () => {
  const missing = [];
  for (const [key, entry] of Object.entries(I18n.DICT)) {
    for (const lang of I18n.LANGS) {
      if (typeof entry[lang] !== 'string' || !entry[lang]) missing.push(`${key}.${lang}`);
    }
  }
  assert.deepEqual(missing, [], 'all keys must be fully translated: ' + missing.join(', '));
});

test('dictionary parity: ja and en share the same {param} placeholders per key', () => {
  const ph = (s) => (s.match(/\{(\w+)\}/g) || []).sort().join(',');
  const mismatched = [];
  for (const [key, entry] of Object.entries(I18n.DICT)) {
    if (ph(entry.ja) !== ph(entry.en)) mismatched.push(key);
  }
  assert.deepEqual(mismatched, [], 'ja/en placeholder sets must match: ' + mismatched.join(', '));
});

test('html parity: every data-i18n* key in index.html exists in the dictionary', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  const keys = new Set();
  for (const m of html.matchAll(/\bdata-i18n(?:-ph|-title)?="([^"]+)"/g)) keys.add(m[1]);
  const missing = [...keys].filter((k) => !I18n.DICT[k]);
  assert.deepEqual(missing, [], 'index.html references keys absent from lib/i18n.js: ' + missing.join(', '));
  assert.ok(keys.size >= 40, `expected the chrome to be broadly keyed, got ${keys.size}`);
});
