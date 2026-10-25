import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const chinese = read('DocDiff_简体中文.html');
const original = read('DocDiff.html');
const source = read('src/js/01-i18n.js');
const sandbox = {};
vm.runInNewContext(source + '\nthis.strings = I18N["zh-CN"];', sandbox);
const strings = sandbox.strings;
const policy = html => html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/)[1];
assert.equal(policy(chinese), policy(original), 'Chinese file preserves the complete security policy');
assert.ok(chinese.includes('<html lang="zh-CN" data-page-lang="zh-CN">'));
assert.ok(chinese.includes(`<title>${strings.metaTitle}</title>`));
assert.ok(!/<script[^>]*\bsrc=|<link[^>]*rel="stylesheet"/.test(chinese), 'Chinese file is self-contained');
assert.ok(!/href="(?:favicon.ico|apple-touch-icon.png|manifest.webmanifest)"/.test(chinese), 'no adjacent asset dependencies');
for (const id of ['lib-pdfjs', 'pdfjs-worker-source', 'lib-mammoth']) {
  const content = html => html.match(new RegExp(`<script type="text/plain" id="${id}">([\\s\\S]*?)</script>`))[1];
  assert.equal(content(chinese), content(original), `${id}: same embedded parser source`);
}
const markup = chinese.slice(chinese.indexOf('<body>'), chinese.indexOf('<script type="text/plain" id="lib-pdfjs">'));
const decode = value => value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
const plain = value => decode(value.replace(/<\/p>\s*<p>/g, ' ').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
let translated = 0;
for (const m of markup.matchAll(/<(\w+)[^>]*?\sdata-i18n(-html)?="(\w+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
  assert.equal(m[2] ? m[4] : decode(m[4]), strings[m[3]], `Chinese static markup: ${m[3]}`);
  translated++;
}
assert.ok(translated > 40);
assert.ok(!/Änderungen|Geprüft|Prüfstand|Alte Fassung|Neue Fassung/.test(markup), 'no German fallback UI');
const data = JSON.parse(chinese.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
const faq = data['@graph'].find(node => node['@type'] === 'FAQPage');
assert.equal(faq.inLanguage, 'zh-CN');
const visibleFaq = [...markup.matchAll(/<details class="faq-item">\s*<summary[^>]*>([\s\S]*?)<\/summary>\s*<div class="faq-answer"[^>]*>([\s\S]*?)<\/div>\s*<\/details>/g)].map(m => ({q:plain(m[1]),a:plain(m[2])}));
assert.deepEqual(faq.mainEntity.map(item => ({q:item.name,a:item.acceptedAnswer.text})), visibleFaq, 'Chinese FAQ metadata matches visible text');

// Detect the locale from the browser or an explicit page language without a DOM implementation.
for (const [browser, pinned, expected] of [
  ['zh-CN', null, 'zh-CN'], ['zh-SG', null, 'zh-CN'], ['en-US', null, 'en'],
  ['de-DE', null, 'de'], ['fr-FR', null, 'en'],
  ['en-US', 'zh-CN', 'zh-CN'], ['zh-CN', 'en', 'en'], ['zh-CN', 'de', 'de'],
]) {
  const context = {navigator:{language:browser}, document:{documentElement:{getAttribute:()=>pinned}}};
  vm.runInNewContext(read('src/js/02-samples.js')+'\nthis.detected = initialLang;', context);
  assert.equal(context.detected, expected, `locale selection ${browser}/${pinned}`);
}
console.log('✓ Simplified Chinese standalone build, static UI, FAQ and locale detection checks passed.');
