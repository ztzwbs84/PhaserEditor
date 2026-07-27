---
name: build-phaser-v4-games
description: "Single entry point for all Phaser 4 engineering: build, architect, debug, review, optimize, test, ship, extend, or migrate HTML5 2D games. Always use this skill whenever work targets Phaser 4 or a v3-to-v4 migration, including GameConfig, Scenes, assets, Game Objects, input, cameras, audio, time, tweens, physics, tilemaps, particles, filters, RenderNodes, TypeScript, performance, memory, responsive/mobile delivery, and production correctness. It routes versioned official topic references and verifies APIs against installed types and source."
---

# Build Phaser 4 Games

Engineer Phaser 4 games from the installed package outward. Prefer version-scoped source evidence, explicit ownership, deterministic domain logic, and measured production behavior over isolated snippets.

## Use One Phaser Entry

This root `SKILL.md` is the only Phaser skill entry. The official Phaser 4.2.1 material under `references/official/` is vendored as ordinary `topic.md` and `reference.md` files, so it adds API depth without creating 28 competing triggers.

For each task:

1. Apply the core version, ownership, lifecycle, and verification workflow in this file.
2. Read the matching compact core reference.
3. Use `references/official-topic-index.md` to select only the one or two official topics needed for detailed APIs, events, configuration, examples, and gotchas.
4. Apply `references/official-corrections-4.2.1.md` before copying v4 feature or factory examples.
5. Verify behavior-sensitive symbols against the installed declaration and implementation.

Do not load all official topics and do not treat a vendored topic as a second skill. If the installed Phaser version differs from `references/official/4.2.1/manifest.json`, use the topics for concepts only until they are resynced and revalidated.

## Establish Ground Truth

1. Inspect the target project's `package.json`, lockfile, source layout, build scripts, test setup, and existing conventions.
2. Resolve the installed `phaser` version from `node_modules/phaser/package.json`. This skill targets v4; use the migration reference when v3 code or dependencies are present.
3. Verify exact APIs in their owning namespace or class. Phaser has many same-named methods, so a global text match is insufficient.
4. Use this evidence order when behavior or signatures disagree:
   - Installed `types/phaser.d.ts` together with the matching implementation under `node_modules/phaser/src/`.
   - Matching tests, package exports, and changelog in the installed release.
   - Version-matched official Phaser skills and API documentation.
   - Current official concepts documentation.
   - This skill's curated references.
5. Treat runtime source and tests as decisive when generated declarations or examples drift. Record the discrepancy instead of silently choosing an overload.
6. Do not silently upgrade Phaser, change renderer, swap physics engines, add a plugin, or adopt a WebGL-only feature. Explain compatibility, bundle, migration, and fallback impact first.

Run both checks early for unfamiliar projects, reviews, and migrations:

```bash
node <skill-dir>/scripts/audit-phaser-project.mjs <project-root>
node <skill-dir>/scripts/check-phaser-api.mjs <project-or-phaser-root>
```

Query any exact or unfamiliar API by owner instead of relying on a global text match:

```bash
node <skill-dir>/scripts/query-phaser-api.mjs <project-or-phaser-root> --owner GameObjectFactory --member mesh2d --json
node <skill-dir>/scripts/query-phaser-api.mjs <project-or-phaser-root> --owner Mesh2D --member setTint2 --json
```

The query reports declaration matches, implementation/registration candidates, and known drift. A runtime-only result is evidence to investigate, not permission to hide the type gap with `any`.

Use `--json` for machine-readable output and audit `--strict` for CI-style failure on warnings. Static findings are a search queue, not proof; inspect the owning Scene and source before editing.

## Route References

Read only the references required for the task.

