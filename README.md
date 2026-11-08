# Ateliê

Personal motion-design platform. One page, five tools, switched from the top bar:

- **Typeshift**: kinetic type with Google Fonts and shader effects
- **Carrossel**: animated image carousels
- **Dotwash**: halftone loops from patterns, text or images
- **Loopwash**: seamless gradient loops
- **Gifpress**: lighter GIFs for decks. Keeps only the start of each clip (frames copied untouched) and shrinks oversized ones; can also export MP4 for PowerPoint

`index.html` is the finished page. Open it in a browser, or turn on GitHub Pages (Settings → Pages → Deploy from branch `main`, folder `/`).

Shortcuts: Alt + 1–5 switches tools; `#type`, `#carousel`, `#dots`, `#gradient` and `#press` link straight to one.

## Editing

Each tool's source lives in `src/` (`typeshift.html`, `carrossel.html`, `dotwash.html`, `loopwash.html`, `gifpress.html`, plus `shell.html` for the top bar and `gifq.js`, the GIF encoder with the Quality setting and the PNG/WebP/JPEG image export that all the tools share). After changing one, run `python3 build.py` to regenerate `index.html`.
