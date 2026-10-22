function runComparison() {
  // Header/footer lines are hidden only when they repeat across pages and are identical
  // in both versions (apart from page numbers); hfCount = lines hidden in both documents.
  const { allRightBlocks, leftBlocks, rightBlocks, hfCount } = prepareComparisonBlocks(
    state.leftText,
    state.rightText,
    state.ignoreHeadersFooters
  );
  state.rightAllBlocks = allRightBlocks;
  state.filteredHfCount = hfCount;

  const leftPages = leftBlocks.reduce((m, b) => Math.max(m, b.pageNum || 1), 0);
  const rightPages = rightBlocks.reduce((m, b) => Math.max(m, b.pageNum || 1), 0);

  document.getElementById('filename-left').textContent = state.leftName || t('noFileLeft');
  document.getElementById('filename-right').textContent = state.rightName || t('noFileRight');

  updateColumnMeta('left', leftBlocks.length, leftPages);
  updateColumnMeta('right', rightBlocks.length, rightPages);

  const bothLoaded = leftBlocks.length > 0 && rightBlocks.length > 0;
  const wasComparing = document.body.classList.contains('is-comparing');
  const emptyLaunchpad = document.getElementById('empty-launchpad');
  // Focus sat on something that is about to disappear (landing page or comparison chrome)?
  const active = document.activeElement;
  const focusWasLost = !active || active === document.body;
  const focusInLanding = Boolean(emptyLaunchpad && active && emptyLaunchpad.contains(active));
  const focusInCompareChrome = Boolean(active && active.closest && active.closest('.compare-only'));

  document.body.classList.toggle('has-docs', leftBlocks.length > 0 || rightBlocks.length > 0);
  document.body.classList.toggle('is-comparing', bothLoaded);
  document.body.classList.toggle('legend-dismissed', state.legendDismissed);
  const badgeEditable = document.getElementById('badge-editable');
  if (badgeEditable) {
    badgeEditable.classList.toggle('is-visible', bothLoaded);
  }

  if (!bothLoaded) {
    state.alignedRows = [];
    state.changeRows = [];
    updateHeaderCounts(0, 0, 0);
    updateMobileBarState();
    updateUndoRedoButtons();

    // Panes stay hidden until both versions exist; the landing slots show what is loaded.
    setSafeContainerHtml(sheetLeft, '');
    setSafeContainerHtml(sheetRight, '');
    setSafeContainerHtml(sheetUnified, '');
    updateLandingSlots(
      { blocks: leftBlocks.length, pages: leftPages },
      { blocks: rightBlocks.length, pages: rightPages }
    );

    bindEmptyStateButtons();
    renderSidebarList(bothLoaded);
    minimapTrack.innerHTML = '';
    connectorSvg.innerHTML = '';

    if (wasComparing && (focusWasLost || focusInCompareChrome)) {
      const heading = document.getElementById('landing-title');
      if (emptyLaunchpad) emptyLaunchpad.scrollTop = 0;
      if (heading) heading.focus({ preventScroll: true });
    }
    return;
  }

  state.alignedRows = alignDocumentBlocks(leftBlocks, rightBlocks);
  state.changeRows = state.alignedRows.filter(r => r.type !== 'equal');

  const counts = getChangeCounts();
  updateHeaderCounts(counts.mod, counts.ins, counts.del);

  const compareHeading = document.getElementById('compare-heading');
  if (compareHeading) {
    compareHeading.textContent = formatMsg('compareHeading', {
      left: state.leftName || t('colLeft'),
      right: state.rightName || t('colRight'),
    });
  }

  renderDocumentPanes();
  renderSidebarList(true);
  renderMinimap();
  updateMobileBarState();
  updateUndoRedoButtons();

  if (state.activeRowId) {
    document.querySelectorAll(`[data-row-id="${state.activeRowId}"]`).forEach(el => {
      if (
        el.classList.contains('clause') ||
        el.classList.contains('nav-item') ||
        el.classList.contains('minimap-tick')
      ) {
        el.classList.add('is-active');
      }
    });
  }

  requestAnimationFrame(() => {
    if (state.viewMode !== 'inline') equalizeRowHeights();
    scheduleGutterDraw();
  });

  if (!wasComparing) {
    const total = state.changeRows.length;
    announce(
      total === 0
        ? t('announceIdentical')
        : total === 1
        ? t('announceComparedOne')
        : formatMsg('announceCompared', { n: total })
    );
    // The landing page (and whatever had focus in it) just disappeared: hand focus to the
    // document so keyboard users continue with Tab or J / K from a sensible place.
    if (focusWasLost || focusInLanding) {
      const pane = state.viewMode === 'inline' ? paneUnified : paneRight;
      requestAnimationFrame(() => pane.focus({ preventScroll: true }));
    }
  }
}

