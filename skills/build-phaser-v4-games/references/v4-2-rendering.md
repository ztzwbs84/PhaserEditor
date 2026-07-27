# Phaser 4.2 Rendering Additions

## Contents

- [Scope and renderer](#scope-and-renderer)
- [CustomContext](#customcontext)
- [Mesh2D](#mesh2d)
- [Stencil and StencilReference](#stencil-and-stencilreference)
- [Alpha, tint, and mipmaps](#alpha-tint-and-mipmaps)
- [Cone lights](#cone-lights)
- [Runtime FPS limit](#runtime-fps-limit)
- [Verification](#verification)

## Scope and Renderer

Phaser 4.2.0 added renderer-level features not present in the official 4.1.0 API site snapshot. Verify them against the installed 4.2.x declarations, changelog, and source. `CustomContext`, `Mesh2D`, `Stencil`, and `StencilReference` are WebGL-only product decisions; force or capability-gate the renderer.

Do not confuse the removed Phaser 3 `Mesh`/`Plane` Game Objects with Phaser 4.2 `Mesh2D`. They have different data and rendering contracts.

## CustomContext

`CustomContext` extends Container and clones the active WebGL `DrawingContext` before its children render. Its callback may change supported context state such as alpha strategy, color write mask, or stencil parameters.

Prefer the creator path in Phaser 4.2.1 because it is aligned in both declarations and runtime source:

```ts
const context = this.make.customContext({
  x: 0,
  y: 0,
  children: [content],
  customContextCallback: (drawingContext) => {
    drawingContext.setAlphaStrategy('dither');
  },
}, true);
```

Known 4.2.1 drift:

- Declaration/JSDoc says `GameObjectFactory#customContext`.
- Runtime `CustomContextFactory.js` registers `customcontext`.
- `GameObjectCreator` registers `customContext`, so `this.make.customContext(config, true)` is the safest public typed path.

Use only documented setters on `DrawingContext`. Creating a new framebuffer from the callback transfers output/lifetime responsibility and is too expensive to repeat without a retained design.

## Mesh2D

Create through the lowercase factory:

```ts
const mesh = this.add.mesh2d(x, y, textureKey, vertices, indices, false);
```

Data layout in v4.2.1:

- `vertices` repeats `x, y, u, v` with a stride of 4.
- `indices` repeats `a, b, c, page` with a stride of 4.
- UVs use Phaser 4 GL orientation; `flipV` changes UV orientation, not geometry.

Choose one topology strategy:

- Stable topology: call `buildOrderedIndices(strategy, true)` once. Strategy 0 is fast/padded, 1 checks the next triangle, and 2 performs the highest-cost global edge matching.
- Dynamic topology: call `setRenderAsTriangles(true)`. It uses the triangle batch path and does not batch with normal quads.
- Preordered data: populate `indicesOrdered` deliberately and set `useOrderedIndices`; cover the format with tests.

Mesh2D supports lighting, but distorted/rotated UVs alter apparent normal-map direction. Validate atlas page indices, winding, bounds, UV orientation, lighting, topology updates, and context restore.

## Stencil and StencilReference

The v4.2 stencil system writes persistent per-frame layers into the WebGL 8-bit stencil buffer. It is not the removed Phaser 3 Geometry/Bitmap mask model.

```ts
const stencil = this.add.stencil(0, 0, maskChildren, {
  stencilLayerMode: 'addLayer',
  stencilAlphaStrategy: 'dither',
});

const removeLayer = this.add.stencilreference(stencil, {
  stencilLayerMode: 'subtractLayer',
});
```

Requirements and constraints:

- Keep `render.stencil` enabled; do not combine stencil Game Objects with `render.stencil: false`.
- Modes are `addLayer`, `subtractLayer`, `clear`, and `clearRegion`.
- Default alpha strategy is `dither`; `'keep'` can make transparent fragments write opaque stencil unless the shader discards them.
- `stencilInvert` adds a draw call and applies only to add/subtract modes.
- Overlapping child geometry accumulates values. The buffer has 8 bits; layer values can wrap unless `stencilValueWrap` is disabled.
- Nesting can force framebuffer composition, increases draw calls, and has weaker antialiasing. Prefer few, shallow stencil operations.
- Use the Mask filter when alpha quality and object-local masking matter more than persistent stencil efficiency.

Phaser 4.2.1 fixed stencil inversion alpha and framebuffer stencil clearing. Do not claim correct behavior from 4.2.0 alone when those paths matter.

## Alpha, Tint, and Mipmaps

New render config controls include:

- `render.alphaStrategy`: `'keep'`, `'dither'`, or numeric threshold for compatible shaders.
- `render.stencil`: enables/disables stencil-buffer creation.
- `render.stencilAlphaStrategy`: default alpha strategy for stencil drawing.
- `render.mipmapRegeneration`: permits framebuffer texture mipmap regeneration; it is expensive and applies to eligible DynamicTexture/RenderTexture storage, not Filter output.

`Phaser.TintModes.MULTIPLY_TWO` and `setTint2` add a secondary corner tint to compatible Tint components. `Mesh2D#setTint2(color)` and Tilemap layer tint APIs use different signatures; verify the owner before calling. In 4.2.1, Mesh2D's runtime `setTint2`/`setTintMode` methods are missing from the generated Mesh2D class declaration, so do not hide the discrepancy with a broad cast. Add a narrow version-pinned declaration augmentation only when the product needs those methods and cover it with the API checker.

Custom shaders must implement the relevant alpha-strategy additions or be composed through a compatible shader. Test premultiplied alpha, transparent edges, dither stability, and batch changes.

For custom Filter controllers, use `getPaddingCeil()` rather than raw fractional `getPadding()` when sizing render targets.

## Cone Lights

Phaser 4.2 adds cone state to normal dynamic Light objects:

```ts
const light = this.lights.addConeLight(
  x, y, radius, 0xffffff, 1,
  rotationRadians, innerAngleRadians, outerAngleRadians,
);

light.setConeRotation(nextRotation);
light.setConeAngles(innerAngle, outerAngle);
// later: light.disableCone();
```

`Light#setCone(rotation, innerAngle, outerAngle?)` configures an existing light. Angles and rotation are radians. Cone lights use the existing lighting shader, so normal-map conventions, visible-light count, lit Game Object setup, and batch/fill budgets still apply.

## Runtime FPS Limit

Use `game.loop.setFPSLimit(limit)` in v4.2+ to change the update cap while keeping TimeStep-derived values synchronized. Do not mutate `fpsLimit` directly. This is an update scheduling cap, not proof of display refresh or stable performance.

## Verification

- Run WebGL-only capability checks and reject/gate Canvas intentionally.
- Compile factory and creator calls against installed types, then exercise the actual distribution at runtime.
- Test stencil disabled/enabled, inverted, nested, clear, restart, and context restore paths.
- Test Mesh2D static/dynamic topology, atlas pages, UV flip, lighting, and buffer mutation.
- Measure CustomContext state changes, stencil layers, mipmap regeneration, alpha discard, and cone lights on representative mobile GPUs.
- Re-run `check-phaser-api.mjs` after every Phaser upgrade; the 4.2.1 CustomContext factory drift is especially version-sensitive.
