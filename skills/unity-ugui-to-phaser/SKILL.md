---
name: unity-ugui-to-phaser
description: Convert and harden Unity UGUI Prefabs for Phaser with evidence-driven structural, visual, and interaction parity. Use when importing serialized UGUI, fixing RectTransform/layout/text/image/mask/nested-Prefab behavior, resolving Unity assets, or proving conversion fidelity. Do not use for ordinary Phaser UI that has no Unity source.
---

# Unity UGUI To Phaser

## Mission

Deliver a reproducible UGUI conversion whose fidelity is demonstrated against Unity ground truth. Treat 1:1 as an acceptance result, never as an assumption or a synonym for "the preview loaded."

The shared intermediate document is the single conversion boundary. HTML preview, Phaser preview, baked output, and editor integration must consume the same parsed values and resolved layout. Fix divergence at the earliest shared stage that owns the behavior.

## Read By Task

- Read [fidelity-contract.md](references/fidelity-contract.md) before scoping, claiming parity, or accepting waivers.
- Read [ugui-semantics.md](references/ugui-semantics.md) for conversion or rendering changes.
- Read [validation.md](references/validation.md) before selecting fixtures, capturing references, comparing renders, or deciding completion.
- Read [repository-workflow.md](references/repository-workflow.md) when working in the bundled converter/editor implementation.

## Required Inputs

Discover inputs from the user, repository, or Unity metadata. Do not bake machine-specific source paths into this skill or generated source code.

Establish:

- Unity project root, Prefab root, complete Assets root, and output root;
- Unity editor version and packages that own serialized UI components;
- target Phaser version, viewport set, device scale, color space, and font policy;
- required fidelity tier: structural, visual, or interactive;
- a Unity reference capture for every state that must be called 1:1.

If Unity reference renders are unavailable, continue with conversion and structural/render-consistency validation, but label the result `reference-unverified`. Do not claim Unity parity.

## Workflow

### 1. Profile Before Converting

Inventory all Prefabs and presentation resources. Measure feature frequency, nested-Prefab use, visual complexity, custom component signatures, missing GUIDs, and rare serialized property combinations.

Use `scripts/profile-corpus.mjs` when a representative corpus is not already maintained. Select high-risk and rare-feature Prefabs, not merely the first files alphabetically.

### 2. Establish The Fidelity Contract

Declare supported presentation features, runtime-only behavior, custom adapters, intentional substitutions, and numeric tolerances. Classify every custom component as:

- nonvisual metadata;
- serialized presentation behavior that needs an adapter;
- runtime-generated content that needs a state fixture or runtime bridge;
- out of scope and therefore a release blocker for affected Prefabs.

Never silently downgrade custom graphics, materials, localized text providers, Spine content, procedural meshes, or runtime-populated lists.

### 3. Trace Every Visual Field End To End

For each changed behavior, trace the serialized field through:

1. Unity YAML parsing;
2. object/reference preservation;
3. intermediate schema;
4. nested-Prefab override application;
5. layout or text measurement;
6. HTML and Phaser rendering;
7. baked resources and diagnostics;
8. reference comparison.

If a presentation field stops at any stage, implement it or emit a blocking diagnostic. Preserving raw metadata alone is not visual support.

### 4. Implement At The Owning Boundary

- Parser defects belong in Unity YAML/object-reference handling.
- Geometry defects belong in the shared RectTransform/layout solver.
- Text measurement and glyph-bound defects belong in the shared text engine.
- Sprite metadata and atlas defects belong in asset indexing.
- Renderer code should consume resolved values, not invent compensating coordinates.
- Renderer-specific fallbacks require an explicit diagnostic and reference evidence.

Preserve Unity file IDs as strings and complete object references. Resolve GUIDs against the complete Assets tree. Keep additive schema changes compatible with the current document version unless a migration is intentionally introduced.

### 5. Test In Layers

Add focused synthetic fixtures for the smallest semantic rule, then exercise the risk corpus, then the full batch. Validate multiple viewport sizes and every required state.

Use `scripts/audit-batch.mjs` after baking. A batch is not commercially acceptable when it contains unresolved presentation resources, unsupported visual overrides, unknown visual components without adapters, missing required artifacts, parse/render errors, or unreviewed warning diagnostics.

### 6. Compare Against Unity

Capture Unity and Phaser with matching viewport, device scale, state, fonts, locale, animation time, active hierarchy, and color-space settings. Compare geometry and pixels using the protocol in `references/validation.md`.

Use `scripts/compare-renders.mjs` for deterministic PNG dimension and pixel gates when the repository does not already provide an equivalent comparator.

HTML-versus-Phaser parity is a useful consistency check but cannot replace Unity-versus-Phaser evidence.

### 7. Close With Evidence

Report:

- corpus and state coverage;
- supported, adapted, substituted, and blocked features;
- structural and pixel metrics by viewport;
- diagnostic counts and approved waivers;
- commands/tests run and artifact locations;
- residual risk.

Do not describe a conversion as 1:1 while any required Prefab or state is `reference-unverified`, blocked, or outside tolerance.

## Non-Negotiable Invariants

1. Unity file IDs remain lossless strings.
2. GUID resolution covers the complete Assets tree and detects duplicate GUIDs.
3. RectTransform anchors, pivot, offsets, scale, rotation, sibling order, active state, and source references survive conversion.
4. Nested Prefabs expand recursively with complete-reference matching, removals, additions, and overrides.
5. Unknown presentation behavior is blocking, not cosmetic information.
6. Layout is solved before renderer object creation and is stable across repeated passes.
7. HTML and Phaser consume identical resolved rectangles, text layouts, clipping decisions, and resource metadata.
8. Text overflow and masks are independent Unity semantics.
9. Sprite sub-rects, pivots, borders, pixels-per-unit, image type, fill behavior, tint, and alpha are preserved.
10. Diagnostics are append-only evidence; never delete unsupported data to make a report green.

## Completion Gates

A required Prefab passes only when:

- conversion and rendering complete without errors;
- all presentation resources resolve and load;
- all visual components and overrides are supported or explicitly adapted;
- hierarchy, active state, draw order, and resolved geometry match the reference contract;
- required Unity/Phaser render pairs are within tolerance;
- HTML/Phaser consistency checks pass where both renderers are shipped;
- focused tests, batch audit, typecheck, and production build pass;
- every waiver names an owner, rationale, affected scope, and expiry condition.

If any gate fails, return the blocking evidence and continue iteration. Do not redefine the gate around the current output.
