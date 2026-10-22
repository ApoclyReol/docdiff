#!/usr/bin/env python3
"""
Builds the self-contained single-file HTML bundle (`site/index.html` and `DocDiff.html`)
from `src/template.html`, `src/styles.css`, `src/js/*.js` and `vendor/`.
"""
import base64
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_DIR = os.path.join(ROOT, "vendor", "fonts")
LIB_DIR = os.path.join(ROOT, "vendor", "libs")
TEMPLATE_PATH = os.path.join(ROOT, "src", "template.html")
CSS_PATH = os.path.join(ROOT, "src", "styles.css")
JS_DIR = os.path.join(ROOT, "src", "js")


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


def build() -> str:
    template = read_text(TEMPLATE_PATH)
    app_css = read_text(CSS_PATH)
    app_js = "\n".join(read_text(path) for path in app_js_files())

    geist_b64 = b64_file(os.path.join(FONT_DIR, "Geist-Variable.woff2"))
    geist_greek_b64 = b64_file(os.path.join(FONT_DIR, "Geist-Greek-Fallback.woff2"))
    geist_mono_b64 = b64_file(os.path.join(FONT_DIR, "GeistMono-Variable.woff2"))

    pdf_js = read_text(os.path.join(LIB_DIR, "pdf.min.js"))
    pdf_worker_js = read_text(os.path.join(LIB_DIR, "pdf.worker.min.js"))
    mammoth_js = read_text(os.path.join(LIB_DIR, "mammoth.browser.min.js"))
    diff_js = read_text(os.path.join(LIB_DIR, "diff.min.js"))

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
