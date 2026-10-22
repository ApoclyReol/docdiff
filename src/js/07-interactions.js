function renderMinimap() {
  const totalRows = state.alignedRows.length || 1;
  setSafeContainerHtml(
    minimapTrack,
    state.changeRows
      .map(row => {
        const pct = ((row.rowNumber - 1) / totalRows) * 100;
        const cls = row.type === 'modified' ? 'mod' : row.type === 'inserted' ? 'ins' : 'del';
        return `<div class="minimap-tick ${cls}" style="top: ${pct}%" data-row-id="${row.id}"></div>`;
      })
      .join('')
  );
}

let gutterRafPending = false;
function scheduleGutterDraw() {
  if (gutterRafPending) return;
  gutterRafPending = true;
  requestAnimationFrame(() => {
    gutterRafPending = false;
    drawGutterConnectors();
  });
}

function drawGutterConnectors() {
  if (state.viewMode === 'inline') {
    connectorSvg.innerHTML = '';
    return;
  }
  const gutterRect = connectorSvg.getBoundingClientRect();
  if (!gutterRect.width || !gutterRect.height) return;

  const targetIds = new Set([state.hoveredRowId, state.activeRowId].filter(Boolean));
  if (targetIds.size === 0) {
    connectorSvg.innerHTML = '';
    return;
  }

  const paths = [];
  const w = gutterRect.width;

  targetIds.forEach(rowId => {
    const leftEl = sheetLeft.querySelector(`.clause[data-row-id="${rowId}"]`);
    const rightEl = sheetRight.querySelector(`.clause[data-row-id="${rowId}"]`);
    if (!leftEl || !rightEl) return;

    const lRect = leftEl.getBoundingClientRect();
    const rRect = rightEl.getBoundingClientRect();

    const yLeft = lRect.top + lRect.height / 2 - gutterRect.top;
    const yRight = rRect.top + rRect.height / 2 - gutterRect.top;

    const d = `M 0 ${yLeft} C ${w * 0.45} ${yLeft}, ${w * 0.55} ${yRight}, ${w} ${yRight}`;
    paths.push(`<path d="${d}" fill="none" stroke="hsl(var(--ring))" stroke-width="1.5" />`);
  });

  connectorSvg.innerHTML = paths.join('');
}

function setHoveredRow(rowId) {
  if (state.hoveredRowId === rowId) return;
  state.hoveredRowId = rowId;

  document.querySelectorAll('.clause.is-hovered, .nav-item.is-hovered').forEach(el => {
    el.classList.remove('is-hovered');
  });

  if (rowId) {
    document.querySelectorAll(`[data-row-id="${rowId}"]`).forEach(el => {
      if (el.classList.contains('clause') || el.classList.contains('nav-item')) {
        el.classList.add('is-hovered');
      }
    });
  }
  scheduleGutterDraw();
}

let programmaticScrollTimer = null;

