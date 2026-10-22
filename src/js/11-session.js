/* ── Work-Loss Protection: Unsaved-Changes Guard & Session Files (.docdiff) ──
 *
 * Nothing is ever written to browser storage. Work is protected in two ways:
 *  1. A dirty flag (inline edits / reverts since the last load, session save or
 *     export) drives the native `beforeunload` prompt and an in-app confirm
 *     dialog in front of every action that would throw those edits away.
 *  2. "Save session" downloads a self-describing JSON file (.docdiff) to the
 *     user's own disk; "Open session" validates it strictly and restores it
 *     through the app's normal entry points (state fields + runComparison).
 *
 * To keep this module isolated from the rest of the code base, it hooks into
 * a few global functions by wrapping them (they are plain function
 * declarations in the shared classic-script scope, so every caller resolves
 * the wrapped version at call time). The wrappers never change behaviour,
 * they only observe it.
 */

const DOCDIFF_APP_VERSION = '1.4.0';
const SESSION_FORMAT_ID = 'docdiff-session';
const SESSION_FORMAT_VERSION = 1;
const SESSION_FILE_EXT = '.docdiff';
const SESSION_MAX_FILE_BYTES = 50 * 1024 * 1024;
const SESSION_MAX_NAME_CHARS = 1024;
const SESSION_MAX_FORMAT_CHARS = 32;
const SESSION_MAX_HISTORY_ENTRIES = 100;
// Undo/redo snapshots are full copies of the right-hand text. Only as many of
// the most recent ones as fit into this budget are written into a session file.
const SESSION_HISTORY_CHAR_BUDGET = 8 * 1024 * 1024;
const SESSION_VIEW_MODES = ['pages', 'split', 'inline'];

const sessionTracker = {
  // Right-hand text as it was last loaded (before any inline edits).
  originalRightText: state.rightText,
  // Right-hand text at the last "clean point" (load, session save, export).
  cleanRightText: state.rightText,
  // Right-hand text seen by the previous runComparison call.
  lastSeenRightText: state.rightText,
  // Set by the edit entry points right before they trigger runComparison.
  editPending: false,
  // Set while a session is being restored, so it is not treated as a fresh load.
  restoring: false,
  // > 0 while a confirmed action is replayed, so it is not guarded twice.
  bypassGuard: 0,
};

function hasOpenInlineEditorChanges() {
  const editor = document.querySelector('.clause-inline-editor');
  if (!editor) return false;
  const clause = editor.closest('.clause[data-row-id]');
  const row = clause && state.alignedRows.find(r => r.id === clause.getAttribute('data-row-id'));
  const baseline = row && row.rightBlock ? row.rightBlock.text : '';
  return editor.value.replace(/\r\n/g, '\n').trim() !== baseline;
}

function isSessionDirty() {
  return state.rightText !== sessionTracker.cleanRightText || hasOpenInlineEditorChanges();
}

function markSessionClean() {
  sessionTracker.cleanRightText = state.rightText;
}

/* ── Hooks into existing entry points ───────────────────────────────────── */
function wrapGlobalFunction(name, makeWrapper) {
  const original = window[name];
  if (typeof original !== 'function') return;
  window[name] = makeWrapper(original);
}

// Every change of the right-hand text flows through runComparison. A change
// that was not announced by an edit entry point is a fresh load and becomes
// the new baseline. The wrapper passes the return value through, so it works
// whether runComparison is synchronous or returns a Promise.
wrapGlobalFunction('runComparison', original =>
  function runComparisonWithSessionTracking() {
    if (state.rightText !== sessionTracker.lastSeenRightText) {
      if (!sessionTracker.editPending && !sessionTracker.restoring) {
        sessionTracker.originalRightText = state.rightText;
        sessionTracker.cleanRightText = state.rightText;
      }
      sessionTracker.lastSeenRightText = state.rightText;
    }
    sessionTracker.editPending = false;
    return original.apply(this, arguments);
  }
);