// Single source for the header counts and the sidebar filter counts.
function getChangeCounts() {
  const counts = { mod: 0, ins: 0, del: 0 };
  for (const r of state.changeRows) {
    if (r.type === 'modified') counts.mod++;
    else if (r.type === 'inserted') counts.ins++;
    else if (r.type === 'deleted') counts.del++;
  }
  return counts;
}

// The header shows the same three numbers as the sidebar filters (a modified paragraph
// counts once, as "modified" – not once as added and once as removed).
function updateHeaderCounts(modCount, insCount, delCount) {
  const total = modCount + insCount + delCount;
  document.getElementById('count-all').textContent = String(total);
  document.getElementById('i18n-changes-label').textContent = changesWord(total);
  document.getElementById('count-mod').textContent = String(modCount);
  document.getElementById('count-ins').textContent = String(insCount);
  document.getElementById('count-del').textContent = String(delCount);
  const summary = document.getElementById('stat-summary');
  if (summary) {
    summary.querySelector('.stat-mod').classList.toggle('is-zero', modCount === 0);
    summary.querySelector('.stat-ins').classList.toggle('is-zero', insCount === 0);
    summary.querySelector('.stat-del').classList.toggle('is-zero', delCount === 0);
  }
}

function loadSampleComparison() {
  const sample = SAMPLES[state.lang] || SAMPLES.de;
  state.leftName = t('sampleLeftName');
  state.leftFormat = 'DEMO';
  state.leftText = sample.v1;
  state.rightName = t('sampleRightName');
  state.rightFormat = 'DEMO';
  state.rightText = sample.v2;
  resetEditHistory();
  runComparison();
}

function clearLandingSide(side) {
  if (side === 'left') {
    state.leftText = '';
    state.leftName = '';
    state.leftFormat = '';
    document.getElementById('file-input-left').value = '';
  } else {
    state.rightText = '';
    state.rightName = '';
    state.rightFormat = '';
    state.undoStack = [];
    state.redoStack = [];
    document.getElementById('file-input-right').value = '';
  }
  runComparison();
  const btn = document.getElementById(`btn-empty-upload-${side}`);
  if (btn) btn.focus();
}

