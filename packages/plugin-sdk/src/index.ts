export type {
  CommandContribution,
  ComponentProviderContribution,
  EditorDocument,
  FileEntry,
  FileHandlerContribution,
  FileSnapshot,
  PanelContribution,
  PluginBuildDiagnostic,
  PluginManifest,
  SchemaContribution
} from '@phaser-editor/contracts'

import type {
  EditorDocument,
  FileEntry,
  FileSnapshot,
  PluginBuildDiagnostic
} from '@phaser-editor/contracts'

export interface PluginContext {
  pluginPath: string
  subscriptions: Array<{ dispose(): void }>
  postMessage(message: unknown): void
}

export interface PhaserEditorPlugin {
  activate(context: PluginContext): void | Promise<void>
  deactivate?(): void | Promise<void>
}

export type PluginSurfaceKind = 'panel' | 'fileEditor'

export interface PluginUndoRedoHandlers {
  undo(): void
  redo(): void
  canUndo?(): boolean
  canRedo?(): boolean
}

export interface PluginSurfaceContext {
  pluginId: string
  instanceId: string
  contributionId: string
  surfaceKind: PluginSurfaceKind
  document?: {
    snapshot: EditorDocument
    update(content: string): void
    save(): Promise<boolean>
    subscribe(listener: (document: EditorDocument) => void): () => void
    onDidSave(listener: (document: EditorDocument) => void): () => void
  }
  project: {
    root: string | null
    read(relativePath: string): Promise<FileSnapshot>
    write(relativePath: string, content: string, expectedModifiedAt?: number): Promise<FileSnapshot>
    list(relativePath?: string): Promise<FileEntry[]>
    assetUrl(relativePath: string): string
  }
  workspace: {
    openFile(path: string): Promise<void>
    openPanel(id: string): void
  }
  theme: {
    current: 'dark' | 'light'
    subscribe(listener: (theme: 'dark' | 'light') => void): () => void
  }
  diagnostics: {
    report(diagnostic: string | Partial<PluginBuildDiagnostic> & { message: string }): void
  }
  history: {
    registerActiveUndoRedo(handlers: PluginUndoRedoHandlers): () => void
  }
}

export interface PluginSurfaceHandle {
  update?(context: PluginSurfaceContext): void | Promise<void>
  dispose?(): void | Promise<void>
}

export interface PluginSurfaceDefinition {
  mount(container: HTMLElement, context: PluginSurfaceContext): void | PluginSurfaceHandle | Promise<void | PluginSurfaceHandle>
  update?(context: PluginSurfaceContext): void | Promise<void>
  dispose?(): void | Promise<void>
}
