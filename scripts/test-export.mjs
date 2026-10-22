#!/usr/bin/env node
/**
 * Unit tests for the pure export builders (docx, HTML report, Markdown, final text, file names).
 * Loads the app sources into a `node:vm` context with minimal stubs; no browser, no dependencies.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const sources = [
  'src/js/01-i18n.js',
  'src/js/02-samples.js',
  'src/js/04-core.js',
  'src/js/04a-align.js',
  'src/js/05-render.js',
  'src/js/06-compare.js',
  'src/js/06d-review.js',
  'src/js/08-export-docx.js',
  'src/js/08-export.js',
];

const harness = `
const state = {
  lang: 'de', leftName: '', rightName: '', leftText: '', rightText: '',
  alignedRows: [], changeRows: [], listItems: [], reviews: {}, onlyChanges: false, ignoreHeadersFooters: true,
  filteredHfCount: 0, viewMode: 'split', rightAllBlocks: [],
};
function t(key) { return I18N[state.lang][key] || I18N.de[key] || key; }
function compare(leftText, rightText, opts = {}) {
  Object.assign(state, { onlyChanges: false, ignoreHeadersFooters: true }, opts);
  const l = parseIntoBlocks(leftText);
  const r = parseIntoBlocks(rightText);
  state.filteredHfCount = Math.max(l.filter(b => b.isHeaderFooter).length, r.filter(b => b.isHeaderFooter).length);
  const lf = state.ignoreHeadersFooters ? l.filter(b => !b.isHeaderFooter) : l;
  const rf = state.ignoreHeadersFooters ? r.filter(b => !b.isHeaderFooter) : r;
  state.leftText = leftText;
  state.rightText = rightText;
  state.alignedRows = alignDocumentBlocks(lf, rf);
  state.changeRows = state.alignedRows.filter(row => row.type !== 'equal');
  state.reviews = {};
  rebuildReviewIndex();
}
`;

const context = {
  console,
  TextEncoder,
  URL,
  Intl,
  navigator: { language: 'de-DE', languages: ['de-DE'] },
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(read('vendor/libs/diff.min.js'), context, { filename: 'diff.min.js' });
vm.runInContext(
  sources.map(read).join('\n') + harness + '\nglobalThis.__state = state; globalThis.__compare = compare; globalThis.SAMPLES = SAMPLES; globalThis.tf = tf;',
  context,
  { filename: 'export-bundle.js' }
);
const api = context;
const state = api.__state;

/* ── Minimal ZIP reader (STORE only) ─────────────────────────────────────── */
function readZip(bytes) {
  const buf = Buffer.from(bytes);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, 'ZIP: end of central directory found');
  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(pos), 0x02014b50, 'ZIP: central directory signature');
    const method = buf.readUInt16LE(pos + 10);
    const crc = buf.readUInt32LE(pos + 16);
    const size = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const offset = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
    assert.equal(method, 0, 'ZIP: STORE method');
    assert.equal(buf.readUInt32LE(offset), 0x04034b50, 'ZIP: local header signature');
    const localNameLen = buf.readUInt16LE(offset + 26);
    const dataStart = offset + 30 + localNameLen + buf.readUInt16LE(offset + 28);
    const data = buf.subarray(dataStart, dataStart + size);
    assert.equal(api.crc32(data), crc, `ZIP: CRC-32 of ${name}`);
    files.set(name, data.toString('utf8'));
    pos += 46 + nameLen;
  }
  return files;
}

/** Text of each body paragraph after accepting (or rejecting) all tracked changes. */
function resolveRevisions(documentXml, mode) {
  const body = documentXml.split('<w:body>')[1];
  const paragraphs = body.match(/<w:p>[\s\S]*?<\/w:p>/g) || [];
  const out = [];
  for (let p of paragraphs) {
    const markDeleted = /<w:pPr>.*?<w:rPr><w:del /.test(p);
    const markInserted = /<w:pPr>.*?<w:rPr><w:ins /.test(p);
    if ((mode === 'accept' && markDeleted) || (mode === 'reject' && markInserted)) continue;
    p = mode === 'accept'
      ? p.replace(/<w:del [^>]*>[\s\S]*?<\/w:del>/g, '')
      : p.replace(/<w:ins [^>]*>[\s\S]*?<\/w:ins>/g, '').replace(/w:delText/g, 'w:t');
    const text = [...p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:tab\/>/g)]
      .map(m => (m[0] === '<w:tab/>' ? ' ' : m[1]))
      .join('')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    out.push(text);
  }
  return out;
}

