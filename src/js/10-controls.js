function stepChange(direction) {
  const pool = getFilteredChangeRows();
  const rows = pool.length > 0 ? pool : state.changeRows;
  if (!rows.length) return;
  const curIdx = rows.findIndex(r => r.id === state.activeRowId);
  let nextIdx = 0;
  if (curIdx === -1) {
    nextIdx = direction > 0 ? 0 : rows.length - 1;
  } else {
    nextIdx = (curIdx + direction + rows.length) % rows.length;
  }
  selectAndScrollToRow(rows[nextIdx].id, true, true);
}

document.getElementById('btn-prev').addEventListener('click', () => stepChange(-1));
document.getElementById('btn-next').addEventListener('click', () => stepChange(1));
document.getElementById('dock-step-count').addEventListener('click', () => {
  if (state.activeRowId) {
    selectAndScrollToRow(state.activeRowId, true, true);
  } else {
    stepChange(1);
  }
});
document.getElementById('mob-btn-prev').addEventListener('click', () => stepChange(-1));
document.getElementById('mob-btn-next').addEventListener('click', () => stepChange(1));

const btnModePages = document.getElementById('btn-mode-pages');
if (btnModePages) btnModePages.addEventListener('click', () => setViewMode('pages'));
document.getElementById('btn-mode-split').addEventListener('click', () => setViewMode('split'));
document.getElementById('btn-mode-inline').addEventListener('click', () => setViewMode('inline'));

const btnFilterHf = document.getElementById('btn-filter-hf');
if (btnFilterHf) {
  btnFilterHf.addEventListener('click', () => {
    state.ignoreHeadersFooters = !state.ignoreHeadersFooters;
    btnFilterHf.setAttribute('aria-pressed', String(state.ignoreHeadersFooters));
    runComparison();
  });
}

const btnExportMenu = document.getElementById('btn-export-menu');
const mobBtnExport = document.getElementById('mob-btn-export');
const exportMenu = document.getElementById('export-menu');
btnExportMenu.addEventListener('click', e => {
  e.stopPropagation();
  const open = exportMenu.classList.toggle('is-open');
  btnExportMenu.setAttribute('aria-expanded', String(open));
});
mobBtnExport.addEventListener('click', e => {
  e.stopPropagation();
  if (!document.body.classList.contains('sidebar-collapsed')) {
    document.body.classList.add('sidebar-collapsed');
    document.getElementById('mob-btn-changes').setAttribute('aria-pressed', 'false');
  }
  const open = exportMenu.classList.toggle('is-open');
  mobBtnExport.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('mobile-sheet-open', open);
});
exportMenu.addEventListener('click', e => {
  const item = e.target.closest('[data-export]');
  if (!item) return;
  closeMobileSheets();
  handleExportAction(item.getAttribute('data-export'));
});
window.addEventListener('click', () => {
  exportMenu.classList.remove('is-open');
  btnExportMenu.setAttribute('aria-expanded', 'false');
  mobBtnExport.setAttribute('aria-expanded', 'false');
  if (document.body.classList.contains('sidebar-collapsed')) {
    document.body.classList.remove('mobile-sheet-open');
  }
});

const searchInput = document.getElementById('search-input');

window.addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    if (e.key === 'Escape') document.activeElement.blur();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
    if (state.undoStack.length > 0) {
      e.preventDefault();
      performUndo();
    }
    return;
  }
  if (
    ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')) ||
    ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'y' || e.key === 'Y'))
  ) {
    if (state.redoStack.length > 0) {
      e.preventDefault();
      performRedo();
    }
    return;
  }
  if (e.key === 'j' || e.key === 'J') {
    e.preventDefault();
    stepChange(1);
  } else if (e.key === 'k' || e.key === 'K') {
    e.preventDefault();
    stepChange(-1);
  } else if (e.key === '/') {
    e.preventDefault();
    searchInput.focus();
  } else if (e.key === 'c' || e.key === 'C') {
    e.preventDefault();
    document.getElementById('btn-only-changes').click();
  } else if (e.key === 'h' || e.key === 'H') {
    e.preventDefault();
    if (btnFilterHf) btnFilterHf.click();
  } else if (e.key === 'Escape') {
    closeMobileSheets();
  }
});

const btnOnlyChanges = document.getElementById('btn-only-changes');
const mobBtnOnlyChanges = document.getElementById('mob-btn-only-changes');
function toggleOnlyChanges() {
  state.onlyChanges = !state.onlyChanges;
  document.body.classList.toggle('only-changes', state.onlyChanges);
  btnOnlyChanges.setAttribute('aria-pressed', String(state.onlyChanges));
  mobBtnOnlyChanges.setAttribute('aria-pressed', String(state.onlyChanges));
  requestAnimationFrame(() => {
    equalizeRowHeights();
    scheduleGutterDraw();
  });
}
btnOnlyChanges.addEventListener('click', toggleOnlyChanges);
mobBtnOnlyChanges.addEventListener('click', toggleOnlyChanges);

