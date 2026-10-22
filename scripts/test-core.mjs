#!/usr/bin/env node
/**
 * Dependency-free unit tests for the diff core (src/js/04-core.js).
 * The core runs in a bare node:vm context (no DOM), with the vendored jsdiff as `Diff`.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const ctx = { console };
ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(read('vendor/libs/diff.min.js'), ctx, { filename: 'diff.min.js' });
vm.runInContext('var t = key => key;', ctx);
vm.runInContext(read('src/js/02-samples.js'), ctx, { filename: 'src/js/02-samples.js' });
vm.runInContext(read('src/js/04-core.js'), ctx, { filename: 'src/js/04-core.js' });
vm.runInContext('this.SAMPLES = SAMPLES; this.DOC_PAGE_MARK = DOC_PAGE_MARK; this.DOC_META_MARK = DOC_META_MARK;', ctx);
const core = ctx;

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`✗ ${name}\n    ${err.message.split('\n').join('\n    ')}`);
  }
}

const P = core.DOC_PAGE_MARK;
const HF = text => `${core.DOC_META_MARK}hf${core.DOC_META_MARK}${text}`;
const plain = obj => JSON.parse(JSON.stringify(obj));

function sides(parts) {
  let oldText = '';
  let newText = '';
  for (const p of parts) {
    if (!p.added) oldText += p.value;
    if (!p.removed) newText += p.value;
  }
  return { oldText, newText };
}

function assertInvariant(oldText, newText, parts = core.computeCleanWordDiff(oldText, newText)) {
  const s = sides(parts);
  assert.equal(s.oldText, oldText, `old side altered for ${JSON.stringify([oldText, newText])}: ${JSON.stringify(parts)}`);
  assert.equal(s.newText, newText, `new side altered for ${JSON.stringify([oldText, newText])}: ${JSON.stringify(parts)}`);
  for (const p of parts) assert.ok(p.value.length > 0, 'no empty tokens');
  return parts;
}

function compare(leftText, rightText, ignoreHf = true) {
  const prep = core.prepareComparisonBlocks(leftText, rightText, ignoreHf);
  const rows = core.alignDocumentBlocks(prep.leftBlocks, prep.rightBlocks);
  return { ...prep, rows, changes: rows.filter(r => r.type !== 'equal') };
}

function countTypes(rows) {
  const c = { modified: 0, inserted: 0, deleted: 0, moved: 0, markerOnly: 0 };
  for (const r of rows) {
    if (r.type !== 'equal') c[r.type]++;
    if (r.moved) c.moved++;
    if (r.markerOnly) c.markerOnly++;
  }
  return c;
}

/* ── #2 Word diff never alters the source text ─────────────────────────── */

test('word diff: insert-only before a number keeps the number unchanged', () => {
  const parts = assertInvariant('Frist 14 Tage', 'Frist 7 14 Tage');
  assert.deepEqual(plain(parts), [{ value: 'Frist ' }, { value: '7 ', added: true }, { value: '14 Tage' }]);
});

test('word diff: "Abschnitt 4 gilt" -> "Abschnitt 3 und 4 gilt"', () => {
  const parts = assertInvariant('Abschnitt 4 gilt', 'Abschnitt 3 und 4 gilt');
  assert.deepEqual(plain(parts), [{ value: 'Abschnitt ' }, { value: '3 und ', added: true }, { value: '4 gilt' }]);
});

test('word diff: delete-only next to a number keeps the number unchanged', () => {
  const parts = assertInvariant('Frist 7 14 Tage', 'Frist 14 Tage');
  assert.ok(parts.some(p => p.removed && p.value.trim() === '7'));
  assert.ok(parts.some(p => !p.removed && !p.added && p.value.includes('14')));
});

test('word diff: partial number replacements expand to the whole number', () => {
  const cases = [
    ['Betrag 145.000,00 EUR', 'Betrag 146.000,00 EUR', '145.000,00', '146.000,00'],
    ['fällig am 12.03.2026 netto', 'fällig am 12.04.2026 netto', '12.03.2026', '12.04.2026'],
    ['Zinssatz 0,5 % p.a.', 'Zinssatz 0,7 % p.a.', '0,5', '0,7'],
    ['Summe 1.250,50 EUR', 'Summe 1.250,75 EUR', '1.250,50', '1.250,75'],
  ];
  for (const [a, b, del, ins] of cases) {
    const parts = assertInvariant(a, b);
    assert.equal(parts.find(p => p.removed).value, del, a);
    assert.equal(parts.find(p => p.added).value, ins, b);
  }
});

