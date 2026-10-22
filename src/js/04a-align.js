// Alignment engine and comparison pipeline.
//
// Everything in this file is pure (no DOM access) so that `scripts/build.py` can bundle it,
// together with jsdiff and `04-core.js`, into the Blob Web Worker that runs comparisons off
// the main thread (see `06a-compare-async.js` and `src/worker/compare-worker.js`). The very
// same functions also run on the main thread as the synchronous fallback.

const ALIGN_GAP_PENALTY = -0.22;
// Middles up to this many DP cells are aligned with one global Needleman-Wunsch pass,
// exactly as before (~500 x 500 paragraphs, ≈ 20 pages against 20 pages).
const ALIGN_FULL_DP_MAX_CELLS = 250000;
// Gaps between anchors up to this size still get the exact DP; larger ones use a banded DP
// so memory stays bounded (the exact DP needs 5 bytes per cell).
const ALIGN_EXACT_DP_MAX_CELLS = 4000000;

// Global Needleman-Wunsch alignment of two block lists (O(n·m) time and memory).
function alignBlocksExact(midLeft, midRight, onCells) {
  const n = midLeft.length;
  const m = midRight.length;
  if (n === 0 || m === 0) return alignBlocksTrivial(midLeft, midRight);

  const dp = Array.from({ length: n + 1 }, () => new Float32Array(m + 1));
  const ptr = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  const GAP_PENALTY = ALIGN_GAP_PENALTY;

  for (let i = 1; i <= n; i++) {
    dp[i][0] = i * GAP_PENALTY;
    ptr[i][0] = 2;
  }
  for (let j = 1; j <= m; j++) {
    dp[0][j] = j * GAP_PENALTY;
    ptr[0][j] = 3;
  }

  const reportEvery = Math.max(1, Math.floor(250000 / m));
  for (let i = 1; i <= n; i++) {
    const rowPrev = dp[i - 1];
    const row = dp[i];
    const ptrRow = ptr[i];
    const leftBlock = midLeft[i - 1];
    for (let j = 1; j <= m; j++) {
      const sim = computeBlockSimilarity(leftBlock, midRight[j - 1]);
      const matchScore = sim >= 0.28 ? sim : -0.5;
      const scoreDiag = rowPrev[j - 1] + matchScore;
      const scoreUp = rowPrev[j] + GAP_PENALTY;
      const scoreLeft = row[j - 1] + GAP_PENALTY;

      if (scoreDiag >= scoreUp && scoreDiag >= scoreLeft) {
        row[j] = scoreDiag;
        ptrRow[j] = 1;
      } else if (scoreUp >= scoreLeft) {
        row[j] = scoreUp;
        ptrRow[j] = 2;
      } else {
        row[j] = scoreLeft;
        ptrRow[j] = 3;
      }
    }
    if (onCells && i % reportEvery === 0) onCells(reportEvery * m);
  }
  if (onCells) onCells((n % reportEvery) * m);

  const pairs = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const move = ptr[i][j];
    if (i > 0 && j > 0 && move === 1) {
      pairs.push({ left: midLeft[i - 1], right: midRight[j - 1] });
      i--;
      j--;
    } else if (i > 0 && (j === 0 || move === 2)) {
      pairs.push({ left: midLeft[i - 1], right: null });
      i--;
    } else {
      pairs.push({ left: null, right: midRight[j - 1] });
      j--;
    }
  }
  pairs.reverse();
  return pairs;
}

function alignBlocksTrivial(midLeft, midRight) {
  const pairs = [];
  for (const b of midLeft) pairs.push({ left: b, right: null });
  for (const b of midRight) pairs.push({ left: null, right: b });
  return pairs;
}