document.getElementById('btn-clear').addEventListener('click', () => {
  state.leftText = '';
  state.rightText = '';
  state.leftName = '';
  state.rightName = '';
  state.leftFormat = '';
  state.rightFormat = '';
  state.activeRowId = null;
  state.hoveredRowId = null;
  state.sidebarFilter = 'all';
  state.searchQuery = '';
  state.undoStack = [];
  state.redoStack = [];
  searchInput.value = '';
  fileInputLeft.value = '';
  fileInputRight.value = '';
  runComparison();
});

document.getElementById('btn-lang').addEventListener('click', () => {
  state.lang = state.lang === 'de' ? 'en' : 'de';
  if (state.leftFormat === 'DEMO' && state.rightFormat === 'DEMO') {
    const sample = SAMPLES[state.lang] || SAMPLES.de;
    state.leftName = t('sampleLeftName');
    state.leftText = sample.v1;
    state.rightName = t('sampleRightName');
    state.rightText = sample.v2;
  }
  applyTranslationsToStaticDom();
  runComparison();
});

function applyTheme() {
  document.documentElement.classList.toggle('dark', state.dark);
  const icon = document.getElementById('theme-icon');
  if (icon) {
    if (state.dark) {
      icon.innerHTML =
        '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>';
    } else {
      icon.innerHTML = '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>';
    }
  }
  scheduleGutterDraw();
}

document.getElementById('btn-theme').addEventListener('click', () => {
  state.themeOverridden = true;
  state.dark = !state.dark;
  applyTheme();
});

if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (!state.themeOverridden) {
      state.dark = e.matches;
      applyTheme();
    }
  });
}

const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
const mobBtnChanges = document.getElementById('mob-btn-changes');
btnToggleSidebar.addEventListener('click', () => {
  const collapsed = document.body.classList.toggle('sidebar-collapsed');
  btnToggleSidebar.setAttribute('aria-pressed', String(!collapsed));
  mobBtnChanges.setAttribute('aria-pressed', String(!collapsed));
  requestAnimationFrame(() => {
    equalizeRowHeights();
    scheduleGutterDraw();
  });
});

mobBtnChanges.addEventListener('click', e => {
  e.stopPropagation();
  exportMenu.classList.remove('is-open');
  mobBtnExport.setAttribute('aria-expanded', 'false');
  const collapsed = document.body.classList.toggle('sidebar-collapsed');
  const isOpen = !collapsed;
  btnToggleSidebar.setAttribute('aria-pressed', String(isOpen));
  mobBtnChanges.setAttribute('aria-pressed', String(isOpen));
  document.body.classList.toggle('mobile-sheet-open', isOpen);
});

document.getElementById('btn-close-sidebar-sheet').addEventListener('click', closeMobileSheets);
document.getElementById('mobile-sheet-backdrop').addEventListener('click', closeMobileSheets);

document.getElementById('btn-swap-docs').addEventListener('click', () => {
  [state.leftText, state.rightText] = [state.rightText, state.leftText];
  [state.leftName, state.rightName] = [state.rightName, state.leftName];
  [state.leftFormat, state.rightFormat] = [state.rightFormat, state.leftFormat];
  runComparison();
});

searchInput.addEventListener('input', e => {
  state.searchQuery = e.target.value;
  if (state.alignedRows.length > 0) {
    renderDocumentPanes();
    renderSidebarList(true);
    requestAnimationFrame(() => {
      equalizeRowHeights();
      scheduleGutterDraw();
    });
  } else {
    runComparison();
  }
});

const pasteModal = document.getElementById('paste-modal');
const textareaLeft = document.getElementById('textarea-left');
const textareaRight = document.getElementById('textarea-right');

function openPasteModal() {
  textareaLeft.value = state.leftText;
  textareaRight.value = state.rightText;
  pasteModal.showModal();
}

document.getElementById('btn-paste-modal').addEventListener('click', openPasteModal);
document.getElementById('btn-close-modal').addEventListener('click', () => pasteModal.close());
document.getElementById('btn-cancel-modal').addEventListener('click', () => pasteModal.close());
document.getElementById('btn-apply-modal').addEventListener('click', () => {
  state.leftText = textareaLeft.value;
  state.rightText = textareaRight.value;
  if (state.leftText.trim() && !state.leftName) {
    state.leftName = t('manualLeft');
    state.leftFormat = 'TEXT';
  }
  if (state.rightText.trim() && !state.rightName) {
    state.rightName = t('manualRight');
    state.rightFormat = 'TEXT';
  }
  pasteModal.close();
  runComparison();
});

