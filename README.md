<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark-square.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/logo-light-square.png">
    <img alt="Doc Diff Logo" src="docs/logo-light-square.png" width="96" height="96">
  </picture>
</p>

<h1 align="center">Doc Diff</h1>

<p align="center">
  <b>100% client-side, side-by-side document comparison for PDF, Word (.docx), and text.</b><br>
  Compare contracts, tenders, and redlines right in your browser.<br>
  Zero server uploads, zero external CDNs, enforced by <code>Content-Security-Policy: connect-src 'none'</code>.<br>
  Ships as a single self-contained HTML file that also works offline via <code>file://</code>.
</p>

<p align="center">
  <a href="https://docdiff.app"><b>docdiff.app</b></a> ·
  <a href="https://github.com/tschnorpfeil/docdiff/raw/main/DocDiff.html"><b>Download Standalone HTML (2.5 MB)</b></a> ·
  free and open source (MIT)
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/screenshot-light.png">
    <img alt="Doc Diff side-by-side comparison of two contract versions showing clause alignment, inline word redlines, center minimap, and change navigation." src="docs/screenshot-light.png" width="100%">
  </picture>
</p>

---

## Why Doc Diff?

Comparing confidential contracts, schedules of rates (`Urkalkulation`), or legal redlines in cloud diff tools is often impossible under GDPR (DSGVO), NDAs, or professional secrecy rules. Meanwhile, existing open-source tools on GitHub usually cover only a fraction of the workflow:

| Capability | **Doc Diff** | `jamesmontemagno/pdf-diff` | `a-subhaneel/pdf-diff-viewer` | `xsukax/Word-Comparison` | Cloud SaaS Diff Tools |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **PDF comparison (`.pdf`)** | **Yes** | Yes | Yes | No | Yes |
| **Word comparison (`.docx`)** | **Yes** | No | No | Yes | Yes |
| **Cross-format (`PDF` ↔ `DOCX`)** | **Yes** | No | No | No | Partial |
| **100% in-browser (`0 B` upload)** | **Yes** | Yes | Yes | No (Python server) | No (Cloud upload) |
| **Browser-enforced CSP lock (`connect-src 'none'`)** | **Yes** | No | No | No | No |
| **Single-file offline HTML (`file://` ready)** | **Yes (1 file)** | No (Vite build) | No | No | No |
| **Clause alignment (`§ 1`, `(1)`, `1.1`) + word diff** | **Yes** | No | Partial | Partial | Yes |

---

## Privacy & Security by Architecture (GDPR / DSGVO Safe)

Doc Diff is built so that any data protection officer or security auditor can verify in seconds that data exfiltration is technically impossible:

1. **Browser-Enforced Network Lock (`connect-src 'none'`):**
   The document embeds a strict Content Security Policy directly in `<head>`:
   ```html
   <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src 'self' data: blob:; manifest-src 'self'; connect-src 'none'; media-src 'none'; object-src 'none'; child-src 'none'; worker-src blob:; frame-src 'none'; form-action 'none'; base-uri 'none';" />
   ```
   The browser engine itself blocks any outbound network request (`fetch`, `XMLHttpRequest`, `WebSocket`, `navigator.sendBeacon`, form submissions, or external image/script loads).
2. **Zero External Dependencies or CDNs:**
   All parsers (`PDF.js`, `Mammoth.js`, `jsdiff`) and typography (`Geist` & `Geist Mono` as Base64 `woff2`) are embedded inside the single HTML file. Opening the hosted GitHub Pages URL downloads one static HTML file—after that, **zero network requests occur**.
3. **Volatile RAM Only (Zero Persistence):**
   Document contents are never stored in `localStorage`, `sessionStorage`, `IndexedDB`, or cookies. Clicking **Clear** (`Leeren`) or closing the browser tab immediately discards all document data from memory.

---

## Key Features

- **Cross-Format Comparison:** Compare `PDF ↔ PDF`, `DOCX ↔ DOCX`, `PDF ↔ DOCX`, or pasted raw text side by side or in a unified inline view.
- **Responsive Across Desktop, Laptop, Tablet & Mobile:** Switch between the **Pages**, **Side by side** and **Inline** views. Automatically adapts on tablets (slide-over change drawer) and smartphones (single-column inline redline with `100dvh` viewport sizing).
- **Clause-Aware Alignment:** Pre-tokenized Needleman-Wunsch dynamic programming with $O(N)$ prefix/suffix trimming aligns moved, inserted, or deleted contract clauses (`§`, `(1)`, `1.1`, `Section`) and coalesces adjacent word, number, and date changes into clean red/green inline highlights.
- **Faithful Diff Semantics:**
  - The word diff never alters the source: unchanged + deleted parts always spell the old text exactly, unchanged + inserted parts the new text (enforced by tests).
  - Running headers/footers are hidden only when their text repeats on at least half of the pages at the same position; a header/footer whose text differs between the versions (beyond page numbers) is always shown once.
  - Renumbering (`(1)` → `(2)`, `§ 4` → `§ 5`) with an unchanged clause body is shown as a muted marker change and not counted; identical paragraphs that moved are labelled **Verschoben / Moved** at both positions.
  - PDF intake joins hyphenated line breaks and derives word spaces from glyph geometry; DOCX list numbers are computed from the document's own numbering definitions (shown only when they can be determined reliably).
  - Supported inputs: PDF with a text layer, `.docx`, `.html` (text only, scripts never run), and UTF-8/UTF-16 text. Scanned PDFs, images, legacy `.doc` and `.rtf` are rejected with a clear message (no OCR).
