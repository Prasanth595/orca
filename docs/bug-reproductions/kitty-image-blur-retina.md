# Blurry inline images on Retina displays

Status: **fixed in this branch**. The root cause was in Orca, not omp.
See Findings. Claims marked `[INFERENCE]` have not been checked against code
or measurement.

## Symptom

omp's inline charts look blurry in Orca. omp (oh-my-pi) has a setting,
`tui.autoGraph`, that turns numeric markdown tables into charts; `tui.renderSvg`
does the same for SVG blocks the agent writes. In Orca, the small text in these
charts (axis labels, legend, value labels such as `17–74 s` and `162 s`) is soft
and smeared. The user captured a dark-theme, log-scale range chart in a 1568×509
screenshot.

## A/B result (observed)

With the same omp version and chart data, the chart was sharp in iTerm2 and
blurry in Orca. The difference was on the terminal side.

## Environment

| Item                 | Value                                        |
| -------------------- | -------------------------------------------- |
| Orca                 | 1.4.224 (`TERM_PROGRAM=Orca`)                |
| Image protocol hint  | `ORCA_IMAGE_PROTOCOL=kitty`                  |
| `TERM` / `COLORTERM` | `dumb` / `truecolor`                         |
| omp                  | 18.11.1 (Homebrew binary)                    |
| OS / display         | macOS (darwin 27.0.0, arm64), Retina (DPR 2) |
| Comparison terminal  | iTerm2: sharp                                |

## Verified image path

omp 18.11.1 selects Sixel only when the primary device attributes (DA1) reply
advertises attribute `4`. It sizes the chart raster from the `CSI 16 t` reply.
Before the fix, both that reply and the addon's image layer used CSS pixels,
so Retina charts were rasterized and displayed below native resolution.

## Repro

1. On a Retina display, open an Orca terminal and run `omp`. Ask for a markdown
   table with a few numeric columns; `tui.autoGraph: always` renders it as a chart.
2. Run a fresh `omp` in iTerm2, ask for the same table and compare small text.
3. Measure the terminal replies using the procedure below and compare the cell
   size with the font's cell size × DPR.

## Acceptance criteria

- In Orca on Retina, small text in omp autoGraph charts is as sharp as in
  iTerm2 with the same chart data.
- Images keep the same placement, size and cell alignment, and are not
  resized wrongly.
- No regression on DPR 1 displays, or when moving a window between monitors
  with different DPRs.
- Cell and window pixel-size replies are consistent with each other and with
  what the image layer expects.

## Findings

### Root cause

Size reporting and image rendering both used CSS pixels. CSS zoom and
`image-rendering` resampling played no part. On a DPR 2 display, an image could
never be shown at more than half the display's resolution.

1. **The pixel-size replies were in CSS pixels.**
   `createTerminalPixelSizeQueryResponder` in
   `src/renderer/src/components/terminal-pane/terminal-capability-replies.ts`
   took the cell size from the `.xterm-screen` bounding rectangle
   (`getBoundingClientRect() / cols,rows`), which is in CSS pixels. omp 18.11.1
   sends `CSI 16 t` once its image protocol is set (`terminal.write("\x1B[16t")`
   in the binary). It parses `^\x1b\[6;(\d+);(\d+)t$` into its global cell size,
   and the chart rasterizer then renders `limits.columns * cell.widthPx` by
   `limits.rows * cell.heightPx` pixels. omp does not read `TIOCGWINSZ` pixels.
   It does enable mode 2048 (in-band resize, whose reports carry pixel sizes),
   but Orca reports that mode as unsupported (`CSI ? 2048 ; 0 $ y`). The `CSI 16 t`
   reply is therefore omp's only source, and omp drew a 1× bitmap.

   Captured omp output contains Sixel DCS sequences and no kitty `ESC _G`
   sequences, despite `ORCA_IMAGE_PROTOCOL=kitty`. omp's `orca` terminal profile
   supplies no image protocol; DA1 attribute `4` enables Sixel and triggers
   `CSI 16 t`. Both protocols share `ImageRenderer` geometry, so the fix covers
   Sixel and kitty.

