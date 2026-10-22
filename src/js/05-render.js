// Entity-safe search highlighting: splits raw text BEFORE escaping so HTML entities are never corrupted
function escapeAndHighlightText(rawText, query) {
  if (!rawText) return '';
  if (!query || query.trim().length < 2) return escapeHtml(rawText);
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
          return part.removed ? `<del class="tok-del">${content}</del>` : content;
        })
        .join('');
      const markerHtml =
        split.marker === rSplit.marker
          ? escapeAndHighlightText(split.marker, query)
          : `<del class="tok-del">${escapeAndHighlightText(split.marker, query)}</del>`;
      return wrapMarkerAndBody(markerHtml, bodyHtml);
    }

    const sideParts = coalesceSideTokens(
      row.wordDiffs.filter(part => !part.added),
      'removed'
    );
    return sideParts
      .map(part => {
        const content = escapeAndHighlightText(part.value, query);
        return part.removed ? `<del class="tok-del">${content}</del>` : content;
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
          return part.added ? `<ins class="tok-ins">${content}</ins>` : content;
        })
        .join('');
      const markerHtml =
        split.marker === lSplit.marker
          ? escapeAndHighlightText(split.marker, query)
          : `<ins class="tok-ins">${escapeAndHighlightText(split.marker, query)}</ins>`;
      return wrapMarkerAndBody(markerHtml, bodyHtml);
    }

    const sideParts = coalesceSideTokens(
      row.wordDiffs.filter(part => !part.removed),
      'added'
    );
    return sideParts
      .map(part => {
        const content = escapeAndHighlightText(part.value, query);
        return part.added ? `<ins class="tok-ins">${content}</ins>` : content;
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
          if (part.removed) return `<del class="tok-del">${content}</del>`;
          if (part.added) return `<ins class="tok-ins">${content}</ins>`;
          return content;
        })
        .join('');
      const markerHtml =
        lSplit.marker === rSplit.marker
          ? escapeAndHighlightText(rSplit.marker, query)
          : `<del class="tok-del">${escapeAndHighlightText(lSplit.marker, query)}</del> <ins class="tok-ins">${escapeAndHighlightText(rSplit.marker, query)}</ins>`;
      return wrapMarkerAndBody(markerHtml, bodyHtml);
    }

    return coalesceUnifiedTokens(row.wordDiffs)
      .map(part => {
        const content = escapeAndHighlightText(part.value, query);
        if (part.removed) return `<del class="tok-del">${content}</del>`;
        if (part.added) return `<ins class="tok-ins">${content}</ins>`;
        return content;
      })
      .join('');
  }
  return '';
}

function renderGhostSheet() {
  return `
    <div class="ghost-sheet" data-empty-state aria-hidden="true">
      <div class="ghost-block">
        <div class="ghost-line h"></div>
      </div>
      <div class="ghost-block">
        <div class="ghost-line" style="width:94%"></div>
        <div class="ghost-line" style="width:88%"></div>
        <div class="ghost-line" style="width:62%"></div>
      </div>
      <div class="ghost-block">
        <div class="ghost-line" style="width:91%"></div>
        <div class="ghost-line" style="width:76%"></div>
      </div>
      <div class="ghost-block">
        <div class="ghost-line h" style="width:48%"></div>
      </div>
      <div class="ghost-block">
        <div class="ghost-line" style="width:96%"></div>
        <div class="ghost-line" style="width:84%"></div>
        <div class="ghost-line" style="width:54%"></div>
      </div>
    </div>
  `;
}