// Same scoring as alignBlocksExact, restricted to a diagonal band so that memory and time are
// O((n + m) · band). Only used for gaps that are too large for the exact DP and have no anchors.
function alignBlocksBanded(midLeft, midRight, maxCells, onCells) {
  const n = midLeft.length;
  const m = midRight.length;
  if (n === 0 || m === 0) return alignBlocksTrivial(midLeft, midRight);

  const slope = m / n;
  const minHalf = Math.ceil(Math.max(slope, 1)) + 2;
  const half = Math.max(minHalf, Math.floor(maxCells / (2 * (n + 1))));
  const width = 2 * half + 1;
  const lo = new Int32Array(n + 1);
  const hi = new Int32Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const center = Math.round(i * slope);
    lo[i] = Math.max(0, center - half);
    hi[i] = Math.min(m, center + half);
  }
  // Make consecutive bands overlap so a monotone path always exists.
  for (let i = 1; i <= n; i++) {
    if (lo[i] > hi[i - 1]) lo[i] = hi[i - 1];
  }

  const NEG = -Infinity;
  const score = new Float32Array((n + 1) * width).fill(NEG);
  const ptr = new Uint8Array((n + 1) * width);
  const at = (i, j) => (j < lo[i] || j > hi[i] ? -1 : i * width + (j - lo[i]));

  for (let j = lo[0]; j <= hi[0]; j++) {
    score[at(0, j)] = j * ALIGN_GAP_PENALTY;
    ptr[at(0, j)] = 3;
  }

  for (let i = 1; i <= n; i++) {
    const leftBlock = midLeft[i - 1];
    for (let j = lo[i]; j <= hi[i]; j++) {
      const k = at(i, j);
      if (j === 0) {
        score[k] = i * ALIGN_GAP_PENALTY;
        ptr[k] = 2;
        continue;
      }
      const kDiag = at(i - 1, j - 1);
      const kUp = at(i - 1, j);
      const kLeft = at(i, j - 1);
      let scoreDiag = NEG;
      if (kDiag >= 0 && score[kDiag] !== NEG) {
        const sim = computeBlockSimilarity(leftBlock, midRight[j - 1]);
        scoreDiag = score[kDiag] + (sim >= 0.28 ? sim : -0.5);
      }
      const scoreUp = kUp >= 0 ? score[kUp] + ALIGN_GAP_PENALTY : NEG;
      const scoreLeft = kLeft >= 0 ? score[kLeft] + ALIGN_GAP_PENALTY : NEG;
      if (scoreDiag >= scoreUp && scoreDiag >= scoreLeft) {
        score[k] = scoreDiag;
        ptr[k] = 1;
      } else if (scoreUp >= scoreLeft) {
        score[k] = scoreUp;
        ptr[k] = 2;
      } else {
        score[k] = scoreLeft;
        ptr[k] = 3;
      }
    }
    if (onCells) onCells(hi[i] - lo[i] + 1);
  }

  const pairs = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const move = ptr[at(i, j)];
    if (i > 0 && j > 0 && move === 1) {
      pairs.push({ left: midLeft[i - 1], right: midRight[j - 1] });
      i--;
      j--;
    } else if (i > 0 && (j === 0 || move === 2)) {
      pairs.push({ left: midLeft[i - 1], right: null });
      i--;
    } else {
      pairs.push({ left: null, right: midRight[j - 1] });
      j--;
    }
  }
  pairs.reverse();
  return pairs;
}

// Patience-style anchors: blocks whose text (ignoring renumbering) occurs exactly once on each side, reduced to the
// longest chain that is increasing on both sides. Returns [[leftIdx, rightIdx], ...].
function findUniqueBlockAnchors(midLeft, midRight) {
  const leftCount = new Map();
  for (let i = 0; i < midLeft.length; i++) {
    const key = blockAlignKey(midLeft[i]);
    leftCount.set(key, leftCount.has(key) ? -1 : i);
  }
  const rightIndex = new Map();
  for (let j = 0; j < midRight.length; j++) {
    const key = blockAlignKey(midRight[j]);
    rightIndex.set(key, rightIndex.has(key) ? -1 : j);
  }

  const candidates = [];
  for (let i = 0; i < midLeft.length; i++) {
    const key = blockAlignKey(midLeft[i]);
    if (leftCount.get(key) !== i) continue;
    const j = rightIndex.get(key);
    if (j === undefined || j < 0) continue;
    if (midLeft[i].isHeaderFooter !== midRight[j].isHeaderFooter) continue;
    candidates.push([i, j]);
  }
  if (candidates.length === 0) return [];

  // Longest increasing subsequence on the right index (left indices are already increasing).
  const tails = [];
  const prev = new Int32Array(candidates.length).fill(-1);
  for (let c = 0; c < candidates.length; c++) {
    const j = candidates[c][1];
    let loIdx = 0;
    let hiIdx = tails.length;
    while (loIdx < hiIdx) {
      const mid = (loIdx + hiIdx) >> 1;
      if (candidates[tails[mid]][1] < j) loIdx = mid + 1;
      else hiIdx = mid;
    }
    if (loIdx > 0) prev[c] = tails[loIdx - 1];
    tails[loIdx] = c;
  }
  const chain = [];
  for (let c = tails[tails.length - 1]; c >= 0; c = prev[c]) chain.push(candidates[c]);
  chain.reverse();
  return chain;
}

