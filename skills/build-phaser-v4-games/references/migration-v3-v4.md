# Phaser 3 to 4 Migration

## Contents

- [Migration strategy](#migration-strategy)
- [Renderer and effects](#renderer-and-effects)
- [Cameras, textures, and shaders](#cameras-textures-and-shaders)
- [Game Objects and utilities](#game-objects-and-utilities)
- [Plugins and builds](#plugins-and-builds)
- [Sequenced checklist](#sequenced-checklist)
- [Verification](#verification)

## Migration Strategy

Do not combine a Phaser major migration with unrelated gameplay refactors. Establish a v3 baseline first: build/tests, deterministic screenshots, representative performance, Scene transition soak, save compatibility, and supported devices.

Then:

1. Inventory public API, custom renderer/Pipeline code, third-party plugins, custom shaders, masks/FX, render textures, compressed textures, Spine, removed Game Objects, and custom builds.
2. Upgrade package/build/type integration and make the project boot.
3. Migrate renderer architecture and visual systems.
4. Migrate individual Game Objects/content.
5. Run visual/performance/lifecycle validation before architecture cleanup.

Use `audit-phaser-project.mjs` to find likely v3 patterns, then verify every finding against owner source. Some names remain valid in Canvas-only or unrelated APIs.

## Renderer and Effects

| Phaser 3 | Phaser 4 |
| --- | --- |
| Custom Pipeline | RenderNode architecture or higher-level Shader/Filter/Game Object |
| `preFX` / `postFX` | `filters.internal` / `filters.external` after `enableFilters()` on Game Objects |
| BitmapMask | Mask Filter |
| GeometryMask in WebGL | Mask Filter; GeometryMask remains relevant to Canvas path |
| `setTintFill(color)` | `setTint(color).setTintMode(Phaser.TintModes.FILL)` |
| Light2D Pipeline | `setLighting(true)` plus configured LightsManager |

Removed derived FX have v4 compositions/replacements:

- Bloom: `Phaser.Actions.AddEffectBloom` or explicit parallel filters.
- Shine: `Phaser.Actions.AddEffectShine`.
- Circle mask/effect: `Phaser.Actions.AddMaskShape` or Mask/Vignette design.
- Gradient effect: Gradient Game Object where the replacement semantics fit.

CanvasRenderer remains present but official v4 guidance considers it deprecated for new projects. Do not treat `AUTO` fallback as visual parity after adopting filters, lighting, GPU layers, or RenderNodes.

Custom RenderNodes must restore Phaser-managed WebGL state, handle context restore, and have source-pinned tests. Do not mechanically rename Pipeline classes.

## Cameras, Textures, and Shaders

The Camera matrix system changed:

- Standard scroll/zoom/rotation/follow APIs generally remain the migration path.
- Direct `camera.matrix` consumers must account for v4 matrix, external matrix, combined matrix, scroll, and Camera position semantics.
- Revalidate pointer/world conversion, custom culling, shaders, and multi-camera composition.

Texture orientation changed to standard GL orientation for WebGL internals:

- Normal PNG/JPEG textures are adapted by Phaser.
- Re-compress compressed textures with the required vertical orientation.
- Update custom shader UV assumptions and framebuffer sampling.

Shader changes include:

- Shader Game Object uses the v4 config-based construction API.
- Shadertoy-style automatic uniforms are no longer assumed; declare/update required uniforms.
- Use the current `setUniform`/texture APIs from installed source.
- GLSL loading no longer relies on the old fragment/vertex classification model; v4 supports its pragma preprocessing approach.
- `Shader#setTextures()` replaces the array rather than appending across calls.

DynamicTexture/RenderTexture drawing is command-buffered in v4. Add the required `render()` execution or use the intended render mode. Revalidate preserve/capture/snapshot/saveTexture and context restoration.

## Game Objects and Utilities

- Phaser 3 Mesh and Plane Game Objects were removed. Phaser 4.2 adds the distinct WebGL-only `Mesh2D`; it is not a drop-in migration target and uses flat vertex/index arrays plus explicit topology strategies.
- `Geom.Point` and related helpers were removed; use `Phaser.Math.Vector2`.
- `Math.TAU` now has conventional `PI * 2` semantics; replace old `PI2` and audit any prior TAU assumptions.
- `Phaser.Struct.Set` and `Phaser.Struct.Map` were removed; use native `Set`/`Map`.
- Create.GenerateTexture, Create palettes/folder, and TextureManager.generate were removed. Use Graphics/RenderTexture/DynamicTexture workflows appropriate to the output.
- TileSprite no longer supports texture cropping, but supports atlas/spritesheet frames and tile rotation.
- Grid shape outline naming moved to stroke terminology; Rectangle supports v4 rounded behavior.
- Tint color and tint mode are separate.
- `roundPixels` defaults/implementation changed; recheck pixel-art Camera and renderer output.
- DOMElement requires its configured DOM container/parent and can fail if absent.

Do not assume all v3 tutorials fail. Verify each API by installed owner class; migrate only actual removed/changed behavior.

## Plugins and Builds

Audit every third-party plugin for:

- Declared Phaser 4 compatibility and active maintenance.
- Pipeline, FX, mask, shader, Camera matrix, texture orientation, Mesh/Plane, or private renderer use.
- Package subpath/removed entry-point imports.
- Scene/global plugin shutdown and duplicate registration.
- Type declaration compatibility and bundler format.
- Canvas assumptions and WebGL capability gates.

Camera3D, Layer3D, old Facebook detection/plugin paths, IE9 build, and legacy polyfills were removed. Bundled legacy Spine plugins are not the recommended maintained path; use the current official Esoteric Software integration compatible with the selected Phaser version.

For custom builds, recreate entry points from v4 source intentionally. The npm exports map does not promise every `src/*` path as a public package subpath.

## Sequenced Checklist

1. Pin Phaser v4 and update lockfile/build/type configuration.
2. Replace removed entry points/plugins and establish a booting minimal Scene.
3. Set renderer policy: WebGL required or tested Canvas fallback.
4. Replace Pipelines with higher-level v4 APIs or source-pinned RenderNodes.
5. Replace FX/masks and migrate tint/lighting.
6. Update Camera matrix consumers and coordinate tests.
7. Update compressed texture orientation and shader UV/uniform/config APIs.
8. Add DynamicTexture/RenderTexture command execution and restore handling.
9. Replace removed Game Objects, geometry, structs, math constants, and generation utilities.
10. Update TileSprite/Grid/DOMElement behavior and pixel-art snapshots.
11. Upgrade/replace third-party and Spine plugins.
12. Regenerate/validate types and remove temporary casts.
13. Run visual, interaction, physics, audio, lifecycle, performance, and save compatibility suites.

## Verification

- Compare deterministic v3/v4 screenshots by Scene and Camera, allowing only approved differences.
- Test standard and custom shaders with normal, compressed, framebuffer, and render textures.
- Exercise every filter/mask/tint/light combination used by content.
- Test Canvas only if it remains supported; otherwise verify intentional unsupported-device handling.
- Repeat start/stop/restart/remount to find migration-introduced ownership leaks.
- Compare cold load, first render, steady frame time, draw calls, texture memory, and low-end mobile performance.
- Compile without broad `any`, ignored diagnostics, or stale v3 declaration packages.
- Preserve save/network protocol compatibility or ship explicit version migrations.
