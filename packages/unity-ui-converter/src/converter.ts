import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { UnityAssetIndex, resourceId } from './asset-index.js'
import { deriveOffsets } from './layout.js'
import {
  UNITY_UI_FORMAT,
  UNITY_UI_VERSION,
  createDefaultRect,
  type CanvasSettings,
  type NestedPrefabInstance,
  type RectTransformData,
  type UIComponent,
  type UIControlComponent,
  type UIDiagnostic,
  type UIImageComponent,
  type UINode,
  type UIObjectReference,
  type UIResource,
  type UITextComponent,
  type UITextEffect,
  type UnityUIDocument
} from './schema.js'
import {
  asArray,
  asBoolean,
  asNumber,
  asRecord,
  asString,
  parseUnityYaml,
  readColor,
  readReference,
  readVec2,
  readVec3,
  readVec4,
  type UnityObjectReference,
  type UnityYamlObject
} from './unity-yaml.js'

export interface ConvertPrefabOptions {
  unityVersion?: string | null
  defaultReferenceResolution?: { x: number; y: number }
  expandNestedPrefabs?: boolean
  maxNestedDepth?: number
}

interface ComponentContext {
  nodeId: string
  sourcePath: string
  sourceGuid: string | null
  resources: Record<string, UIResource>
  diagnostics: UIDiagnostic[]
  assetIndex: UnityAssetIndex
}

export async function convertUnityPrefab(prefabPath: string, assetIndex: UnityAssetIndex, options: ConvertPrefabOptions = {}): Promise<UnityUIDocument> {
  return convertUnityPrefabInternal(prefabPath, assetIndex, options, new Set(), 0)
}

async function convertUnityPrefabInternal(prefabPath: string, assetIndex: UnityAssetIndex, options: ConvertPrefabOptions, ancestors: Set<string>, depth: number): Promise<UnityUIDocument> {
  const sourcePath = path.resolve(prefabPath)
  const diagnostics: UIDiagnostic[] = []
  if (ancestors.has(sourcePath)) {
    diagnostics.push({ severity: 'error', code: 'NESTED_PREFAB_CYCLE', message: 'Nested Prefab cycle detected.', sourcePath })
  }
  const nextAncestors = new Set(ancestors).add(sourcePath)
  const source = await readFile(sourcePath, 'utf8')
  const objects = parseUnityYaml(source, sourcePath, diagnostics)
  const prefabGuid = await readPrefabGuid(sourcePath)
  const byFileId = new Map(objects.map((object) => [object.fileId, object]))
  const gameObjects = objects.filter((object) => object.typeName === 'GameObject' && !object.stripped && 'm_Name' in object.data)
  // Stripped RectTransforms describe nested Prefab references, not standalone
  // GameObjects. Treating them as real transforms creates phantom parents such
  // as unity-node:0 and disconnects expanded nested nodes from the hierarchy.
  const transforms = objects.filter((object) => object.typeName === 'RectTransform' && !object.stripped)
  const transformByGameObject = new Map(transforms.map((transform) => [readReference(transform.data.m_GameObject).fileId, transform]))
  const gameObjectByTransform = new Map(transforms.map((transform) => [transform.fileId, readReference(transform.data.m_GameObject).fileId]))
  const resources: Record<string, UIResource> = {}

  const nodes = await Promise.all(gameObjects.map(async (gameObject): Promise<UINode> => {
    const transform = transformByGameObject.get(gameObject.fileId)
    const nodeId = nodeIdFor(gameObject.fileId)
    if (!transform) {
      diagnostics.push({
        severity: 'warning',
        code: 'RECT_TRANSFORM_MISSING',
        message: `GameObject ${asString(gameObject.data.m_Name, gameObject.fileId)} has no RectTransform and uses fallback geometry.`,
        sourcePath,
        nodeId
      })
    }
    const fatherTransformId = transform ? readReference(transform.data.m_Father).fileId : '0'
    const parentGameObjectId = gameObjectByTransform.get(fatherTransformId)
    const componentReferences = asArray(gameObject.data.m_Component).map((entry) => readReference(asRecord(entry).component).fileId)
    const context: ComponentContext = { nodeId, sourcePath, sourceGuid: prefabGuid, resources, diagnostics, assetIndex }
    const components: UIComponent[] = []
    for (const componentFileId of componentReferences) {
      const object = byFileId.get(componentFileId)
      if (!object || object.typeName === 'RectTransform' || object.typeName === 'CanvasRenderer') continue
      const component = await convertComponent(object, context)
      if (component) components.push(component)
    }
    attachTextEffects(components)
    return {
      id: nodeId,
      sourceFileId: gameObject.fileId,
      rectSourceFileId: transform?.fileId ?? null,
      sourceReferences: compactReferences([
        sourceReference(prefabGuid, gameObject.fileId),
        transform ? sourceReference(prefabGuid, transform.fileId) : null
      ]),
      name: asString(gameObject.data.m_Name, `GameObject ${gameObject.fileId}`),
      parentId: parentGameObjectId ? nodeIdFor(parentGameObjectId) : null,
      order: transform ? asNumber(transform.data.m_RootOrder) : 0,
      active: asBoolean(gameObject.data.m_IsActive, true),
      layer: asNumber(gameObject.data.m_Layer),
      rect: transform ? readRectTransform(transform.data) : createDefaultRect(),
      components
    }
  }))

  const nestedPrefabs = await convertNestedPrefabs(objects, assetIndex, resources, diagnostics, sourcePath)
  if (nestedPrefabs.length > 0) {
    if (options.expandNestedPrefabs === false) {
      diagnostics.push({
        severity: 'warning', code: 'NESTED_PREFAB_PRESERVED_NOT_EXPANDED',
        message: 'Nested Prefab metadata and overrides were parsed, but recursive expansion was disabled.', sourcePath
      })
    } else if (depth >= (options.maxNestedDepth ?? 8)) {
      diagnostics.push({
        severity: 'error', code: 'NESTED_PREFAB_DEPTH_EXCEEDED',
        message: `Nested Prefab expansion exceeded depth ${options.maxNestedDepth ?? 8}.`, sourcePath
      })
    } else {
      await expandNestedPrefabs(nestedPrefabs, nodes, gameObjectByTransform, resources, diagnostics, assetIndex, options, nextAncestors, depth + 1, prefabGuid, sourcePath, objects)
    }
  }
  const canvas = readCanvasSettings(nodes, options.defaultReferenceResolution ?? { x: 1280, y: 720 })
  const componentCounts: Record<string, number> = {}
  for (const component of nodes.flatMap((node) => node.components)) componentCounts[component.type] = (componentCounts[component.type] ?? 0) + 1
  const rootIds = nodes.filter((node) => node.parentId === null).sort((a, b) => a.order - b.order).map((node) => node.id)

  return {
    format: UNITY_UI_FORMAT,
    version: UNITY_UI_VERSION,
    name: path.basename(sourcePath, path.extname(sourcePath)),
    source: { prefabPath: sourcePath, prefabGuid, unityVersion: options.unityVersion ?? null },
    canvas,
    rootIds,
    nodes: sortHierarchy(nodes),
    resources,
    nestedPrefabs,
    diagnostics,
    statistics: {
      nodeCount: nodes.length,
      componentCounts,
      resourceCount: Object.keys(resources).length,
      errorCount: diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length,
      warningCount: diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length
    }
  }
}