function selectAndScrollToRow(rowId, smooth = true, scrollPanes = true) {
  state.activeRowId = rowId;
  document
    .querySelectorAll('.clause.is-active, .clause.is-jump-flash, .nav-item.is-active, .minimap-tick.is-active')
    .forEach(el => {
      el.classList.remove('is-active', 'is-jump-flash');
    });

  updateMobileBarState();
  updateSidebarHeaderState();
  if (!rowId) return;

  document.querySelectorAll(`[data-row-id="${rowId}"]`).forEach(el => {
    if (
      el.classList.contains('clause') ||
      el.classList.contains('nav-item') ||
      el.classList.contains('minimap-tick')
    ) {
      el.classList.add('is-active');
      if (scrollPanes && el.classList.contains('clause')) {
        el.classList.add('is-jump-flash');
      }
    }
  });

  const leftTarget = sheetLeft.querySelector(`.clause[data-row-id="${rowId}"]`);
  const rightTarget = sheetRight.querySelector(`.clause[data-row-id="${rowId}"]`);
  const unifiedTarget = sheetUnified.querySelector(`.clause[data-row-id="${rowId}"]`);
  const navTarget = sidebarList.querySelector(`.nav-item[data-row-id="${rowId}"]`);

  if (scrollPanes) {
    // Materialize deferred blocks so exact heights are measured before jumping
    document.querySelectorAll('.clause.deferred-block').forEach(el => {
      el.classList.remove('deferred-block');
    });
    if (state.viewMode !== 'inline') {
      equalizeRowHeights();
    }

    state.isProgrammaticScroll = true;
    clearTimeout(programmaticScrollTimer);

    const getScrollTargetTop = (pane, targetEl) => {
      const paneRect = pane.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();
      const offsetInContent = pane.scrollTop + (targetRect.top - paneRect.top);
      const leadSpace = Math.max(24, Math.min(130, Math.round(pane.clientHeight * 0.22)));
      return Math.max(0, Math.round(offsetInContent - leadSpace));
    };

    if (state.viewMode === 'inline' && unifiedTarget) {
      const topOffset = getScrollTargetTop(paneUnified, unifiedTarget);
      paneUnified.scrollTo({ top: topOffset, behavior: smooth ? 'smooth' : 'auto' });
    } else {
      if (leftTarget) {
        const topOffset = getScrollTargetTop(paneLeft, leftTarget);
        paneLeft.scrollTo({ top: topOffset, behavior: smooth ? 'smooth' : 'auto' });
      }
      if (rightTarget) {
        const topOffset = getScrollTargetTop(paneRight, rightTarget);
        paneRight.scrollTo({ top: topOffset, behavior: smooth ? 'smooth' : 'auto' });
      }
    }

    programmaticScrollTimer = setTimeout(
      () => {
        state.isProgrammaticScroll = false;
        scheduleGutterDraw();
      },
      smooth ? 480 : 50
    );
  } else {
    scheduleGutterDraw();
  }

  if (navTarget) {
    navTarget.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
  }
}

function updateUndoRedoButtons() {
  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');
  if (btnUndo) btnUndo.disabled = state.undoStack.length === 0;
  if (btnRedo) btnRedo.disabled = state.redoStack.length === 0;
}

function pushUndoSnapshot() {
  state.undoStack.push(state.rightText);
  if (state.undoStack.length > 50) state.undoStack.shift();
  state.redoStack = [];
  updateUndoRedoButtons();
}

function performUndo() {
  if (!state.undoStack.length) return;
  state.redoStack.push(state.rightText);
  state.rightText = state.undoStack.pop();
  runComparison();
}

function performRedo() {
  if (!state.redoStack.length) return;
  state.undoStack.push(state.rightText);
  state.rightText = state.redoStack.pop();
  runComparison();
}

function rebuildRightTextFromRows(targetRowId, replacementText) {
  const hasExplicit = state.rightAllBlocks && state.rightAllBlocks.some(b => b.hasExplicitPage);
  const hfByPage = new Map();
  if (state.ignoreHeadersFooters && state.rightAllBlocks) {
    for (const b of state.rightAllBlocks) {
      if (b.isHeaderFooter) {
        const p = b.pageNum || 1;
        if (!hfByPage.has(p)) hfByPage.set(p, []);
        hfByPage.get(p).push(`[[HF]] ${b.text}`);
      }
    }
  }

  const pagesMap = new Map();
  for (const r of state.alignedRows) {
    const p = r.pageNum || 1;
    if (!pagesMap.has(p)) pagesMap.set(p, []);
    if (r.id === targetRowId) {
      if (replacementText) pagesMap.get(p).push(replacementText);
    } else if (r.rightBlock) {
      const prefix = r.rightBlock.isHeaderFooter ? '[[HF]] ' : '';
      pagesMap.get(p).push(`${prefix}${r.rightBlock.text}`);
    }
  }

  const outLines = [];
  for (const [pageNum, contentLines] of pagesMap.entries()) {
    if (hasExplicit) {
      outLines.push(`=== [SEITE ${pageNum}] ===`);
    }
    const hfs = hfByPage.get(pageNum) || [];
    if (hfs.length > 0) outLines.push(hfs[0]);
    for (const line of contentLines) outLines.push(line);
    if (hfs.length > 1) {
      for (let k = 1; k < hfs.length; k++) outLines.push(hfs[k]);
    }
  }
  return outLines.join('\n\n');
}

function revertRowToOriginal(targetRowId) {
  if (!state.alignedRows.length) return;
  const targetRow = state.alignedRows.find(r => r.id === targetRowId);
  if (!targetRow) return;
  pushUndoSnapshot();
  const revertedText = targetRow.leftBlock ? targetRow.leftBlock.text : '';
  state.rightText = rebuildRightTextFromRows(targetRowId, revertedText);
  runComparison();
}

