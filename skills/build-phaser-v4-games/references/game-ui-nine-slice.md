# Game UI, Nine-Slice, and Image Slicing

Use this workflow for visible HUDs, menus, dialogs, inventories, result screens,
virtual controls, and other interfaces that belong to the game world. The goal
is a game-native composition built from authored visual assets, not a website
header or dashboard placed around the canvas.

## Contents

- [Choose the presentation system](#choose-the-presentation-system)
- [Compose a game interface](#compose-a-game-interface)
- [Choose an image primitive](#choose-an-image-primitive)
- [Prepare a nine-slice texture](#prepare-a-nine-slice-texture)
- [Cut and inspect source art](#cut-and-inspect-source-art)
- [Implement Phaser NineSlice](#implement-phaser-nineslice)
- [Validate rendered UI](#validate-rendered-ui)

## Choose the Presentation System

Keep visible game presentation in Phaser by default:

- HUD meters, counters, ability bars, inventory slots, dialog frames, pause
  menus, result screens, and touch controls belong in a HUD Scene or a shallow
  Phaser UI owner.
- Use DOM for editable text, forms, account or payment flows, long prose, and
  browser accessibility semantics. A semantic mirror for canvas controls may be
  visually hidden while remaining keyboard and screen-reader usable.
- Do not leave a starter's visible DOM title bar, stat strip, generic buttons,
  mobile telemetry section, card grid, or app-like navigation as the final game
  interface unless the requested game fiction explicitly calls for that form.
- Keep machine-readable quality fields in the DOM dataset. They are a test
  protocol, not a visual design requirement.

DOM and Canvas may coexist, but assign each one a clear job. Do not duplicate
two competing visible interfaces or let CSS layout determine gameplay camera
space.

## Compose a Game Interface

Start from the game's fiction, repeated player decisions, existing art, and
target viewport. Define a compact UI inventory before drawing:

| UI element | Player question | Suitable presentation |
| --- | --- | --- |
| Critical HUD | What must I notice during action? | Anchored Phaser objects with strong silhouette |
| Secondary status | What can I inspect between actions? | Collapsible panel, tab, or pause layer |
| Command | What can I do now? | Icon or icon plus short label with explicit states |
| Dialog or tooltip | What needs variable content? | NineSlice frame plus constrained text content rect |
| Meter | How much remains? | Framed bar, mask/crop fill, threshold states |
| Inventory or skill slot | Which object is selected or available? | Repeated framed cells from an atlas |

For each component record the texture key/frame, fixed border insets, content
rectangle, internal padding, minimum size, anchor, depth, input hit area, focus
state, disabled state, and localization behavior. Use one responsive layout
owner. Anchor to the logical viewport and safe-area offsets; do not scatter
coordinates through event callbacks.

Treat the reference viewport as an authored composition rather than a flowing
web page. Scale or reflow at deliberate breakpoints:

- Preserve the playfield and critical HUD first.
- Move secondary panels into a modal or compact mode on portrait screens.
- Keep touch controls inside reachable safe zones without covering objectives.
- Reserve stable bounds for counters, labels, icons, and meters so value changes
  cannot shift adjacent controls.

## Choose an Image Primitive

| Visual need | Phaser primitive | Important constraint |
| --- | --- | --- |
| Fixed-size icon or ornament | `Image` | Do not stretch detailed art |
| Animated icon or portrait | `Sprite` | Use named atlas frames |
| Rectangular frame with scalable center | `NineSlice` | WebGL-only; frame must be untrimmed |
| Horizontal bar or button with fixed caps | 3-slice `NineSlice` | Set top and bottom slices to zero |
| Seamless repeated fabric, chain, or border | `NineSlice` with `tileX`/`tileY` | Source scalable region must tile cleanly |
| Repeated background fill | `TileSprite` | Keep decorative pattern out of fixed corners |
| Flat debug/prototype surface | `Graphics` | Replace with authored art before visual acceptance |
| Frequent numeric text | `BitmapText` | Font atlas must cover all localized glyphs |

Use one `NineSlice` rather than manually positioning nine Sprites when Phaser's
stretch/tile behavior matches the art. Use a custom nine-image composite only
when Canvas fallback is a real requirement or individual regions need behavior
that `NineSlice` cannot express.

## Prepare a Nine-Slice Texture

Inspect the source bitmap at 1:1 with alpha visible. Derive slice lines from the
art; do not guess equal insets merely because the frame is rectangular.

1. Put corners, bevel turns, rivets, and other shape-defining details entirely
   inside the fixed regions.
2. Choose horizontal and vertical scalable strips that are visually uniform or
   intentionally seamless. Keep shadows, highlights, texture features, and
   motifs that must not deform out of those strips.
3. Keep a non-empty center region. Confirm that the smallest runtime size is at
   least `left + right` by `top + bottom`.
4. Preserve transparent padding needed by the frame. Phaser `NineSlice` does
   not support trimmed atlas frames.
5. When packing into an atlas, disable trim and rotation for these frames. Add
   suitable padding/extrusion to stop neighboring pixels bleeding under linear
   sampling.
6. For pixel art, use nearest filtering, integer slice coordinates, integer
   placement, and integer display sizes. For painted UI, use linear filtering
   and inspect every border for seams at target DPR values.

TexturePacker 7.1 or newer can export a center rectangle as
`scale9Borders: { x, y, w, h }`. Phaser 4.2.1 parses that data from JSON Array
and JSON Hash atlases. Here `x/y` equal the left/top fixed insets and `w/h` are
the scalable center dimensions. Do not combine this metadata with atlas trim.

## Cut and Inspect Source Art

Use the bundled helper when a supplied or generated bitmap must be measured,
cut into inspectable cells, or previewed before Phaser integration. It preserves
the source, refuses a non-empty output directory, emits all nine lossless crops,
adds a slice guide, renders requested stretch/tile previews, verifies fixed
corners, and writes a machine-readable manifest.

The script requires Python with Pillow. In Codex desktop, call the workspace
dependency loader and use the returned Python executable.

```bash
python <skill-dir>/scripts/slice-game-ui.py panel.png \
  --insets 24 20 24 20 \
  --out-dir .quality/ui/panel \
  --preview 320x96 \
  --preview 480x240
```

For a repeatable center or edge pattern, preview Phaser 4's tile behavior:

```bash
python <skill-dir>/scripts/slice-game-ui.py chain-frame.png \
  --insets 16 16 16 16 \
  --tile-x --tile-y \
  --filter nearest \
  --out-dir .quality/ui/chain-frame \
  --preview 256x96 \
  --preview 384x192
```

Review `slice-guide.png`, every file under `slices/`, every preview, and
`slice-manifest.json`. The crops are inspection and fallback assets; Phaser's
normal runtime path should keep the original untrimmed texture or atlas frame.
The manifest's automated result proves only that fixed corner pixels survived;
`visualReviewRequired` remains true because a motif inside the scalable center
can still deform even when every corner hash is correct.

When insets are unknown, make a first measured pass from the actual pixels,
view the guide and previews, then rerun into a new empty directory with corrected
insets. Never infer production insets from a scaled screenshot when the source
bitmap is available.

## Implement Phaser NineSlice

Phaser 4.2.1 registers `NineSlice` only for WebGL. Select `Phaser.WEBGL` or
feature-gate a deliberate Canvas alternative.

```ts
const panel = this.add.nineslice(
  centerX,
  centerY,
  'ui-atlas',
  'dialog-frame',
  480,
  240,
  24,
  24,
  20,
  20,
  false,
  false,
)

panel.setSize(nextWidth, nextHeight)
```

The arguments after height are left, right, top, bottom, `tileX`, and `tileY`.
Use `setSize` to resize the mesh while preserving fixed corners. Do not use
`setDisplaySize` or non-uniform scale for normal responsive resizing because
that scales the corners and border thickness too.

If the untrimmed atlas frame contains valid `scale9Borders`, Phaser can populate
the insets automatically:

```ts
const panel = this.add.nineslice(x, y, 'ui-atlas', 'dialog-frame')
panel.setSize(width, height)
```

Use explicit arguments when the atlas does not own approved metadata. After
changing the texture/frame or slice contract, call the public `setSlices`
method with source-verified values. A `NineSlice` cannot switch between 3-slice
and 9-slice after construction.

Place labels, icons, meters, and input zones relative to the panel's content
rectangle, not its outer bounds. Keep the hierarchy shallow and update hit areas
when the layout changes.

## Validate Rendered UI

Do not accept UI from a full-page glance alone. Capture the real Phaser canvas
and inspect UI crops at 1:1 for all of these states:

- Reference desktop, portrait mobile, smallest supported viewport, and a large
  content case.
- Idle, hover/focus, pressed, selected, disabled, loading, error, pause, success,
  and failure states that exist in the product.
- Minimum panel size, typical size, widest localized label, maximum counter,
  empty content, and full content.
- Nearest and linear sampling paths when both are supported; representative
  low and high DPR values.

Acceptance requires:

- Corner pixels and border thickness remain stable at every size.
- Edges and centers stretch or tile without visible seams, bleeding, blur, or
  repeated motifs that expose the slice boundaries.
- Text and icons stay inside the authored content rectangle.
- HUD elements do not cover play targets, other controls, or safe-area insets.
- Input hit areas follow the visual state and remain usable on touch.
- The visible result reads as one game art direction, not a generic website or
  developer overlay.
- Semantic DOM mirrors remain synchronized without becoming a second visible
  layout.

Keep the slice manifest, cut cells, previews, canvas screenshots, and inspected
UI crops under the project's ignored quality-artifact directory. A nonblank
canvas check does not prove that a nine-slice is correct.