function readRectTransform(data: Record<string, unknown>): RectTransformData {
  const rect: RectTransformData = {
    anchorMin: readVec2(data.m_AnchorMin, { x: 0.5, y: 0.5 }),
    anchorMax: readVec2(data.m_AnchorMax, { x: 0.5, y: 0.5 }),
    pivot: readVec2(data.m_Pivot, { x: 0.5, y: 0.5 }),
    anchoredPosition: readVec2(data.m_AnchoredPosition),
    sizeDelta: readVec2(data.m_SizeDelta, { x: 100, y: 100 }),
    localPosition: readVec3(data.m_LocalPosition),
    localRotation: readVec4(data.m_LocalRotation, { x: 0, y: 0, z: 0, w: 1 }),
    localEulerAngles: readVec3(data.m_LocalEulerAnglesHint),
    localScale: readVec3(data.m_LocalScale, { x: 1, y: 1, z: 1 }),
    offsets: { left: 0, right: 0, top: 0, bottom: 0 }
  }
  rect.offsets = deriveOffsets(rect)
  return rect
}

async function convertComponent(object: UnityYamlObject, context: ComponentContext): Promise<UIComponent | null> {
  const data = object.data
  const base = {
    id: componentIdFor(context.nodeId, object.fileId),
    sourceFileId: object.fileId,
    sourceReferences: [sourceReference(context.sourceGuid, object.fileId)],
    enabled: asBoolean(data.m_Enabled, true)
  }
  if (object.typeName === 'Canvas') {
    return control(base, 'canvas', {
      renderMode: asNumber(data.m_RenderMode),
      sortingOrder: asNumber(data.m_SortingOrder),
      overrideSorting: asBoolean(data.m_OverrideSorting),
      targetDisplay: asNumber(data.m_TargetDisplay)
    })
  }
  if (object.typeName !== 'MonoBehaviour') return null

  if ('m_Sprite' in data && 'm_Type' in data) {
    const reference = readReference(data.m_Sprite)
    const resource = await resolveResource(reference, 'sprite', context)
    const imageTypes: UIImageComponent['imageType'][] = ['simple', 'sliced', 'tiled', 'filled']
    return {
      ...base,
      type: 'image',
      resourceId: resource,
      color: readColor(data.m_Color),
      raycastTarget: asBoolean(data.m_RaycastTarget, true),
      maskable: asBoolean(data.m_Maskable, true),
      imageType: imageTypes[asNumber(data.m_Type)] ?? 'simple',
      preserveAspect: asBoolean(data.m_PreserveAspect),
      fillCenter: asBoolean(data.m_FillCenter, true),
      fillMethod: asNumber(data.m_FillMethod, 4),
      fillOrigin: asNumber(data.m_FillOrigin),
      fillAmount: asNumber(data.m_FillAmount, 1),
      fillClockwise: asBoolean(data.m_FillClockwise, true),
      pixelsPerUnitMultiplier: asNumber(data.m_PixelsPerUnitMultiplier, 1)
    }
  }

  if ('m_Texture' in data && 'm_UVRect' in data) {
    const reference = readReference(data.m_Texture)
    const resource = await resolveResource(reference, 'texture', context)
    return {
      ...base,
      type: 'raw-image',
      resourceId: resource,
      color: readColor(data.m_Color),
      raycastTarget: asBoolean(data.m_RaycastTarget, true),
      maskable: asBoolean(data.m_Maskable, true),
      imageType: 'simple',
      preserveAspect: false,
      fillCenter: true,
      fillMethod: 4,
      fillOrigin: 0,
      fillAmount: 1,
      fillClockwise: true,
      pixelsPerUnitMultiplier: 1
    }
  }

  if ('m_Text' in data && 'm_FontData' in data) return convertLegacyText(base, data, context)
  if ('m_text' in data && ('m_fontAsset' in data || 'm_FontAsset' in data)) return convertTmpText(base, data, context)
  if ('m_OnClick' in data && 'm_TargetGraphic' in data) return control(base, 'button', selectableProperties(data))
  if ('m_IsOn' in data && 'm_Graphic' in data) return control(base, 'toggle', { ...selectableProperties(data), isOn: asBoolean(data.m_IsOn), group: readReference(data.m_Group) })
  if ('m_AllowSwitchOff' in data) return control(base, 'toggle-group', { allowSwitchOff: asBoolean(data.m_AllowSwitchOff) })
  if ('m_Content' in data && 'm_Viewport' in data && 'm_Horizontal' in data && 'm_Vertical' in data) {
    return control(base, 'scroll-rect', pick(data, ['m_Content', 'm_Viewport', 'm_Horizontal', 'm_Vertical', 'm_MovementType', 'm_Elasticity', 'm_Inertia', 'm_DecelerationRate', 'm_ScrollSensitivity', 'm_HorizontalScrollbar', 'm_VerticalScrollbar']))
  }
  if ('m_HandleRect' in data && 'm_Direction' in data && 'm_Size' in data) return control(base, 'scrollbar', pick(data, ['m_HandleRect', 'm_Direction', 'm_Value', 'm_Size', 'm_NumberOfSteps']))
  if ('m_HandleRect' in data && 'm_Direction' in data && 'm_MaxValue' in data) return control(base, 'slider', pick(data, ['m_FillRect', 'm_HandleRect', 'm_Direction', 'm_MinValue', 'm_MaxValue', 'm_WholeNumbers', 'm_Value']))
  if ('m_TextComponent' in data && 'm_Placeholder' in data && 'm_CharacterLimit' in data) return control(base, 'input-field', pick(data, ['m_TextComponent', 'm_Placeholder', 'm_ContentType', 'm_InputType', 'm_CharacterValidation', 'm_CharacterLimit', 'm_LineType', 'm_Text']))
  if ('m_Template' in data && 'm_CaptionText' in data && 'm_Options' in data) return control(base, 'dropdown', pick(data, ['m_Template', 'm_CaptionText', 'm_CaptionImage', 'm_ItemText', 'm_ItemImage', 'm_Value', 'm_Options']))
  if ('m_ShowMaskGraphic' in data) return control(base, 'mask', { showMaskGraphic: asBoolean(data.m_ShowMaskGraphic, true) })
  if ('m_Padding' in data && 'm_Softness' in data) return control(base, 'rect-mask-2d', pick(data, ['m_Padding', 'm_Softness']))
  const script = readReference(data.m_Script)
  if (script.guid === UGUI_SCRIPT_GUIDS.gridLayoutGroup || ('m_CellSize' in data && 'm_Constraint' in data)) return control(base, 'grid-layout-group', layoutProperties(data))
  if (script.guid === UGUI_SCRIPT_GUIDS.horizontalLayoutGroup) return control(base, 'horizontal-layout-group', layoutProperties(data))
  if (script.guid === UGUI_SCRIPT_GUIDS.verticalLayoutGroup) return control(base, 'vertical-layout-group', layoutProperties(data))
  if ('m_ChildAlignment' in data && 'm_Spacing' in data && 'm_ChildForceExpandWidth' in data) {
    const type = inferLinearLayout(data)
    return control(base, type, layoutProperties(data))
  }
  if (script.guid === UGUI_SCRIPT_GUIDS.contentSizeFitter || ('m_HorizontalFit' in data && 'm_VerticalFit' in data)) return control(base, 'content-size-fitter', pick(data, ['m_HorizontalFit', 'm_VerticalFit']))
  if (script.guid === UGUI_SCRIPT_GUIDS.aspectRatioFitter || ('m_AspectMode' in data && 'm_AspectRatio' in data)) return control(base, 'aspect-ratio-fitter', pick(data, ['m_AspectMode', 'm_AspectRatio']))
  if (script.guid === UGUI_SCRIPT_GUIDS.layoutElement || ('m_IgnoreLayout' in data && 'm_LayoutPriority' in data)) {
    return control(base, 'layout-element', pick(data, ['m_IgnoreLayout', 'm_MinWidth', 'm_MinHeight', 'm_PreferredWidth', 'm_PreferredHeight', 'm_FlexibleWidth', 'm_FlexibleHeight', 'm_LayoutPriority']))
  }
  if ('m_Alpha' in data && 'm_BlocksRaycasts' in data && 'm_IgnoreParentGroups' in data) return control(base, 'canvas-group', pick(data, ['m_Alpha', 'm_Interactable', 'm_BlocksRaycasts', 'm_IgnoreParentGroups']))
  if ('m_UiScaleMode' in data && 'm_ReferenceResolution' in data) return control(base, 'canvas-scaler', pick(data, ['m_UiScaleMode', 'm_ReferencePixelsPerUnit', 'm_ScaleFactor', 'm_ReferenceResolution', 'm_ScreenMatchMode', 'm_MatchWidthOrHeight', 'm_PhysicalUnit', 'm_FallbackScreenDPI', 'm_DefaultSpriteDPI']))
  if (isTextEffect(data)) return control(base, 'unknown', { textEffect: readTextEffect(data), script: readReference(data.m_Script) })

  context.diagnostics.push({
    severity: 'info',
    code: 'COMPONENT_UNSUPPORTED',
    message: `MonoBehaviour ${script.guid ?? 'without GUID'}:${script.fileId} is preserved as an unsupported component.`,
    sourcePath: context.sourcePath,
    nodeId: context.nodeId,
    componentId: base.id,
    details: { fields: Object.keys(data).filter((key) => !key.startsWith('m_Object')).slice(0, 40) }
  })
  return control(base, 'unknown', { script, fields: pick(data, Object.keys(data).filter((key) => !key.startsWith('m_Object') && key !== 'm_Script')) })
}

