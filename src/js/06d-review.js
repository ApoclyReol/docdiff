/* ── Review workflow: accept / reject each change (Word terminology) ──────────────────────
 *
 * "Annehmen" (accept) keeps the new wording and marks the change as reviewed. "Ablehnen"
 * (reject) restores the old wording of that paragraph in the new version (the former
 * "revert") and marks it as reviewed.
 *
 * Row ids are positional and change with every re-comparison, so the status of a change is
 * stored under a content key instead (state.reviews: key -> entry). The old version never
 * changes during a review, so a paragraph of it is identified by its text and occurrence
 * ("left anchor"). A rejected change no longer differs and disappears from the comparison;
 * its entry keeps what is needed to list it as "rejected" (a "ghost" item that points at
 * the restored paragraph).
 *
 * state.reviews is part of every undo / redo snapshot and of the session file.
 */

const REVIEW_KEY_MAX = 200000;

// Left anchors ("text#occurrence") for every row that has an old paragraph, plus the anchor
// of the nearest old paragraph above each row (for inserted paragraphs).
function computeRowAnchors(rows) {
  const seen = new Map();
  const left = new Map();
  const prev = new Map();
  let lastAnchor = '';
  for (const row of rows) {
    prev.set(row.id, lastAnchor);
    if (row.leftBlock) {
      const text = row.leftBlock.text;
      const n = (seen.get(text) || 0) + 1;
      seen.set(text, n);
      const anchor = `${text}#${n}`;
      left.set(row.id, anchor);
      lastAnchor = anchor;
    }
  }
  return { left, prev };
}

function reviewKeyForRow(row, anchors, insertCounts) {
  if (row.type === 'modified') return `M|${anchors.left.get(row.id)}|${row.rightBlock.text}`;
  if (row.type === 'deleted') return `D|${anchors.left.get(row.id)}`;
  if (row.type === 'inserted') {
    const base = `I|${anchors.prev.get(row.id)}|${row.rightBlock.text}`;
    const n = (insertCounts.get(base) || 0) + 1;
    insertCounts.set(base, n);
    return `${base}#${n}`;
  }
  return '';
}

