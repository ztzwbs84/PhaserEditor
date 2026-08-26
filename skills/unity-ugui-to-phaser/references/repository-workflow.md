# Repository Workflow

## Ownership Map

The bundled implementation uses these boundaries:

- `packages/unity-ui-converter/src/unity-yaml.ts`: YAML normalization, scalar preservation, vectors, colors, and references.
- `packages/unity-ui-converter/src/asset-index.ts`: complete Assets GUID index, image dimensions, sprite importer metadata, and resource resolution.
- `packages/unity-ui-converter/src/converter.ts`: hierarchy construction, component conversion, nested Prefabs, removals, additions, and overrides.
- `packages/unity-ui-converter/src/schema.ts`: intermediate document contract.
- `packages/unity-ui-converter/src/layout.ts`: shared RectTransform and UGUI layout solver.
- `packages/unity-ui-converter/src/text-layout.ts`: shared text measurement, rich text, glyph bounds, effects, and clipping.
- `packages/unity-ui-converter/templates/preview-runtime.js`: HTML consumer of shared conversion results.
- `packages/unity-ui-converter/src/phaser-renderer.ts`: Phaser consumer of shared conversion results.
- `packages/unity-ui-converter/src/bake.ts` and `batch.ts`: artifacts and reports.
- `scripts/validate-unity-ui-batch.mjs`: browser smoke validation.
- Unity UI service and panel modules: directory validation, preview lifecycle, export, controls, and diagnostics presentation.

Keep conversion semantics out of the editor panel and renderer-specific UI code.

## CLI Use

Build the converter before scan, bake, or batch operations. Pass source roots and output locations as runtime arguments or environment values. Verify the CLI's resolved paths in its output before trusting a run.

When an npm script invokes another npm script before the CLI, confirm that named arguments actually reach the final process. If forwarding is unreliable, invoke the built CLI entrypoint directly. Do not infer a successful configuration from an npm exit code alone.

Use a persistent asset-index cache for iteration and rebuild it after asset or metadata changes. Keep evaluation output outside source-controlled paths unless the user requests committed fixtures.

## Test Layers

Run in this order:

1. converter build;
2. focused converter/layout/service tests affected by the change;
3. TypeScript typecheck;
4. risk-corpus bake and strict audit;
5. exact-size browser render validation and Unity comparison;
6. production build;
7. complete batch when blast radius warrants it.

The repository browser validator is a smoke test unless it also enforces exact capture dimensions, layout-map equality, and declared pixel thresholds. Pair it with the skill batch auditor and reference comparison.

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
