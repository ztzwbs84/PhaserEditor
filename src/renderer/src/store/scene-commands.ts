import type { SceneDocument, SceneObject, SceneTransform } from '@phaser-editor/contracts'

export interface SceneCommand {
  id: string
  title: string
  selectionBefore?: string[]
  selectionAfter?: string[]
  apply(document: SceneDocument): SceneDocument
  revert(document: SceneDocument): SceneDocument
}

export function groupSceneCommands(title: string, commands: SceneCommand[]): SceneCommand {
  return {
    id: crypto.randomUUID(),
    title,
    selectionBefore: commands[0]?.selectionBefore,
    selectionAfter: commands.at(-1)?.selectionAfter,
    apply: (document) => commands.reduce((current, command) => command.apply(current), document),
    revert: (document) => [...commands].reverse().reduce((current, command) => command.revert(current), document)
  }
}

export function createObjectsCommand(document: SceneDocument, objects: SceneObject[], title = 'Create object', selectionBefore: string[] = []): SceneCommand {
  const created = structuredClone(objects)
  const ids = new Set(created.map((object) => object.id))
  return {
    id: crypto.randomUUID(),
    title,
    selectionBefore,
    selectionAfter: created.map((object) => object.id),
    apply: (current) => ({ ...current, objects: [...current.objects, ...structuredClone(created)] }),
    revert: (current) => ({ ...current, objects: current.objects.filter((object) => !ids.has(object.id)) })
  }
}

export function deleteObjectsCommand(document: SceneDocument, objectIds: string[], selectionBefore: string[]): SceneCommand {
  const ids = collectDescendantIds(document, objectIds)
  const removed = document.objects.flatMap((object, index) => ids.has(object.id) ? [{ index, object: structuredClone(object) }] : [])
  return {
    id: crypto.randomUUID(),
    title: removed.length === 1 ? 'Delete object' : `Delete ${removed.length} objects`,
    selectionBefore,
    selectionAfter: selectionBefore.filter((id) => !ids.has(id)),
    apply: (current) => ({ ...current, objects: current.objects.filter((object) => !ids.has(object.id)) }),
    revert: (current) => {
      const objects = [...current.objects]
      for (const entry of removed) objects.splice(Math.min(entry.index, objects.length), 0, structuredClone(entry.object))
      return { ...current, objects }
    }
  }
}

export function transformObjectsCommand(
  before: Record<string, SceneTransform>,
  after: Record<string, SceneTransform>,
  selection: string[],
  title = 'Transform objects'
): SceneCommand {
  return updateTransformsCommand(before, after, selection, title)
}

export function updateObjectCommand(before: SceneObject, after: SceneObject, selection: string[], title: string): SceneCommand {
  return {
    id: crypto.randomUUID(),
    title,
    selectionBefore: selection,
    selectionAfter: selection,
    apply: (document) => replaceObject(document, after),
    revert: (document) => replaceObject(document, before)
  }
}

export function updateObjectsCommand(before: SceneObject[], after: SceneObject[], selection: string[], title: string): SceneCommand {
  const beforeById = new Map(before.map((object) => [object.id, structuredClone(object)]))
  const afterById = new Map(after.map((object) => [object.id, structuredClone(object)]))
  return {
    id: crypto.randomUUID(),
    title,
    selectionBefore: selection,
    selectionAfter: selection,
    apply: (document) => ({ ...document, objects: document.objects.map((object) => structuredClone(afterById.get(object.id) ?? object)) }),
    revert: (document) => ({ ...document, objects: document.objects.map((object) => structuredClone(beforeById.get(object.id) ?? object)) })
  }
}

export function replaceSceneDocumentCommand(before: SceneDocument, after: SceneDocument, title: string, selectionBefore: string[], selectionAfter = selectionBefore): SceneCommand {
  const prior = structuredClone(before)
  const next = structuredClone(after)
  return {
    id: crypto.randomUUID(),
    title,
    selectionBefore,
    selectionAfter,
    apply: () => structuredClone(next),
    revert: () => structuredClone(prior)
  }
}

export function duplicateObjectsCommand(document: SceneDocument, objectIds: string[], selectionBefore: string[]): SceneCommand {
  const sourceIds = collectDescendantIds(document, objectIds)
  const source = document.objects.filter((object) => sourceIds.has(object.id))
  const idMap = new Map(source.map((object) => [object.id, crypto.randomUUID()]))
  const copies = source.map((object) => {
    const copy = structuredClone(object)
    copy.id = idMap.get(object.id)!
    copy.name = `${object.name} Copy`
    copy.parentId = object.parentId && idMap.has(object.parentId) ? idMap.get(object.parentId)! : object.parentId
    copy.transform = { ...copy.transform, x: copy.transform.x + 16, y: copy.transform.y + 16 }
    return copy
  })
  const command = createObjectsCommand(document, copies, copies.length === 1 ? 'Duplicate object' : `Duplicate ${copies.length} objects`)
  return { ...command, selectionBefore }
}

export function collectDescendantIds(document: SceneDocument, roots: string[]): Set<string> {
  const ids = new Set(roots)
  let changed = true
  while (changed) {
    changed = false
    for (const object of document.objects) {
      if (object.parentId && ids.has(object.parentId) && !ids.has(object.id)) {
        ids.add(object.id)
        changed = true
      }
    }
  }
  return ids
}

function updateTransformsCommand(
  before: Record<string, SceneTransform>,
  after: Record<string, SceneTransform>,
  selection: string[],
  title: string
): SceneCommand {
  return {
    id: crypto.randomUUID(),
    title,
    selectionBefore: selection,
    selectionAfter: selection,
    apply: (document) => applyTransforms(document, after),
    revert: (document) => applyTransforms(document, before)
  }
}

function applyTransforms(document: SceneDocument, transforms: Record<string, SceneTransform>): SceneDocument {
  return {
    ...document,
    objects: document.objects.map((object) => transforms[object.id]
      ? { ...object, transform: structuredClone(transforms[object.id]!) }
      : object)
  }
}

function replaceObject(document: SceneDocument, replacement: SceneObject): SceneDocument {
  return {
    ...document,
    objects: document.objects.map((object) => object.id === replacement.id ? structuredClone(replacement) : object)
  }
}