['pushUndoSnapshot', 'performUndo', 'performRedo'].forEach(name => {
  wrapGlobalFunction(name, original =>
    function markEditPending() {
      sessionTracker.editPending = true;
      return original.apply(this, arguments);
    }
  );
});

wrapGlobalFunction('handleFileUpload', original =>
  async function guardedFileUpload(file, side) {
    if (file && side === 'right' && !sessionTracker.bypassGuard && isSessionDirty()) {
      const ok = await confirmDiscardEdits();
      if (!ok) {
        const input = document.getElementById('file-input-right');
        if (input) input.value = '';
        return undefined;
      }
    }
    return original.apply(this, arguments);
  }
);

wrapGlobalFunction('handleDropFiles', original =>
  async function guardedDropFiles(files, targetSide) {
    const replacesRight = files && (files.length >= 2 || (files.length === 1 && targetSide === 'right'));
    if (replacesRight && !sessionTracker.bypassGuard && isSessionDirty()) {
      if (!(await confirmDiscardEdits())) return undefined;
      sessionTracker.bypassGuard++;
      try {
        return await original.apply(this, arguments);
      } finally {
        sessionTracker.bypassGuard--;
      }
    }
    return original.apply(this, arguments);
  }
);

/* ── Accessible confirm / message dialog ────────────────────────────────── */
const sessionDialog = document.getElementById('session-dialog');
const sessionDialogTitle = document.getElementById('session-dialog-title');
const sessionDialogBody = document.getElementById('session-dialog-body');
const sessionDialogCancel = document.getElementById('session-dialog-cancel');
const sessionDialogConfirm = document.getElementById('session-dialog-confirm');
let sessionDialogResolve = null;

function finishSessionDialog(result) {
  const resolve = sessionDialogResolve;
  sessionDialogResolve = null;
  if (sessionDialog.open) sessionDialog.close();
  if (resolve) resolve(result);
}

function showSessionDialog({ title, body, confirmLabel, cancelLabel }) {
  if (sessionDialogResolve) finishSessionDialog(false);
  hideTooltip();
  sessionDialogTitle.textContent = title;
  sessionDialogBody.textContent = body;
  sessionDialogConfirm.textContent = confirmLabel;
  sessionDialogCancel.hidden = !cancelLabel;
  sessionDialogCancel.textContent = cancelLabel || '';
  sessionDialog.setAttribute('role', cancelLabel ? 'alertdialog' : 'dialog');
  return new Promise(resolve => {
    sessionDialogResolve = resolve;
    // Like the other dialogs, initial focus goes to the title (autofocus) and the
    // browser returns focus to the triggering control when the dialog closes.
    sessionDialog.showModal();
  });
}

sessionDialogConfirm.addEventListener('click', () => finishSessionDialog(true));
sessionDialogCancel.addEventListener('click', () => finishSessionDialog(false));
// Esc or any other way of closing counts as "cancel". The close event is
// dispatched asynchronously, so a late one from a previous dialog must not
// cancel a dialog that has been reopened in the meantime.
sessionDialog.addEventListener('close', () => {
  if (!sessionDialog.open) finishSessionDialog(false);
});

function confirmDiscardEdits() {
  return showSessionDialog({
    title: t('sessionDiscardTitle'),
    body: t('sessionDiscardBody'),
    confirmLabel: t('sessionDiscardConfirm'),
    cancelLabel: t('cancel'),
  });
}

function showSessionError(messageKey) {
  return showSessionDialog({
    title: t('sessionErrorTitle'),
    body: t(messageKey),
    confirmLabel: t('sessionOk'),
  });
}

/* ── Guards in front of in-app actions that discard edits ──────────────── */
const SESSION_GUARDED_CLICKS = [
  { selector: '#btn-clear' },
  { selector: '#btn-clear-right' },
  { selector: '#lp-clear-right' },
  { selector: '#btn-swap-docs' },
  { selector: '.btn-load-sample' },
  { selector: '#btn-help-sample' },
  {
    // The paste dialog is pre-filled with the edited text; only an actual
    // change of the right-hand text discards edits.
    selector: '#btn-apply-modal',
    when: () => {
      const ta = document.getElementById('textarea-right');
      return !!ta && ta.value !== pasteModalShown.right;
    },
  },
  {
    // Toggling the language while the sample is shown reloads the sample.
    selector: '#btn-lang',
    when: () => state.leftFormat === 'DEMO' && state.rightFormat === 'DEMO',
  },
];

