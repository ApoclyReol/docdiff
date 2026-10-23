# Handoff: polish the Doc Diff UI before releasing v1.5.0

Branch: `claude/focused-mayer-3stkgw` (51 commits ahead of `main`, nothing merged, no PR yet).
Owner: tschnorpfeil. The owner reviewed the current comparison view and judged it **not releasable: unpolished and immature**. Functionality and correctness are in good shape; the job now is to make the interface feel calm, mature and obvious. Do this before anything else ships.

## 1. Product and owner preferences

- Doc Diff compares two versions of a document (PDF with text layer, Word `.docx`, pasted text) word by word, 100% in the browser. Users are mostly non-technical German lawyers, construction project managers and procurement staff reviewing contract or tender versions, then accepting/rejecting changes and exporting a Word file with tracked changes.
- Free, MIT, no ads, no tracking, no accounts. Tone: plain, factual, honest. No marketing language anywhere (UI, README, release notes).
- The owner's bar: "10/10, clean, minimalist, straightforward, no-brainer, zero-friction, idiot-proof", WCAG 2.2 AA everywhere and AAA text contrast. Think Apple / Linear / Stripe calm, Word "Review" familiarity.
- The owner talks German; everything on GitHub (code, commits, docs, PR) is English (see `CLAUDE.md`).
- The owner reacts to screenshots. Show them early and often, ask before big directional changes, keep each round small.

## 2. Hard constraints (enforced by `node scripts/check.mjs`)

- Single self-contained HTML; works via `file://`. No external URLs/CDNs/fonts loaded at runtime.
- CSP `connect-src 'none'` etc. must stay byte-identical to what README/SECURITY quote.
- No browser storage APIs (`localStorage`, `sessionStorage`, IndexedDB, cookies, Cache API).
- i18n: every key exists in `de` and `en` (`src/js/01-i18n.js`); landing/FAQ text is rendered at build time and checked against JSON-LD.
- `src/js/11-session.js` wraps these globals by reassignment, keep them as global function declarations: `runComparison`, `pushUndoSnapshot`, `performUndo`, `performRedo`, `handleFileUpload`, `handleDropFiles`.

## 3. Code map

Build: `python3 scripts/build.py` writes `site/index.html` (de, pinned), `site/en/index.html` (en) and `DocDiff.html` (offline, follows browser language). Never edit those by hand; commit them after building (CI compares).

| File | What |
| :-- | :-- |
| `src/template.html` | Page shell, landing markup, top bar, menus, dialogs |
| `src/styles.css` | All styles (~5k lines, grew in several passes; token block at the top) |
| `src/js/01-i18n.js` | DE/EN strings |
| `src/js/04-core.js`, `04a-align.js` | Diff core (pure, also runs in the worker). Don't touch for UI work. |
| `src/js/05-render.js` | Paragraph/row HTML, list card HTML |
| `src/js/06-compare.js`, `06a`–`06d` | Comparison orchestration, row layout, search, review (accept/reject) |
| `src/js/07-interactions.js` | Selection, stepping, editing, undo |
| `src/js/08-export*.js` | Exports (docx/html/md/print/txt) |
| `src/js/09-import.js` | File intake (PDF.js, Mammoth). Don't touch for UI work. |
| `src/js/10-controls.js` | Top bar, menus, keyboard, theme, language |
| `src/js/11-session.js` | Saved work (`.docdiff`), unsaved-changes guard |
| `docs/og-image.html` | Source of `site/og-image.png` |
| `docs/releases/v1.5.0.md` | Release notes draft (update when UI changes) |

## 4. What exists in the comparison view today (functionally complete)

- Top bar: logo · file-pair button (popover: replace old/new, swap, info) · stepper "‹ 3 von 20 ›" · help · search (find in document) · "Ansicht" menu (side by side / stacked, page breaks, only changes, hide headers & footers, change list, theme) · primary "Exportieren" menu · "⋯" menu.
- Panes: old left, new right, sticky captions, page cards when page breaks are on, collapsible "Kopf-/Fußzeile" groups for header/footer lines that differ.
- Overview ruler at the right edge of the document area (coloured markers, viewport window, click/drag).
- Review: compact icon group ✓ ✗ ✎ at the active paragraph (new pane), status line "✓ Angenommen · Rückgängig" after a decision, auto-advance to the next open change; keys `J/K`, `A/R`, `E`.
- Change list (right): title + progress, first-visit hint, segmented "Offen / Geprüft", type tabs "Alle · Geändert · Hinzugefügt · Entfernt", cards with context snippet.
- Phone: compact top bar, bottom bar "‹ 3 von 20 › Exportieren", list as bottom sheet, stacked view only.

Current screenshots: `docs/screenshot-light.png`, `docs/screenshot-dark.png`. Regenerate your own with headless Chromium (see §7).

## 5. Why it reads as unpolished (coordinator's critique, verify yourself)

