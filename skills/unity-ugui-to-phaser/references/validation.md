# Validation Protocol

## Build A Risk Corpus

The maintained corpus must include:

- largest and deepest Prefabs;
- every supported Graphic, text, mask, layout, fitter, control, and Canvas mode;
- simple, sliced, tiled, and every filled-image mode;
- sprite atlases and standalone textures;
- nested Prefabs with additions, removals, stripped aliases, and visual overrides;
- custom presentation adapters;
- missing/stale references and malformed YAML failure fixtures;
- multiple aspect ratios, reference resolution, and resized viewports;
- localized strings, extreme text sizes, rich text, overflow, and missing glyphs;
- interactive and animated states required by scope.

Use the profiler to seed the corpus, then maintain named fixtures for regressions. Random or alphabetical samples are insufficient.

## Capture Unity Ground Truth

Capture references from the declared Unity version with deterministic inputs:

- fixed resolution and device scale;
- fixed locale, font assets, and fallback fonts;
- fixed time, animation state, scroll position, selection, and runtime data;
- consistent color space, render pipeline, camera, and transparent/background treatment;
- disabled nondeterministic particles, clocks, network content, and random seeds unless they are the feature under test.

Store a manifest beside references containing the source Prefab identity, source revision, state name, viewport, capture settings, and hashes of relevant assets. A screenshot without this metadata is not durable ground truth.

## Structural Comparison

Compare Unity capture data or an approved Unity-side export against the intermediate document:

- node identity and parent;
- active state and sibling/draw order;
- component type and resource identity;
- world corners, pivot, scale, rotation, and clip bounds;
- text logical rect, glyph bounds, baseline, and resolved font size;
- mask ancestry and effective clip region.

Report maximum and percentile errors, not only averages. A single displaced button can be commercially significant even when the frame average is low.

## Render Comparison

Compare images at the same physical pixel dimensions. Never compare screenshots that were independently fit into different browser viewports.

Perform:

1. exact dimension and alpha/background checks;
2. per-channel absolute difference;
3. mismatch ratio above the declared threshold;
4. mean and percentile channel error;
5. connected-region or bounding-box localization of differences;
6. optional perceptual metric for triage, never as the only gate.

Maintain explicit masks for approved volatile regions. Keep text and nontext metrics separate when rasterizers differ. Large coherent regions usually indicate geometry, tint, alpha, mask, or draw-order defects and must not be hidden with a larger global tolerance.

## HTML And Phaser Consistency

When both renderers ship, render them at exact matching dimensions from the same document and shared layout output. Compare resolved rectangle maps before pixel comparison. Then compare render output.

Typical divergence sources include:

- RGB tint applied by one renderer but only alpha applied by the other;
- different sprite sub-rect or Y-axis atlas handling;
- NineSlice border units;
- radial fill implementation;
- font-load timing and fallback fonts;
- mask transforms or nesting;
- CanvasGroup alpha composition;
- different responsive scaling before capture.

Consistency is necessary but not sufficient: both renderers can share the same defect relative to Unity.

## Diagnostic Audit

Run the strict batch auditor after every risk-corpus or full-batch bake. Review:

- diagnostic counts by severity and code;
- unsupported override property paths;
- unknown component GUID/file ID and serialized field signature;
- unresolved and browser-incompatible resources;
- nested-Prefab expansion failures or stale targets;
- missing output artifacts;
- per-Prefab warning density.

Do not accept a report solely because every entry has status `passed`; many batch systems define pass as "no fatal exception." Commercial parity requires the fidelity gates as well.

## Iteration Order

Fix high-blast-radius failures first:

1. parser/reference identity;
2. asset and sprite metadata;
3. hierarchy, transform, and draw order;
4. shared layout;
5. image tint/type/fill/material;
6. text measurement and effects;
7. masks and scrolling;
8. custom adapters and interactive states;
9. renderer-specific precision.

After each fix, run the focused synthetic test, affected corpus entries, the strict audit, and relevant render comparisons. Periodically rerun the complete corpus to detect cross-feature regressions.

## Release Evidence

The final report must make it possible to reproduce the claim. Include:

- source and tool revisions;
- environment and capture manifest;
- selected corpus and rationale;
- conversion/audit/test results;
- structural and pixel metrics per state;
- diff images for failures and approved exclusions;
- support matrix and waivers;
- final status per Prefab/state.
