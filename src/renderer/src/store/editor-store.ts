import { create } from 'zustand'
import type {
  EditorDocument,
  EditorSettings,
  FileChangeEvent,
  FileEntry,
  LogEntry,
  ProjectCreateRequest,
  ProjectDescriptor,
  RunSession
} from '@phaser-editor/contracts'
import { SceneDocumentError, createSceneDocument, parseSceneDocument, serializeSceneDocument } from '@phaser-editor/contracts'
import { basename, classifyFile, isMediaFile } from '../lib/file-types'

interface Notice {
  id: string
  level: 'info' | 'success' | 'warning' | 'error'
  message: string
}

interface EditorState {
  ready: boolean
  settings: EditorSettings | null
  project: ProjectDescriptor | null
  recentProjects: ProjectDescriptor[]
  documents: Record<string, EditorDocument>
  selectedPath: string | null
  logs: LogEntry[]
  runSession: RunSession
  notices: Notice[]
  quickOpen: boolean
  pluginsOpen: boolean
  initialize(): Promise<void>
  openProject(path?: string): Promise<boolean>
  createProject(request: ProjectCreateRequest): Promise<boolean>
  createScene(parent: string, name: string): Promise<EditorDocument | null>
  closeProject(): Promise<boolean>
  openDocument(path: string): Promise<EditorDocument | null>
  updateDocument(path: string, content: string): void
  saveDocument(path?: string): Promise<boolean>
  reloadDocument(path: string): Promise<boolean>
  overwriteDocument(path: string): Promise<boolean>
  closeDocument(path: string, confirmDirty?: boolean): boolean
  rebaseDocuments(source: string, target: string): void
  handleFileChange(event: FileChangeEvent): Promise<void>
  selectPath(path: string | null): void
  addLog(entry: LogEntry): void
  clearLogs(): void
  setRunSession(session: RunSession): void
  updateSettings(patch: Partial<EditorSettings>): Promise<void>
  notify(level: Notice['level'], message: string): void
  dismissNotice(id: string): void
  setQuickOpen(open: boolean): void
  setPluginsOpen(open: boolean): void
}

