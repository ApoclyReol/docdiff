/* ── Import errors & notices ───────────────────────────────────────────── */

// Error with a translatable message key (shown to the user instead of a raw exception).
class ImportError extends Error {
  constructor(messageKey, detail = '') {
    super(messageKey);
    this.messageKey = messageKey;
    this.detail = detail;
  }
}

function describeImportError(err) {
  if (err && err.messageKey) return `${t(err.messageKey)}${err.detail ? ` ${err.detail}` : ''}`;
  return (err && err.message) || String(err);
}

// Accessible, bilingual notice region (role="alert") for import errors and warnings.
const importNotice = (() => {
  const el = document.createElement('div');
  el.id = 'import-notice';
  el.className = 'import-notice';
  el.setAttribute('role', 'alert');
  el.setAttribute('aria-live', 'assertive');
  el.hidden = true;
  const msg = document.createElement('p');
  msg.className = 'import-notice-msg';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'import-notice-close';
  close.textContent = '×';
  close.addEventListener('click', () => clearImportNotice());
  el.append(msg, close);
  document.body.appendChild(el);
  return { el, msg, close };
})();

function showImportNotice(message, kind = 'error') {
  importNotice.msg.textContent = message;
  importNotice.close.setAttribute('aria-label', t('noticeClose'));
  importNotice.el.classList.toggle('is-warning', kind === 'warning');
  importNotice.el.hidden = false;
}

function clearImportNotice() {
  importNotice.el.hidden = true;
  importNotice.msg.textContent = '';
}

/* ── PDF ───────────────────────────────────────────────────────────────── */

async function extractPdfText(arrayBuffer) {
  await ensurePdfJsWorker();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer, isEvalSupported: false }).promise;
  const pages = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    pages.push(buildPdfPageLines(textContent.items, page.view));
  }
  const { text, emptyPages } = assemblePdfText(pages);
  if (pages.length === 0 || emptyPages.length === pages.length) {
    // No text layer at all: a scan or an image-only PDF. OCR is not available.
    throw new ImportError('errScannedPdf');
  }
  const warnings = emptyPages.length
    ? [`${t('warnPdfPagesWithoutText')} ${emptyPages.join(', ')}`]
    : [];
  return { text, warnings };
}

/* ── DOCX ──────────────────────────────────────────────────────────────── */

// Minimal ZIP reader (central directory + stored/deflate entries) for the few XML parts
// Mammoth does not expose. Returns null when the archive cannot be read this way.
async function readZipTextEntries(arrayBuffer, wantedNames) {
  try {
    const bytes = new Uint8Array(arrayBuffer);
    const dv = new DataView(arrayBuffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return null;
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const utf8 = new TextDecoder('utf-8');
    const out = {};
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) return null;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOffset = dv.getUint32(p + 42, true);
      const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      if (!wantedNames.includes(name)) continue;
      const dataStart =
        localOffset + 30 + dv.getUint16(localOffset + 26, true) + dv.getUint16(localOffset + 28, true);
      const data = bytes.subarray(dataStart, dataStart + compSize);
      if (method === 0) {
        out[name] = utf8.decode(data);
      } else if (method === 8 && typeof DecompressionStream !== 'undefined') {
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        out[name] = utf8.decode(await new Response(stream).arrayBuffer());
      } else {
        return null;
      }
    }
    return out;
  } catch (err) {
    return null;
  }
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

function wChild(el, localName) {
  if (!el) return null;
  for (const c of el.children) if (c.namespaceURI === W_NS && c.localName === localName) return c;
  return null;
}

function wVal(el, attr = 'val') {
  if (!el) return undefined;
  const v = el.getAttributeNS(W_NS, attr);
  return v === null || v === '' ? (el.hasAttributeNS(W_NS, attr) ? '' : undefined) : v;
}