// Builds state.listItems: every current change plus the rejected changes, in document order,
// with their review status. Also sets row.reviewKey / row.reviewStatus on the rows.
function rebuildReviewIndex() {
  const rows = state.alignedRows;
  const anchors = computeRowAnchors(rows);
  const insertCounts = new Map();
  const rowByLeftAnchor = new Map();
  for (const row of rows) {
    const a = anchors.left.get(row.id);
    if (a) rowByLeftAnchor.set(a, row);
  }
  const liveKeys = new Set();
  const items = [];
  rows.forEach((row, idx) => {
    row.reviewStatus = '';
    row.ghostNote = '';
    if (row.type === 'equal') return;
    const key = reviewKeyForRow(row, anchors, insertCounts);
    row.reviewKey = key;
    liveKeys.add(key);
    const entry = state.reviews[key];
    const status = entry && entry.status === 'accepted' ? 'accepted' : 'open';
    row.reviewStatus = status === 'accepted' ? 'accepted' : '';
    items.push({ id: row.id, rowId: row.id, row, type: row.type, status, ghost: null, order: idx, sub: 0 });
  });

  // Rejected changes, placed where they were.
  for (const [key, entry] of Object.entries(state.reviews)) {
    if (!entry || entry.status !== 'rejected' || liveKeys.has(key)) continue;
    let target = null;
    let order = 0;
    let sub = 0;
    if (entry.type === 'inserted') {
      target = entry.prevAnchor ? rowByLeftAnchor.get(entry.prevAnchor) : rows[0];
      if (!target) continue;
      order = rows.indexOf(target);
      sub = entry.prevAnchor ? 0.5 : -0.5;
    } else {
      target = rowByLeftAnchor.get(entry.leftAnchor);
      // Only while the old wording is really back (an edit afterwards makes it a new change).
      if (!target || target.type !== 'equal') continue;
      order = rows.indexOf(target);
      if (!target.ghostNote) target.ghostNote = 'rejected';
    }
    items.push({
      id: `ghost-${key.length}-${hashString(key)}`,
      rowId: target.id,
      row: target,
      type: entry.type,
      status: 'rejected',
      ghost: entry,
      order,
      sub,
    });
  }
  items.sort((a, b) => a.order - b.order || a.sub - b.sub);
  items.forEach((item, i) => {
    item.index = i + 1;
  });
  state.listItems = items;
  return items;
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

function getReviewCounts() {
  const c = { total: state.listItems.length, accepted: 0, rejected: 0, open: 0 };
  for (const item of state.listItems) c[item.status]++;
  c.reviewed = c.accepted + c.rejected;
  return c;
}

// The list item shown as "current" for the active row (a real change wins over a ghost).
function getActiveItem() {
  if (!state.activeRowId) return null;
  let ghost = null;
  for (const item of state.listItems) {
    if (item.rowId !== state.activeRowId) continue;
    if (!item.ghost) return item;
    if (!ghost) ghost = item;
  }
  return ghost;
}

function cloneReviews(reviews = state.reviews) {
  const out = {};
  for (const [k, v] of Object.entries(reviews || {})) out[k] = { ...v };
  return out;
}

function serializeReviews(reviews = state.reviews) {
  return JSON.stringify(Object.keys(reviews).sort().map(k => [k, reviews[k]]));
}

// Review status belongs to the loaded pair of documents.
function resetReviews() {
  state.reviews = {};
}

/* ── Actions ───────────────────────────────────────────────────────────── */

function canReviewNow() {
  return document.body.classList.contains('is-comparing') && isShownComparisonCurrent();
}

function acceptItem(item, opts = {}) {
  if (!item || item.ghost || item.status === 'accepted' || !canReviewNow()) return false;
  const row = item.row;
  pushUndoSnapshot();
  state.reviews[row.reviewKey] = { status: 'accepted', type: row.type };
  refreshReviewState();
  const n = state.listItems.length;
  const idx = (state.listItems.find(i => i.rowId === row.id && !i.ghost) || item).index;
  announce(formatMsg('announceAccepted', { i: idx, n }));
  if (!opts.silent) showUndoToast('toastAccepted');
  return true;
}

function rejectItem(item, opts = {}) {
  if (!item || item.ghost || !canReviewNow()) return false;
  const row = item.row;
  const anchors = computeRowAnchors(state.alignedRows);
  const entry = {
    status: 'rejected',
    type: row.type,
    leftText: row.leftBlock ? row.leftBlock.text : '',
    rightText: row.rightBlock ? row.rightBlock.text : '',
    leftAnchor: anchors.left.get(row.id) || '',
    prevAnchor: anchors.prev.get(row.id) || '',
    pageNum: row.pageNum || 1,
    refCode: getDisplayRef(row),
  };
  const idx = item.index;
  const n = state.listItems.length;
  pushUndoSnapshot();
  delete state.reviews[row.reviewKey];
  state.reviews[row.reviewKey] = entry;
  // The rejected row stays selected; for an insertion that is the paragraph above it.
  const targetIdx = state.alignedRows.indexOf(row);
  pendingSelectAfterReject = row.type === 'inserted' ? Math.max(0, targetIdx - 1) : targetIdx;
  state.rightText = rebuildRightTextFromRows(row.id, row.leftBlock ? row.leftBlock.text : '');
  runComparison();
  announce(formatMsg('announceRejected', { i: idx, n }));
  if (!opts.silent) showUndoToast('toastRejected');
  return true;
}

// Takes a review back: accepted -> open; rejected -> the new wording is restored.
function reopenItem(item) {
  if (!item || item.status === 'open' || !canReviewNow()) return false;
  const idx = item.index;
  const n = state.listItems.length;
  if (item.status === 'accepted') {
    pushUndoSnapshot();
    delete state.reviews[item.row.reviewKey];
    refreshReviewState();
  } else {
    const g = item.ghost;
    const key = Object.keys(state.reviews).find(k => state.reviews[k] === g);
    pushUndoSnapshot();
    if (key) delete state.reviews[key];
    if (g.type === 'inserted') {
      const anchorRow = item.row;
      const base = anchorRow.rightBlock ? anchorRow.rightBlock.text : '';
      state.rightText = rebuildRightTextFromRows(anchorRow.id, base ? `${base}\n${g.rightText}` : g.rightText);
    } else {
      state.rightText = rebuildRightTextFromRows(item.row.id, g.type === 'deleted' ? '' : g.rightText);
    }
    runComparison();
  }
  announce(formatMsg('announceReopened', { i: idx, n }));
  showUndoToast('toastReopened');
  return true;
}

let pendingSelectAfterReject = null;

// After a review-only change (no new comparison): decorations, list, counters.
function refreshReviewState() {
  rebuildReviewIndex();
  decorateReviewedRows();
  renderSidebarList(true);
  updateStepper();
  placeReviewBar();
  scheduleRulerDraw();
}

// Toggles the review classes on the rendered clauses without re-rendering them.
function decorateReviewedRows() {
  for (const row of state.alignedRows) {
    const els = getRowElements(row.id);
    for (const el of [els.l, els.r, els.u]) {
      if (!el) continue;
      el.classList.toggle('is-accepted', row.reviewStatus === 'accepted');
    }
  }
}

/* ── The docked action row under the active paragraph ──────────────────── */

// Created on first use (the module is also loaded without a DOM by the export tests).
let reviewBar = null;
function getReviewBar() {
  if (reviewBar) return reviewBar;
  reviewBar = document.createElement('div');
  reviewBar.className = 'review-bar';
  reviewBar.setAttribute('role', 'toolbar');
  reviewBar.addEventListener('mousedown', e => e.stopPropagation());
  // Roving focus inside the action row: one tab stop, arrow keys move between the buttons.
  reviewBar.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    const buttons = Array.from(reviewBar.querySelectorAll('button'));
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    buttons.forEach((b, k) => (b.tabIndex = k === next ? 0 : -1));
    buttons[next].focus();
  });
  return reviewBar;
}