let landingBound = false;
function bindEmptyStateButtons() {
  if (landingBound) return;
  landingBound = true;

  const slotLeft = document.getElementById('lp-slot-left');
  const slotRight = document.getElementById('lp-slot-right');
  [
    { el: slotLeft, side: 'left', inputId: 'file-input-left' },
    { el: slotRight, side: 'right', inputId: 'file-input-right' },
  ].forEach(({ el, side, inputId }) => {
    if (!el) return;
    document
      .getElementById(`btn-empty-upload-${side}`)
      .addEventListener('click', () => document.getElementById(inputId).click());
    const clearBtn = document.getElementById(`lp-clear-${side}`);
    if (clearBtn) clearBtn.addEventListener('click', () => clearLandingSide(side));
    el.addEventListener('dragover', e => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => {
      el.classList.remove('drag-over');
    });
    el.addEventListener('drop', async e => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drag-over');
      dragCounter = 0;
      document.body.classList.remove('is-dragging-file');
      await handleDropFiles(e.dataTransfer.files, side);
    });
  });

  const lpOverlay = document.getElementById('empty-launchpad');
  if (lpOverlay && !lpOverlay.dataset.dropBound) {
    lpOverlay.dataset.dropBound = '1';
    lpOverlay.addEventListener('dragover', e => e.preventDefault());
    lpOverlay.addEventListener('drop', async e => {
      e.preventDefault();
      dragCounter = 0;
      document.body.classList.remove('is-dragging-file');
      const defaultSide = state.leftText && !state.rightText ? 'right' : 'left';
      await handleDropFiles(e.dataTransfer.files, defaultSide);
    });
  }

  document.querySelectorAll('.btn-open-paste').forEach(btn => {
    btn.addEventListener('click', () => openPasteModal());
  });

  document.querySelectorAll('.btn-open-privacy').forEach(btn => {
    btn.addEventListener('click', () => document.getElementById('privacy-modal').showModal());
  });

  document.querySelectorAll('.btn-load-sample').forEach(btn => {
    btn.addEventListener('click', loadSampleComparison);
  });
}

// Moved blocks keep type 'deleted' (old position) / 'inserted' (new position); this note
// labels them so they are not read as a removal plus an unrelated addition.
function renderMovedNoteHtml(row) {
  if (!row.moved) return '';
  const label = row.type === 'deleted' ? t('movedFromHere') : t('movedToHere');
  return `<span class="moved-note">${escapeHtml(label)}</span>`;
}

function renderRightActionsHtml(row) {
  const editLabel = row.rightBlock ? t('editBtn') : t('editInsertBtn');
  const editSvg = row.rightBlock
    ? '<svg class="icon" style="width:12px;height:12px;" viewBox="0 0 24 24"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>'
    : '<svg class="icon" style="width:12px;height:12px;" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
  const revertSvg = '<svg class="icon" style="width:12px;height:12px;" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';
  const editBtn = `<button type="button" class="clause-action-btn" data-edit-row="${row.id}">${editSvg}<span>${escapeHtml(editLabel)}</span></button>`;
  const revertBtn =
    row.type !== 'equal'
      ? `<button type="button" class="clause-action-btn is-revert" data-revert-row="${row.id}">${revertSvg}<span>${escapeHtml(t('revertBtn'))}</span></button>`
      : '';
  return `<div class="clause-actions">${editBtn}${revertBtn}</div>`;
}

function renderPageCardHeaderHtml(pageNum, totalPages, rowsInPage) {
  const sections = [];
  for (const r of rowsInPage) {
    const b = r.rightBlock || r.leftBlock;
    if (b && b.sectionRef && !sections.includes(b.sectionRef)) {
      sections.push(b.sectionRef);
    }
  }
  const secRange =
    sections.length === 1
      ? sections[0]
      : sections.length > 1
      ? `${sections[0]} – ${sections[sections.length - 1]}`
      : '';
  const changeCount = rowsInPage.filter(r => r.type !== 'equal').length;
  const pillLabel =
    changeCount > 0 ? `${changeCount} ${escapeHtml(changesWord(changeCount))}` : escapeHtml(t('pageUnchanged'));

  return `
    <header class="doc-page-header" aria-label="${escapeHtml(t('pageLabel'))} ${pageNum}">
      <div class="page-head-left">
        <span class="page-num-label">${escapeHtml(t('pageLabel'))} ${pageNum} ${escapeHtml(t('pageOf'))} ${totalPages}</span>
        ${secRange ? `<span class="page-sec-range">· ${escapeHtml(secRange)}</span>` : ''}
      </div>
      <span class="page-change-pill ${changeCount === 0 ? 'is-clean' : ''}">${pillLabel}</span>
    </header>
  `;
}