const helpModal = document.getElementById('help-modal');
document.getElementById('btn-help').addEventListener('click', () => helpModal.showModal());
document.getElementById('btn-close-help').addEventListener('click', () => helpModal.close());
document.getElementById('btn-ok-help').addEventListener('click', () => helpModal.close());
document.getElementById('btn-help-sample').addEventListener('click', () => {
  const sample = SAMPLES[state.lang] || SAMPLES.de;
  state.leftName = t('sampleLeftName');
  state.leftFormat = 'DEMO';
  state.leftText = sample.v1;
  state.rightName = t('sampleRightName');
  state.rightFormat = 'DEMO';
  state.rightText = sample.v2;
  helpModal.close();
  runComparison();
});

document.getElementById('badge-editable').addEventListener('click', () => {
  if (state.viewMode === 'inline') setViewMode('pages');
  const firstRow = state.changeRows[0] || state.alignedRows[0];
  if (firstRow) {
    const clauseEl = sheetRight.querySelector(`.clause[data-row-id="${firstRow.id}"]`);
    if (clauseEl) startInlineClauseEdit(clauseEl, firstRow.id);
  }
});

const privacyModal = document.getElementById('privacy-modal');
document.getElementById('btn-privacy-info').addEventListener('click', () => privacyModal.showModal());
document.getElementById('btn-close-privacy').addEventListener('click', () => privacyModal.close());
document.getElementById('btn-ok-privacy').addEventListener('click', () => privacyModal.close());

if (!('closedBy' in HTMLDialogElement.prototype)) {
  [pasteModal, helpModal, privacyModal].forEach(dlg => {
    dlg.addEventListener('click', event => {
      if (event.target !== dlg) return;
      const rect = dlg.getBoundingClientRect();
      const isDialogContent =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (isDialogContent) return;
      dlg.close();
    });
  });
}

/* ── Instant UI Tooltip Controller ────────────────────────────────────── */
const uiTooltip = document.getElementById('ui-tooltip');
let tooltipTimer = null;
let activeTooltipTarget = null;

function showTooltipFor(target) {
  const text = target && target.getAttribute('data-tooltip');
  if (!text || !uiTooltip) return;
  activeTooltipTarget = target;
  uiTooltip.textContent = text;
  uiTooltip.setAttribute('aria-hidden', 'false');
  uiTooltip.classList.add('is-visible');

  const rect = target.getBoundingClientRect();
  const ttRect = uiTooltip.getBoundingClientRect();
  const scopeEl = target.closest('.col-bar, .doc-pane, .sidebar-panel');
  const minX = scopeEl ? Math.max(8, scopeEl.getBoundingClientRect().left + 6) : 8;
  const maxX = scopeEl
    ? Math.min(window.innerWidth - ttRect.width - 8, scopeEl.getBoundingClientRect().right - ttRect.width - 6)
    : window.innerWidth - ttRect.width - 8;

  const floatingBarEl = target.closest('.floating-action-bar');
  let top = floatingBarEl
    ? floatingBarEl.getBoundingClientRect().top - ttRect.height - 8
    : rect.bottom + 7;
  if (top + ttRect.height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - ttRect.height - 7);
  }
  let left = rect.left + rect.width / 2 - ttRect.width / 2;
  if (maxX >= minX) {
    left = Math.max(minX, Math.min(maxX, left));
  } else {
    left = Math.max(8, Math.min(window.innerWidth - ttRect.width - 8, left));
  }

  uiTooltip.style.top = `${Math.round(top)}px`;
  uiTooltip.style.left = `${Math.round(left)}px`;
}

function hideTooltip() {
  clearTimeout(tooltipTimer);
  activeTooltipTarget = null;
  if (!uiTooltip) return;
  uiTooltip.classList.remove('is-visible');
  uiTooltip.setAttribute('aria-hidden', 'true');
}

document.addEventListener('mouseover', e => {
  const target = e.target.closest('[data-tooltip]');
  if (target === activeTooltipTarget) return;
  clearTimeout(tooltipTimer);
  if (!target) {
    hideTooltip();
    return;
  }
  tooltipTimer = setTimeout(() => showTooltipFor(target), 220);
});

document.addEventListener('focusin', e => {
  const target = e.target.closest('[data-tooltip]');
  if (target) showTooltipFor(target);
});

document.addEventListener('focusout', () => hideTooltip());
document.addEventListener('mousedown', () => hideTooltip());
window.addEventListener('scroll', () => hideTooltip(), { capture: true, passive: true });

window.addEventListener('DOMContentLoaded', () => {
  if (isTabletOrSmaller) {
    document.body.classList.add('sidebar-collapsed');
    btnToggleSidebar.setAttribute('aria-pressed', 'false');
  }
  applyTheme();
  setViewMode(state.viewMode);
  applyTranslationsToStaticDom();
  runComparison();
});