async function convertLegacyText(base: Omit<UITextComponent, keyof UITextComponent> & { id: string; sourceFileId: string; enabled: boolean }, data: Record<string, unknown>, context: ComponentContext): Promise<UITextComponent> {
  const fontData = asRecord(data.m_FontData)
  const reference = readReference(fontData.m_Font)
  const resource = await resolveResource(reference, 'font', context)
  const alignment = asNumber(fontData.m_Alignment)
  return {
    ...base,
    type: 'text',
    resourceId: resource,
    text: asString(data.m_Text),
    color: readColor(data.m_Color),
    fontSize: asNumber(fontData.m_FontSize, 14),
    fontStyle: asNumber(fontData.m_FontStyle),
    alignment,
    horizontalAlignment: legacyHorizontalAlignment(alignment),
    verticalAlignment: legacyVerticalAlignment(alignment),
    alignByGeometry: asBoolean(fontData.m_AlignByGeometry),
    lineSpacing: asNumber(fontData.m_LineSpacing, 1),
    characterSpacing: 0,
    richText: asBoolean(fontData.m_RichText, true),
    bestFit: asBoolean(fontData.m_BestFit),
    minSize: asNumber(fontData.m_MinSize, 10),
    maxSize: asNumber(fontData.m_MaxSize, 40),
    horizontalOverflow: asNumber(fontData.m_HorizontalOverflow),
    verticalOverflow: asNumber(fontData.m_VerticalOverflow),
    horizontalOverflowMode: asNumber(fontData.m_HorizontalOverflow) === 0 ? 'wrap' : 'overflow',
    verticalOverflowMode: asNumber(fontData.m_VerticalOverflow) === 0 ? 'truncate' : 'overflow',
    wordWrap: asNumber(fontData.m_HorizontalOverflow) === 0,
    raycastTarget: asBoolean(data.m_RaycastTarget),
    effects: []
  }
}

