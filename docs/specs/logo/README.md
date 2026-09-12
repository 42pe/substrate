# Substrate logo — "the cut plug" (option B, approved)

A plug of earth cut out at the site's own **2:1 dimetric** angle, its two soil
layers banding the cut faces and meeting in a V at the near corner, with a
sprout growing from the top face. The sprout sways side to side, the same idiom
as the flowers in the signpost scene.

Art size **28 × 26** px. Palette is the locked meadow set plus one new value,
`--sbl-h #c8f272`, one step above `grass-top` — without a fourth green the leaf
blade flattens.

## Files

| File | Use |
|---|---|
| `SubstrateLogo.astro` | **The one to integrate.** Drop-in Astro component, animated, zero JS. |
| `substrate-logo.svg` | Standalone animated SVG — works through `<img>`, `<object>` or inlined. |
| `substrate-logo-static.svg` | Single upright frame. Favicon, OG image, print, anywhere motion is wrong. |

All three are **self-contained**: the palette is declared on each file's own
root, so they do not depend on `src/styles/tokens.css` and a change there cannot
break them. The `sbl-` namespace cannot collide with the `--s1-`…`--s5-` scenes.

## How it animates

A four-frame strip — **left, centre, right, centre** — laid out side by side and
stepped with `steps(4, end)` over a `translateX(-112px)`. Four frames rather than
three because three cycles (L→C→R→L, a rotation) where four genuinely sways.

The whole animation is one stepped translate on a single `<g>`. No JavaScript,
and it renders identically with scripting off. Period **1.29 s** — deliberately
the same as the scene it came from, and coprime with the other scene timings, so
nothing on the page falls into step.

`prefers-reduced-motion: reduce` stops the strip on the **upright centre frame**,
not frame 0 — frame 0 is the left lean, which reads as a static plant blown over.

## Known limit — read before using it as a favicon

**Below about 24 px the V-seam and the two cheeks collapse into one brown mass**
and the mark stops being legibly layered. That is a property of the isometric
form, not a bug to fix by scaling.

If a 16 px favicon is needed, it wants a **separate simplified variant** —
fewer strata, no seam, a bigger sprout — not this file shrunk. Ask before
inventing one; it is a design decision, not a build step.

## Accessibility

`decorative` defaults to `true`, so the component renders `aria-hidden="true"`.
In the header the wordmark text already says "Substrate" and announcing the mark
as well is noise. Pass `decorative={false}` only where the logo stands alone with
no adjacent text.
