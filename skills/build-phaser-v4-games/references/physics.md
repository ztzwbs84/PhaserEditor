# Arcade and Matter Physics

## Contents

- [Choose one authority](#choose-one-authority)
- [Arcade Physics](#arcade-physics)
- [Matter Physics](#matter-physics)
- [Simulation boundaries](#simulation-boundaries)
- [Collision design](#collision-design)
- [Performance](#performance)
- [Testing and teardown](#testing-and-teardown)

## Choose One Authority

| Requirement | Arcade | Matter |
| --- | --- | --- |
| Axis-aligned rectangles/circles | Best fit | Supported |
| Platformer/top-down arcade motion | Best fit | Possible, more tuning |
| Rotated/compound/concave bodies | No | Yes, with shape constraints/decomposition |
| Constraints/joints/springs | No | Yes |
| Sensors/complex collision filters | Basic overlap/categories | Rich filters/sensors |
| Large simple body count | Usually lower overhead | Profile carefully |
| Deterministic rollback simulation | Neither should be assumed deterministic across environments | Neither should be assumed deterministic across environments |

Arcade and Matter can run in one Scene, but their bodies do not collide with each other. Never attach the same Game Object to both systems. Define which system owns each world/feature.

## Arcade Physics

Enable it in GameConfig or Scene config and create through `this.physics.add`.

```ts
const player = this.physics.add.sprite(100, 100, 'player');
player.setCollideWorldBounds(true);
const collider = this.physics.add.collider(player, platforms, this.onLand, undefined, this);
```

Key distinctions:

- Dynamic Body: velocity, acceleration, gravity, drag, bounce, separation.
- Static Body: optimized immovable body; transform/size changes require `refreshBody()` or body reset.
- `collider`: persistent per-step separation/callback object.
- `overlap`: persistent trigger without separation when added through Factory; one-shot `physics.overlap`/`collide` calls must be invoked each desired step.
- `immovable` and `pushable` are different collision-response controls.
- World collision/overlap events require the corresponding opt-in body flags.
- Collision categories are bit-based and limited to 32 category bits.

Avoid physics bodies on transformed/offset Container children. Arcade bodies are world-aligned and do not model arbitrary parent transforms or visual flip.

When `customUpdate` is enabled, Phaser does not auto-step the Arcade world. Call the installed-version update API exactly once per intended step; never combine manual and automatic stepping.

## Matter Physics

Create through `this.matter.add` or enable an existing Game Object deliberately.

```ts
const crate = this.matter.add.image(200, 100, 'crate', undefined, {
  shape: { type: 'rectangle' },
  friction: 0.2,
  restitution: 0.1,
});
```

Key distinctions:

- Matter body position is center-of-mass based.
- Forces are small normalized physics values, not pixels. Tune with representative step settings.
- Replacing body shape via set-body helpers resets mass, friction, filters, callbacks, and related body properties; reapply required configuration.
- Constraints target the parent compound body, not an arbitrary part.
- Sensors still need compatible category/mask/group filters to report contact.
- Positive equal collision groups always collide; negative equal groups never collide; otherwise category/mask applies.
- Tilemap conversion requires collision tiles/properties to be configured first.
- Complex vertices require valid winding/decomposition and production limits on input complexity.

Do not reach into the bundled Matter engine internals unless public Phaser wrappers cannot satisfy the requirement. If direct Matter modules are used, pin the Phaser version and test body/world teardown.

## Simulation Boundaries

Authoritative flow:

```text
input action -> gameplay command -> physics/body change
physics step -> collision facts -> domain state transition
domain state -> animation/audio/UI presentation
```

- Do not use animation frame callbacks as collision authority.
- Do not write Sprite position from both physics and `update`/Tween.
- Clamp resume behavior and prevent one giant delta from causing tunneling or constraint explosions.
- For lockstep, rollback, replays, or server authority, maintain a separate deterministic simulation and use Phaser physics only if its nondeterminism is acceptable.
- Store stable entity IDs in domain state; do not serialize raw Body/Game Object objects.

## Collision Design

Centralize categories/masks and document the matrix:

| Category | Player | Enemy | Projectile | World | Trigger |
| --- | ---: | ---: | ---: | ---: | ---: |
| Player | policy | policy | policy | yes | overlap |

Do not scatter magic bit masks through Scene code. Build helpers that set category, mask, sensor/overlap intent, and callback ownership together.

Collision callbacks may run many times and in engine-defined step order. Keep them cheap, idempotent where possible, and defer destructive world mutations if the engine/API requires it. Deduplicate contact-driven damage using pair/entity state rather than assuming one callback.

## Performance

- Disable physics debug rendering in production.
- Use static bodies for truly static Arcade geometry.
- Reduce active bodies, collision pair matrix, body complexity, and broadphase area before micro-optimizing callbacks.
- Arcade's tree can cost more to rebuild with thousands of dynamic bodies; profile `useTree` for the actual distribution.
- Sleep Matter bodies where correct and avoid continuously waking large stacks.
- Pool only after measuring allocation churn, and reset body velocity, acceleration, filters, callbacks, sleep, enabled/active, and transform state.
- Use Tilemap collision layers/properties selectively; do not mark every decorative tile collidable.
- Keep physics step settings stable and include them in performance/replay diagnostics.

## Testing and Teardown

Test:

- Low/high/unstable frame cadence, hidden-tab resume, pause/resume, slow motion, and world restart.
- Corners, slopes/rotations, tunneling, fast projectiles, stacked bodies, moving platforms, sensors, category changes, and world bounds.
- Scene restart without duplicate Colliders/listeners or Bodies retained in a global service.
- Pool reuse with stale categories/callbacks cleared.
- Tilemap edits and collision rebuild/update behavior.
- Deterministic domain outcomes independently from rendering where promised.

Destroy feature Colliders/constraints/pointer constraints when their lifetime is shorter than the Scene. On Scene shutdown, clear all external references to bodies and Game Objects even when the physics plugin destroys its world objects.

