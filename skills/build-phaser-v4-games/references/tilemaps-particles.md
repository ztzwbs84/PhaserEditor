# Tilemaps, Particles, and Large Worlds

## Contents

- [Tilemap data model](#tilemap-data-model)
- [CPU and GPU layers](#cpu-and-gpu-layers)
- [Tiled workflow](#tiled-workflow)
- [Collision and runtime edits](#collision-and-runtime-edits)
- [ParticleEmitter](#particleemitter)
- [SpriteGPULayer](#spritegpulayer)
- [Large-world production strategy](#large-world-production-strategy)

## Tilemap Data Model

A `Tilemap` owns parsed map/layer/object/tileset data. It is not itself the rendered layer. Create one or more layer Game Objects from map data.

```ts
const map = this.make.tilemap({ key: 'level.1.map' });
const tileset = map.addTilesetImage('Terrain', 'level.1.tiles');

if (!tileset) {
  throw new Error('Tiled tileset Terrain did not resolve');
}

const ground = map.createLayer('Ground', tileset, 0, 0);
if (!ground) {
  throw new Error('Tiled layer Ground did not resolve');
}
```

The first `addTilesetImage` argument is the tileset name in Tiled, not necessarily the Phaser texture key. Layer names must also match Tiled, including group prefixes such as `Group/Layer`.

Each Tilemap data layer can normally produce one layer Game Object. Empty tile index is `-1`; parser/factory options can store `null` for empty cells to reduce sparse-map memory at the cost of runtime insertion flexibility.

## CPU and GPU Layers

| Capability | `TilemapLayer` | `TilemapGPULayer` |
| --- | --- | --- |
| Renderer | WebGL and Canvas paths | WebGL only |
| Orientations | Orthogonal, isometric, hexagonal, staggered | Orthogonal only |
| Tilesets per layer | Multiple | One tileset / one texture |
| Runtime edits | Normal map APIs reflected by renderer | Regenerate layer data texture after edits |
| Cost model | Visible-tile traversal/batching | Layer rendered as a specialized quad; shader samples tile data |
| Best use | General maps, editing, broad compatibility | Huge mostly stable orthogonal layers |

In Phaser 4.2.1, the factory path supports requesting the GPU layer through the installed `createLayer` signature. Verify the final argument/name against types/source before generating code:

```ts
const gpuGround = map.createLayer('Ground', tileset, 0, 0, true);
```

The v4 GPU layer is not a transparent optimization toggle. It changes supported map topology, tileset count, renderer requirements, edit synchronization, and debugging.

## Tiled Workflow

- Export embedded tileset metadata in the JSON as expected by Phaser's Tiled parser.
- Use tileset images, not a Tiled "collection of images" tileset.
- Keep stable names for tilesets, layers, object layers, properties, object types/classes, and animation definitions.
- Validate GIDs/firstgid, margin/spacing, tile dimensions, image dimensions, and external build path rewriting.
- Treat Tiled object layers as authored data. Convert objects through a controlled factory/schema validator rather than blindly instantiating classes from strings.
- Prefix/group layer names deliberately and validate required layers at boot/build time.
- Bound custom property types and reject malformed/untrusted map data.

Generate a build-time map contract when content teams can change Tiled files independently. Fail CI for missing texture keys, duplicate semantic IDs, unknown entity types, invalid collision properties, and references outside the asset catalog.

## Collision and Runtime Edits

Mark collision before creating physics Colliders:

```ts
ground.setCollisionByProperty({ collides: true });
this.physics.add.collider(player, ground);
```

- Tile callbacks require an active collider/overlap path.
- Mark only gameplay collision tiles; decorative collision increases work and creates confusing contacts.
- Matter conversion also requires collision selection first.
- Runtime edits must update collision state and any derived navigation/occlusion/lighting data owned by the product.
- For TilemapGPULayer, call `generateLayerDataTexture()` after editing tile data or visual changes will not reach the GPU representation.
- If a layer uses streaming chunks, keep coordinate conversion, collision ownership, and object activation consistent across chunk boundaries.

Test world-to-tile and tile-to-world conversion with layer position, scale, Camera scroll/zoom, non-default origins, and map orientation.

## ParticleEmitter

Modern Phaser returns a `ParticleEmitter` directly from `this.add.particles`; there is no ParticleEmitterManager layer.

```ts
const emitter = this.add.particles(0, 0, 'spark', {
  lifespan: 700,
  speed: { min: 80, max: 180 },
  scale: { start: 1, end: 0 },
  quantity: 4,
  frequency: 80,
});
```

- `emitting = false` stops new particles while alive particles continue; `active = false` freezes the whole emitter.
- `frequency: 0` emits every frame. `frequency: -1` selects burst/explode behavior.
- `stop` means emission stopped; `complete` occurs after the final live particle dies.
- `speed` selects radial behavior; separate `speedX/speedY` selects point motion.
- `color` and `tint` are alternative controls; verify configured precedence.
- Use `reserve(count)`/config reserve to preallocate when measured spawn allocation causes stalls.
- `maxParticles` bounds pooled objects; `maxAliveParticles` bounds simultaneously live particles.
- Set finite limits for user/content-driven emitters.

Destroy or stop emitters at feature/Scene ownership boundaries. Pooling an emitter requires resetting follow target, zones, processors, callbacks, animation/frame, active/emitting, counters, and render state.

## SpriteGPULayer

Use SpriteGPULayer for very large populations of simple quads whose member data can remain in a GPU buffer. It can be appropriate for animated backgrounds, crowds, foliage, or particle-like visuals when normal Game Object behavior is unnecessary.

Constraints in the v4 source model include:

- WebGL-only.
- One texture/image model per layer; no arbitrary multi-atlas Game Objects.
- Member records are not normal interactive/child Game Objects.
- Buffer changes are expensive relative to leaving populated data stable.
- It supports a restricted component/animation model; it is not a general Sprite replacement.

Prototype the exact add/update/remove workflow and measure buffer upload cost. Do not quote release-note million-sprite or speedup claims as a product guarantee; device, quad size, overdraw, shader, resolution, and update frequency dominate.

## Large-World Production Strategy

- Partition loading/lifetime by region or level, not one global map bundle.
- Keep render culling, physics activation, AI simulation, audio emitters, and network interest as separate budgets.
- Deactivate or aggregate distant simulation rather than merely hiding sprites.
- Precompute navigation/collision metadata at build time when possible.
- Use CPU TilemapLayer for frequently edited gameplay layers and GPU layers for stable visual layers if constraints fit.
- Avoid per-tile Game Objects for static decoration.
- Test boundary traversal, teleport, save/load, rollback, Scene restart, device memory pressure, and partial asset failure.
- Record tile dimensions, visible tile count, layer count, GPU data texture size, collidable tile count, dynamic object count, and worst-case Camera coverage in performance reports.