async function convertTmpText(base: { id: string; sourceFileId: string; enabled: boolean }, data: Record<string, unknown>, context: ComponentContext): Promise<UITextComponent> {
  const reference = readReference(data.m_fontAsset ?? data.m_FontAsset)
  const resource = await resolveResource(reference, 'font', context)
  const rawCombinedAlignment = asNumber(data.m_textAlignment, 65535)
  const rawHorizontalAlignment = data.m_HorizontalAlignment == null ? rawCombinedAlignment : asNumber(data.m_HorizontalAlignment)
  const rawVerticalAlignment = data.m_VerticalAlignment == null ? rawCombinedAlignment : asNumber(data.m_VerticalAlignment)
  const overflowMode = asNumber(data.m_overflowMode)
  const wordWrap = asBoolean(data.m_enableWordWrapping, true)
  return {
    ...base,
    type: 'text-mesh-pro',
    resourceId: resource,
    text: asString(data.m_text),
    color: readColor(data.m_fontColor ?? data.m_Color),
    fontSize: asNumber(data.m_fontSize, 14),
    fontStyle: asNumber(data.m_FontStyle ?? data.m_fontStyle),
    alignment: rawCombinedAlignment,
    horizontalAlignment: tmpHorizontalAlignment(rawHorizontalAlignment),
    verticalAlignment: tmpVerticalAlignment(rawVerticalAlignment),
    alignByGeometry: false,
    lineSpacing: asNumber(data.m_lineSpacing, 0),
    characterSpacing: asNumber(data.m_characterSpacing, 0),
    richText: asBoolean(data.m_isRichText, true),
    bestFit: asBoolean(data.m_enableAutoSizing),
    minSize: asNumber(data.m_fontSizeMin, 10),
    maxSize: asNumber(data.m_fontSizeMax, 40),
    horizontalOverflow: overflowMode,
    verticalOverflow: overflowMode,
    horizontalOverflowMode: wordWrap ? 'wrap' : 'overflow',
    verticalOverflowMode: overflowMode === 0 ? 'overflow' : 'truncate',
    wordWrap,
    raycastTarget: asBoolean(data.m_RaycastTarget),
    effects: []
  }
}

async function resolveResource(reference: UnityObjectReference, kind: UIResource['kind'], context: ComponentContext): Promise<string | null> {
  if (reference.fileId === '0' && !reference.guid) return null
  const id = resourceId(reference)
  if (!context.resources[id]) context.resources[id] = await context.assetIndex.resolve(reference, kind, context.diagnostics, context.sourcePath)
  return id
}

