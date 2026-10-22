// Comparison orchestration: runs parsing, alignment and word diffs in a Web Worker (started from
// a Blob URL, allowed by the CSP's `worker-src blob:`), shows progress, and makes sure only the
// latest comparison is applied. Falls back to the synchronous main-thread path when workers are
// unavailable, so the app never breaks.

// Replaced at build time by scripts/build.py with jsdiff + 04-core.js + 04a-align.js +
// src/worker/compare-worker.js as a string literal.
const DIFF_WORKER_SOURCE = "__DIFF_WORKER_SOURCE__";

// Small inputs are compared synchronously: alignment takes a few milliseconds and the result is
// on screen in the same frame (no flash of the previous comparison, and synchronous callers such
// as the sample loader in the export menu keep working).
const SYNC_COMPARE_MAX_CHARS = 40000;
const WORKER_READY_TIMEOUT_MS = 4000;
const COMPARE_STATUS_DELAY_MS = 150;

let compareSeq = 0;
let lastComparison = null;

const diffWorker = {
  url: null,
  worker: null,
  ready: false,
  broken: false,
  job: null, // { id, resolve, reject, onProgress }
  readyTimer: null,
};

function buildComparisonRequest() {
  return {
    leftText: state.leftText || '',
    rightText: state.rightText || '',
    ignoreHeadersFooters: state.ignoreHeadersFooters,
    labels: { typeHf: t('typeHf') },
  };
}

function canUseDiffWorker() {
  return (
    !diffWorker.broken &&
    typeof Worker !== 'undefined' &&
    typeof Blob !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function' &&
    !DIFF_WORKER_SOURCE.startsWith('__')
  );
}

function getBlobWorkerUrl(source) {
  return URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
}

function markDiffWorkerBroken(reason) {
  diffWorker.broken = true;
  stopDiffWorker();
  const job = diffWorker.job;
  diffWorker.job = null;
  if (job) job.reject({ workerUnavailable: true, reason });
}

function stopDiffWorker() {
  clearTimeout(diffWorker.readyTimer);
  if (diffWorker.worker) diffWorker.worker.terminate();
  diffWorker.worker = null;
  diffWorker.ready = false;
}

function startDiffWorker() {
  if (diffWorker.worker) return diffWorker.worker;
  try {
    if (!diffWorker.url) diffWorker.url = getBlobWorkerUrl(DIFF_WORKER_SOURCE);
    const worker = new Worker(diffWorker.url);
    diffWorker.worker = worker;
    diffWorker.ready = false;
    worker.onmessage = event => onDiffWorkerMessage(worker, event.data || {});
    worker.onerror = event => {
      if (event && event.preventDefault) event.preventDefault();
      if (worker !== diffWorker.worker) return;
      if (!diffWorker.ready) {
        markDiffWorkerBroken('load');
      } else {
        // A crash while computing: drop this worker, fail the job (it falls back to sync).
        stopDiffWorker();
        const job = diffWorker.job;
        diffWorker.job = null;
        if (job) job.reject({ workerFailed: true });
      }
    };
    worker.onmessageerror = () => {
      const job = diffWorker.job;
      diffWorker.job = null;
      stopDiffWorker();
      if (job) job.reject({ workerFailed: true });
    };
    // Some environments block blob workers without reporting an error event.
    diffWorker.readyTimer = setTimeout(() => {
      if (worker === diffWorker.worker && !diffWorker.ready) markDiffWorkerBroken('timeout');
    }, WORKER_READY_TIMEOUT_MS);
    return worker;
  } catch (err) {
    markDiffWorkerBroken('construct');
    return null;
  }
}

function onDiffWorkerMessage(worker, msg) {
  if (worker !== diffWorker.worker) return;
  if (msg.type === 'ready') {
    diffWorker.ready = true;
    clearTimeout(diffWorker.readyTimer);
    return;
  }
  const job = diffWorker.job;
  if (!job || msg.id !== job.id) return;
  if (msg.type === 'progress') {
    if (job.onProgress) job.onProgress(msg.value);
  } else if (msg.type === 'result') {
    diffWorker.job = null;
    job.resolve(msg.result);
  } else if (msg.type === 'error') {
    diffWorker.job = null;
    job.reject({ workerFailed: true, message: msg.message });
  }
}