function formatListNumber(value, numFmt) {
  const toLetters = (n, upper) => {
    // Word repeats the letter after z: a..z, aa..zz, aaa..
    const letter = String.fromCharCode(97 + ((n - 1) % 26));
    const s = letter.repeat(Math.floor((n - 1) / 26) + 1);
    return upper ? s.toUpperCase() : s;
  };
  const toRoman = n => {
    const map = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    let out = '';
    for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
    return out;
  };
  switch (numFmt || 'decimal') {
    case 'decimal': return String(value);
    case 'decimalZero': return value < 10 ? `0${value}` : String(value);
    case 'lowerLetter': return value > 0 ? toLetters(value, false) : null;
    case 'upperLetter': return value > 0 ? toLetters(value, true) : null;
    case 'lowerRoman': return value > 0 ? toRoman(value) : null;
    case 'upperRoman': return value > 0 ? toRoman(value).toUpperCase() : null;
    default: return null; // unknown format: do not guess
  }
}

/**
 * Computes the visible list marker ("(1)", "1.2", "a)", "•") of every paragraph the way
 * Word numbers them: counters per abstract numbering definition (so a list interrupted
 * by other paragraphs continues), deeper levels restart below a higher level, and a
 * w:startOverride restarts the list when its w:num is first used.
 * Returns an array (document order of w:p, as Mammoth reads them) of
 * { numbered, ilvl, marker, text } — marker is null when it cannot be determined reliably;
 * text is the paragraph's plain text, used to verify the alignment with Mammoth's paragraphs.
 */
