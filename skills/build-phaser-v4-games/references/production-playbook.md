# Production Architecture and Delivery

## Contents

- [Recommended architecture](#recommended-architecture)
- [Scene and feature contracts](#scene-and-feature-contracts)
- [State, save, replay, and networking](#state-save-replay-and-networking)
- [Loading and failure design](#loading-and-failure-design)
- [Testing strategy](#testing-strategy)
- [Security and platform integration](#security-and-platform-integration)
- [Observability and performance budgets](#observability-and-performance-budgets)
- [Review and release gates](#review-and-release-gates)

## Recommended Architecture

Fit the repository first. When no structure exists, separate orchestration, domain, presentation, and infrastructure:

```text
src/
  app/          Phaser.Game bootstrap, host bridge, lifecycle
  assets/       typed keys, generated packs, lease/removal policy
  scenes/       thin Scene orchestration and transitions
  features/     feature controllers/views and Scene-owned adapters
  domain/       serializable rules, state machines, save/replay commands
  physics/      body factories, collision matrix, domain event adapter
  input/        action mapping, rebinding, modal routing
  audio/        buses, unlock, music transitions, interruption
  ui/           Phaser HUD plus semantic DOM controls
  platform/     SDK, storage, analytics, ads, network, workers
  test/         deterministic fixtures, visual scenes, stress cases
```

Avoid a universal BaseScene that accumulates every service and lifecycle hook. Use small shared helpers or a composition root, and make Scene dependencies visible.

Keep domain objects free of `Phaser.GameObjects.*`, Bodies, Cameras, Loaders, and event emitters. This enables unit tests, save migrations, server validation, worker simulation, replays, and renderer replacement.

## Scene and Feature Contracts

Treat each Scene start as a new run even when the Scene instance is reused:

- Validate incoming payload in `init` and establish defaults.
- Load only required catalog bundles in `preload`.
- Build feature owners in `create`.
- Drive a small ordered pipeline in `update`: sample actions, advance domain/physics policy, consume events, synchronize views, update diagnostics.
- Clean external/global ownership on SHUTDOWN.

A feature owner can expose:

```ts
interface SceneFeature {
  update?(deltaSeconds: number): void;
  setPaused?(paused: boolean): void;
  destroy(): void;
}
```

The Scene holds and destroys features in reverse construction order. Phaser Scene systems still own normal Game Objects/plugins; feature `destroy` handles external listeners, persistent audio, SDK/network handles, and references.

Cross-Scene communication options, in increasing coupling:

1. Pass immutable payload data through Scene operation.
2. Use a typed app/domain service.
3. Use a typed event bus with explicit subscription disposal.
4. Use registry for simple global observable values.
5. Directly call another Scene only for tightly coordinated presentation and document the dependency.

Do not leave listeners attached to another Scene while the subscriber sleeps/restarts unless delivery during inactivity is intentional.

## State, Save, Replay, and Networking

Define a versioned serializable save schema:

```ts
interface SaveV3 {
  schemaVersion: 3;
  profile: ProfileState;
  campaign: CampaignState;
  settings: SettingsState;
}
```

- Store stable IDs and primitive data, not Phaser objects or cache references.
- Validate and migrate saves before constructing Scenes.
- Write atomically where the platform permits; preserve a previous valid slot/checksum.
- Treat local storage as user-controlled input.
- Separate cosmetic settings from authoritative progression and server-owned entitlements.

For replay/rollback/networking, record domain commands and deterministic state snapshots. Phaser tweens, animations, random globals, browser time, and physics engines are not automatically deterministic across machines. Seed and encapsulate randomness; use server/epoch time for authoritative deadlines.

Do not let network callbacks mutate Game Objects directly. Convert responses/messages to domain events and process them at an owned update boundary. Abort or generation-check late callbacks after Scene shutdown.

## Loading and Failure Design

Define milestones:

1. Host HTML/CSS and compatibility state.
2. Phaser renderer and minimal boot Scene.
3. Loading/error UI assets.
4. First interactive menu or game Scene.
5. Background/next content.

Every async integration needs timeout, cancellation/stale-result policy, error classification, user-visible retry/fallback, and telemetry without secrets.

Do not swallow loader errors or silently replace missing paid content. Log stable asset key/type/build version/resolved host and cause. Avoid full raw URLs when they can contain credentials/query secrets.

Test service-worker/CDN version skew. Code, pack manifests, maps, atlases, and audio must come from a compatible release set. Prefer content-hashed files and an atomic release manifest.

## Testing Strategy

### Unit

- Domain state machines, combat/economy/scoring, seeded random behavior.
- Save validation/migration and command serialization.
- Camera/layout/coordinate helpers.
- Collision category matrix and asset catalog generation.
- Input action mapping and pause policy.

### Integration

- Game boot/destroy and Scene start/stop/sleep/wake/restart.
- Cold and cached Loader paths, failure/retry, duplicate keys, lease/removal.
- Physics factories/collisions and adapter events.
- Global listener/audio ownership across transitions.
- Plugin initialization and renderer capability gates.

### Browser and visual

- Assert canvas contains non-background pixels or known landmarks, not merely that DOM chrome loaded.
- Fixed deterministic screenshot Scenes at desktop/mobile, low/high DPR, FIT/RESIZE, and representative Cameras.
- Pointer/touch/keyboard/gamepad, drag cancellation, focus, fullscreen, orientation, and semantic DOM controls.
- WebGL context loss/restore and AudioContext unlock/interruption.

### Performance and soak

- Representative stress Scenes for objects, bodies, particles, Tilemaps, Text, filters, lights, and transitions.
- Separate cold compile/upload from warm steady state.
- Repeated Scene transitions and app remounts with listener/cache/body/GPU memory observations.
- Long hidden-tab resume, network reconnect, and low-memory behavior.

Use controlled hardware for hard CI budgets. Else store trend baselines and fail on material regression with human review.

## Security and Platform Integration

- Treat maps, save files, remote configs, chat/user text, SVG/HTML, and SDK payloads as untrusted.
- Sanitize DOMElement/HTML content and never interpolate arbitrary HTML.
- Set CSP, CORS, COOP/COEP, iframe permissions, fullscreen, audio, and storage policies intentionally.
- Bound asset dimensions, decompressed size, map dimensions, object counts, text length, and particle configs.
- Keep secrets and authoritative economy logic off the client.
- Validate postMessage origin/source and SDK callback payloads.
- Minimize analytics data; never capture raw input, user text, or identifiers without product/legal policy.
- Confirm third-party plugin/assets licenses and maintenance status.

## Observability and Performance Budgets

Record release/build, Phaser version, renderer, browser/device class, viewport/DPR, Scene key/state, load milestone, and error category. Do not log sensitive payloads.

Useful product metrics:

- Boot to loader, loader to first frame, first frame to interactive.
- Asset retry/failure by stable key/type/host.
- Median and bad frame time by Scene/device tier.
- WebGL context loss, audio unlock failure, unhandled promise/error.
- Save migration/failure and reconnect outcomes.
- Scene transition duration and repeated-transition resource trend in test builds.

Set budgets for initial compressed bytes, decoded texture memory, frame CPU/GPU, active Bodies, draw calls, full-screen filter passes, and Scene-ready latency.

## Review and Release Gates

### Correctness

- Installed v4 API signatures verified in owner scope.
- All cache keys exist and all Scene payloads are validated.
- Renderer/physics/plugin capability gates match production configuration.
- Pause/resume, load failure, audio unlock, resize, and context restoration are defined.

### Ownership

- Every global/external listener has matching cleanup identity.
- Every persistent Sound, socket, observer, worker, Collider, constraint, and GPU extension has an owner.
- No Scene removes a shared cache entry still in use.
- Repeated restart/transition/remount leaves stable owned-resource counts.

### Performance

- Claims have representative before/after evidence.
- No accidental per-frame Text/Graphics/object/filter allocation.
- Container depth, physics broadphase, filter targets, lights, DPR, and overdraw fit budgets.
- Low-end mobile/device testing is complete.

### Product

- Loading/error/retry/unsupported-browser states are usable.
- Keyboard and semantic accessibility paths complete critical workflows.
- Save compatibility, asset licenses, offline/CDN rollout, analytics privacy, and rollback plan are approved.
- Production build, source maps/error reporting policy, cache headers, and deployment base path are verified.