const INVARIANT_CASES = [
  ['', 'Neu'],
  ['Alt', ''],
  ['Frist 14 Tage', 'Frist 7 14 Tage'],
  ['Abschnitt 4 gilt', 'Abschnitt 3 und 4 gilt'],
  ['Betrag 24 EUR', 'Betrag 60 EUR'],
  ['Gewährleistung 24 Monate', 'Gewährleistung 60 Monate'],
  ['Pauschalfestpreis 145.000,00 EUR netto', 'Pauschalfestpreis 162.500,00 EUR netto'],
  ['Pauschalfestpreis 145.000,00 EUR', 'Pauschalfestpreis 145.000,00 EUR zzgl. USt.'],
  ['145.000,00', '145.000,00 2'],
  ['2 145.000,00', '145.000,00'],
  ['am 12.03.2026', 'am 12.03.2026 bzw. 18.04.2026'],
  ['am 12.03.2026', 'am 1.12.03.2026'],
  ['Stand: 12.03.2026', 'Stand: 18.04.2026'],
  ['Zuschlag 5,0 %', 'Zuschlag 5,05 %'],
  ['Zuschlag 5,0 %', 'Zuschlag 15,0 %'],
  ['Version 1.2.3', 'Version 1.2.4'],
  ['§ 3 Abs. 2 Satz 1', '§ 4 Abs. 2 Satz 1'],
  ['(1) Der Auftragnehmer', '(2) Der Auftragnehmer'],
  ['1.000 EUR und 2.000 EUR', '1.500 EUR und 2.000 USD'],
  ['innerhalb von 14 Kalendertagen', 'innerhalb von 30 Kalendertagen'],
  ['14, 15 und 16', '14, 15, 16 und 17'],
  ['Tel. 030 123456', 'Tel. 030 1234567'],
  ['IBAN DE12 3456 7890', 'IBAN DE12 3456 7891'],
  ['a  b\tc', 'a b c'],
  ['  führende Leerzeichen', 'führende Leerzeichen  '],
  ['Satz eins. Satz zwei!', 'Satz eins; Satz zwei?'],
  ['„Auftraggeber“ genannt', '"Auftraggeber" genannt'],
  ['Urkalkulation (EKT/AGK)', 'Urkalkulation (EKT / AGK / WuG)'],
  ['10 % von 1.000', '10% von 1.000,00'],
  ['3.4.5', '3,4,5'],
  ['0,5', '0,50'],
  ['.5', '0.5'],
  ['5.', '5.0'],
  ['12.03.', '12.03.2026'],
];

test('word diff invariant: fixed cases', () => {
  for (const [a, b] of INVARIANT_CASES) {
    assertInvariant(a, b);
    assertInvariant(b, a);
  }
});

test('word diff invariant: randomized number/date/punctuation edits', () => {
  let seed = 20260312;
  const rnd = n => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const vocab = [
    'Frist', '14', 'Tage', '7', 'Abschnitt', '4', 'gilt', '3', 'und', 'EUR', '145.000,00', '146.000,00',
    '12.03.2026', '18.04.2026', '0,5', '0,7', '%', '§', 'Abs.', '2', '(1)', '(2)', 'Zuschlag', 'Pauschalfestpreis',
    ',', '.', ';', '–', '1.250', ',50', '2026', '12.03', '.', 'netto', 'Monate', '24', '60', 'Urkalkulation',
  ];
  const seps = [' ', ' ', ' ', '  ', '\t', ''];
  const sentence = () => {
    const len = 1 + rnd(9);
    let s = '';
    for (let i = 0; i < len; i++) s += vocab[rnd(vocab.length)] + seps[rnd(seps.length)];
    return s;
  };
  const mutate = s => {
    const toks = s.split(/(\s+)/);
    const ops = 1 + rnd(3);
    for (let k = 0; k < ops; k++) {
      const i = rnd(toks.length + 1);
      const op = rnd(3);
      if (op === 0) toks.splice(i, 0, vocab[rnd(vocab.length)], ' ');
      else if (op === 1 && toks.length > 1) toks.splice(Math.min(i, toks.length - 1), 1);
      else toks[Math.min(i, toks.length - 1)] = vocab[rnd(vocab.length)];
    }
    return toks.join('');
  };
  for (let n = 0; n < 4000; n++) {
    const a = sentence();
    const b = rnd(4) === 0 ? sentence() : mutate(a);
    assertInvariant(a, b);
  }
});