function computeDocxListMarkers(documentXml, numberingXml, stylesXml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(documentXml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return null;
  const numDoc = numberingXml ? parser.parseFromString(numberingXml, 'application/xml') : null;
  const styleDoc = stylesXml ? parser.parseFromString(stylesXml, 'application/xml') : null;

  const abstracts = {};
  const nums = {};
  const lvlStyleLinks = {};
  const readLvl = lvl => ({
    numFmt: wVal(wChild(lvl, 'numFmt')) || 'decimal',
    lvlText: wVal(wChild(lvl, 'lvlText')),
    start: parseInt(wVal(wChild(lvl, 'start')) || '1', 10),
    isLgl: Boolean(wChild(lvl, 'isLgl')),
  });
  if (numDoc) {
    for (const an of numDoc.getElementsByTagNameNS(W_NS, 'abstractNum')) {
      const id = wVal(an, 'abstractNumId');
      const levels = {};
      for (const lvl of an.getElementsByTagNameNS(W_NS, 'lvl')) {
        const ilvl = wVal(lvl, 'ilvl');
        levels[ilvl] = readLvl(lvl);
        const pStyle = wVal(wChild(lvl, 'pStyle'));
        if (pStyle) lvlStyleLinks[pStyle] = { abstractNumId: id, ilvl };
      }
      abstracts[id] = { levels, numStyleLink: wVal(wChild(an, 'numStyleLink')) };
    }
    for (const num of numDoc.getElementsByTagNameNS(W_NS, 'num')) {
      const overrides = {};
      for (const ov of num.getElementsByTagNameNS(W_NS, 'lvlOverride')) {
        const ilvl = wVal(ov, 'ilvl');
        const so = wVal(wChild(ov, 'startOverride'));
        const lvl = wChild(ov, 'lvl');
        overrides[ilvl] = {
          startOverride: so !== undefined ? parseInt(so, 10) : null,
          lvl: lvl ? readLvl(lvl) : null,
        };
      }
      nums[wVal(num, 'numId')] = { abstractNumId: wVal(wChild(num, 'abstractNumId')), overrides };
    }
  }

  const styles = {};
  if (styleDoc) {
    for (const st of styleDoc.getElementsByTagNameNS(W_NS, 'style')) {
      const numPr = wChild(wChild(st, 'pPr'), 'numPr');
      styles[wVal(st, 'styleId')] = {
        basedOn: wVal(wChild(st, 'basedOn')),
        numId: wVal(wChild(numPr, 'numId')),
        ilvl: wVal(wChild(numPr, 'ilvl')),
      };
    }
  }

  const resolveAbstractId = absId => {
    const abs = abstracts[absId];
    if (abs && abs.numStyleLink && !Object.keys(abs.levels).length) {
      const st = styles[abs.numStyleLink];
      const linked = st && nums[st.numId];
      if (linked) return linked.abstractNumId;
    }
    return absId;
  };

  const resolveParagraph = p => {
    const pPr = wChild(p, 'pPr');
    const numPr = wChild(pPr, 'numPr');
    const styleId = wVal(wChild(pPr, 'pStyle'));
    let numId = wVal(wChild(numPr, 'numId'));
    let ilvl = wVal(wChild(numPr, 'ilvl'));
    let sid = styleId;
    for (let guard = 0; sid && guard < 12 && (numId === undefined || ilvl === undefined); guard++) {
      const st = styles[sid];
      if (!st) break;
      if (numId === undefined && st.numId !== undefined) numId = st.numId;
      if (ilvl === undefined && st.ilvl !== undefined) ilvl = st.ilvl;
      sid = st.basedOn;
    }
    if (numId === undefined && styleId && lvlStyleLinks[styleId]) {
      // Numbering attached through the abstract definition's w:pStyle (e.g. heading numbering).
      const link = lvlStyleLinks[styleId];
      const numIdForAbs = Object.keys(nums).find(id => nums[id].abstractNumId === link.abstractNumId);
      if (numIdForAbs === undefined) return null;
      numId = numIdForAbs;
      if (ilvl === undefined) ilvl = link.ilvl;
    }
    if (numId === undefined || numId === '0') return null;
    return { numId, ilvl: ilvl === undefined ? '0' : ilvl };
  };

  // Paragraphs in the order Mammoth reads them: depth-first, mc:AlternateContent -> mc:Fallback.
  const paragraphs = [];
  const walk = el => {
    for (const c of el.children) {
      if (c.namespaceURI === MC_NS && c.localName === 'AlternateContent') {
        const fallback = Array.from(c.children).find(x => x.localName === 'Fallback');
        if (fallback) walk(fallback);
        continue;
      }
      if (c.namespaceURI === W_NS && c.localName === 'p') paragraphs.push(c);
      walk(c);
    }
  };
  const body = doc.getElementsByTagNameNS(W_NS, 'body')[0];
  if (!body) return null;
  walk(body);

  const paragraphText = p => {
    let text = '';
    const collect = el => {
      for (const c of el.children) {
        if (c.namespaceURI === MC_NS && c.localName === 'Choice') continue;
        if (c.namespaceURI === W_NS && c.localName === 't') text += c.textContent;
        else collect(c);
      }
    };
    collect(p);
    return text;
  };

  const counters = new Map();
  const seenNums = new Set();
  return paragraphs.map(p => ({ ...numberParagraph(p), text: paragraphText(p) }));

  function numberParagraph(p) {
    const info = resolveParagraph(p);
    if (!info) return { numbered: false, ilvl: null, marker: null };
    const num = nums[info.numId];
    if (!num) return { numbered: true, ilvl: info.ilvl, marker: null };
    const absId = resolveAbstractId(num.abstractNumId);
    const abs = abstracts[absId];
    const ilvl = parseInt(info.ilvl, 10) || 0;
    const levelDef = k => (num.overrides[k] && num.overrides[k].lvl) || (abs && abs.levels[k]) || null;
    const def = levelDef(ilvl);
    if (!def) return { numbered: true, ilvl: info.ilvl, marker: null };

    if (!counters.has(absId)) counters.set(absId, new Array(9).fill(null));
    const arr = counters.get(absId);
    if (!seenNums.has(info.numId)) {
      seenNums.add(info.numId);
      for (const [k, ov] of Object.entries(num.overrides)) {
        if (ov.startOverride !== null && !Number.isNaN(ov.startOverride)) arr[parseInt(k, 10)] = ov.startOverride - 1;
      }
    }
    arr[ilvl] = (arr[ilvl] === null ? def.start - 1 : arr[ilvl]) + 1;
    for (let k = ilvl + 1; k < arr.length; k++) arr[k] = null;

    if (def.numFmt === 'bullet') return { numbered: true, ilvl: info.ilvl, marker: '•', bullet: true };
    if (def.numFmt === 'none') return { numbered: true, ilvl: info.ilvl, marker: '' };
    if (def.lvlText === undefined) return { numbered: true, ilvl: info.ilvl, marker: null };
    let reliable = true;
    const marker = def.lvlText.replace(/%([1-9])/g, (_, d) => {
      const k = parseInt(d, 10) - 1;
      const kDef = levelDef(k);
      const value = arr[k] === null ? (kDef ? kDef.start : 1) : arr[k];
      const fmt = def.isLgl && k < ilvl ? 'decimal' : kDef ? kDef.numFmt : 'decimal';
      const s = formatListNumber(value, fmt);
      if (s === null) reliable = false;
      return s || '';
    });
    return { numbered: true, ilvl: info.ilvl, marker: reliable ? marker.trim() : null };
  }
}

// Mammoth does not output list numbers. Sentinels used to carry the computed marker and
// list level of a paragraph through Mammoth's HTML conversion
// (SENTINEL + ilvl + LEVEL_SEP + marker + SENTINEL; removed again when the HTML is read).
const DOCX_MARKER_SENTINEL = '\u001D';
const DOCX_LEVEL_SEP = '\u001C';

function mammothParagraphText(element) {
  let text = '';
  for (const child of element.children || []) {
    if (child.type === 'text' && typeof child.value === 'string') text += child.value;
    else text += mammothParagraphText(child);
  }
  return text;
}

function collectMammothParagraphs(element, out = []) {
  if (!element) return out;
  if (element.type === 'paragraph') out.push(element);
  for (const child of element.children || []) collectMammothParagraphs(child, out);
  return out;
}

function prefixFirstText(element, prefix) {
  for (const child of element.children || []) {
    if (child.type === 'text' && typeof child.value === 'string') {
      child.value = prefix + child.value;
      return true;
    }
    if (prefixFirstText(child, prefix)) return true;
  }
  return false;
}

async function extractDocxText(arrayBuffer) {
  if (!window.mammoth || typeof window.mammoth.convertToHtml !== 'function') {
    throw new ImportError('errUnsupportedType');
  }

  // Word list numbering (best effort; when anything does not match, no markers are shown
  // rather than invented ones).
  let listMarkers = null;
  const parts = await readZipTextEntries(arrayBuffer, [
    'word/document.xml',
    'word/numbering.xml',
    'word/styles.xml',
  ]);
  if (parts && parts['word/document.xml']) {
    try {
      listMarkers = computeDocxListMarkers(
        parts['word/document.xml'],
        parts['word/numbering.xml'],
        parts['word/styles.xml']
      );
    } catch (err) {
      listMarkers = null;
    }
  }

  let markersInjected = false;
  const transformDocument = documentElement => {
    if (!listMarkers) return documentElement;
    const paras = collectMammothParagraphs(documentElement);
    if (paras.length !== listMarkers.length) return documentElement;
    // Verify that both readers see the same paragraphs: every numbered paragraph must have
    // the same text, and nearly all others too. Otherwise show no numbers at all.
    const norm = s => String(s || '').replace(/\s+/g, '');
    let same = 0;
    for (let i = 0; i < paras.length; i++) {
      const equalText = norm(mammothParagraphText(paras[i])) === norm(listMarkers[i].text);
      if (equalText) same++;
      else if (listMarkers[i].numbered || paras[i].numbering) return documentElement;
    }
    if (paras.length && same / paras.length < 0.9) return documentElement;
    paras.forEach((para, i) => {
      const mine = listMarkers[i];
      if (mine.numbered && mine.marker !== null) {
        prefixFirstText(
          para,
          `${DOCX_MARKER_SENTINEL}${mine.ilvl}${DOCX_LEVEL_SEP}${mine.marker}${DOCX_MARKER_SENTINEL}`
        );
      }
    });
    markersInjected = true;
    return documentElement;
  };

  const htmlResult = await window.mammoth.convertToHtml({ arrayBuffer }, { transformDocument });
  const doc = new DOMParser().parseFromString(htmlResult.value || '', 'text/html');
  const out = [];
  const S = DOCX_MARKER_SENTINEL;
  const L = DOCX_LEVEL_SEP;
  const sentinelRe = new RegExp(`^\\s*${S}(\\d*)${L}([^${S}]*)${S}\\s*`);
  const anySentinelRe = new RegExp(`${S}\\d*${L}([^${S}]*)${S}\\s*`, 'g');
  const clean = s => sanitizeExternalText(String(s || '').replace(/\s+/g, ' ')).trim();
  const takeMarker = raw => {
    const m = String(raw || '').match(sentinelRe);
    if (!m) return { marker: null, level: null, text: clean(String(raw || '').replace(anySentinelRe, '$1 ')) };
    return {
      marker: clean(m[2]),
      level: m[1] === '' ? null : parseInt(m[1], 10),
      text: clean(String(raw).slice(m[0].length).replace(anySentinelRe, '$1 ')),
    };
  };
  const withMarker = (marker, text) => (marker ? `${marker} ${text}` : text);
  const push = (line, depth = 0) => {
    if (line) out.push(metaLine(depth > 0 ? `lvl=${depth}` : '', line));
  };

  const walkList = (listEl, depth) => {
    const isBulletList = listEl.tagName.toLowerCase() === 'ul';
    for (const li of listEl.children) {
      if (li.tagName.toLowerCase() !== 'li') continue;
      const own = li.cloneNode(true);
      own.querySelectorAll('ul, ol').forEach(n => n.remove());
      const { marker, level, text } = takeMarker(own.textContent);
      // Bullets are known to be bullets; numbers are only shown when read from the document.
      const shownMarker = marker !== null ? marker : isBulletList ? '•' : '';
      if (text) push(withMarker(shownMarker, text), level !== null ? level : depth);
      for (const child of li.querySelectorAll(':scope > ul, :scope > ol')) walkList(child, depth + 1);
    }
  };

  const walkNodes = root => {
    for (const node of root.children) {
      const tag = node.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        const { marker, text } = takeMarker(node.textContent);
        const prefix = tag === 'h1' ? '# ' : tag === 'h2' ? '## ' : '### ';
        if (text) push(prefix + withMarker(marker, text));
      } else if (tag === 'ul' || tag === 'ol') {
        walkList(node, 0);
      } else if (tag === 'table') {
        node.querySelectorAll('tr').forEach(tr => {
          const cells = Array.from(tr.querySelectorAll('th, td'))
            .map(c => clean(String(c.textContent || '').replace(anySentinelRe, (m, mk) => (mk ? `${mk} ` : ''))))
            .filter(Boolean);
          if (cells.length) push(cells.join(' · '));
        });
      } else if (tag === 'p') {
        const { marker, level, text } = takeMarker(node.textContent);
        if (text) push(withMarker(marker, text), level || 0);
      } else if (node.children && node.children.length > 0) {
        walkNodes(node);
      } else {
        const { text } = takeMarker(node.textContent);
        if (text) push(text);
      }
    }
  };

  walkNodes(doc.body);
  if (out.length > 0) return { text: out.join('\n\n'), warnings: [], markersInjected };

  const result = await window.mammoth.extractRawText({ arrayBuffer });
  const raw = sanitizeExternalText(result.value).trim();
  if (!raw) throw new ImportError('errDocxEmpty');
  return { text: raw, warnings: [], markersInjected: false };
}