async function convertNestedPrefabs(objects: UnityYamlObject[], assetIndex: UnityAssetIndex, resources: Record<string, UIResource>, diagnostics: UIDiagnostic[], sourcePath: string): Promise<NestedPrefabInstance[]> {
  const instances: NestedPrefabInstance[] = []
  for (const object of objects.filter((entry) => entry.typeName === 'PrefabInstance')) {
    const modification = asRecord(object.data.m_Modification)
    const sourceReference = readReference(object.data.m_SourcePrefab)
    let sourcePrefabResourceId: string | null = null
    if (sourceReference.fileId !== '0' || sourceReference.guid) {
      sourcePrefabResourceId = resourceId(sourceReference)
      resources[sourcePrefabResourceId] ??= await assetIndex.resolve(sourceReference, 'prefab', diagnostics, sourcePath)
    }
    const overrides = asArray(modification.m_Modifications).map((value) => {
      const entry = asRecord(value)
      const objectReference = readReference(entry.objectReference)
      return {
        targetFileId: readReference(entry.target).fileId,
        targetReference: readReference(entry.target),
        propertyPath: asString(entry.propertyPath),
        value: asString(entry.value),
        ...(objectReference.fileId !== '0' || objectReference.guid ? { objectReference } : {})
      }
    })
    instances.push({
      id: `prefab-instance:${object.fileId}`,
      sourcePrefabResourceId,
      parentTransformFileId: readReference(modification.m_TransformParent).fileId,
      overrides,
      removedComponentFileIds: asArray(object.data.m_RemovedComponents).map((value) => readReference(value).fileId),
      removedGameObjectFileIds: asArray(object.data.m_RemovedGameObjects).map((value) => readReference(value).fileId),
      removedComponentReferences: asArray(object.data.m_RemovedComponents).map(readReference),
      removedGameObjectReferences: asArray(object.data.m_RemovedGameObjects).map(readReference)
    })
  }
  return instances
}

async function expandNestedPrefabs(
  instances: NestedPrefabInstance[],
  nodes: UINode[],
  gameObjectByTransform: Map<string, string>,
  resources: Record<string, UIResource>,
  diagnostics: UIDiagnostic[],
  assetIndex: UnityAssetIndex,
  options: ConvertPrefabOptions,
  ancestors: Set<string>,
  depth: number,
  sourceGuid: string | null,
  sourcePath: string,
  sourceObjects: UnityYamlObject[]
): Promise<void> {
  const strippedAliases = collectStrippedAliases(sourceObjects, sourceGuid)
  for (const instance of instances) {
    const prefabResource = instance.sourcePrefabResourceId ? resources[instance.sourcePrefabResourceId] : undefined
    if (!prefabResource?.sourcePath) {
      diagnostics.push({
        severity: 'warning', code: 'NESTED_PREFAB_SOURCE_MISSING',
        message: 'Nested Prefab source could not be resolved and the instance remains metadata-only.',
        details: { instanceId: instance.id, resourceId: instance.sourcePrefabResourceId }
      })
      continue
    }
    if (ancestors.has(path.resolve(prefabResource.sourcePath))) {
      diagnostics.push({
        severity: 'error', code: 'NESTED_PREFAB_CYCLE', message: 'Nested Prefab cycle detected and expansion stopped.',
        sourcePath: prefabResource.sourcePath, details: { instanceId: instance.id }
      })
      continue
    }
    try {
      const nested = await convertUnityPrefabInternal(prefabResource.sourcePath, assetIndex, options, ancestors, depth)
      Object.assign(resources, nested.resources)
      diagnostics.push(...nested.diagnostics)
      const idMap = new Map(nested.nodes.map((node) => [node.id, `${instance.id}/${node.id}`]))
      const parentGameObjectId = gameObjectByTransform.get(instance.parentTransformFileId)
      const parentNodeId = parentGameObjectId ? nodeIdFor(parentGameObjectId) : null
      let clones = nested.nodes.map((node): UINode => ({
        ...structuredClone(node),
        id: idMap.get(node.id)!,
        parentId: node.parentId ? idMap.get(node.parentId) ?? parentNodeId : parentNodeId,
        components: node.components.map((component) => ({ ...structuredClone(component), id: `${instance.id}/${component.id}` }))
      }))
      const instanceAliases = strippedAliases.get(instance.id) ?? []
      attachStrippedAliases(clones, instanceAliases)
      await attachAddedComponents(clones, instanceAliases, sourceObjects, sourceGuid, sourcePath, resources, diagnostics, assetIndex)
      const removedComponents = instance.removedComponentReferences ?? instance.removedComponentFileIds.map((fileId) => ({ fileId }))
      for (const clone of clones) clone.components = clone.components.filter((component) => !removedComponents.some((reference) => matchesReference(component.sourceReferences, reference)))
      const removedGameObjects = instance.removedGameObjectReferences ?? instance.removedGameObjectFileIds.map((fileId) => ({ fileId }))
      const removedNodes = new Set(clones.filter((clone) => removedGameObjects.some((reference) => matchesReference(clone.sourceReferences, reference))).map((clone) => clone.id))
      let changed = true
      while (changed) {
        changed = false
        for (const clone of clones) {
          if (clone.parentId && removedNodes.has(clone.parentId) && !removedNodes.has(clone.id)) { removedNodes.add(clone.id); changed = true }
        }
      }
      clones = clones.filter((clone) => !removedNodes.has(clone.id))
      for (const override of instance.overrides) await applyPrefabOverride(clones, override, resources, assetIndex, diagnostics, prefabResource.sourcePath)
      nodes.push(...clones)
      diagnostics.push({
        severity: 'info', code: 'NESTED_PREFAB_EXPANDED',
        message: `Expanded nested Prefab ${path.basename(prefabResource.sourcePath)} with ${clones.length} nodes.`,
        sourcePath: prefabResource.sourcePath,
        details: { instanceId: instance.id, overrideCount: instance.overrides.length }
      })
    } catch (error) {
      diagnostics.push({
        severity: 'error', code: 'NESTED_PREFAB_EXPANSION_FAILED',
        message: error instanceof Error ? error.message : 'Nested Prefab expansion failed.',
        sourcePath: prefabResource.sourcePath,
        details: { instanceId: instance.id }
      })
    }
  }
}