2. **The image layer drew in CSS pixels.** The patched `@xterm/addon-image`
   (`config/patches/xterm-src/@xterm__addon-image@0.10.0-beta.301.src.patch`)
   read `dimensions.css.*` everywhere:
   - `ImageRenderer.cellSize`, `clearLines`, `rescaleCanvas` and
     `insertLayerToDom` used `css.cell` and `css.canvas`. The layer `<canvas>`
     had a CSS-sized backing store and no `style.width`/`style.height`, so the
     compositor stretched it 2×.
   - `KittyGraphicsHandler` set `cw`/`ch` from `css.cell`. A `c=`/`r=` placement
     was resized with `createImageBitmap(..., { resizeWidth: cols * cssCellW })`.
     A 2× bitmap would have been scaled down to 1× before it was stored.
   - Sixel and natural-size images were stored against the CSS `cellSize`, so
     one image pixel was drawn as one CSS pixel, which is 2×2 device pixels.

   Fixing only one side would not help. A 2× bitmap would be scaled down to
   1×, and a 2× layer would still receive a 1× bitmap.

3. **The PTY's `ws_xpixel`/`ws_ypixel` are 0.** node-pty 1.1.0's
   `resize(cols, rows)` has no pixel arguments. omp does not read these fields,
   so they play no part in this bug, and the fix leaves them alone.

### Measurements (this Retina Mac: 5120×2880 panel, "looks like" 2560×1440, DPR 2)

With input in raw mode and echo off, send `CSI 16t`, `CSI 14t`, `CSI 18t` and
`CSI ? 2048 $ p`, read their replies, then read `TIOCGWINSZ`. Restore the input
settings afterwards.

| Terminal                                   | `CSI 16 t` | `CSI 14 t`    | Grid   | `TIOCGWINSZ` px | Units                                     |
| ------------------------------------------ | ---------- | ------------- | ------ | --------------- | ----------------------------------------- |
| Orca 1.4.224 (prod)                        | no reply   | `4;1344;1304` | 163×84 | 0×0             | CSS (8×16 cell)                           |
| Orca dev, before fix                       | `6;16;8`   | `4;1344;1912` | 239×84 | 0×0             | CSS (8×16 cell)                           |
| Orca dev, after fix, DPR 2                 | `6;32;16`  | `4;2688;3824` | 239×84 | 0×0             | device (16×32 = 8×16 × 2)                 |
| Orca dev, after fix, DPR 1 (CDP emulation) | `6;16;8`   | `4;1344;1912` | 239×84 | 0×0             | identical to before                       |
| iTerm2                                     | `6;17;7`   | `4;453;587`   | 80×25  | 1120×850        | 16t in points; ioctl in device px (14×34) |

Notes on the table:

- **Production row.** The capture did not include a `CSI 16 t` reply. The dev
  before/after rows isolate the renderer's pixel-unit change.
- **iTerm2 natural-size images.** An inline image (OSC 1337) with no size
  argument is drawn at one image pixel per device pixel: a 400×100 PNG covered
  about 395 device px (200 pt) in a 587 pt window. That is the same convention
  the fixed addon uses.

### Fix

Everything is now measured in device pixels, end to end. Positions on screen
are unchanged.

- **Responder** (`terminal-capability-replies.ts`). `measureCellPixels` reads
  xterm's public `terminal.dimensions.device.cell`, rounded, and clamps it to at
  least 1 px. `CSI 14 t` is the rounded cell size times `cols`/`rows`, so the
  14t and 16t replies stay consistent with each other. The DOM-rect helper
  `getTerminalScreenElement` is removed. At DPR 1, device equals CSS, so the
  replies are byte-for-byte the same as before.
