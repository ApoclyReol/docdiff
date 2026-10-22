// Find in document: highlights every match in the visible version(s), counts them ("3 von 12")
// and steps through them with Enter / Shift+Enter. Never re-aligns and never filters the list.

const SEARCH_DEBOUNCE_MS = 120;
const SEARCH_CHUNK_MS = 12;

let searchHighlightJob = null;
const searchNav = { marks: [], index: -1, recountTimer: null };

function normalizedSearchQuery(query) {
  const q = (query || '').trim();
  return q.length >= 1 ? q.toLowerCase() : '';
}

function rowContainsQuery(row, qLower) {
  if (!qLower) return false;
  return (
    (row.leftBlock && row.leftBlock.text.toLowerCase().includes(qLower)) ||
    (row.rightBlock && row.rightBlock.text.toLowerCase().includes(qLower)) ||
    false
  );
}

// Row number of the clause currently in the middle of the visible pane (to update the rows
// the user is looking at first).
function getViewportRowNumber() {
  const pane = activeDocPane();
  const rect = pane.getBoundingClientRect();
  const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  const rowEl = el && el.closest('[data-row-id]');
  const id = rowEl && rowEl.getAttribute('data-row-id');
  const m = id && /^row-(\d+)$/.exec(id);
  return m ? Number(m[1]) : 1;
}

function applySearchQuery(value) {
  const prevQuery = state.searchQuery;
  state.searchQuery = value;
  if (searchHighlightJob) {
    clearTimeout(searchHighlightJob.timer);
    searchHighlightJob = null;
  }
  if (!state.alignedRows.length) {
    updateSearchCount();
    return;
  }
  const oldQ = normalizedSearchQuery(prevQuery);
  const newQ = normalizedSearchQuery(value);
  if (oldQ !== newQ) {
    flushPaneRender();
    // Rows not rendered yet pick up the new query when their page is rendered.
    const rows = state.alignedRows.filter(row => rowContainsQuery(row, oldQ) || rowContainsQuery(row, newQ));
    const center = getViewportRowNumber();
    rows.sort((a, b) => Math.abs(a.rowNumber - center) - Math.abs(b.rowNumber - center));
    const job = { rows, next: 0, timer: null, goFirst: Boolean(newQ) };
    searchHighlightJob = job;
    runSearchHighlightChunk(job);
  } else {
    scheduleSearchRecount();
  }
}

// Large result sets (a common word) are re-highlighted in short slices so typing stays fluid.
function runSearchHighlightChunk(job) {
  if (job !== searchHighlightJob) return;
  const t0 = performance.now();
  while (job.next < job.rows.length && performance.now() - t0 < SEARCH_CHUNK_MS) {
    rerenderRowInPlace(job.rows[job.next++]);
  }
  if (job.next < job.rows.length) {
    job.timer = setTimeout(() => runSearchHighlightChunk(job), 0);
  } else {
    searchHighlightJob = null;
    recountSearchMatches(job.goFirst);
  }
}

function cancelSearchHighlightJob() {
  if (!searchHighlightJob) return;
  clearTimeout(searchHighlightJob.timer);
  searchHighlightJob = null;
}

function scheduleSearchRecount() {
  clearTimeout(searchNav.recountTimer);
  searchNav.recountTimer = setTimeout(() => recountSearchMatches(false), 60);
}

// Matches in document order: row by row, the old version before the new one (split view), or
// the one column (inline view).
function collectSearchMarks() {
  if (!normalizedSearchQuery(state.searchQuery)) return [];
  if (state.viewMode === 'inline') return Array.from(sheetUnified.querySelectorAll('mark.tok-search'));
  const out = [];
  for (const row of state.alignedRows) {
    const els = getRowElements(row.id);
    if (els.l) out.push(...els.l.querySelectorAll('mark.tok-search'));
    if (els.r) out.push(...els.r.querySelectorAll('mark.tok-search'));
  }
  return out;
}

function recountSearchMatches(goFirst) {
  const prev = searchNav.marks[searchNav.index];
  searchNav.marks = collectSearchMarks();
  let idx = prev ? searchNav.marks.indexOf(prev) : -1;
  if (idx < 0 && searchNav.marks.length) {
    if (goFirst) {
      // First match at or after the middle of the current view.
      const pane = activeDocPane();
      const mid = pane.getBoundingClientRect().top + 8;
      idx = searchNav.marks.findIndex(m => m.getBoundingClientRect().top >= mid);
      if (idx < 0) idx = 0;
    } else {
      idx = 0;
    }
  }
  searchNav.index = searchNav.marks.length ? idx : -1;
  highlightCurrentMatch(goFirst);
  updateSearchCount();
}

