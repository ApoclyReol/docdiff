# Security Policy

## Architectural Security Guarantees

Doc Diff is designed for comparing confidential legal contracts, tenders, and financial schedules (`Urkalkulation`) where uploading files to third-party servers is prohibited under GDPR (DSGVO), NDAs, or professional secrecy rules:

1. **Enforced Content Security Policy (`connect-src 'none'`):**
   The HTML document embeds a strict Content Security Policy in `<head>`:
   ```html
   <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src 'self' data: blob:; manifest-src 'self'; connect-src 'none'; media-src 'none'; object-src 'none'; child-src 'none'; worker-src blob:; frame-src 'none'; form-action 'none'; base-uri 'none';" />
   ```
   The browser engine itself blocks any outbound network connection (`fetch`, `XMLHttpRequest`, `WebSocket`, `navigator.sendBeacon`, form submissions, or external image/script requests).
2. **Zero External Dependencies at Runtime:**
   All parsers (`PDF.js`, `Mammoth.js`, `jsdiff`) and fonts (`Geist`, `Geist Mono`) are inlined inside the single HTML file.
3. **Volatile Memory Only:**
   No document data is ever written to `localStorage`, `sessionStorage`, `IndexedDB`, or cookies.

## Reporting a Vulnerability

If you discover a security or privacy issue (such as a DOM XSS vector or CSP bypass), please report it privately via [GitHub Security Advisories](https://github.com/tschnorpfeil/docdiff/security/advisories/new).
