# Rendering, Filters, and Performance

## Contents

- [Renderer choice](#renderer-choice)
- [Phaser 4 WebGL architecture](#phaser-4-webgl-architecture)
- [Diagnose before optimizing](#diagnose-before-optimizing)
- [Batching and fill rate](#batching-and-fill-rate)
- [Filters, lighting, and shaders](#filters-lighting-and-shaders)
- [Render and dynamic textures](#render-and-dynamic-textures)
- [GPU layers](#gpu-layers)
- [Context loss and evidence](#context-loss-and-evidence)

## Renderer Choice

Phaser 4 includes WebGL and Canvas renderers, but its new rendering systems are WebGL-first. Official v4 migration guidance treats Canvas as deprecated for new projects. Read `v4-2-rendering.md` when the project uses Phaser 4.2 rendering additions.

| Capability | WebGL | Canvas |
| --- | --- | --- |
| Normal Images/Sprites/Text/basic Graphics | Yes | Yes, object-dependent |
| v4 Filters | Yes | No |
| Lighting/tint shader modes | Yes | Limited/no equivalent by feature |
| RenderNodes/custom shader path | Yes | No |
| CustomContext/Mesh2D/Stencil | Yes | No |
| SpriteGPULayer/TilemapGPULayer | Yes | No |
| Geometry mask path | Replaced by filter-based masking | Retained for Canvas-supported objects |

Use `Phaser.WEBGL` when any mandatory feature is WebGL-only. `Phaser.AUTO` can choose Canvas on an unsupported device, so either gate every advanced feature and test both backends or fail with an intentional unsupported-device state.

Canvas can still be useful for constrained legacy/basic content, tests, or environments where its exact capabilities are accepted. Do not assume visual parity.

## Phaser 4 WebGL Architecture

Phaser 4 replaced v3 Pipelines with RenderNodes. The WebGLRenderer owns a RenderNodeManager; nodes perform focused tasks such as submission, transformation, texturing, tinting, batching, filters, cameras, and render targets.

Public product code should usually stay at Game Object, Filter, Shader, RenderTexture, and Camera APIs. Extend RenderNodes when building a reusable renderer feature that cannot be expressed above them.

Phaser 4.2 adds `CustomContext`, `Mesh2D`, `Stencil`, `StencilReference`, alpha strategies, secondary tint, and cone lights. These require version-specific review; do not infer them from the official 4.1 API page.

RenderNode extension requirements:

- Pin Phaser minor version and verify constructor/role/config signatures from installed source.
- Avoid reaching into underscore-prefixed Game Object arrays or renderer wrapper internals without explicit ownership.
- Restore all WebGL state through Phaser's architecture; do not leave bindings/blend/stencil/framebuffer state dirty.
- Support context loss/restoration and resource recreation.
- Add a deterministic visual fixture, multiple Cameras/render targets, filters/masks, resize, and teardown tests.
- Re-run API/source validation on upgrades.

## Diagnose Before Optimizing

| Symptom | Likely class | Inspect |
| --- | --- | --- |
| High scripting, GPU idle | Scene update, physics, transforms, input, allocation | object/body count, deep Containers, callbacks, sorts, GC |
| High GPU/composite | Fill rate and passes | DPR, overdraw, full-screen filters, lights, render targets |
| Many draw calls | Batch/state breaks | texture order, blend/tint/lighting/filter/shader changes, Cameras |
| First-use hitch | Network/decode/upload/compile | asset milestones, texture upload, shader compilation, Text creation |
| Periodic stalls | Allocation, cache churn, bulk destruction | particles, Text/Graphics updates, pool resets, asset replacement |
| Degrades after transitions | Ownership leak | global events, Sounds, cache, Scene references, GPU resources |
| Canvas-only failure | Unsupported v4 feature | renderer selection and feature gates |

Profile the same scenario and device before and after one material change.

## Batching and Fill Rate

- Atlas compatible art and order display objects to reduce texture, blend, shader, lighting, filter, and target changes.
- `batchSize` and `maxTextures` are GameConfig controls, not universal tuning knobs. Larger buffers consume memory and do not fix state breaks.
- `autoMobileTextures` can constrain mobile texture batching behavior; validate the installed default and device-specific rationale before changing it.
- Avoid frequent depth changes/sorts and deep Container matrices.
- Limit transparent full-screen layers, oversized particles, large lights, and overlapping effects.
- RESIZE/high-DPR canvases multiply pixel work. Choose logical size and host scaling intentionally.
- Dynamic Text changes rerasterize/upload; prefer BitmapText for frequent counters.
- Rebuilding complex Graphics every frame creates CPU geometry work; use stable objects, textures, or shader data.

CPU culling cannot fix a fill-rate-bound scene if the visible region remains expensive. Conversely, aggressive custom culling can add CPU cost to an already CPU-bound scene.

## Filters, Lighting, and Shaders

Game Objects require `enableFilters()` before accessing their Filter lists. Cameras have filter support through their v4 Camera implementation.

- Internal filters operate in object-local capture space and are generally smaller/cheaper.
- External filters operate in rendering context/screen space and can require large targets.
- Each active pass adds render-target, draw-call, bandwidth, and memory cost.
- Filter order changes output.
- Bound padding/regions and avoid one filtered object per particle/card/list row when a composite can be filtered once.
- Reuse controllers only when shared mutable state is intended; `ignoreDestroy` transfers lifecycle responsibility.
- Static mask sources should avoid unnecessary per-frame capture updates.
- Lighting changes shader/batching. Group compatible lit content and cap visible lights.

Custom shaders must use Phaser 4's current config/uniform APIs and GL texture orientation. Standard images are adapted internally, but custom/compressed texture workflows may require vertical-orientation changes from v3.

Validate precision, premultiplied alpha, blend/tint mode, normal-map conventions, Camera matrices, texture units, resizing, and context restoration.

## Render and Dynamic Textures

Phaser 4 buffers DynamicTexture/RenderTexture draw commands. Call `render()` to execute them unless the selected RenderTexture render mode performs the intended redraw automatically.

In Phaser 4.2.1, `RenderTexture#render()` is declared as `void` even though the implementation returns `this`; avoid relying on chaining unless the project carries a narrow version-pinned type augmentation.

- Do not draw a DynamicTexture into itself.
- Command buffers clear after render unless preservation is enabled.
- Resize recreates storage and erases content.
- Snapshot/readPixels paths synchronize GPU work; never use full snapshots in the frame loop.
- WebGL1 framebuffer antialiasing differs from the main canvas; verify visual quality.
- Context loss discards dynamically rendered content; redraw it after restoration.
- `saveTexture` changes Texture Manager ownership/name behavior rather than making an independent copy; verify before destroying the originating object.

Track framebuffer dimensions and lifetime. Full-screen Camera filters plus multiple RenderTextures can dominate mobile GPU memory.

## GPU Layers

SpriteGPULayer and TilemapGPULayer trade general Game Object flexibility for specialized GPU data models.

Choose them only after establishing:

- The content fits single-texture/tileset and topology restrictions.
- Input, per-member events, hierarchy, physics, filters, and dynamic edits are not required as normal objects.
- Buffer/data-texture updates are infrequent enough.
- Fill rate and overdraw will not dominate after draw-call reduction.
- Canvas fallback is not required.

Measure standard Sprite/TilemapLayer and GPU-layer implementations with representative update rates. One draw call can still be slow when it shades too many pixels or uploads large buffers every frame.

## Context Loss and Evidence

Test WebGL context loss/restoration for custom shaders, RenderNodes, DynamicTextures, GPU layers, and third-party plugins. Recreate owned GPU resources from CPU/catalog state and avoid assuming a Scene restart repairs renderer-global state.

Record:

- Phaser version, renderer, browser, device/GPU, viewport, and DPR.
- Scene/Game Object/Container/body/particle/tile/light/filter counts.
- Median and bad-frame CPU/GPU time, not FPS alone.
- Draw calls/batches, render-target dimensions/count, textures and estimated memory.
- Cold load/decode/compile/first-render spikes separately from steady state.
- Input burst, resize/orientation, pause/resume, and repeated Scene transitions.

Do not publish release-note peak figures as a project benchmark. A commercial performance claim needs the actual content and supported low-end device.
