# Data, Events, Plugins, Media, and Utility Systems

## Contents

- [Data managers](#data-managers)
- [Events](#events)
- [Plugins and extensions](#plugins-and-extensions)
- [Video and browser media](#video-and-browser-media)
- [Actions, geometry, curves, and paths](#actions-geometry-curves-and-paths)
- [Math and randomness](#math-and-randomness)
- [Utility and security rules](#utility-and-security-rules)

## Data Managers

Choose the narrowest owner:

- Game Object DataManager: optional per-object presentation data; enable through public data methods.
- Scene DataManagerPlugin: Scene-local run data that follows Scene lifecycle.
- Game registry: global observable data shared across Scenes.
- Custom DataManager: explicit parent/emitter ownership for a reusable service.

Do not use DataManager or registry as the authoritative save/domain model. Values may hold arbitrary objects, events can create hidden coupling, and Game Object references become stale after restart.

Rules:

- Centralize keys and event names.
- Decide whether writes are silent, frozen, or event-producing.
- Subscribe with stored callback/context and remove global/cross-owner subscriptions on SHUTDOWN.
- Do not mutate the DataManager from its own change listener without an explicit recursion/coalescing policy.
- Serialize validated plain data into a versioned save schema; never serialize the manager or Phaser objects.

## Events

Phaser EventEmitter behavior is synchronous. A listener can run and mutate state before `emit` returns.

- Prefer named Phaser event constants for lifecycle and subsystem events.
- Use `once` for one-shot completion/lifecycle signals, but still handle cancellation and shutdown.
- Store callback identity and context for `off`.
- Avoid anonymous listeners on `game.events`, registry, another Scene, DOM, sockets, or SDKs.
- Keep event payload contracts typed and small; use stable IDs instead of Game Object references across ownership boundaries.
- Prevent reentrant state transitions by queueing domain commands when an emitter callback could trigger the same operation recursively.
- Treat listener-count growth across Scene restart as a leak signal.

## Plugins and Extensions

Use the least invasive extension point:

| Need | Prefer |
| --- | --- |
| Product-local feature | Normal composed service/controller |
| Reusable Scene capability | Scene Plugin |
| Cross-game/global capability | Global Plugin with explicit start/destroy |
| Reusable display type | Custom Game Object plus factory/creator registration |
| Renderer behavior | Version-pinned RenderNode only when higher APIs cannot express it |

For plugins:

- Verify mapping/key configuration, start timing, and whether instances are global or per Scene.
- Make boot/start/shutdown/destroy symmetric and idempotent.
- Remove Scene/global/DOM listeners and destroy owned resources before calling the base destroy path.
- Do not depend on package `src/*` subpaths as public npm exports.
- Audit third-party plugins for Phaser 4 compatibility, removed Pipelines/FX/masks/Mesh APIs, renderer assumptions, and declaration quality.
- Pin source-coupled plugins to a Phaser minor and run boot, restart, destroy, Canvas/WebGL gate, and production-bundle tests.

## Video and Browser Media

Video Game Objects wrap browser media and add Phaser texture/render integration. They remain subject to autoplay, CORS, codec, streaming, memory, and mobile platform rules.

- Load through the Video cache when a milestone owns the asset; use direct URL/MediaStream only with explicit lifetime and error policy.
- Require a user gesture for playback with audio; expose blocked/error/retry states.
- Supply/test codec variants on the supported browser matrix.
- Stop playback, detach MediaStream tracks when owned, remove listeners, and release source references at the owner boundary.
- Bound decoded dimensions, simultaneous decoders, seek/preload behavior, and mobile memory.
- Snapshot/saveTexture/readback requires origin-clean media and can synchronize GPU/decoder work; never capture full video frames in an unmeasured hot loop.
- A saved video texture has separate cache/lifetime implications; do not destroy or replace it while consumers remain.
- Captions, transcripts, mute state, reduced motion, and non-video fallback are product requirements for critical content.

## Actions, Geometry, Curves, and Paths

Actions perform bulk operations on arrays/groups of objects. They do not establish ownership or make an operation free. Avoid applying broad Actions every frame when direct indexed updates or a GPU data model is cheaper.

Use geometry objects for pure calculations and hit areas, Graphics/Shape Game Objects for rendering, and physics bodies for collision authority. These layers are related but not interchangeable.

Phaser 4 removed `Phaser.Geom.Point`; use `Phaser.Math.Vector2`. The unversioned concepts Geometry page can still show the removed Point API, so verify every helper against installed declarations.

For curves and paths:

- Keep authored path data separate from PathFollower/Game Objects.
- Precompute or cache expensive length/division data when the path is stable.
- Define parameterization and speed policy; equal `t` increments do not imply equal world distance on arbitrary curves.
- Destroy paths only when no follower/editor/tool retains them.
- Validate imported path point counts, coordinates, and complexity.

## Math and Randomness

- Phaser angles are generally radians unless an API explicitly says degrees.
- Use `Phaser.Math.TAU` for `2 * PI` in v4; `PI2` was removed and old TAU assumptions need migration review.
- Reuse vectors/matrices in hot paths rather than allocating return objects every update.
- Use squared distance when only comparing thresholds.
- Clamp interpolation inputs only when the gameplay contract requires it; some easing/curve APIs intentionally extrapolate.
- Encapsulate and seed `RandomDataGenerator` for reproducible content, replays, and tests.
- Never mix seeded domain randomness with global/random presentation effects if exact replay matters.
- Persist seed and generator/domain progression, not Phaser Game Objects.

Neither Phaser physics, tweens, browser time, nor floating-point behavior across environments becomes deterministic merely because random values are seeded.

## Utility and Security Rules

Prefer standard JavaScript `Map`, `Set`, arrays, structured cloning, and explicit schema validation when they meet the need. Phaser 4 removed legacy Struct Set/Map utilities.

Treat `Phaser.Utils.Objects.GetValue`-style convenience as trusted-config access, not validation. Before using remote/save/SDK data:

- Validate type, range, enum, count, dimensions, and nested depth.
- Reject prototype-pollution keys and avoid merging untrusted objects into engine/config prototypes.
- Bound array operations, geometry/path complexity, strings, Base64 payloads, and decoded media.
- Keep URLs, HTML, SVG, and postMessage payloads under explicit allowlists/sanitization.

Measure bulk cloning, sorting, shuffling, Actions, geometry generation, and path sampling on content-sized inputs rather than assuming utility helpers are negligible.

