function isLikelyHeaderOrFooterLine(line) {
  if (!line || line.length > 130) return false;
  if (/^(?:Seite|Page|Blatt|S\.|p\.)\s*\d+(?:\s*(?:von|of|\/)\s*\d+)?$/i.test(line)) return true;
  if (/^-\s*\d+\s*-$/.test(line)) return true;
  if (/^.*(?:\bSeite|\bPage)\s+\d+\s*(?:von|of|\/)\s*\d+\s*$/i.test(line)) return true;
  if (/^(?:Vertraulich|Confidential|Stand:|Fassung|Entwurf|Draft)\b.*(?:\bSeite|\bPage)\s+\d+/i.test(line)) {
    return true;
  }
  return false;
}

function classifyBlockKind(line, isFirstContentBlock, isHeaderFooter) {
  if (isHeaderFooter) return 'hf';
  if (/^#\s+/.test(line)) return 'h1';
  if (/^##\s+/.test(line)) return 'h2';
  if (/^###\s+/.test(line)) return 'h3';

  if (
    isFirstContentBlock &&
    line.length < 105 &&
    !/^(§|\(\d+\)|\d+\.|[•‣▪◦–*-]\s)/.test(line) &&
    (/^[A-ZÄÖÜ0-9\s,&/-]{10,}$/.test(line) || !/[.:;]$/.test(line))
  ) {
    return 'h1';
  }

  if (
    /^(§\s*\d+[a-z]?|Artikel\s+\d+|Anlage\s+\d+|Section\s+\d+|Exhibit\s+[A-Z0-9]+|\d+\.\s+[A-ZÄÖÜ])/i.test(
      line
    ) &&
    line.length < 115
  ) {
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

function tokenizeWords(str) {
  const words = str.toLowerCase().split(/\s+/).filter(Boolean);
  return { words, set: new Set(words) };
}

function parseIntoBlocks(rawText) {
  const normalized = rawText.replace(/\r\n/g, '\n').replace(/\u00A0/g, ' ').trim();
  if (!normalized) return [];

  const rawLines = normalized.split(/\n+/);
  const blocks = [];
  let currentSectionRef = '';
  let currentPage = 1;
  let hasExplicitPageMarkers = false;
  let seenContentBlock = false;

  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i].trim();
    if (!line) continue;

    const pageBreakMatch = line.match(/^===\s*\[(?:SEITE|PAGE)\s*(\d+)\]\s*===$/i);
    if (pageBreakMatch) {
      currentPage = Math.max(1, parseInt(pageBreakMatch[1], 10) || currentPage + 1);
      hasExplicitPageMarkers = true;
      continue;
    }
    if (line === '\f') {
      currentPage++;
      hasExplicitPageMarkers = true;
      continue;
    }

    let isHeaderFooter = false;
    if (line.startsWith('[[HF]]')) {
      isHeaderFooter = true;
      line = line.replace(/^\[\[HF\]\]\s*/, '').trim();
      if (!line) continue;
    } else if (isLikelyHeaderOrFooterLine(line)) {
      isHeaderFooter = true;
    }

    const kind = classifyBlockKind(line, !seenContentBlock && !isHeaderFooter, isHeaderFooter);
    if (!isHeaderFooter) {
      seenContentBlock = true;
      line = line.replace(/^#{1,3}\s+/, '').trim();
    }

    const isHeading = kind === 'h1' || kind === 'h2' || kind === 'h3';

    if (kind === 'h2') {
      const secMatch = line.match(/^(§\s*\d+[a-z]?|Artikel\s+\d+|Anlage\s+\d+|Section\s+\d+|Exhibit\s+[A-Z0-9]+)/i);
      const numMatch = line.match(/^(\d+\.)\s+[A-ZÄÖÜ]/);
      if (secMatch) {
        currentSectionRef = secMatch[1].replace(/\s+/g, ' ').trim();
      } else if (numMatch) {
        currentSectionRef = numMatch[1];
      }
    }

    const idx = blocks.length + 1;
    const { words, set } = tokenizeWords(line);
    blocks.push({
      index: idx,
      pageNum: currentPage,
      hasExplicitPage: hasExplicitPageMarkers,
      refCode: extractClauseRef(line, idx, currentSectionRef, kind),
      sectionRef: currentSectionRef,
      text: line,
      kind,
      isHeading,
      isHeaderFooter,
      words,
      wordSet: set,
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

function computeBlockSimilarity(blockA, blockB) {
  if (blockA.isHeaderFooter !== blockB.isHeaderFooter) return 0;
  if (blockA.text === blockB.text) return 1.0;
  if (blockA.isHeading !== blockB.isHeading) return 0;
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

  let intersection = 0;
  const smallerWords = lenA <= lenB ? blockA.words : blockB.words;
  const largerSet = lenA <= lenB ? blockB.wordSet : blockA.wordSet;

  for (let i = 0; i < smallerWords.length; i++) {
    if (largerSet.has(smallerWords[i])) intersection++;
  }
  const wordSim = (2.0 * intersection) / (lenA + lenB);
  return sameSpecificRef ? Math.max(wordSim, 0.42) : wordSim;
}

function alignDocumentBlocks(leftBlocks, rightBlocks, onProgress) {
  const totalN = leftBlocks.length;
  const totalM = rightBlocks.length;
  if (totalN === 0 && totalM === 0) return [];

  let prefixLen = 0;
  while (
    prefixLen < totalN &&
    prefixLen < totalM &&
    leftBlocks[prefixLen].text === rightBlocks[prefixLen].text
  ) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < totalN - prefixLen &&
    suffixLen < totalM - prefixLen &&
    leftBlocks[totalN - 1 - suffixLen].text === rightBlocks[totalM - 1 - suffixLen].text
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
  return rawPairs.map((pair, idx) => {
    const rawPage =
      (pair.right && pair.right.pageNum) ||
      (pair.left && pair.left.pageNum) ||
      monotonicPage;
    monotonicPage = Math.max(monotonicPage, rawPage);
    return buildAlignedRow(pair, idx, monotonicPage);
  });
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
    const wordDiffs = computeCleanWordDiff(pair.left.text, pair.right.text);
    return {
      id: rowId,
      rowNumber: idx + 1,
      pageNum,
      type: 'modified',
      leftBlock: pair.left,
      rightBlock: pair.right,
      wordDiffs,
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

function computeCleanWordDiff(oldText, newText) {
  if (!window.Diff) {
    return [
      { value: oldText, removed: true },
      { value: newText, added: true },
    ];
  }

  const raw = window.Diff.diffWordsWithSpace(oldText, newText);

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
    mergedNums.push({ ...cur });
  }

  // Expand partial numeric/date diffs (e.g. "0,[5]" -> "[0,5]", "[145.000],00" -> "[145.000,00]", "[12.03].2026" -> "[12.03.2026]")
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
    const groupHasDigit = mergedNums.slice(start, idx).some(t => /\d/.test(t.value));
    if (!groupHasDigit) continue;

    if (start > 0 && !isChange(mergedNums[start - 1])) {
      const prevTok = mergedNums[start - 1];
      const prefixMatch = prevTok.value.match(/(\d+[.,]+\d*|\d*[.,]+\d+)$/);
      if (prefixMatch) {
        const numPrefix = prefixMatch[1];
        prevTok.value = prevTok.value.slice(0, prevTok.value.length - numPrefix.length);
        const firstRem = mergedNums.slice(start, idx).find(t => t.removed);
        const firstAdd = mergedNums.slice(start, idx).find(t => t.added);
        if (firstRem) firstRem.value = numPrefix + firstRem.value;
        if (firstAdd) firstAdd.value = numPrefix + firstAdd.value;
      }
    }

    if (idx < mergedNums.length && !isChange(mergedNums[idx])) {
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
        if (lastRem) lastRem.value = lastRem.value + numSuffix;
        if (lastAdd) lastAdd.value = lastAdd.value + numSuffix;
      }
    }
  }

  return mergedNums.filter(t => t.value.length > 0);
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