// Aligns the differing middle of two documents. Small and medium middles use one global DP
// (identical to the historical behaviour); very long ones are first split at unique identical
// blocks so the DP only runs inside the gaps between them.
function alignMiddleBlocks(midLeft, midRight, onProgress) {
  const n = midLeft.length;
  const m = midRight.length;
  const totalCells = n * m;
  let doneCells = 0;
  let lastReported = -1;
  const onCells = onProgress
    ? cells => {
        doneCells += cells;
        const frac = totalCells ? Math.min(1, doneCells / totalCells) : 1;
        if (frac - lastReported >= 0.02) {
          lastReported = frac;
          onProgress(frac);
        }
      }
    : null;

  if (totalCells <= ALIGN_FULL_DP_MAX_CELLS) {
    return alignBlocksExact(midLeft, midRight, onCells);
  }

  const anchors = findUniqueBlockAnchors(midLeft, midRight);
  // Progress is measured against the cells that will actually be computed.
  let plannedCells = 0;
  let pi = 0;
  let pj = 0;
  for (const [ai, aj] of anchors.concat([[n, m]])) {
    const cells = (ai - pi) * (aj - pj);
    plannedCells += cells <= ALIGN_EXACT_DP_MAX_CELLS ? cells : Math.min(cells, ALIGN_EXACT_DP_MAX_CELLS * 2);
    pi = ai + 1;
    pj = aj + 1;
  }
  const scale = plannedCells > 0 ? totalCells / plannedCells : 1;
  const scaledOnCells = onCells ? cells => onCells(cells * scale) : null;
  const alignGapScaled = (gapLeft, gapRight) => {
    const cells = gapLeft.length * gapRight.length;
    if (cells <= ALIGN_EXACT_DP_MAX_CELLS) return alignBlocksExact(gapLeft, gapRight, scaledOnCells);
    return alignBlocksBanded(gapLeft, gapRight, ALIGN_EXACT_DP_MAX_CELLS, scaledOnCells);
  };

  const pairs = [];
  let prevI = 0;
  let prevJ = 0;
  for (const [ai, aj] of anchors) {
    for (const p of alignGapScaled(midLeft.slice(prevI, ai), midRight.slice(prevJ, aj))) pairs.push(p);
    pairs.push({ left: midLeft[ai], right: midRight[aj] });
    prevI = ai + 1;
    prevJ = aj + 1;
  }
  for (const p of alignGapScaled(midLeft.slice(prevI), midRight.slice(prevJ))) pairs.push(p);
  if (onProgress) onProgress(1);
  return pairs;
}

// Full comparison pipeline: parse both texts, reconcile and filter headers/footers, align.
// Pure and structured-clone friendly; this is what the worker runs and what the synchronous
// fallback runs on the main thread.
function computeComparison(request, onProgress) {
  const report = typeof onProgress === 'function' ? onProgress : null;
  const prepared = prepareComparisonBlocks(
    request.leftText || '',
    request.rightText || '',
    request.ignoreHeadersFooters
  );
  if (report) report(0.05);

  const { allLeftBlocks, allRightBlocks, leftBlocks, rightBlocks } = prepared;
  let alignedRows = [];
  if (leftBlocks.length > 0 && rightBlocks.length > 0) {
    alignedRows = alignDocumentBlocks(
      leftBlocks,
      rightBlocks,
      report ? frac => report(0.05 + frac * 0.9) : undefined
    );
  }
  if (report) report(1);

  for (const b of allLeftBlocks) stripAlignmentFeatures(b);
  for (const b of allRightBlocks) stripAlignmentFeatures(b);

  return {
    allLeftBlocks,
    allRightBlocks,
    leftBlocks,
    rightBlocks,
    filteredHfCount: prepared.hfCount,
    leftPages: countPages(leftBlocks),
    rightPages: countPages(rightBlocks),
    alignedRows,
  };
}

function countPages(blocks) {
  return blocks.reduce((mx, b) => Math.max(mx, b.pageNum || 1), 0);
}

// Tokenized word lists are only needed for alignment; dropping them keeps the result small
// when it is posted from the worker to the page.
const ALIGNMENT_ONLY_BLOCK_KEYS = ['words', 'wordSet', 'wordCounts'];

function stripAlignmentFeatures(block) {
  for (const key of ALIGNMENT_ONLY_BLOCK_KEYS) delete block[key];
}

function blocksEquivalent(a, b, ignoreText) {
  for (const key of Object.keys(a)) {
    if (ALIGNMENT_ONLY_BLOCK_KEYS.includes(key)) continue;
    if (ignoreText && (key === 'text' || key === 'alignKey' || key === 'refCode' || key === 'kind' ||
      key === 'isHeading' || key === 'numberingMarker' || key === 'indent')) {
      continue;
    }
    if (a[key] !== b[key]) return false;
  }
  return true;
}

const MOVE_KEYS = ['moved', 'movedToRowId', 'movedFromRowId'];