1. **No coherent visual system.** Styles were layered by several passes: borders, radii, shadows, paddings and grey tones vary between top bar, panes, page cards, list cards, menus and dialogs. Start by defining a small token set (spacing scale, 2–3 radii, one border colour, one elevation, type scale) and apply it everywhere; delete the leftovers.
2. **Box-in-box nesting.** Pane → caption band → page card with border → header/footer group → paragraph with side bar → black active ring. Too many frames. Aim for one surface per pane, page breaks as a subtle divider/label, not cards.
3. **Heavy selection and colour.** The active change gets a thick black ring in both panes plus a black ring on the list card. Nearly every paragraph in the sample has an amber side bar, and the ruler is a wall of amber. Selection should be quiet (e.g. a soft tint or a thin accent line), and "changed paragraph" needs a much lighter treatment so actual word-level red/green marks carry the meaning.
4. **The change list header is a control stack:** title, progress bar, hint box, segmented control, tabs, all before the first card. Collapse into one compact header (e.g. title + "1 von 20 geprüft" + a single filter control).
5. **List cards are dense and noisy:** truncated fragments with "…", reference "§ 1 · S. 1" in small type, multiple lines of context. They should scan like an inbox: one line reference, one or two lines of snippet, clear reviewed state.
6. **Top bar elements look like form fields:** the file-pair button looks like a text input; the stepper is a bordered box in the centre. Make them read as titles/controls, not inputs.
7. **Review feedback shifts layout:** the "Angenommen · Rückgängig" line is inserted above the paragraph and pushes content; the old pane shows a stray check mark. Show status without moving text (inline badge in the reserved margin, or a subtle tint).
8. **Header/footer groups** ("Kopf-/Fußzeile ⌄") repeat on every page card and still dominate the top of page 1.
9. **Phone:** file names truncate badly ("…1_Vor….docx → …2_Nac….docx"); the icon group narrows the text column; check spacing rhythm and hit areas visually, not only by numbers.
10. **Typography:** check weights and sizes for document text vs. UI text vs. headings (the sample's uppercase title, bold headings, small grey metadata). Fewer sizes, fewer weights.
11. **Dark mode:** verify the same calm in dark (borders and amber look harsher there).
12. **Motion/micro-interactions:** stepping, accepting and filtering should feel smooth but subtle; respect `prefers-reduced-motion` (already wired).

Two independent design reviews from this session are summarised in the git log (`git log --grep "Review follow-up\|Redesign"`). Their scores for the previous state: first run 8.5, compare/review 6.5, phone 7, visual design 7.5.

## 6. Decisions already made with the owner (keep unless the owner changes them)

- Landing page with the headline "Dokumente ~~mühsam~~ einfach vergleichen." stays (owner liked it). Keep the two numbered file slots and the privacy explanation.
- Word terms: "Annehmen / Ablehnen". Accept keeps the new wording, reject restores the old paragraph; Word export applies accepted, reverts rejected, tracks open changes.
- Actions only in one place (at the active paragraph), not duplicated on list cards.
- Two views (side by side / stacked) plus a "page breaks" toggle; stacked only on phones.
- Overview ruler instead of the old centre gutter.
- No browser storage: saved work only as a user-downloaded `.docdiff` file.
- Hosted `/` is German, `/en/` English; the offline file follows the browser language.

## 7. How to verify

- `python3 scripts/build.py && node scripts/check.mjs` must pass (privacy invariants, i18n parity, core/export/worker/app-state tests).
- Headless Chromium is usually at `/opt/pw-browsers/chromium-*/chrome-linux/chrome` in cloud sessions; install Playwright and axe-core in a scratch directory (`npm i playwright axe-core`), launch with `executablePath`, and don't run `playwright install`.
- The longer browser suites written in this session (session round-trip, exports, randomised UI fuzzer, race tests) lived in a scratch directory and are **not in the repo**. If you change interaction flows, re-create at least: load sample → step → accept/reject/undo → export Word (open with LibreOffice `soffice --convert-to` if available) → save and reopen work → no console errors, axe clean.
- Screenshots at 1440×900, 1280×720, 1024×768, 820×1180 (touch), 390×844 (touch, isMobile), light and dark, DE and EN. Look at them; judge them like a design lead.

## 8. Definition of done

- The owner looks at the screenshots and says it feels calm and mature.
- No functional regressions; `check.mjs` green; axe zero violations in empty, compare (both views), menus, search, dialogs, phone sheets; AAA text contrast in light and dark.
- `README.md` screenshots and `docs/releases/v1.5.0.md` updated to match the final UI.

## 9. After the polish: release steps

1. Open a PR from `claude/focused-mayer-3stkgw` to `main` (English title/body, no PR template exists).
2. After the owner approves and merges, push tag `v1.5.0` on the merge commit. `.github/workflows/release.yml` builds, verifies, and publishes the release with `DocDiff.html`, using `docs/releases/v1.5.0.md` (first line = title).
3. Pages deploys from `main` automatically (`.github/workflows/pages.yml`).

## 10. Backlog (not for this round)

- CLI (`npx docdiff old.pdf new.docx --json`) and an MCP server reusing `04-core.js`, so AI agents can use Doc Diff.
- Paste text directly into the landing slots; options "ignore case / whitespace / punctuation".
- Header/footer heuristics for boilerplate-heavy documents; banded alignment for very large shifted inserts.
- Repository settings for the owner: description, website, topics (suggested in the session); Cloudflare analytics would require a privacy policy update.
