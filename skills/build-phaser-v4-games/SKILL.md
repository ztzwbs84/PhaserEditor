---
name: build-phaser-v4-games
description: "Build complete commercial-quality 2D browser games with Phaser 4 from a short idea or an existing project, including one-command scaffolding, gameplay, visuals, input, audio, UI, responsive delivery, tests, browser QA, optimization, and shipping. Use whenever a request targets Phaser 4, asks to create a playable 2D web game where Phaser is selected or appropriate, or needs Phaser architecture, debugging, review, extension, or v3-to-v4 migration. Covers GameConfig, Scenes, assets, Game Objects, cameras, physics, tilemaps, particles, filters, RenderNodes, TypeScript, performance, memory, mobile, and production correctness with version-checked APIs."
---

# Build Phaser 4 Games

Engineer Phaser 4 games from the installed package outward. Prefer version-scoped source evidence, explicit ownership, deterministic domain logic, and measured production behavior over isolated snippets.

## Create a Playable Game in One Command

For a new game, pass the user's idea directly to the generator before feature work:

```bash
node <skill-dir>/scripts/create-phaser-game.mjs --idea "<user game description>" --install --verify
```

`--idea` performs deterministic English/Chinese selection from `assets/presets.json`, derives a stable local output directory, valid ASCII package name, and human-facing title, and records both selection and identity sources in the report and `game-preset.json`. Pass `[output-directory]`, `--name`, or `--title` only when the user requests an override; explicit values always win. Idea routing fails closed on zero matches or a top-score tie; inspect `--list-presets --json` and pass `--preset <preset-id>` only to resolve that ambiguity or deliberately override selection. An explicit preset always wins when both options are supplied. Use `collector` for collect, survive, dodge, score-attack, or arena requests; `courier` for deliver, route, carry, destination-matching, or time-trial requests; `platformer` for jump, platform, climb, run, or precision-movement requests; `shooter` for starfighter, space-combat, blaster, bullet-hell, or shoot-em-up requests; `breakout` for brick-breaker, paddle, bouncing-ball, or Arkanoid requests; `racing` for circuits, checkpoints, laps, driving, drifting, or time-trial requests; `chess-puzzle` for chess tactics, checkmate, mate-in-one, or legal-move board puzzles; and `tower-defense` for turrets, fortification, base defense, or wave-defense requests. The chess preset pins `chess.js` as its headless rules authority; keep legal moves, FEN loading, and terminal mate decisions out of Phaser Scenes. If no preset matches the requested verb, choose only the nearest architecture explicitly, then replace its gameplay rules and quality targets rather than forcing the request into the sample loop.

The atomic generator refuses non-empty targets, installs from the lockfile with `npm ci`, and creates a Phaser 4.2.1 TypeScript game with code-native visual assets, desktop/touch input, semantic DOM controls, pause/restart/mute, procedural audio, a versioned local player profile, loading failure/retry, lifecycle cleanup, domain tests, and a production build. Publication uses bounded retries for transient Windows directory locks and confirms the expected package identity when a rename reports an error after completing. Use `--dry-run --json` to preflight automation. Successful `--json --verify` output is one parseable report; detailed evidence is written under the generated project's ignored `.quality/` directory.

Before verifying an existing generated project, audit its managed quality scripts and apply a safe update when required:

```bash
node <skill-dir>/scripts/update-phaser-quality-tools.mjs <project-directory> --check
node <skill-dir>/scripts/update-phaser-quality-tools.mjs <project-directory> --apply
```

The updater owns the scripts listed in `phaser-quality-tools.json`. It validates SHA-256 hashes, recognizes a strictly descending catalog of trusted versions, transactionally installs new scripts and retires obsolete trusted scripts, and refuses to overwrite project-modified or unrecognized quality scripts. It may also add newly required persistence migration or proof declarations to `game-quality.json` only when the existing schema, source, and fixture exactly match a trusted contract; it preserves every existing valid custom contract and all unrelated project settings, and rolls this additive migration back with the scripts if publication fails. Never copy newer gates over local changes by hand; resolve a reported conflict deliberately, then establish a valid managed manifest before accepting release evidence.