function renderLaunchpadHtml(leftCount, rightCount) {
  const leftLoaded = leftCount > 0;
  const rightLoaded = rightCount > 0;
  const leftSlotClass = leftLoaded ? 'is-loaded' : 'is-next-step';
  const rightSlotClass = rightLoaded ? 'is-loaded' : leftLoaded ? 'is-next-step' : '';

  const leftTitle = leftLoaded ? state.leftName || 'Vorher' : t('lpLeftTitle');
  const leftHint = leftLoaded ? `${t('lpLoaded')} · ${leftCount} ${t('unitPara')}` : t('lpLeftHint');
  const leftBtnClass = !leftLoaded ? 'btn btn-primary' : 'btn';
  const leftBtnLabel = leftLoaded ? t('lpChangeFile') : t('chooseFileLeft');

  const rightTitle = rightLoaded ? state.rightName || 'Nachher' : t('lpRightTitle');
  const rightHint = rightLoaded ? `${t('lpLoaded')} · ${rightCount} ${t('unitPara')}` : t('lpRightHint');
  const rightBtnClass = leftLoaded && !rightLoaded ? 'btn btn-primary' : 'btn';
  const rightBtnLabel = rightLoaded ? t('lpChangeFile') : t('chooseFileRight');

  const uploadSvg = '<svg class="icon" style="width:14px;height:14px;" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';
  const sepSvg = '<svg class="icon lp-sep" style="width:12px;height:12px;" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>';

  return `
    <div class="launchpad-card">
      <div class="launchpad-head">
        <h1 class="launchpad-title">${escapeHtml(t('lpTitle'))}</h1>
        <p class="launchpad-sub">${escapeHtml(t('lpSub'))}</p>
      </div>

      <div class="launchpad-grid">
        <div class="launchpad-slot ${leftSlotClass}" id="lp-slot-left" data-side="left">
          <div class="lp-slot-top">
            <span class="col-role-pill col-role-old">${escapeHtml(t('colLeft'))}</span>
          </div>
          <div class="lp-slot-title">${escapeHtml(leftTitle)}</div>
          <div class="lp-slot-hint">${escapeHtml(leftHint)}</div>
          <button type="button" class="${leftBtnClass}" id="btn-empty-upload-left">
            ${uploadSvg}
            <span>${escapeHtml(leftBtnLabel)}</span>
          </button>
        </div>

        <div class="launchpad-slot ${rightSlotClass}" id="lp-slot-right" data-side="right">
          <div class="lp-slot-top">
            <span class="col-role-pill col-role-new">${escapeHtml(t('colRight'))}</span>
          </div>
          <div class="lp-slot-title">${escapeHtml(rightTitle)}</div>
          <div class="lp-slot-hint">${escapeHtml(rightHint)}</div>
          <button type="button" class="${rightBtnClass}" id="btn-empty-upload-right">
            ${uploadSvg}
            <span>${escapeHtml(rightBtnLabel)}</span>
          </button>
        </div>
      </div>

      <div class="launchpad-secondary">
        <button type="button" class="btn btn-open-paste">
          <svg class="icon" style="width:14px;height:14px;" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          <span>${escapeHtml(t('pasteText'))}</span>
        </button>
        <button type="button" class="btn btn-load-sample">
          <svg class="icon" style="width:13px;height:13px;" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          <span>${escapeHtml(t('loadSample'))}</span>
        </button>
        <button type="button" class="btn btn-ghost btn-open-session" data-tooltip="${escapeHtml(t('sessionOpenTitle'))}">
          <svg class="icon" style="width:14px;height:14px;" viewBox="0 0 24 24"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>
          <span>${escapeHtml(t('sessionOpen'))}</span>
        </button>
      </div>

      <div class="launchpad-footer">
        <div class="launchpad-steps">
          <span class="lp-step"><span class="lp-step-num">1</span><span>${escapeHtml(t('lpStep1'))}</span></span>
          ${sepSvg}
          <span class="lp-step"><span class="lp-step-num">2</span><span>${escapeHtml(t('lpStep2'))}</span></span>
          ${sepSvg}
          <span class="lp-step"><span class="lp-step-num">3</span><span>${escapeHtml(t('lpStep3'))}</span></span>
        </div>
        <div class="launchpad-trust">
          <span>${escapeHtml(t('lpTrust'))}</span>
          <span>·</span>
          <button type="button" class="lp-link btn-open-privacy">${escapeHtml(t('footerPrivacy'))}</button>
          <span>·</span>
          <a href="https://github.com/tschnorpfeil/docdiff" target="_blank" rel="noopener noreferrer" class="lp-link">GitHub</a>
        </div>
      </div>
    </div>
  `;
}

function updateMobileBarState() {
  const total = state.changeRows.length;
  const curIdx = state.changeRows.findIndex(r => r.id === state.activeRowId);
  const countEl = document.getElementById('mob-step-count');
  if (countEl) {
    countEl.textContent = total > 0 ? `${curIdx >= 0 ? curIdx + 1 : '–'}/${total}` : '0/0';
  }
  const dockCountEl = document.getElementById('dock-step-count');
  if (dockCountEl) {
    dockCountEl.textContent = total > 0 ? `${curIdx >= 0 ? curIdx + 1 : '–'} / ${total}` : '0 / 0';
    dockCountEl.classList.toggle('has-active', total > 0 && curIdx >= 0);
  }
  const prevBtn = document.getElementById('mob-btn-prev');
  const nextBtn = document.getElementById('mob-btn-next');
  const dockPrevBtn = document.getElementById('btn-prev');
  const dockNextBtn = document.getElementById('btn-next');
  if (prevBtn) prevBtn.disabled = total === 0;
  if (nextBtn) nextBtn.disabled = total === 0;
  if (dockPrevBtn) dockPrevBtn.disabled = total === 0;
  if (dockNextBtn) dockNextBtn.disabled = total === 0;
  const badgeEl = document.getElementById('mob-changes-badge');
  if (badgeEl) badgeEl.textContent = String(total);
  const mobFilterBtn = document.getElementById('mob-btn-only-changes');
  if (mobFilterBtn) mobFilterBtn.setAttribute('aria-pressed', String(state.onlyChanges));
  const hfBtn = document.getElementById('btn-filter-hf');
  if (hfBtn) hfBtn.setAttribute('aria-pressed', String(state.ignoreHeadersFooters));
  const hfBadge = document.getElementById('hf-count-badge');
  if (hfBadge) {
    hfBadge.textContent = String(state.filteredHfCount);
    hfBadge.style.display = state.filteredHfCount > 0 ? 'inline-flex' : 'none';
  }
}

function updateColumnMeta(side, blocksCount, pagesCount = 0) {
  const metaEl = document.getElementById(side === 'left' ? 'meta-left' : 'meta-right');
  const clearBtn = document.getElementById(side === 'left' ? 'btn-clear-left' : 'btn-clear-right');
  const fmt = side === 'left' ? state.leftFormat : state.rightFormat;

  if (blocksCount > 0) {
    const pageStr = pagesCount > 0 ? `${pagesCount} ${t('pageShort')} · ` : '';
    metaEl.textContent = fmt
      ? `${fmt} · ${pageStr}${blocksCount} ${t('unitPara')}`
      : `${pageStr}${blocksCount} ${t('unitPara')}`;
    metaEl.classList.add('is-visible');
    clearBtn.style.display = 'inline-flex';
  } else {
    metaEl.textContent = '';
    metaEl.classList.remove('is-visible');
    clearBtn.style.display = 'none';
  }
}

function getClauseTypeClasses(block) {
  if (!block) return '';
  const classes = [];
  if (block.isHeading) classes.push('is-heading');
  if (block.kind) classes.push(`kind-${block.kind}`);
  if (extractListMarker(block.text, block.kind)) classes.push('has-marker');
  return classes.join(' ');
}