| Need | Read |
| --- | --- |
| Version evidence, package layout, official docs, source lookup | `references/official-sources-api.md` |
| Official docs version coverage, stale-page hazards, lookup policy | `references/official-docs-coverage.md` |
| Machine-checked critical signatures and known declaration/runtime drift | `references/api-anchors.json` (extend only with version-scoped source evidence) |
| Detailed official API topic selection and custom-core gap matrix | `references/official-topic-index.md` |
| Applied corrections and upstream 4.2.1 coverage gaps | `references/official-corrections-4.2.1.md` |
| Vendored official provenance, hashes, version, and topic files | `references/official/4.2.1/manifest.json` and the routed `topic.md` files |
| GameConfig, boot, Scenes, plugins, lifecycle, global vs local ownership | `references/bootstrap-scenes-lifecycle.md` |
| Loader, caches, textures, atlases, animations, asset lifetime | `references/assets-textures-animations.md` |
| Images/Sprites, Groups/Containers/Layers, text, input, DOM UI, accessibility | `references/gameobjects-input-ui.md` |
| Cameras, responsive scale, audio, time, timers, tweens, pause semantics | `references/cameras-scale-audio-time.md` |
| Arcade and Matter selection, stepping, collisions, bodies, teardown | `references/physics.md` |
| Tiled maps, CPU/GPU layers, particles, pooling, large-world strategy | `references/tilemaps-particles.md` |
| WebGL/Canvas, RenderNodes, filters, shaders, render textures, GPU layers, profiling | `references/rendering-performance.md` |
| Phaser 4.2 CustomContext, Mesh2D, stencils, alpha/tint, cone lights, FPS limit | `references/v4-2-rendering.md` |
| DataManager, events, plugins, video, Actions, geometry, curves, math, utilities | `references/gameplay-services-media.md` |
| Production architecture, persistence, testing, security, delivery, observability | `references/production-playbook.md` |
| Phaser 3 to 4 removals, replacements, sequencing, plugin migration | `references/migration-v3-v4.md` |

Use the matching vendored official topic for breadth, then verify every copied signature against the installed source/type scope. Do not copy a v3 example into v4 merely because the upper-level API looks familiar. If a newer checked-out Phaser source contains updated `skills/`, resync deliberately with `scripts/sync-official-skills.mjs` and review the manifest/correction delta before using it.

## Follow the Engineering Workflow

### 1. Frame the Runtime

Identify before coding:

- Logical viewport and scale mode: fixed/FIT, EXPAND, RESIZE, or custom host layout.
- Renderer requirement: prefer `Phaser.WEBGL` for v4 filters, lighting, GPU layers, RenderNodes, CustomContext, Mesh2D, and stencil objects. Use `AUTO` only if the Canvas fallback is intentionally supported and feature-gated.
- Target browsers, wrappers, orientation, DPR/fill-rate budget, and low-end mobile class.
- Typical and worst-case Game Object, body, particle, tile, light, filter, text, and texture counts.
- Required loading milestones, offline/CDN policy, save model, scene transitions, pause/background rules, audio unlock, input devices, accessibility, and teardown.

Convert vague performance goals into budgets: target device/FPS, CPU and GPU frame time, initial download, decoded texture memory, scene-start latency, draw calls, active physics bodies, and repeat-transition memory stability.

### 2. Define Ownership Boundaries

Keep these responsibilities distinct:

- **Bootstrap** owns `Phaser.Game`, GameConfig, host DOM, visibility integration, and final `game.destroy(removeCanvas, noReturn)`.
- **Scene orchestration** owns keys, transitions, ordering, payload contracts, loading/error routes, and restart policy.
- **Scene/feature** owns its Game Objects, scene-local listeners, timers, tweens, colliders, cameras, and shutdown cleanup.
- **Asset catalog** owns stable keys, URLs, loader policy, global cache leases, replacement, and explicit removal. Phaser caches are global even when a Scene loaded the asset.
- **Simulation/domain** owns authoritative state, rules, save/load, replay, and networking. Game Objects present state; Scene callbacks coordinate rather than become the data model.
- **Input** maps pointer/keyboard/gamepad events to domain actions and owns modal priority, drag cancellation, and rebinding.
- **Audio** owns buses, unlock state, cross-Scene music, interruption, and final Sound cleanup. The SoundManager is global.

Prefer services passed to Scenes or a typed composition root over arbitrary registry keys and cross-Scene object access. Keep serializable state free of Phaser objects.

