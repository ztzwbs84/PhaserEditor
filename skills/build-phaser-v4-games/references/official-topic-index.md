# Official Phaser 4.2.1 Topic Index

## Contents

- [How to use this index](#how-to-use-this-index)
- [Detailed coverage matrix](#detailed-coverage-matrix)
- [Cross-topic routing](#cross-topic-routing)
- [What the official topics do not replace](#what-the-official-topics-do-not-replace)

## How to Use This Index

The core references in this skill explain version evidence, ownership, production architecture, failure handling, performance, and verification. The vendored official topics add detailed API inventories, configuration fields, events, examples, and subsystem-specific gotchas.

Read the core reference for the engineering decision and one or two matching official topics for API depth. Do not load every official topic. Before copying an exact signature, run `scripts/query-phaser-api.mjs` or inspect the installed declaration and implementation. Read `official-corrections-4.2.1.md` whenever a task uses v4 additions, runtime factories, or a migrated v3 example.

## Detailed Coverage Matrix

| Official topic | Detail added beyond the custom core | Pair with core reference |
| --- | --- | --- |
| [actions-and-utilities](official/4.2.1/actions-and-utilities/topic.md) | Complete Actions inventory; property setters/incrementers; placement, alignment, distribution, interpolation, rotation, queries; Array, Object, and String utilities; v4 effect actions. | `gameplay-services-media.md` for deterministic use, mutation boundaries, and security. |
| [animations](official/4.2.1/animations/topic.md) | Play variants, reverse, chaining, mixing, pause/stop, frame events, per-frame duration, stagger, JSON import/export, frame mutation, Aseprite, and complete AnimationManager/AnimationState tables. | `assets-textures-animations.md` for global key ownership, idempotent creation, cache lifetime, and authoritative-state boundaries. |
| [audio-and-sound](official/4.2.1/audio-and-sound/topic.md) | WebAudio versus HTML5 Audio, markers/audio sprites, rate, detune, pan, spatial audio, decoding, analyser, events, and sound configuration tables. | `cameras-scale-audio-time.md` for unlock, cross-Scene ownership, interruption, buses, and teardown. |
| [cameras](official/4.2.1/cameras/topic.md) | Fade, flash, shake, pan, zoom, rotate effects; fixed/smoothed controls; ignore lists; deadzones; render list; force-composite; Camera filter details and events. | `cameras-scale-audio-time.md` for coordinate ownership, multi-camera input, renderer cost, and responsive behavior. |
| [curves-and-paths](official/4.2.1/curves-and-paths/topic.md) | Line, ellipse, spline, Bezier and path construction; followers; tangents, lengths, spaced points, JSON, and API tables. | `gameplay-services-media.md` for deterministic sampling, pooling, and domain/presentation separation. |
| [data-manager](official/4.2.1/data-manager/topic.md) | DataManager, Scene data, registry and Game Object data APIs; change events; merge/query/freeze; proxy/reference semantics; persistence patterns and restart gotchas. | `gameplay-services-media.md` and `production-playbook.md` for typed state ownership, saves, and avoiding the registry as a service locator. |
| [events-system](official/4.2.1/events-system/topic.md) | EventEmitter API plus Scene, Game, Loader, Input, Animation, Tween, Physics, Texture and Time event namespaces and callback shapes. | `bootstrap-scenes-lifecycle.md` and `gameplay-services-media.md` for callback identity, global emitter lifetime, and shutdown symmetry. |
| [filters-and-postfx](official/4.2.1/filters-and-postfx/topic.md) | Internal/external FilterList APIs, all built-in filters, controller options, ordering, masks, camera filters, custom filters, and migration tables. | `rendering-performance.md` for WebGL gating, render-target cost, fill rate, profiling, and context restore. |
| [game-object-components](official/4.2.1/game-object-components/topic.md) | Complete component/mixin inventory and exact Alpha, Tint, Transform, Origin, Depth, Flip, Mask, Bounds, Lighting, RenderNodes and factory behavior. | `gameobjects-input-ui.md` and `v4-2-rendering.md` for primitive choice, hierarchy cost, ownership, and 4.2 type drift. |
| [game-setup-and-config](official/4.2.1/game-setup-and-config/topic.md) | Full GameConfig and nested config field tables; renderer constants; pixel-art, resize, FPS, existing canvas, callbacks, input disabling, lifecycle events and global members. | `bootstrap-scenes-lifecycle.md` for renderer policy, ownership boundaries, SPA teardown, and source precedence. |
| [geometry-and-math](official/4.2.1/geometry-and-math/topic.md) | Geometry classes, intersections, angles, distance, interpolation, snapping, easing, vectors, matrices, RNG, Color APIs and source maps. | `gameplay-services-media.md` for deterministic RNG, domain math, allocation, and removed `Geom.Point` guidance. |
| [graphics-and-shapes](official/4.2.1/graphics-and-shapes/topic.md) | Graphics command API, styles, primitives, paths, transforms, generated textures, all Shape Game Objects and shape-specific methods. | `gameobjects-input-ui.md` and `rendering-performance.md` for hit areas, static texture conversion, batching, and hot-loop cost. |
| [groups-and-containers](official/4.2.1/groups-and-containers/topic.md) | Group configuration and pooling APIs; physics groups; Container child operations; Layer behavior; layout and nested transform examples. | `gameobjects-input-ui.md` and `production-playbook.md` for choosing membership versus transforms, deep hierarchy cost, and pooled lifetime. |
| [input-keyboard-mouse-touch](official/4.2.1/input-keyboard-mouse-touch/topic.md) | Keyboard keys/combos, pointer event flow, hit areas, drag/drop zones, wheel, touch, gamepad APIs, cursor helpers and event tables. | `gameobjects-input-ui.md` for modal priority, camera coordinates, cancellation, remapping, accessibility, and cleanup. |
| [loading-assets](official/4.2.1/loading-assets/topic.md) | Loader config, base/path/prefix, all file types, packs, progress UI, mid-load additions, event order, retries, local schemes and cache removal APIs. | `assets-textures-animations.md` for catalogs, milestones, error/retry UX, global cache leases, CORS, and production validation. |
| [particles](official/4.2.1/particles/topic.md) | Emitter configuration, zones, death zones, processors, follow behavior, pool/reserve, events and API tables. | `tilemaps-particles.md` and `rendering-performance.md` for budgets, pooling, CPU/GPU choice, fill rate, and teardown. |
| [physics-arcade](official/4.2.1/physics-arcade/topic.md) | World/body configuration, dynamic/static bodies, groups, velocity/acceleration, bounds, collide/overlap, processors, categories, events and APIs. | `physics.md` for engine selection, single authority, fixed-domain simulation, static refresh, lifecycle and test strategy. |
| [physics-matter](official/4.2.1/physics-matter/topic.md) | Matter body/game-object factories, compound bodies, constraints, composites, sensors, filters, queries, sleeping, events and API tables. | `physics.md` for body replacement, stable domain IDs, replay boundaries, listener ownership, and restart cleanup. |
| [render-textures](official/4.2.1/render-textures/topic.md) | RenderTexture versus DynamicTexture; render modes; draw, stamp, repeat, erase, capture, snapshots, cameras, saveTexture and full API tables. | `rendering-performance.md` and `migration-v3-v4.md` for command-buffer execution, context restoration, feedback hazards, memory, and v3 migration. |
| [scale-and-responsive](official/4.2.1/scale-and-responsive/topic.md) | Scale modes, centering, zoom, parent/canvas sizes, resize/orientation/fullscreen events, API methods and configuration tables. | `cameras-scale-audio-time.md` for product layout models, safe areas, DPR/fill-rate budgets, input mapping, and mobile browser behavior. |
| [scenes](official/4.2.1/scenes/topic.md) | Scene states, SceneManager and ScenePlugin methods, transitions, parallel Scenes, payloads, ordering, events and common patterns. | `bootstrap-scenes-lifecycle.md` for queued operations, ownership, restart-safe initialization, async guards, and final teardown. |
| [sprites-and-images](official/4.2.1/sprites-and-images/topic.md) | Image/Sprite factories, texture/frame changes, origin, alpha, tint, flip, crop, blend, depth, bounds and specialized textured objects. | `gameobjects-input-ui.md` for Image versus Sprite choice, component ownership, pooling, transforms, input, and accessibility. |
| [text-and-bitmaptext](official/4.2.1/text-and-bitmaptext/topic.md) | TextStyle, fonts, wrapping, alignment, padding, shadows, RTL, resolution, metrics, BitmapText and DynamicBitmapText APIs. | `gameobjects-input-ui.md` and `rendering-performance.md` for semantic UI, localization, font readiness, rerasterization, texture memory, and frequent counters. |
| [tilemaps](official/4.2.1/tilemaps/topic.md) | CSV/Tiled/raw creation, tilesets, layer/object APIs, collision callbacks, tile properties, queries, edits, animated tiles, culling and API tables. | `tilemaps-particles.md` for CPU/GPU selection, streaming, collision authority, edit regeneration, Canvas policy, and large-world budgets. |
| [time-and-timers](official/4.2.1/time-and-timers/topic.md) | Clock, TimerEvent and Timeline configuration; elapsed/progress access; pause, reset, removal, timeScale, events and complete cutscene timelines. | `cameras-scale-audio-time.md` for millisecond boundaries, Scene pause semantics, real/domain time, async lifetime, and ownership. |
| [tweens](official/4.2.1/tweens/topic.md) | Tween builders/config, chains, stagger, easing map, callbacks/events, persistence, playback controls and TweenManager API. | `cameras-scale-audio-time.md` for presentation authority, physics conflicts, pause matrix, cleanup, reduced motion, and deterministic rules. |
| [v3-to-v4-migration](official/4.2.1/v3-to-v4-migration/topic.md) | Exhaustive breaking-change inventory: RenderNodes, Canvas guidance, filters, tint, cameras, texture orientation, shaders, lighting, removed objects/plugins/utilities, Spine and checklist. | `migration-v3-v4.md` for staged migration order, plugin gates, baselines, ownership, performance and release verification. |
| [v4-new-features](official/4.2.1/v4-new-features/topic.md) | Phaser 4.0-era Filters, RenderNodes, CaptureFrame, Gradient, Noise, GPU layers, Lighting, RenderSteps and tint modes. | `v4-2-rendering.md` for later CustomContext, Mesh2D, stencils, secondary tint, cone lights, FPS limiting and declaration/runtime drift. |

## Cross-Topic Routing

- A narrow API question normally needs one official topic plus `official-sources-api.md`.
- A feature implementation normally needs one or two official topics plus the matching core ownership reference and `production-playbook.md`.
- A bug involving restart, duplicate callbacks, missing textures, stale input, or persistent audio needs the subsystem topic plus `bootstrap-scenes-lifecycle.md`.
- A rendering feature needs the object/filter topic plus `rendering-performance.md`; add `v4-2-rendering.md` for 4.2 APIs.
- A migration needs `migration-v3-v4.md`, the official migration topic, every affected subsystem topic, and the installed source.
- A performance task should load subsystem topics only after profiling identifies the bottleneck class.

## What the Official Topics Do Not Replace

The official topics are detailed API notes, not a complete product engineering policy. They do not replace:

- Installed-version resolution and declaration/runtime reconciliation.
- Explicit ownership across Scene shutdown, global managers, async work, caches, audio, DOM, workers, sockets, and GPU resources.
- Domain-state separation for replay, networking, saves, deterministic tests, and rendering restarts.
- Loading failure, retry, offline, consent, accessibility, localization, security, observability, and release design.
- Representative browser, renderer, mobile, context-loss, performance, and long-session verification.
- The version-specific corrections in `official-corrections-4.2.1.md`.
