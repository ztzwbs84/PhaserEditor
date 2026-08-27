# Bundled Converter Workflow

## Ownership Map

The standalone implementation lives below `runtime/unity-ui-converter`:

- `src/unity-yaml.ts`: YAML normalization, scalar preservation, vectors, colors, and references.
- `src/asset-index.ts`: complete or explicitly scoped GUID indexes, image dimensions, sprite importer metadata, cache identity, and resource resolution.
- `src/converter.ts`: hierarchy construction, component conversion, nested Prefabs, removals, additions, and overrides.
- `src/schema.ts`: intermediate document contract.
- `src/layout.ts`: shared RectTransform and UGUI layout solver.
- `src/text-layout.ts`: shared text measurement, rich text, glyph bounds, effects, and clipping.
- `templates/preview-runtime.js`: HTML consumer of shared conversion results.
- `src/phaser-renderer.ts`: Phaser consumer of shared conversion results.
- `src/bake.ts` and `src/batch.ts`: artifacts and reports.
- `src/cli.ts`: project discovery, commands, runtime options, and output routing.

Keep conversion semantics out of a target editor panel or renderer-specific integration. Fix the bundled shared boundary first.

## CLI Use

Invoke the stable wrapper at `scripts/ugui.mjs`; do not depend on npm scripts or workspace packages in the target repository. Pass source roots and output locations as runtime arguments or environment values. Verify the CLI's resolved paths in its reports before trusting a run.

Use a persistent asset-index cache for iteration and rebuild it after asset or metadata changes. Keep evaluation output outside source-controlled Unity Assets unless committed fixtures are requested.

## Development

The bundled `dist` and `vendor` runtime are committed so conversion works offline without setup. After changing TypeScript source, run setup if needed and then build from the skill root:

```bash
npm run setup
npm run build:converter
npm run doctor
npm run smoke
```

Do not edit generated `dist` without making the equivalent source change. Keep templates adjacent to the runtime because baking resolves them relative to the compiled module.

## Test Layers

Run in this order:

1. bundled converter build;
2. focused parser, converter, layout, and text tests affected by the change;
3. TypeScript typecheck;
4. synthetic Prefab bake;
5. risk-corpus batch and strict audit;
6. exact-size browser render validation and Unity comparison;
7. complete batch when blast radius warrants it;
8. copy the skill to a clean temporary directory and rerun doctor plus a bake.

## Diagnostic Policy

Stable codes must preserve source path, node/component identity, property path, target reference, and details when known.

Recommended severity:

- `error`: parse failure, cycle, recursion/depth stop, resource copy failure, render failure, or invalid output;
- `warning`: unresolved presentation resource, unsupported visual mapping/override, ambiguous reference, browser limitation, or nonconvergent layout;
- `info`: successful expansion, proven nonvisual preservation, or genuinely stale target.

The batch entry status may continue to describe fatal conversion success, but commercial acceptance must be calculated separately by the strict audit.

## Required Artifacts

Every baked Prefab used for validation must contain the intermediate document, conversion report, HTML preview, Phaser preview, preview data/runtime modules, shared layout/text modules, Phaser renderer, and all available copied resources.

Generated reports must retain original diagnostics. Never mutate the source document solely to make the audit pass.
