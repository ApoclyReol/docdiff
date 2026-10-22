#!/usr/bin/env node
/**
 * Automated security, privacy (GDPR), and build integrity checks for Doc Diff.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const siteHtmlPath = path.join(root, 'site', 'index.html');
const rootHtmlPath = path.join(root, 'DocDiff.html');
const jsDir = path.join(root, 'src', 'js');

assert.ok(fs.existsSync(siteHtmlPath), 'site/index.html must exist');
assert.ok(fs.existsSync(rootHtmlPath), 'DocDiff.html must exist');

const siteHtml = fs.readFileSync(siteHtmlPath, 'utf8');
const rootHtml = fs.readFileSync(rootHtmlPath, 'utf8');

// 1. Both output files must be identical
assert.equal(siteHtml, rootHtml, 'site/index.html and DocDiff.html must be identical');

// 2. Unreplaced template placeholders must not exist
for (const placeholder of [
  '__GEIST_B64__',
  '__GEIST_GREEK_B64__',
  '__GEIST_MONO_B64__',
  '__PDF_JS__',
  '__PDF_WORKER_JS__',
  '__MAMMOTH_JS__',
  '__DIFF_JS__',
]) {
  assert.ok(!siteHtml.includes(placeholder), `Unreplaced placeholder found: ${placeholder}`);
}

// 3. Security & Privacy (GDPR) invariants
assert.ok(
  siteHtml.includes("connect-src 'none'"),
  "CSP must enforce connect-src 'none' to block outbound network traffic"
);
assert.ok(
  siteHtml.includes("form-action 'none'"),
  "CSP must enforce form-action 'none'"
);
assert.ok(
  siteHtml.includes('<meta name="referrer" content="no-referrer" />'),
  'Must include strict no-referrer meta tag'
);
assert.ok(
  !siteHtml.includes('<script src='),
  'Must not include any external <script src=...> tags'
);
assert.ok(
  !siteHtml.includes('cdnjs.cloudflare.com') && !siteHtml.includes('fonts.googleapis.com'),
  'Must not reference any external CDNs or font servers'
);

// Audit our own application code (src/js/*.js, concatenated in build order)
const appJsFiles = fs.readdirSync(jsDir).filter(f => f.endsWith('.js')).sort();
const appJsCode = appJsFiles.map(f => fs.readFileSync(path.join(jsDir, f), 'utf8')).join('\n');
const appScript = appJsCode;

// Compile JS syntax check via node:vm
new vm.Script(appJsCode, { filename: 'src/js/*.js' });

for (const requiredFn of [
  'function revertRowToOriginal(',
  'function startInlineClauseEdit(',
  'function performUndo(',
  'function copyFinalTextToClipboard(',
]) {
  assert.ok(appJsCode.includes(requiredFn), `Missing required function: ${requiredFn}`);
}

// Match any mention (dot, bracket or bare access), not just `localStorage.`
for (const forbiddenStorage of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'caches.open', 'openDatabase']) {
  const pattern = new RegExp(`\\b${forbiddenStorage.replace('.', '\\.')}\\b`);
  assert.ok(
    !pattern.test(appScript),
    `App script must never use ${forbiddenStorage} (strict zero-persistence requirement)`
  );
}

// 4. Verify bilingual i18n parity (de vs en)
const i18nSandbox = {};
vm.runInNewContext(
  fs.readFileSync(path.join(jsDir, '01-i18n.js'), 'utf8') + '\nthis.I18N = I18N;',
  i18nSandbox
);
const { I18N } = i18nSandbox;
assert.ok(I18N && I18N.de && I18N.en, 'Both de and en i18n dictionaries must exist');

const deKeys = Object.keys(I18N.de).sort();
const enKeys = Object.keys(I18N.en).sort();
for (const lang of ['de', 'en']) {
  for (const [key, value] of Object.entries(I18N[lang])) {
    assert.ok(typeof value === 'string' && value.trim(), `i18n ${lang}.${key} must be a non-empty string`);
  }
}
assert.deepEqual(deKeys, enKeys, 'German and English i18n keys must match 1:1');

// The CSP quoted in the docs must match the one that actually ships
const shippedCsp = siteHtml.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/)[1];
for (const doc of ['README.md', 'SECURITY.md']) {
  const quoted = fs.readFileSync(path.join(root, doc), 'utf8').match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/);
  assert.ok(quoted && quoted[1] === shippedCsp, `${doc} must quote the shipped Content-Security-Policy verbatim`);
}

// PDF.js must never compile fonts via eval / new Function (CVE-2024-4367 hardening)
assert.ok(appJsCode.includes('isEvalSupported: false'), 'PDF.js getDocument() must pass isEvalSupported: false');

// 5. Verify site legal and domain files for docdiff.app
for (const siteFile of ['CNAME', 'og-image.png', 'impressum.html', 'datenschutz.html', 'legal.css', 'robots.txt', 'sitemap.xml', '.nojekyll']) {
  const p = path.join(root, 'site', siteFile);
  assert.ok(fs.existsSync(p), `Missing required site file: site/${siteFile}`);
}
assert.equal(fs.readFileSync(path.join(root, 'site', 'CNAME'), 'utf8').trim(), 'docdiff.app', 'CNAME must be docdiff.app');

console.log(`✓ All security, privacy, legal, standalone, and i18n checks passed (${deKeys.length} i18n keys verified).`);

// 6. Unit tests for the pure export builders (docx, HTML, Markdown, file names); fast and dependency-free.
await import('./test-export.mjs');