Verification is intentionally fail-closed. It runs strict TypeScript, domain and gate tests, a fresh project-local production build, real gzip bundle budgets, desktop/mobile headless Chromium E2E, the strict Phaser audit, and the API anchor check. SHA-256 fingerprints bind both release inputs and `dist` across the bundle, browser, audit, and API reports plus the generator's final read from the current disk; all five must match, and source, configuration, asset, lockfile, quality-script, or shipped-file drift invalidates prior green evidence. Browser E2E proves composited Canvas pixel variance, every declared primary pointer mode through desktop mouse and mobile touch events, every declared primary keyboard mode on desktop, game-side acceptance of every primary mode, at least one real desktop keyboard action, mobile primary progress, pause/resume ARIA state plus at least one second of frozen domain/auxiliary/player state while every declared primary input is dispatched, a post-resume window proving the acceptance counters do not consume paused input while autonomous movement, gravity, inertia, and timers may resume, reachable success and failure through normal gameplay, terminal input lock by dispatching every declared primary mouse/key mode after both outcomes and comparing complete before/after snapshots and acceptance counters, restart after both outcomes, synchronized auxiliary machine/visible values at desktop and mobile initial play, terminal outcomes, restarts, and mobile progress, the declared historic profile migration, declared profile-field relationships after gameplay and a real reload, 390x844 touch targets and overflow, HTTP responses, runtime exceptions, and console cleanliness. It cross-checks persistence source/target schemas and proof assertions plus the action, progress, pressure, target, input acceptance, pause freeze and resume isolation, auxiliary timeline, terminal input evidence, and terminal reasons against `game-quality.json`, then refreshes portable audit and API JSON in the same run. A failed bundle, browser, audit, or API gate removes its stale evidence instead of leaving an older green report. Chrome or Edge must be installed; set `PHASER_BROWSER_PATH` to a Chromium executable when auto-discovery cannot find it. Do not silently skip a missing gate.

Do not use a preset to replace an existing project; inspect and extend its architecture instead. Treat every preset as a trusted starting point, not a finished product. Adapt the theme, visual assets, rules, balance, progression, feedback, controls, content, and E2E targets. Merely changing the title or palette is not a custom game. Remove every sample concept and asset that does not belong.

Keep the cross-preset quality contract intact: publish the primary action, a versioned `qualityInputPlan`, `qualityAcceptedInputs`, progress name/value, completion target, auxiliary metric name/value, pressure name/value, maximum pressure, primary targets, pressure targets, world size, restart position, terminal kind (`success` or `failure`), and machine-readable terminal reason through the existing `quality*` DOM dataset. Bind `qualityAuxiliaryName` and `qualityAuxiliaryValue` to the visible `#auxiliary-value`; use time, wave, depth, layer, energy, or another real game metric without pretending every game has a countdown. Synchronize it on every domain snapshot, including terminals and restarts; the release report requires desktop/mobile initial, failure/success terminal, both restart, and mobile-progress checkpoints. Keep localized or branded status prose separate from those machine fields. Declare every input required for normal primary progress before running verification; compose pointer click/hold/drag, directional navigation, and key pulse/hold actions with bounded timing in the schema from `scripts/quality-input-plan.mjs` instead of adding gameplay-specific booleans or preset branches. Publish `qualityAcceptedInputs` as a JSON object with exactly one non-negative integer counter for each summarized primary mode, such as `{"pointer:click":2,"key:pulse":1}`. Increment a counter only while `playing` and only where gameplay actually accepts that intent; do not increment merely because a DOM/Phaser event arrived, expose raw keys or coordinates, or add undeclared counters. Reset the counters with the run. The release summary must prove every primary counter grows during normal play, stays frozen throughout pause, does not grow in the resume observation window, and stays frozen after both terminal outcomes. Extend the schema, parser tests, interpreter, counter contract, and summary validator together when a new input primitive is truly required.

