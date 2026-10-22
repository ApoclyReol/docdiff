// Runtime of the comparison Web Worker.
//
// `scripts/build.py` concatenates jsdiff, `src/js/04-core.js`, `src/js/04a-align.js` and this file
// into one classic worker script and embeds it in the page as a string; the page starts it from a
// Blob URL (see `src/js/06a-compare-async.js`). No network access, no storage.
//
// Protocol (page -> worker):  { type: 'compare', id, request }
//           (worker -> page):  { type: 'ready' }
//                              { type: 'progress', id, value }        value in [0, 1]
//                              { type: 'result', id, result }
//                              { type: 'error', id, message }

let workerLabels = {};

// 04-core.js looks up a few localized labels (e.g. the header/footer reference code) via t().
function t(key) {
  return workerLabels[key] || key;
}

self.onmessage = event => {
  const msg = event.data || {};
  if (msg.type !== 'compare') return;
  const { id, request } = msg;
  try {
    workerLabels = request.labels || {};
    let lastSent = -1;
    const result = computeComparison(request, value => {
      if (value - lastSent >= 0.02 || value === 1) {
        lastSent = value;
        self.postMessage({ type: 'progress', id, value });
      }
    });
    self.postMessage({ type: 'result', id, result });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: String((err && err.message) || err) });
  }
};

self.postMessage({ type: 'ready' });
