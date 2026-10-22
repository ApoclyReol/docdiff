// Layout tiers: phone < 768 px ≤ tablet < 1200 px ≤ desktop.
const PHONE_MAX = 767;
const TABLET_MAX = 1199;
function isPhoneWidth() {
  return typeof window !== 'undefined' && window.innerWidth <= PHONE_MAX;
}
function isTabletOrSmaller() {
  return typeof window !== 'undefined' && window.innerWidth <= TABLET_MAX;
}
const isMacPlatform =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '');

const initialDark =
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-color-scheme: dark)').matches;
if (typeof document !== 'undefined') {
  document.documentElement.classList.toggle('dark', initialDark);
}

// Phones and tablets in portrait start in one column.
const initialInline =
  typeof window !== 'undefined' && (isPhoneWidth() || (isTabletOrSmaller() && window.innerHeight > window.innerWidth));

const state = {
  lang: initialLang,
  dark: initialDark,
  themePref: 'system', // 'light' | 'dark' | 'system'
  viewMode: initialInline ? 'inline' : 'split', // 'split' | 'inline'
  viewModeChosen: false,
  // null = automatic (on for documents with real pages: PDF / DOCX / the example)
  pageBreaks: null,
  leftText: '',
  rightText: '',
  leftName: '',
  rightName: '',
  leftFormat: '',
  rightFormat: '',
  alignedRows: [],
  changeRows: [],
  listItems: [],
  hoveredRowId: null,
  activeRowId: null,
  onlyChanges: false,
  ignoreHeadersFooters: true,
  filteredHfCount: 0,
  rightAllBlocks: [],
  sidebarFilter: 'all',
  sidebarOpen: true,
  searchQuery: '',
  isProgrammaticScroll: false,
  // Review status per change (see 06d-review.js), kept in undo / redo snapshots.
  reviews: {},
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

// Shows `text` in the custom tooltip (mouse hover and keyboard focus only). Icon-only buttons
// also get it as their accessible name; `name` overrides the accessible name.
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

// Ctrl / ⌘ according to the platform.
function modKeyLabel() {
  return isMacPlatform ? '⌘' : t('kbdCtrl');
}
function redoKeyLabel() {
  return isMacPlatform ? '⇧⌘Z' : `${t('kbdCtrl')}+Y`;
}
function undoKeyLabel() {
  return isMacPlatform ? '⌘Z' : `${t('kbdCtrl')}+Z`;
}

function formatMsg(key, params = {}) {
  return t(key).replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : ''));
}

// "1 Änderung" / "19 Änderungen"
function changesTitle(n) {
  return n === 1 ? t('listTitleOne') : formatMsg('listTitle', { n });
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
  document.title = t('metaTitle');
  applyDataI18n();
  const btnLang = document.getElementById('btn-lang');
  btnLang.textContent = state.lang.toUpperCase();
  setTooltip(btnLang, t('langTitle'), `${state.lang.toUpperCase()} – ${t('langTitle')}`);
  setTooltip(document.getElementById('btn-theme'), t('themeTitle'));
  setTooltip(document.getElementById('btn-prev'), t('prevTitle'), t('prevLabel'));
  setTooltip(document.getElementById('btn-next'), t('nextTitle'), t('nextLabel'));
  setTooltip(document.getElementById('btn-search'), formatMsg('searchTitle', { mod: modKeyLabel() }), t('searchLabel'));
  setTooltip(document.getElementById('btn-search-prev'), t('searchPrev'));
  setTooltip(document.getElementById('btn-search-next'), t('searchNext'));
  setTooltip(document.getElementById('btn-search-close'), t('searchClose'));
  setTooltip(document.getElementById('btn-more'), t('moreLabel'));
  document.getElementById('search-input').placeholder = t('searchPlaceholder');
  document.getElementById('kbd-undo').textContent = undoKeyLabel();
  document.getElementById('kbd-redo').textContent = redoKeyLabel();
  document.getElementById('textarea-left').placeholder = t('modalLeftPh');
  document.getElementById('textarea-right').placeholder = t('modalRightPh');
  document.getElementById('i18n-help-body').innerHTML = formatMsg('helpBodyHtml', {
    mod: modKeyLabel(),
    redo: redoKeyLabel(),
  });
  document.getElementById('i18n-privacy-body').innerHTML = t('privacyBodyHtml');
  updateFileLabels();
}

