# Fidelity Contract

## Meaning Of 1:1

`1:1` means that a declared Unity UI state and its Phaser result satisfy the same contract at the same viewport and capture conditions. It requires Unity ground truth.

Use three explicit tiers:

| Tier | Required evidence |
| --- | --- |
| Structural | Hierarchy, active state, draw order, component mapping, resource identity, resolved rectangles, transforms, and clipping regions match. |
| Visual | Structural tier plus reference render comparison for images, text, effects, masks, opacity, tint, materials, and color space. |
| Interactive | Visual tier plus defined control states, scrolling, selection, transitions, animation samples, and runtime-populated states. |

Do not collapse these tiers. A structurally correct document can still be visually wrong, and a matching idle frame can still be interactively wrong.

## Scope Declaration

Before implementation, record:

- Unity editor and relevant package versions;
- Phaser and browser/runtime versions;
- reference resolutions and responsive viewport set;
- device scale, render pipeline, color space, locale, and font sources;
- Prefabs, variants, nested dependencies, and required states;
- animation sample times and deterministic runtime data;
- permitted substitutions and their owners.

If the capture environment is not controlled, the result is evidence for debugging, not a parity certificate.

## Support Classification

Classify each serialized component and material:

| Class | Treatment |
| --- | --- |
| Native UGUI presentation | Convert through the shared schema and renderer path. |
| Custom serialized presentation | Implement a named adapter and focused tests. |
| Runtime-generated presentation | Provide deterministic runtime fixtures or a runtime bridge. |
| Nonvisual behavior/metadata | Preserve source data; it may remain informational if proven nonvisual. |
| Unknown | Block affected Prefabs until classified. |

Field names such as color, material, sprite, texture, font, text, gradient, outline, shadow, spacing, padding, clipping, mesh, render queue, or shader parameters are evidence that an unknown component may be visual. Do not waive it based only on its class name.

## Default Acceptance Envelope

Use project-owned thresholds when available. Otherwise start with these strict defaults and document any change:

- resolved edge, pivot, and clip-bound error: at most `0.25 px` at reference scale;
- text baseline or glyph-bound error: at most `0.5 px` when the same font rasterizer is available;
- resource identity, active state, draw order, mask ancestry, and component mapping: exact;
- unresolved presentation resources: zero;
- unsupported visual overrides or visual components: zero;
- browser/page/render errors: zero;
- pixel mismatch above an 8-level channel threshold: at most `0.25%` outside approved volatile regions;
- mean absolute channel error: at most `1.0` outside approved volatile regions.

Font rasterization, shader precision, and GPU differences may require a platform-specific envelope. Define exclusions as explicit regions with a reason; never use a broad global tolerance to hide geometry errors.

## Waivers

A waiver is acceptable only when it records:

- diagnostic or metric being waived;
- exact Prefabs, states, and regions affected;
- user-visible consequence;
- owner and rationale;
- replacement behavior;
- expiry or removal condition.

Do not convert warnings into information merely to satisfy a gate. Keep the original evidence and apply the waiver in the validation policy.

## Honest Completion Language

Use one of these statuses per Prefab/state:

- `verified`: all declared gates pass against Unity reference;
- `reference-unverified`: conversion checks pass but no valid Unity reference exists;
- `blocked`: a required feature, resource, state, or metric fails;
- `excluded`: explicitly outside scope with an approved waiver.

Only `verified` work may be described as 1:1.