/* ── HTML & plain text ─────────────────────────────────────────────────── */

// Extracts readable text from an HTML file. DOMParser documents are inert: scripts are not
// executed and no resources are loaded.
function extractHtmlText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, noscript, template, head, svg, iframe, object').forEach(n => n.remove());
  const BLOCK = /^(p|div|section|article|header|footer|main|aside|nav|h[1-6]|li|tr|blockquote|pre|dd|dt|figcaption|address|table|ul|ol|dl|br|hr)$/;
  const out = [];
  let buf = '';
  const flush = () => {
    const line = sanitizeExternalText(buf.replace(/\s+/g, ' ')).trim();
    if (line) out.push(line);
    buf = '';
  };
  const walk = node => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) {
        buf += c.nodeValue;
      } else if (c.nodeType === 1) {
        const tag = c.tagName.toLowerCase();
        if (BLOCK.test(tag)) {
          flush();
          if (/^h[1-3]$/.test(tag)) buf += `${'#'.repeat(Number(tag[1]))} `;
          else if (tag === 'li' && c.parentElement && c.parentElement.tagName.toLowerCase() === 'ul') buf += '• ';
          walk(c);
          flush();
        } else if (tag === 'td' || tag === 'th') {
          if (buf.trim()) buf += ' · ';
          walk(c);
        } else {
          walk(c);
        }
      }
    }
  };
  walk(doc.body || doc.documentElement);
  flush();
  return out.join('\n\n');
}

