const isMobileViewport = typeof window !== 'undefined' && window.innerWidth <= 720;
const isTabletOrSmaller = typeof window !== 'undefined' && window.innerWidth <= 960;

const initialDark =
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-color-scheme: dark)').matches;
if (typeof document !== 'undefined') {
  document.documentElement.classList.toggle('dark', initialDark);
}

const state = {
  lang: initialLang,
  dark: initialDark,
  themeOverridden: false,
  viewMode: isMobileViewport ? 'inline' : 'pages',
  leftText: '',
  rightText: '',
  leftName: '',
  rightName: '',
  leftFormat: '',
  rightFormat: '',
  alignedRows: [],
  changeRows: [],
  hoveredRowId: null,
  activeRowId: null,
  onlyChanges: false,
  ignoreHeadersFooters: true,
  filteredHfCount: 0,
  rightAllBlocks: [],
  sidebarFilter: 'all',
  searchQuery: '',
  isProgrammaticScroll: false,
  undoStack: [],
  redoStack: [],
  legendDismissed: false,
  singleKeyShortcuts: true,
};

function t(key) {
  return I18N[state.lang][key] || I18N.de[key] || key;
}

const paneLeft = document.getElementById('pane-left');
const paneRight = document.getElementById('pane-right');
const paneUnified = document.getElementById('pane-unified');
const sheetLeft = document.getElementById('sheet-left');
const sheetRight = document.getElementById('sheet-right');
const sheetUnified = document.getElementById('sheet-unified');
const sidebarList = document.getElementById('sidebar-list');
const connectorSvg = document.getElementById('connector-svg');
const minimapTrack = document.getElementById('minimap-track');

// Shows `text` in the custom tooltip. Buttons and links also get an accessible name:
// `name` when given (e.g. a visible label that CSS may hide on narrow screens), otherwise
// the tooltip text for icon-only controls, which would have no name at all.
function setTooltip(el, text, name) {
  if (!el) return;
  el.setAttribute('data-tooltip', text);
  el.removeAttribute('title');
  if (name) {
    el.setAttribute('aria-label', name);
  } else if (el.matches('button, a') && !el.textContent.trim()) {
    el.setAttribute('aria-label', text);
  }
}

// "1 Änderung" / "19 Änderungen"
function changesWord(n) {
  return n === 1 ? t('changeLabelOne') : t('changesLabel');
}

function formatMsg(key, params) {
  return t(key).replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : ''));
}

// Polite announcements for screen readers (one shared live region, never chatty).
let srStatusTimer = null;
function announce(message) {
  const el = document.getElementById('sr-status');
  if (!el) return;
  clearTimeout(srStatusTimer);
  el.textContent = '';
  srStatusTimer = setTimeout(() => {
    el.textContent = message;
  }, 60);
}

function applyDataI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.getAttribute('data-i18n-html'));
  });
  document.querySelectorAll('[data-i18n-label]').forEach(el => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-label')));
  });
}

