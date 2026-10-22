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

// 4. Undo/Redo menu items are updated right away (not only after a long comparison); a step that
//    only changes the review status refreshes it without a re-comparison.
{
  for (const fn of ['performUndo', 'performRedo']) {
    assert.match(
      extractFunction(interactions, fn),
      /updateUndoRedoButtons\(\);\s*if \(changed\) runComparison\(\);\s*else refreshReviewState\(\);/
    );
  }
  assert.match(extractFunction(interactions, 'resetEditHistory'), /state\.activeRowId = null;/, 'stale selection reset');
  groups++;
}

// 5. Editing one paragraph changes exactly that paragraph of the revised text: hidden
//    header/footer lines, page breaks and the order of all other blocks are kept, so the
//    re-comparison keeps the header/footer filter (regression: the sample jumped 22 -> 26).
{
  const ctx = { console };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'vendor/libs/diff.min.js'), 'utf8'), ctx);
  vm.runInContext('var t = key => key;', ctx);
  for (const f of ['02-samples.js', '04-core.js', '04a-align.js']) vm.runInContext(read(f), ctx, { filename: f });
  vm.runInContext(
    `${extractFunction(interactions, 'rebuildRightTextFromRows')}
     ${extractFunction(interactions, 'sameBlock')}
     var state = {};
     function compareNow() {
       const r = computeComparison({ leftText: state.leftText, rightText: state.rightText, ignoreHeadersFooters: state.ignoreHeadersFooters, labels: { typeHf: 'HF' } });
       state.alignedRows = r.alignedRows; state.rightAllBlocks = r.allRightBlocks;
       return r;
     }`,
    ctx
  );
  let edits = 0;
  for (const lang of ['de', 'en']) {
    for (const hf of [true, false]) {
      const base = vm.runInContext(
        `state = { leftText: SAMPLES.${lang}.v1, rightText: SAMPLES.${lang}.v2, ignoreHeadersFooters: ${hf} }; compareNow();`,
        ctx
      );
      const ids = base.alignedRows.filter(r => r.rightBlock && !r.rightBlock.isHeaderFooter).map(r => r.id);
      for (const id of ids) {
        const res = vm.runInContext(
          `(() => {
            state.rightText = SAMPLES.${lang}.v2; compareNow();
            const row = state.alignedRows.find(r => r.id === ${JSON.stringify(id)});
            const before = state.rightText.split(String.fromCharCode(10)).filter(Boolean);
            const hfBefore = compareNow().filteredHfCount;
            const text = rebuildRightTextFromRows(row.id, row.rightBlock.text + ' Zusatz.');
            const after = text.split(String.fromCharCode(10)).filter(Boolean);
            state.rightText = text;
            const r2 = compareNow();
            const changed = after.filter((l, k) => l !== before[k]);
            return { sameLength: after.length === before.length, changed: changed.length, hf: [hfBefore, r2.filteredHfCount] };
          })()`,
          ctx
        );
        assert.ok(res.sameLength && res.changed === 1, `${lang}/${hf}/${id}: exactly one line changes (${JSON.stringify(res)})`);
        assert.equal(res.hf[1], res.hf[0], `${lang}/${hf}/${id}: hidden header/footer lines kept`);
        edits++;
      }
      // Editing a deleted row (no right block) inserts its text without disturbing the rest.
      const del = base.alignedRows.find(r => r.type === 'deleted');
      if (del) {
        const n = vm.runInContext(
          `(() => { state.rightText = SAMPLES.${lang}.v2; compareNow();
             const before = state.rightText.split(String.fromCharCode(10)).filter(Boolean).length;
             const text = rebuildRightTextFromRows(${JSON.stringify(del.id)}, 'Wieder eingefügt.');
             return [before, text.split(String.fromCharCode(10)).filter(Boolean).length, text.includes('Wieder eingefügt.')]; })()`,
          ctx
        );
        assert.deepEqual(JSON.parse(JSON.stringify(n)).slice(1), [JSON.parse(JSON.stringify(n))[0] + 1, true], `${lang}/${hf}: edit of a deleted row adds one line`);
      }
    }
  }
  assert.ok(edits > 50, 'enough single-paragraph edits tested');
  groups++;
}

// 6. Single-letter shortcuts only act while reading (body, document panes, change list).
{
  const controls = read('10-controls.js');
  const fn = extractFunction(controls, 'isShortcutFocusContext');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`var document = { body: { id: 'body' }, documentElement: {} };
    ${extractFunction(controls, 'isTextEntryElement')} ${fn}`, ctx);
  const el = (tagName, inside, extra = {}) => ({ tagName, type: extra.type || '', isContentEditable: !!extra.ce, closest: sel => (sel.split(',').some(s => inside.includes(s.trim())) ? {} : null) });
  const ok = e => vm.runInContext('isShortcutFocusContext(x)', Object.assign(ctx, { x: e }));
  assert.equal(ok(ctx.document.body), true, 'body');
  assert.equal(ok(el('SECTION', ['#pane-right'])), true, 'document pane');
  assert.equal(ok(el('BUTTON', ['#sidebar-list'])), true, 'change list item');
  assert.equal(ok(el('BUTTON', [])), false, 'toolbar button');
  assert.equal(ok(el('TEXTAREA', ['#pane-right', '.clause-inline-editor'])), false, 'inline editor');
  assert.equal(ok(el('INPUT', [], { type: 'search' })), false, 'search box');
  assert.equal(ok(el('DIV', ['#pane-right', '[contenteditable]'], { ce: true })), false, 'contenteditable');
  groups++;
}

console.log(`✓ App state guard tests passed (${groups} groups).`);
