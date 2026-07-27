# Game Objects, Input, UI, and Accessibility

## Contents

- [Game Object selection](#game-object-selection)
- [Display ownership and transforms](#display-ownership-and-transforms)
- [Text and UI](#text-and-ui)
- [Input model](#input-model)
- [Coordinates and drag](#coordinates-and-drag)
- [Accessibility](#accessibility)
- [Custom components](#custom-components)
- [Performance and cleanup](#performance-and-cleanup)

## Game Object Selection

| Need | Prefer | Key constraint |
| --- | --- | --- |
| Static textured visual | `Image` | No AnimationState |
| Frame animation | `Sprite` | Global definition plus per-Sprite state |
| Membership/pool/bulk operations | `Group` | Not rendered and has no transform |
| Local transform hierarchy | `Container` | Extra matrix cost; physics children are risky |
| Render grouping/order | `Layer` | No local child transform; cannot be inside Container |
| Drawn vector commands | `Graphics` | Rebuilding complex paths per frame is expensive |
| Rich dynamic text | `Text` | Changes rerasterize/upload its canvas texture |
| Frequent/repeated text | `BitmapText` | Glyph set/font asset must cover content |
| DOM form/media element | `DOMElement` | Requires configured DOM container and synchronized layout |
| Trigger/hit region | `Zone` | Set explicit size/hit area |
| Large uniform quad data | `SpriteGPULayer` | WebGL-only specialized buffer model |

Use composition around Game Objects for product features. Subclass only when a reusable Game Object contract or renderer behavior benefits.

## Display Ownership and Transforms

- Scene Display List order and `depth` control rendering. `setDepth` queues sorting; direct list reordering can be superseded by depth sorting.
- A Group's members remain individual Scene display entries. Moving the Group does nothing visually.
- Container children use Container-local coordinates. Deep nesting increases transform and input cost.
- A Layer is a display bucket. Containers can be placed in Layers; Layers cannot be placed in Containers.
- Container origin is fixed at `(0, 0)`. Give Containers explicit size before default interactive hit testing.
- `displayWidth`/`displayHeight` modify scale. `setSize` changes internal dimensions; `setDisplaySize` changes rendered scale.
- Visual flip does not modify physics bodies.
- Scroll factor changes rendering relative to Camera, not physics world position. Avoid physics HUD objects.

Prefer shallow hierarchy, stable display ordering, and domain/view separation. Avoid storing destroyed Game Objects in global registries or save data.

## Text and UI

Neither Phaser core nor Canvas provides a complete accessible application UI toolkit. Build game HUD from Game Objects, and use semantic DOM for forms, editable text, long prose, account/payment flows, and accessibility-critical controls.

Text choices:

- `Text`: Canvas-rasterized, broad font/CJK/emoji coverage; any text/style change can rerasterize and upload.
- `BitmapText`: best for scores, timers, damage numbers, and large frequent updates.
- `DynamicBitmapText`: per-glyph callback every frame; use only when required.
- Load browser fonts before creating layout-sensitive Text. Phaser does not make a font usable merely because an asset URL exists.

Use NineSlice/Graphics/Image/BitmapText for reusable game controls. Define states for idle, hover, pressed, disabled, focus, selected, loading, and error. Keep layout in one responsive owner rather than scattering coordinates through callbacks.

For DOMElement, enable `dom.createContainer`, provide a sized parent, and test ScaleManager, fullscreen, CSS transforms, focus, pointer routing, and teardown. DOM elements and canvas Game Objects occupy different rendering/accessibility systems.

## Input Model

There is one global InputManager and one InputPlugin per Scene. Pointer input unifies mouse and touch; keyboard and gamepad are separate plugins exposed through the Scene input system.

Enable only intentional targets:

```ts
button.setInteractive(
  new Phaser.Geom.Rectangle(0, 0, width, height),
  Phaser.Geom.Rectangle.Contains,
);
```

- Texture-backed objects can derive a default hit area; Containers/Zones need explicit dimensions or geometry.
- Pixel-perfect hit testing reads alpha and is expensive. Use only for small, sparse targets.
- `topOnly` controls whether only the topmost eligible Game Object receives Scene input.
- Multi-camera and parallel-Scene ordering affect which Scene/Camera processes a pointer.
- Disable/remove interaction when hidden or inactive rather than leaving invisible modal blockers.
- Store callbacks when cleanup or rebinding is required.

Keyboard rules:

- Bind actions rather than spreading key codes through gameplay.
- Distinguish held state from edge events such as just-down/just-up.
- Prevent browser defaults only for keys the focused game truly owns.
- Clear stuck state on blur/visibility changes and support remapping.

Gamepad rules:

- Handle connect/disconnect and index reassignment.
- Add deadzones and normalize analog values.
- Keep keyboard/gamepad actions behaviorally equivalent.

## Coordinates and Drag

Pointer `x/y` are screen/canvas coordinates. `worldX/worldY` reflect the most recently processed Camera and can be wrong for a different Camera.

Use a specific Camera:

```ts
const world = pointer.positionToCamera(camera, reusablePoint);
// or the installed Camera#getWorldPoint(x, y, output) signature
```

For drags:

- Track the active pointer and ignore unrelated touches.
- Convert into the intended parent/world space before setting position.
- Handle drag end, pointer cancellation, Scene shutdown, blur, and target destruction.
- Separate visual drag from authoritative inventory/world validation.
- Avoid physics transform conflicts; use a physics-aware drag/constraint strategy when bodies are active.

## Accessibility

A canvas Scene does not create meaningful DOM semantics automatically. For every critical workflow:

- Provide keyboard/gamepad activation and visible focus.
- Mirror essential controls/status in semantic DOM or an accessible overlay where needed.
- Supply labels, roles, live-region announcements, and logical tab order in DOM.
- Test screen readers, zoom, high contrast, reduced motion, touch target size, and non-pointer completion.
- Do not expose decorative Game Objects to the accessibility tree.
- Keep DOM overlay position synchronized with ScaleManager/Camera only when the semantic control must align visually.

Do not claim a game is accessible because pointer events work or because text is visible in canvas pixels.

## Custom Components

Use a normal class that owns or receives Game Objects for most product behavior. Register a custom Game Object Factory or Plugin when reuse across Scenes/projects justifies Phaser integration.

Avoid private fields such as internal render-step arrays, renderer wrappers, and underscore-prefixed state. Renderer extensions should pin Phaser minor versions and include context-restoration and visual tests.

Keep serializable state outside the custom Game Object. Expose explicit `bind(model)`, `updateView`, `setEnabled`, and `destroy`/cleanup boundaries.

## Performance and Cleanup

- Pool measured high-churn objects; reset every retained property before reuse.
- Avoid `this.add.*`, new Graphics/Text, arrays, closures, or filters inside hot updates.
- Batch text/style mutations and skip unchanged values.
- Avoid deep Containers, frequent depth sorts, pixel-perfect hit testing, and individually filtered object fleets.
- Destroy feature objects when lifetime ends; remove global/external listeners separately.
- Do not keep Game Object references in global DataManager, module singletons, or stale UI closures after Scene restart.
- Test pointer behavior after object pooling, reparenting, visibility changes, Camera changes, and responsive resize.