function renderDocumentPanes() {
  const q = state.searchQuery;
  const pageGroups = new Map();

  state.alignedRows.forEach((row, idx) => {
    const p = row.pageNum || 1;
    if (!pageGroups.has(p)) pageGroups.set(p, []);
    pageGroups.get(p).push({ row, idx });
  });

  const totalPages = pageGroups.size || 1;
  const leftPageCards = [];
  const rightPageCards = [];
  const unifiedPageCards = [];

  for (const [pageNum, entries] of pageGroups.entries()) {
    const rowsInPage = entries.map(e => e.row);
    const pageHeaderHtml = renderPageCardHeaderHtml(pageNum, totalPages, rowsInPage);
    const leftRowsHtml = [];
    const rightRowsHtml = [];
    const unifiedRowsHtml = [];

    for (const { row, idx } of entries) {
      const deferClass = idx > 18 ? 'deferred-block' : '';
      const movedClass = row.moved ? 'is-moved' : '';
      const rightActionsHtml = renderRightActionsHtml(row);

      if (row.leftBlock) {
        const typeClasses = getClauseTypeClasses(row.leftBlock);
        const stateClass =
          row.type === 'equal'
            ? 'state-equal'
            : row.type === 'modified'
            ? 'state-modified'
            : 'state-deleted';

        leftRowsHtml.push(`
          <div class="diff-row-anchor" data-row-id="${row.id}" data-type="${row.type}">
            <div class="clause ${stateClass} ${typeClasses} ${movedClass} ${deferClass}" data-row-id="${row.id}">${renderMovedNoteHtml(row)}${renderLeftBlockHtml(row, q)}</div>
          </div>
        `);
      } else {
        leftRowsHtml.push(`
          <div class="diff-row-anchor" data-row-id="${row.id}" data-type="${row.type}">
            <div class="clause state-placeholder ${deferClass}" data-row-id="${row.id}"></div>
          </div>
        `);
      }

      if (row.rightBlock) {
        const typeClasses = getClauseTypeClasses(row.rightBlock);
        const stateClass =
          row.type === 'equal'
            ? 'state-equal'
            : row.type === 'modified'
            ? 'state-modified'
            : 'state-inserted';

        rightRowsHtml.push(`
          <div class="diff-row-anchor" data-row-id="${row.id}" data-type="${row.type}">
            <div class="clause ${stateClass} ${typeClasses} ${movedClass} ${deferClass}" data-row-id="${row.id}">${renderMovedNoteHtml(row)}${renderRightBlockHtml(row, q)}${rightActionsHtml}</div>
          </div>
        `);
      } else {
        rightRowsHtml.push(`
          <div class="diff-row-anchor" data-row-id="${row.id}" data-type="${row.type}">
            <div class="clause state-placeholder ${deferClass}" data-row-id="${row.id}">${rightActionsHtml}</div>
          </div>
        `);
      }

      const primaryBlock = row.rightBlock || row.leftBlock;
      const uTypeClasses = getClauseTypeClasses(primaryBlock);
      const uStateClass =
        row.type === 'equal'
          ? 'state-equal'
          : row.type === 'modified'
          ? 'state-modified'
          : row.type === 'inserted'
          ? 'state-inserted'
          : 'state-deleted';

      unifiedRowsHtml.push(`
        <div class="diff-row-anchor" data-row-id="${row.id}" data-type="${row.type}">
          <div class="clause ${uStateClass} ${uTypeClasses} ${movedClass} ${deferClass}" data-row-id="${row.id}">${renderMovedNoteHtml(row)}${renderUnifiedBlockHtml(row, q, true)}${rightActionsHtml}</div>
        </div>
      `);
    }

    leftPageCards.push(`
      <section class="doc-page-card" data-page="${pageNum}">
        ${pageHeaderHtml}
        <div class="doc-page-body">${leftRowsHtml.join('')}</div>
      </section>
    `);
    rightPageCards.push(`
      <section class="doc-page-card" data-page="${pageNum}">
        ${pageHeaderHtml}
        <div class="doc-page-body">${rightRowsHtml.join('')}</div>
      </section>
    `);
    unifiedPageCards.push(`
      <section class="doc-page-card" data-page="${pageNum}">
        ${pageHeaderHtml}
        <div class="doc-page-body">${unifiedRowsHtml.join('')}</div>
      </section>
    `);
  }

  setSafeContainerHtml(sheetLeft, leftPageCards.join(''));
  setSafeContainerHtml(sheetRight, rightPageCards.join(''));
  setSafeContainerHtml(sheetUnified, unifiedPageCards.join(''));
}

