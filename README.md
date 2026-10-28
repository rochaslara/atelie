# Ateliê

Personal motion-design platform. One page, four tools, switched from the top bar:

- **Typeshift**: kinetic type with Google Fonts and shader effects
- **Carrossel**: animated image carousels
- **Dotwash**: halftone loops from patterns, text or images
- **Loopwash**: seamless gradient loops

`index.html` is the finished page. Open it in a browser, or turn on GitHub Pages (Settings → Pages → Deploy from branch `main`, folder `/`).

Shortcuts: Alt + 1–4 switches tools; `#type`, `#carousel`, `#dots` and `#gradient` link straight to one.

## Editing

Each tool's source lives in `src/` (`typeshift.html`, `carrossel.html`, `dotwash.html`, `loopwash.html`, plus `shell.html` for the top bar and `gifq.js`, the GIF encoder with the Quality setting that all four tools share). After changing one, run `python3 build.py` to regenerate `index.html`.