test('word diff invariant: every modified row of the samples', () => {
  for (const lang of ['de', 'en']) {
    const { rows } = compare(core.SAMPLES[lang].v1, core.SAMPLES[lang].v2);
    for (const row of rows) {
      if (row.leftBlock && row.rightBlock) assertInvariant(row.leftBlock.text, row.rightBlock.text, row.wordDiffs);
    }
  }
});

/* ── #7 Similarity uses a multiset intersection ────────────────────────── */

test('similarity: repeated words are matched at most once', () => {
  const blockA = core.parseIntoBlocks('Absatz\n\ndie die die die die Partei')[1];
  const blockB = core.parseIntoBlocks('Absatz\n\ndie Partei verpflichtet sich zur Zahlung der Vergütung')[1];
  // Multiset intersection {die, partei} = 2 words -> 2*2 / (6 + 8); a set lookup would count 6.
  assert.equal(core.computeBlockSimilarity(blockA, blockB), (2 * 2) / (6 + 8));
  const blockC = core.parseIntoBlocks('Absatz\n\ndie die die die die Partei hat')[1];
  const blockD = core.parseIntoBlocks('Absatz\n\nDie Rechnung ist binnen vierzehn Tagen ohne Abzug zu begleichen')[1];
  assert.ok(core.computeBlockSimilarity(blockC, blockD) < 0.28, 'unrelated sentences are not aligned');
});

test('similarity: identical blocks score 1, near-identical high', () => {
  const blocks = core.parseIntoBlocks(
    'Titel\n\nDer Auftragnehmer haftet für Vorsatz und grobe Fahrlässigkeit.\n\nDer Auftragnehmer haftet für Vorsatz und Fahrlässigkeit.'
  );
  assert.equal(core.computeBlockSimilarity(blocks[1], blocks[1]), 1);
  assert.ok(core.computeBlockSimilarity(blocks[1], blocks[2]) > 0.8);
});

/* ── Built-in samples ──────────────────────────────────────────────────── */

test('samples: expected change counts (de + en)', () => {
  for (const lang of ['de', 'en']) {
    const { rows, hfCount } = compare(core.SAMPLES[lang].v1, core.SAMPLES[lang].v2);
    const c = countTypes(rows);
    // 16 modified clauses + the running header whose version/date changed (shown once).
    assert.deepEqual(c, { modified: 17, inserted: 2, deleted: 1, moved: 0, markerOnly: 0 }, lang);
    assert.equal(hfCount, 10, `${lang}: hidden header/footer lines`);
    const hfRow = rows.find(r => r.leftBlock && r.leftBlock.kind === 'hf');
    assert.ok(hfRow && hfRow.type === 'modified', `${lang}: changed header must be visible`);
  }
});