function equalizeRowHeights() {
  if (state.viewMode === 'inline') return;
  const leftAnchors = sheetLeft.querySelectorAll('.diff-row-anchor');
  const rightAnchors = sheetRight.querySelectorAll('.diff-row-anchor');
  const len = Math.min(leftAnchors.length, rightAnchors.length);

  for (let i = 0; i < len; i++) {
    const lBlock = leftAnchors[i].firstElementChild;
    const rBlock = rightAnchors[i].firstElementChild;
    if (!lBlock || !rBlock) continue;
    lBlock.style.minHeight = '';
    rBlock.style.minHeight = '';
  }

  const heights = new Array(len);
  for (let i = 0; i < len; i++) {
    const lBlock = leftAnchors[i].firstElementChild;
    const rBlock = rightAnchors[i].firstElementChild;
    if (!lBlock || !rBlock) {
      heights[i] = 0;
      continue;
    }
    heights[i] = Math.max(lBlock.offsetHeight, rBlock.offsetHeight);
  }

  for (let i = 0; i < len; i++) {
    if (!heights[i]) continue;
    leftAnchors[i].firstElementChild.style.minHeight = `${heights[i]}px`;
    rightAnchors[i].firstElementChild.style.minHeight = `${heights[i]}px`;
  }
}

function truncateClean(str, maxLen = 40) {
  const clean = str.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  const cut = clean.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 16 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.]+$/, '') + '…';
}

function extractDeltaPairs(wordDiffs) {
  const pairs = [];
  let i = 0;
  const isChange = tok => Boolean(tok && (tok.removed || tok.added));
  const isBridgeSpace = idx =>
    idx > 0 &&
    idx + 1 < wordDiffs.length &&
    !isChange(wordDiffs[idx]) &&
    /^\s+$/.test(wordDiffs[idx].value) &&
    isChange(wordDiffs[idx - 1]) &&
    isChange(wordDiffs[idx + 1]);
  const isSingleWordBridge = idx =>
    idx > 0 &&
    idx + 1 < wordDiffs.length &&
    !isChange(wordDiffs[idx]) &&
    /^\s*\S{1,12}\s*$/.test(wordDiffs[idx].value) &&
    isChange(wordDiffs[idx - 1]) &&
    isChange(wordDiffs[idx + 1]) &&
    (wordDiffs[idx - 1].value.trim().includes(' ') || wordDiffs[idx + 1].value.trim().includes(' '));

  while (i < wordDiffs.length) {
    if (!isChange(wordDiffs[i])) {
      i++;
      continue;
    }
    const run = [];
    while (
      i < wordDiffs.length &&
      (isChange(wordDiffs[i]) || isBridgeSpace(i) || isSingleWordBridge(i))
    ) {
      run.push(wordDiffs[i]);
      i++;
    }
    const rawDel = run
      .filter(tok => !tok.added)
      .map(tok => tok.value)
      .join('')
      .replace(/\s+/g, ' ')
      .replace(/^[,;\s]+|[,;\s]+$/g, '')
      .trim();
    const rawIns = run
      .filter(tok => !tok.removed)
      .map(tok => tok.value)
      .join('')
      .replace(/\s+/g, ' ')
      .replace(/^[,;\s]+|[,;\s]+$/g, '')
      .trim();

    if (!rawDel && !rawIns) continue;
    pairs.push({ del: rawDel, ins: rawIns });
  }
  return pairs;
}

