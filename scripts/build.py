#!/usr/bin/env python3
"""
Builds the self-contained single-file HTML bundle (`site/index.html` and `DocDiff.html`)
from `src/template.html`, `src/styles.css`, `src/js/*.js` and `vendor/`.
"""
import base64
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_DIR = os.path.join(ROOT, "vendor", "fonts")
LIB_DIR = os.path.join(ROOT, "vendor", "libs")
TEMPLATE_PATH = os.path.join(ROOT, "src", "template.html")
CSS_PATH = os.path.join(ROOT, "src", "styles.css")
JS_DIR = os.path.join(ROOT, "src", "js")
WORKER_DIR = os.path.join(ROOT, "src", "worker")

# Pure diff code shared verbatim between the page and the comparison Web Worker.
WORKER_SHARED_JS = ["04-core.js", "04a-align.js"]
WORKER_SOURCE_PLACEHOLDER = '"__DIFF_WORKER_SOURCE__"'


def b64_file(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")


def read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def app_js_files() -> list:
    """App scripts, concatenated in file-name order into one classic <script>."""
    return sorted(
        os.path.join(JS_DIR, name) for name in os.listdir(JS_DIR) if name.endswith(".js")
    )


def worker_source(diff_js: str) -> str:
    """Classic worker script: jsdiff + the shared pure core + the worker runtime."""
    parts = ["self.window = self;", diff_js]
    parts += [read_text(os.path.join(JS_DIR, name)) for name in WORKER_SHARED_JS]
    parts.append(read_text(os.path.join(WORKER_DIR, "compare-worker.js")))
    return "\n;\n".join(parts)


def js_string_literal(text: str) -> str:
    """JSON string literal that is also safe inside an inline <script> element."""
    return json.dumps(text).replace("<", "\\u003c").replace(">", "\\u003e")


def build() -> str:
    template = read_text(TEMPLATE_PATH)
    app_css = read_text(CSS_PATH)
    diff_js = read_text(os.path.join(LIB_DIR, "diff.min.js"))
    app_js = "\n".join(read_text(path) for path in app_js_files())
    if app_js.count(WORKER_SOURCE_PLACEHOLDER) != 1:
        sys.exit(f"Expected exactly one {WORKER_SOURCE_PLACEHOLDER} placeholder in src/js")
    app_js = app_js.replace(WORKER_SOURCE_PLACEHOLDER, js_string_literal(worker_source(diff_js)))

    geist_b64 = b64_file(os.path.join(FONT_DIR, "Geist-Variable.woff2"))
    geist_greek_b64 = b64_file(os.path.join(FONT_DIR, "Geist-Greek-Fallback.woff2"))
    geist_mono_b64 = b64_file(os.path.join(FONT_DIR, "GeistMono-Variable.woff2"))

    pdf_js = read_text(os.path.join(LIB_DIR, "pdf.min.js"))
    pdf_worker_js = read_text(os.path.join(LIB_DIR, "pdf.worker.min.js"))
    mammoth_js = read_text(os.path.join(LIB_DIR, "mammoth.browser.min.js"))

    # App sources go in first so vendor code can never be scanned for placeholders.
    return (
        template.replace("__APP_CSS__", app_css)
        .replace("__APP_JS__", app_js)
        .replace("__GEIST_B64__", geist_b64)
        .replace("__GEIST_GREEK_B64__", geist_greek_b64)
        .replace("__GEIST_MONO_B64__", geist_mono_b64)
        .replace("__PDF_JS__", pdf_js)
        .replace("__PDF_WORKER_JS__", pdf_worker_js)
        .replace("__MAMMOTH_JS__", mammoth_js)
        .replace("__DIFF_JS__", diff_js)
    )


def main() -> None:
    html = build()
    os.makedirs(os.path.join(ROOT, "site"), exist_ok=True)
    targets = [
        os.path.join(ROOT, "site", "index.html"),
        os.path.join(ROOT, "DocDiff.html"),
    ]
    for path in targets:
        with open(path, "w", encoding="utf-8") as f:
            f.write(html)
        print(f"Wrote {os.path.relpath(path, ROOT)} ({len(html):,} bytes)")


if __name__ == "__main__":
    main()