### 3. Select the Right Primitive

- Use `Image` for static textured objects and `Sprite` only when AnimationState is needed.
- Use `Group` for membership, pooling, and bulk operations; it is not a transform node.
- Use `Container` for local transforms only when hierarchy is necessary. Avoid deep nesting and physics children with offset Containers.
- Use `Layer` for render grouping/order without local transform hierarchy.
- Use `Text` for rich or infrequently changing text and `BitmapText` for frequent counters or large repeated text.
- Use persistent `ParticleEmitter` for simulated particles. Use `SpriteGPULayer` for huge, mostly static GPU-buffered quad populations that fit its restrictions.
- Use `Mesh2D` for WebGL textured triangle meshes in v4.2+, not the removed Phaser 3 `Mesh`; choose ordered indices for stable topology or triangle rendering for dynamic topology.
- Use `Stencil`/`StencilReference` for persistent sharp-edged WebGL stencil layers and the Mask filter for higher-quality object-local alpha masking.
- Use `CustomContext` only for a source-verified DrawingContext state change. In v4.2.1 prefer `this.make.customContext(config, true)` because the `this.add` factory declaration and runtime registration differ in case.
- Use CPU `TilemapLayer` for multiple tilesets, non-orthogonal maps, or frequent edits. Use WebGL-only `TilemapGPULayer` for large orthogonal, single-tileset layers and regenerate layer data after edits.
- Use Arcade Physics for axis-aligned arcade motion; use Matter for rotated/compound bodies, constraints, sensors, and richer collision response. Do not attach one object to both systems.
- Use internal filters for object-local effects and external filters for contextual/screen-space effects. Budget every pass and framebuffer.

### 4. Implement Scene Lifecycle Symmetrically

Reset restartable state in `init`, load in `preload`, construct in `create`, and keep `update(time, delta)` allocation-light. Constructor setup runs once; `init` runs on each start.

```ts
import Phaser from 'phaser';

export class GameScene extends Phaser.Scene {
  private onBlur = () => this.pauseDomain();

  constructor() {
    super('game');
  }

  init(data: { level?: number }) {
    this.resetDomain(data.level ?? 1);
  }

  preload() {
    this.load.image('player', 'assets/player.png');
  }

  create() {
    this.game.events.on(Phaser.Core.Events.BLUR, this.onBlur);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
  }

  update(_time: number, delta: number) {
    this.stepDomain(Math.min(delta, 100) / 1000);
  }

  private shutdown() {
    this.game.events.off(Phaser.Core.Events.BLUR, this.onBlur);
  }
}
```

On shutdown:

1. Stop external/global listeners and DOM integrations with the same callback identity.
2. Stop or detach owned looping sounds, external schedulers, sockets, observers, and workers.
3. Release feature references and abort/ignore late asynchronous work.
4. Let Scene systems destroy their owned display/physics/timer resources, but explicitly remove shared assets only after every consumer releases them.
5. Use `DESTROY` for final Scene removal, not normal restart cleanup.

Scene operations are queued. Do not assume `start`, `launch`, `stop`, or `restart` completes synchronously in the same call stack.

### 5. Keep Time, Physics, and Input Correct

- Phaser `update(time, delta)` and timer/tween durations use milliseconds. Convert once at the domain boundary.
- Clamp presentation deltas after tab suspension. Use an accumulator/fixed step for deterministic domain simulation where required; do not double-step Phaser physics.
- Let Arcade or Matter own body motion. Avoid simultaneously tweening the transform that physics is authoritatively updating.
- Refresh Arcade static bodies after transform/size changes. Reapply Matter properties after replacing a body shape.
- Use persistent colliders for continuous checks; distinguish collision/separation from overlap/trigger behavior.
- Convert pointer coordinates through the intended Camera (`pointer.positionToCamera(camera, out)` or the version-checked Camera API). Raw pointer coordinates are screen space.
- Provide explicit hit areas, input priority, drag end/cancel behavior, keyboard/gamepad parity, and DOM semantics for accessible controls.