function startInlineClauseEdit(clauseEl, rowId) {
  if (!clauseEl || clauseEl.classList.contains('is-editing')) return;
  const row = state.alignedRows.find(r => r.id === rowId);
  if (!row) return;

  hideTooltip();

  const initialText = row.rightBlock
    ? row.rightBlock.text
    : row.leftBlock
    ? row.leftBlock.text
    : '';
  const originalHtml = clauseEl.innerHTML;

  clauseEl.classList.add('is-editing');
  const editor = document.createElement('textarea');
  editor.className = 'clause-inline-editor';
  editor.value = initialText;

  const helperBar = document.createElement('div');
  helperBar.className = 'clause-editor-bar';
  helperBar.innerHTML = `
    <span>${escapeHtml(t('editorHintText'))}</span>
    <div class="clause-editor-btns">
      <button type="button" class="clause-editor-btn cancel" data-editor-cancel>${escapeHtml(t('editorCancel'))}</button>
      <button type="button" class="clause-editor-btn save" data-editor-save>${escapeHtml(t('editorSave'))}</button>
    </div>
  `;

  clauseEl.innerHTML = '';
  clauseEl.appendChild(editor);
  clauseEl.appendChild(helperBar);

  const autoSize = () => {
    editor.style.height = 'auto';
    editor.style.height = `${Math.max(32, editor.scrollHeight)}px`;
    if (state.viewMode !== 'inline') equalizeRowHeights();
    scheduleGutterDraw();
  };
  autoSize();
  editor.addEventListener('input', autoSize);
  editor.focus();
  editor.setSelectionRange(editor.value.length, editor.value.length);

  let finished = false;
  const commit = () => {
    if (finished) return;
    finished = true;
    const newText = editor.value.replace(/\r\n/g, '\n').trim();
    const oldText = row.rightBlock ? row.rightBlock.text : '';
    if (newText === oldText) {
      clauseEl.classList.remove('is-editing');
      clauseEl.innerHTML = originalHtml;
      if (state.viewMode !== 'inline') equalizeRowHeights();
      scheduleGutterDraw();
      return;
    }
    pushUndoSnapshot();
    state.rightText = rebuildRightTextFromRows(rowId, newText);
    runComparison();
  };

  const cancel = () => {
    if (finished) return;
    finished = true;
    clauseEl.classList.remove('is-editing');
    clauseEl.innerHTML = originalHtml;
    if (state.viewMode !== 'inline') equalizeRowHeights();
    scheduleGutterDraw();
  };

  helperBar.querySelector('[data-editor-cancel]').addEventListener('mousedown', ev => {
    ev.preventDefault();
    ev.stopPropagation();
    cancel();
  });
  helperBar.querySelector('[data-editor-save]').addEventListener('mousedown', ev => {
    ev.preventDefault();
    ev.stopPropagation();
    commit();
  });

  editor.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      cancel();
    } else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey || !ev.shiftKey)) {
      ev.preventDefault();
      ev.stopPropagation();
      commit();
    }
  });
  editor.addEventListener('blur', () => {
    commit();
  });
}

function closeMobileSheets() {
  document.body.classList.remove('mobile-sheet-open');
  exportMenu.classList.remove('is-open');
  btnExportMenu.setAttribute('aria-expanded', 'false');
  const mobExpBtn = document.getElementById('mob-btn-export');
  if (mobExpBtn) mobExpBtn.setAttribute('aria-expanded', 'false');
  if (window.innerWidth <= 960) {
    document.body.classList.add('sidebar-collapsed');
    document.getElementById('btn-toggle-sidebar').setAttribute('aria-pressed', 'false');
    const mobChangesBtn = document.getElementById('mob-btn-changes');
    if (mobChangesBtn) mobChangesBtn.setAttribute('aria-pressed', 'false');
  }
}

