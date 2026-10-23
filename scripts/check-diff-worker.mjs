#!/usr/bin/env node
/**
 * Verifies the comparison Web Worker bundled into site/index.html:
 *  - it is built from the current src/js sources (shared code, not a hand-made copy),
 *  - it produces exactly the same results as the main-thread code path (the synchronous
 *    fallback) on the built-in samples (de + en) and on synthetic documents,
 *  - the alignment fallbacks for huge inputs and the incremental single-row update are sane.
 *
 * The worker is executed in a node:vm context that emulates a dedicated worker global scope;
 * messages pass through structuredClone exactly like postMessage in a browser.
 * Runs standalone or via scripts/check.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const jsDir = path.join(root, 'src', 'js');
const read = p => fs.readFileSync(p, 'utf8');

const siteHtml = read(path.join(root, 'site', 'index.html'));
const literal = siteHtml.match(/const DIFF_WORKER_SOURCE = ("(?:[^"\\]|\\.)*");/);
assert.ok(literal, 'site/index.html must embed the comparison worker source (DIFF_WORKER_SOURCE)');
const workerSource = JSON.parse(literal[1]);
assert.ok(!/<\/script/i.test(literal[1]), 'Embedded worker source must not contain a closing script tag');

for (const shared of ['04-core.js', '04a-align.js']) {
  assert.ok(
    workerSource.includes(read(path.join(jsDir, shared))),
    `Worker must embed the current src/js/${shared} verbatim (rebuild with scripts/build.py)`
  );
}

// ── Main-thread reference: the same sources the page concatenates ──────────────────────────
function createMainContext(transformAlign = s => s) {
  const ctx = { console };
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(read(path.join(root, 'vendor', 'libs', 'diff.min.js')), ctx);
  vm.runInContext(read(path.join(jsDir, '01-i18n.js')), ctx);
  vm.runInContext(read(path.join(jsDir, '02-samples.js')), ctx);
  vm.runInContext(
    'var __lang = "de"; function t(key) { return I18N[__lang][key] || I18N.de[key] || key; }' +
      'this.__I18N = I18N; this.__SAMPLES = SAMPLES;',
    ctx
  );
  vm.runInContext(read(path.join(jsDir, '04-core.js')), ctx);
  vm.runInContext(transformAlign(read(path.join(jsDir, '04a-align.js'))), ctx);
  return ctx;
}

// ── Worker: the exact string shipped in the page, run in a worker-like global ──────────────
function createWorkerContext() {
  const outbox = [];
  const ctx = { console, postMessage: msg => outbox.push(structuredClone(msg)) };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(workerSource, ctx, { filename: 'diff-worker.js' });
  assert.equal(typeof ctx.onmessage, 'function', 'Worker must install self.onmessage');
  assert.deepEqual(outbox.shift(), { type: 'ready' }, 'Worker must announce readiness');
  return {
    run(request, id) {
      ctx.onmessage({ data: structuredClone({ type: 'compare', id, request }) });
      const messages = outbox.splice(0);
      return messages;
    },
  };
}

const main = createMainContext();
const worker = createWorkerContext();

function mainCompare(request, lang) {
  main.__lang = lang;
  main.__req = request;
  return structuredClone(vm.runInContext('computeComparison(__req)', main));
}

const words =
  'der die das und Auftragnehmer Auftraggeber Vergütung Frist Leistung Vertrag gemäß Anlage Zahlung binnen Tagen Rechnung schriftlich Kündigung Haftung Abnahme Mangel Termin Euro netto'.split(
    ' '
  );
function synthetic(n, seed, editRate = 0.12) {
  let r = seed;
  const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  const para = () =>
    Array.from({ length: 6 + Math.floor(rnd() * 28) }, () => words[Math.floor(rnd() * words.length)]).join(' ') + '.';
  const left = [];
  let sec = 1;
  for (let i = 0; i < n; i++) {
    if (i % 25 === 0) left.push(`=== [SEITE ${i / 25 + 1}] ===`);
    if (i % 25 === 0) left.push(`[[HF]] Vertrag Fassung 1 · Seite ${i / 25 + 1}`);
    if (rnd() < 0.08) left.push(`§ ${sec++} ${words[Math.floor(rnd() * words.length)]}`);
    else left.push(`(${(i % 9) + 1}) ${para()}`);
  }
  const right = [];
  for (const line of left) {
    const x = rnd();
    if (line.startsWith('===') || line.startsWith('[[HF]]')) right.push(line.replace('Fassung 1', 'Fassung 2'));
    else if (x < editRate / 3) continue;
    else if (x < editRate) right.push(line.replace(/\b(\d+)\b/, m => String(Number(m) + 1)).replace('Frist', 'Zahlungsfrist 14,5 Tage'));
    else right.push(line);
    if (rnd() < editRate / 4) right.push(`(${Math.floor(rnd() * 9) + 1}) ${para()}`);
  }
  return [left.join('\n\n'), right.join('\n\n')];
}

const cases = [];
for (const lang of ['de', 'en']) {
  const sample = main.__SAMPLES[lang];
  cases.push([`sample-${lang}`, lang, sample.v1, sample.v2]);
  cases.push([`sample-${lang}-swapped`, lang, sample.v2, sample.v1]);
}
cases.push(['synthetic-120', 'de', ...synthetic(120, 1)]);
cases.push(['synthetic-450-heavy', 'de', ...synthetic(450, 2, 0.45)]);
cases.push(['synthetic-1500', 'de', ...synthetic(1500, 3)]);
cases.push(['one-side-empty', 'de', 'Nur links.\n\nZweiter Absatz.', '']);
cases.push(['both-empty', 'de', '', '']);

let jobId = 0;
for (const [name, lang, leftText, rightText] of cases) {
  for (const ignoreHeadersFooters of [true, false]) {
    const request = {
      leftText,
      rightText,
      ignoreHeadersFooters,
      labels: { typeHf: main.__I18N[lang].typeHf },
    };
    const id = ++jobId;
    const messages = worker.run(request, id);
    const result = messages.find(m => m.type === 'result');
    assert.ok(result, `${name}: worker must post a result (got ${JSON.stringify(messages.map(m => m.type))})`);
    assert.equal(result.id, id, `${name}: result must carry the request id`);
    const progress = messages.filter(m => m.type === 'progress').map(m => m.value);
    for (let i = 1; i < progress.length; i++) {
      assert.ok(progress[i] >= progress[i - 1], `${name}: progress must be monotonic`);
    }
    if (progress.length) assert.equal(progress[progress.length - 1], 1, `${name}: progress must end at 1`);

    const expected = mainCompare(request, lang);
    assert.deepStrictEqual(
      result.result,
      expected,
      `${name} (ignoreHeadersFooters=${ignoreHeadersFooters}): worker and main thread results differ`
    );
    // Rows must keep referencing the block objects of the block lists after cloning.
    const rows = result.result.alignedRows;
    if (rows.length) {
      const rightSet = new Set(result.result.rightBlocks);
      assert.ok(rows.every(r => !r.rightBlock || rightSet.has(r.rightBlock)), `${name}: block identity lost`);
    }
  }
}

// ── Alignment fallbacks for very long documents (small limits to keep this check fast) ────
const tiny = createMainContext(src =>
  src
    .replace(/const ALIGN_FULL_DP_MAX_CELLS = \d+;/, 'const ALIGN_FULL_DP_MAX_CELLS = 400;')
    .replace(/const ALIGN_EXACT_DP_MAX_CELLS = \d+;/, 'const ALIGN_EXACT_DP_MAX_CELLS = 900;')
);
for (const [name, leftText, rightText] of [
  ['anchored', ...synthetic(300, 4, 0.3)],
  [
    'banded (no anchors)',
    ...synthetic(200, 5, 0.2).map((s, k) =>
      k ? s.split('\n\n').map(l => (l.startsWith('===') ? l : `${l} ergänzt`)).join('\n\n') : s
    ),
  ],
]) {
  tiny.__req = { leftText, rightText, ignoreHeadersFooters: true, labels: { typeHf: 'HF' } };
  const res = vm.runInContext('computeComparison(__req)', tiny);
  const li = res.alignedRows.filter(r => r.leftBlock).map(r => r.leftBlock.index);
  const ri = res.alignedRows.filter(r => r.rightBlock).map(r => r.rightBlock.index);
  assert.deepEqual(li, res.leftBlocks.map(b => b.index), `${name}: every left block exactly once, in order`);
  assert.deepEqual(ri, res.rightBlocks.map(b => b.index), `${name}: every right block exactly once, in order`);
}

// ── Incremental single-row update must equal a full re-comparison for simple edits ─────────
{
  main.__lang = 'de';
  const sample = main.__SAMPLES.de;
  const labels = { typeHf: main.__I18N.de.typeHf };
  const base = { leftText: sample.v1, rightText: sample.v2, ignoreHeadersFooters: true, labels };
  main.__req = base;
  const prev = { request: base, result: vm.runInContext('computeComparison(__req)', main) };
  const modified = prev.result.alignedRows.find(r => r.type === 'modified' && !r.rightBlock.isHeaderFooter);
  const edits = [
    ['edit', sample.v2.replace(modified.rightBlock.text, modified.rightBlock.text + ' Ergänzt.')],
    ['revert', sample.v2.replace(modified.rightBlock.text, modified.leftBlock.text)],
  ];
  for (const [label, rightText] of edits) {
    main.__prev = prev;
    main.__req = { ...base, rightText };
    const inc = vm.runInContext('computeIncrementalComparison(__prev, __req)', main);
    assert.ok(inc, `incremental ${label}: fast path expected for a single-row change`);
    const full = vm.runInContext('computeComparison(__req)', main);
    const sig = rows =>
      rows.map(r => [r.id, r.type, r.leftBlock && r.leftBlock.index, r.rightBlock && r.rightBlock.text, JSON.stringify(r.wordDiffs)].join('|'));
    assert.deepEqual(sig(inc.result.alignedRows), sig(full.alignedRows), `incremental ${label} must match a full comparison`);
  }
}

console.log(`✓ Comparison worker matches the main-thread results (${jobId} comparisons).`);
