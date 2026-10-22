// Search highlighting without re-rendering or re-aligning the documents.

const SEARCH_DEBOUNCE_MS = 120;
const SEARCH_CHUNK_MS = 12;

let searchHighlightJob = null;

function normalizedSearchQuery(query) {
  const q = (query || '').trim();
  return q.length >= 2 ? q.toLowerCase() : '';
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
  const pane = state.viewMode === 'inline' ? paneUnified : paneRight;
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
    runComparison(); // single-document preview: cheap, re-renders with highlights
    return;
  }
  const oldQ = normalizedSearchQuery(prevQuery);
  const newQ = normalizedSearchQuery(value);
  if (oldQ !== newQ) {
    // Rows not rendered yet pick up the new query when their page is rendered.
    const rows = state.alignedRows.filter(row => rowContainsQuery(row, oldQ) || rowContainsQuery(row, newQ));
    const center = getViewportRowNumber();
    rows.sort((a, b) => Math.abs(a.rowNumber - center) - Math.abs(b.rowNumber - center));
    const job = { rows, next: 0, timer: null };
    searchHighlightJob = job;
    runSearchHighlightChunk(job);
  }
  renderSidebarList(true);
  scheduleGutterDraw();
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
    scheduleGutterDraw();
  }
}

function cancelSearchHighlightJob() {
  if (!searchHighlightJob) return;
  clearTimeout(searchHighlightJob.timer);
  searchHighlightJob = null;
}
