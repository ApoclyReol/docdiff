/* ── Document text encoding ──────────────────────────────────────────────
 * Loaded documents are kept as plain strings (state.leftText / state.rightText).
 * Structural metadata that is NOT part of the document text — page breaks,
 * header/footer lines, list nesting depth — is encoded with ASCII control
 * characters that cannot occur in user-visible text:
 *
 *   DOC_PAGE_MARK + n                     starts page n (own line)
 *   DOC_META_MARK + meta + DOC_META_MARK  prefixes a line with metadata,
 *                                         meta = "hf" | "lvl=2" | "hf;lvl=1"
 *
 * Every external input (typed/pasted text, text files, PDF and DOCX text) is
 * passed through sanitizeExternalText(), which strips these control characters,
 * so document content can never be (mis)interpreted as metadata, and
 * docTextToPlainText() removes the metadata before text is shown to the user.
 * This file must stay free of DOM access (it also runs inside a Worker).
 */
const DOC_PAGE_MARK = '\u001E';
const DOC_META_MARK = '\u001F';

function sanitizeExternalText(text) {
  return String(text == null ? '' : text)
    .replace(/\r\n?/g, '\n')
    .replace(/\f/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000E-\u001F\u007F]/g, '');
}

function pageMarkerLine(pageNum) {
  return `${DOC_PAGE_MARK}${pageNum}`;
}

function metaLine(meta, text) {
  return meta ? `${DOC_META_MARK}${meta}${DOC_META_MARK}${text}` : text;
}

function serializeBlockLine(block) {
  const meta = [];
  if (block.kind === 'hf' || block.isHeaderFooter) meta.push('hf');
  if (block.indent > 0) meta.push(`lvl=${block.indent}`);
  return metaLine(meta.join(';'), block.text);
}

function parseLineMeta(line) {
  if (!line.startsWith(DOC_META_MARK)) return { meta: null, text: line };
  const end = line.indexOf(DOC_META_MARK, 1);
  if (end < 0) return { meta: null, text: line.slice(1) };
  const meta = {};
  for (const part of line.slice(1, end).split(';')) {
    const [key, value] = part.split('=');
    if (key) meta[key.trim()] = value === undefined ? true : value.trim();
  }
  return { meta, text: line.slice(end + 1) };
}