async function applyPrefabOverride(nodes: UINode[], override: NestedPrefabInstance['overrides'][number], resources: Record<string, UIResource>, assetIndex: UnityAssetIndex, diagnostics: UIDiagnostic[], sourcePath: string): Promise<void> {
  const targetReference = override.targetReference ?? { fileId: override.targetFileId }
  const node = nodes.find((entry) => matchesReference(entry.sourceReferences, targetReference))
  const component = nodes.flatMap((entry) => entry.components.map((value) => ({ node: entry, component: value }))).find((entry) => matchesReference(entry.component.sourceReferences, targetReference))
  const targetFound = Boolean(node || component)
  const value = parseOverrideValue(override.value)
  let applied = false
  if (node) {
    if (override.propertyPath === 'm_Name') { node.name = String(value); applied = true }
    else if (override.propertyPath === 'm_IsActive') { node.active = Boolean(value); applied = true }
    else if (override.propertyPath === 'm_RootOrder') { node.order = Number(value); applied = Number.isFinite(node.order) }
    else applied = setRectOverride(node.rect, override.propertyPath, value)
    if (applied) node.rect.offsets = deriveOffsets(node.rect)
  }
  if (!applied && component) {
    const target = component.component
    if (override.propertyPath === 'm_Enabled') { target.enabled = Boolean(value); applied = true }
    if ((target.type === 'text' || target.type === 'text-mesh-pro') && override.propertyPath === 'm_Text') { target.text = String(value); applied = true }
    if ((target.type === 'text' || target.type === 'text-mesh-pro') && override.propertyPath === 'm_FontData.m_FontSize') { target.fontSize = Number(value); applied = true }
    if ((target.type === 'text' || target.type === 'text-mesh-pro') && override.propertyPath === 'm_FontData.m_HorizontalOverflow') { target.horizontalOverflow = Number(value); applied = true }
    if ((target.type === 'text' || target.type === 'text-mesh-pro') && override.propertyPath === 'm_FontData.m_Font') {
      if (override.objectReference) {
        const id = resourceId(override.objectReference)
        resources[id] ??= await assetIndex.resolve(override.objectReference, 'font', diagnostics, sourcePath)
        target.resourceId = id
      } else target.resourceId = null
      applied = true
    }
    if ((target.type === 'image' || target.type === 'raw-image') && override.propertyPath === 'm_FillAmount') { target.fillAmount = Number(value); applied = true }
    if ('color' in target && override.propertyPath.startsWith('m_Color.')) {
      const channel = override.propertyPath.slice('m_Color.'.length) as keyof typeof target.color
      if (channel in target.color) { target.color[channel] = Number(value); applied = true }
    }
    if ((target.type === 'image' || target.type === 'raw-image') && override.propertyPath === 'm_Sprite' && override.objectReference) {
      const id = resourceId(override.objectReference)
      resources[id] ??= await assetIndex.resolve(override.objectReference, 'sprite', diagnostics, sourcePath)
      target.resourceId = id
      applied = true
    }
    if ('properties' in target && override.propertyPath === 'm_TargetGraphic' && override.objectReference && 'targetGraphic' in target.properties) {
      target.properties.targetGraphic = override.objectReference
      applied = true
    }
    if (target.type === 'canvas' && override.propertyPath === 'm_AdditionalShaderChannelsFlag') {
      target.properties.additionalShaderChannels = Number(value)
      applied = true
    }
    if (target.type === 'unknown' && target.properties.textEffect) {
      const effect = target.properties.textEffect as UITextEffect
      const renderedEffect = component.node.components
        .find((entry): entry is UITextComponent => entry.type === 'text' || entry.type === 'text-mesh-pro')
        ?.effects.find((entry) => entry.type === effect.type)
      if (effect.type === 'outline' && override.propertyPath.startsWith('m_OutlineColor.')) {
        const channel = override.propertyPath.slice('m_OutlineColor.'.length) as keyof typeof effect.color
        if (channel in effect.color) {
          effect.color[channel] = Number(value)
          if (renderedEffect) renderedEffect.color[channel] = Number(value)
          applied = true
        }
      }
      if (effect.type === 'outline' && override.propertyPath === 'm_OutlineWidth') {
        effect.distance = { x: Number(value), y: Number(value) }
        if (renderedEffect) renderedEffect.distance = { ...effect.distance }
        applied = true
      }
    }
  }
  if (!targetFound && override.propertyPath) {
    diagnostics.push({
      severity: 'info', code: 'PREFAB_OVERRIDE_TARGET_MISSING',
      message: `Nested Prefab override ${override.propertyPath} targets an object that is no longer present in the source Prefab.`,
      sourcePath, propertyPath: override.propertyPath,
      details: { targetFileId: override.targetFileId, targetGuid: override.targetReference?.guid, value: override.value }
    })
  } else if (!applied && override.propertyPath) {
    diagnostics.push({
      severity: 'warning', code: 'PREFAB_OVERRIDE_UNSUPPORTED',
      message: `Nested Prefab override ${override.propertyPath} could not be applied and remains in metadata.`,
      sourcePath, propertyPath: override.propertyPath,
      details: { targetFileId: override.targetFileId, targetGuid: override.targetReference?.guid, value: override.value }
    })
  }
}