// Cancels the running worker job (if any). A busy worker cannot be interrupted, so it is
// terminated and a fresh one is started for the next request.
function cancelDiffWorkerJob() {
  const job = diffWorker.job;
  if (!job) return;
  diffWorker.job = null;
  stopDiffWorker();
  job.reject({ cancelled: true });
}

// Runs computeComparison(request) in the worker. Resolves with the result; rejects with
// { cancelled } when superseded, or { workerUnavailable | workerFailed } (caller falls back).
function runComparisonInWorker(request, onProgress) {
  cancelDiffWorkerJob();
  return new Promise((resolve, reject) => {
    if (!canUseDiffWorker()) {
      reject({ workerUnavailable: true });
      return;
    }
    const worker = startDiffWorker();
    if (!worker) {
      reject({ workerUnavailable: true });
      return;
    }
    const id = (runComparisonInWorker.nextId = (runComparisonInWorker.nextId || 0) + 1);
    diffWorker.job = { id, resolve, reject, onProgress };
    try {
      worker.postMessage({ type: 'compare', id, request });
    } catch (err) {
      diffWorker.job = null;
      reject({ workerFailed: true });
    }
  });
}

// Entry point for every (re-)comparison. Returns a promise that settles once the result for
// this call has been applied, or once it was superseded by a newer call.
function runComparison(options = {}) {
  const seq = ++compareSeq;
  const request = buildComparisonRequest();

  const incremental = computeIncrementalComparison(lastComparison, request);
  if (incremental) {
    cancelDiffWorkerJob();
    hideCompareStatus();
    applyComparisonResult(request, incremental.result, { changedRowIds: incremental.changedRowIds });
    return Promise.resolve();
  }

  const size = request.leftText.length + request.rightText.length;
  if (options.sync || size <= SYNC_COMPARE_MAX_CHARS || !canUseDiffWorker()) {
    cancelDiffWorkerJob();
    hideCompareStatus();
    applyComparisonResult(request, computeComparison(request));
    return Promise.resolve();
  }

  showCompareStatus(seq, 0);
  return runComparisonInWorker(request, value => showCompareStatus(seq, value))
    .catch(err => {
      if (err && err.cancelled) return null;
      if (seq !== compareSeq) return null;
      // Worker unavailable or failed: compute on the main thread so the app keeps working.
      return computeComparison(request);
    })
    .then(result => {
      if (!result || seq !== compareSeq) return; // superseded by a newer comparison
      // The first comparison is announced by applyComparisonResult(); re-comparisons
      // (header/footer filter, undo of a large change, …) are announced here.
      const wasComparing = document.body.classList.contains('is-comparing');
      applyComparisonResult(request, result);
      showCompareDone(seq, wasComparing);
    });
}

/* ── Accessible progress status ─────────────────────────────────────────── */

const compareStatus = { el: null, showTimer: null, hideTimer: null, seq: 0 };

function getCompareStatusEl() {
  if (compareStatus.el) return compareStatus.el;
  const el = document.createElement('div');
  el.id = 'compare-status';
  el.className = 'compare-status';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  // Only the text is announced; the percentage changes often and is visual only.
  el.innerHTML =
    '<span class="compare-status-spinner" aria-hidden="true"></span><span class="compare-status-text"></span><span class="compare-status-pct" aria-hidden="true"></span>';
  document.body.appendChild(el);
  compareStatus.el = el;
  return el;
}

