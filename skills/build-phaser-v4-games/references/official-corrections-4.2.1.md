# Phaser 4.2.1 Official Skill Corrections

## Contents

- [Precedence](#precedence)
- [Applied corrections](#applied-corrections)
- [Official coverage gaps](#official-coverage-gaps)
- [Known declaration and runtime drift](#known-declaration-and-runtime-drift)
- [Upgrade policy](#upgrade-policy)

## Precedence

The vendored official topics are version-matched reference material, but installed Phaser declarations and runtime source remain authoritative. The sync script records source and transformed hashes in `official/4.2.1/manifest.json` so local corrections are explicit rather than silently presented as upstream text.

## Applied Corrections

The upstream `v4-new-features` topic used camelCase names for five Noise factories. Phaser 4.2.1 declarations and runtime registrations use lowercase names:

| Incorrect upstream example | Phaser 4.2.1 public/runtime name |
| --- | --- |
| `this.add.noiseCell2D()` | `this.add.noisecell2d()` |
| `this.add.noiseCell3D()` | `this.add.noisecell3d()` |
| `this.add.noiseCell4D()` | `this.add.noisecell4d()` |
| `this.add.noiseSimplex2D()` | `this.add.noisesimplex2d()` |
| `this.add.noiseSimplex3D()` | `this.add.noisesimplex3d()` |

The vendoring transform also repairs four broken upstream relative links and rewrites `SKILL.md` links to the non-triggering `topic.md` names used inside this single-entry skill.

## Official Coverage Gaps

The upstream `v4-new-features` topic primarily covers Phaser 4.0 additions. It does not cover these 4.2 additions in sufficient detail:

- `CustomContext` and its factory/creator casing difference.
- `Mesh2D`, topology strategies, atlas pages, and missing generated tint declarations.
- `Stencil` and `StencilReference` plus renderer stencil configuration.
- Secondary tint and `MULTIPLY_TWO` behavior.
- Cone lights.
- `TimeStep#setFPSLimit`.
- Renderer alpha strategies and framebuffer mipmap behavior.

Read `v4-2-rendering.md` for these features and verify them in the installed source.

## Known Declaration and Runtime Drift

Phaser 4.2.1 has three curated drift cases relevant to generated code:

1. `RenderTexture#render()` is declared `void` while the implementation returns `this`. Call it as a statement unless the project owns a version-pinned augmentation.
2. `GameObjectFactory` declares `customContext`, while the runtime add factory registers `customcontext`. Prefer `this.make.customContext(config, true)` because its declaration and runtime registration agree.
3. `Mesh2D#setTint2` and `Mesh2D#setTintMode` exist at runtime but are omitted from the generated `Mesh2D` declaration. Use a narrow 4.2.1 augmentation only when required and cover it with source/runtime tests.

## Upgrade Policy

Do not carry these corrections blindly to another Phaser version. On upgrade:

1. Re-run `scripts/sync-official-skills.mjs` against the new repository skills.
2. Run `scripts/check-phaser-api.mjs` and `scripts/validate-integrated-skill.mjs`.
3. Query every corrected symbol in declarations and source.
4. Remove a correction when upstream declarations, runtime registrations, and official topic text agree.
5. Record new source and transformed hashes in the manifest.