export const useEditorStore = create<EditorState>((set, get) => ({
  ready: false,
  settings: null,
  project: null,
  recentProjects: [],
  documents: {},
  selectedPath: null,
  logs: [],
  runSession: { id: 'initial', status: 'idle' },
  notices: [],
  quickOpen: false,
  pluginsOpen: false,

  async initialize() {
    const [settings, recent, run] = await Promise.all([
      window.editorApi.settings.get(),
      window.editorApi.project.listRecent(),
      window.editorApi.runner.getState()
    ])
    set({
      settings: settings.ok ? settings.value : null,
      recentProjects: recent.ok ? recent.value : [],
      runSession: run.ok ? run.value : { id: 'initial', status: 'idle' },
      ready: true
    })
    if (!settings.ok) get().notify('error', settings.error.message)
  },

  async openProject(path) {
    if (!await prepareProjectTransition(get)) return false
    const result = await window.editorApi.project.open(path)
    if (!result.ok) {
      if (result.error.code !== 'CANCELLED') get().notify('error', result.error.message)
      return false
    }
    const recent = await window.editorApi.project.listRecent()
    set({ project: result.value, recentProjects: recent.ok ? recent.value : get().recentProjects, documents: {}, selectedPath: null })
    get().notify('success', `Opened ${result.value.name}`)
    return true
  },

  async createProject(request) {
    if (!await prepareProjectTransition(get)) return false
    get().notify('info', request.installDependencies ? 'Creating project and installing dependencies...' : 'Creating project...')
    const result = await window.editorApi.project.create(request)
    if (!result.ok) {
      get().notify('error', result.error.message)
      return false
    }
    const recent = await window.editorApi.project.listRecent()
    set({ project: result.value, recentProjects: recent.ok ? recent.value : get().recentProjects, documents: {}, selectedPath: null })
    if (result.value.issue) get().notify('warning', result.value.issue)
    get().notify('success', `Created ${result.value.name}`)
    return true
  },

  async createScene(parent, requestedName) {
    const baseName = requestedName.trim().replace(/\.phaser-scene\.json$/i, '')
    if (!baseName) {
      get().notify('error', 'Scene name is required.')
      return null
    }
    const name = `${baseName}.phaser-scene.json`
    const created = await window.editorApi.fileSystem.createFile(parent, name)
    if (!created.ok) {
      get().notify('error', created.error.message)
      return null
    }
    const content = serializeSceneDocument(createSceneDocument(toSceneKey(baseName)))
    const written = await window.editorApi.fileSystem.write(created.value.path, content)
    if (!written.ok) {
      get().notify('error', written.error.message)
      return null
    }
    const document = await get().openDocument(created.value.path)
    if (document) get().notify('success', `Created ${name}`)
    return document
  },

  async closeProject() {
    if (!await prepareProjectTransition(get)) return false
    const result = await window.editorApi.project.close()
    if (!result.ok) {
      get().notify('error', result.error.message)
      return false
    }
    set({ project: null, documents: {}, selectedPath: null })
    return true
  },

  async openDocument(path) {
    const existing = get().documents[path]
    if (existing) {
      set({ selectedPath: path })
      return existing
    }
    if (isMediaFile(path)) {
      const stat = await window.editorApi.fileSystem.stat(path)
      if (!stat.ok) {
        get().notify('error', stat.error.message)
        return null
      }
      const type = classifyFile(path)
      const document: EditorDocument = {
        id: crypto.randomUUID(),
        path,
        name: basename(path),
        kind: type.kind,
        language: type.language,
        content: '',
        savedContent: '',
        modifiedAt: stat.value.modifiedAt,
        dirty: false
      }
      set((state) => ({ documents: { ...state.documents, [path]: document }, selectedPath: path }))
      return document
    }
    const result = await window.editorApi.fileSystem.read(path)
    if (!result.ok) {
      get().notify('error', result.error.message)
      return null
    }
    const type = classifyFile(path, result.value.content)
    let readOnly = false
    if (type.kind === 'scene') {
      try {
        const parsed = parseSceneDocument(result.value.content)
        readOnly = parsed.status === 'readonly'
        if (parsed.status === 'readonly') get().notify('warning', parsed.message)
      } catch (error) {
        get().notify('error', sceneErrorMessage(error))
        return null
      }
    }
    const document: EditorDocument = {
      id: crypto.randomUUID(),
      path,
      name: basename(path),
      kind: type.kind,
      language: type.language,
      content: result.value.content,
      savedContent: result.value.content,
      modifiedAt: result.value.modifiedAt,
      dirty: false,
      readOnly
    }
    set((state) => ({ documents: { ...state.documents, [path]: document }, selectedPath: path }))
    return document
  },

  updateDocument(path, content) {
    set((state) => {
      const document = state.documents[path]
      if (!document || document.readOnly) return state
      return {
        documents: {
          ...state.documents,
          [path]: { ...document, content, dirty: content !== document.savedContent }
        }
      }
    })
  },

  async saveDocument(path) {
    const target = path ?? get().selectedPath
    if (!target) return false
    let document = get().documents[target]
    if (!document || !document.dirty || ['image', 'audio'].includes(document.kind)) return true
    if (document.readOnly || document.missing) {
      get().notify('error', document.missing ? 'This file was deleted. Copy the preserved content before closing the tab.' : 'This document is read-only.')
      return false
    }
    if (document.kind === 'scene') {
      const { useSceneStore } = await import('./scene-store')
      const scene = useSceneStore.getState().scenes[target]
      if (scene?.status === 'editable') {
        const content = serializeSceneDocument(scene.document)
        set((state) => ({ documents: { ...state.documents, [target]: { ...state.documents[target]!, content } } }))
        document = { ...document, content }
      }
    }
    const result = await window.editorApi.fileSystem.write(target, document.content, document.modifiedAt)
    if (!result.ok) {
      if (result.error.code === 'CONFLICT') {
        set((state) => ({ documents: { ...state.documents, [target]: { ...state.documents[target]!, conflict: true } } }))
      }
      get().notify('error', result.error.message)
      return false
    }
    set((state) => ({
      documents: {
        ...state.documents,
        [target]: {
          ...document,
          savedContent: document.content,
          modifiedAt: result.value.modifiedAt,
          dirty: false,
          conflict: false,
          missing: false
        }
      }
    }))
    if (document.kind === 'scene') {
      const { useSceneStore } = await import('./scene-store')
      useSceneStore.getState().markSaved(target)
    }
    if (['animation', 'prefab'].includes(document.kind)) {
      const { useAuthoringHistoryStore } = await import('./authoring-history-store')
      useAuthoringHistoryStore.getState().markSaved(target)
    }
    get().notify('success', `Saved ${document.name}`)
    return true
  },

  async reloadDocument(path) {
    const result = await window.editorApi.fileSystem.read(path)
    if (!result.ok) {
      get().notify('error', result.error.message)
      return false
    }
    const type = classifyFile(path, result.value.content)
    let readOnly = false
    if (type.kind === 'scene') {
      try {
        const parsed = parseSceneDocument(result.value.content)
        readOnly = parsed.status === 'readonly'
        if (parsed.status === 'readonly') get().notify('warning', parsed.message)
      } catch (error) {
        get().notify('error', sceneErrorMessage(error))
        return false
      }
    }
    set((state) => {
      const document = state.documents[path]
      if (!document) return state
      return { documents: { ...state.documents, [path]: {
        ...document,
        content: result.value.content,
        savedContent: result.value.content,
        modifiedAt: result.value.modifiedAt,
        dirty: false,
        conflict: false,
        missing: false,
        readOnly
      } } }
    })
    return true
  },

  async overwriteDocument(path) {
    const document = get().documents[path]
    if (!document || document.missing || document.readOnly) return false
    const result = await window.editorApi.fileSystem.write(path, document.content)
    if (!result.ok) {
      get().notify('error', result.error.message)
      return false
    }
    set((state) => ({ documents: { ...state.documents, [path]: {
      ...state.documents[path]!,
      savedContent: state.documents[path]!.content,
      modifiedAt: result.value.modifiedAt,
      dirty: false,
      conflict: false
    } } }))
    if (document.kind === 'scene') {
      const { useSceneStore } = await import('./scene-store')
      useSceneStore.getState().markSaved(path)
    }
    if (['animation', 'prefab'].includes(document.kind)) {
      const { useAuthoringHistoryStore } = await import('./authoring-history-store')
      useAuthoringHistoryStore.getState().markSaved(path)
    }
    get().notify('success', `Overwrote ${document.name}`)
    return true
  },

  closeDocument(path, confirmDirty = true) {
    const document = get().documents[path]
    if (!document) return true
    if (confirmDirty && document.dirty && !window.confirm(`Close ${document.name} and discard unsaved changes?`)) return false
    set((state) => {
      const documents = { ...state.documents }
      delete documents[path]
      return { documents, selectedPath: state.selectedPath === path ? null : state.selectedPath }
    })
    return true
  },

  rebaseDocuments(source, target) {
    set((state) => {
      const documents: Record<string, EditorDocument> = {}
      for (const [documentPath, document] of Object.entries(state.documents)) {
        const nextPath = rebasePath(documentPath, source, target)
        documents[nextPath] = nextPath === documentPath ? document : { ...document, path: nextPath, name: basename(nextPath) }
      }
      return { documents, selectedPath: state.selectedPath ? rebasePath(state.selectedPath, source, target) : null }
    })
  },

  async handleFileChange(event) {
    const affected = Object.values(get().documents).filter((document) => isSameOrDescendant(document.path, event.path))
    if (event.kind === 'change' || event.kind === 'add') {
      const document = get().documents[event.path]
      if (!document) return
      if (['image', 'audio', 'spine'].includes(document.kind)) {
        const stat = await window.editorApi.fileSystem.stat(event.path)
        if (stat.ok) set((state) => ({ documents: { ...state.documents, [event.path]: {
          ...state.documents[event.path]!,
          modifiedAt: stat.value.modifiedAt,
          missing: false
        } } }))
        return
      }
      const disk = await window.editorApi.fileSystem.read(event.path)
      if (!disk.ok) return
      if (document.dirty) {
        if (disk.value.content === document.savedContent) {
          set((state) => ({ documents: { ...state.documents, [event.path]: {
            ...state.documents[event.path]!,
            modifiedAt: disk.value.modifiedAt,
            conflict: false,
            missing: false,
            readOnly: false
          } } }))
          return
        }
        set((state) => ({ documents: { ...state.documents, [event.path]: { ...state.documents[event.path]!, conflict: true } } }))
        get().notify('warning', `${document.name} changed on disk. Reload or overwrite it.`)
      } else {
        set((state) => ({ documents: { ...state.documents, [event.path]: {
          ...state.documents[event.path]!,
          content: disk.value.content,
          savedContent: disk.value.content,
          modifiedAt: disk.value.modifiedAt,
          dirty: false,
          conflict: false,
          missing: false,
          readOnly: false
        } } }))
      }
      return
    }
    if (event.kind !== 'unlink' && event.kind !== 'unlinkDir') return
    await new Promise((resolve) => window.setTimeout(resolve, 80))
    const stillExists = await window.editorApi.fileSystem.stat(event.path)
    if (stillExists.ok) {
      if (event.kind === 'unlink') await get().handleFileChange({ kind: 'change', path: event.path })
      return
    }
    for (const document of affected) {
      if (document.dirty) {
        set((state) => ({ documents: { ...state.documents, [document.path]: { ...state.documents[document.path]!, missing: true, readOnly: true, conflict: false } } }))
        get().notify('warning', `${document.name} was deleted. Its unsaved content remains available to copy.`)
      } else {
        get().closeDocument(document.path, false)
        get().notify('warning', `${document.name} was deleted and its tab was closed.`)
      }
    }
  },

  selectPath(path) { set({ selectedPath: path }) },
  addLog(entry) { set((state) => ({ logs: [...state.logs.slice(-4999), entry] })) },
  clearLogs() { set({ logs: [] }) },
  setRunSession(session) { set({ runSession: session }) },

  async updateSettings(patch) {
    const result = await window.editorApi.settings.update(patch)
    if (result.ok) set({ settings: result.value })
    else get().notify('error', result.error.message)
  },

  notify(level, message) {
    const id = crypto.randomUUID()
    set((state) => ({ notices: [...state.notices.slice(-4), { id, level, message }] }))
    window.setTimeout(() => get().dismissNotice(id), 5000)
  },
  dismissNotice(id) { set((state) => ({ notices: state.notices.filter((notice) => notice.id !== id) })) },
  setQuickOpen(open) { set({ quickOpen: open }) },
  setPluginsOpen(open) { set({ pluginsOpen: open }) }
}))