function renderSidebarDeltaHtml(row, query) {
  if (row.type === 'deleted') {
    return `<span class="nav-item-snippet"><del class="tok-del">${escapeAndHighlightText(
      truncateClean(row.leftBlock.text, 92),
      query
    )}</del></span>`;
  }
  if (row.type === 'inserted') {
    return `<span class="nav-item-snippet"><ins class="tok-ins">${escapeAndHighlightText(
      truncateClean(row.rightBlock.text, 92),
      query
    )}</ins></span>`;
  }
  const pairs = extractDeltaPairs(row.wordDiffs || []);
  if (pairs.length === 0) {
    return `<span class="nav-item-snippet">${renderUnifiedBlockHtml(row, query)}</span>`;
  }
  const maxPairs = 3;
  const visible = pairs.slice(0, maxPairs);
  const rowsHtml = visible
    .map(pair => {
      if (pair.del && pair.ins) {
        return `<span class="nav-delta-row"><del class="tok-del">${escapeAndHighlightText(
          truncateClean(pair.del, 34),
          query
        )}</del><span class="nav-delta-arrow" aria-hidden="true">→</span><ins class="tok-ins">${escapeAndHighlightText(
          truncateClean(pair.ins, 34),
          query
        )}</ins></span>`;
      }
      if (pair.ins) {
        return `<span class="nav-delta-row"><ins class="tok-ins">+ ${escapeAndHighlightText(
          truncateClean(pair.ins, 46),
          query
        )}</ins></span>`;
      }
      return `<span class="nav-delta-row"><del class="tok-del">− ${escapeAndHighlightText(
        truncateClean(pair.del, 46),
        query
      )}</del></span>`;
    })
    .join('');
  const moreHtml =
    pairs.length > maxPairs
      ? `<span class="nav-delta-more">+${pairs.length - maxPairs} ${escapeHtml(t('moreDeltas'))}</span>`
      : '';
  return `<span class="nav-item-deltas">${rowsHtml}${moreHtml}</span>`;
}

function getChangeTypeLabel(row) {
  if (row.moved) return t('typeMoved');
  return row.type === 'modified' ? t('statMod') : row.type === 'inserted' ? t('statIns') : t('statDel');
}

// Clause reference for display, without the bullet glyph used internally for list items.
function getDisplayRef(row) {
  const block = row.rightBlock || row.leftBlock;
  const ref = block && block.refCode ? String(block.refCode) : '';
  return ref.replace(/\s*[•‣▪◦]\s*$/, '').trim();
}

function getFilteredChangeRows() {
  return state.changeRows.filter(row => {
    if (state.sidebarFilter !== 'all' && row.type !== state.sidebarFilter) {
      return false;
    }
    if (state.searchQuery.trim().length >= 2) {
      const q = state.searchQuery.toLowerCase();
      const lText = row.leftBlock ? row.leftBlock.text.toLowerCase() : '';
      const rText = row.rightBlock ? row.rightBlock.text.toLowerCase() : '';
      return lText.includes(q) || rText.includes(q);
    }
    return true;
  });
}