- **Addon** (source patch regenerated with
  `node config/scripts/regenerate-xterm-patches.mjs --write`; shipped patch and
  `pnpm-lock.yaml` patch hash updated):
  - `ImageRenderer`: `cellSize`, `clearLines`, `draw*` and `extractTile` use
    `device.cell`. The layer canvases get a `device.canvas` backing store and a
    `css.canvas` `style.width/height`. `rescaleCanvas` updates both, so the
    layer follows DPR changes (moving a window to another monitor) and font
    zoom.
  - Layer backing dimensions are rounded down (as canvas setters truncate) so fractional DOM-renderer canvas
    sizes do not clear the layer on every render. Eviction placeholders are
    also sized in device pixels.
  - `KittyGraphicsHandler`: `cw`/`ch` come from `device.cell`. A `c=`/`r=`
    placement now fills `cols × rows` device cells at full resolution, and the
    in-cell `X=`/`Y=` offsets are in device px.
  - `IIPHandler._resize` and the `ImageAddon` XTSMGRAPHICS read use the device
    canvas. `ReportCellSize` keeps iTerm2's "points plus scale" form.
  - The addon's own `CSI 14/16 t` handler (used only when
    `enableSizeReports: true`) reports device pixels. Orca keeps that option
    `false`, so the responder above stays the only answerer.
- **Behaviour change.** A kitty, sixel or IIP image sent without an explicit
  size now maps one image pixel to one device pixel. At DPR 2 it therefore
  covers half as many cells as before. That matches kitty, which reports device
  pixels on HiDPI, and iTerm2, which shows IIP images at one image pixel per
  device pixel. Apps that size images from `CSI 16 t` (omp, and `[INFERENCE]`
  `kitten icat`, chafa and timg) get the same cell coverage as before.

### Regression tests

- `src/renderer/src/components/terminal-pane/terminal-capability-replies.test.ts`
  checks DPR 2 device-pixel replies, consistent fractional-cell rounding,
  unchanged DPR 1 replies, split queries, and silence before dimensions are
  available or when cell metrics are non-positive. Existing DA1 and replay
  tests are unchanged.
- `config/scripts/xterm-image-device-pixel-contract.test.mjs` checks device-sized
  backing canvases with CSS layout sizes across DPR changes, fractional canvas
  dimensions without destructive clears, full-width eviction placeholders,
  explicit and natural-size Kitty placement at DPR 2 and DPR 1, and consistent
  addon size reports without enabling them when disabled.

### Verification

Gate results and unrelated baseline failures belong in the PR description.

Dev build: `pnpm dev` with `ORCA_BACKGROUND_LAUNCH=1`, driven by CDP. The
before/after captures used the same autoGraph range chart from a numeric table.

- **Before**, on the baseline dev build: `CSI 16t` →
  `6;16;8`. The image layer is `1912×1344` with no CSS size. The chart text is
  smeared; see `kitty-image-blur-retina/orca-before.png` (a 1:1 device-pixel
  crop).
- **After**, at DPR 2: `CSI 16t` → `6;32;16`. The image layer is `3824×2688`
  backing, styled `1912px×1344px`. Chart text and ticks are crisp; see
  `kitty-image-blur-retina/orca-after.png`. The chart covers the same columns
  and number of rows as before, and the two crops are the same size. They are
  offset vertically by 32 device px only because omp's random startup tip
  wrapped onto a different number of lines.
- **Mean edge strength** (PIL `FIND_EDGES`, same-size crop): 6.01 before, 8.12
  after. Edge variance: 917 before, 1923 after.
- **iTerm2**, same session, native Retina window capture:
  `kitty-image-blur-retina/iterm2.png`. The text is sharp, comparable to Orca
  after the fix. iTerm2 uses a dark theme, so the edge metric is not compared
  across terminals.
- **DPR 1 and DPR changes**, via CDP `Emulation.setDeviceMetricsOverride`
  (`deviceScaleFactor: 1`) and clearing it, in eight transitions between 2 and
  1:
  - The layer switched between `1912×1344` and `3824×2688`.
  - The chart stayed in the same cells.
  - omp sent no new output (an omp output log recorded under `script` stayed at
    48032 bytes).
  - The DPR 1 replies matched the baseline.

### Open risk

On the first emulation attempt in the fixed build, the chart and its image
layer disappeared even though `devicePixelRatio` stayed at 2. omp sent nothing
(the visible text was unchanged), and the status-line glyphs re-rendered,
which suggests xterm re-created its renderer.

- One baseline trial of the same step kept the image.
- Eight later transitions in the fixed build did not reproduce it.

The cause is unknown. A plausible but unconfirmed one is that the terminal was
rebuilt and dropped its image storage, independent of pixel units
`[INFERENCE]`. It needs a reliable repro before it can be attributed.