const normalizeSpace = s => s.replace(/\s+/g, ' ').trim();
/** Title + "DocDiffMeta" paragraphs before the document body. */
const metaParagraphCount = documentXml => 1 + (documentXml.match(/<w:pStyle w:val="DocDiffMeta"\/>/g) || []).length;
let checks = 0;

/* ── File names ───────────────────────────────────────────────────────────── */
assert.equal(api.sanitizeFileNamePart('C:\\Users\\x\\Vertrag: "v2"?.pdf'), 'Vertrag_v2');
assert.equal(api.sanitizeFileNamePart('../../etc/passwd'), 'passwd');
assert.equal(api.sanitizeFileNamePart('CON.txt'), '_CON');
assert.equal(api.sanitizeFileNamePart('  ...  ', 'Fallback'), 'Fallback');
assert.equal(api.sanitizeFileNamePart('a<b>c|d*e.docx'), 'a_b_c_d_e');
assert.equal(api.buildExportBaseName('Vertrag_v1.pdf', 'Vertrag_v2.pdf'), 'Vertrag_v2_vs_v1');
assert.equal(api.buildExportBaseName('Alt.docx', 'Neu.docx'), 'Neu_vs_Alt');
assert.equal(api.buildExportBaseName('', ''), 'DocDiff');
assert.equal(api.buildExportBaseName('Same.pdf', 'same.PDF'), 'same');
assert.ok(Array.from(api.buildExportBaseName('x'.repeat(300), 'y'.repeat(300))).length <= 130);
checks += 10;