function updateSearchCount() {
  const el = document.getElementById('search-count');
  if (!el) return;
  const n = searchNav.marks.length;
  if (!normalizedSearchQuery(state.searchQuery)) el.textContent = '';
  else el.textContent = n ? formatMsg('searchCount', { i: searchNav.index + 1, n }) : t('searchNone');
  const disabled = n === 0;
  document.getElementById('btn-search-prev').disabled = disabled;
  document.getElementById('btn-search-next').disabled = disabled;
}

function highlightCurrentMatch(scroll) {
  document.querySelectorAll('mark.tok-search.is-current').forEach(m => m.classList.remove('is-current'));
  const mark = searchNav.marks[searchNav.index];
  if (!mark) return;
  mark.classList.add('is-current');
  if (!scroll) return;
  const pane = mark.closest('.doc-pane, .doc-pane-unified');
  if (!pane) return;
  const paneRect = pane.getBoundingClientRect();
  const r = mark.getBoundingClientRect();
  if (r.top < paneRect.top + 56 || r.bottom > paneRect.bottom - 24) {
    state.isProgrammaticScroll = true;
    pane.scrollTop += r.top - paneRect.top - pane.clientHeight * 0.35;
    setTimeout(() => (state.isProgrammaticScroll = false), 60);
  }
  if (pane === paneLeft) paneRight.scrollTop = paneLeft.scrollTop;
}

function stepSearch(dir) {
  const n = searchNav.marks.length;
  if (!n) return;
  // Marks may have been re-rendered (edit, review): refresh the list first.
  if (!searchNav.marks[searchNav.index] || !searchNav.marks[searchNav.index].isConnected) {
    searchNav.marks = collectSearchMarks();
  }
  const total = searchNav.marks.length;
  if (!total) return updateSearchCount();
  searchNav.index = (searchNav.index + dir + total) % total;
  highlightCurrentMatch(true);
  updateSearchCount();
}

/* ── Search UI ─────────────────────────────────────────────────────────── */

const searchInput = document.getElementById('search-input');
const searchPanel = document.getElementById('search-panel');
const btnSearch = document.getElementById('btn-search');
let searchReturnFocus = null;

function openSearch() {
  if (!document.body.classList.contains('is-comparing')) return;
  if (searchPanel.hidden) {
    const active = document.activeElement;
    searchReturnFocus = active && active !== document.body && !searchPanel.contains(active) ? active : null;
    closeAllMenus(false);
    searchPanel.hidden = false;
    btnSearch.setAttribute('aria-expanded', 'true');
    document.body.classList.add('search-open');
  }
  searchInput.focus();
  searchInput.select();
}

// Esc / close: the highlights go away and focus returns where it was.
function closeSearch(returnFocus = true) {
  if (searchPanel.hidden) return;
  searchPanel.hidden = true;
  btnSearch.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('search-open');
  clearTimeout(searchDebounceTimer);
  if (searchInput.value || state.searchQuery) {
    searchInput.value = '';
    applySearchQuery('');
  }
  searchNav.marks = [];
  searchNav.index = -1;
  updateSearchCount();
  if (returnFocus) {
    const target = searchReturnFocus && searchReturnFocus.isConnected && searchReturnFocus.getClientRects().length ? searchReturnFocus : btnSearch;
    target.focus({ preventScroll: true });
  }
  searchReturnFocus = null;
}

let searchDebounceTimer = null;
searchInput.addEventListener('input', e => {
  const value = e.target.value;
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => applySearchQuery(value), SEARCH_DEBOUNCE_MS);
});
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (normalizedSearchQuery(searchInput.value) !== normalizedSearchQuery(state.searchQuery)) {
      clearTimeout(searchDebounceTimer);
      applySearchQuery(searchInput.value);
      return;
    }
    stepSearch(e.shiftKey ? -1 : 1);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeSearch(true);
  }
});
btnSearch.addEventListener('click', () => (searchPanel.hidden ? openSearch() : closeSearch(true)));
document.getElementById('btn-search-prev').addEventListener('click', () => stepSearch(-1));
document.getElementById('btn-search-next').addEventListener('click', () => stepSearch(1));
document.getElementById('btn-search-close').addEventListener('click', () => closeSearch(true));
searchPanel.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeSearch(true);
  }
});