function decodeTextFile(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (err) {
    throw new ImportError('errNotText');
  }
  if (text.includes('\u0000')) throw new ImportError('errNotText');
  return text.replace(/^﻿/, '');
}

/* ── File intake ───────────────────────────────────────────────────────── */

const TEXT_EXTENSIONS = ['txt', 'md', 'markdown', 'text', 'csv', 'log', ''];
const HTML_EXTENSIONS = ['html', 'htm', 'xhtml'];

// Determines the real file type from its content (the `accept` attribute is only a hint and
// is ignored for drag & drop). Throws an ImportError for unsupported files.
function sniffFileKind(bytes, ext) {
  const startsWith = sig => sig.every((b, i) => bytes[i] === b);
  const head = String.fromCharCode(...bytes.subarray(0, 1024));
  if (head.includes('%PDF-')) return 'pdf';
  if (startsWith([0x50, 0x4b, 0x03, 0x04])) {
    if (['docx', 'docm', 'dotx', 'dotm'].includes(ext) || head.includes('word/')) return 'docx';
    throw new ImportError('errUnsupportedType');
  }
  if (startsWith([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) throw new ImportError('errLegacyDoc');
  if (head.startsWith('{\\rtf')) throw new ImportError('errRtf');
  if (
    startsWith([0x89, 0x50, 0x4e, 0x47]) ||
    startsWith([0xff, 0xd8, 0xff]) ||
    head.startsWith('GIF8') ||
    startsWith([0x49, 0x49, 0x2a, 0x00]) ||
    startsWith([0x4d, 0x4d, 0x00, 0x2a]) ||
    (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP')
  ) {
    throw new ImportError('errImage');
  }
  if (ext === 'pdf' || ext === 'docx' || ext === 'doc') {
    throw new ImportError(ext === 'doc' ? 'errLegacyDoc' : 'errUnsupportedType');
  }
  if (HTML_EXTENSIONS.includes(ext)) return 'html';
  if (TEXT_EXTENSIONS.includes(ext)) return 'text';
  // Unknown extension: accepted only if it decodes as text (checked by the caller).
  return 'text';
}

/**
 * Reads a dropped or picked file into the internal document encoding.
 * Returns { text, format, warnings }.
 */
async function readDocumentFile(file) {
  const ext = (file.name.includes('.') ? file.name.split('.').pop() : '').toLowerCase();
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (!bytes.length) throw new ImportError('errEmptyFile');
  const kind = sniffFileKind(bytes, ext);

  let result;
  if (kind === 'pdf') {
    result = await extractPdfText(buffer);
    result.format = 'PDF';
  } else if (kind === 'docx') {
    result = await extractDocxText(buffer);
    result.format = 'DOCX';
  } else {
    const text = decodeTextFile(bytes);
    const looksLikeHtml = /^\s*(?:<!doctype html|<html[\s>])/i.test(text.slice(0, 2048));
    if (kind === 'html' || looksLikeHtml) {
      result = { text: extractHtmlText(text), warnings: [], format: 'HTML' };
    } else {
      result = { text: sanitizeExternalText(text), warnings: [], format: ext ? ext.toUpperCase() : 'TEXT' };
    }
  }
  if (!docTextToPlainText(result.text).trim()) throw new ImportError('errEmptyFile');
  return result;
}

// opts.keepNotice: do not clear an earlier notice on success (multi-file drops).
async function handleFileUpload(file, side, opts = {}) {
  if (!file) return false;
  const fnLabel = document.getElementById(side === 'left' ? 'filename-left' : 'filename-right');
  const prevName = fnLabel.textContent;
  fnLabel.textContent = `${t('readingFile')} ${file.name}…`;

  try {
    const { text, format, warnings } = await readDocumentFile(file);

    if (side === 'left') {
      state.leftName = file.name;
      state.leftFormat = format;
      state.leftText = text;
    } else {
      state.rightName = file.name;
      state.rightFormat = format;
      state.rightText = text;
    }
    resetEditHistory();
    if (warnings && warnings.length) {
      showImportNotice(`${file.name}: ${warnings.join(' ')}`, 'warning');
    } else if (!opts.keepNotice) {
      clearImportNotice();
    }
    runComparison();
    return true;
  } catch (err) {
    fnLabel.textContent = prevName;
    showImportNotice(`${t('readError')} „${file.name}“: ${describeImportError(err)}`, 'error');
    return false;
  } finally {
    const input = document.getElementById(side === 'left' ? 'file-input-left' : 'file-input-right');
    if (input) input.value = '';
  }
}

let dragCounter = 0;
window.addEventListener('dragenter', e => {
  if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
    dragCounter++;
    document.body.classList.add('is-dragging-file');
  }
});
window.addEventListener('dragleave', () => {
  dragCounter = Math.max(0, dragCounter - 1);
  if (dragCounter === 0) document.body.classList.remove('is-dragging-file');
});
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault();
  dragCounter = 0;
  document.body.classList.remove('is-dragging-file');
});