test('samples: no internal markers leak into block text', () => {
  for (const lang of ['de', 'en']) {
    for (const v of ['v1', 'v2']) {
      for (const b of core.parseIntoBlocks(core.SAMPLES[lang][v])) {
        assert.ok(!/[\u001C-\u001F]|\[\[HF\]\]|=== \[SEITE/.test(b.text), b.text);
      }
    }
  }
});

/* ── #1 Header / footer classification ─────────────────────────────────── */

function pdfPage(lines) {
  // lines: [text, yPct]
  return lines.map(([text, yPct]) => ({ text, y: yPct * 842, yPct, fontSize: 11, gapBefore: false }));
}

test('PDF: first/last body lines inside the margin band are not hidden', () => {
  const v = (amount, months) => [
    pdfPage([
      ['Musterfirma GmbH · Vertrag', 0.97],
      [`Betrag ${amount} EUR ist innerhalb von 14 Tagen fällig.`, 0.9],
      ['Weitere Regelungen gelten.', 0.5],
      ['Seite 1 von 2', 0.03],
    ]),
    pdfPage([
      ['Musterfirma GmbH · Vertrag', 0.97],
      ['Allgemeine Bestimmungen gelten fort.', 0.5],
      [`Gewährleistung ${months} Monate ab Abnahme.`, 0.09],
      ['Seite 2 von 2', 0.03],
    ]),
  ];
  const left = core.assemblePdfText(v(24, 24)).text;
  const right = core.assemblePdfText(v(60, 60)).text;
  const { rows, hfCount } = compare(left, right);
  const changed = rows.filter(r => r.type !== 'equal').map(r => r.rightBlock.text);
  assert.ok(changed.some(t => t.includes('Betrag 60 EUR')), JSON.stringify(changed));
  assert.ok(changed.some(t => t.includes('Gewährleistung 60 Monate')), JSON.stringify(changed));
  assert.equal(hfCount, 8, 'running header + page number on 2 pages, both versions');
});

test('PDF: a running line on fewer than 50% of pages is not a header', () => {
  const pages = [0, 1, 2, 3].map(i =>
    pdfPage([
      [i === 0 ? 'Nur auf Seite eins oben' : `Kopf ${i}`, 0.97],
      ['Text', 0.5],
    ])
  );
  const flags = core.detectRepeatingMarginLines(pages);
  assert.equal(flags[0][0], false);
  assert.deepEqual(plain(flags.slice(1).map(f => f[0])), [true, true, true], 'Kopf # repeats on 3 of 4 pages');
});

test('PDF: repeated text at a different vertical position is not a header', () => {
  const pages = [
    pdfPage([['Vertraulich', 0.97], ['x', 0.5]]),
    pdfPage([['Vertraulich', 0.91], ['y', 0.5]]),
  ];
  const flags = core.detectRepeatingMarginLines(pages);
  assert.deepEqual(plain(flags.map(f => f[0])), [false, false]);
});

test('single-page PDF: nothing is hidden by position', () => {
  const { text } = core.assemblePdfText([pdfPage([['Kopfzeile', 0.97], ['Inhalt', 0.5], ['Fußzeile', 0.03]])]);
  assert.equal(core.parseIntoBlocks(text).filter(b => b.isHeaderFooter).length, 0);
});

test('pasted text: a body sentence ending in "Page 4 of 9" is not hidden', () => {
  const blocks = core.parseIntoBlocks(
    'Title\n\nThe schedule referenced above is attached on Page 4 of 9\n\nSeite 2 von 9'
  );
  assert.equal(blocks[1].isHeaderFooter, false);
  assert.equal(blocks[2].isHeaderFooter, true, 'pure page label');
});

test('pasted text: running "Vertraulich · Seite n von m" lines are hidden only when repeated', () => {
  const once = core.parseIntoBlocks('A\n\nVertraulich · Seite 1 von 2\n\nB');
  assert.equal(once[1].isHeaderFooter, false);
  const twice = core.parseIntoBlocks('A\n\nVertraulich · Seite 1 von 2\n\nB\n\nVertraulich · Seite 2 von 2');
  assert.equal(twice[1].isHeaderFooter, true);
  assert.equal(twice[3].isHeaderFooter, true);
});

test('header/footer that differs between versions is shown once; page numbers stay hidden', () => {
  const doc = header =>
    [1, 2, 3]
      .map(p => [`${P}${p}`, HF(`${header} · Seite ${p} von 3`), `Absatz ${p} bleibt gleich.`, HF(`- ${p} -`)].join('\n\n'))
      .join('\n\n');
  const { rows, hfCount } = compare(doc('Entwurf v1 (Stand 12.03.2026)'), doc('Entwurf v2 (Stand 18.04.2026)'));
  const visibleHf = rows.filter(r => (r.leftBlock || r.rightBlock).kind === 'hf');
  assert.equal(visibleHf.length, 1);
  assert.equal(visibleHf[0].type, 'modified');
  assert.equal(hfCount, 10);
  const same = compare(doc('Entwurf v1'), doc('Entwurf v1'));
  assert.equal(same.changes.length, 0);
  assert.equal(same.hfCount, 12);
});

test('header/footer filter off: all lines are compared', () => {
  const { leftBlocks } = compare(core.SAMPLES.de.v1, core.SAMPLES.de.v2, false);
  assert.equal(leftBlocks.filter(b => b.isHeaderFooter).length, 6);
});

/* ── #4 PDF intake: hyphenation and spacing ────────────────────────────── */

test('hyphenated line breaks are joined', () => {
  assert.equal(core.joinWrappedLine('Die Vertrags-', 'strafenregelung gilt.'), 'Die Vertragsstrafenregelung gilt.');
  assert.equal(core.joinWrappedLine('Die Vertrags-', 'und Zahlungsbedingungen'), 'Die Vertrags- und Zahlungsbedingungen');
  assert.equal(core.joinWrappedLine('die Ost-', 'West-Verbindung'), 'die Ost-West-Verbindung');
  assert.equal(core.joinWrappedLine('Betrag', 'netto'), 'Betrag netto');
  assert.equal(core.joinWrappedLine('Zeitraum 2025 -', '2026'), 'Zeitraum 2025 - 2026');
  assert.equal(core.joinWrappedLine('Gewähr­leis­', 'tung'), 'Gewähr­leistung');
});

test('PDF: hyphenated paragraph equals the unhyphenated one', () => {
  const page = lines => [lines.map(([text, y]) => ({ text, y, yPct: y / 842, fontSize: 11, gapBefore: false }))];
  const a = core.assemblePdfText(page([['Die Vertrags-', 500], ['strafenregelung entfällt.', 486]])).text;
  const b = core.assemblePdfText(page([['Die Vertragsstrafenregelung', 500], ['entfällt.', 486]])).text;
  const { changes } = compare(a, b);
  assert.equal(changes.length, 0);
});

test('PDF: spaces come from geometry, not from item boundaries', () => {
  const item = (str, x, width, y = 700) => ({ str, transform: [11, 0, 0, 11, x, y], width, hasEOL: false });
  const lines = core.buildPdfPageLines(
    [item('Ge', 72, 12), item('samt', 84, 24), item('preis', 108, 26), item('netto', 137, 28), item('EUR', 168, 20)],
    [0, 0, 595, 842]
  );
  assert.equal(lines[0].text, 'Gesamtpreis netto EUR');
  const eol = core.buildPdfPageLines(
    [{ ...item('Zeile', 72, 30), hasEOL: true }, item('eins', 72, 20, 686)],
    [0, 0, 595, 842]
  );
  assert.deepEqual(plain(eol.map(l => l.text)), ['Zeile', 'eins']);
});

test('PDF: paragraph across a page break is joined (lowercase continuation)', () => {
  const pages = [
    pdfPage([['Kopf', 0.97], ['Der Auftragnehmer verpflichtet sich zur', 0.5], ['Seite 1', 0.03]]),
    pdfPage([['Kopf', 0.97], ['fristgerechten Lieferung.', 0.85], ['Seite 2', 0.03]]),
  ];
  const blocks = core.parseIntoBlocks(core.assemblePdfText(pages).text).filter(b => !b.isHeaderFooter);
  assert.deepEqual(plain(blocks.map(b => b.text)), ['Der Auftragnehmer verpflichtet sich zur fristgerechten Lieferung.']);
});

/* ── #6 Metadata never comes from user text ────────────────────────────── */

test('typed page/header markers are plain text', () => {
  const typed = core.sanitizeExternalText('Titel\n\n=== [SEITE 2] ===\n\n[[HF]] Fußzeile\n\nText\u001Ehf\u001F');
  const blocks = core.parseIntoBlocks(typed);
  assert.deepEqual(plain(blocks.map(b => b.text)), ['Titel', '=== [SEITE 2] ===', '[[HF]] Fußzeile', 'Texthf']);
  assert.ok(blocks.every(b => !b.isHeaderFooter && b.pageNum === 1));
});

test('docTextToPlainText strips page and header/footer metadata', () => {
  const plainText = core.docTextToPlainText(core.SAMPLES.de.v1);
  assert.ok(!/[\u001E\u001F]/.test(plainText));
  assert.ok(plainText.startsWith('Rahmenvertrag IT- & Planungsleistungen · Fassung v1.0'));
  assert.ok(!plainText.includes('[[HF]]') && !plainText.includes('=== ['));
});

test('serializeBlockLine round-trips header/footer and indent metadata', () => {
  const text = [P + '1', core.serializeBlockLine({ text: 'Kopf', kind: 'hf' }), core.serializeBlockLine({ text: '• Punkt', indent: 2 })].join('\n\n');
  const blocks = core.parseIntoBlocks(text);
  assert.equal(blocks[0].isHeaderFooter, true);
  assert.equal(blocks[1].indent, 2);
  assert.equal(blocks[1].text, '• Punkt');
});

/* ── #7 Renumbering and moves ──────────────────────────────────────────── */

test('renumbering: inserting a new (1) reports one insertion, the rest is marker-only', () => {
  const left = '§ 2 Vergütung\n\n(1) Die Vergütung beträgt 1.000 EUR.\n\n(2) Zahlung binnen 14 Tagen.\n\n(3) Skonto ist ausgeschlossen.';
  const right =
    '§ 2 Vergütung\n\n(1) Die Preise sind Festpreise ohne Gleitklausel.\n\n(2) Die Vergütung beträgt 1.000 EUR.\n\n(3) Zahlung binnen 14 Tagen.\n\n(4) Skonto ist ausgeschlossen.';
  const { rows, changes } = compare(left, right);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, 'inserted');
  const markerRows = rows.filter(r => r.markerOnly);
  assert.equal(markerRows.length, 3);
  assert.deepEqual(plain(markerRows.map(r => [r.oldMarker, r.newMarker])), [['(1)', '(2)'], ['(2)', '(3)'], ['(3)', '(4)']]);
  for (const r of markerRows) assertInvariant(r.leftBlock.text, r.rightBlock.text, r.wordDiffs);
});