function showCompareStatus(seq, value) {
  if (seq !== compareSeq) return;
  const el = getCompareStatusEl();
  clearTimeout(compareStatus.hideTimer);
  const pct = Math.max(0, Math.min(100, Math.round((value || 0) * 100)));
  const textEl = el.querySelector('.compare-status-text');
  if (textEl.textContent !== t('compareBusy')) textEl.textContent = t('compareBusy');
  el.querySelector('.compare-status-pct').textContent = pct > 0 ? `${pct} %` : '';
  el.classList.remove('is-done');
  document.body.classList.add('is-diff-busy');
  if (compareStatus.seq !== seq) {
    compareStatus.seq = seq;
    clearTimeout(compareStatus.showTimer);
    // Only show the pill if the comparison takes noticeable time.
    compareStatus.showTimer = setTimeout(() => {
      if (document.body.classList.contains('is-diff-busy')) el.classList.add('is-visible');
    }, COMPARE_STATUS_DELAY_MS);
  }
}

function showCompareDone(seq, announceResult) {
  if (seq !== compareSeq || !compareStatus.el || !announceResult) {
    hideCompareStatus();
    return;
  }
  const el = compareStatus.el;
  clearTimeout(compareStatus.showTimer);
  document.body.classList.remove('is-diff-busy');
  el.querySelector('.compare-status-pct').textContent = '';
  const n = state.changeRows.length;
  el.querySelector('.compare-status-text').textContent =
    n === 0 ? t('announceIdentical') : n === 1 ? t('announceComparedOne') : formatMsg('announceCompared', { n });
  el.classList.add('is-done');
  compareStatus.hideTimer = setTimeout(() => {
    el.classList.remove('is-visible', 'is-done');
  }, 1600);
}

function hideCompareStatus() {
  document.body.classList.remove('is-diff-busy');
  compareStatus.seq = 0;
  if (!compareStatus.el) return;
  clearTimeout(compareStatus.showTimer);
  clearTimeout(compareStatus.hideTimer);
  compareStatus.el.classList.remove('is-visible', 'is-done');
}

/* ── PDF.js in a real worker ────────────────────────────────────────────── */

// The PDF.js worker source ships in a non-executed <script type="text/plain"> element. It is
// started as a Blob worker; if that is impossible the script is executed on the page instead,
// which makes PDF.js fall back to its built-in main-thread ("fake") worker.
let pdfJsWorkerSetup = null;

function ensurePdfJsWorker() {
  if (pdfJsWorkerSetup) return pdfJsWorkerSetup;
  pdfJsWorkerSetup = new Promise(resolve => {
    const lib = window.pdfjsLib;
    const srcEl = document.getElementById('pdfjs-worker-source');
    if (!lib || !srcEl) {
      resolve();
      return;
    }
    const fallbackToMainThread = () => {
      if (!window.pdfjsWorker) {
        const script = document.createElement('script');
        script.textContent = srcEl.textContent;
        document.head.appendChild(script);
      }
      lib.GlobalWorkerOptions.workerPort = null;
      resolve();
    };
    if (!canUseDiffWorker()) {
      fallbackToMainThread();
      return;
    }
    let worker;
    try {
      worker = new Worker(getBlobWorkerUrl(srcEl.textContent));
    } catch (err) {
      fallbackToMainThread();
      return;
    }
    // PDF.js workers announce themselves with a "ready" message once initialized.
    const timer = setTimeout(() => {
      worker.terminate();
      fallbackToMainThread();
    }, WORKER_READY_TIMEOUT_MS);
    const onFirstMessage = () => {
      clearTimeout(timer);
      worker.removeEventListener('message', onFirstMessage);
      worker.removeEventListener('error', onError);
      lib.GlobalWorkerOptions.workerPort = worker;
      resolve();
    };
    const onError = event => {
      if (event && event.preventDefault) event.preventDefault();
      clearTimeout(timer);
      worker.removeEventListener('message', onFirstMessage);
      worker.terminate();
      fallbackToMainThread();
    };
    worker.addEventListener('message', onFirstMessage);
    worker.addEventListener('error', onError);
  });
  return pdfJsWorkerSetup;
}

// Printing needs every page in the DOM, including pages still queued for chunked rendering.
window.addEventListener('beforeprint', () => flushPaneRender());
