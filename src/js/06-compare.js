// Applies a comparison result (from the worker, the sync fallback or the incremental fast path)
// to the state and the DOM. `opts.changedRowId` marks an incremental single-row update.
// runComparison() itself lives in 06a-compare-async.js.
function applyComparisonResult(request, result, opts = {}) {
  lastComparison = { request, result };
  state.rightAllBlocks = result.allRightBlocks;
  state.filteredHfCount = result.filteredHfCount;

  const { leftBlocks, rightBlocks, leftPages, rightPages } = result;

  document.getElementById('filename-left').textContent = state.leftName || t('noFileLeft');
  document.getElementById('filename-right').textContent = state.rightName || t('noFileRight');

  updateColumnMeta('left', leftBlocks.length, leftPages);
  updateColumnMeta('right', rightBlocks.length, rightPages);

  const bothLoaded = leftBlocks.length > 0 && rightBlocks.length > 0;
  document.body.classList.toggle('has-docs', leftBlocks.length > 0 || rightBlocks.length > 0);
  document.body.classList.toggle('is-comparing', bothLoaded);
  const badgeEditable = document.getElementById('badge-editable');
  if (badgeEditable) {
    badgeEditable.classList.toggle('is-visible', bothLoaded);
  }

  const emptyLaunchpad = document.getElementById('empty-launchpad');

  if (!bothLoaded) {
    cancelPaneRender();
    resetRowLayoutRegistry();
    state.alignedRows = [];
    state.changeRows = [];
    document.getElementById('count-all').textContent = '0';
    document.getElementById('count-ins').textContent = '0';
    document.getElementById('count-del').textContent = '0';
    updateMobileBarState();
    updateUndoRedoButtons();

    if (leftBlocks.length === 0) {
      setSafeContainerHtml(sheetLeft, renderGhostSheet());
    } else {
      setSafeContainerHtml(
        sheetLeft,
        `<div class="doc-page-card"><div class="doc-page-body">${leftBlocks
          .map(
            b =>
              `<div class="diff-row-anchor" data-type="equal"><div class="clause state-equal ${getClauseTypeClasses(
                b
              )}">${escapeAndHighlightText(b.text, state.searchQuery)}</div></div>`
          )
          .join('')}</div></div>`
      );
    }

    if (rightBlocks.length === 0) {
      setSafeContainerHtml(sheetRight, renderGhostSheet());
    } else {
      setSafeContainerHtml(
        sheetRight,
        `<div class="doc-page-card"><div class="doc-page-body">${rightBlocks
          .map(
            b =>
              `<div class="diff-row-anchor" data-type="equal"><div class="clause state-equal ${getClauseTypeClasses(
                b
              )}">${escapeAndHighlightText(b.text, state.searchQuery)}</div></div>`
          )
          .join('')}</div></div>`
      );
    }

    setSafeContainerHtml(sheetUnified, renderGhostSheet());
    if (emptyLaunchpad) {
      setSafeContainerHtml(emptyLaunchpad, renderLaunchpadHtml(leftBlocks.length, rightBlocks.length));
    }

    bindEmptyStateButtons();
    renderSidebarList(bothLoaded);
    minimapTrack.innerHTML = '';
    connectorSvg.innerHTML = '';
    return;
  }

  if (emptyLaunchpad) {
    emptyLaunchpad.innerHTML = '';
  }

  state.alignedRows = result.alignedRows;
  state.changeRows = state.alignedRows.filter(r => r.type !== 'equal');

  const modCount = state.alignedRows.filter(r => r.type === 'modified').length;
  const insCount = state.alignedRows.filter(r => r.type === 'inserted').length;
  const delCount = state.alignedRows.filter(r => r.type === 'deleted').length;

  document.getElementById('count-all').textContent = String(modCount + insCount + delCount);
  document.getElementById('count-ins').textContent = String(insCount + modCount);
  document.getElementById('count-del').textContent = String(delCount + modCount);

  // Edits, reverts, undo and redo usually change a single row: patch it in place instead of
  // re-rendering all three panes. Clauses of the active row get `is-active` while rendering.
  if (!(opts.changedRowId !== undefined && patchRenderedRow(opts.changedRowId))) {
    renderDocumentPanes();
  }
  renderSidebarList(true);
  renderMinimap();
  updateMobileBarState();
  updateUndoRedoButtons();

  if (state.activeRowId) {
    const tick = minimapTrack.querySelector(`.minimap-tick[data-row-id="${state.activeRowId}"]`);
    if (tick) tick.classList.add('is-active');
  }

  scheduleGutterDraw();
}

function bindEmptyStateButtons() {
  document.querySelectorAll('#btn-empty-upload-left').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      document.getElementById('file-input-left').click();
    });
  });
  document.querySelectorAll('#btn-empty-upload-right').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      document.getElementById('file-input-right').click();
    });
  });

  const slotLeft = document.getElementById('lp-slot-left');
  const slotRight = document.getElementById('lp-slot-right');
  [
    { el: slotLeft, side: 'left', inputId: 'file-input-left' },
    { el: slotRight, side: 'right', inputId: 'file-input-right' },
  ].forEach(({ el, side, inputId }) => {
    if (!el) return;
    el.addEventListener('click', () => document.getElementById(inputId).click());
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
    btn.addEventListener('click', () => {
      const sample = SAMPLES[state.lang] || SAMPLES.de;
      state.leftName = t('sampleLeftName');
      state.leftFormat = 'DEMO';
      state.leftText = sample.v1;
      state.rightName = t('sampleRightName');
      state.rightFormat = 'DEMO';
      state.rightText = sample.v2;
      runComparison();
    });
  });
}

// Rendered for every clause of the right and unified panes, so it is kept lean: icons are CSS
// masks (`.icon-edit` etc. in styles.css) instead of inline SVG (~12k fewer DOM nodes for an
// 80-page contract).
function renderRightActionsHtml(row) {
  const editLabel = row.rightBlock ? t('editBtn') : t('editInsertBtn');
  const editIcon = row.rightBlock ? 'icon-edit' : 'icon-insert';
  const editBtn = `<button type="button" class="clause-action-btn ${editIcon}" data-edit-row="${row.id}">${escapeHtml(editLabel)}</button>`;
  const revertBtn =
    row.type !== 'equal'
      ? `<button type="button" class="clause-action-btn is-revert icon-revert" data-revert-row="${row.id}">${escapeHtml(t('revertBtn'))}</button>`
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
    changeCount > 0 ? `${changeCount} ${escapeHtml(t('changesLabel'))}` : escapeHtml(t('pageUnchanged'));

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

function getRowStateClass(row, side) {
  if (row.type === 'equal') return 'state-equal';
  if (row.type === 'modified') return 'state-modified';
  if (side === 'left') return 'state-deleted';
  if (side === 'right') return 'state-inserted';
  return row.type === 'inserted' ? 'state-inserted' : 'state-deleted';
}

// HTML of one aligned row in the three panes (left, right, unified). Kept free of
// indentation whitespace: every whitespace text node is a DOM node to parse and lay out.
function renderRowAnchorsHtml(row, idx, q) {
  const deferClass = idx > 18 ? ' deferred-block' : '';
  const activeClass = row.id === state.activeRowId ? ' is-active' : '';
  const extra = deferClass + activeClass;
  const rightActionsHtml = renderRightActionsHtml(row);
  const anchorOpen = `<div class="diff-row-anchor" data-row-id="${row.id}" data-type="${row.type}">`;

  const left = row.leftBlock
    ? `${anchorOpen}<div class="clause ${getRowStateClass(row, 'left')} ${getClauseTypeClasses(row.leftBlock)}${extra}" data-row-id="${row.id}">${renderLeftBlockHtml(row, q)}</div></div>`
    : `${anchorOpen}<div class="clause state-placeholder${extra}" data-row-id="${row.id}"></div></div>`;

  const right = row.rightBlock
    ? `${anchorOpen}<div class="clause ${getRowStateClass(row, 'right')} ${getClauseTypeClasses(row.rightBlock)}${extra}" data-row-id="${row.id}">${renderRightBlockHtml(row, q)}${rightActionsHtml}</div></div>`
    : `${anchorOpen}<div class="clause state-placeholder${extra}" data-row-id="${row.id}">${rightActionsHtml}</div></div>`;

  const primaryBlock = row.rightBlock || row.leftBlock;
  const unified = `${anchorOpen}<div class="clause ${getRowStateClass(row, 'unified')} ${getClauseTypeClasses(primaryBlock)}${extra}" data-row-id="${row.id}">${renderUnifiedBlockHtml(row, q, true)}${rightActionsHtml}</div></div>`;

  return { left, right, unified };
}

// Pane rendering is chunked: the first pages are rendered synchronously, the rest in short
// background tasks so that no single task blocks the main thread for long (an 80-page contract
// produces ~50k DOM nodes). flushPaneRender() completes a pending render on demand.
let paneRenderJob = null;
const PANE_RENDER_FIRST_PAGES = 6;
const PANE_RENDER_CHUNK_MS = 14;

function renderDocumentPanes() {
  cancelPaneRender();
  resetRowLayoutRegistry();

  const pageGroups = new Map();
  state.alignedRows.forEach((row, idx) => {
    const p = row.pageNum || 1;
    if (!pageGroups.has(p)) pageGroups.set(p, []);
    pageGroups.get(p).push({ row, idx });
  });

  setSafeContainerHtml(sheetLeft, '');
  setSafeContainerHtml(sheetRight, '');
  setSafeContainerHtml(sheetUnified, '');

  const job = {
    pages: Array.from(pageGroups.entries()),
    totalPages: pageGroups.size || 1,
    next: 0,
    timer: null,
  };
  paneRenderJob = job;
  renderPaneChunk(job, PANE_RENDER_FIRST_PAGES, 0);
  schedulePaneRenderChunk(job);
}

function renderPageCardsHtml(pageNum, entries, totalPages, q) {
  const pageHeaderHtml = renderPageCardHeaderHtml(pageNum, totalPages, entries.map(e => e.row));
  const leftRows = [];
  const rightRows = [];
  const unifiedRows = [];
  for (const { row, idx } of entries) {
    const html = renderRowAnchorsHtml(row, idx, q);
    leftRows.push(html.left);
    rightRows.push(html.right);
    unifiedRows.push(html.unified);
  }
  const card = rowsHtml =>
    `<section class="doc-page-card" data-page="${pageNum}">${pageHeaderHtml}<div class="doc-page-body">${rowsHtml.join('')}</div></section>`;
  return { left: card(leftRows), right: card(rightRows), unified: card(unifiedRows) };
}

function renderPaneChunk(job, minPages, budgetMs) {
  if (job !== paneRenderJob || job.next >= job.pages.length) return;
  const t0 = performance.now();
  const q = state.searchQuery;
  const left = [];
  const right = [];
  const unified = [];
  let count = 0;
  while (
    job.next < job.pages.length &&
    (count < minPages || performance.now() - t0 < budgetMs)
  ) {
    const [pageNum, entries] = job.pages[job.next++];
    const html = renderPageCardsHtml(pageNum, entries, job.totalPages, q);
    left.push(html.left);
    right.push(html.right);
    unified.push(html.unified);
    count++;
  }
  const firstNewCard = sheetLeft.children.length;
  sheetLeft.insertAdjacentHTML('beforeend', left.join(''));
  sheetRight.insertAdjacentHTML('beforeend', right.join(''));
  sheetUnified.insertAdjacentHTML('beforeend', unified.join(''));
  registerRenderedCards(firstNewCard);
  if (job.next >= job.pages.length) paneRenderJob = null;
}

function schedulePaneRenderChunk(job) {
  if (job !== paneRenderJob) return;
  job.timer = setTimeout(() => {
    job.timer = null;
    renderPaneChunk(job, 1, PANE_RENDER_CHUNK_MS);
    if (paneRenderJob === job) schedulePaneRenderChunk(job);
    else scheduleGutterDraw();
  }, 0);
}

function flushPaneRender() {
  const job = paneRenderJob;
  if (!job) return;
  clearTimeout(job.timer);
  renderPaneChunk(job, Infinity, Infinity);
}

function cancelPaneRender() {
  if (paneRenderJob) clearTimeout(paneRenderJob.timer);
  paneRenderJob = null;
}

// Re-renders one row in all three panes (search highlights, edits). Returns false if the row
// is not in the DOM yet.
function rerenderRowInPlace(row) {
  const els = getRowElements(row.id);
  if (!els.l || !els.r || !els.u) return false;
  const html = renderRowAnchorsHtml(row, row.rowNumber - 1, state.searchQuery);
  const replaceAnchor = (clauseEl, anchorHtml) => {
    const tpl = document.createElement('template');
    tpl.innerHTML = anchorHtml;
    const anchor = tpl.content.firstElementChild;
    clauseEl.parentElement.replaceWith(anchor);
    return anchor.firstElementChild;
  };
  const l = replaceAnchor(els.l, html.left);
  const r = replaceAnchor(els.r, html.right);
  const u = replaceAnchor(els.u, html.unified);
  registerRowElements(row.id, l, r, u);
  return true;
}

// Incremental update after an edit / revert / undo that changed a single row (same row ids).
function patchRenderedRow(changedRowId) {
  flushPaneRender();
  if (changedRowId === null) return true;
  const row = state.alignedRows.find(r => r.id === changedRowId);
  if (!row || !rerenderRowInPlace(row)) return false;

  const pageRows = state.alignedRows.filter(r => (r.pageNum || 1) === (row.pageNum || 1));
  const totalPages = sheetLeft.children.length || 1;
  const headerHtml = renderPageCardHeaderHtml(row.pageNum || 1, totalPages, pageRows);
  const els = getRowElements(row.id);
  for (const el of [els.l, els.r, els.u]) {
    const header = el.closest('.doc-page-card')?.querySelector(':scope > .doc-page-header');
    if (!header) continue;
    const tpl = document.createElement('template');
    tpl.innerHTML = headerHtml.trim();
    header.replaceWith(tpl.content.firstElementChild);
  }
  return true;
}

// Rows are kept height-aligned between the left and right panes by a ResizeObserver that also
// notices width changes (see 06b-row-layout.js), so there is nothing left to do here. Kept for
// existing callers (resize, sidebar toggle, view mode switch).
function equalizeRowHeights() {}

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
    return `<div class="nav-item-snippet"><del class="tok-del">${escapeAndHighlightText(
      truncateClean(row.leftBlock.text, 92),
      query
    )}</del></div>`;
  }
  if (row.type === 'inserted') {
    return `<div class="nav-item-snippet"><ins class="tok-ins">${escapeAndHighlightText(
      truncateClean(row.rightBlock.text, 92),
      query
    )}</ins></div>`;
  }
  const pairs = extractDeltaPairs(row.wordDiffs || []);
  if (pairs.length === 0) {
    return `<div class="nav-item-snippet">${renderUnifiedBlockHtml(row, query)}</div>`;
  }
  const maxPairs = 3;
  const visible = pairs.slice(0, maxPairs);
  const rowsHtml = visible
    .map(pair => {
      if (pair.del && pair.ins) {
        return `<div class="nav-delta-row"><del class="tok-del">${escapeAndHighlightText(
          truncateClean(pair.del, 34),
          query
        )}</del><span class="nav-delta-arrow" aria-hidden="true">→</span><ins class="tok-ins">${escapeAndHighlightText(
          truncateClean(pair.ins, 34),
          query
        )}</ins></div>`;
      }
      if (pair.ins) {
        return `<div class="nav-delta-row"><ins class="tok-ins">+ ${escapeAndHighlightText(
          truncateClean(pair.ins, 46),
          query
        )}</ins></div>`;
      }
      return `<div class="nav-delta-row"><del class="tok-del">− ${escapeAndHighlightText(
        truncateClean(pair.del, 46),
        query
      )}</del></div>`;
    })
    .join('');
  const moreHtml =
    pairs.length > maxPairs
      ? `<div class="nav-delta-more">+${pairs.length - maxPairs} ${escapeHtml(t('moreDeltas'))}</div>`
      : '';
  return `<div class="nav-item-deltas">${rowsHtml}${moreHtml}</div>`;
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

  const modCount = state.changeRows.filter(r => r.type === 'modified').length;
  const insCount = state.changeRows.filter(r => r.type === 'inserted').length;
  const delCount = state.changeRows.filter(r => r.type === 'deleted').length;

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
    btn.setAttribute('aria-selected', String(isActive));
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

  const editSvg = '<svg class="icon" style="width:11px;height:11px;" viewBox="0 0 24 24"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
  const revertSvg = '<svg class="icon" style="width:11px;height:11px;" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';

  setSafeContainerHtml(
    sidebarList,
    filtered
      .map(row => {
        const globalIdx = state.changeRows.indexOf(row) + 1;
        const cls = row.type === 'modified' ? 'mod' : row.type === 'inserted' ? 'ins' : 'del';
        const isActive = row.id === state.activeRowId;
        const typeLabel =
          row.type === 'modified' ? t('typeMod') : row.type === 'inserted' ? t('typeIns') : t('typeDel');
        const refCode = row.rightBlock ? row.rightBlock.refCode : row.leftBlock.refCode;
        const pageNum = row.pageNum || 1;
        const deltaHtml = renderSidebarDeltaHtml(row, state.searchQuery);

        return `
          <div class="nav-item ${cls}${isActive ? ' is-active' : ''}" data-row-id="${row.id}" tabindex="0" role="button">
            <div class="nav-item-head">
              <div class="nav-item-loc">
                <span class="nav-item-idx">${globalIdx}</span>
                <span class="nav-item-page">${escapeHtml(t('pageShort'))} ${pageNum}</span>
                <span class="nav-item-ref">${escapeHtml(refCode)}</span>
              </div>
              <div class="nav-item-right">
                <div class="nav-item-actions">
                  <button type="button" class="nav-item-act-btn" data-edit-row="${row.id}" aria-label="${escapeHtml(t('editBtn'))}">${editSvg}</button>
                  <button type="button" class="nav-item-act-btn is-revert" data-revert-row="${row.id}" aria-label="${escapeHtml(t('revertBtn'))}">${revertSvg}</button>
                </div>
                <span class="nav-item-badge ${cls}">${escapeHtml(typeLabel)}</span>
              </div>
            </div>
            ${deltaHtml}
          </div>
        `;
      })
      .join('')
  );
}
