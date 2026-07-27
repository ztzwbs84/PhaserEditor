# Cameras, Scale, Audio, and Time

## Contents

- [Camera model](#camera-model)
- [Responsive scale](#responsive-scale)
- [Audio ownership](#audio-ownership)
- [Time and timers](#time-and-timers)
- [Tweens and timelines](#tweens-and-timelines)
- [Pause matrix](#pause-matrix)
- [Production checks](#production-checks)

## Camera Model

Each Scene has a CameraManager and a main 2D Camera. Cameras select a viewport into world space and can scroll, zoom, rotate, follow, cull, ignore objects, render effects, and coexist for HUD/minimap/split-screen.

Configure world and follow explicitly:

```ts
const camera = this.cameras.main;
camera.setBounds(0, 0, worldWidth, worldHeight);
camera.startFollow(player, true, 0.12, 0.12);
camera.setDeadzone(160, 96);
```

Rules:

- Camera viewport (`x/y/width/height`) is screen placement; scroll is world position.
- Convert pointer screen coordinates with the intended Camera. In Phaser 4.2.1, `camera.getWorldPoint(x, y, output?)` is validated by source, types, and tests.
- `pointer.worldX/worldY` tracks the most recently processed Camera; do not use it blindly in multi-camera Scenes.
- Use `camera.ignore(entries)` to isolate world/HUD render lists. Verify every new HUD/world object enters the right camera set.
- Multiple Cameras multiply traversal/render work. Minimap cost includes its visible objects, effects, and target resolution.
- Follow smoothing is frame/update behavior, not authoritative player motion.
- Camera matrices changed in v4. Standard properties remain the public path; direct matrix consumers require migration review.
- Filters and forced composition use framebuffers. `setForceComposite(true)` is needed for CaptureFrame-style workflows without another composition trigger.

Camera effects are asynchronous visual state. Listen for named completion events instead of guessing with unrelated timers when a transition depends on fade/pan/zoom completion.

## Responsive Scale

Choose one product model:

| Mode | Use | Risk |
| --- | --- | --- |
| `FIT` | Fixed logical game size, letterboxed | Extra bars/safe area |
| `ENVELOP` | Fixed aspect cover | Cropped content |
| `EXPAND` | v4 combined visible-area expansion and fitted canvas | More layout cases |
| `RESIZE` | Canvas tracks host dimensions | World/UI relayout and high-DPR fill rate |
| `NONE` | Host/project owns sizing | More custom code |

Typical fixed logical viewport:

```ts
scale: {
  parent: 'game-host',
  mode: Phaser.Scale.FIT,
  autoCenter: Phaser.Scale.CENTER_BOTH,
  width: 1280,
  height: 720,
}
```

- The parent must have real computed dimensions. Do not apply padding directly to the ScaleManager parent.
- Do not fight ScaleManager by independently styling canvas width/height/margins.
- Handle `Phaser.Scale.Events.RESIZE` from one layout owner and update HUD safe areas, Camera viewports, hit areas, and render targets.
- Use `resize()` only for direct/NONE-style sizing; use `setGameSize()` when preserving configured scaling calculations.
- RESIZE on dense mobile displays can create very large canvases. Measure fill rate and memory.
- Test browser zoom, orientation, safe-area insets, dynamic mobile browser chrome, iframe constraints, and fullscreen exit.

## Audio Ownership

The SoundManager is global. It selects WebAudio, HTML5 Audio, or NoAudio based on config/support.

```ts
if (this.sound.locked) {
  this.sound.once(Phaser.Sound.Events.UNLOCKED, this.startMusic, this);
} else {
  this.startMusic();
}
```

Verify the event constant in the installed release before copying; string event names remain available but named constants make ownership clearer.

- Browsers require a user gesture before audio. Design a visible consent/start flow and test rejected/resumed contexts.
- `this.sound.play(key)` is fire-and-forget and auto-destroys after completion. Use `this.sound.add(key)` for a persistent controllable instance.
- Looping sounds and persistent instances survive Scene changes unless stopped/removed.
- Define music, ambience, SFX, voice, and UI buses in a service instead of letting Scenes fight global volume.
- Spatial audio, decode APIs, panning, and many filters require WebAudio. Provide non-spatial gameplay cues for HTML5 fallback.
- Load alternate formats and test Safari/iOS interruptions, Bluetooth/device changes, background/foreground, mute, and context reuse in SPA remounts.

## Time and Timers

`update(time, delta)` uses milliseconds. Scene Clock, TimerEvent, Timeline, and Tweens follow Scene lifecycle/time scale unless documented otherwise.

```ts
const timer = this.time.addEvent({
  delay: 500,
  repeat: 3, // four total firings
  callback: this.spawnWave,
  callbackScope: this,
});
```

- `repeat: n` means one initial firing plus `n` repeats.
- Zero delay plus repeat/loop creates an invalid infinite timer.
- Timer additions become active through the Clock's pending processing, not necessarily synchronously.
- `timer.reset(config)` does not automatically re-add a completed timer to the Clock.
- `callbackScope` defaults to the TimerEvent, not the Scene. Pass scope or use a deliberate arrow callback.
- Scene pause stops the Scene Clock update. Define whether real-world deadlines should continue using server/epoch time instead.
- Use domain time for saves, cooldown authority, networking, and offline progress; use Phaser time for presentation and Scene-local scheduling.

## Tweens and Timelines

Tweens are presentation tools. Do not use a transform Tween and a physics body as competing authorities.

- Tweens auto-destroy after completion by default. `persist: true` transfers cleanup responsibility to you.
- Property `repeat` differs from whole-Tween `loop`; `loop: -1` never completes.
- Manager and Tween `timeScale` multiply.
- Destroyed targets can cause early completion. Stop/kill feature Tweens before rebinding pooled objects.
- Use `TweenChain` for ordered Tweens. Phaser Timeline can schedule multiple action types, but starts paused and requires `play()`.
- Timeline `timeScale` does not automatically rescale Tweens spawned by Timeline events.
- A seek can suppress events depending on arguments; verify when replay/editor tooling depends on callback delivery.

Prefer animation/tween completion events over duration duplication. Keep gameplay state transitions independent when determinism or rollback matters.

## Pause Matrix

| Mechanism | Scene update | Scene render | Scene timers/tweens | Global audio | External wall clock/network |
| --- | --- | --- | --- | --- | --- |
| Scene pause | Stops | Continues | Stops with Scene | Continues unless policy pauses | Continues |
| Scene sleep | Stops | Stops | Stops with Scene | Continues unless policy pauses | Continues |
| Game pause | Game loop stops | Stops | Stops | Depends on explicit audio policy | Continues |
| Browser hidden | Browser throttles/pauses scheduling | Usually stops/throttles | Large resume delta possible | Browser/platform dependent | Continues |

Implement a product pause coordinator. Decide separately for simulation, UI animation, audio, network heartbeat, ad/SDK integration, and elapsed real time.

## Production Checks

- Convert coordinates correctly after Camera zoom/rotation, Scale resize, CSS layout, and multiple Cameras.
- Verify Camera follow/deadzone at world bounds and teleports.
- Test resize/orientation/fullscreen without pointer offset or stale HUD hit areas.
- Test audio before and after unlock, on mute, background interruption, Scene restart, and app remount.
- Resume after a long hidden-tab gap without tunneling, timer storms, or instant Tween completion unless intended.
- Ensure all persistent sounds, global events, and host resize listeners have an owner and teardown path.

