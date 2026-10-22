// Row registry and left/right row-height alignment.
//
// Every aligned row has one clause per pane. The registry maps row ids to those elements so that
// navigation, search and edits never have to query the whole (often 50k-node) document.
//
// Heights: the left and right clause of a row must be equally tall so both panes line up.
// The old approach reset and re-measured every row (two full-document layouts) on each
// navigation step. Now a ResizeObserver reports only clauses whose size actually changed, and
// only that row pair is re-equalized. Off-screen clauses use `content-visibility: auto`; until
// they are rendered for the first time their size is the placeholder from
// `contain-intrinsic-size`, which is recognized by its exact content height and ignored.

// Must match `contain-intrinsic-size` of `.clause.deferred-block` in styles.css.
const DEFERRED_PLACEHOLDER_PX = 47.25;

const rowLayout = {
  rows: new Map(), // rowId -> { l, r, u }
  observer: null,
};

function getRowElements(rowId) {
  return rowLayout.rows.get(rowId) || { l: null, r: null, u: null };
}

function getRowLayoutObserver() {
  if (rowLayout.observer || typeof ResizeObserver === 'undefined') return rowLayout.observer;
  rowLayout.observer = new ResizeObserver(onRowLayoutResize);
  return rowLayout.observer;
}

function resetRowLayoutRegistry() {
  const ro = rowLayout.observer;
  if (ro) ro.disconnect();
  rowLayout.rows = new Map();
}

function registerRowElements(rowId, l, r, u) {
  const prev = rowLayout.rows.get(rowId);
  const ro = getRowLayoutObserver();
  if (prev && ro) {
    if (prev.l) ro.unobserve(prev.l);
    if (prev.r) ro.unobserve(prev.r);
  }
  const entry = { l, r, u };
  rowLayout.rows.set(rowId, entry);
  if (l && r) {
    const pair = { l, r };
    l._eqPair = pair;
    r._eqPair = pair;
    if (ro) {
      ro.observe(l);
      ro.observe(r);
    }
  }
}

// Registers the clauses of all page cards from `firstCardIdx` on (cards are appended in the same
// order to all three sheets, and each card holds the same rows in the same order).
function registerRenderedCards(firstCardIdx) {
  const lCards = sheetLeft.children;
  const rCards = sheetRight.children;
  const uCards = sheetUnified.children;
  for (let c = firstCardIdx; c < lCards.length; c++) {
    const ls = lCards[c].querySelectorAll('.clause[data-row-id]');
    const rs = rCards[c] ? rCards[c].querySelectorAll('.clause[data-row-id]') : [];
    const us = uCards[c] ? uCards[c].querySelectorAll('.clause[data-row-id]') : [];
    for (let i = 0; i < ls.length; i++) {
      registerRowElements(ls[i].getAttribute('data-row-id'), ls[i], rs[i] || null, us[i] || null);
    }
  }
}

function isDeferredPlaceholderSize(entry) {
  const box = entry.contentBoxSize && entry.contentBoxSize[0];
  return Boolean(box) && Math.abs(box.blockSize - DEFERRED_PLACEHOLDER_PX) < 0.05;
}

function onRowLayoutResize(entries) {
  const dirty = new Set();
  for (const entry of entries) {
    const el = entry.target;
    const pair = el._eqPair;
    if (!pair) continue;
    const h = entry.borderBoxSize && entry.borderBoxSize[0]
      ? entry.borderBoxSize[0].blockSize
      : entry.contentRect.height;
    const w = entry.contentRect.width;
    if (!h || !w) continue; // hidden: inline mode or "only changes"
    if (el._eqW && Math.abs(w - el._eqW) > 0.5) {
      // Width changed (window resize, sidebar, view mode): text re-wraps, so the imposed
      // heights are stale. Re-measure this pair from scratch in the next frame (observing
      // from inside the callback would trip the ResizeObserver loop limit).
      el._eqW = w;
      scheduleRowPairReset(pair);
      continue;
    }
    el._eqW = w;
    const minH = el._eqMin || 0;
    if (!minH && isDeferredPlaceholderSize(entry)) continue; // never rendered yet
    if (!minH || h > minH + 0.5) el._eqNat = h;
    dirty.add(pair);
  }
  for (const pair of dirty) equalizeRowPair(pair);
}

const rowPairsToReset = new Set();
let rowPairResetRaf = 0;

function scheduleRowPairReset(pair) {
  rowPairsToReset.add(pair);
  if (rowPairResetRaf) return;
  rowPairResetRaf = requestAnimationFrame(() => {
    rowPairResetRaf = 0;
    const pairs = Array.from(rowPairsToReset);
    rowPairsToReset.clear();
    resetRowPairs(pairs);
  });
}

// Elements whose min-height was just written are unobserved until the next frame: the size
// change we caused ourselves needs no notification, and observing it within the same
// ResizeObserver pass would raise "ResizeObserver loop completed with undelivered notifications".
const rowLayoutReobserve = new Set();
let rowLayoutReobserveRaf = 0;

function equalizeRowPair(pair) {
  const target = Math.max(pair.l._eqNat || 0, pair.r._eqNat || 0);
  if (!target) return;
  const ro = rowLayout.observer;
  for (const el of [pair.l, pair.r]) {
    if (Math.abs((el._eqMin || 0) - target) > 0.5) {
      el._eqMin = target;
      el.style.minHeight = `${target}px`;
      if (ro) {
        ro.unobserve(el);
        rowLayoutReobserve.add(el);
      }
    }
  }
  if (rowLayoutReobserve.size && !rowLayoutReobserveRaf) {
    rowLayoutReobserveRaf = requestAnimationFrame(() => {
      rowLayoutReobserveRaf = 0;
      const ro2 = rowLayout.observer;
      for (const el of rowLayoutReobserve) {
        if (ro2 && el.isConnected && el._eqPair) ro2.observe(el);
      }
      rowLayoutReobserve.clear();
    });
  }
}

// Drops imposed heights and re-observes the clauses: observe() always delivers one initial
// notification, so every pair is re-measured from the layout the browser does anyway.
function resetEqualizedRowHeights(rowId) {
  resetRowPairs(rowId ? [getRowElements(rowId)] : Array.from(rowLayout.rows.values()));
}

function resetRowPairs(pairs) {
  const ro = rowLayout.observer;
  for (const { l, r } of pairs) {
    if (!l || !r || !l.isConnected) continue;
    for (const el of [l, r]) {
      if (el._eqMin) {
        el._eqMin = 0;
        el.style.minHeight = '';
      }
      el._eqNat = 0;
      if (ro) {
        ro.unobserve(el);
        ro.observe(el);
      }
    }
  }
}
