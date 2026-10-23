/* ── Word export: a real .docx (OOXML) with tracked changes, built in the browser ──
 * Everything here is dependency-free: a minimal ZIP writer (STORE, CRC-32) plus hand-written
 * WordprocessingML. Changes are emitted as genuine revisions (<w:ins>/<w:del>), so Word,
 * LibreOffice and Google Docs offer "Accept / Reject change" on every edit.
 */

const DOCX_AUTHOR = 'Doc Diff';
const DOCX_TAB = '\u0000TAB\u0000';

let crc32Table = null;
function crc32(bytes) {
  if (!crc32Table) {
    crc32Table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc32Table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crc32Table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Minimal ZIP writer (method 0 = STORE). `files` is [{ name, data: Uint8Array | string }].
 * Returns a Uint8Array containing a valid archive with central directory.
 */
function buildZipArchive(files, date = new Date()) {
  const enc = new TextEncoder();
  const dosTime = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31);
  const dosDate = (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);

  const entries = files.map(f => {
    const nameBytes = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    return { nameBytes, data, crc: crc32(data) };
  });

  let localSize = 0;
  let centralSize = 0;
  for (const e of entries) {
    localSize += 30 + e.nameBytes.length + e.data.length;
    centralSize += 46 + e.nameBytes.length;
  }
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let pos = 0;

  const writeHeaderCommon = e => {
    view.setUint16(pos, 0x0800, true); // flags: bit 11 = UTF-8 file names
    view.setUint16(pos + 2, 0, true); // method: STORE
    view.setUint16(pos + 4, dosTime, true);
    view.setUint16(pos + 6, dosDate, true);
    view.setUint32(pos + 8, e.crc, true);
    view.setUint32(pos + 12, e.data.length, true); // compressed size
    view.setUint32(pos + 16, e.data.length, true); // uncompressed size
    view.setUint16(pos + 20, e.nameBytes.length, true);
    view.setUint16(pos + 22, 0, true); // extra field length
    pos += 24;
  };

  for (const e of entries) {
    e.offset = pos;
    view.setUint32(pos, 0x04034b50, true);
    view.setUint16(pos + 4, 20, true); // version needed
    pos += 6;
    writeHeaderCommon(e);
    out.set(e.nameBytes, pos);
    pos += e.nameBytes.length;
    out.set(e.data, pos);
    pos += e.data.length;
  }

  const centralStart = pos;
  for (const e of entries) {
    view.setUint32(pos, 0x02014b50, true);
    view.setUint16(pos + 4, 20, true); // version made by
    view.setUint16(pos + 6, 20, true); // version needed
    pos += 8;
    writeHeaderCommon(e);
    view.setUint16(pos, 0, true); // comment length
    view.setUint16(pos + 2, 0, true); // disk number start
    view.setUint16(pos + 4, 0, true); // internal attributes
    view.setUint32(pos + 6, 0, true); // external attributes
    view.setUint32(pos + 10, e.offset, true);
    pos += 14;
    out.set(e.nameBytes, pos);
    pos += e.nameBytes.length;
  }

  view.setUint32(pos, 0x06054b50, true);
  view.setUint16(pos + 4, 0, true);
  view.setUint16(pos + 6, 0, true);
  view.setUint16(pos + 8, entries.length, true);
  view.setUint16(pos + 10, entries.length, true);
  view.setUint32(pos + 12, pos - centralStart, true);
  view.setUint32(pos + 16, centralStart, true);
  view.setUint16(pos + 20, 0, true);
  return out;
}

/** Escapes text for XML and drops characters that are illegal in XML 1.0. */
function escapeXml(str) {
  return String(str)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Word dates must be ISO 8601 without milliseconds. */
function toWordDate(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Run content (w:t / w:delText with tabs and line breaks) for one text segment. */
function docxRunContent(text, deleted) {
  const tag = deleted ? 'w:delText' : 'w:t';
  const parts = [];
  const pieces = String(text).split(/(\u0000TAB\u0000|\t|\n)/);
  for (const piece of pieces) {
    if (!piece) continue;
    if (piece === DOCX_TAB || piece === '\t') parts.push('<w:tab/>');
    else if (piece === '\n') parts.push('<w:br/>');
    else parts.push(`<${tag} xml:space="preserve">${escapeXml(piece)}</${tag}>`);
  }
  return parts.join('');
}

function docxRun(text, deleted = false, rPr = '') {
  const content = docxRunContent(text, deleted);
  if (!content) return '';
  return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${content}</w:r>`;
}

/** Maps a parsed block to its paragraph style. */
function docxStyleForBlock(block) {
  if (!block) return 'Normal';
  if (block.isHeaderFooter || block.kind === 'hf') return 'DocDiffHeaderFooter';
  if (block.kind === 'h1') return 'Heading1';
  if (block.kind === 'h2') return 'Heading2';
  if (block.kind === 'h3') return 'Heading3';
  if (block.kind === 'bullet') return 'DocDiffBullet';
  if (block.kind === 'clause') return 'DocDiffClause';
  return 'Normal';
}

/**
 * For list-like paragraphs (bullets, numbered clauses) replace the space after the leading marker
 * with a tab so that the hanging indent of the paragraph style lines up the body text.
 */
function docxApplyMarkerTab(tokens, block) {
  if (!tokens.length || !block || (block.kind !== 'bullet' && block.kind !== 'clause')) return tokens;
  const first = tokens[0];
  const m = first.value.match(/^([•‣▪◦–*-]|\(\d+\)|\([a-z]\)|\([ivx]+\)|\d+\)|[a-z]\))[ \t]+/i);
  if (!m) return tokens;
  const rest = first.value.slice(m[0].length);
  const replaced = [{ ...first, value: m[1] + DOCX_TAB }];
  if (rest) replaced.push({ ...first, value: rest });
  return replaced.concat(tokens.slice(1));
}

/**
 * Builds the WordprocessingML body for the comparison. Pure function of `rows` and `meta`
 * so it can be unit-tested without a browser.
 */
function buildDocxDocumentXml(rows, meta) {
  const date = toWordDate(meta.date);
  let revId = 1;
  const revAttrs = () => `w:id="${revId++}" w:author="${escapeXml(DOCX_AUTHOR)}" w:date="${date}"`;
  const paragraphs = [];

  const metaPara = (label, value) =>
    `<w:p><w:pPr><w:pStyle w:val="DocDiffMeta"/></w:pPr>${docxRun(`${label}: `, false, '<w:b/>')}${docxRun(value)}</w:p>`;

  paragraphs.push(`<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${docxRun(meta.title)}</w:p>`);
  for (const [label, value] of meta.lines) paragraphs.push(metaPara(label, value));
  paragraphs.push(
    `<w:p><w:pPr><w:pStyle w:val="DocDiffMeta"/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="6" w:color="A6A6A6"/></w:pBdr><w:spacing w:after="360"/></w:pPr>${docxRun(meta.note, false, '<w:i/>')}</w:p>`
  );

  for (const row of rows) {
    const block = row.rightBlock || row.leftBlock;
    const style = docxStyleForBlock(block);
    // Word semantics: a change accepted in Doc Diff is plain text (an accepted deletion is
    // simply gone); open changes become tracked changes. Rejected changes are already reverted
    // in the rows (they compare as unchanged).
    const accepted = row.type !== 'equal' && meta.reviewStatusOf && meta.reviewStatusOf(row) === 'accepted';
    if (accepted && !row.rightBlock) continue;
    const tokens = docxApplyMarkerTab(
      accepted ? [{ value: cleanExportText(row.rightBlock.text) }] : getExportDiffTokens(row),
      block
    );
    let markRev = '';
    if (!accepted && row.type === 'inserted') markRev = `<w:rPr><w:ins ${revAttrs()}/></w:rPr>`;
    if (!accepted && row.type === 'deleted') markRev = `<w:rPr><w:del ${revAttrs()}/></w:rPr>`;
    const pPr = `<w:pPr><w:pStyle w:val="${style}"/>${markRev}</w:pPr>`;

    const runs = tokens
      .map(tok => {
        if (tok.removed) {
          const run = docxRun(tok.value, true);
          return run ? `<w:del ${revAttrs()}>${run}</w:del>` : '';
        }
        if (tok.added) {
          const run = docxRun(tok.value, false);
          return run ? `<w:ins ${revAttrs()}>${run}</w:ins>` : '';
        }
        return docxRun(tok.value, false);
      })
      .join('');
    paragraphs.push(`<w:p>${pPr}${runs}</w:p>`);
  }

  const sectPr =
    '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter1"/>' +
    '<w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1417" w:right="1417" w:bottom="1134" w:left="1417" w:header="708" w:footer="567" w:gutter="0"/>' +
    '</w:sectPr>';

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<w:body>${paragraphs.join('')}${sectPr}</w:body></w:document>`
  );
}

function buildDocxFooterXml(meta) {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<w:p><w:pPr><w:pStyle w:val="Footer"/><w:tabs><w:tab w:val="right" w:pos="9072"/></w:tabs></w:pPr>' +
    docxRun(meta.footer) +
    '<w:r><w:tab/></w:r>' +
    docxRun(`${meta.pageLabel} `) +
    '<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>' +
    docxRun(` ${meta.pageOfLabel} `) +
    '<w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>1</w:t></w:r></w:fldSimple>' +
    '</w:p></w:ftr>'
  );
}

function buildDocxStylesXml(langTag) {
  const font = '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>';
  const heading = (id, name, level, size, before, after) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="${after}"/><w:outlineLvl w:val="${level}"/></w:pPr>` +
    `<w:rPr><w:b/><w:bCs/><w:color w:val="1F2937"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:docDefaults><w:rPrDefault><w:rPr>${font}<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="${langTag}"/></w:rPr></w:rPrDefault>` +
    '<w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="10"/><w:qFormat/>' +
    '<w:pPr><w:spacing w:after="160"/></w:pPr><w:rPr><w:b/><w:color w:val="111827"/><w:sz w:val="34"/><w:szCs w:val="34"/></w:rPr></w:style>' +
    heading('Heading1', 'heading 1', 0, 30, 360, 160) +
    heading('Heading2', 'heading 2', 1, 25, 300, 120) +
    heading('Heading3', 'heading 3', 2, 23, 240, 100) +
    '<w:style w:type="paragraph" w:customStyle="1" w:styleId="DocDiffClause"><w:name w:val="Doc Diff Clause"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:tabs><w:tab w:val="left" w:pos="567"/></w:tabs><w:ind w:left="567" w:hanging="567"/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:customStyle="1" w:styleId="DocDiffBullet"><w:name w:val="Doc Diff Bullet"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs><w:spacing w:after="80"/><w:ind w:left="720" w:hanging="360"/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:customStyle="1" w:styleId="DocDiffMeta"><w:name w:val="Doc Diff Metadata"/><w:basedOn w:val="Normal"/>' +
    '<w:pPr><w:spacing w:after="40"/></w:pPr><w:rPr><w:color w:val="4B5563"/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:customStyle="1" w:styleId="DocDiffHeaderFooter"><w:name w:val="Doc Diff Header/Footer Line"/><w:basedOn w:val="Normal"/>' +
    '<w:rPr><w:i/><w:color w:val="6B7280"/><w:sz w:val="17"/><w:szCs w:val="17"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/>' +
    '<w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="6B7280"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>' +
    '</w:styles>'
  );
}

/** Returns the list of files that make up the .docx package. */
function buildDocxPackageFiles(rows, meta) {
  const langTag = meta.lang === 'de' ? 'de-DE' : 'en-US';
  const created = toWordDate(meta.date);
  return [
    {
      name: '[Content_Types].xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'docProps/core.xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        `<dc:title>${escapeXml(meta.title)}</dc:title>` +
        `<dc:subject>${escapeXml(meta.subject)}</dc:subject>` +
        `<dc:creator>${DOCX_AUTHOR}</dc:creator>` +
        `<cp:lastModifiedBy>${DOCX_AUTHOR}</cp:lastModifiedBy>` +
        `<dc:language>${langTag}</dc:language>` +
        `<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>` +
        `<dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>` +
        '</cp:coreProperties>',
    },
    {
      name: 'docProps/app.xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
        '<Application>Doc Diff</Application></Properties>',
    },
    {
      name: 'word/_rels/document.xml.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
        '<Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
        '</Relationships>',
    },
    { name: 'word/document.xml', data: buildDocxDocumentXml(rows, meta) },
    { name: 'word/styles.xml', data: buildDocxStylesXml(langTag) },
    {
      name: 'word/settings.xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:defaultTabStop w:val="708"/><w:characterSpacingControl w:val="doNotCompress"/>' +
        '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>' +
        '</w:settings>',
    },
    { name: 'word/footer1.xml', data: buildDocxFooterXml(meta) },
  ];
}

/** Builds the complete .docx file (Uint8Array) for the current comparison state. */
function buildDocxRedline(date = new Date()) {
  const counts = getExportCounts();
  const lines = [
    [t('exportLabelOriginal'), getDisplayDocName('left')],
    [t('exportLabelRevised'), getDisplayDocName('right')],
    [t('exportLabelCreated'), formatExportDate(date)],
    [t('exportLabelChanges'), formatExportCountsLine(counts)],
  ];
  const review = getExportReviewLine();
  if (review) lines.push([t('exportLabelReview'), review]);
  lines.push([t('exportLabelHf'), state.ignoreHeadersFooters ? t('exportHfIgnored') : t('exportHfIncluded')]);
  const meta = {
    lang: state.lang,
    date,
    title: getExportTitle(),
    subject: t('docxSubject'),
    lines,
    reviewStatusOf: row => row.reviewStatus || '',
    note: t('docxNote'),
    footer: `${getDisplayDocName('right')} ${t('exportVs')} ${getDisplayDocName('left')}`,
    pageLabel: t('pageLabel'),
    pageOfLabel: t('pageOf'),
  };
  // The document is always complete: "Accept all" in Word yields the new version (with the
  // rejections applied), "Reject all" the old version with the accepted changes applied.
  return buildZipArchive(buildDocxPackageFiles(state.alignedRows, meta), date);
}