function setRectOverride(rect: RectTransformData, propertyPath: string, value: unknown): boolean {
  const fields: Record<string, keyof RectTransformData> = {
    m_AnchoredPosition: 'anchoredPosition', m_SizeDelta: 'sizeDelta', m_AnchorMin: 'anchorMin', m_AnchorMax: 'anchorMax',
    m_Pivot: 'pivot', m_LocalPosition: 'localPosition', m_LocalRotation: 'localRotation', m_LocalScale: 'localScale', m_LocalEulerAnglesHint: 'localEulerAngles'
  }
  const match = propertyPath.match(/^(m_[^.]+)\.([xyzw])$/)
  if (!match) return false
  const field = fields[match[1]!]
  if (!field) return false
  const target = rect[field] as unknown as Record<string, number>
  if (!(match[2]! in target)) return false
  target[match[2]!] = Number(value)
  return Number.isFinite(target[match[2]!])
}

function parseOverrideValue(value: string): unknown {
  if (value === '0') return 0
  if (value === '1') return 1
  const number = Number(value)
  return value.trim() !== '' && Number.isFinite(number) ? number : value
}

function attachTextEffects(components: UIComponent[]): void {
  const text = components.find((component): component is UITextComponent => component.type === 'text' || component.type === 'text-mesh-pro')
  if (!text) return
  for (const component of components) {
    if (component.type !== 'unknown') continue
    const effect = component.properties.textEffect as UITextEffect | undefined
    if (effect) text.effects.push(effect)
  }
}

function isTextEffect(data: Record<string, unknown>): boolean {
  return ('m_EffectColor' in data && 'm_EffectDistance' in data) || ('m_OutlineColor' in data && 'm_OutlineWidth' in data)
}

function readTextEffect(data: Record<string, unknown>): UITextEffect {
  if ('m_OutlineColor' in data) {
    const width = asNumber(data.m_OutlineWidth, 1)
    return { type: 'outline', color: readColor(data.m_OutlineColor), distance: { x: width, y: width } }
  }
  return { type: 'shadow', color: readColor(data.m_EffectColor), distance: readVec2(data.m_EffectDistance, { x: 1, y: -1 }) }
}

function readCanvasSettings(nodes: UINode[], fallback: { x: number; y: number }): CanvasSettings {
  const scaler = nodes.flatMap((node) => node.components).find((component) => component.type === 'canvas-scaler') as UIControlComponent | undefined
  const canvas = nodes.flatMap((node) => node.components).find((component) => component.type === 'canvas') as UIControlComponent | undefined
  const referenceResolution = scaler ? readVec2(scaler.properties.m_ReferenceResolution, fallback) : fallback
  return {
    referenceResolution,
    scaleMode: scaler ? asNumber(scaler.properties.m_UiScaleMode, 1) : 1,
    screenMatchMode: scaler ? asNumber(scaler.properties.m_ScreenMatchMode) : 0,
    matchWidthOrHeight: scaler ? asNumber(scaler.properties.m_MatchWidthOrHeight, 0.5) : 0.5,
    referencePixelsPerUnit: scaler ? asNumber(scaler.properties.m_ReferencePixelsPerUnit, 100) : 100,
    sortingOrder: canvas ? asNumber(canvas.properties.sortingOrder) : 0
  }
}

function selectableProperties(data: Record<string, unknown>): Record<string, unknown> {
  return {
    ...pick(data, ['m_Interactable', 'm_Transition', 'm_Colors', 'm_SpriteState', 'm_AnimationTriggers']),
    targetGraphic: readReference(data.m_TargetGraphic),
    navigation: data.m_Navigation
  }
}

function layoutProperties(data: Record<string, unknown>): Record<string, unknown> {
  return pick(data, ['m_Padding', 'm_ChildAlignment', 'm_Spacing', 'm_ChildForceExpandWidth', 'm_ChildForceExpandHeight', 'm_ChildControlWidth', 'm_ChildControlHeight', 'm_ChildScaleWidth', 'm_ChildScaleHeight', 'm_ReverseArrangement', 'm_CellSize', 'm_StartCorner', 'm_StartAxis', 'm_Constraint', 'm_ConstraintCount'])
}

function inferLinearLayout(data: Record<string, unknown>): 'horizontal-layout-group' | 'vertical-layout-group' {
  const script = readReference(data.m_Script)
  if (script.guid === UGUI_SCRIPT_GUIDS.verticalLayoutGroup) return 'vertical-layout-group'
  return 'horizontal-layout-group'
}

const UGUI_SCRIPT_GUIDS = {
  horizontalLayoutGroup: '30649d3a9faa99c48a7b1166b86bf2a0',
  verticalLayoutGroup: '59f8146938fff824cb5fd77236b75775',
  gridLayoutGroup: '8a8695521f0d02e499659fee002a26c2',
  contentSizeFitter: '3245ec927659c4140ac4f8d17403cc18',
  aspectRatioFitter: '86710e43de46f6f4bac7c8e50813a599',
  layoutElement: '306cc8c2b49d7114eaa3623786fc2126'
} as const

interface StrippedAlias {
  source: UIObjectReference
  alias: UIObjectReference
}

