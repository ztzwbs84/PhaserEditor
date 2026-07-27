# Official Documentation Coverage and Version Safety

## Contents

- [Observed official surfaces](#observed-official-surfaces)
- [Version rules](#version-rules)
- [Coverage map](#coverage-map)
- [Known documentation hazards](#known-documentation-hazards)
- [Lookup procedure](#lookup-procedure)

## Observed Official Surfaces

The official site was inspected on 2026-07-23. Its public API landing page identified the unversioned API as Phaser 4.1.0. The sitemap exposed versioned API snapshots for 4.0.0, 3.90.0, and 3.88.2, but no 4.2.x snapshot. The source baseline for this skill is Phaser 4.2.1 (`Giedi`).

Use these official surfaces for different purposes:

| Surface | Strength | Version risk |
| --- | --- | --- |
| `https://docs.phaser.io/api-documentation/api-documentation` | Searchable public API inventory | Unversioned route was 4.1.0, not 4.2.1 |
| `https://docs.phaser.io/api-documentation/4.0.0/api-documentation` | Stable v4.0 signature/JSDoc snapshot | Missing 4.1 and 4.2 additions |
| `https://docs.phaser.io/phaser/concepts/` | Explanations and examples | Some pages retain Phaser 3 APIs under a v4 navigation shell |
| `https://phaser.io/examples` | Runnable usage patterns | Select/check the example's Phaser version |
| Installed `types/phaser.d.ts` and `src/` | Exact target-version contract and implementation | Generated declarations can still contain drift |
| Installed `changelog/v4/` and `docs/` | Release-specific additions and migration details | May describe internal APIs; check visibility and types |

## Version Rules

1. Confirm the selected version printed by the API page before copying a signature.
2. Never treat an unversioned concept page as proof that an API exists in v4.
3. For Phaser 4.2.x features, start with the installed changelog and repository docs, then verify declarations and source.
4. Scope declaration searches to the owner class. `BaseCamera#getWorldPoint(x, y, output?)` and Game Object Transform `getWorldPoint(point, ...)` are different APIs.
5. Verify the runtime registration string for dynamically injected Game Object factories and creators. Generated declarations are derived from JSDoc names and can disagree with `register(...)`.
6. Compile a typed fixture and exercise it in the required renderer when declarations and runtime registration disagree.

## Coverage Map

The official concepts navigation covers Actions, Animations, Audio, Cameras, Data Manager, Device, Display, Events, FX, Game, Game Objects, Geometry, Input, Loader, Math, Physics, Scale Manager, Scenes, Textures, Time, Tweens, and Utils.

Use this skill's references as follows:

| Official area | Skill coverage |
| --- | --- |
| Game, Scenes, Scale | `bootstrap-scenes-lifecycle.md`, `cameras-scale-audio-time.md` |
| Loader, Cache, Textures, Animations | `assets-textures-animations.md` |
| Game Objects, Input, Text, DOM UI | `gameobjects-input-ui.md` |
| Audio, Time, Tweens, Cameras | `cameras-scale-audio-time.md` |
| Arcade and Matter | `physics.md` |
| Tilemaps and Particles | `tilemaps-particles.md` |
| Filters, Shaders, RenderTextures, GPU layers | `rendering-performance.md`, `v4-2-rendering.md` |
| Actions, Data, Events, Plugins, Video, Geometry, Curves, Math, Utils | `gameplay-services-media.md` |
| Production, platform, security, testing | `production-playbook.md` |
| v3-to-v4 differences | `migration-v3-v4.md` |

The v4.0 API sitemap contained hundreds of class, namespace, typedef, event, function, and constant pages. Do not load or restate them all. Route to the owning subsystem, then inspect the exact installed declaration/source anchor needed for the task.

## Known Documentation Hazards

- The concepts Geometry page still documents `Phaser.Geom.Point`, removed in Phaser 4. Use `Phaser.Math.Vector2` and verify helper replacements.
- The concepts Game Objects navigation still exposes legacy Mesh and Plane topics. Phaser 4.0 removed those objects; Phaser 4.2 introduced the distinct WebGL-only `Mesh2D` API.
- Legacy FX, BitmapMask, Pipelines, and texture-generation examples can appear in v3 material. Use v4 Filters, RenderNodes, and current texture APIs.
- The unversioned 4.1.0 API cannot document 4.2 additions such as `CustomContext`, `Mesh2D`, `Stencil`, `StencilReference`, cone lights, `setTint2`, or `TimeStep#setFPSLimit`.
- Phaser 4.2.1 declarations expose `GameObjectFactory#customContext`, but the implementation and distribution register the runtime factory as lowercase `customcontext`. Prefer the correctly aligned creator path `this.make.customContext(config, true)` or direct construction plus `this.add.existing`. Do not emit `this.add.customContext(...)` for 4.2.1.

## Lookup Procedure

For each API-sensitive change:

1. Record installed Phaser version and renderer.
2. Find the official page with the nearest matching version and read its owner/parameters/return/events/source link.
3. Find the owner class in `types/phaser.d.ts`; do not use a global method-name hit.
4. Open the linked implementation under `src/` and inspect defaults, guards, side effects, events, and cleanup.
5. Search tests and changelog for behavior that changed after the official page version.
6. Run `scripts/check-phaser-api.mjs` for curated critical anchors.
7. When a discrepancy remains, document it in code/tests and choose a runtime-correct typed path instead of hiding it with broad `any`.

