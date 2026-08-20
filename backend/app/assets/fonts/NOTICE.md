# Bundled typefaces — share-card rendering

These faces are committed because the share card (`GET /c/{id}/og.png`) is rendered **server-side**
by Pillow for link unfurls. The web app loads its type from Google Fonts (`theme/global.css`), but a
crawler never runs that CSS, so the backend needs the real font files on disk. Without them Pillow
falls back to its built-in bitmap face, which is illegible when scaled to headline sizes and made
the card look nothing like the app.

Each face here mirrors a `--font-display` stack in `frontend/src/theme/tokens.ts`, so the rendered
card uses the same typeface the sender sees in the app:

| File | Used for | Mirrors theme style |
|------|----------|---------------------|
| `PlayfairDisplay-Bold.ttf` | display/headline type | `mono` (Starter + its skins) |
| `LuckiestGuy-Regular.ttf` | display/headline type | `arcade`, `soft` |
| `Manrope-Bold.ttf` | labels, small caps, body | `--font-display` for the Minimal pair; UI text everywhere |

## Licences

All three are redistributable. Full texts are alongside this file.

- **Playfair Display** — SIL Open Font License 1.1 (`OFL.txt`).
  Copyright 2017 The Playfair Display Project Authors
  (https://github.com/clauseggers/Playfair-Display), with Reserved Font Name "Playfair Display".
- **Manrope** — SIL Open Font License 1.1 (`OFL.txt` covers the same OFL-1.1 terms).
  Copyright 2018 The Manrope Project Authors (https://github.com/sharanda/manrope).
- **Luckiest Guy** — Apache License 2.0 (`LICENSE-Apache-2.0.txt`).
  Copyright Astigmatic (AOETI).

Under OFL-1.1 these files must keep their Reserved Font Names and must not be sold on their own;
bundling them inside this application is expressly permitted. Do not rename the TTFs.