document.addEventListener(
  'click',
  e => {
    if (sessionTracker.bypassGuard || !(e.target instanceof Element)) return;
    let matched = null;
    for (const guard of SESSION_GUARDED_CLICKS) {
      const el = e.target.closest(guard.selector);
      if (el && (!guard.when || guard.when())) {
        matched = el;
        break;
      }
    }
    if (!matched || !isSessionDirty()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    confirmDiscardEdits().then(ok => {
      if (!ok || !matched.isConnected) return;
      sessionTracker.bypassGuard++;
      try {
        matched.click();
      } finally {
        sessionTracker.bypassGuard--;
      }
    });
  },
  true
);

window.addEventListener('beforeunload', e => {
  if (!isSessionDirty()) return undefined;
  e.preventDefault();
  // Legacy browsers need returnValue to be set to show the native prompt.
  e.returnValue = '';
  return '';
});

/* ── Saving a session ───────────────────────────────────────────────────── */
function sanitizeSessionFileStem(name, fallback) {
  const stem = String(name || '')
    .replace(/\.[^.]+$/, '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '')
    .slice(0, 60);
  return stem || fallback;
}

function buildSessionFileName() {
  const left = sanitizeSessionFileStem(state.leftName, 'Original');
  const right = sanitizeSessionFileStem(state.rightName, 'Revised');
  return `${left}_vs_${right}${SESSION_FILE_EXT}`;
}

// Keeps the most recent snapshots that fit into the remaining budget.
function takeRecentHistory(stack, budget) {
  const kept = [];
  let used = 0;
  for (let i = stack.length - 1; i >= 0 && kept.length < SESSION_MAX_HISTORY_ENTRIES; i--) {
    const entry = stack[i];
    if (typeof entry !== 'string' || used + entry.length > budget) break;
    used += entry.length;
    kept.unshift(entry);
  }
  return { kept, used };
}

function buildSessionPayload() {
  const redo = takeRecentHistory(state.redoStack, SESSION_HISTORY_CHAR_BUDGET);
  const undo = takeRecentHistory(state.undoStack, SESSION_HISTORY_CHAR_BUDGET - redo.used);
  return {
    format: SESSION_FORMAT_ID,
    version: SESSION_FORMAT_VERSION,
    app: 'Doc Diff',
    appVersion: DOCDIFF_APP_VERSION,
    savedAt: new Date().toISOString(),
    documents: {
      left: {
        name: state.leftName,
        format: state.leftFormat,
        text: state.leftText,
      },
      right: {
        name: state.rightName,
        format: state.rightFormat,
        originalText: sessionTracker.originalRightText,
        text: state.rightText,
      },
    },
    view: {
      mode: state.viewMode,
      onlyChanges: !!state.onlyChanges,
      ignoreHeadersFooters: !!state.ignoreHeadersFooters,
    },
    history: {
      undo: undo.kept,
      redo: redo.kept,
    },
  };
}

function downloadSessionFile(json, filename) {
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function saveSession() {
  if (!state.leftText.trim() && !state.rightText.trim()) {
    showSessionDialog({
      title: t('sessionNothingTitle'),
      body: t('sessionNothingBody'),
      confirmLabel: t('sessionOk'),
    });
    return;
  }
  const json = JSON.stringify(buildSessionPayload(), null, 1);
  downloadSessionFile(json, buildSessionFileName());
  markSessionClean();
}

/* ── Opening a session: strict validation, then restore ─────────────────── */
class SessionFileError extends Error {
  constructor(messageKey) {
    super(messageKey);
    this.messageKey = messageKey;
  }
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function expectString(value, maxChars) {
  if (typeof value !== 'string' || value.length > maxChars) {
    throw new SessionFileError('sessionErrorInvalid');
  }
  return value;
}

function expectBoolean(value) {
  if (typeof value !== 'boolean') throw new SessionFileError('sessionErrorInvalid');
  return value;
}

function expectStringArray(value) {
  if (!Array.isArray(value) || value.length > SESSION_MAX_HISTORY_ENTRIES) {
    throw new SessionFileError('sessionErrorInvalid');
  }
  return value.map(entry => expectString(entry, SESSION_MAX_FILE_BYTES));
}

function expectFormatTag(value) {
  const tag = expectString(value, SESSION_MAX_FORMAT_CHARS);
  if (!/^[A-Za-z0-9_-]*$/.test(tag)) throw new SessionFileError('sessionErrorInvalid');
  return tag;
}

// Returns a fresh, fully validated object; throws SessionFileError otherwise.
function validateSessionData(raw) {
  if (!isPlainObject(raw) || raw.format !== SESSION_FORMAT_ID) {
    throw new SessionFileError('sessionErrorInvalid');
  }
  if (!Number.isInteger(raw.version) || raw.version < 1) {
    throw new SessionFileError('sessionErrorInvalid');
  }
  if (raw.version > SESSION_FORMAT_VERSION) {
    throw new SessionFileError('sessionErrorVersion');
  }
  expectString(raw.appVersion, 64);
  expectString(raw.savedAt, 64);

  const docs = raw.documents;
  if (!isPlainObject(docs) || !isPlainObject(docs.left) || !isPlainObject(docs.right)) {
    throw new SessionFileError('sessionErrorInvalid');
  }
  const view = raw.view;
  if (!isPlainObject(view) || !SESSION_VIEW_MODES.includes(view.mode)) {
    throw new SessionFileError('sessionErrorInvalid');
  }
  let history = { undo: [], redo: [] };
  if (raw.history !== undefined) {
    if (!isPlainObject(raw.history)) throw new SessionFileError('sessionErrorInvalid');
    history = {
      undo: expectStringArray(raw.history.undo),
      redo: expectStringArray(raw.history.redo),
    };
  }

  const result = {
    left: {
      name: expectString(docs.left.name, SESSION_MAX_NAME_CHARS),
      format: expectFormatTag(docs.left.format),
      text: expectString(docs.left.text, SESSION_MAX_FILE_BYTES),
    },
    right: {
      name: expectString(docs.right.name, SESSION_MAX_NAME_CHARS),
      format: expectFormatTag(docs.right.format),
      originalText: expectString(docs.right.originalText, SESSION_MAX_FILE_BYTES),
      text: expectString(docs.right.text, SESSION_MAX_FILE_BYTES),
    },
    view: {
      mode: view.mode,
      onlyChanges: expectBoolean(view.onlyChanges),
      ignoreHeadersFooters: expectBoolean(view.ignoreHeadersFooters),
    },
    history,
  };
  if (!result.left.text.trim() && !result.right.text.trim()) {
    throw new SessionFileError('sessionErrorInvalid');
  }
  return result;
}

async function readSessionFile(file) {
  if (!file || typeof file.size !== 'number') throw new SessionFileError('sessionErrorInvalid');
  if (file.size > SESSION_MAX_FILE_BYTES) throw new SessionFileError('sessionErrorTooLarge');
  if (file.size === 0) throw new SessionFileError('sessionErrorInvalid');
  let text;
  try {
    text = await file.text();
  } catch (err) {
    throw new SessionFileError('sessionErrorInvalid');
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new SessionFileError('sessionErrorInvalid');
  }
  return validateSessionData(raw);
}

async function applySessionData(session) {
  // Let a still-open inline editor finish against the old state first, so it
  // cannot fire later against the restored rows.
  const openEditor = document.querySelector('.clause-inline-editor');
  if (openEditor) openEditor.blur();

  state.leftName = session.left.name;
  state.leftFormat = session.left.format;
  state.leftText = session.left.text;
  state.rightName = session.right.name;
  state.rightFormat = session.right.format;
  state.rightText = session.right.text;
  state.undoStack = session.history.undo.slice();
  state.redoStack = session.history.redo.slice();
  state.activeRowId = null;
  state.hoveredRowId = null;
  state.sidebarFilter = 'all';
  state.searchQuery = '';
  state.ignoreHeadersFooters = session.view.ignoreHeadersFooters;

  const searchEl = document.getElementById('search-input');
  if (searchEl) searchEl.value = '';
  ['file-input-left', 'file-input-right'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });

  if (typeof clearImportNotice === 'function') clearImportNotice();
  setViewMode(session.view.mode);
  if (!!state.onlyChanges !== session.view.onlyChanges) {
    const onlyChangesBtn = document.getElementById('btn-only-changes');
    if (onlyChangesBtn) onlyChangesBtn.click();
  }

  sessionTracker.restoring = true;
  try {
    await Promise.resolve(runComparison());
  } finally {
    sessionTracker.restoring = false;
  }
  sessionTracker.originalRightText = session.right.originalText;
  sessionTracker.lastSeenRightText = state.rightText;
  markSessionClean();
  updateUndoRedoButtons();
}

async function openSessionFile(file) {
  let session;
  try {
    session = await readSessionFile(file);
  } catch (err) {
    await showSessionError(err instanceof SessionFileError ? err.messageKey : 'sessionErrorInvalid');
    return false;
  }
  if (isSessionDirty() && !(await confirmDiscardEdits())) return false;
  try {
    await applySessionData(session);
  } catch (err) {
    console.warn('Doc Diff: session restore failed', err);
    await showSessionError('sessionErrorInvalid');
    return false;
  }
  return true;
}

function isSessionFile(file) {
  return !!file && typeof file.name === 'string' && file.name.toLowerCase().endsWith(SESSION_FILE_EXT);
}

/* ── UI wiring: menu item, launchpad / paste-dialog buttons, file drop ──── */
const sessionFileInput = document.getElementById('file-input-session');

function requestOpenSession() {
  const pasteDialog = document.getElementById('paste-modal');
  if (pasteDialog && pasteDialog.open) pasteDialog.close();
  sessionFileInput.value = '';
  sessionFileInput.click();
}

sessionFileInput.addEventListener('change', async () => {
  const file = sessionFileInput.files && sessionFileInput.files[0];
  sessionFileInput.value = '';
  if (file) await openSessionFile(file);
});

document.addEventListener('click', e => {
  if (!(e.target instanceof Element)) return;
  if (e.target.closest('.btn-open-session')) {
    requestOpenSession();
    return;
  }
  if (e.target.closest('[data-session-action="save"]')) {
    const menu = document.getElementById('export-menu');
    const returnFocus = Boolean(menu && menu.contains(document.activeElement));
    if (typeof closeExportMenu === 'function') closeExportMenu(returnFocus);
    if (typeof closeMobileSheets === 'function') closeMobileSheets();
    saveSession();
  }
});

// Downloading the edited result counts as saving it. Copying and printing do not: the
// clipboard is volatile, and neither a failed copy nor a cancelled print dialog can be
// detected, so they must not silence the unsaved-changes warning.
const SESSION_CLEANING_EXPORTS = ['txt', 'word', 'html', 'md'];
document.addEventListener('click', e => {
  if (!(e.target instanceof Element)) return;
  const item = e.target.closest('#export-menu [data-export]');
  if (item && SESSION_CLEANING_EXPORTS.includes(item.getAttribute('data-export'))) {
    markSessionClean();
  }
});

// A dropped .docdiff file is a session, never a document to compare. This
// capture listener runs before the pane / launchpad drop handlers.
window.addEventListener(
  'drop',
  e => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    const sessionFile = Array.from(files).find(isSessionFile);
    if (!sessionFile) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    document.body.classList.remove('is-dragging-file');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    openSessionFile(sessionFile);
  },
  true
);
