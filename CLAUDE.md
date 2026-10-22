# Working on Doc Diff

## Language on GitHub

Everything that appears on GitHub is in English: `README.md` and docs, the repository description, release titles and release notes, commit messages, pull request titles and descriptions, issue and review comments, and code comments. Write English even when the request came in German.

The UI itself is bilingual (`de` and `en` in `src/js/01-i18n.js`), auto-detecting the browser language with a one-click `DE` / `EN` toggle in the header bar. Domain-specific German legal and construction terms (`Urkalkulation`, `Zuschlag`, `Pauschalfestpreis`) stay in German inside the German sample fixtures.

## Build & Verification

Always edit the sources and run the build plus checks:

- `src/template.html`: page shell, `<head>`, and static markup
- `src/styles.css`: all app styles
- `src/js/*.js`: app code, concatenated in file-name order into one classic `<script>` (shared scope, no modules)

Never hand-edit `DocDiff.html` or `site/index.html`; both are generated.


```sh
python3 scripts/build.py
node scripts/check.mjs
```

Never introduce external URLs, CDNs, or browser storage APIs (`localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`).
