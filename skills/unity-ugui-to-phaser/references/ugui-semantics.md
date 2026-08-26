# UGUI Semantics

## Contents

- Serialization and references
- Canvas and coordinate space
- RectTransform
- Draw order and transforms
- Layout system
- Images and resources
- Text
- Masks and scrolling
- Nested Prefabs
- Controls, animation, and custom presentation

## Serialization And References

- Preserve Unity YAML document type, file ID, stripped state, and complete object references.
- Treat file IDs as strings; signed and oversized IDs are valid identity values.
- Keep unknown serialized fields so adapters and diagnostics can inspect them.
- Resolve GUIDs across the complete Assets tree. Package and built-in script GUIDs may require a separate known-component registry rather than an Assets lookup.
- A sprite reference identifies both a texture asset and a sprite sub-asset. Match the sprite importer table by file ID before falling back to a whole texture.

## Canvas And Coordinate Space

Read Canvas and CanvasScaler before choosing render dimensions. Preserve render mode, reference resolution, scale mode, screen-match mode, match value, reference pixels per unit, sorting order, nested canvases, and override sorting.

Apply the same scale calculation as Unity for each target viewport. Do not treat reference resolution as a universal fixed canvas when the scaler specifies a different rule.

## RectTransform

For each axis, derive the child size from the parent anchor span plus size delta. Derive the pivot position from the anchor reference, anchored position, size, and pivot. Convert Unity bottom-origin Y semantics to the target top-origin coordinate system once, at the shared geometry boundary.

Preserve:

- anchor minimum and maximum;
- pivot;
- anchored position and size delta;
- offset minimum/maximum equivalence;
- local position, quaternion, Euler hint, and local scale;
- driven values and serialized fallback values;
- root order and parent relationship.

Recompute derived offsets after overrides. Test fixed, stretched, mixed-anchor, negative-size, noncentral-pivot, rotated, scaled, and deeply nested cases.

## Draw Order And Transforms

Sibling order determines normal UGUI draw order. Nested canvases and sorting overrides can create separate ordering domains. Apply transforms around the Unity pivot and compose parent transforms. Masks and hit areas must follow the same transform chain.

Do not use renderer-local Z patches to compensate for incorrect hierarchy or order data.

## Layout System

Model Unity's layout phases rather than a generic flexbox approximation:

1. horizontal layout input;
2. horizontal layout control;
3. vertical layout input;
4. vertical layout control;
5. fitter/aspect updates and repeated stabilization when dependencies change.

Support HorizontalLayoutGroup, VerticalLayoutGroup, GridLayoutGroup, LayoutElement, ContentSizeFitter, and AspectRatioFitter with their serialized padding, spacing, alignment, control, force-expand, child-scale, reverse-order, priority, ignore-layout, constraint, and fit modes.

Intrinsic size must use the final sprite metadata or shared text measurement. Detect nonconvergence and emit a blocking diagnostic instead of returning an arbitrary pass count.

## Images And Resources

Preserve source sprite rectangle, atlas orientation, border, pivot, pixels per unit, pixels-per-unit multiplier, color multiplication, alpha, preserve-aspect, fill-center, raycast flags, and Image type.

- Simple: scale or preserve aspect using the sprite sub-rect.
- Sliced: apply border scaling exactly when the destination is smaller than combined borders.
- Tiled: tile the sprite sub-rect, not the entire atlas texture.
- Filled: implement horizontal, vertical, radial 90, radial 180, and radial 360 with origin and clockwise semantics.
- RawImage: preserve texture, UV rectangle, color multiplication, and material behavior.

Canvas2D tint must multiply RGB and alpha; changing only element opacity is not equivalent to Unity Graphic color. Phaser and HTML must use the same normalized tint values.

Materials and shaders are presentation behavior. Implement an adapter, bake the effect, or block the affected state. Ignoring `m_Material` is not 1:1.

## Text

Keep Legacy Text and TextMeshPro data distinct while normalizing shared layout concepts. Preserve font identity, font style, size, line spacing, character spacing, alignment, align-by-geometry, wrapping, overflow, best fit/auto size, rich text, color, material, margins, outline, shadow, and masking.

Use one shared measurement and glyph-layout result for every renderer. Layout must expose logical rect, glyph bounds, effect bounds, baselines, line metrics, and clipping decision.

Unity rich text and TMP have different tag sets. Unsupported tags require a diagnostic; stripping them silently is not acceptable. Runtime localization must be captured with deterministic resolved strings for visual verification.

## Masks And Scrolling

Distinguish Mask, RectMask2D, and ScrollRect:

- Mask uses the graphic shape and stencil semantics; `showMaskGraphic` controls mask graphic visibility, not whether clipping exists.
- RectMask2D clips to a transformed rectangle with padding and softness where supported.
- ScrollRect uses viewport clipping plus content movement; it is not equivalent to placing `overflow: hidden` on the ScrollRect node.

Compose ancestor masks and transforms. Verify nested masks, rotated/scaled masks, inactive masks, and maskable flags. A rectangular geometry mask is not a valid fallback for a nonrectangular sprite mask unless explicitly waived.

## Nested Prefabs

Expand recursively with cycle and depth protection. Clone stable source references, map stripped aliases, attach added components, apply removals, remove descendants of removed GameObjects, and then apply overrides.

Match override targets by complete reference first and file ID fallback only when unambiguous. Support component and subfield overrides that affect presentation, including colors, resources, image modes, text settings, layout settings, transforms, active state, and ordering.

A target that is genuinely stale may remain informational. A target that exists but cannot be mapped or a visual property that cannot be applied is blocking.

## Controls, Animation, And Custom Presentation

Idle appearance alone is insufficient for interactive parity. Capture required control states such as normal, highlighted, pressed, selected, disabled, on/off, min/max/value, scroll positions, dropdown state, input placeholder/content, and transition frames.

Classify custom components by inspecting serialized fields and source assemblies/scripts. Common adapters include gradient graphics, grayscale/material effects, custom text/icon renderers, mesh graphics, button-scale effects, Spine renderers, and runtime item renderers.

Nonvisual click sound or analytics metadata may remain preserved-only after classification. Visual or state-changing custom behavior requires an adapter or blocks the affected state.