function collectStrippedAliases(objects: UnityYamlObject[], sourceGuid: string | null): Map<string, StrippedAlias[]> {
  const aliases = new Map<string, StrippedAlias[]>()
  for (const object of objects) {
    if (!object.stripped) continue
    const prefabInstance = readReference(object.data.m_PrefabInstance)
    const source = readReference(object.data.m_CorrespondingSourceObject)
    if (prefabInstance.fileId === '0' || source.fileId === '0') continue
    const instanceId = `prefab-instance:${prefabInstance.fileId}`
    const values = aliases.get(instanceId) ?? []
    values.push({ source, alias: sourceReference(sourceGuid, object.fileId) })
    aliases.set(instanceId, values)
  }
  return aliases
}

function attachStrippedAliases(nodes: UINode[], aliases: StrippedAlias[]): void {
  for (const alias of aliases) {
    const node = nodes.find((entry) => matchesReference(entry.sourceReferences, alias.source))
    if (node) {
      node.sourceReferences = mergeReferences(node.sourceReferences, alias.alias)
      continue
    }
    const component = nodes.flatMap((entry) => entry.components).find((entry) => matchesReference(entry.sourceReferences, alias.source))
    if (component) component.sourceReferences = mergeReferences(component.sourceReferences, alias.alias)
  }
}

async function attachAddedComponents(
  nodes: UINode[],
  aliases: StrippedAlias[],
  sourceObjects: UnityYamlObject[],
  sourceGuid: string | null,
  sourcePath: string,
  resources: Record<string, UIResource>,
  diagnostics: UIDiagnostic[],
  assetIndex: UnityAssetIndex
): Promise<void> {
  const gameObjectAliases = new Map(aliases.map((alias) => [alias.alias.fileId, alias]))
  for (const object of sourceObjects) {
    if (object.stripped || object.typeName === 'RectTransform' || object.typeName === 'CanvasRenderer') continue
    const gameObjectReference = readReference(object.data.m_GameObject)
    const alias = gameObjectAliases.get(gameObjectReference.fileId)
    if (!alias) continue
    const node = nodes.find((entry) => matchesReference(entry.sourceReferences, alias.source))
    if (!node || node.components.some((component) => component.sourceFileId === object.fileId)) continue
    const component = await convertComponent(object, {
      nodeId: node.id,
      sourcePath,
      sourceGuid,
      resources,
      diagnostics,
      assetIndex
    })
    if (component) node.components.push(component)
  }
  for (const node of nodes) attachTextEffects(node.components)
}

function sourceReference(guid: string | null, fileId: string): UIObjectReference {
  return { fileId, ...(guid ? { guid } : {}) }
}

function compactReferences(values: Array<UIObjectReference | null>): UIObjectReference[] {
  return values.filter((value): value is UIObjectReference => value !== null)
}

function mergeReferences(references: UIObjectReference[] | undefined, reference: UIObjectReference): UIObjectReference[] {
  return matchesReference(references, reference) ? references ?? [] : [...(references ?? []), reference]
}

function matchesReference(references: UIObjectReference[] | undefined, target: UIObjectReference): boolean {
  return (references ?? []).some((reference) => reference.fileId === target.fileId && (!target.guid || reference.guid === target.guid))
}

function legacyHorizontalAlignment(value: number): UITextComponent['horizontalAlignment'] {
  return value % 3 === 1 ? 'center' : value % 3 === 2 ? 'right' : 'left'
}

function legacyVerticalAlignment(value: number): UITextComponent['verticalAlignment'] {
  return Math.floor(value / 3) === 1 ? 'middle' : Math.floor(value / 3) === 2 ? 'bottom' : 'top'
}

function tmpHorizontalAlignment(value: number): UITextComponent['horizontalAlignment'] {
  if (value & 32) return 'geometry'
  if (value & 16) return 'flush'
  if (value & 8) return 'justified'
  if (value & 4) return 'right'
  if (value & 2) return 'center'
  return 'left'
}

function tmpVerticalAlignment(value: number): UITextComponent['verticalAlignment'] {
  if (value & 8192) return 'capline'
  if (value & 4096) return 'midline'
  if (value & 2048) return 'baseline'
  if (value & 1024) return 'bottom'
  if (value & 512) return 'middle'
  return 'top'
}

function control(base: { id: string; sourceFileId: string; enabled: boolean }, type: UIControlComponent['type'], properties: Record<string, unknown>): UIControlComponent {
  return { ...base, type, properties }
}

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key]]))
}

function nodeIdFor(fileId: string): string {
  return `unity-node:${fileId}`
}

function componentIdFor(nodeId: string, fileId: string): string {
  return `${nodeId}:component:${fileId}`
}

function sortHierarchy(nodes: UINode[]): UINode[] {
  const children = new Map<string | null, UINode[]>()
  for (const node of nodes) {
    const entries = children.get(node.parentId) ?? []
    entries.push(node)
    children.set(node.parentId, entries)
  }
  for (const entries of children.values()) entries.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
  const ordered: UINode[] = []
  const visit = (parentId: string | null): void => {
    for (const node of children.get(parentId) ?? []) {
      ordered.push(node)
      visit(node.id)
    }
  }
  visit(null)
  for (const node of nodes) if (!ordered.includes(node)) ordered.push(node)
  return ordered
}

async function readPrefabGuid(prefabPath: string): Promise<string | null> {
  try {
    const source = await readFile(`${prefabPath}.meta`, 'utf8')
    return source.match(/^guid:\s*([0-9a-f]{32})\s*$/m)?.[1] ?? null
  } catch {
    return null
  }
}
