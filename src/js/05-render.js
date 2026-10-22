// Entity-safe search highlighting: splits raw text BEFORE escaping so HTML entities are never corrupted
function escapeAndHighlightText(rawText, query) {
  if (!rawText) return '';
  if (!query || !query.trim()) return escapeHtml(rawText);
  const q = query.trim();
  const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${safeQ})`, 'gi');
  const parts = rawText.split(regex);
  if (parts.length === 1) return escapeHtml(rawText);

  const qLower = q.toLowerCase();
  return parts
    .map(part =>
      part.toLowerCase() === qLower
        ? `<mark class="tok-search">${escapeHtml(part)}</mark>`
        : escapeHtml(part)
    )
    .join('');
}

// A removed / added run with its surrounding spaces outside the mark, so the tint and the
// underline cover the words only.
function tokHtml(tag, value, query) {
  const cls = tag === 'del' ? 'tok-del' : 'tok-ins';
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(value);
  if (!m[2]) return `<${tag} class="${cls}">${escapeAndHighlightText(value, query)}</${tag}>`;
  return `${escapeHtml(m[1])}<${tag} class="${cls}">${escapeAndHighlightText(m[2], query)}</${tag}>${escapeHtml(m[3])}`;
}

function setSafeContainerHtml(container, trustedHtmlString) {
  container.innerHTML = trustedHtmlString;
}

function wrapMarkerAndBody(markerHtml, bodyHtml) {
  return `<span class="clause-marker">${markerHtml}</span><div class="clause-body">${bodyHtml}</div>`;
}

function renderLeftBlockHtml(row, query) {
  const b = row.leftBlock;
  if (!b) return '';
  const split = extractListMarker(b.text, b.kind);

  if (row.type === 'equal') {
    if (row.markerOnly) return renderMarkerOnlyHtml(row, 'left', query);
    if (split) {
      return wrapMarkerAndBody(
        escapeAndHighlightText(split.marker, query),
        escapeAndHighlightText(split.body, query)
      );
    }
    return escapeAndHighlightText(b.text, query);
  }
  if (row.type === 'deleted') {
    if (split) {
      return wrapMarkerAndBody(
        `<del class="tok-del">${escapeAndHighlightText(split.marker, query)}</del>`,
        `<del class="tok-del">${escapeAndHighlightText(split.body, query)}</del>`
      );
    }
    return `<del class="tok-del">${escapeAndHighlightText(b.text, query)}</del>`;
  }
  if (row.type === 'modified') {
    const rSplit = row.rightBlock ? extractListMarker(row.rightBlock.text, row.rightBlock.kind) : null;
    if (split && rSplit) {
      const bodyDiffs = computeCleanWordDiff(split.body, rSplit.body);
      const sideParts = coalesceSideTokens(
        bodyDiffs.filter(part => !part.added),
        'removed'
      );
      const bodyHtml = sideParts
        .map(part => {
          const content = escapeAndHighlightText(part.value, query);
          return part.removed ? tokHtml('del', part.value, query) : content;
        })
        .join('');
      const markerHtml =
        split.marker === rSplit.marker
          ? escapeAndHighlightText(split.marker, query)
          : `<del class="tok-del tok-marker">${escapeAndHighlightText(split.marker, query)}</del>`;
      return wrapMarkerAndBody(markerHtml, bodyHtml);
    }

    const sideParts = coalesceSideTokens(
      row.wordDiffs.filter(part => !part.added),
      'removed'
    );
    return sideParts
      .map(part => {
        const content = escapeAndHighlightText(part.value, query);
        return part.removed ? tokHtml('del', part.value, query) : content;
      })
      .join('');
  }
  return '';
}

function renderRightBlockHtml(row, query) {
  const b = row.rightBlock;
  if (!b) return '';
  const split = extractListMarker(b.text, b.kind);

  if (row.type === 'equal') {
    if (row.markerOnly) return renderMarkerOnlyHtml(row, 'right', query);
    if (split) {
      return wrapMarkerAndBody(
        escapeAndHighlightText(split.marker, query),
        escapeAndHighlightText(split.body, query)
      );
    }
    return escapeAndHighlightText(b.text, query);
  }
  if (row.type === 'inserted') {
    if (split) {
      return wrapMarkerAndBody(
        `<ins class="tok-ins">${escapeAndHighlightText(split.marker, query)}</ins>`,
        `<ins class="tok-ins">${escapeAndHighlightText(split.body, query)}</ins>`
      );
    }
    return `<ins class="tok-ins">${escapeAndHighlightText(b.text, query)}</ins>`;
  }
  if (row.type === 'modified') {
    const lSplit = row.leftBlock ? extractListMarker(row.leftBlock.text, row.leftBlock.kind) : null;
    if (split && lSplit) {
      const bodyDiffs = computeCleanWordDiff(lSplit.body, split.body);
      const sideParts = coalesceSideTokens(
        bodyDiffs.filter(part => !part.removed),
        'added'
      );
      const bodyHtml = sideParts
        .map(part => {
          const content = escapeAndHighlightText(part.value, query);
          return part.added ? tokHtml('ins', part.value, query) : content;
        })
        .join('');
      const markerHtml =
        split.marker === lSplit.marker
          ? escapeAndHighlightText(split.marker, query)
          : `<ins class="tok-ins tok-marker">${escapeAndHighlightText(split.marker, query)}</ins>`;
      return wrapMarkerAndBody(markerHtml, bodyHtml);
    }

    const sideParts = coalesceSideTokens(
      row.wordDiffs.filter(part => !part.removed),
      'added'
    );
    return sideParts
      .map(part => {
        const content = escapeAndHighlightText(part.value, query);
        return part.added ? tokHtml('ins', part.value, query) : content;
      })
      .join('');
  }
  return '';
}

function coalesceUnifiedTokens(wordDiffs) {
  const out = [];
  let i = 0;
  const isChange = t => Boolean(t && (t.removed || t.added));
  const isBridgeSpace = idx =>
    idx > 0 &&
    idx + 1 < wordDiffs.length &&
    !isChange(wordDiffs[idx]) &&
    /^\s+$/.test(wordDiffs[idx].value) &&
    isChange(wordDiffs[idx - 1]) &&
    isChange(wordDiffs[idx + 1]);

  while (i < wordDiffs.length) {
    if (!isChange(wordDiffs[i])) {
      out.push({ value: wordDiffs[i].value });
      i++;
      continue;
    }
    const run = [];
    while (i < wordDiffs.length && (isChange(wordDiffs[i]) || isBridgeSpace(i))) {
      run.push(wordDiffs[i]);
      i++;
    }
    const hasRem = run.some(t => t.removed);
    const hasAdd = run.some(t => t.added);
    if (hasRem && hasAdd) {
      const delStr = run
        .filter(t => !t.added)
        .map(t => t.value)
        .join('');
      const insStr = run
        .filter(t => !t.removed)
        .map(t => t.value)
        .join('');
      out.push({ value: delStr, removed: true });
      out.push({ value: ' ' });
      out.push({ value: insStr, added: true });
    } else if (hasRem) {
      out.push({ value: run.map(t => t.value).join(''), removed: true });
    } else if (hasAdd) {
      out.push({ value: run.map(t => t.value).join(''), added: true });
    }
  }
  return out;
}

function renderUnifiedBlockHtml(row, query, allowMarkerGrid = false) {
  const primary = row.rightBlock || row.leftBlock;
  const split = allowMarkerGrid && primary ? extractListMarker(primary.text, primary.kind) : null;

  if (row.type === 'equal') {
    if (row.markerOnly) return renderMarkerOnlyHtml(row, 'unified', query, allowMarkerGrid);
    if (split) {
      return wrapMarkerAndBody(
        escapeAndHighlightText(split.marker, query),
        escapeAndHighlightText(split.body, query)
      );
    }
    return escapeAndHighlightText(row.rightBlock.text, query);
  }
  if (row.type === 'deleted') {
    if (split) {
      return wrapMarkerAndBody(
        `<del class="tok-del">${escapeAndHighlightText(split.marker, query)}</del>`,
        `<del class="tok-del">${escapeAndHighlightText(split.body, query)}</del>`
      );
    }
    return `<del class="tok-del">${escapeAndHighlightText(row.leftBlock.text, query)}</del>`;
  }
  if (row.type === 'inserted') {
    if (split) {
      return wrapMarkerAndBody(
        `<ins class="tok-ins">${escapeAndHighlightText(split.marker, query)}</ins>`,
        `<ins class="tok-ins">${escapeAndHighlightText(split.body, query)}</ins>`
      );
    }
    return `<ins class="tok-ins">${escapeAndHighlightText(row.rightBlock.text, query)}</ins>`;
  }
  if (row.type === 'modified') {
    const lSplit = row.leftBlock ? extractListMarker(row.leftBlock.text, row.leftBlock.kind) : null;
    const rSplit = row.rightBlock ? extractListMarker(row.rightBlock.text, row.rightBlock.kind) : null;
    if (allowMarkerGrid && lSplit && rSplit) {
      const bodyDiffs = computeCleanWordDiff(lSplit.body, rSplit.body);
      const bodyHtml = coalesceUnifiedTokens(bodyDiffs)
        .map(part => {
          const content = escapeAndHighlightText(part.value, query);
          if (part.removed) return tokHtml('del', part.value, query);
          if (part.added) return tokHtml('ins', part.value, query);
          return content;
        })
        .join('');
      const markerHtml =
        lSplit.marker === rSplit.marker
          ? escapeAndHighlightText(rSplit.marker, query)
          : `<del class="tok-del tok-marker">${escapeAndHighlightText(lSplit.marker, query)}</del> <ins class="tok-ins tok-marker">${escapeAndHighlightText(rSplit.marker, query)}</ins>`;
      return wrapMarkerAndBody(markerHtml, bodyHtml);
    }

    return coalesceUnifiedTokens(row.wordDiffs)
      .map(part => {
        const content = escapeAndHighlightText(part.value, query);
        if (part.removed) return tokHtml('del', part.value, query);
        if (part.added) return tokHtml('ins', part.value, query);
        return content;
      })
      .join('');
  }
  return '';
}

// Renumbered block (only the list marker / heading number changed): the body is unchanged,
// the old and new marker are shown in a muted style. Not counted as a change.
function renderMarkerOnlyHtml(row, side, query, allowMarkerGrid = true) {
  const oldMarker = row.oldMarker || '';
  const newMarker = row.newMarker || '';
  const block = side === 'left' ? row.leftBlock : row.rightBlock;
  const body = block.text.slice((side === 'left' ? oldMarker : newMarker).length).trim();
  const delHtml = `<del class="tok-del tok-marker">${escapeAndHighlightText(oldMarker, query)}</del>`;
  const insHtml = `<ins class="tok-ins tok-marker">${escapeAndHighlightText(newMarker, query)}</ins>`;
  const markerHtml = side === 'left' ? delHtml : side === 'right' ? insHtml : `${delHtml} ${insHtml}`;
  const split = extractListMarker(block.text, block.kind);
  if (split && allowMarkerGrid) {
    return wrapMarkerAndBody(markerHtml, escapeAndHighlightText(split.body, query));
  }
  return `${markerHtml} ${escapeAndHighlightText(body, query)}`;
}

// The landing page markup is static (src/template.html); this only reflects which
// versions are already loaded in its two slots.
function updateLandingSlots(left, right) {
  [
    { side: 'left', info: left, name: state.leftName, fmt: state.leftFormat, titleKey: 'slotLeftTitle' },
    { side: 'right', info: right, name: state.rightName, fmt: state.rightFormat, titleKey: 'slotRightTitle' },
  ].forEach(({ side, info, name, fmt, titleKey }) => {
    const slot = document.getElementById(`lp-slot-${side}`);
    if (!slot) return;
    const loaded = info.blocks > 0;
    const otherLoaded = side === 'left' ? right.blocks > 0 : left.blocks > 0;
    slot.classList.toggle('is-loaded', loaded);
    slot.classList.toggle('is-next-step', !loaded && (side === 'left' || otherLoaded));

    const titleEl = document.getElementById(`lp-${side}-title`);
    const hintEl = document.getElementById(`lp-${side}-hint`);
    const ctaEl = document.getElementById(`lp-${side}-cta`);
    const clearBtn = document.getElementById(`lp-clear-${side}`);
    if (loaded) {
      const parts = [t(titleKey)];
      if (fmt && fmt !== 'DEMO') parts.push(fmt);
      if (info.pages > 1) parts.push(formatMsg('metaPages', { n: info.pages }));
      parts.push(info.blocks === 1 ? t('metaParasOne') : formatMsg('metaParas', { n: info.blocks }));
      titleEl.textContent = name || t(titleKey);
      titleEl.removeAttribute('data-i18n');
      hintEl.textContent = `${t('lpLoaded')} · ${parts.join(' · ')}`;
      hintEl.removeAttribute('data-i18n');
      ctaEl.removeAttribute('data-i18n');
      ctaEl.textContent = t('lpChangeFile');
    } else {
      titleEl.setAttribute('data-i18n', titleKey);
      titleEl.textContent = t(titleKey);
      hintEl.setAttribute('data-i18n', 'slotHint');
      hintEl.textContent = t('slotHint');
      ctaEl.setAttribute('data-i18n', 'slotChoose');
      ctaEl.textContent = t('slotChoose');
    }
    if (clearBtn) clearBtn.hidden = !loaded;
  });
}

// File facts for the documents popover: "PDF · 3 Seiten · 31 Absätze".
function updateColumnMeta(side) {
  const metaEl = document.getElementById(side === 'left' ? 'meta-left' : 'meta-right');
  if (!metaEl) return;
  const res = lastComparison && lastComparison.result;
  const blocks = res ? (side === 'left' ? res.leftBlocks.length : res.rightBlocks.length) : 0;
  const pages = res ? (side === 'left' ? res.leftPages : res.rightPages) : 0;
  const rawFmt = side === 'left' ? state.leftFormat : state.rightFormat;
  const fmt = rawFmt === 'DEMO' ? t('demoLabel') : rawFmt;
  if (!blocks) {
    metaEl.textContent = '';
    return;
  }
  const parts = [];
  if (fmt) parts.push(fmt);
  if (pages > 0) parts.push(pages === 1 ? t('metaPagesOne') : formatMsg('metaPages', { n: pages }));
  parts.push(blocks === 1 ? t('metaParasOne') : formatMsg('metaParas', { n: blocks }));
  metaEl.textContent = parts.join(' · ');
}

function getClauseTypeClasses(block) {
  if (!block) return '';
  const classes = [];
  if (block.isHeading) classes.push('is-heading');
  if (block.kind) classes.push(`kind-${block.kind}`);
  if (extractListMarker(block.text, block.kind)) classes.push('has-marker');
  if (block.indent > 0) classes.push(`indent-${Math.min(block.indent, 4)}`);
  return classes.join(' ');
}
