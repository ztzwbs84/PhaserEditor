import { create } from 'zustand'
import {
  parseSceneDocument,
  serializeSceneDocument,
  type SceneDocument,
  type SceneParseResult,
  type SceneTransform
} from '@phaser-editor/contracts'
import { useEditorStore } from './editor-store'
import { groupSceneCommands, transformObjectsCommand, type SceneCommand } from './scene-commands'

export type SceneTool = 'select' | 'move' | 'rotate' | 'scale' | 'pan'

export interface SceneHistory {
  entries: SceneCommand[]
  cursor: number
  savePoint: number
}

interface SceneRecordBase {
  path: string
  selection: string[]
  tool: SceneTool
  sourceContent: string
}

export interface EditableSceneRecord extends SceneRecordBase {
  status: 'editable'
  document: SceneDocument
  history: SceneHistory
  gesture: SceneTransformGesture | null
  migratedFrom?: number
}

export interface ReadonlySceneRecord extends SceneRecordBase {
  status: 'readonly'
  raw: string
  version: number
  message: string
}

export type SceneRecord = EditableSceneRecord | ReadonlySceneRecord

interface SceneTransformGesture {
  title: string
  before: Record<string, SceneTransform>
}

interface SceneState {
  scenes: Record<string, SceneRecord>
  activePath: string | null
  load(path: string, source: string): SceneRecord
  activate(path: string | null): void
  close(path: string): void
  select(path: string, ids: string[], mode?: 'replace' | 'toggle' | 'add'): void
  setTool(path: string, tool: SceneTool): void
  execute(path: string, command: SceneCommand): boolean
  executeGroup(path: string, title: string, commands: SceneCommand[]): boolean
  undo(path?: string): boolean
  redo(path?: string): boolean
  markSaved(path: string): void
  beginTransformGesture(path: string, objectIds: string[], title: string): boolean
  previewTransforms(path: string, transforms: Record<string, SceneTransform>): void
  commitTransformGesture(path: string): boolean
  cancelTransformGesture(path: string): void
}