// Middle truncation keeps both the start and the version suffix of a file name visible:
// "Rahmenvertrag_IT_…_v2.docx".
function truncateMiddle(name, max) {
  const chars = Array.from(String(name || ''));
  if (chars.length <= max) return chars.join('');
  const keepEnd = Math.ceil((max - 1) * 0.45);
  const keepStart = max - 1 - keepEnd;
  return chars.slice(0, keepStart).join('') + '…' + chars.slice(chars.length - keepEnd).join('');
}

// Two names that share a long start ("Vertrag_v1_…", "Vertrag_v2_…") keep the part that
// tells them apart: "…v1_Vorher.docx".
function truncateFileName(name, other, max) {
  const chars = Array.from(String(name || ''));
  if (chars.length <= max) return chars.join('');
  const o = Array.from(String(other || ''));
  let d = 0;
  while (d < chars.length && d < o.length && chars[d] === o[d]) d++;
  // Start the distinguishing part at a word boundary ("…v1_Vorher", not "…1_Vorher").
  while (d > 0 && !/[\s_.\-]/.test(chars[d - 1])) d--;
  if (d > 4 && d < chars.length && chars.length - d + 1 <= max) {
    const tail = chars.slice(d);
    const room = max - 1 - tail.length;
    const head = room >= 6 ? chars.slice(0, room) : [];
    return head.join('') + '…' + tail.join('');
  }
  return truncateMiddle(name, max);
}

// File names in the top bar button, its popover and the pane captions.
function updateFileLabels() {
  const left = state.leftName || t('noFileLeft');
  const right = state.rightName || t('noFileRight');
  const max = window.innerWidth >= 1440 ? 30 : window.innerWidth >= 1200 ? 22 : 15;
  const filesLeft = document.getElementById('files-left');
  const filesRight = document.getElementById('files-right');
  // Narrow screens: a shared extension carries no information ("…v1_Vorher → …v2_Nachher").
  const ext = n => (/\.[A-Za-z0-9]{1,5}$/.exec(n) || [''])[0];
  const dropExt = max <= 16 && ext(left) && ext(left).toLowerCase() === ext(right).toLowerCase();
  const shownLeft = dropExt ? left.slice(0, -ext(left).length) : left;
  const shownRight = dropExt ? right.slice(0, -ext(right).length) : right;
  filesLeft.textContent = truncateFileName(shownLeft, shownRight, max);
  filesRight.textContent = truncateFileName(shownRight, shownLeft, max);
  document.getElementById('files-label').textContent = formatMsg('filesBtnLabel', { left, right });
  document.getElementById('fp-name-left').textContent = left;
  document.getElementById('fp-name-right').textContent = right;
  const unified = document.getElementById('filename-unified');
  if (unified) unified.textContent = `${left} → ${right}`;
  updateColumnMeta('left');
  updateColumnMeta('right');
}

function setViewMode(mode, opts = {}) {
  if (mode !== 'split' && mode !== 'inline') mode = 'split';
  const changed = state.viewMode !== mode;
  // The change in view before switching stays in view afterwards.
  const keepRowId = changed && document.body.classList.contains('is-comparing') ? state.activeRowId : null;
  state.viewMode = mode;
  if (opts.user) state.viewModeChosen = true;
  document.body.classList.toggle('view-inline', mode === 'inline');
  document.body.classList.toggle('view-split', mode === 'split');
  setMenuChecked('btn-mode-split', mode === 'split');
  setMenuChecked('btn-mode-inline', mode === 'inline');
  if (typeof placeReviewBar === 'function') placeReviewBar();
  requestAnimationFrame(() => {
    if (keepRowId && state.activeRowId === keepRowId) selectAndScrollToRow(keepRowId, false, true, { flash: false });
    if (typeof scheduleRulerDraw === 'function') scheduleRulerDraw();
  });
}

function setMenuChecked(id, on) {
  const el = typeof id === 'string' ? document.getElementById(id) : id;
  if (el) el.setAttribute('aria-checked', String(Boolean(on)));
}

// Page breaks are shown by default for documents that have real pages (PDF, DOCX, the example).
function documentsHavePages() {
  return Boolean(lastComparison && lastComparison.result && (lastComparison.result.leftPages > 1 || lastComparison.result.rightPages > 1)) &&
    (state.rightAllBlocks || []).some(b => b.hasExplicitPage);
}
function pageBreaksShown() {
  return state.pageBreaks === null ? documentsHavePages() : state.pageBreaks;
}
function applyPageBreaks() {
  const on = pageBreaksShown();
  document.body.classList.toggle('no-page-breaks', !on);
  setMenuChecked('btn-page-breaks', on);
}