async function prepareProjectTransition(get: () => EditorState): Promise<boolean> {
  const state = get()
  if (!state.project) return true
  const dirty = Object.values(state.documents).some((document) => document.dirty)
  if (dirty && !window.confirm('Discard unsaved changes and switch projects?')) return false
  if (['starting', 'running'].includes(state.runSession.status)) {
    const result = await window.editorApi.runner.stop()
    if (!result.ok) {
      state.notify('error', `Could not stop the current project: ${result.error.message}`)
      return false
    }
  }
  return true
}

function isSameOrDescendant(candidate: string, parent: string): boolean {
  const normalizedCandidate = candidate.replaceAll('\\', '/').toLocaleLowerCase()
  const normalizedParent = parent.replaceAll('\\', '/').replace(/\/$/, '').toLocaleLowerCase()
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}/`)
}

function rebasePath(candidate: string, source: string, target: string): string {
  if (!isSameOrDescendant(candidate, source)) return candidate
  return `${target}${candidate.slice(source.length)}`
}

function toSceneKey(name: string): string {
  const normalized = name.replace(/[^a-zA-Z0-9_$]+(.)?/g, (_match, next: string | undefined) => next?.toLocaleUpperCase() ?? '')
  const key = normalized ? `${normalized[0]!.toLocaleUpperCase()}${normalized.slice(1)}` : 'MainScene'
  return /^[a-zA-Z_$]/.test(key) ? key : `Scene${key}`
}

function sceneErrorMessage(error: unknown): string {
  if (error instanceof SceneDocumentError) return `Could not open scene: ${error.message}`
  return error instanceof Error ? error.message : 'Could not open scene.'
}
