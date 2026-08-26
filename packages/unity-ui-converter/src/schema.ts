export const UNITY_UI_FORMAT = 'phaser-editor-unity-ugui'
export const UNITY_UI_VERSION = 1

export interface Vec2 {
  x: number
  y: number
}

export interface Vec3 extends Vec2 {
  z: number
}

export interface Vec4 extends Vec3 {
  w: number
}

export interface Color {
  r: number
  g: number
  b: number
  a: number
}

export interface UIObjectReference {
  fileId: string
  guid?: string
  type?: number
}

export type DiagnosticSeverity = 'info' | 'warning' | 'error'

export interface UIDiagnostic {
  severity: DiagnosticSeverity
  code: string
  message: string
  sourcePath?: string
  nodeId?: string
  componentId?: string
  propertyPath?: string
  details?: Record<string, unknown>
}

export interface RectTransformData {
  anchorMin: Vec2
  anchorMax: Vec2
  pivot: Vec2
  anchoredPosition: Vec2
  sizeDelta: Vec2
  localPosition: Vec3
  localRotation: Vec4
  localEulerAngles: Vec3
  localScale: Vec3
  offsets: {
    left: number
    right: number
    top: number
    bottom: number
  }
}

export interface SpriteData {
  rect: { x: number; y: number; width: number; height: number }
  border: { left: number; right: number; top: number; bottom: number }
  pivot: Vec2
  pixelsPerUnit: number
  packed: boolean
  name?: string
}

export type UIResourceKind = 'sprite' | 'texture' | 'font' | 'material' | 'prefab' | 'unknown'

export interface UIResource {
  id: string
  kind: UIResourceKind
  guid: string
  fileId: string
  sourcePath: string | null
  metaPath: string | null
  webPath: string | null
  width?: number
  height?: number
  sprite?: SpriteData
}

export interface UIComponentBase {
  id: string
  sourceFileId: string
  sourceReferences?: UIObjectReference[]
  type: string
  enabled: boolean
}

export interface UIImageComponent extends UIComponentBase {
  type: 'image' | 'raw-image'
  resourceId: string | null
  color: Color
  raycastTarget: boolean
  maskable: boolean
  imageType: 'simple' | 'sliced' | 'tiled' | 'filled'
  preserveAspect: boolean
  fillCenter: boolean
  fillMethod: number
  fillOrigin: number
  fillAmount: number
  fillClockwise: boolean
  pixelsPerUnitMultiplier: number
}

export interface UITextEffect {
  type: 'outline' | 'shadow'
  color: Color
  distance: Vec2
}

export interface UITextComponent extends UIComponentBase {
  type: 'text' | 'text-mesh-pro'
  resourceId: string | null
  text: string
  color: Color
  fontSize: number
  fontStyle: number
  alignment: number
  horizontalAlignment?: 'left' | 'center' | 'right' | 'justified' | 'flush' | 'geometry'
  verticalAlignment?: 'top' | 'middle' | 'bottom' | 'baseline' | 'midline' | 'capline'
  alignByGeometry?: boolean
  lineSpacing: number
  characterSpacing: number
  richText: boolean
  bestFit: boolean
  minSize: number
  maxSize: number
  horizontalOverflow: number
  verticalOverflow: number
  horizontalOverflowMode?: 'wrap' | 'overflow'
  verticalOverflowMode?: 'truncate' | 'overflow'
  wordWrap: boolean
  raycastTarget: boolean
  effects: UITextEffect[]
}

export interface UIControlComponent extends UIComponentBase {
  type:
    | 'button'
    | 'toggle'
    | 'toggle-group'
    | 'slider'
    | 'scrollbar'
    | 'scroll-rect'
    | 'input-field'
    | 'dropdown'
    | 'mask'
    | 'rect-mask-2d'
    | 'horizontal-layout-group'
    | 'vertical-layout-group'
    | 'grid-layout-group'
    | 'content-size-fitter'
    | 'aspect-ratio-fitter'
    | 'layout-element'
    | 'canvas-group'
    | 'canvas'
    | 'canvas-scaler'
    | 'unknown'
  properties: Record<string, unknown>
}

export type UIComponent = UIImageComponent | UITextComponent | UIControlComponent

export interface UINode {
  id: string
  sourceFileId: string
  rectSourceFileId: string | null
  sourceReferences?: UIObjectReference[]
  name: string
  parentId: string | null
  order: number
  active: boolean
  layer: number
  rect: RectTransformData
  components: UIComponent[]
}

export interface PrefabOverride {
  targetFileId: string
  targetReference?: UIObjectReference
  propertyPath: string
  value: string
  objectReference?: { fileId: string; guid?: string; type?: number }
}

export interface NestedPrefabInstance {
  id: string
  sourcePrefabResourceId: string | null
  parentTransformFileId: string
  overrides: PrefabOverride[]
  removedComponentFileIds: string[]
  removedGameObjectFileIds: string[]
  removedComponentReferences?: UIObjectReference[]
  removedGameObjectReferences?: UIObjectReference[]
}

export interface CanvasSettings {
  referenceResolution: Vec2
  scaleMode: number
  screenMatchMode: number
  matchWidthOrHeight: number
  referencePixelsPerUnit: number
  sortingOrder: number
}

export interface UnityUIDocument {
  format: typeof UNITY_UI_FORMAT
  version: typeof UNITY_UI_VERSION
  name: string
  source: {
    prefabPath: string
    prefabGuid: string | null
    unityVersion: string | null
  }
  canvas: CanvasSettings
  rootIds: string[]
  nodes: UINode[]
  resources: Record<string, UIResource>
  nestedPrefabs: NestedPrefabInstance[]
  diagnostics: UIDiagnostic[]
  statistics: {
    nodeCount: number
    componentCounts: Record<string, number>
    resourceCount: number
    errorCount: number
    warningCount: number
  }
}

export function createDefaultRect(): RectTransformData {
  return {
    anchorMin: { x: 0.5, y: 0.5 },
    anchorMax: { x: 0.5, y: 0.5 },
    pivot: { x: 0.5, y: 0.5 },
    anchoredPosition: { x: 0, y: 0 },
    sizeDelta: { x: 100, y: 100 },
    localPosition: { x: 0, y: 0, z: 0 },
    localRotation: { x: 0, y: 0, z: 0, w: 1 },
    localEulerAngles: { x: 0, y: 0, z: 0 },
    localScale: { x: 1, y: 1, z: 1 },
    offsets: { left: -50, right: -50, top: -50, bottom: -50 }
  }
}