test('renumbering: a changed body is still reported as modified', () => {
  const { changes } = compare('Titel\n\n(1) Frist 14 Tage.', 'Titel\n\n(2) Frist 30 Tage.');
  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, 'modified');
});

test('renumbered section headings are marker-only', () => {
  const { rows, changes } = compare(
    'Vertrag\n\n§ 4 Haftung\n\nText A bleibt.\n\n§ 5 Schlussbestimmungen\n\nText B bleibt.',
    'Vertrag\n\n§ 4 Neue Klausel\n\nNeuer Text zu einer ganz anderen Regelung.\n\n§ 5 Haftung\n\nText A bleibt.\n\n§ 6 Schlussbestimmungen\n\nText B bleibt.'
  );
  assert.equal(changes.length, 2, JSON.stringify(changes.map(c => [c.type, (c.rightBlock || c.leftBlock).text])));
  assert.equal(rows.filter(r => r.markerOnly).length, 2);
});

test('moves: an identical paragraph moved elsewhere is paired as moved', () => {
  const para = 'Der Auftragnehmer stellt eine Vertragserfüllungsbürgschaft in Höhe von 5 % der Auftragssumme.';
  const left = `Titel\n\n${para}\n\nErster fester Absatz bleibt.\n\nZweiter fester Absatz bleibt.\n\nDritter fester Absatz bleibt.`;
  const right = `Titel\n\nErster fester Absatz bleibt.\n\nZweiter fester Absatz bleibt.\n\nDritter fester Absatz bleibt.\n\n${para}`;
  const { rows } = compare(left, right);
  const moved = rows.filter(r => r.moved);
  assert.equal(moved.length, 2);
  const from = moved.find(r => r.type === 'deleted');
  const to = moved.find(r => r.type === 'inserted');
  assert.ok(from && to);
  assert.equal(from.movedToRowId, to.id);
  assert.equal(to.movedFromRowId, from.id);
  assert.equal(rows.filter(r => r.type !== 'equal' && !r.moved).length, 0);
});

test('moves: short or different paragraphs are not paired', () => {
  const short = compare('Titel\n\nJa.\n\nNein.\n\nEnde', 'Titel\n\nNein.\n\nJa.\n\nEnde');
  assert.equal(short.rows.filter(r => r.moved).length, 0, 'too short to call it a move');
  const different = compare(
    'Titel\n\nAlter Absatz über die Abnahme der Leistung.\n\nFester Text bleibt.',
    'Titel\n\nFester Text bleibt.\n\nNeuer Absatz über Kündigung aus wichtigem Grund.'
  );
  assert.equal(different.rows.filter(r => r.moved).length, 0);
});

/* ── #8 / misc ─────────────────────────────────────────────────────────── */

test('form feed in text is treated as a line break', () => {
  const blocks = core.parseIntoBlocks(core.sanitizeExternalText('Titel\fZweiter Absatz.'));
  assert.deepEqual(plain(blocks.map(b => b.text)), ['Titel', 'Zweiter Absatz.']);
});

for (const f of failures) console.error(f);
if (failures.length) {
  console.error(`\n${failures.length} core test(s) failed, ${passed} passed.`);
  process.exit(1);
}
console.log(`✓ ${passed} core diff tests passed.`);