### 6. Verify in Proportion to Risk

Run the project's lint, type-check, unit tests, production build, and the bundled audit. For rendering or interaction changes, test the actual canvas in a browser.

When changing this skill or upgrading Phaser, also run:

```bash
node <skill-dir>/scripts/validate-evals.mjs
node <skill-dir>/scripts/validate-integrated-skill.mjs --phaser-root <phaser-root>
node --test <skill-dir>/scripts/*.test.mjs
```

Verify at minimum:

- Boot, loading progress, load failure, retry, empty state, and first meaningful frame.
- Scene start/stop/sleep/wake/restart loops without duplicate listeners, sounds, colliders, timers, or retained references.
- Desktop/mobile sizing, orientation, fullscreen, pointer mapping, keyboard, gamepad, and high-DPR behavior.
- WebGL context loss/restore where the product depends on render textures or custom GPU resources.
- Audio locked/unlocked, background interruption, mute, and cross-Scene ownership.
- Physics at low/high frame rates, pause/resume, world bounds, sensors, and deterministic rules where promised.
- No console errors, missing cache keys, shader failures, blank canvas, or inaccessible critical controls.
- Representative low-end performance with warm and cold paths recorded separately.

Do not claim an optimization from intuition. Record Phaser version, renderer, browser/device/GPU, viewport/DPR, scene counts, median/bad frame time, draw calls/batches, texture memory estimate, and before/after scenario.

## Apply Task Playbooks

### Build or Add a Feature

Read lifecycle, the relevant subsystem reference, and the production playbook. Reuse project conventions. Implement a complete vertical slice: assets, loading/error behavior, domain state, rendering, input, pause/resume, responsive layout, cleanup, tests, and browser verification.

### Debug

Reproduce first. Classify the failure as boot/config, Scene state, loader/cache key, display-list/depth, transform/camera coordinates, input ordering, physics ownership, animation/tween/time, audio lock, renderer/filter/shader, or cleanup/re-entry. Inspect the smallest authoritative source and test before editing.

### Optimize

Classify the bottleneck as scripting/update, physics broadphase, display traversal/transforms, draw calls/state changes, fill rate/filter passes, texture upload/memory, text rasterization, allocation/GC, or load/decode. Apply the narrowest remedy and remeasure. GPU layers are specialized data models, not drop-in replacements.

### Review

Lead with correctness, API/version mismatches, Scene re-entry leaks, global cache/listener ownership, physics/render desynchronization, renderer fallback gaps, and missing browser tests. Treat the audit as heuristic evidence and inspect every reported ownership path.

### Migrate from v3

Read `references/migration-v3-v4.md`. Migrate infrastructure before content: package/build and plugins, renderer/Pipelines to RenderNodes, FX/masks to filters, camera/shader/texture orientation, render textures, tints/lighting, removed objects/utilities, then performance and lifecycle validation.

### Extend Phaser

Use Scene/Global Plugins and Custom Game Objects for reusable public extensions. Use RenderNodes only for renderer-level reusable work. Prefer normal composition for product-local behavior, and avoid private fields or internal node roles unless the project pins a Phaser minor and owns migration tests.

## Quality Bar

- Preserve repository conventions and unrelated user changes.
- Keep resource keys centralized and typed where practical; validate every key during build or boot.
- Keep authoritative state independent from Game Objects and Scene restarts.
- Make Scene entry, shutdown, and async completion idempotent.
- Use named event constants and reusable callback identities at ownership boundaries.
- Never depend on Canvas fallback while unconditionally using WebGL-only features.
- Never copy a signature from an unversioned concept page without checking the installed owner; the official concepts site can retain Phaser 3 APIs under v4 navigation.
- Avoid private/internal APIs unless source-pinned, documented, and covered by integration tests.
- Treat accessibility, reduced motion, audio consent, loading failure, save compatibility, analytics privacy, and low-end mobile budgets as product requirements.
- Cite the installed Phaser version and source/API location when an exact behavior drives a decision.
- Answer in the user's language while keeping identifiers unchanged.
