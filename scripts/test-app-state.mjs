#!/usr/bin/env node
/**
 * Regression tests for application-state guards (no browser needed). They cover bugs where
 * an edit, revert or export used rows that were still being re-compared, and where a failed
 * copy or a cancelled print silenced the unsaved-changes warning. Full UI coverage of these
 * paths lives in the Playwright QA scripts; this keeps the essential invariants in `check.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, 'src', 'js', f), 'utf8');
const interactions = read('07-interactions.js');
const exportJs = read('08-export.js');
const session = read('11-session.js');

// Extracts a top-level function declaration by name.
function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

let groups = 0;

// 1. isShownComparisonCurrent(): rows are current only when computed from the current texts.
{
  const ctx = { state: {}, lastComparison: null, calls: [] };
  vm.createContext(ctx);
  vm.runInContext(
    `${extractFunction(interactions, 'isShownComparisonCurrent')}
     ${extractFunction(interactions, 'ensureComparisonCurrent')}
     function runComparison(opts) { calls.push(opts); lastComparison = { request: { leftText: state.leftText, rightText: state.rightText, ignoreHeadersFooters: state.ignoreHeadersFooters } }; }`,
    ctx
  );
  const set = (l, r, hf, req) => {
    vm.runInContext(`state = ${JSON.stringify({ leftText: l, rightText: r, ignoreHeadersFooters: hf })}; lastComparison = ${JSON.stringify(req)};`, ctx);
  };
  const current = () => vm.runInContext('isShownComparisonCurrent()', ctx);
  set('a', 'b', true, null);
  assert.equal(current(), false, 'no comparison yet');
  set('a', 'b', true, { request: { leftText: 'a', rightText: 'b', ignoreHeadersFooters: true } });
  assert.equal(current(), true, 'same texts');
  set('a', 'b2', true, { request: { leftText: 'a', rightText: 'b', ignoreHeadersFooters: true } });
  assert.equal(current(), false, 'right text edited, worker still running');
  set('a2', 'b', true, { request: { leftText: 'a', rightText: 'b', ignoreHeadersFooters: true } });
  assert.equal(current(), false, 'left text replaced');
  set('a', 'b', false, { request: { leftText: 'a', rightText: 'b', ignoreHeadersFooters: true } });
  assert.equal(current(), false, 'header/footer filter toggled');
  set('', '', true, { request: { leftText: '', rightText: '', ignoreHeadersFooters: true } });
  assert.equal(current(), true, 'empty texts');
  // ensureComparisonCurrent() re-compares synchronously only when needed.
  set('a', 'b2', true, { request: { leftText: 'a', rightText: 'b', ignoreHeadersFooters: true } });
  vm.runInContext('calls.length = 0; ensureComparisonCurrent(); ensureComparisonCurrent();', ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.calls)), [{ sync: true }], 'one synchronous re-comparison');
  groups++;
}

// 2. Edit, revert and export entry points use the guards.
{
  const startEdit = extractFunction(interactions, 'startInlineClauseEdit');
  assert.match(startEdit, /if \(!isShownComparisonCurrent\(\)\) return;/, 'edits wait for the running comparison');
  assert.match(startEdit, /state\.rightText !== rightTextAtOpen \|\| !isShownComparisonCurrent\(\)/, 'stale editors are discarded');
  assert.match(extractFunction(interactions, 'revertRowToOriginal'), /!isShownComparisonCurrent\(\)/, 'reverts wait');
  assert.match(extractFunction(exportJs, 'handleExportAction'), /ensureComparisonCurrent\(\);/, 'exports re-compare first');
  assert.match(extractFunction(exportJs, 'preparePrintView'), /ensureComparisonCurrent\(\)/, 'printing re-compares first');
  groups++;
}

// 3. Only real downloads mark the session as saved; a failed copy is never reported as copied.
{
  const m = session.match(/const SESSION_CLEANING_EXPORTS = (\[[^\]]*\]);/);
  assert.ok(m, 'SESSION_CLEANING_EXPORTS present');
  const list = vm.runInNewContext(m[1]);
  assert.deepEqual([...list].sort(), ['html', 'md', 'txt', 'word']);
  const copy = extractFunction(exportJs, 'copyFinalTextToClipboard');
  assert.match(copy, /if \(copied\) flashCopied\(\);/, 'copied label only after a successful copy');
  groups++;
}

// 4. Undo/Redo buttons are updated right away (not only after a long comparison) and keep focus.
{
  assert.match(extractFunction(interactions, 'performUndo'), /updateUndoRedoButtons\(\);\s*runComparison\(\);/);
  assert.match(extractFunction(interactions, 'performRedo'), /updateUndoRedoButtons\(\);\s*runComparison\(\);/);
  assert.match(extractFunction(interactions, 'resetEditHistory'), /state\.activeRowId = null;/, 'stale selection reset');
  groups++;
}

console.log(`✓ App state guard tests passed (${groups} groups).`);
