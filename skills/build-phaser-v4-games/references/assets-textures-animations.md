# Assets, Textures, and Animations

## Contents

- [Loader and cache model](#loader-and-cache-model)
- [Catalog and loading strategy](#catalog-and-loading-strategy)
- [File and texture choices](#file-and-texture-choices)
- [Failure and progress](#failure-and-progress)
- [Cache ownership](#cache-ownership)
- [Animations](#animations)
- [Production checks](#production-checks)

## Loader and Cache Model

Each Scene has a `LoaderPlugin` at `this.load`, but completed assets enter Game-global managers:

- Images, atlases, sprite sheets, render textures, and similar visual resources live in `this.textures`.
- JSON, text, XML, binary, audio metadata/data, shaders, and other types live in typed caches under `this.cache`.
- File keys are case-sensitive and generally unique within a cache/type, not globally across every type.
- A Scene shutdown does not automatically unload assets it loaded.

During `preload`, Phaser starts and awaits the queue automatically before `create`. If files are enqueued in `create` or later, call `this.load.start()` and wait for completion before use.

Do not call factories with an asset key until its owning load milestone has completed. Cached assets can make a race appear correct in development and fail on cold load.

## Catalog and Loading Strategy

Centralize stable product keys and URLs:

```ts
export const AssetKey = {
  playerAtlas: 'game.player-atlas',
  levelOne: 'level.1.map',
  musicMain: 'audio.music.main',
} as const;
```

Organize loading by user-visible milestone and lifetime:

1. Boot: minimal loading UI, fonts needed by shell, compatibility data.
2. Shell/menu: global navigation and menu content.
3. Shared gameplay: player/common enemies/audio/UI atlas.
4. Per-level/episode: map, local art, dialogue, music.
5. Opportunistic next content after first meaningful interaction.

Use pack files for authored catalogs and Scene payload packs for files required before `preload` UI. Validate pack paths, prefixes, duplicate keys, and production build output.

`setBaseURL`, `setPath`, and `setPrefix` affect URL/key resolution. Prefer scoped loader configuration or explicit catalog generation; avoid changing shared Scene loader settings in callbacks without restoring them.

## File and Texture Choices

- Use `load.image` for one frame.
- Use `load.spritesheet` for a regular fixed-size frame grid and numeric frames.
- Use `load.atlas`/multi-atlas for packed frames, named animation frames, trim/rotation metadata, and batching.
- Keep `NineSlice` frames untrimmed and unrotated. Phaser 4.2.1 can read TexturePacker `scale9Borders` from JSON Array/Hash atlases, but trimmed frames are unsupported for nine-slice rendering.
- Use `load.tilemapTiledJSON` with an image loaded separately for Tiled maps.
- Supply audio format alternatives appropriate to the browser matrix.
- Load bitmap fonts before constructing BitmapText.
- Load shader/GLSL assets according to v4's shader configuration and GL texture orientation.

Atlases reduce requests and texture switches, but excessively large atlases increase download/decode/upload spikes and prevent granular unloading. Split by loading and lifetime boundary, not file type alone.

Texture filtering, pixel-art sampling, mipmap behavior, compressed formats, CORS, maximum texture size, and GPU memory must be tested on target devices. Network file size is not decoded/GPU memory.

## Failure and Progress

Loader progress reflects completed queue entries, not exact bytes. It can decrease if new files are added while loading.

Handle at least:

- Per-file error with key, type, resolved URL, retry count, and cause.
- Recoverable retry without duplicate UI/listener registration.
- Missing critical content leading to an error/retry Scene rather than a partial game.
- Optional content fallback that is explicit and licensed.
- Offline/CDN timeout and malformed metadata.
- CORS failures for textures, canvas readback, audio, and third-party hosts.

Phaser 4.2.1's Loader default `maxRetries` is 2; it is copied to files when they are created. Set policy before enqueueing files.

Use Loader event constants when practical. Register progress/error listeners before enqueue/start and remove or scope them to the load run. A loading Scene's `update` does not run during preload; render and other Scene lifecycle events can still occur.

## Cache Ownership

Removing a global cache entry while another visible Scene uses it can invalidate rendering or playback. Define leases/refcounts for streamed commercial games:

```text
catalog key -> cache type -> owning bundle -> active leases -> removable?
```

Removal examples are `this.textures.remove(key)` and typed cache `.remove(key)`, but verify the installed API and ownership first.

Rules:

- Destroy Scene Game Objects before removing textures they reference.
- Do not reload the same key with different content without removing/replacing it deliberately.
- Keep shared shell/gameplay resources until final owner release.
- Remove per-level data and textures after transition completion, not while the old Scene can still render.
- Re-entry must tolerate an already-cached key without creating duplicate global animations or listeners.

## Animations

`this.anims` is normally the global AnimationManager; each Sprite has its own AnimationState at `sprite.anims`.

Create shared definitions once:

```ts
if (!this.anims.exists('player.walk')) {
  this.anims.create({
    key: 'player.walk',
    frames: this.anims.generateFrameNames(AssetKey.playerAtlas, {
      prefix: 'walk-',
      start: 0,
      end: 7,
    }),
    frameRate: 12,
    repeat: -1,
  });
}
```

- `repeat: -1` never emits animation complete; stop it or observe stop for state changes.
- If both `frameRate` and `duration` are supplied, frameRate wins.
- `play` can stop the current animation; use the ignore-if-playing option when appropriate.
- Animation events are presentation signals. Keep combat, hit windows, replay, and authoritative timers in deterministic domain/physics logic.
- Clear chains when a forced stop must not start the next animation.
- Do not create global animation keys on every Scene restart.

## Production Checks

- Validate every catalog/pack key and emitted file after the production build.
- Test cold cache, warm cache, throttled network, retry, offline, partial CDN failure, and stale service-worker cache.
- Record download, decode, GPU upload/first render, and Scene-ready milestones separately.
- Verify texture memory and cache counts across repeated level transitions.
- Test atlas trim/origin, animation frame names, resolution variants, compressed texture fallbacks, audio alternatives, and font readiness.
- For UI atlases, test nine-slice metadata, fixed-corner preservation, edge sampling, padding/extrusion, and smallest/largest rendered panel sizes. Use [game-ui-nine-slice.md](game-ui-nine-slice.md) when source art must be cut or visually accepted.
- Sanitize or constrain user-provided SVG/HTML/data and bound file size/dimensions before decode.
- Respect browser autoplay and CORS; successful download does not prove playable audio or readable canvas output.
