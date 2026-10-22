// Search highlighting without re-rendering or re-aligning the documents.

const SEARCH_DEBOUNCE_MS = 120;

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

function applySearchQuery(value) {
  const prevQuery = state.searchQuery;
  state.searchQuery = value;
  if (!state.alignedRows.length) {
    runComparison(); // single-document preview: cheap, re-renders with highlights
    return;
  }
  const oldQ = normalizedSearchQuery(prevQuery);
  const newQ = normalizedSearchQuery(value);
  if (oldQ !== newQ) {
    // Rows not rendered yet pick up the new query when their page is rendered.
    for (const row of state.alignedRows) {
      if (rowContainsQuery(row, oldQ) || rowContainsQuery(row, newQ)) rerenderRowInPlace(row);
    }
  }
  renderSidebarList(true);
  scheduleGutterDraw();
}