function removeReviewBar() {
  if (reviewBar && reviewBar.isConnected) reviewBar.remove();
}

const ICON_CHECK = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const ICON_X = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const ICON_EDIT = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
const ICON_UNDO = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>';

// Buttons for one item (shared by the document action row and the active list card).
function reviewActionsHtml(item, row, context) {
  const btn = (action, icon, label, title, cls = '') =>
    `<button type="button" class="ra-btn ${cls}" data-review-action="${action}" data-tooltip="${escapeHtml(title)}"${context === 'doc' ? ' tabindex="-1"' : ''}>${icon}<span class="ra-label">${escapeHtml(label)}</span></button>`;
  const edit = btn('edit', ICON_EDIT, t('editBtn'), t('editTitle'), 'ra-edit');
  if (!item) return edit;
  if (item.status === 'open') {
    return (
      btn('accept', ICON_CHECK, t('acceptBtn'), t('acceptTitle'), 'ra-accept') +
      btn('reject', ICON_X, t('rejectBtn'), t('rejectTitle'), 'ra-reject') +
      edit
    );
  }
  const note =
    item.status === 'accepted'
      ? `<span class="ra-status is-accepted">${ICON_CHECK}${escapeHtml(t('acceptedNote'))}</span>`
      : `<span class="ra-status is-rejected">${ICON_X}${escapeHtml(t('rejectedNote'))}</span>`;
  return note + btn('reopen', ICON_UNDO, t('reopenBtn'), t('reopenTitle'), 'ra-reopen') + (item.status === 'accepted' ? edit : '');
}

function placeReviewBar() {
  const row = state.activeRowId && state.alignedRows.find(r => r.id === state.activeRowId);
  const els = row ? getRowElements(row.id) : null;
  const host = els ? (state.viewMode === 'inline' ? els.u : els.r) : null;
  if (!row || !host || host.classList.contains('is-editing') || !document.body.classList.contains('is-comparing')) {
    removeReviewBar();
    return;
  }
  const bar = getReviewBar();
  const item = getActiveItem();
  const hadFocus = bar.contains(document.activeElement);
  const focusedAction = hadFocus ? document.activeElement.getAttribute('data-review-action') : null;
  bar.innerHTML = reviewActionsHtml(item, row, 'doc');
  bar.setAttribute(
    'aria-label',
    item ? formatMsg('reviewBarLabel', { i: item.index, n: state.listItems.length }) : t('paraActionsLabel')
  );
  const buttons = bar.querySelectorAll('button');
  if (buttons.length) buttons[0].tabIndex = 0;
  if (bar.parentElement !== host) host.appendChild(bar);
  if (hadFocus) {
    const again = bar.querySelector(`[data-review-action="${focusedAction}"]`) || buttons[0];
    if (again) {
      buttons.forEach(b => (b.tabIndex = b === again ? 0 : -1));
      again.focus({ preventScroll: true });
    }
  }
}

// Runs a review action for the active row ('accept' | 'reject' | 'edit' | 'reopen').
function runReviewAction(action, fromList) {
  const row = state.activeRowId && state.alignedRows.find(r => r.id === state.activeRowId);
  if (!row) return false;
  const item = getActiveItem();
  hideTooltip();
  requestRowFocus(row.id, fromList);
  let done = false;
  if (action === 'accept') done = acceptItem(item);
  else if (action === 'reject') done = rejectItem(item);
  else if (action === 'reopen') done = reopenItem(item);
  else if (action === 'edit') {
    pendingRowFocus = null;
    const host = getRowElements(row.id)[state.viewMode === 'inline' ? 'u' : 'r'];
    if (host) startInlineClauseEdit(host, row.id);
    return true;
  }
  applyPendingRowFocusIfIdle();
  return done;
}
