import {
  CURRENT_PREFAB_VERSION,
  PREFAB_FORMAT,
  createPrefabOverrideKey,
  parsePrefabOverrideKey,
  prefabSchema,
  validatePrefabOverrides,
  type AuthoringValidationIssue,
  type PrefabDocument,
  type PrefabInstance,
  type SceneDocument,
  type SceneObject,
  type ScenePrefabInstance
} from '@phaser-editor/contracts'

export interface PrefabPlacement {
  x: number
  y: number
  parentId?: string | null
  order?: number
}

export interface PrefabResolution {
  objects: SceneObject[]
  diagnostics: AuthoringValidationIssue[]
  metadata: ScenePrefabInstance
}

export function createPrefabFromScene(document: SceneDocument, rootId: string): PrefabDocument {
  const root = document.objects.find((object) => object.id === rootId)
  if (!root) throw new Error('Select a valid scene object to create a prefab.')
  const ids = collectSubtreeIds(document.objects, rootId)
  const objects = document.objects.filter((object) => ids.has(object.id)).map((object) => {
    const clone = structuredClone(object)
    delete clone.prefabInstance
    if (clone.id === rootId) {
      clone.parentId = null
      clone.order = 0
      clone.transform = { ...clone.transform, x: 0, y: 0 }
    }
    return clone
  })
  const prefab = {
    format: PREFAB_FORMAT,
    version: CURRENT_PREFAB_VERSION,
    rootObjectId: rootId,
    objects,
    exposedProperties: [
      { id: crypto.randomUUID(), name: 'Position X', objectId: rootId, componentId: null, propertyPath: ['transform', 'x'] },
      { id: crypto.randomUUID(), name: 'Position Y', objectId: rootId, componentId: null, propertyPath: ['transform', 'y'] }
    ]
  }
  return prefabSchema.parse(prefab)
}

export function instantiatePrefab(prefabPath: string, prefab: PrefabDocument, placement: PrefabPlacement, overrides: Record<string, unknown> = {}): PrefabResolution {
  const metadata: ScenePrefabInstance = {
    prefabPath,
    instanceId: crypto.randomUUID(),
    objectMap: Object.fromEntries(prefab.objects.map((object) => [object.id, crypto.randomUUID()])),
    componentMap: Object.fromEntries(prefab.objects.flatMap((object) => object.components.map((component) => [component.id, crypto.randomUUID()]))),
    overrides: structuredClone(overrides)
  }
  return resolvePrefabInstance(prefab, metadata, placement)
}

export function refreshPrefabInstance(document: SceneDocument, rootId: string, prefab: PrefabDocument): { document: SceneDocument; diagnostics: AuthoringValidationIssue[] } {
  const currentRoot = document.objects.find((object) => object.id === rootId)
  const metadata = currentRoot?.prefabInstance
  if (!currentRoot || !metadata) throw new Error('The selected object is not a prefab instance root.')

  const objectMap = { ...metadata.objectMap }
  const componentMap = { ...metadata.componentMap }
  prefab.objects.forEach((object) => {
    objectMap[object.id] ??= crypto.randomUUID()
    object.components.forEach((component) => { componentMap[component.id] ??= crypto.randomUUID() })
  })
  const nextMetadata = { ...metadata, objectMap, componentMap }
  const resolution = resolvePrefabInstance(prefab, nextMetadata, {
    x: currentRoot.transform.x,
    y: currentRoot.transform.y,
    parentId: currentRoot.parentId,
    order: currentRoot.order
  })
  const priorIds = new Set(Object.values(metadata.objectMap))
  const insertionIndex = document.objects.findIndex((object) => object.id === rootId)
  const remaining = document.objects.filter((object) => !priorIds.has(object.id))
  remaining.splice(Math.max(0, insertionIndex), 0, ...resolution.objects)
  return { document: { ...document, objects: remaining }, diagnostics: resolution.diagnostics }
}

