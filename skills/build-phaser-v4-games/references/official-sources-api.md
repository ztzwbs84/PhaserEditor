# Official Sources and API Verification

## Contents

- [Authority order](#authority-order)
- [Validated baseline](#validated-baseline)
- [Installed package layout](#installed-package-layout)
- [Exact lookup workflow](#exact-lookup-workflow)
- [Source routing](#source-routing)
- [Official documentation](#official-documentation)
- [Drift rules](#drift-rules)

## Authority Order

For an exact method, constructor, callback, event, or config option, use:

1. The target project's installed `node_modules/phaser/types/phaser.d.ts`, scoped to the owning namespace/class.
2. The matching `node_modules/phaser/src/` implementation and JSDoc.
3. Matching tests and changelog in that package/repository version.
4. Version-matched official topic skills under `skills/`, when shipped with the source repository.
5. The version selector in the official API reference and concepts documentation.
6. This curated reference set.

Never infer a signature from a same-named method elsewhere. For example, Camera, PathFollower, Game Object Transform, physics worlds, tweens, and plugins all expose methods named `start`, `stop`, `getWorldPoint`, or `destroy` with different contracts.

When declarations and implementation differ, inspect tests/call sites. Report the mismatch and write against observed runtime behavior only if the project accepts the declaration workaround. Do not cast to `any` merely to hide drift.

## Validated Baseline

This skill was developed on 2026-07-23 against Phaser tag `v4.2.1` (`package.json` release name `Giedi`). The checkout contained:

- `src/`: 2,238 JavaScript source files.
- `types/phaser.d.ts`: generated public declarations.
- `tests/`: Vitest tests, including renderer, camera, Game Object, and physics behavior.
- `skills/`: 28 official Phaser 4 topic skills.
- `changelog/v4/`: v4 release and migration evidence.

The installed application version remains authoritative. Minor releases can add methods, alter generated types, or fix behavior after this snapshot.

## Installed Package Layout

Phaser 4.2.1 publishes a root package export:

| Package field | v4.2.1 target |
| --- | --- |
| `main` | `./src/phaser.js` |
| `browser` | `./dist/phaser.js` |
| `module` | `./dist/phaser.esm.js` |
| `types` | `./types/phaser.d.ts` |
| export `.` import | `./dist/phaser.esm.js` |
| export `.` require | `./dist/phaser.js` |

Do not invent unsupported package subpath imports. Reuse the repository's working import style. A common bundler setup is:

```ts
import Phaser from 'phaser';
```

The generated declaration ends with `declare module 'phaser' { export = Phaser; }`. Confirm `esModuleInterop` or `allowSyntheticDefaultImports` when TypeScript rejects the default import. Runtime ESM also exposes named exports, but verify that the installed declaration and bundler support the chosen named-import style before adopting it.

Custom Phaser builds use source entry points such as `src/phaser-core.js`, `src/phaser-no-physics.js`, and `src/phaser-arcade-physics.js`; they are build inputs, not guaranteed public package exports. Treat custom builds as source-pinned products with explicit upgrade tests.

## Exact Lookup Workflow

1. Resolve the installed package:

```bash
node -p "require('./node_modules/phaser/package.json').version"
```

2. Locate the owning class and signature, not just the method text:

```bash
rg -n "class Camera|class ScenePlugin|getWorldPoint\(" node_modules/phaser/types/phaser.d.ts
rg -n "getWorldPoint: function" node_modules/phaser/src/cameras/2d
```

3. Read surrounding JSDoc, default arguments, return values, event emissions, and cleanup behavior.
4. Search internal call sites and tests:

```bash
rg -n "\.getWorldPoint\(" node_modules/phaser/src node_modules/phaser/tests
```

5. Check the release changelog when behavior is renderer- or migration-sensitive.
6. Compile a minimal typed fixture and run it in the actual renderer when overload resolution or runtime support remains uncertain.

Use `scripts/check-phaser-api.mjs` to confirm that this skill's curated source anchors still exist in a target installation. It validates ownership paths and scoped declaration patterns; it does not prove every runtime branch.

## Source Routing

| Area | Primary source |
| --- | --- |
| Game boot/config/time step | `src/core/Game.js`, `Config.js`, `TimeStep.js`, `typedefs/` |
| Scenes/plugins | `src/scene/Scene.js`, `Systems.js`, `SceneManager.js`, `ScenePlugin.js`, `events/` |
| Loader/cache/textures | `src/loader/`, `src/cache/`, `src/textures/` |
| Game Objects/components | `src/gameobjects/`, `src/gameobjects/components/` |
| Input | `src/input/`, `src/input/events/` |
| Cameras | `src/cameras/2d/` |
| Scale | `src/scale/` |
| Audio | `src/sound/` |
| Time/tweens/animations | `src/time/`, `src/tweens/`, `src/animations/` |
| Arcade physics | `src/physics/arcade/` |
| Matter integration | `src/physics/matter-js/` |
| Tilemaps | `src/tilemaps/` |
| Particles | `src/gameobjects/particles/` |
| WebGL renderer | `src/renderer/webgl/`, especially `renderNodes/` and `wrappers/` |
| Canvas renderer | `src/renderer/canvas/` and each Game Object's Canvas renderer |
| Filters/shaders | `src/filters/`, `src/gameobjects/components/FilterList.js`, `src/gameobjects/shader/` |

## Official Documentation

- Concepts and guides: https://docs.phaser.io/phaser/
- API documentation/version selector: https://docs.phaser.io/api-documentation/api-documentation
- Examples: https://phaser.io/examples
- Main repository: https://github.com/phaserjs/phaser
- Releases: https://github.com/phaserjs/phaser/releases
- Phaser 4.0 release architecture: https://github.com/phaserjs/phaser/releases/tag/v4.0.0
- Current npm package: https://www.npmjs.com/package/phaser

As observed on 2026-07-23, the unversioned official API route served Phaser 4.1.0 while this skill's source baseline was 4.2.1. The official sitemap exposed a 4.0.0 v4 snapshot but no 4.2.x snapshot. Read `official-docs-coverage.md` before relying on online examples or concept pages for v4 signatures.

Concept pages can lead or lag the latest patch/minor. Always select the installed version in the API docs and reconcile snippets with source.

Official repository topic skills cover actions, animations, audio, cameras, curves, data, events, filters, components, setup, geometry, graphics, groups, input, loading, particles, both physics engines, render textures, scale, scenes, sprites, text, tilemaps, time, tweens, migration, and v4 additions. Use them for breadth, not as stronger authority than the versioned implementation.

## Drift Rules

- Pin the Phaser version for commercial releases and upgrade intentionally.
- Re-run API/source checks after every Phaser upgrade.
- Treat methods/properties marked private or internal, underscore-prefixed fields, RenderNode role strings, and renderer wrappers as source-coupled.
- Verify Canvas support separately. The renderer exists in v4, but official migration guidance considers it deprecated for new work and v4 advanced features are WebGL-only.
- Verify custom filters/shaders after renderer changes, context restoration, premultiplied-alpha changes, and texture-orientation changes.
- Verify third-party plugins against Phaser 4 explicitly. A Phaser 3 plugin may use removed Pipelines, FX, masks, objects, or package entry points even when installation succeeds.