async function handleDropFiles(files, targetSide) {
  if (!files || !files.length) return;
  if (files.length >= 2) {
    clearImportNotice();
    await handleFileUpload(files[0], 'left', { keepNotice: true });
    await handleFileUpload(files[1], 'right', { keepNotice: true });
  } else {
    await handleFileUpload(files[0], targetSide);
  }
}

[
  { el: paneLeft, side: 'left' },
  { el: paneRight, side: 'right' },
  { el: paneUnified, side: 'right' },
  { el: document.querySelector('.col-bar-left'), side: 'left' },
  { el: document.querySelector('.col-bar-right'), side: 'right' },
].forEach(({ el, side }) => {
  if (!el) return;
  el.addEventListener('dragover', e => {
    e.preventDefault();
    (side === 'left' ? paneLeft : paneRight).classList.add('drag-over');
  });
  el.addEventListener('dragleave', () => {
    (side === 'left' ? paneLeft : paneRight).classList.remove('drag-over');
  });
  el.addEventListener('drop', async e => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    document.body.classList.remove('is-dragging-file');
    paneLeft.classList.remove('drag-over');
    paneRight.classList.remove('drag-over');
    const actualSide = !state.leftText ? 'left' : side;
    await handleDropFiles(e.dataTransfer.files, actualSide);
  });
});

const fileInputLeft = document.getElementById('file-input-left');
const fileInputRight = document.getElementById('file-input-right');
document.getElementById('btn-upload-left').addEventListener('click', () => fileInputLeft.click());
document.getElementById('btn-upload-right').addEventListener('click', () => fileInputRight.click());
fileInputLeft.addEventListener('change', e => handleFileUpload(e.target.files[0], 'left'));
fileInputRight.addEventListener('change', e => handleFileUpload(e.target.files[0], 'right'));

document.getElementById('btn-clear-left').addEventListener('click', () => {
  state.leftText = '';
  state.leftName = '';
  state.leftFormat = '';
  resetEditHistory();
  fileInputLeft.value = '';
  runComparison();
});

document.getElementById('btn-clear-right').addEventListener('click', () => {
  state.rightText = '';
  state.rightName = '';
  state.rightFormat = '';
  resetEditHistory();
  fileInputRight.value = '';
  runComparison();
});