Keep `src/platform/player-profile.ts` as the generic local-profile boundary. Store settings and cross-run statistics as validated primitives under the package-scoped key; keep Phaser objects and in-progress physics state out. Add explicit migrations for every accepted historic schema. Declare a bounded `migrationFixture` whose schema matches `migrationFromVersion`; never let the browser gate guess an old schema's shape. Declare `persistence.proofs.migration`, `.gameplay`, and `.reload` with safe dot-separated profile paths. Use only `equalsFixture`, `equals`, `preserved`, `incrementedBy`, and `derivedFrom`; bind gameplay-derived values to `successProgress`, `failureProgress`, or `terminalProgressTotal`. Do not put expressions in the JSON, duplicate `browser-e2e.mjs`, or add a project-local verifier. See `references/production-playbook.md` before adding campaign, economy, inventory, or other schema fields. Preserve an unsupported future schema without writing through it, quarantine bounded corrupt input, and recover only a validated previous slot. Extend the schema, migrations, unit tests, machine fields, proof declarations, and browser reload evidence together. Never claim durable progression from a successful unit test alone.

Update `game-quality.json`, the `qualityInputPlan`, quality targets, terminal reasons, and domain field names before accepting any verification result. Extend `scripts/browser-e2e.mjs` only through generic protocol behavior so one fresh run reaches the changed completion target and proves success is terminal, another fresh run exhausts the changed pressure through gameplay and proves failure is terminal, and both outcomes restart, complete the changed primary action again, then reset cleanly. Inspect `.quality/browser-e2e.json` and reject it when the gameplay names, declared input modes, terminal reasons, or screenshots still describe the starter. Do not use preset IDs or localized prose to branch the generic gate. A green preset-loop report produced before gameplay adaptation is baseline evidence only; it never proves the changed game.

Treat a short prompt as permission to choose reversible defaults and deliver the first playable version. Infer a focused core loop, one player verb, one escalating pressure, one win/score condition, and one loss/end condition. State the defaults in the handoff instead of blocking on non-critical questions. Ask only when a missing choice would materially change external systems, paid assets, platform constraints, or destructive scope.

Preserve the tested ownership and verification structure unless the target repository already has a stronger convention.

Do not declare a new game complete until all are true:

- A player reaches the core loop within 10 seconds and can understand the immediate goal from the game state.
- Input changes gameplay; feedback makes success, damage, pause, and end states unambiguous.
- The game has a complete loop: start, play, progression or escalation, a normally reachable success condition, a normally reachable failure condition, and restart after either outcome.
- Desktop and mobile viewports have coherent layout and usable input without text or controls overlapping.
- Loading failure, pause/backgrounding, audio policy, reduced motion, and final teardown have deliberate behavior.
- Domain and quality-gate tests pass.
- Strict type-check and production build pass.
- Real compressed bundle sizes remain inside the declared `game-quality.json` budgets.
- Bundled strict audit and API anchor check pass.
- Browser E2E proves a visually nonblank composited canvas, covers every declared primary pointer mode with desktop mouse and mobile touch events, covers every declared primary key mode on desktop, proves every primary mode is accepted by gameplay, and requires mobile primary progress.
- Browser E2E proves the declared profile schema migrates and that settings plus cross-run outcome statistics survive a real reload.
- `.quality/` contains JSON reports and desktop/mobile screenshots that support the claim.

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

Do not call `this.physics.world`, Loader, Camera, or other Scene systems from late shutdown work after Phaser has released that plugin. Keep teardown callbacks synchronous where practical, guard optional systems, and prove restart from a real browser with console-error collection; type-checking cannot detect destruction-order faults.

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

Run the project's lint, type-check, unit tests, production build, declared bundle budgets, and the bundled audit. For rendering or interaction changes, test the actual canvas in a browser. New generated games already expose this full gate through `npm run check`; extend its browser scenario when adapting the sample loop.

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