- **Frosted Glass Floating Action Bar & Single-Scrollbar Sync:** A translucent bottom-mid HUD dock (`backdrop-filter: saturate(190%) blur(18px)`) keeps the change stepper (`↑ 1 / 17 ↓`), "Changes only" (`Nur Änderungen`) filter, and Undo/Redo controls within immediate reach. Both panes stay 100% locked in synchronized scroll with a single outer scrollbar and bi-directional Bezier connectors across the symmetric center gutter.
- **Delta-Only Change Inspector & Click-to-Jump Rail:** The right side rail extracts only the exact modified tokens (`145.000,00 → 168.500,00`, `12.03.2026 → 18.04.2026`, `schriftlich → in Textform`) with section-aware clause references (`§ 1 (1)`, `§ 2 (1)`), category filter tabs (`Alle`, `Geändert`, `Neu`, `Entfernt`), 1-click jump-to-clause, and inline edit/revert actions.
- **Direct Inline Clause Editing, 1-Click Revert & Undo/Redo:** Double-click or click **Bearbeiten** (`Edit`) on any clause in the revised or unified pane to edit its text directly in place (`Enter` to apply, `Esc` to cancel) and re-run the diff in `< 5 ms`. Click **Alte Fassung übernehmen** (`Use old version`) to revert any clause back to the baseline version, with full **Undo / Redo** history (`Cmd+Z` / `Shift+Cmd+Z` or toolbar buttons).
- **Multi-Format Client-Side Export:** Export comparisons locally without any server roundtrip:
  - **Copy Final Text:** 1-click copy of the clean, edited target text to the clipboard (header/footer lines left out)
  - **Save Clean Text (`.txt`):** Download the final revised document text
  - **PDF / Print (`Cmd+P` / `Ctrl+P`):** Dedicated print layout for all three view modes, with both file names, date, page numbers, and greyscale-safe marks (strike-through / underline)
  - **Word Redline (`.docx`):** A genuine Word document generated in the browser, with every difference recorded as a tracked change (author "Doc Diff"), so you can **Accept / Reject** each change in Word or LibreOffice
  - **HTML Report (`.html`):** Self-contained, accessible, read-only report with summary counts, a linked change list, and the full redline; strict CSP, print- and dark-mode-friendly
  - **Markdown (`.md`):** Summary table with clause references plus the redline (`~~deleted~~` / `**inserted**`), with document text safely escaped
  - File names combine both documents, e.g. `Vertrag_v2_vs_v1_Redline.docx`, and are sanitized for Windows, macOS, and Linux
- **Keyboard-First Navigation & System-Aware Theme:**
  - `J` / `K` — Jump to next / previous change
  - `/` — Focus full-text search
  - `C` — Toggle "Changes only" (`Nur Änderungen`) filter
  - `Cmd+Z` / `Ctrl+Z` — Undo inline clause edits or reverts
  - `Shift+Cmd+Z` / `Ctrl+Y` — Redo inline clause edits or reverts
  - `Esc` — Close menus, drawers, or dialogs
  - Automatic `prefers-color-scheme` Dark / Light detection with a manual header toggle.
- **Bilingual UI (`DE` / `EN`):** Auto-detects browser language with an instant `DE` / `EN` toggle in the header bar and built-in sample contracts in both German and English.

---

## Usage

### 1. Hosted Web App (`docdiff.app`)
Open **[docdiff.app](https://docdiff.app)** in any modern browser and drop two files onto the left and right panes (or drop two files at once).

### 2. Local Standalone File (`file://` / Air-Gapped / Offline)
Download **[`DocDiff.html`](https://github.com/tschnorpfeil/docdiff/raw/main/DocDiff.html)** to your computer, intranet share, or USB drive and double-click it to open in Chrome, Safari, Firefox, or Edge. No internet connection or local web server required.

---

## Building from Source

Edit the sources in [`src/`](src) and run the build and verification scripts:

```sh
python3 scripts/build.py
node scripts/check.mjs
```

- `src/template.html` holds the page shell and markup, `src/styles.css` the styles, and `src/js/*.js` the app code (concatenated in file-name order).
- `scripts/build.py` bundles them with the pinned libraries and fonts in `vendor/` to produce `site/index.html` and `DocDiff.html`.
- `scripts/check.mjs` verifies CSP headers, zero external URLs, zero storage APIs, and 1:1 `de`/`en` translation key parity.
- `scripts/test-core.mjs` (run by `check.mjs`) unit-tests the diff core in `node:vm`: the word-diff invariant, alignment of the built-in samples, header/footer detection, PDF line joining, renumbering, and moves.

---

## License

MIT License — see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