[sheetLeft, sheetRight, sheetUnified, sidebarList].forEach(container => {
  container.addEventListener('mouseover', e => {
    const target = e.target.closest('[data-row-id]');
    if (target) setHoveredRow(target.getAttribute('data-row-id'));
  });
  container.addEventListener('mouseleave', () => setHoveredRow(null));
  container.addEventListener('click', e => {
    const editBtn = e.target.closest('[data-edit-row]');
    if (editBtn) {
      e.stopPropagation();
      const rowId = editBtn.getAttribute('data-edit-row');
      if (container === sidebarList) {
        selectAndScrollToRow(rowId, false, true);
        if (window.innerWidth <= 960) closeMobileSheets();
      }
      const activeSheet = state.viewMode === 'inline' ? sheetUnified : sheetRight;
      const hostClause =
        editBtn.closest('.clause[data-row-id]') ||
        activeSheet.querySelector(`.clause[data-row-id="${rowId}"]`);
      if (hostClause) startInlineClauseEdit(hostClause, rowId);
      return;
    }
    const revertBtn = e.target.closest('[data-revert-row]');
    if (revertBtn) {
      e.stopPropagation();
      hideTooltip();
      revertRowToOriginal(revertBtn.getAttribute('data-revert-row'));
      return;
    }
    if (e.target.closest('.clause-inline-editor') || e.target.closest('.clause-editor-bar')) return;
    const target = e.target.closest('[data-row-id]');
    if (target) {
      const fromSidebar = container === sidebarList;
      selectAndScrollToRow(target.getAttribute('data-row-id'), true, fromSidebar);
      if (window.innerWidth <= 960 && fromSidebar) {
        closeMobileSheets();
      }
    }
  });
});

sidebarList.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') {
    const navItem = e.target.closest('.nav-item[data-row-id]');
    if (navItem && !e.target.closest('button')) {
      e.preventDefault();
      selectAndScrollToRow(navItem.getAttribute('data-row-id'), true, true);
      if (window.innerWidth <= 960) closeMobileSheets();
    }
  }
});

const sidebarFilterBar = document.getElementById('sidebar-filter-bar');
if (sidebarFilterBar) {
  sidebarFilterBar.addEventListener('click', e => {
    const btn = e.target.closest('[data-sidebar-filter]');
    if (!btn) return;
    const nextFilter = btn.getAttribute('data-sidebar-filter');
    state.sidebarFilter =
      state.sidebarFilter === nextFilter && nextFilter !== 'all' ? 'all' : nextFilter;
    renderSidebarList(state.alignedRows.length > 0);
  });
}

document.getElementById('btn-undo').addEventListener('click', () => performUndo());
document.getElementById('btn-redo').addEventListener('click', () => performRedo());

// Editing in the Right ("Nachher / Neuer Stand") pane and Unified ("Kompakt") pane
[sheetRight, sheetUnified].forEach(editableSheet => {
  editableSheet.addEventListener('dblclick', e => {
    if (
      e.target.closest('[data-revert-row]') ||
      e.target.closest('[data-edit-row]') ||
      e.target.closest('.clause-inline-editor') ||
      e.target.closest('.clause-editor-bar')
    ) {
      return;
    }
    const clauseEl = e.target.closest('.clause[data-row-id]');
    if (clauseEl) {
      startInlineClauseEdit(clauseEl, clauseEl.getAttribute('data-row-id'));
    }
  });
});

minimapTrack.addEventListener('click', e => {
  const tick = e.target.closest('[data-row-id]');
  if (tick) selectAndScrollToRow(tick.getAttribute('data-row-id'), true);
});

function handlePaneScroll(sourcePane, targetPane) {
  if (Math.abs(targetPane.scrollTop - sourcePane.scrollTop) > 0.5) {
    targetPane.scrollTop = sourcePane.scrollTop;
  }
  scheduleGutterDraw();
}

paneLeft.addEventListener('scroll', () => handlePaneScroll(paneLeft, paneRight), { passive: true });
paneRight.addEventListener('scroll', () => handlePaneScroll(paneRight, paneLeft), { passive: true });
document.getElementById('center-gutter').addEventListener(
  'wheel',
  e => {
    if (state.viewMode === 'inline') return;
    paneRight.scrollTop += e.deltaY;
    paneLeft.scrollTop = paneRight.scrollTop;
    scheduleGutterDraw();
  },
  { passive: true }
);

function attachScrollEnd(scroller, callback) {
  if ('onscrollend' in window) {
    scroller.addEventListener('scrollend', callback, { passive: true });
  } else {
    let timer = null;
    scroller.addEventListener('scroll', () => {
      clearTimeout(timer);
      timer = setTimeout(callback, 100);
    }, { passive: true });
  }
}

attachScrollEnd(paneLeft, () => scheduleGutterDraw());
attachScrollEnd(paneRight, () => scheduleGutterDraw());

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    equalizeRowHeights();
    scheduleGutterDraw();
  }, 60);
});
