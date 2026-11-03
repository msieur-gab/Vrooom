# Hero picture

`hero-source.jpg` is Gab's original (2752×1536). The site uses two WebPs made from it:

- `public/hero.webp` — full size, quality 80
- `public/hero-small.webp` — 1280 px wide, for phones

Both are multiplied by the page colour `#f5f3ef` before saving, so the white brush
edge at the bottom matches the page and the orange sky becomes `#dc5130`
(`--hero-orange` in `site.css`). Re-make them the same way if the picture changes.