// Plain text for display/editing (paste dialog): page and header/footer metadata removed.
function docTextToPlainText(docText) {
  if (!docText) return '';
  const out = [];
  for (const rawLine of String(docText).split('\n')) {
    if (rawLine.startsWith(DOC_PAGE_MARK)) continue;
    out.push(parseLineMeta(rawLine).text);
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ── Header / footer detection ─────────────────────────────────────────── */

// A line that is nothing but a page number label ("Seite 3 von 9", "- 3 -", "Page 2/7").
function isPageNumberLabel(line) {
  if (!line || line.length > 40) return false;
  return /^(?:(?:Seite|Page|Blatt|S\.|p\.)\s*\d+(?:\s*(?:von|of|\/)\s*\d+)?|-\s*\d+\s*-|\d+\s*(?:\/|von|of)\s*\d+)$/i.test(
    line.trim()
  );
}

// A page number label without a word like "Seite"/"Page" ("3/9", "3 von 9", "- 3 -"): the same
// shapes occur as content (shares, table cells), so they need more evidence (see parseIntoBlocks).
function isBarePageNumberLabel(line) {
  return isPageNumberLabel(line) && !/^\s*(?:Seite|Page|Blatt|S\.|p\.)/i.test(line);
}

// Text-only header/footer candidate test (used for pasted text without page geometry).
// Pure page labels qualify on their own; longer running lines ("Vertraulich · Seite 2 von 9")
// are only treated as header/footer by parseIntoBlocks when they repeat within the document.
function isLikelyHeaderOrFooterLine(line) {
  if (!line || line.length > 130) return false;
  if (isPageNumberLabel(line)) return true;
  if (/(?:\bSeite|\bPage)\s+\d+\s*(?:von|of|\/)\s*\d+\s*$/i.test(line)) return true;
  if (/^(?:Vertraulich|Confidential|Stand:|Fassung|Entwurf|Draft)\b.*(?:\bSeite|\bPage)\s+\d+/i.test(line)) {
    return true;
  }
  return false;
}

// Key for "same running line on every page": page numbers and other digits normalised away.
function normalizeHfRepeatKey(text) {
  return String(text).toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

// Key for comparing header/footer lines ACROSS versions: only page numbers are normalised,
// so a changed date or version label in a header is still detected as a difference.
function normalizeHfCompareKey(text) {
  return String(text)
    .toLowerCase()
    .replace(/(?:\bseite|\bpage|\bblatt|\bs\.|\bp\.)\s*\d+(?:\s*(?:von|of|\/)\s*\d+)?/g, 'seite #')
    .replace(/^\s*-\s*\d+\s*-\s*$/, '#')
    .replace(/^\s*\d+\s*$/, '#')
    .replace(/\b\d+\s*(?:\/|von|of)\s*\d+\s*$/, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Decides which margin lines of a paginated document are running headers/footers.
 * pages: array (one entry per page) of candidate lines { text, yPct } where yPct is the
 * line's vertical position as a fraction of the page height (0 = bottom, 1 = top).
 * A candidate is a header/footer only if its digit-normalised text occurs on at least
 * 50% of the pages (and on at least 2 pages) at a similar vertical position.
 * Returns an array of boolean arrays parallel to `pages`.
 */
function detectRepeatingMarginLines(pages, yTolerance = 0.03) {
  const numPages = pages.length;
  const result = pages.map(lines => lines.map(() => false));
  if (numPages < 2) return result;
  const minPages = Math.max(2, Math.ceil(numPages * 0.5));

  const groups = new Map();
  pages.forEach((lines, p) => {
    lines.forEach((line, l) => {
      if (!line || !line.text || !line.text.trim()) return;
      const band = line.yPct >= 0.5 ? 'T' : 'B';
      const key = `${band}|${normalizeHfRepeatKey(line.text)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ p, l, y: line.yPct });
    });
  });

  for (const members of groups.values()) {
    if (new Set(members.map(m => m.p)).size < minPages) continue;
    // Cluster by vertical position: keep the members close to the median y.
    const ys = members.map(m => m.y).sort((a, b) => a - b);
    const median = ys[Math.floor(ys.length / 2)];
    const close = members.filter(m => Math.abs(m.y - median) <= yTolerance);
    if (new Set(close.map(m => m.p)).size < minPages) continue;
    for (const m of close) result[m.p][m.l] = true;
  }
  return result;
}

// Position of a header/footer line on its page: 'T' before the page's first body line,
// 'B' after it; '' for documents without pages. Returns one entry per header/footer block.
function headerFooterSlots(blocks) {
  const out = [];
  let page = null;
  let seenBody = false;
  for (const b of blocks) {
    if (b.pageNum !== page) {
      page = b.pageNum;
      seenBody = false;
    }
    if (!b.isHeaderFooter) {
      seenBody = true;
      continue;
    }
    out.push({ block: b, band: b.hasExplicitPage ? (seenBody ? 'B' : 'T') : '' });
  }
  return out;
}

// Longest common subsequence of two token arrays: returns [matchedA, matchedB] as boolean
// arrays. Uses jsdiff's diffArrays (Myers) when available; otherwise a multiset fallback that
// only keeps tokens hidden when both versions contain them equally often.
function matchTokenSequences(a, b) {
  const matchedA = new Array(a.length).fill(false);
  const matchedB = new Array(b.length).fill(false);
  const diffLib = getDiffLibrary();
  if (diffLib && typeof diffLib.diffArrays === 'function') {
    let i = 0;
    let j = 0;
    for (const part of diffLib.diffArrays(a, b)) {
      const n = part.count !== undefined ? part.count : part.value.length;
      if (part.added) j += n;
      else if (part.removed) i += n;
      else {
        for (let k = 0; k < n; k++) {
          matchedA[i++] = true;
          matchedB[j++] = true;
        }
      }
    }
    return [matchedA, matchedB];
  }
  const count = arr => arr.reduce((m, t) => m.set(t, (m.get(t) || 0) + 1), new Map());
  const ca = count(a);
  const cb = count(b);
  a.forEach((t, k) => { matchedA[k] = ca.get(t) === cb.get(t); });
  b.forEach((t, k) => { matchedB[k] = ca.get(t) === cb.get(t); });
  return [matchedA, matchedB];
}

/**
 * Change-preserving header/footer filter. Hiding running headers/footers must never hide a
 * change, so the hidden candidates of both versions are matched against each other as
 * sequences of (band, text) tokens in document order, with page numbers normalised away
 * (normalizeHfCompareKey). Matching in order pairs the occurrences page by page, also when
 * pages were inserted or removed. Only matched occurrences stay hidden; every unmatched one
 * (a header changed on one page, a footer changed on all pages, a repeated line deleted on
 * one page, an extra occurrence) is made visible at that occurrence (flag `hfVisible`) and
 * diffed like body text.
 * Exceptions, which stay hidden: pure page-number labels ("Seite 3 von 9": they change
 * whenever the page count changes, not with the content), and the running lines of a PDF
 * compared with a version that has no pages and no header/footer lines at all (DOCX, pasted
 * text): there is nothing to compare them with, they are layout, not a change.
 * Mutates the blocks; returns the number of header/footer blocks that remain hidden.
 */
function reconcileHeaderFooterBlocks(leftBlocks, rightBlocks) {
  const hfL = leftBlocks.filter(b => b.isHeaderFooter);
  const hfR = rightBlocks.filter(b => b.isHeaderFooter);
  for (const b of hfL.concat(hfR)) delete b.hfVisible;
  if (leftBlocks.length && rightBlocks.length && (hfL.length || hfR.length)) {
    const paginated = blocks => blocks.some(b => b.hasExplicitPage);
    const comparable = paginated(leftBlocks) === paginated(rightBlocks) || (hfL.length > 0 && hfR.length > 0);
    if (comparable) {
      const candidates = blocks =>
        headerFooterSlots(blocks).filter(slot => !isPageNumberLabel(slot.block.text));
      const slotsL = candidates(leftBlocks);
      const slotsR = candidates(rightBlocks);
      const token = slot => `${slot.band}|${normalizeHfCompareKey(slot.block.text)}`;
      const [matchedL, matchedR] = matchTokenSequences(slotsL.map(token), slotsR.map(token));
      slotsL.forEach((slot, k) => { if (!matchedL[k]) slot.block.hfVisible = true; });
      slotsR.forEach((slot, k) => { if (!matchedR[k]) slot.block.hfVisible = true; });
    }
  }
  return [...hfL, ...hfR].filter(b => !b.hfVisible).length;
}

function isHiddenHeaderFooter(block) {
  return Boolean(block && block.isHeaderFooter && !block.hfVisible);
}

/* ── Block classification ──────────────────────────────────────────────── */

// An ordinary sentence is never a heading, whatever it starts with ("§ 2 Der Auftragnehmer
// erbringt die Leistung fristgerecht."): it ends with sentence punctuation and has several
// words, or it is simply too long for a heading.
function looksLikeSentence(line) {
  const words = line.split(/\s+/).length;
  return (/[.;:,!?]["“”)]?$/.test(line) && words >= 6) || words >= 14;
}

function classifyBlockKind(line, isFirstContentBlock, isHeaderFooter) {
  if (isHeaderFooter) return 'hf';
  if (/^#\s+/.test(line)) return 'h1';
  if (/^##\s+/.test(line)) return 'h2';
  if (/^###\s+/.test(line)) return 'h3';
  if (looksLikeSentence(line)) return classifyBodyKind(line);

  if (
    isFirstContentBlock &&
    line.length < 105 &&
    !/^(§|\(\d+\)|\d+\.|[•‣▪◦–*-]\s)/.test(line) &&
    (/^[A-ZÄÖÜ0-9\s,&/-]{10,}$/.test(line) || !/[.:;]$/.test(line))
  ) {
    return 'h1';
  }

  if (
    /^(§\s*\d+[a-z]?|Artikel\s+\d+|Anlage\s+\d+|Section\s+\d+|Exhibit\s+[A-Z0-9]+)/i.test(line) &&
    line.length < 115
  ) {
    return 'h2';
  }

  // "1. Haftung" is a heading; "1. Der Auftragnehmer haftet …." is a numbered paragraph.
  if (/^\d+\.\s+[A-ZÄÖÜ]/.test(line) && line.length < 115 && !/[.;:,]$/.test(line)) {
    return 'h2';
  }

  if (
    /^(\d+\.\d+(?:\.\d+)*)\s+[A-ZÄÖÜa-zäöü]/.test(line) &&
    line.length < 105 &&
    !/[.;]$/.test(line)
  ) {
    return 'h3';
  }

  if (/^[A-ZÄÖÜ\s&-]{10,}$/.test(line) && line.length < 105) {
    return isFirstContentBlock ? 'h1' : 'h2';
  }

  return classifyBodyKind(line);
}

function classifyBodyKind(line) {
  if (/^[•‣▪◦–*-]\s+\S/.test(line)) {
    return 'bullet';
  }

  if (/^(\(\d+\)|\([a-z]\)|\([ivx]+\)|\d+\)|[a-z]\))\s+\S/i.test(line)) {
    return 'clause';
  }

  return 'p';
}

function extractListMarker(text, kind) {
  if (!text) return null;
  if (kind === 'bullet') {
    const m = text.match(/^([•‣▪◦–*-])\s+(.*)$/s);
    if (m) return { marker: '•', body: m[2] };
  }
  if (kind === 'clause') {
    const m = text.match(/^(\(\d+\)|\([a-z]\)|\([ivx]+\)|\d+\)|[a-z]\))\s+(.*)$/is);
    if (m) return { marker: m[1], body: m[2] };
  }
  return null;
}

// Numbering prefix that only reflects the position in the document (list marker or
// heading number). Used to align blocks independent of renumbering. Returns null when
// the block has no such marker (or the remaining body would be too short to identify it).
function splitNumberingMarker(text, kind) {
  let m = null;
  if (kind === 'clause' || kind === 'bullet') {
    const split = extractListMarker(text, kind);
    if (split) m = [null, kind === 'bullet' ? text.match(/^\S+/)[0] : split.marker, split.body];
  } else if (kind === 'h2' || kind === 'h3') {
    m = text.match(/^(§\s*\d+[a-z]?|Artikel\s+\d+|\d+(?:\.\d+)+\.?|\d+\.)\s+([A-ZÄÖÜ].*)$/s);
  }
  if (!m) return null;
  const body = m[2].trim();
  if (body.length < 3) return null;
  return { marker: m[1], body };
}

function extractClauseRef(line, fallbackIndex, currentSectionRef = '', kind = 'p') {
  if (kind === 'hf') return t('typeHf');
  const secMatch = line.match(/^(§\s*\d+[a-z]?|Artikel\s+\d+|Anlage\s+\d+|Section\s+\d+|Exhibit\s+[A-Z0-9]+)/i);
  if (secMatch) {
    return secMatch[1].replace(/\s+/g, ' ').trim();
  }
  const numHeadingMatch = line.match(/^(\d+\.)\s+[A-ZÄÖÜ]/);
  if (numHeadingMatch && line.length < 115) {
    return numHeadingMatch[1];
  }
  const subHeadingMatch = line.match(/^(\d+\.\d+(?:\.\d+)*)\s+/);
  if (subHeadingMatch && line.length < 115) {
    return subHeadingMatch[1];
  }
  const subMatch = line.match(/^(\(\d+\)|\([a-z]\)|\d+(?:\.\d+)+|\d+\)|[a-z]\))/i);
  if (subMatch) {
    const sub = subMatch[1];
    return currentSectionRef ? `${currentSectionRef} ${sub}` : sub;
  }
  if (kind === 'bullet' && currentSectionRef) {
    return `${currentSectionRef} •`;
  }
  return currentSectionRef ? `${currentSectionRef} #${fallbackIndex}` : `#${fallbackIndex}`;
}

// Words for the similarity measure: lower case, with leading/trailing punctuation removed, so
// "Services" and "Services." (or "(Zuschlag)" and "Zuschlag") count as the same word.
function tokenizeWords(str) {
  const words = str
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/^[^\p{L}\p{N}§€$%]+|[^\p{L}\p{N}§€$%]+$/gu, '') || w)
    .filter(Boolean);
  const counts = new Map();
  for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);
  return { words, set: new Set(words), counts };
}

/* ── PDF line joining ──────────────────────────────────────────────────── */

// Words after which a trailing hyphen is a genuine elision ("Vertrags- und Zahlungs…").
const HYPHEN_ELISION_NEXT = /^(?:und|oder|bzw\.?|sowie|bis|als|wie|and|or|nor|to)\b/;

// Joins a wrapped PDF line onto the paragraph text, undoing typographic hyphenation:
// "Vertrags-" + "strafenregelung" -> "Vertragsstrafenregelung" (lowercase continuation),
// "Ost-" + "West-Verbindung" -> "Ost-West-Verbindung" (hyphen kept, no space),
// "Vertrags-" + "und Zahlungsbedingungen" -> unchanged with a space.
function joinWrappedLine(prev, next) {
  if (!prev) return next;
  if (!next) return prev;
  if (/[A-Za-zÄÖÜäöüß]­$/.test(prev)) return prev.slice(0, -1) + next;
  if (/[A-Za-zÄÖÜäöüß]-$/.test(prev) && !/\s-$/.test(prev)) {
    if (/^[a-zäöüß]/.test(next) && !HYPHEN_ELISION_NEXT.test(next)) return prev.slice(0, -1) + next;
    if (/^[A-ZÄÖÜ]/.test(next)) return prev + next;
  }
  return `${prev} ${next}`;
}

/* ── PDF text layout (pure; fed with PDF.js getTextContent() items) ──────── */

// Fraction of the page height at the top and bottom that may hold running headers/footers.
const PDF_MARGIN_BAND = 0.12;

// List bullets drawn with symbol fonts come out of PDF.js as private-use code points
// (Symbol U+F0B7, OpenSymbol U+F095, Wingdings ▪ ➢ ❖ ● ■). At the start of a line they are
// shown as "•" so the line is recognised as a bullet item, as in the DOCX version. Other
// symbol glyphs (e.g. checked / unchecked boxes) are left untouched.
const PDF_SYMBOL_BULLET = /^[\uF0B7\uF095\uF0A7\uF0D8\uF076\uF06C\uF06E]\s*(?=\S)/;

/**
 * Groups PDF.js text items of one page into lines.
 * Spaces are inserted from geometry (gap between the end of one item and the start of the
 * next, relative to the font size) and from `hasEOL`, not between every item, so a font
 * change inside a word ("Ge|samt|preis") does not split the word.
 * pageView: [xMin, yMin, xMax, yMax] (PDF.js page.view).
 * Returns [{ text, y, yPct, fontSize, gapBefore }] in reading order.
 */
function buildPdfPageLines(items, pageView) {
  const view = pageView && pageView.length === 4 ? pageView : [0, 0, 595, 842];
  const yMin = view[1];
  const height = view[3] - view[1] || 842;
  const lines = [];
  let cur = null;

  for (const item of items || []) {
    if (!item || typeof item.str !== 'string') continue;
    const tr = item.transform || [1, 0, 0, 1, 0, 0];
    const fontSize = Math.hypot(tr[2], tr[3]) || Math.hypot(tr[0], tr[1]) || 10;
    const x = tr[4];
    const y = tr[5];
    const str = sanitizeExternalText(item.str).replace(/\n/g, ' ');
    if (!str) {
      if (item.hasEOL && cur) cur.eol = true;
      continue;
    }
    const hasWidth = typeof item.width === 'number' && item.width > 0;
    const isNewLine = !cur || Math.abs(y - cur.y) > Math.max(2, 0.5 * Math.min(fontSize, cur.fontSize));
    if (isNewLine) {
      if (cur) lines.push(cur);
      cur = { text: str, y, fontSize, endX: hasWidth ? x + item.width : null, eol: Boolean(item.hasEOL) };
      continue;
    }
    let needSpace;
    if (cur.eol) {
      needSpace = true;
    } else if (cur.endX === null || !hasWidth) {
      needSpace = true; // no geometry: keep the conservative behaviour
    } else {
      const gap = x - cur.endX;
      needSpace = gap > fontSize * 0.18 || gap < -fontSize * 0.5;
    }
    if (/\s$/.test(cur.text) || /^\s/.test(str)) needSpace = false;
    cur.text += (needSpace ? ' ' : '') + str;
    cur.endX = hasWidth ? x + item.width : null;
    cur.eol = Boolean(item.hasEOL);
  }
  if (cur) lines.push(cur);

  const out = lines
    .map(l => ({
      text: l.text.replace(/\s+/g, ' ').trim().replace(PDF_SYMBOL_BULLET, '• '),
      y: l.y,
      yPct: (l.y - yMin) / height,
      fontSize: l.fontSize,
      gapBefore: false,
    }))
    .filter(l => l.text);

  // Paragraph breaks: a vertical step clearly larger than the line step. The line step is
  // the small end of this page's step distribution, capped at 1.45 × font size so pages
  // consisting only of one-line paragraphs still get their breaks.
  const steps = [];
  for (let i = 1; i < out.length; i++) {
    const dy = out[i - 1].y - out[i].y;
    if (dy > 0) steps.push(dy);
  }
  steps.sort((a, b) => a - b);
  const sizes = out.map(l => l.fontSize).sort((a, b) => a - b);
  const bodySize = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 10;
  const lineStep = Math.min(steps.length ? steps[Math.floor(steps.length * 0.1)] : bodySize * 1.2, bodySize * 1.45);
  for (let i = 1; i < out.length; i++) {
    const dy = out[i - 1].y - out[i].y;
    out[i].gapBefore = dy > lineStep * 1.25 || dy < -out[i].fontSize; // upward jump = new column/block
  }
  return out;
}

// Numbering such as "4." or "3.2" must be followed by whitespace; amounts ("145.000,00",
// "1.000 Stück") and dates ("12.03.2026") at the start of a wrapped line are not numbering.
const PDF_STRUCTURAL_START =
  /^(§\s*\d+|\(\d+\)|(?!\d{1,3}(?:\.\d{3})+(?:,\d+)?\s|\d{1,2}\.\d{1,2}\.\d{2,4}\b)\d+\.(?:\d+\.)*\d*\s|[•‣▪◦–*-]\s|\([a-z]\)|[a-z]\)|Artikel\s+\d+|Anlage\s+\d+|Section\s+\d+|Exhibit\s+[A-Z0-9]+)/i;

// Does `next` (first body line of a page) continue the paragraph `prev` from the previous page?
// A capitalised first word (German nouns) also continues when the previous page ended in the
// middle of a long paragraph of the same font size; a short unpunctuated line (heading) does not.
function continuesAcrossPage(prev, next, prevSize, nextSize) {
  if (/[A-Za-zÄÖÜäöüß][-­]$/.test(prev)) return true;
  if (/[.:;!?)"“”]$/.test(prev)) return false;
  if (/^[a-zäöüß]/.test(next)) return true;
  return (
    /^[A-ZÄÖÜ]/.test(next) &&
    prev.length >= 60 &&
    typeof prevSize === 'number' &&
    typeof nextSize === 'number' &&
    Math.abs(prevSize - nextSize) < 0.5
  );
}

/**
 * Builds the encoded document text from per-page lines (see buildPdfPageLines).
 * Running headers/footers are detected by repetition across pages and emitted as
 * header/footer lines; wrapped lines are joined (with de-hyphenation) into paragraphs,
 * also across page breaks. Returns { text, emptyPages } (1-based page numbers without text).
 */
function assemblePdfText(pages) {
  const candidates = pages.map(lines =>
    lines.map(l => (l.yPct >= 1 - PDF_MARGIN_BAND || l.yPct <= PDF_MARGIN_BAND ? l : null))
  );
  const hfFlags = detectRepeatingMarginLines(candidates);

  const headers = pages.map(() => []);
  const footers = pages.map(() => []);
  const paragraphs = pages.map(() => []);
  let para = null;
  const flush = () => {
    if (para) paragraphs[para.page].push(para.text);
    para = null;
  };

  pages.forEach((lines, p) => {
    let firstBodyLine = true;
    lines.forEach((line, i) => {
      if (hfFlags[p][i]) {
        (line.yPct >= 0.5 ? headers : footers)[p].push(line.text);
        return;
      }
      const structural = PDF_STRUCTURAL_START.test(line.text);
      let newPara;
      if (!para) newPara = true;
      else if (para.page !== p && firstBodyLine) {
        newPara = structural || !continuesAcrossPage(para.text, line.text, para.fontSize, line.fontSize);
      } else newPara = line.gapBefore || structural;
      firstBodyLine = false;
      if (newPara) {
        flush();
        para = { page: p, text: line.text, fontSize: line.fontSize };
      } else {
        para.text = joinWrappedLine(para.text, line.text);
        para.fontSize = line.fontSize;
      }
    });
  });
  flush();

  const out = [];
  const emptyPages = [];
  pages.forEach((lines, p) => {
    if (!lines.length) emptyPages.push(p + 1);
    out.push(pageMarkerLine(p + 1));
    for (const h of headers[p]) out.push(metaLine('hf', h));
    for (const text of paragraphs[p]) out.push(text);
    for (const f of footers[p]) out.push(metaLine('hf', f));
  });
  return { text: out.join('\n\n'), emptyPages };
}

/* ── Parsing ───────────────────────────────────────────────────────────── */

const LATIN_LIGATURES = { '\uFB00': 'ff', '\uFB01': 'fi', '\uFB02': 'fl', '\uFB03': 'ffi', '\uFB04': 'ffl', '\uFB05': 'st', '\uFB06': 'st' };

/**
 * Text normalisation applied to both documents before they are compared, so that differences
 * a reader cannot see are not reported as changes:
 *  - Unicode NFC: "Größe" with a precomposed "ö" equals "Größe" (decomposed, common in PDFs
 *    and text from macOS); canonically equivalent strings are the same text by definition;
 *  - Latin ligatures from PDFs ("ﬁ" -> "fi");
 *  - no-break, narrow no-break and other fixed-width spaces -> plain space;
 *  - invisible characters removed: soft hyphen, zero-width space, word joiner, BOM;
 *  - CR / CRLF and Unicode line/paragraph separators -> "\n".
 * Visible characters are never changed (no NFKC: "m²" stays "m²", "½" stays "½").
 * Line-end soft hyphens in PDFs are resolved earlier (joinWrappedLine), before this runs.
 */
function normalizeComparableText(text) {
  return text
    .replace(/\r\n?|[\u2028\u2029\u0085]/g, '\n')
    .normalize('NFC')
    .replace(/[\uFB00-\uFB06]/g, ch => LATIN_LIGATURES[ch])
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/[\u00AD\u200B\u2060\uFEFF]/g, '');
}

function parseIntoBlocks(rawText) {
  const normalized = normalizeComparableText(String(rawText || '')).trim();
  if (!normalized) return [];

  const rawLines = normalized.split(/\n+/);
  const entries = [];
  let currentPage = 1;
  let hasExplicitPageMarkers = false;

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i].trim();
    if (!rawLine) continue;

    if (rawLine.startsWith(DOC_PAGE_MARK)) {
      const n = parseInt(rawLine.slice(DOC_PAGE_MARK.length), 10);
      currentPage = Math.max(1, Number.isFinite(n) ? n : currentPage + 1);
      hasExplicitPageMarkers = true;
      continue;
    }

    const { meta, text } = parseLineMeta(rawLine);
    const line = text.trim();
    if (!line) continue;
    entries.push({
      line,
      page: currentPage,
      hfMarked: Boolean(meta && meta.hf),
      indent: meta && meta.lvl ? Math.max(0, Math.min(8, parseInt(meta.lvl, 10) || 0)) : 0,
    });
  }

  // Text-only header/footer candidates count only when they repeat within the document.
  const repeatCounts = new Map();
  for (const e of entries) {
    if (!e.hfMarked && isLikelyHeaderOrFooterLine(e.line)) {
      const key = normalizeHfRepeatKey(e.line);
      repeatCounts.set(key, (repeatCounts.get(key) || 0) + 1);
    }
  }

  // Bare number labels ("2/3", "3 von 9", "- 4 -") also occur as content (a table cell "2/3",
  // a share). Unless the PDF reader already marked them as running footer lines (by position
  // and repetition), they are only page numbers when they form a running sequence: 2+ labels
  // of the same shape with increasing numbers. Otherwise they are compared like any other line.
  const barePageLabelKeys = new Set();
  const firstNums = new Map();
  for (const e of entries) {
    if (e.hfMarked || !isBarePageNumberLabel(e.line)) continue;
    const key = normalizeHfRepeatKey(e.line);
    if (!firstNums.has(key)) firstNums.set(key, []);
    firstNums.get(key).push(parseInt(e.line.match(/\d+/)[0], 10));
  }
  for (const [key, nums] of firstNums) {
    if (nums.length >= 2 && nums.every((n, i) => i === 0 || n > nums[i - 1])) barePageLabelKeys.add(key);
  }
  const isPageLabel = line =>
    isPageNumberLabel(line) && (!isBarePageNumberLabel(line) || barePageLabelKeys.has(normalizeHfRepeatKey(line)));

  const blocks = [];
  let currentSectionRef = '';
  let seenContentBlock = false;

  for (const entry of entries) {
    let line = entry.line;
    const isHeaderFooter =
      entry.hfMarked ||
      isPageLabel(line) ||
      (isLikelyHeaderOrFooterLine(line) &&
        (!isBarePageNumberLabel(line) || isPageLabel(line)) &&
        (repeatCounts.get(normalizeHfRepeatKey(line)) || 0) >= 2);

    const kind = classifyBlockKind(line, !seenContentBlock && !isHeaderFooter, isHeaderFooter);
    if (!isHeaderFooter) {
      seenContentBlock = true;
      line = line.replace(/^#{1,3}\s+/, '').trim();
      if (!line) continue;
    }

    const isHeading = kind === 'h1' || kind === 'h2' || kind === 'h3';

    // The section reference ("1." / "§ 5") follows the numbering in the text, not the derived
    // block kind: an edit that turns "1. Scope of Services" into a paragraph must not change
    // the references (and thus the alignment) of every clause below it.
    if (kind === 'h2' || kind === 'p' || kind === 'h1') {
      const secMatch = line.match(/^(§\s*\d+[a-z]?|Artikel\s+\d+|Anlage\s+\d+|Section\s+\d+|Exhibit\s+[A-Z0-9]+)/i);
      const numMatch = line.match(/^(\d+\.)\s+[A-ZÄÖÜ]/);
      if (secMatch) {
        currentSectionRef = secMatch[1].replace(/\s+/g, ' ').trim();
      } else if (numMatch) {
        currentSectionRef = numMatch[1];
      }
    }

    const idx = blocks.length + 1;
    const numbering = isHeaderFooter ? null : splitNumberingMarker(line, kind);
    const alignText = numbering ? numbering.body : line;
    const { words, set, counts } = tokenizeWords(alignText);
    blocks.push({
      index: idx,
      pageNum: entry.page,
      hasExplicitPage: hasExplicitPageMarkers,
      refCode: extractClauseRef(line, idx, currentSectionRef, kind),
      sectionRef: currentSectionRef,
      text: line,
      kind,
      indent: entry.indent,
      isHeading,
      isHeaderFooter,
      numberingMarker: numbering ? numbering.marker : '',
      // Whitespace and the table-cell separator " · " (DOCX/HTML intake; a PDF has spaces there) do not
      // make two paragraphs different: such rows are shown as unchanged, like renumbering.
      alignKey: alignText.replace(/\s+/g, ' ').replace(/ \u00B7 /g, ' '),
      words,
      wordSet: set,
      wordCounts: counts,
    });
  }

  // If document had no explicit page markers (e.g. pasted text or flat DOCX), paginate cleanly by section/length
  if (!hasExplicitPageMarkers && blocks.length > 0) {
    let autoPage = 1;
    let blocksOnCurrentPage = 0;
    let charsOnCurrentPage = 0;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const startsNewMajorSection =
        b.kind === 'h2' && blocksOnCurrentPage >= 5 && charsOnCurrentPage >= 650;
      const exceedsPageCapacity = blocksOnCurrentPage >= 10 || charsOnCurrentPage >= 1850;
      if (i > 0 && (startsNewMajorSection || exceedsPageCapacity)) {
        autoPage++;
        blocksOnCurrentPage = 0;
        charsOnCurrentPage = 0;
      }
      b.pageNum = autoPage;
      blocksOnCurrentPage++;
      charsOnCurrentPage += b.text.length;
    }
  }

  return blocks;
}

/**
 * Parses both documents and applies the header/footer filter.
 * Returns all blocks, the blocks to compare, and the number of hidden header/footer lines.
 */
function prepareComparisonBlocks(leftText, rightText, ignoreHeadersFooters) {
  const allLeftBlocks = parseIntoBlocks(leftText);
  const allRightBlocks = parseIntoBlocks(rightText);
  const hfCount = reconcileHeaderFooterBlocks(allLeftBlocks, allRightBlocks);
  const keep = b => !(ignoreHeadersFooters && isHiddenHeaderFooter(b));
  return {
    allLeftBlocks,
    allRightBlocks,
    leftBlocks: allLeftBlocks.filter(keep),
    rightBlocks: allRightBlocks.filter(keep),
    hfCount,
  };
}

/* ── Alignment ─────────────────────────────────────────────────────────── */

function blockAlignKey(block) {
  return block.alignKey !== undefined ? block.alignKey : block.text;
}

function blockWordCounts(block) {
  if (!block.wordCounts) block.wordCounts = tokenizeWords(blockAlignKey(block)).counts;
  return block.wordCounts;
}

function computeBlockSimilarity(blockA, blockB) {
  if (blockA.isHeaderFooter !== blockB.isHeaderFooter) return 0;
  if (blockA.text === blockB.text || blockAlignKey(blockA) === blockAlignKey(blockB)) return 1.0;
  // The block kind is re-derived from the text, so it may change with an edit ("1. Scope of
  // Services" + a sentence is no longer a heading). Kind alone never prevents pairing; a short
  // heading and a long paragraph are kept apart by the length bound below.
  const lenA = blockA.words.length;
  const lenB = blockB.words.length;
  if (!lenA || !lenB) return 0;

  const sameSpecificRef =
    blockA.refCode &&
    blockA.refCode === blockB.refCode &&
    !blockA.refCode.startsWith('#') &&
    !blockA.refCode.includes('#');

  const maxPossible = (2.0 * Math.min(lenA, lenB)) / (lenA + lenB);
  if (maxPossible < 0.28 && !sameSpecificRef) return 0;

  // Multiset intersection: every occurrence of a word can be matched at most once.
  const countsA = blockWordCounts(blockA);
  const countsB = blockWordCounts(blockB);
  const [small, large] = countsA.size <= countsB.size ? [countsA, countsB] : [countsB, countsA];
  let intersection = 0;
  for (const [word, n] of small) {
    const m = large.get(word);
    if (m) intersection += Math.min(n, m);
  }
  const wordSim = (2.0 * intersection) / (lenA + lenB);
  return sameSpecificRef ? Math.max(wordSim, 0.42) : wordSim;
}

// Minimum length for a deleted/inserted pair to be reported as a move.
const MIN_MOVE_TEXT_LENGTH = 12;

// Pairs unmatched deleted and inserted blocks with identical text (ignoring whitespace
// and renumbering) and flags them as moved. Rows keep type 'deleted' / 'inserted', so every
// consumer that switches on row.type keeps working; `moved` and `movedToRowId` /
// `movedFromRowId` describe the relocation.
function markMovedRows(rows) {
  const deletedByKey = new Map();
  for (const row of rows) {
    if (row.type !== 'deleted' || row.leftBlock.isHeaderFooter) continue;
    const key = blockAlignKey(row.leftBlock).trim();
    if (key.length < MIN_MOVE_TEXT_LENGTH) continue;
    if (!deletedByKey.has(key)) deletedByKey.set(key, []);
    deletedByKey.get(key).push(row);
  }
  for (const row of rows) {
    if (row.type !== 'inserted' || row.rightBlock.isHeaderFooter) continue;
    const candidates = deletedByKey.get(blockAlignKey(row.rightBlock).trim());
    if (!candidates || !candidates.length) continue;
    const from = candidates.shift();
    from.moved = true;
    from.movedToRowId = row.id;
    row.moved = true;
    row.movedFromRowId = from.id;
  }
  return rows;
}

function alignDocumentBlocks(leftBlocks, rightBlocks, onProgress) {
  const totalN = leftBlocks.length;
  const totalM = rightBlocks.length;
  if (totalN === 0 && totalM === 0) return [];

  const sameKey = (a, b) => a.text === b.text || blockAlignKey(a) === blockAlignKey(b);

  let prefixLen = 0;
  while (
    prefixLen < totalN &&
    prefixLen < totalM &&
    sameKey(leftBlocks[prefixLen], rightBlocks[prefixLen])
  ) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < totalN - prefixLen &&
    suffixLen < totalM - prefixLen &&
    sameKey(leftBlocks[totalN - 1 - suffixLen], rightBlocks[totalM - 1 - suffixLen])
  ) {
    suffixLen++;
  }

  const midLeft = leftBlocks.slice(prefixLen, totalN - suffixLen);
  const midRight = rightBlocks.slice(prefixLen, totalM - suffixLen);
  const n = midLeft.length;
  const m = midRight.length;

  const rawPairs = [];
  for (let p = 0; p < prefixLen; p++) {
    rawPairs.push({ left: leftBlocks[p], right: rightBlocks[p] });
  }

  if (n > 0 || m > 0) {
    for (const pair of alignMiddleBlocks(midLeft, midRight, onProgress)) rawPairs.push(pair);
  }

  for (let s = 0; s < suffixLen; s++) {
    rawPairs.push({
      left: leftBlocks[totalN - suffixLen + s],
      right: rightBlocks[totalM - suffixLen + s],
    });
  }

  let monotonicPage = 1;
  const rows = rawPairs.map((pair, idx) => {
    const rawPage =
      (pair.right && pair.right.pageNum) ||
      (pair.left && pair.left.pageNum) ||
      monotonicPage;
    monotonicPage = Math.max(monotonicPage, rawPage);
    return buildAlignedRow(pair, idx, monotonicPage);
  });

  return markMovedRows(rows);
}

function buildAlignedRow(pair, idx, pageNum) {
  const rowId = `row-${idx + 1}`;
  if (pair.left && pair.right) {
    if (pair.left.text === pair.right.text) {
      return {
        id: rowId,
        rowNumber: idx + 1,
        pageNum,
        type: 'equal',
        leftBlock: pair.left,
        rightBlock: pair.right,
        wordDiffs: [{ value: pair.left.text }],
      };
    }
    if (blockAlignKey(pair.left) === blockAlignKey(pair.right) && pair.left.kind === pair.right.kind) {
      // Only the list marker / heading number differs (renumbering). Such rows are not
      // counted as changes; the renderer shows the old and new marker in a muted style.
      return {
        id: rowId,
        rowNumber: idx + 1,
        pageNum,
        type: 'equal',
        markerOnly: true,
        oldMarker: pair.left.numberingMarker,
        newMarker: pair.right.numberingMarker,
        leftBlock: pair.left,
        rightBlock: pair.right,
        wordDiffs: computeCleanWordDiff(pair.left.text, pair.right.text),
      };
    }
    return {
      id: rowId,
      rowNumber: idx + 1,
      pageNum,
      type: 'modified',
      leftBlock: pair.left,
      rightBlock: pair.right,
      wordDiffs: computeCleanWordDiff(pair.left.text, pair.right.text),
    };
  }
  if (pair.left && !pair.right) {
    return {
      id: rowId,
      rowNumber: idx + 1,
      pageNum,
      type: 'deleted',
      leftBlock: pair.left,
      rightBlock: null,
      wordDiffs: [{ value: pair.left.text, removed: true }],
    };
  }
  return {
    id: rowId,
    rowNumber: idx + 1,
    pageNum,
    type: 'inserted',
    leftBlock: null,
    rightBlock: pair.right,
    wordDiffs: [{ value: pair.right.text, added: true }],
  };
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Word diff ─────────────────────────────────────────────────────────── */

// Invariant of every word diff: the unchanged + removed parts spell the old text exactly,
// and the unchanged + added parts spell the new text exactly.
function wordDiffPreservesTexts(parts, oldText, newText) {
  let oldOut = '';
  let newOut = '';
  for (const part of parts) {
    if (!part.added) oldOut += part.value;
    if (!part.removed) newOut += part.value;
  }
  return oldOut === oldText && newOut === newText;
}

function getDiffLibrary() {
  if (typeof Diff !== 'undefined' && Diff && typeof Diff.diffWordsWithSpace === 'function') return Diff;
  if (typeof window !== 'undefined' && window.Diff) return window.Diff;
  return null;
}

// Upper bound for the work of one word diff (Myers: tokens × edit length). Without it two long,
// largely rewritten paragraphs take quadratic time (two 10,000-word paragraphs: ~45 s; a 1 MB
// paragraph: hours). Normal paragraphs are far below the bound and always get the exact diff.
const WORD_DIFF_MAX_WORK = 1.5e7;

// Coarse but exact fallback: common leading and trailing words unchanged, the rest replaced.
function coarseWordDiff(oldText, newText) {
  const a = oldText.split(/(\s+)/);
  const b = newText.split(/(\s+)/);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const parts = [
    { value: a.slice(0, pre).join('') },
    { value: a.slice(pre, a.length - suf).join(''), removed: true },
    { value: b.slice(pre, b.length - suf).join(''), added: true },
    { value: a.slice(a.length - suf).join('') },
  ];
  return parts.filter(p => p.value.length > 0);
}

function computeCleanWordDiff(oldText, newText) {
  const diffLib = getDiffLibrary();
  if (!diffLib) {
    return [
      { value: oldText, removed: true },
      { value: newText, added: true },
    ];
  }

  // diffWordsWithSpace yields about two tokens (word + whitespace) per word.
  const tokens = 2 * ((oldText.match(/\S+/g) || []).length + (newText.match(/\S+/g) || []).length) + 2;
  const maxEditLength = Math.max(30, Math.floor(WORD_DIFF_MAX_WORK / tokens));
  const raw = diffLib.diffWordsWithSpace(oldText, newText, { maxEditLength });
  if (!raw) return coarseWordDiff(oldText, newText);

  // An unchanged number sandwiched between two changes is shown as replaced as well, so
  // "1.000 EUR" -> "2.000 USD" reads as one change instead of three fragments.
  const mergedNums = [];
  for (let i = 0; i < raw.length; i++) {
    const cur = raw[i];
    if (
      !cur.added &&
      !cur.removed &&
      /^[.,\d]+$/.test(cur.value) &&
      mergedNums.length > 0 &&
      i + 1 < raw.length
    ) {
      const prev = mergedNums[mergedNums.length - 1];
      const next = raw[i + 1];
      if ((prev.removed || prev.added) && (next.removed || next.added)) {
        mergedNums.push({ value: cur.value, removed: true });
        mergedNums.push({ value: cur.value, added: true });
        continue;
      }
    }
    mergedNums.push({ value: cur.value, added: Boolean(cur.added), removed: Boolean(cur.removed) });
  }

  // Expand partial numeric/date replacements to the whole number:
  // "0,[5]" -> "[0,5]", "[145.000],00" -> "[145.000,00]", "[12.03].2026" -> "[12.03.2026]".
  // Only for groups that both remove and add text: the unchanged digits are then moved into
  // BOTH sides, which keeps the invariant. Pure insertions/deletions are left untouched
  // ("Frist 14 Tage" -> "Frist 7 14 Tage" must show "7 " inserted and "14" unchanged).
  const isChange = tok => Boolean(tok && (tok.removed || tok.added));
  let idx = 0;
  while (idx < mergedNums.length) {
    if (!isChange(mergedNums[idx])) {
      idx++;
      continue;
    }
    const start = idx;
    while (idx < mergedNums.length && isChange(mergedNums[idx])) {
      idx++;
    }
    const end = idx - 1;
    const group = mergedNums.slice(start, idx);
    const firstRem = group.find(tok => tok.removed);
    const firstAdd = group.find(tok => tok.added);
    if (!firstRem || !firstAdd) continue;
    if (!group.some(tok => /\d/.test(tok.value))) continue;
    // Only expand when both sides of the change start/end with a digit at the boundary.
    const remText = group.filter(tok => tok.removed).map(tok => tok.value).join('');
    const addText = group.filter(tok => tok.added).map(tok => tok.value).join('');

    if (start > 0 && !isChange(mergedNums[start - 1]) && /^[\d.,]/.test(remText) && /^[\d.,]/.test(addText)) {
      const prevTok = mergedNums[start - 1];
      const prefixMatch = prevTok.value.match(/((?:\d+[.,])+\d*|[.,]\d+)$/);
      if (prefixMatch) {
        const numPrefix = prefixMatch[1];
        prevTok.value = prevTok.value.slice(0, prevTok.value.length - numPrefix.length);
        firstRem.value = numPrefix + firstRem.value;
        firstAdd.value = numPrefix + firstAdd.value;
      }
    }

    if (idx < mergedNums.length && !isChange(mergedNums[idx]) && /[\d.,]$/.test(remText) && /[\d.,]$/.test(addText)) {
      const nextTok = mergedNums[idx];
      const suffixMatch = nextTok.value.match(/^([.,]\d+(?:[.,]\d+)*|\d+(?:[.,]\d+)*)/);
      if (suffixMatch) {
        const numSuffix = suffixMatch[1];
        nextTok.value = nextTok.value.slice(numSuffix.length);
        let lastRem = null;
        let lastAdd = null;
        for (let k = start; k <= end; k++) {
          if (mergedNums[k].removed) lastRem = mergedNums[k];
          if (mergedNums[k].added) lastAdd = mergedNums[k];
        }
        lastRem.value = lastRem.value + numSuffix;
        lastAdd.value = lastAdd.value + numSuffix;
      }
    }
  }

  const cleaned = mergedNums
    .filter(tok => tok.value.length > 0)
    .map(tok => (tok.added ? { value: tok.value, added: true } : tok.removed ? { value: tok.value, removed: true } : { value: tok.value }));

  if (wordDiffPreservesTexts(cleaned, oldText, newText)) return cleaned;
  // Never show a diff that does not reproduce the source texts: fall back to the raw diff.
  return raw.map(tok =>
    tok.added ? { value: tok.value, added: true } : tok.removed ? { value: tok.value, removed: true } : { value: tok.value }
  );
}

function coalesceSideTokens(sideParts, prop) {
  const out = [];
  for (let i = 0; i < sideParts.length; i++) {
    const cur = sideParts[i];
    if (
      !cur[prop] &&
      /^\s+$/.test(cur.value) &&
      out.length > 0 &&
      out[out.length - 1][prop] &&
      i + 1 < sideParts.length &&
      sideParts[i + 1][prop]
    ) {
      out[out.length - 1].value += cur.value;
      continue;
    }
    if (cur[prop] && out.length > 0 && out[out.length - 1][prop]) {
      out[out.length - 1].value += cur.value;
    } else {
      out.push({ value: cur.value, [prop]: Boolean(cur[prop]) });
    }
  }
  return out;
}