export function resolvePrefabInstance(prefab: PrefabDocument, metadata: ScenePrefabInstance, placement: PrefabPlacement): PrefabResolution {
  const instance: PrefabInstance = { prefabPath: metadata.prefabPath, instanceId: metadata.instanceId, overrides: metadata.overrides }
  const diagnostics = validatePrefabOverrides(prefab, instance)
  const sourceObjects = prefab.objects.map((object) => structuredClone(object))
  applyValidOverrides(sourceObjects, metadata.overrides)

  const objects = sourceObjects.map((source) => {
    const object = structuredClone(source)
    object.id = metadata.objectMap[source.id] ?? crypto.randomUUID()
    object.parentId = source.parentId ? metadata.objectMap[source.parentId] ?? null : null
    object.components = source.components.map((component) => ({ ...component, id: metadata.componentMap[component.id] ?? crypto.randomUUID(), data: structuredClone(component.data) }))
    delete object.prefabInstance
    if (source.id === prefab.rootObjectId) {
      object.parentId = placement.parentId ?? null
      object.order = placement.order ?? 0
      object.transform = { ...object.transform, x: placement.x, y: placement.y }
      object.prefabInstance = structuredClone(metadata)
    }
    return object
  })
  const root = objects.find((object) => object.prefabInstance)
  if (!root) throw new Error('Prefab root could not be instantiated.')
  metadata.objectMap = Object.fromEntries(prefab.objects.map((source) => [source.id, objects.find((object) => object.id === metadata.objectMap[source.id])?.id ?? metadata.objectMap[source.id]!]))
  return { objects, diagnostics, metadata }
}

export function setPrefabOverride(document: SceneDocument, sceneObjectId: string, componentId: string | null, propertyPath: Array<string | number>, value: unknown): SceneDocument {
  const root = document.objects.find((object) => object.prefabInstance && Object.values(object.prefabInstance.objectMap).includes(sceneObjectId))
  if (!root?.prefabInstance) return document
  const sourceObjectId = Object.entries(root.prefabInstance.objectMap).find(([, instanceId]) => instanceId === sceneObjectId)?.[0]
  if (!sourceObjectId) return document
  const sourceComponentId = componentId
    ? Object.entries(root.prefabInstance.componentMap).find(([, instanceId]) => instanceId === componentId)?.[0] ?? null
    : null
  const key = createPrefabOverrideKey(sourceObjectId, sourceComponentId, propertyPath)
  const replacement: SceneObject = {
    ...root,
    prefabInstance: {
      ...root.prefabInstance,
      overrides: { ...root.prefabInstance.overrides, [key]: structuredClone(value) }
    }
  }
  return { ...document, objects: document.objects.map((object) => object.id === root.id ? replacement : object) }
}

export function removePrefabOverride(document: SceneDocument, rootId: string, key: string): SceneDocument {
  return {
    ...document,
    objects: document.objects.map((object) => {
      if (object.id !== rootId || !object.prefabInstance) return object
      const overrides = { ...object.prefabInstance.overrides }
      delete overrides[key]
      return { ...object, prefabInstance: { ...object.prefabInstance, overrides } }
    })
  }
}

export function descriptorPropertyPath(descriptorId: string): Array<string | number> {
  const aliases: Record<string, Array<string | number>> = {
    x: ['transform', 'x'],
    y: ['transform', 'y'],
    rotation: ['transform', 'rotation'],
    scaleX: ['transform', 'scaleX'],
    scaleY: ['transform', 'scaleY'],
    originX: ['transform', 'originX'],
    originY: ['transform', 'originY']
  }
  return aliases[descriptorId] ?? descriptorId.split('.')
}

function applyValidOverrides(objects: SceneObject[], overrides: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(overrides)) {
    const target = parsePrefabOverrideKey(key)
    if (!target) continue
    const object = objects.find((candidate) => candidate.id === target.objectId)
    if (!object) continue
    const root: unknown = target.componentId
      ? object.components.find((component) => component.id === target.componentId)?.data
      : object
    if (root !== undefined) setExistingProperty(root, target.propertyPath, value)
  }
}

function setExistingProperty(root: unknown, path: Array<string | number>, value: unknown): boolean {
  if (path.length === 0) return false
  let current = root
  for (const segment of path.slice(0, -1)) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || segment >= current.length) return false
      current = current[segment]
    } else {
      if (!current || typeof current !== 'object' || !(segment in current)) return false
      current = (current as Record<string, unknown>)[segment]
    }
  }
  const final = path.at(-1)!
  if (typeof final === 'number') {
    if (!Array.isArray(current) || final >= current.length) return false
    current[final] = structuredClone(value)
    return true
  }
  if (!current || typeof current !== 'object' || !(final in current)) return false
  ;(current as Record<string, unknown>)[final] = structuredClone(value)
  return true
}

function collectSubtreeIds(objects: SceneObject[], rootId: string): Set<string> {
  const ids = new Set([rootId])
  let changed = true
  while (changed) {
    changed = false
    objects.forEach((object) => {
      if (object.parentId && ids.has(object.parentId) && !ids.has(object.id)) { ids.add(object.id); changed = true }
    })
  }
  return ids
}
