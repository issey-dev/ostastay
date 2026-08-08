UPPSOLUT — BRAND ASSET KIT  (v1.1)
Business Operating Engine
==========================================

COLORS
  Crimson OS     #8B0000   primary / accent
  Deep Maroon    #580816   structure (nav, footers)
  Obsidian Black #0D0F11   base dark / primary text
  Steel Slate    #1A1D20   surfaces / borders
  Cool Platinum  #F4F6F8   base light / light text

TYPEFACE
  Inter — UPP = Black (900), SOLUT = Light (300).
  Tagline/subline: Inter Light, all-caps, locked to wordmark width.

PRIMARY COLORWAYS
  Crimson on Platinum  and  Platinum on Crimson (lead with these).
  Supporting: duotone on Obsidian, Platinum on Steel Slate, Platinum on Maroon.

--------------------------------------------------
/logo   — full wordmark, SVG (vector, scalable)
  uppsolut-wordmark-crimson.svg        crimson text, transparent bg
  uppsolut-wordmark-platinum.svg       platinum text, transparent bg
  uppsolut-wordmark-obsidian.svg       obsidian text, transparent bg
  uppsolut-wordmark-duotone-onlight.svg  UPP obsidian + SOLUT crimson
  uppsolut-wordmark-duotone-ondark.svg   UPP platinum + SOLUT crimson
  uppsolut-wordmark-on-crimson.svg     platinum on crimson (with padding)
  uppsolut-wordmark-on-platinum.svg    crimson on platinum (with padding)
  uppsolut-wordmark-on-obsidian.svg    duotone on obsidian (with padding)

/icon   — the "U" mark (font-independent vector path)
  uppsolut-icon-crimson / platinum / obsidian / maroon .svg   rounded tiles
  uppsolut-icon-glyph.svg     bare U, fill=currentColor (recolor in CSS)

/sub-brands  — stacked module lockups (Option 1: UPPSOLUT anchor + module @ 2.4x)
  uppsolut-{stay,stock,pay,desk,rent}.svg           on light
  uppsolut-{...}-on-crimson.svg                      on crimson
  Descriptors: Stay=Property, Stock=Inventory, Pay=POS, Desk=Service, Rent=Rentals

/favicon
  favicon.svg                       modern vector favicon
  favicon.ico                       16/32/48 multi-size
  favicon-16x16.png / -32x32 / -48x48
  apple-touch-icon.png              180x180
  android-chrome-192x192.png / -512x512.png
  android-chrome-maskable-512x512.png  (safe-zone padded)
  site.webmanifest
  favicon-snippet.html              paste into <head>, files go at site root

--------------------------------------------------
NOTES
- The U icon + all favicons are drawn as a vector path, so they render
  identically with no font dependency.
- Wordmark/sub-brand SVGs use live Inter text with an embedded Google Fonts
  import (renders in browsers). For PRINT or environments without web fonts,
  open in a vector editor with Inter installed and convert text -> outlines.
- Do not: swap/equalize the weights, stretch/skew, recolor off-palette,
  or let a module name grow wider than the UPPSOLUT anchor.


==========================================
ICON / FAVICON — READ THIS
==========================================
The icon must use the SAME "U" as the wordmark (real Inter Black glyph).

  /icon/*.svg        -> now use the real Inter U via <text> (font-family Inter,
                        weight 900). They match the wordmark exactly wherever
                        Inter is available (all in-page / CSS uses).

  /favicon/          -> Browsers often DON'T load web fonts inside a favicon,
                        so favicons must be OUTLINED (font-independent).
                        Because Inter is not present in the build sandbox, the
                        exact favicon files are produced by a one-time script:

     pip install fonttools pillow
     python favicon/bake-inter-favicons.py  /path/to/Inter-Black.otf

  This extracts the true Inter "U", writes an outlined favicon.svg and every
  PNG/ICO size, and also re-outlines the /icon tiles so the entire set is a
  pixel-exact match to the logo, with zero font dependency.

  /favicon/_approximate-do-not-ship/  -> earlier hand-drawn U. NOT the logo
                        glyph; kept only for reference. Do not publish these.