// Fast path for edits, reverts, undo and redo of long documents: when the left text and the
// options are unchanged
// and the new right text differs from the previous one in exactly one block (same block count;
// every other block identical, including page, section and header/footer metadata), the previous
// alignment is kept and only that row is re-diffed. Returns { result, changedRowIds } or null
// when a full re-alignment is required. This is an approximation of a full comparison, so the
// page re-checks it with a full comparison in the worker (see runComparison).
function computeIncrementalComparison(prev, request) {
  if (!prev || !prev.request || !prev.result) return null;
  const pr = prev.request;
  if (
    pr.leftText !== request.leftText ||
    pr.ignoreHeadersFooters !== request.ignoreHeadersFooters ||
    (pr.labels && pr.labels.typeHf) !== (request.labels && request.labels.typeHf)
  ) {
    return null;
  }
  const old = prev.result;
  if (!old.alignedRows.length || !old.allLeftBlocks) return null;

  const prepared = prepareComparisonBlocks(
    request.leftText || '',
    request.rightText || '',
    request.ignoreHeadersFooters
  );
  const { allLeftBlocks, allRightBlocks } = prepared;
  if (
    allLeftBlocks.length !== old.allLeftBlocks.length ||
    allRightBlocks.length !== old.allRightBlocks.length ||
    prepared.hfCount !== old.filteredHfCount
  ) {
    return null;
  }
  // Header/footer reconciliation looks at both documents, so the left side must be re-checked.
  for (let i = 0; i < allLeftBlocks.length; i++) {
    if (!blocksEquivalent(old.allLeftBlocks[i], allLeftBlocks[i], false)) return null;
  }
  let changedIdx = -1;
  for (let i = 0; i < allRightBlocks.length; i++) {
    const a = old.allRightBlocks[i];
    const b = allRightBlocks[i];
    if (a.text === b.text) {
      if (!blocksEquivalent(a, b, false)) return null;
      continue;
    }
    if (changedIdx !== -1 || !blocksEquivalent(a, b, true)) return null;
    changedIdx = i;
  }

  const blockMap = new Map();
  for (let i = 0; i < allLeftBlocks.length; i++) blockMap.set(old.allLeftBlocks[i], allLeftBlocks[i]);
  for (let i = 0; i < allRightBlocks.length; i++) blockMap.set(old.allRightBlocks[i], allRightBlocks[i]);
  const leftBlocks = old.leftBlocks.map(b => blockMap.get(b));
  const rightBlocks = old.rightBlocks.map(b => blockMap.get(b));
  if (leftBlocks.some(b => !b) || rightBlocks.some(b => !b)) return null;

  const changedBlock = changedIdx === -1 ? null : allRightBlocks[changedIdx];
  let changedRowId = null;
  let unmatchedEdit = false;
  const alignedRows = old.alignedRows.map((row, idx) => {
    const left = row.leftBlock ? blockMap.get(row.leftBlock) : null;
    const right = row.rightBlock ? blockMap.get(row.rightBlock) : null;
    if (changedBlock && right === changedBlock) {
      // Only a matched pair keeps its row; an edited insertion may now match a deleted block.
      if (!left) unmatchedEdit = true;
      changedRowId = row.id;
      return buildAlignedRow({ left, right }, idx, row.pageNum);
    }
    const copy = Object.assign({}, row, { leftBlock: left, rightBlock: right });
    for (const key of MOVE_KEYS) delete copy[key];
    return copy;
  });

  if (changedBlock) {
    const changedRow = alignedRows.find(r => r.id === changedRowId);
    if (!changedRow || unmatchedEdit) return null; // hidden header/footer, or unmatched block
    // Keep the old pairing only if the alignment would still consider the blocks a match.
    if (
      changedRow.leftBlock &&
      changedRow.type === 'modified' &&
      computeBlockSimilarity(changedRow.leftBlock, changedRow.rightBlock) < 0.28
    ) {
      return null;
    }
  }

  markMovedRows(alignedRows);
  const changedRowIds = [];
  for (let i = 0; i < alignedRows.length; i++) {
    const row = alignedRows[i];
    const before = old.alignedRows[i];
    if (row.id === changedRowId || MOVE_KEYS.some(key => row[key] !== before[key])) {
      changedRowIds.push(row.id);
    }
  }

  for (const b of allLeftBlocks) stripAlignmentFeatures(b);
  for (const b of allRightBlocks) stripAlignmentFeatures(b);

  return {
    changedRowIds,
    result: {
      allLeftBlocks,
      allRightBlocks,
      leftBlocks,
      rightBlocks,
      filteredHfCount: prepared.hfCount,
      leftPages: countPages(leftBlocks),
      rightPages: countPages(rightBlocks),
      alignedRows,
    },
  };
}
