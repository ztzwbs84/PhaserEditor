# Bootstrap, Scenes, and Lifecycle

## Contents

- [Boot and renderer selection](#boot-and-renderer-selection)
- [Global and Scene systems](#global-and-scene-systems)
- [Scene lifecycle](#scene-lifecycle)
- [Scene operations](#scene-operations)
- [Ownership and cleanup](#ownership-and-cleanup)
- [Restart-safe structure](#restart-safe-structure)
- [SPA and final teardown](#spa-and-final-teardown)

## Boot and Renderer Selection

`new Phaser.Game(config)` parses `GameConfig`, creates global managers, waits for DOM readiness, creates the renderer and canvas, boots textures/plugins/Scenes, and starts `TimeStep`.

Renderer constants:

| Constant | Behavior |
| --- | --- |
| `Phaser.AUTO` | Select WebGL when available, otherwise Canvas |
| `Phaser.CANVAS` | Force Canvas |
| `Phaser.WEBGL` | Force WebGL; no Canvas fallback |
| `Phaser.HEADLESS` | No renderer; still expects a DOM-like environment |

Prefer `WEBGL` when filters, lighting, RenderNodes, SpriteGPULayer, TilemapGPULayer, WebGL BitmapText effects, or custom shaders are required. `AUTO` is valid only when the product tests Canvas and gates unsupported capabilities.

GameConfig top-level shortcuts and nested config can overlap. In v4.2.1, `scale` values take priority for width, height, zoom, and parent; `render` values take priority for render options. Avoid setting both forms.

`fps.target` is informational. Use `fps.limit` to cap updates. It cannot exceed the browser's scheduling/display cadence.

## Global and Scene Systems

Global managers are shared across Scenes:

- `game.anims`, `game.cache`, `game.registry`, `game.scale`, `game.sound`, `game.textures`, `game.plugins`, `game.scene`, renderer, input manager, and time step.
- Assets loaded by one Scene enter global Texture/Cache managers.
- Animations created through `this.anims` are global unless a Sprite-local animation is deliberately used.
- Sounds do not stop merely because their creating Scene shuts down.

Scene-specific systems include:

- `this.events`, `this.add`, `this.make`, `this.children`, `this.cameras`, `this.input`, `this.load`, `this.time`, `this.tweens`, `this.data`, and configured physics plugins.
- `this.sys` is the Scene Systems owner. Never overwrite it.
- `this.physics` and `this.matter` exist only when their plugins are configured.

Do not use `this.registry` as an untyped service locator. Reserve it for genuinely global, simple state or bridge it through a typed adapter. Keep saves and domain models outside Phaser objects.

## Scene Lifecycle

The practical user-code sequence is:

```text
constructor once
  -> init(data) per start
  -> preload() and Loader completion
  -> create(data)
  -> update(time, delta) while running
  -> shutdown on stop/restart
  -> possible init/preload/create again
  -> destroy only on permanent removal
```

Scene states include PENDING, INIT, START, LOADING, CREATING, RUNNING, PAUSED, SLEEPING, SHUTDOWN, and DESTROYED.

- Constructor: stable dependency declarations and Scene key only. Do not put restartable state here.
- `init`: reset per-run state and validate payload.
- `preload`: enqueue required assets and configure progress/error handlers.
- `create`: construct Game Objects, colliders, input, timers, and integrations after load completion.
- `update`: advance orchestration/presentation with millisecond `delta`; avoid allocation and asset lookup churn.
- `SHUTDOWN`: remove external/global listeners, sounds, DOM hooks, sockets, observers, and stale references. The Scene can start again.
- `DESTROY`: final cleanup for a permanently removed Scene.

## Scene Operations

| Operation | Current Scene | Target Scene |
| --- | --- | --- |
| `start(key, data)` | Shuts down caller | Starts target |
| `launch(key, data)` | Continues | Starts target in parallel |
| `run(key, data)` | Continues | Starts/resumes/wakes based on state |
| `restart(data)` | Shuts down then starts again | Same Scene |
| `pause(key)` | Stops update, still renders | N/A |
| `sleep(key)` | Stops update and render, preserves state | N/A |
| `stop(key)` | Full shutdown, restartable | N/A |
| `remove(key)` | Destroys permanently | N/A |
| `switch(key)` | Sleeps caller | Starts/wakes target according to API behavior |

Use `this.scene` from user Scenes. Scene Manager operations are queued; target lifecycle is not guaranteed to complete before the current function returns.

Parallel Scene ordering controls both visual stacking and input/update priority. Document the world, HUD, modal, and transition ordering instead of relying on incidental registration order.

## Ownership and Cleanup

| Resource | Typical owner | Shutdown action |
| --- | --- | --- |
| Scene Game Objects/display list | Scene Systems | Automatic Scene shutdown; clear external references |
| Scene timers/tweens/input | Scene plugin | Usually shut down with Scene; explicitly clean feature-level/rebound handlers |
| Collider/physics world | Physics Scene plugin | World shutdown; destroy early when feature lifetime is shorter |
| `this.events` listeners | Scene | Emitter lifecycle follows Scene; use `once` for lifecycle hooks |
| `game.events` listener | Registering feature | `off` with exact callback/context on SHUTDOWN |
| Registry event listener | Registering feature | `off` on SHUTDOWN; registry is global |
| Other Scene's event listener | Listening feature | `off` on SHUTDOWN; sleeping does not prevent delivery |
| Window/document/DOM listener | Registering feature | Remove on SHUTDOWN/final teardown |
| Looping/persistent Sound | Audio service or Scene lease | Stop/remove according to cross-Scene policy |
| Global texture/cache entry | Asset lease/catalog | Remove only when no active/future consumer owns it |
| Socket/worker/observer | App or feature service | Unsubscribe/terminate/disconnect at owner boundary |

Anonymous global listeners cannot be removed precisely. Store callback identity or use an AbortController for DOM APIs.

## Restart-Safe Structure

Use a single cleanup registration and make it idempotent:

```ts
create() {
  this.game.events.on(Phaser.Core.Events.BLUR, this.onBlur, this);
  this.registry.events.on('changedata-score', this.onScore, this);
  this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
}

private onShutdown() {
  this.game.events.off(Phaser.Core.Events.BLUR, this.onBlur, this);
  this.registry.events.off('changedata-score', this.onScore, this);
  this.music?.stop();
  this.music = undefined;
  this.abortController?.abort();
  this.abortController = undefined;
}
```

Protect non-Loader async work with an AbortSignal or generation token. A late fetch, SDK callback, or promise must not attach objects to a Scene after shutdown.

Do not recreate global animation keys blindly in every `create`. Check `this.anims.exists(key)` or create them once in a boot/content service.

## SPA and Final Teardown

The host integration owns the Game instance:

1. Remove route/framework subscriptions that can call into Phaser.
2. Stop external services and persistent audio.
3. Call `game.destroy(true, noReturn)` with an intentional `noReturn` choice.
4. Destruction is scheduled for the next frame; use the Game destroy event when host cleanup depends on completion.
5. Remove any host DOM created outside Phaser.

Use `noReturn: true` only when another Phaser instance will never be created in that page lifetime. For route remounts, test repeated create/destroy cycles, AudioContext policy, canvas removal, global listeners, and memory stabilization.