function applyTranslationsToStaticDom() {
  document.documentElement.lang = state.lang;
  applyDataI18n();
  document.getElementById('btn-lang').textContent = state.lang.toUpperCase();
  setTooltip(
    document.getElementById('btn-lang'),
    t('langTitle'),
    `${state.lang.toUpperCase()} – ${t('langTitle')}`
  );
  document.getElementById('i18n-changes-label').textContent = t('changesLabel');
  setTooltip(document.getElementById('stat-summary'), t('statTooltip'));
  document.getElementById('seg-view-mode').setAttribute('aria-label', t('viewModeLabel'));
  document.getElementById('col-bars').setAttribute('aria-label', t('docsLabel'));
  document.getElementById('legend-bar').setAttribute('aria-label', t('legendLabel'));
  paneLeft.setAttribute('aria-label', t('colLeft'));
  paneRight.setAttribute('aria-label', t('colRight'));
  paneUnified.setAttribute('aria-label', t('paneUnifiedLabel'));

  const modePagesEl = document.getElementById('i18n-mode-pages');
  if (modePagesEl) modePagesEl.textContent = t('modePages');
  setTooltip(document.getElementById('btn-mode-pages'), t('modePagesTitle'));
  document.getElementById('i18n-mode-split').textContent = t('modeSplit');
  setTooltip(document.getElementById('btn-mode-split'), t('modeSplitTitle'));
  document.getElementById('i18n-mode-inline').textContent = t('modeInline');
  setTooltip(document.getElementById('btn-mode-inline'), t('modeInlineTitle'));

  document.getElementById('search-input').placeholder = t('searchPlaceholder');
  document.getElementById('search-input').setAttribute('aria-label', t('searchLabel'));
  setTooltip(document.getElementById('search-box-wrap'), t('searchTitle'));
  setTooltip(document.getElementById('btn-prev'), t('prevTitle'), t('prevLabel'));
  setTooltip(document.getElementById('btn-next'), t('nextTitle'), t('nextLabel'));

  document.getElementById('i18n-btn-only-changes').textContent = t('onlyChanges');
  setTooltip(document.getElementById('btn-only-changes'), t('onlyChangesTitle'));

  const hfBtnLabel = document.getElementById('i18n-btn-filter-hf');
  if (hfBtnLabel) hfBtnLabel.textContent = t('hfFilterBtn');
  setTooltip(document.getElementById('btn-filter-hf'), t('hfFilterTitle'));

  document.getElementById('i18n-btn-text').textContent = t('textBtn');
  setTooltip(document.getElementById('btn-paste-modal'), t('textBtnTitle'), t('textBtn'));

  document.getElementById('i18n-btn-export').textContent = t('exportBtn');
  setTooltip(document.getElementById('btn-export-menu'), t('exportTitle'));
  document.getElementById('i18n-exp-copy').textContent = t('expCopy');
  document.getElementById('i18n-exp-txt').textContent = t('expTxt');
  document.getElementById('i18n-exp-pdf').textContent = t('expPdf');
  document.getElementById('i18n-exp-word').textContent = t('expWord');
  document.getElementById('i18n-exp-html').textContent = t('expHtml');
  document.getElementById('i18n-exp-md').textContent = t('expMd');

  document.getElementById('i18n-btn-clear').textContent = t('clearBtn');
  setTooltip(document.getElementById('btn-clear'), t('clearBtnTitle'), t('clearBtn'));

  document.getElementById('i18n-btn-help').textContent = t('helpBtn');
  setTooltip(document.getElementById('btn-help'), t('helpBtnTitle'), t('helpBtn'));

  setTooltip(document.getElementById('btn-theme'), t('themeTitle'));
  setTooltip(document.getElementById('btn-toggle-sidebar'), t('sidebarToggleTitle'));

  document.getElementById('i18n-mob-filter').textContent = t('mobFilter');
  document.getElementById('i18n-mob-list').textContent = t('mobList');
  document.getElementById('i18n-mob-export').textContent = t('mobExport');
  document.getElementById('i18n-mob-sheet-title').textContent = t('sidebarTitle');
  document.getElementById('btn-close-sidebar-sheet').textContent = t('mobDone');

  document.getElementById('i18n-col-left').textContent = t('colLeft');
  setTooltip(document.getElementById('i18n-col-left'), t('colLeftTitle'));
  document.getElementById('i18n-col-right').textContent = t('colRight');
  setTooltip(document.getElementById('i18n-col-right'), t('colRightTitle'));

  document.getElementById('i18n-badge-editable').textContent = t('badgeEditable');
  setTooltip(document.getElementById('badge-editable'), t('badgeEditableTitle'));

  document.getElementById('i18n-upload-left').textContent = t('fileBtn');
  setTooltip(document.getElementById('btn-upload-left'), t('fileLeftTitle'), `${t('fileBtn')}: ${t('colLeft')}`);
  document.getElementById('i18n-upload-right').textContent = t('fileBtn');
  setTooltip(document.getElementById('btn-upload-right'), t('fileRightTitle'), `${t('fileBtn')}: ${t('colRight')}`);

  setTooltip(document.getElementById('btn-clear-left'), t('clearSideTitle'), t('slotClearLeft'));
  setTooltip(document.getElementById('btn-clear-right'), t('clearSideTitle'), t('slotClearRight'));
  setTooltip(document.getElementById('btn-swap-docs'), t('swapTitle'));
  setTooltip(document.getElementById('btn-undo'), t('undoTitle'), t('undoLabel'));
  setTooltip(document.getElementById('btn-redo'), t('redoTitle'), t('redoLabel'));
  setTooltip(document.getElementById('dock-step-count'), t('stepCountTitle'));
  setTooltip(document.getElementById('sidebar-kbd-hint'), t('sidebarKbdTitle'));

  document.getElementById('i18n-sidebar-title').textContent = t('sidebarTitle');
  document.getElementById('i18n-filter-all').textContent = t('filterAll');
  document.getElementById('i18n-filter-mod').textContent = t('filterMod');
  document.getElementById('i18n-filter-ins').textContent = t('filterIns');
  document.getElementById('i18n-filter-del').textContent = t('filterDel');
  document.getElementById('i18n-drop-left').textContent = t('dropLeft');
  document.getElementById('i18n-drop-right').textContent = t('dropRight');

  document.getElementById('i18n-modal-paste-title').textContent = t('modalPasteTitle');
  document.getElementById('i18n-modal-left-label').textContent = t('modalLeftLabel');
  document.getElementById('i18n-modal-right-label').textContent = t('modalRightLabel');
  document.getElementById('textarea-left').placeholder = t('modalLeftPh');
  document.getElementById('textarea-right').placeholder = t('modalRightPh');
  document.getElementById('btn-cancel-modal').textContent = t('cancel');
  document.getElementById('btn-apply-modal').textContent = t('compare');

  document.getElementById('i18n-help-title').textContent = t('helpTitle');
  document.getElementById('i18n-help-body').innerHTML = t('helpBodyHtml');
  document.getElementById('btn-help-sample').textContent = t('helpSampleBtn');
  document.getElementById('btn-ok-help').textContent = t('helpOkBtn');

  document.getElementById('i18n-privacy-title').textContent = t('privacyTitle');
  document.getElementById('i18n-privacy-body').innerHTML = t('privacyBodyHtml');
  document.getElementById('i18n-footer-privacy').textContent = t('footerPrivacy');
}

function setViewMode(mode) {
  state.viewMode = mode;
  document.body.classList.toggle('view-inline', mode === 'inline');
  document.body.classList.toggle('view-stream', mode === 'split');
  document.body.classList.toggle('view-pages', mode === 'pages');
  const btnPages = document.getElementById('btn-mode-pages');
  if (btnPages) btnPages.setAttribute('aria-pressed', String(mode === 'pages'));
  document.getElementById('btn-mode-split').setAttribute('aria-pressed', String(mode === 'split'));
  document.getElementById('btn-mode-inline').setAttribute('aria-pressed', String(mode === 'inline'));
  requestAnimationFrame(() => {
    if (mode !== 'inline') equalizeRowHeights();
    scheduleGutterDraw();
  });
}