export const useSceneStore = create<SceneState>((set, get) => ({
  scenes: {},
  activePath: null,

  load(path, source) {
    const existing = get().scenes[path]
    if (existing?.sourceContent === source) {
      set({ activePath: path })
      return existing
    }
    const parsed = parseSceneDocument(source)
    const record = recordFromParse(path, source, parsed)
    set((state) => ({ scenes: { ...state.scenes, [path]: record }, activePath: path }))
    syncEditorDocument(record)
    return record
  },

  activate(path) { set({ activePath: path }) },

  close(path) {
    set((state) => {
      const scenes = { ...state.scenes }
      delete scenes[path]
      return { scenes, activePath: state.activePath === path ? null : state.activePath }
    })
  },

  select(path, ids, mode = 'replace') {
    set((state) => {
      const scene = state.scenes[path]
      if (!scene) return state
      const valid = ids.filter((id) => scene.status !== 'editable' || scene.document.objects.some((object) => object.id === id))
      let selection = valid
      if (mode === 'add') selection = [...new Set([...scene.selection, ...valid])]
      if (mode === 'toggle') {
        const next = new Set(scene.selection)
        valid.forEach((id) => next.has(id) ? next.delete(id) : next.add(id))
        selection = [...next]
      }
      return { scenes: { ...state.scenes, [path]: { ...scene, selection } } }
    })
  },

  setTool(path, tool) {
    set((state) => {
      const scene = state.scenes[path]
      return scene ? { scenes: { ...state.scenes, [path]: { ...scene, tool } } } : state
    })
  },

  execute(path, command) {
    const scene = get().scenes[path]
    if (scene?.status !== 'editable') return false
    const document = command.apply(scene.document)
    serializeSceneDocument(document)
    const entries = [...scene.history.entries.slice(0, scene.history.cursor), command]
    const savePoint = scene.history.savePoint > scene.history.cursor ? -1 : scene.history.savePoint
    const next: EditableSceneRecord = {
      ...scene,
      document,
      selection: command.selectionAfter ?? scene.selection,
      history: { entries, cursor: entries.length, savePoint },
      gesture: null
    }
    set((state) => ({ scenes: { ...state.scenes, [path]: next } }))
    syncEditorDocument(next)
    return true
  },

  executeGroup(path, title, commands) {
    if (commands.length === 0) return false
    return get().execute(path, groupSceneCommands(title, commands))
  },

  undo(path) {
    const target = path ?? get().activePath
    if (!target) return false
    const scene = get().scenes[target]
    if (scene?.status !== 'editable' || scene.history.cursor === 0) return false
    const command = scene.history.entries[scene.history.cursor - 1]!
    const next: EditableSceneRecord = {
      ...scene,
      document: command.revert(scene.document),
      selection: command.selectionBefore ?? scene.selection,
      history: { ...scene.history, cursor: scene.history.cursor - 1 },
      gesture: null
    }
    set((state) => ({ scenes: { ...state.scenes, [target]: next } }))
    syncEditorDocument(next)
    return true
  },

  redo(path) {
    const target = path ?? get().activePath
    if (!target) return false
    const scene = get().scenes[target]
    if (scene?.status !== 'editable' || scene.history.cursor >= scene.history.entries.length) return false
    const command = scene.history.entries[scene.history.cursor]!
    const next: EditableSceneRecord = {
      ...scene,
      document: command.apply(scene.document),
      selection: command.selectionAfter ?? scene.selection,
      history: { ...scene.history, cursor: scene.history.cursor + 1 },
      gesture: null
    }
    set((state) => ({ scenes: { ...state.scenes, [target]: next } }))
    syncEditorDocument(next)
    return true
  },

  markSaved(path) {
    const scene = get().scenes[path]
    if (scene?.status !== 'editable') return
    const next: EditableSceneRecord = {
      ...scene,
      sourceContent: serializeSceneDocument(scene.document),
      history: { ...scene.history, savePoint: scene.history.cursor }
    }
    set((state) => ({ scenes: { ...state.scenes, [path]: next } }))
    syncEditorDocument(next)
  },

  beginTransformGesture(path, objectIds, title) {
    const scene = get().scenes[path]
    if (scene?.status !== 'editable' || scene.gesture) return false
    const ids = new Set(objectIds)
    const before = Object.fromEntries(scene.document.objects
      .filter((object) => ids.has(object.id))
      .map((object) => [object.id, structuredClone(object.transform)]))
    if (Object.keys(before).length === 0) return false
    set((state) => ({ scenes: { ...state.scenes, [path]: { ...scene, gesture: { title, before } } } }))
    return true
  },

  previewTransforms(path, transforms) {
    const scene = get().scenes[path]
    if (scene?.status !== 'editable' || !scene.gesture) return
    const document = {
      ...scene.document,
      objects: scene.document.objects.map((object) => transforms[object.id]
        ? { ...object, transform: structuredClone(transforms[object.id]!) }
        : object)
    }
    set((state) => ({ scenes: { ...state.scenes, [path]: { ...scene, document } } }))
  },

  commitTransformGesture(path) {
    const scene = get().scenes[path]
    if (scene?.status !== 'editable' || !scene.gesture) return false
    const ids = new Set(Object.keys(scene.gesture.before))
    const after = Object.fromEntries(scene.document.objects
      .filter((object) => ids.has(object.id))
      .map((object) => [object.id, structuredClone(object.transform)]))
    const beforeDocument = {
      ...scene.document,
      objects: scene.document.objects.map((object) => scene.gesture!.before[object.id]
        ? { ...object, transform: structuredClone(scene.gesture!.before[object.id]!) }
        : object)
    }
    set((state) => ({ scenes: { ...state.scenes, [path]: { ...scene, document: beforeDocument, gesture: null } } }))
    if (JSON.stringify(scene.gesture.before) === JSON.stringify(after)) return false
    return get().execute(path, transformObjectsCommand(scene.gesture.before, after, scene.selection, scene.gesture.title))
  },

  cancelTransformGesture(path) {
    const scene = get().scenes[path]
    if (scene?.status !== 'editable' || !scene.gesture) return
    const document = {
      ...scene.document,
      objects: scene.document.objects.map((object) => scene.gesture!.before[object.id]
        ? { ...object, transform: structuredClone(scene.gesture!.before[object.id]!) }
        : object)
    }
    set((state) => ({ scenes: { ...state.scenes, [path]: { ...scene, document, gesture: null } } }))
  }
}))

function recordFromParse(path: string, source: string, parsed: SceneParseResult): SceneRecord {
  if (parsed.status === 'readonly') {
    return {
      path,
      status: 'readonly',
      raw: parsed.raw,
      version: parsed.version,
      message: parsed.message,
      sourceContent: source,
      selection: [],
      tool: 'select'
    }
  }
  return {
    path,
    status: 'editable',
    document: parsed.document,
    sourceContent: source,
    selection: [],
    tool: 'select',
    history: { entries: [], cursor: 0, savePoint: parsed.migratedFrom ? -1 : 0 },
    gesture: null,
    migratedFrom: parsed.migratedFrom
  }
}

function syncEditorDocument(scene: SceneRecord): void {
  const editorDocument = useEditorStore.getState().documents[scene.path]
  if (!editorDocument) return
  if (scene.status === 'readonly') {
    useEditorStore.setState((state) => ({ documents: { ...state.documents, [scene.path]: { ...state.documents[scene.path]!, readOnly: true, dirty: false } } }))
    return
  }
  const content = serializeSceneDocument(scene.document)
  const dirty = scene.history.cursor !== scene.history.savePoint
  useEditorStore.setState((state) => ({ documents: { ...state.documents, [scene.path]: { ...state.documents[scene.path]!, content, dirty, readOnly: false } } }))
}