/* ── Samples in both languages, with and without header/footer filter ─────── */
for (const lang of ['de', 'en']) {
  for (const ignoreHeadersFooters of [true, false]) {
    state.lang = lang;
    state.leftName = api.t('sampleLeftName');
    state.rightName = api.t('sampleRightName');
    const sample = api.SAMPLES[lang];
    api.__compare(sample.v1, sample.v2, { ignoreHeadersFooters });
    assert.ok(state.changeRows.length > 3, 'sample has changes');
    const label = `${lang}/hf=${ignoreHeadersFooters}`;

    // Tokens reproduce both versions exactly.
    for (const row of state.alignedRows) {
      const tokens = api.getExportDiffTokens(row);
      const oldText = tokens.filter(x => !x.added).map(x => x.value).join('');
      const newText = tokens.filter(x => !x.removed).map(x => x.value).join('');
      if (row.leftBlock) assert.equal(oldText, row.leftBlock.text, `${label}: old text of ${row.id}`);
      if (row.rightBlock) assert.equal(newText, row.rightBlock.text, `${label}: new text of ${row.id}`);
      checks += 2;
    }

    // DOCX: valid ZIP, required parts, accept-all == new version, reject-all == old version.
    const files = readZip(api.buildDocxRedline(new Date('2026-10-22T12:00:00Z')));
    for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/settings.xml', 'word/_rels/document.xml.rels', 'word/footer1.xml', 'docProps/core.xml', 'docProps/app.xml']) {
      assert.ok(files.has(part), `${label}: docx part ${part}`);
      assert.ok(files.get(part).startsWith('<?xml'), `${label}: ${part} has XML declaration`);
    }
    const doc = files.get('word/document.xml');
    assert.match(doc, /<w:ins w:id="\d+" w:author="Doc Diff" w:date="2026-10-22T12:00:00Z">/);
    assert.match(doc, /<w:del w:id="\d+" w:author="Doc Diff" w:date="2026-10-22T12:00:00Z">/);
    assert.match(doc, /<w:pStyle w:val="Heading2"\/>/);
    const ids = [...doc.matchAll(/<w:(?:ins|del) w:id="(\d+)"/g)].map(m => m[1]);
    assert.equal(new Set(ids).size, ids.length, `${label}: revision ids are unique`);
    const metaParagraphs = metaParagraphCount(doc);
    assert.equal(metaParagraphs, 1 + 5 + 1, `${label}: title, five facts, note (nothing reviewed)`);
    const accepted = resolveRevisions(doc, 'accept').slice(metaParagraphs).map(normalizeSpace);
    const rejected = resolveRevisions(doc, 'reject').slice(metaParagraphs).map(normalizeSpace);
    // Arrays created inside the vm realm have a different prototype; copy them for deepEqual.
    const expectNew = [...state.alignedRows.filter(r => r.rightBlock).map(r => normalizeSpace(r.rightBlock.text))];
    const expectOld = [...state.alignedRows.filter(r => r.leftBlock).map(r => normalizeSpace(r.leftBlock.text))];
    assert.deepEqual(accepted, expectNew, `${label}: Accept all yields the new version`);
    assert.deepEqual(rejected, expectOld, `${label}: Reject all yields the old version`);

    // HTML report.
    for (const onlyChanges of [false, true]) {
      state.onlyChanges = onlyChanges;
      const html = api.buildExportHtmlReport(new Date('2026-10-22T12:00:00Z'));
      assert.match(html, new RegExp(`<html lang="${lang}">`));
      assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'/);
      assert.ok(!/<script/i.test(html), 'report contains no script');
      assert.ok(!/https?:\/\//.test(html), 'report contains no external URL');
      assert.ok(html.includes(api.t(onlyChanges ? 'exportScopeChanges' : 'exportScopeFull')), 'report states scope');
      for (const row of state.changeRows) {
        const n = state.changeRows.indexOf(row) + 1;
        assert.ok(html.includes(`href="#c${n}"`) && html.includes(`id="c${n}"`), `report anchor c${n}`);
      }
      assert.ok(html.includes(`<span class="sr">${api.t('a11yRemovedStart')} </span>`));
      const tagBalance = tag => (html.match(new RegExp(`<${tag}>`, 'g')) || []).length === (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
      assert.ok(tagBalance('del') && tagBalance('ins'), 'balanced del/ins');
      state.onlyChanges = false;
    }

    // Markdown report.
    const md = api.buildExportMarkdown(new Date('2026-10-22T12:00:00Z'));
    assert.ok(!/\*\*\s|\s\*\*(?=[^\s*|]|$)/.test(md.replace(/^\|.*$/gm, '').replace(/\*\*[^*\s](?:[^*]*[^*\s])?\*\*/g, '')), `${label}: no whitespace-padded ** emphasis`);
    assert.ok(!/~~\s|\s~~(?!\s)/.test(md.replace(/~~[^~\s](?:[^~]*[^~\s])?~~/g, '')), `${label}: no whitespace-padded ~~ strike`);
    assert.ok(md.includes(`| # | ${api.t('exportColRef')} |`), 'markdown summary table');

    // Final text: no header/footer lines, no internal markers.
    const finalText = api.buildFinalText();
    assert.ok(!/\[\[HF\]\]|===\s*\[(SEITE|PAGE)/.test(finalText));
    for (const row of state.alignedRows) {
      if (row.rightBlock && row.rightBlock.isHeaderFooter) assert.ok(!finalText.includes(row.rightBlock.text));
    }
    for (const out of [md, doc, finalText]) {
      assert.ok(!/\[\[HF\]\]|===\s*\[(?:SEITE|PAGE)/.test(out), `${label}: no internal markers`);
    }
    checks += 20;
  }
}

/* ── Markdown escaping & whitespace edge cases ───────────────────────────── */
state.lang = 'en';
const mdTokens = api.renderMarkdownTokens;
assert.equal(mdTokens([{ value: 'a ' }, { value: ' b ', added: true }, { value: 'c' }]), 'a  **b** c');
assert.equal(mdTokens([{ value: 'x' }, { value: ' old', removed: true }, { value: ' new', added: true }, { value: ' y' }]), 'x ~~old~~ **new** y');
assert.equal(mdTokens([{ value: 'Euro' }, { value: ', zzgl.', added: true }]), 'Euro<ins>, zzgl.</ins>');
assert.equal(mdTokens([{ value: 'a **b** ~~c~~ <i>' }]), 'a \\*\\*b\\*\\* \\~\\~c\\~\\~ \\<i\\>');
assert.equal(mdTokens([{ value: '   ', removed: true }]), '');
assert.equal(api.escapeMarkdownLineStart('1. Item'), '1\\. Item');
assert.equal(api.escapeMarkdownLineStart('- Item'), '\\- Item');
api.__compare('Intro\n\nPrice is **10** EUR ~~net~~.', 'Intro\n\nPrice is **12** EUR ~~net~~ | x.');
const md2 = api.buildExportMarkdown(new Date());
assert.ok(md2.includes('\\*\\*') && md2.includes('\\~\\~') && md2.includes('\\|'), 'document text is escaped');
checks += 8;

/* ── Internal markers never leak ─────────────────────────────────────────── */
const fakeRow = {
  id: 'row-x', type: 'modified',
  leftBlock: { text: '[[HF]] Seite 1' }, rightBlock: { text: '=== [SEITE 2] === Seite 2' },
  wordDiffs: [{ value: '[[HF]] Seite 1', removed: true }, { value: '=== [SEITE 2] === Seite 2', added: true }],
};
const fakeTokens = api.getExportDiffTokens(fakeRow).map(x => x.value).join('');
assert.ok(!fakeTokens.includes('[[HF]]') && !fakeTokens.includes('==='), 'markers stripped from tokens');
checks += 1;

/* ── ZIP writer handles non-ASCII names and binary data ───────────────────── */
const zipped = readZip(api.buildZipArchive([{ name: 'ä/ö.txt', data: 'Grüße' }, { name: 'b.bin', data: new Uint8Array([0, 255, 1]) }]));
assert.equal(zipped.get('ä/ö.txt'), 'Grüße');
assert.equal(api.crc32(new TextEncoder().encode('123456789')), 0xcbf43926, 'CRC-32 check value');
checks += 2;

/* ── Review status: Word semantics of accepted / rejected / open changes ─────
 * Accept all (in Word) must give the current new version; Reject all must give the old version
 * with the changes accepted in Doc Diff applied (rejected ones are already reverted in the text).
 * Before anything is reviewed the export is unchanged. */
{
  const interactions = read('src/js/07-interactions.js');
  const extract = name => {
    const start = interactions.indexOf(`function ${name}(`);
    let depth = 0;
    for (let i = interactions.indexOf('{', start); i < interactions.length; i++) {
      if (interactions[i] === '{') depth++;
      else if (interactions[i] === '}' && --depth === 0) return interactions.slice(start, i + 1);
    }
    throw new Error(name);
  };
  vm.runInContext(
    `${extract('rebuildRightTextFromRows')}
     ${extract('sameBlock')}
     globalThis.__compareFull = function (leftText, rightText) {
       const r = computeComparison({ leftText, rightText, ignoreHeadersFooters: true, labels: { typeHf: 'HF' } });
       Object.assign(state, { leftText, rightText, alignedRows: r.alignedRows, rightAllBlocks: r.allRightBlocks, filteredHfCount: r.filteredHfCount });
       state.changeRows = state.alignedRows.filter(row => row.type !== 'equal');
       rebuildReviewIndex();
     };
     globalThis.__review = function (action, type, n) {
       const open = state.listItems.filter(i => i.status === 'open');
       const ofType = open.filter(i => i.type === type);
       const pool = ofType.length ? ofType : open;
       const row = pool[n % pool.length].row;
       if (action === 'accept') {
         state.reviews[row.reviewKey] = { status: 'accepted', type: row.type };
         rebuildReviewIndex();
         return;
       }
       const anchors = computeRowAnchors(state.alignedRows);
       state.reviews[row.reviewKey] = {
         status: 'rejected', type: row.type,
         leftText: row.leftBlock ? row.leftBlock.text : '', rightText: row.rightBlock ? row.rightBlock.text : '',
         leftAnchor: anchors.left.get(row.id) || '', prevAnchor: anchors.prev.get(row.id) || '', pageNum: row.pageNum || 1, refCode: '',
       };
       __compareFull(state.leftText, rebuildRightTextFromRows(row.id, row.leftBlock ? row.leftBlock.text : ''));
     };`,
    context
  );
  // Every type is accepted in one plan and rejected in the other.
  const plans = [
    [['accept', 'modified', 0], ['reject', 'modified', 1], ['accept', 'inserted', 0], ['reject', 'deleted', 0], ['accept', 'modified', 4], ['reject', 'inserted', 0], ['accept', 'modified', 2]],
    [['accept', 'deleted', 0], ['reject', 'modified', 3], ['accept', 'inserted', 0], ['reject', 'inserted', 0], ['accept', 'modified', 5], ['reject', 'modified', 0], ['accept', 'modified', 1]],
  ];
  for (const [lang, plan] of [['de', plans[0]], ['en', plans[0]], ['de', plans[1]], ['en', plans[1]]]) {
    state.lang = lang;
    const sample = api.SAMPLES[lang];
    vm.runInContext('state.reviews = {};', context);
    api.__compareFull(sample.v1, sample.v2);
    const date = new Date('2026-10-22T12:00:00Z');
    const total = state.listItems.length;

    // Nothing reviewed: identical to an export without review semantics.
    const meta = { date, title: 't', lines: [], note: 'n' };
    assert.equal(
      api.buildDocxDocumentXml(state.alignedRows, { ...meta, reviewStatusOf: row => row.reviewStatus || '' }),
      api.buildDocxDocumentXml(state.alignedRows, meta),
      `${lang}: unreviewed export is unchanged`
    );

    // Review a mix: accept and reject changes of several types.
    for (const [action, type, n] of plan) api.__review(action, type, n);
    const counts = api.getExportCounts();
    assert.equal(state.listItems.length, total, `${lang}: rejected changes stay in the list`);
    assert.equal(counts.total, total, `${lang}: totals unchanged`);
    assert.equal(counts.accepted, 4, `${lang}: four accepted`);
    assert.equal(counts.rejected, 3, `${lang}: three rejected`);
    const reviewedTypes = new Set(state.listItems.filter(i => i.status !== 'open').map(i => i.type));
    assert.equal(reviewedTypes.size, 3, `${lang}: reviews cover every change type (${[...reviewedTypes]})`);

    const files = readZip(api.buildDocxRedline(date));
    const doc = files.get('word/document.xml');
    const metaCount = metaParagraphCount(doc);
    assert.equal(metaCount, 1 + 6 + 1, `${lang}: review line among the facts`);
    assert.ok(doc.includes(api.escapeXml(api.tf('exportReviewFmt', { k: 7, n: total, a: 4, r: 3 }))), `${lang}: review summary in the Word file`);
    const acceptAll = resolveRevisions(doc, 'accept').slice(metaCount).map(normalizeSpace);
    const rejectAll = resolveRevisions(doc, 'reject').slice(metaCount).map(normalizeSpace);
    const rows = [...state.alignedRows];
    const expectAccept = rows.filter(r => r.rightBlock).map(r => normalizeSpace(r.rightBlock.text));
    const expectReject = [];
    for (const r of rows) {
      if (r.type === 'equal' || r.reviewStatus === 'accepted') {
        if (r.rightBlock) expectReject.push(normalizeSpace(r.rightBlock.text));
      } else if (r.leftBlock) {
        expectReject.push(normalizeSpace(r.leftBlock.text));
      }
    }
    assert.deepEqual(acceptAll, [...expectAccept], `${lang}: Accept all = current new version`);
    assert.deepEqual(rejectAll, [...expectReject], `${lang}: Reject all = old version with the accepted changes applied`);
    // Accepted changes carry no revision marks; open ones still do.
    const revisions = (doc.match(/<w:(?:ins|del) w:id=/g) || []).length;
    const reviewsBefore = JSON.stringify(state.reviews);
    const textBefore = state.rightText;
    api.__compareFull(sample.v1, sample.v2);
    vm.runInContext('state.reviews = {}; rebuildReviewIndex();', context);
    const fresh = readZip(api.buildDocxRedline(date)).get('word/document.xml');
    assert.ok(revisions > 0 && revisions < (fresh.match(/<w:(?:ins|del) w:id=/g) || []).length, `${lang}: fewer tracked changes after reviewing`);
    vm.runInContext(`state.reviews = ${reviewsBefore};`, context);
    api.__compareFull(sample.v1, textBefore);

    // Reports show each change's status.
    const html = api.buildExportHtmlReport(date);
    assert.equal((html.match(/<td class="status accepted">/g) || []).length, 4, `${lang}: html accepted rows`);
    assert.equal((html.match(/<td class="status rejected">/g) || []).length, 3, `${lang}: html rejected rows`);
    assert.equal((html.match(/<td class="status open">/g) || []).length, total - 7, `${lang}: html open rows`);
    const md = api.buildExportMarkdown(date);
    const statusCells = [...md.matchAll(/^\| \d+ \|.*\| ([^|]+) \| [^|]*\|$/gm)].map(m => m[1].trim());
    assert.equal(statusCells.length, total, `${lang}: markdown lists every change`);
    assert.equal(statusCells.filter(x => x === api.t('statusAccepted')).length, 4, `${lang}: markdown accepted`);
    assert.equal(statusCells.filter(x => x === api.t('statusRejected')).length, 3, `${lang}: markdown rejected`);
    checks += 12;
  }
}

console.log(`✓ Export builder tests passed (${checks} check groups).`);