function updateSidebarHeaderState() {
  const total = state.changeRows.length;
  const activeIdx = state.changeRows.findIndex(r => r.id === state.activeRowId);
  const badge = document.getElementById('sidebar-count-badge');
  if (badge) {
    if (total > 0 && activeIdx >= 0) {
      badge.textContent = `${activeIdx + 1} / ${total}`;
      badge.classList.add('has-active');
    } else {
      badge.textContent = String(total);
      badge.classList.remove('has-active');
    }
  }

  const { mod: modCount, ins: insCount, del: delCount } = getChangeCounts();

  const cAll = document.getElementById('filter-count-all');
  const cMod = document.getElementById('filter-count-mod');
  const cIns = document.getElementById('filter-count-ins');
  const cDel = document.getElementById('filter-count-del');
  if (cAll) cAll.textContent = String(total);
  if (cMod) cMod.textContent = String(modCount);
  if (cIns) cIns.textContent = String(insCount);
  if (cDel) cDel.textContent = String(delCount);

  document.querySelectorAll('[data-sidebar-filter]').forEach(btn => {
    const f = btn.getAttribute('data-sidebar-filter');
    const isActive = f === state.sidebarFilter;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
    const countForTab =
      f === 'all' ? total : f === 'modified' ? modCount : f === 'inserted' ? insCount : delCount;
    btn.classList.toggle('is-zero', countForTab === 0);
  });
}

function renderSidebarList(bothLoaded) {
  updateSidebarHeaderState();
  if (!bothLoaded) {
    setSafeContainerHtml(
      sidebarList,
      `
      <div class="empty-state empty-state-sm" data-empty-state>
        <svg class="empty-glyph" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/>
        </svg>
        <p class="empty-title">${escapeHtml(t('sidebarEmptyTitle'))}</p>
        <div class="empty-desc">${escapeHtml(t('sidebarEmptyDesc'))}</div>
      </div>
    `
    );
    return;
  }

  const filtered = getFilteredChangeRows();

  if (filtered.length === 0) {
    const isSearchOrFilter = state.searchQuery.trim().length >= 2 || state.sidebarFilter !== 'all';
    setSafeContainerHtml(
      sidebarList,
      `
      <div class="empty-state empty-state-sm" data-empty-state>
        <svg class="empty-glyph" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <p class="empty-title">${escapeHtml(isSearchOrFilter ? t('noMatchesTitle') : t('identicalTitle'))}</p>
        <div class="empty-desc">${escapeHtml(isSearchOrFilter ? t('noMatchesDesc') : t('identicalDesc'))}</div>
      </div>
    `
    );
    return;
  }

  const editSvg = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
  const revertSvg = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';

  setSafeContainerHtml(
    sidebarList,
    filtered
      .map(row => {
        const globalIdx = state.changeRows.indexOf(row) + 1;
        const cls =
          (row.type === 'modified' ? 'mod' : row.type === 'inserted' ? 'ins' : 'del') + (row.moved ? ' moved' : '');
        const isActive = row.id === state.activeRowId;
        const typeLabel = getChangeTypeLabel(row);
        const refCode = getDisplayRef(row);
        const pageNum = row.pageNum || 1;
        const deltaHtml = renderSidebarDeltaHtml(row, state.searchQuery);
        const editLabel = row.rightBlock ? t('editBtn') : t('editInsertBtn');

        return `
          <div class="nav-item ${cls}${isActive ? ' is-active' : ''}" data-row-id="${row.id}">
            <button type="button" class="nav-item-main">
              <span class="nav-item-head">
                <span class="nav-item-idx">${globalIdx}</span>
                <span class="nav-item-page">${escapeHtml(t('pageShort'))} ${pageNum}</span>
                ${refCode ? `<span class="nav-item-ref">${escapeHtml(refCode)}</span>` : ''}
                <span class="sr-only">– ${escapeHtml(typeLabel)}:</span>
              </span>
              ${deltaHtml}
            </button>
            <span class="nav-item-actions">
              <button type="button" class="nav-item-act-btn" data-edit-row="${row.id}" aria-label="${escapeHtml(`${editLabel} (${globalIdx})`)}" data-tooltip="${escapeHtml(editLabel)}">${editSvg}</button>
              <button type="button" class="nav-item-act-btn is-revert" data-revert-row="${row.id}" aria-label="${escapeHtml(`${t('revertBtn')} (${globalIdx})`)}" data-tooltip="${escapeHtml(t('revertBtn'))}">${revertSvg}</button>
            </span>
          </div>
        `;
      })
      .join('')
  );
}
