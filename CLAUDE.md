# Working on Doc Diff

## Language on GitHub

Everything that appears on GitHub is in English: `README.md` and docs, the repository description, release titles and release notes, commit messages, pull request titles and descriptions, issue and review comments, and code comments. Write English even when the request came in German.

The UI supports German, English and Simplified Chinese (`de`, `en` and `zh-CN` in `src/js/01-i18n.js`), auto-detecting the browser language with a three-language toggle in the header bar. Domain-specific German legal and construction terms (`Urkalkulation`, `Zuschlag`, `Pauschalfestpreis`) stay in German inside the German sample fixtures.

## Build & Verification

Always edit the sources and run the build plus checks:

- `src/template.html`: page shell, `<head>`, and static markup
- `src/styles.css`: all app styles
- `src/js/*.js`: app code, concatenated in file-name order into one classic `<script>` (shared scope, no modules)

Never hand-edit `DocDiff_简体中文.html`, `DocDiff.html`, `site/index.html` or `site/en/index.html`; they are generated. The hosted pages are pinned to German (`/`) and English (`/en/`); the offline `DocDiff.html` follows the browser language. `DocDiff_简体中文.html` is pinned to Simplified Chinese.


```sh
python3 scripts/build.py
node scripts/check.mjs
```

Never introduce external URLs, CDNs, or browser storage APIs (`localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`).
