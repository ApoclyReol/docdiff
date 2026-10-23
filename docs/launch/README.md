# Launch gallery images

Gallery images for product launch listings (1270x760, rendered at 2x = 2540x1520).

| Image | Source | Message |
|---|---|---|
| `1-review.png` | `1-review.html` | Review every change: accept, reject, edit |
| `2-export.png` | `2-export.html` | Export in the original Word format, tracked changes, PDF |
| `3-private.png` | `3-private.html` | Runs locally: no upload, offline, open source |

Render (macOS, from this folder):

```bash
for f in 1-review 2-export 3-private; do "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --allow-file-access-from-files --force-device-scale-factor=2 --window-size=1270,760 --screenshot="$PWD/$f.png" "file://$PWD/$f.html"; done
```

The link preview images are `../og-image.html` and `../og-image-en.html`.
