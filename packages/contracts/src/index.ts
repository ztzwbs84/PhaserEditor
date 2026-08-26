import { z } from 'zod'

export * from './scene'
export * from './authoring'

export const errorCodeSchema = z.enum([
  'CANCELLED',
  'INVALID_INPUT',
  'NOT_FOUND',
  'ACCESS_DENIED',
  'CONFLICT',
  'UNSUPPORTED',
  'PROCESS_FAILED',
  'INTERNAL'
])

export type ErrorCode = z.infer<typeof errorCodeSchema>

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: ErrorCode; message: string; details?: string } }

export const projectCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(80).regex(/^[^<>:\"/\\|?*]+$/),
  targetDirectory: z.string().min(1),
  installDependencies: z.boolean().default(true)
})

export type ProjectCreateRequest = z.infer<typeof projectCreateRequestSchema>

export interface ProjectDescriptor {
  name: string
  path: string
  phaserVersion: string | null
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun'
  scripts: Record<string, string>
  dependencies: Record<string, string>
  folders: string[]
  lastOpenedAt: string
  valid: boolean
  issue?: string
}

export interface FileEntry {
  name: string
  path: string
  relativePath: string
  kind: 'file' | 'directory'
  size: number
  modifiedAt: number
  extension: string
}

export interface FileSnapshot {
  path: string
  content: string
  modifiedAt: number
  size: number
  encoding: 'utf8'
}

export interface PhaserDeclarationBundle {
  source: 'project' | 'fallback'
  version: string
  declarationPath: string
  content: string
}

export type FileChangeKind = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'

export interface FileChangeEvent {
  kind: FileChangeKind
  path: string
}

export interface EditorDocument {
  id: string
  path: string
  name: string
  language: string
  kind: 'text' | 'markdown' | 'image' | 'audio' | 'spine' | 'tilemap' | 'scene' | 'atlas' | 'animation' | 'prefab' | 'plugin'
  content: string
  savedContent: string
  modifiedAt: number
  dirty: boolean
  conflict?: boolean
  missing?: boolean
  readOnly?: boolean
}

export type RunStatus = 'idle' | 'starting' | 'running' | 'error' | 'stopped'

export interface RunSession {
  id: string
  status: RunStatus
  pid?: number
  url?: string
  startedAt?: string
  stoppedAt?: string
  exitCode?: number | null
  message?: string
}

export interface LogEntry {
  id: string
  timestamp: string
  source: 'editor' | 'project' | 'preview' | 'plugin'
  level: 'debug' | 'info' | 'warning' | 'error'
  message: string
  file?: string
  line?: number
  column?: number
}

export interface RunConfiguration {
  executable: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
}

export interface CommandContribution {
  id: string
  title: string
  category?: string
  defaultShortcut?: string
  priority?: number
}

export interface PanelContribution {
  id: string
  title: string
  entry?: string
  location?: 'left' | 'center' | 'right' | 'bottom'
  priority?: number
}

export interface FileHandlerContribution {
  id: string
  extensions: string[]
  editor: string
  priority?: number
}

export interface ComponentProviderContribution {
  id: string
  type: string
  label: string
  version: number
  entry?: string
  priority?: number
  defaultData?: Record<string, unknown>
  properties?: Array<{ path: string[]; label: string; kind: 'number' | 'text' | 'boolean' | 'select' | 'color'; min?: number; max?: number; step?: number; options?: Array<{ value: string; label: string }> }>
}

export interface SchemaContribution {
  uri: string
  fileMatch: string[]
  path: string
  priority?: number
}

export const pluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9.-]+$/),
  name: z.string().min(1),
  version: z.string().min(1),
  engine: z.string().default('>=0.1.0'),
  main: z.string().optional(),
  ui: z.string().optional(),
  permissions: z.array(z.enum(['filesystem:project', 'process', 'network', 'clipboard'])).default([]),
  contributes: z.object({
    commands: z.array(z.custom<CommandContribution>()).default([]),
    panels: z.array(z.custom<PanelContribution>()).default([]),
    fileHandlers: z.array(z.custom<FileHandlerContribution>()).default([]),
    schemas: z.array(z.custom<SchemaContribution>()).default([]),
    components: z.array(z.custom<ComponentProviderContribution>()).default([])
  }).default({ commands: [], panels: [], fileHandlers: [], schemas: [], components: [] })
})

export type PluginManifest = z.infer<typeof pluginManifestSchema>

export interface InstalledPlugin {
  manifest: PluginManifest
  path: string
  enabled: boolean
  state: 'disabled' | 'active' | 'error'
  error?: string
}

export interface PaletteColor {
  id: string
  name: string
  hex: string
}

export interface PaletteGroup {
  id: string
  name: string
  colors: PaletteColor[]
}

export interface UnityUIConfiguration {
  prefabRoot: string
  uiRawRoot: string
  referenceResolution: { x: number; y: number }
  lastPrefabRelativePath?: string
}

export interface UnityUIPrefabEntry {
  name: string
  relativePath: string
  size: number
  modifiedAt: number
}

export interface UnityUIAssetIndexSummary {
  assetsRoot: string
  metaFileCount: number
  uniqueGuidCount: number
  duplicateGuidCount: number
}

export interface UnityUIWorkspaceState {
  configuration: UnityUIConfiguration
  unityProjectRoot: string
  assetsRoot: string
  unityVersion: string | null
  prefabs: UnityUIPrefabEntry[]
  assetIndex: UnityUIAssetIndexSummary
}

export interface UnityUIDiagnostic {
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
  sourcePath?: string
  nodeId?: string
  componentId?: string
  propertyPath?: string
  details?: Record<string, unknown>
}

export interface UnityUIPreviewRequest {
  relativePath: string
  requestId: string
}

export interface UnityUIPreviewResult {
  requestId: string
  stale: boolean
  prefab: UnityUIPrefabEntry
  previewUrl: string
  outputDirectory: string
  durationMs: number
  copiedResources: number
  statistics: {
    nodeCount: number
    resourceCount: number
    componentCounts: Record<string, number>
    warningCount: number
    errorCount: number
    nestedPrefabCount: number
  }
  diagnostics: UnityUIDiagnostic[]
}

export interface UnityUIExportResult {
  outputDirectory: string
  previewHtml: string
  phaserHtml: string
  documentJson: string
  reportJson: string
}

export interface EditorSettings {
  theme: 'dark' | 'light'
  layout: unknown | null
  recentProjects: ProjectDescriptor[]
  runConfigurations: Record<string, RunConfiguration>
  trustedProjects: string[]
  palettes: PaletteGroup[]
  shortcuts: Record<string, string>
  enabledPlugins: string[]
  phaserSourceRoot: string
  unityUIConfigurations: Record<string, UnityUIConfiguration>
}

export interface PluginApi {
  list(): Promise<Result<InstalledPlugin[]>>
  installFromDirectory(): Promise<Result<InstalledPlugin>>
  setEnabled(id: string, enabled: boolean): Promise<Result<InstalledPlugin[]>>
  readResource(id: string, relativePath: string): Promise<Result<string>>
  resourceUrl(path: string): string
}

export interface EditorApi {
  project: {
    listRecent(): Promise<Result<ProjectDescriptor[]>>
    open(path?: string): Promise<Result<ProjectDescriptor>>
    create(request: ProjectCreateRequest): Promise<Result<ProjectDescriptor>>
    close(): Promise<Result<true>>
    removeRecent(path: string): Promise<Result<ProjectDescriptor[]>>
  }
  fileSystem: {
    list(path?: string): Promise<Result<FileEntry[]>>
    search(query: string): Promise<Result<FileEntry[]>>
    read(path: string): Promise<Result<FileSnapshot>>
    write(path: string, content: string, expectedModifiedAt?: number): Promise<Result<FileSnapshot>>
    createFile(parent: string, name: string): Promise<Result<FileEntry>>
    createDirectory(parent: string, name: string): Promise<Result<FileEntry>>
    rename(path: string, name: string): Promise<Result<FileEntry>>
    copy(source: string, destinationDirectory: string): Promise<Result<FileEntry>>
    move(source: string, destinationDirectory: string): Promise<Result<FileEntry>>
    trash(path: string): Promise<Result<true>>
    stat(path: string): Promise<Result<FileEntry>>
    assetUrl(path: string): string
    onChange(listener: (event: FileChangeEvent) => void): () => void
  }
  runner: {
    start(config?: RunConfiguration): Promise<Result<RunSession>>
    stop(): Promise<Result<RunSession>>
    restart(config?: RunConfiguration): Promise<Result<RunSession>>
    sendInput(input: string): Promise<Result<true>>
    getState(): Promise<Result<RunSession>>
    openExternal(url: string): Promise<Result<true>>
    onState(listener: (session: RunSession) => void): () => void
    onLog(listener: (entry: LogEntry) => void): () => void
  }
  preview: {
    show(bounds: { x: number; y: number; width: number; height: number }): Promise<Result<true>>
    hide(): Promise<Result<true>>
    load(url: string): Promise<Result<true>>
  }
  unityUI: {
    configure(configuration: UnityUIConfiguration): Promise<Result<UnityUIWorkspaceState>>
    refreshPrefabs(): Promise<Result<UnityUIWorkspaceState>>
    rebuildAssetIndex(): Promise<Result<UnityUIWorkspaceState>>
    preview(request: UnityUIPreviewRequest): Promise<Result<UnityUIPreviewResult>>
    exportCurrent(outputRoot: string): Promise<Result<UnityUIExportResult>>
    showPreview(bounds: { x: number; y: number; width: number; height: number }): Promise<Result<true>>
    hidePreview(): Promise<Result<true>>
  }
  settings: {
    get(): Promise<Result<EditorSettings>>
    update(patch: Partial<EditorSettings>): Promise<Result<EditorSettings>>
  }
  dialogs: {
    selectDirectory(defaultPath?: string): Promise<Result<string>>
    saveHtml(defaultName: string, html: string): Promise<Result<string>>
  }
  plugins: PluginApi
  codeIntelligence: {
    resolvePhaserDeclarations(): Promise<Result<PhaserDeclarationBundle>>
  }
  clipboard: {
    writeText(text: string): Promise<Result<true>>
  }
}

export const ipcChannels = {
  projectListRecent: 'project:list-recent',
  projectOpen: 'project:open',
  projectCreate: 'project:create',
  projectClose: 'project:close',
  projectRemoveRecent: 'project:remove-recent',
  fsList: 'fs:list',
  fsSearch: 'fs:search',
  fsRead: 'fs:read',
  fsWrite: 'fs:write',
  fsCreateFile: 'fs:create-file',
  fsCreateDirectory: 'fs:create-directory',
  fsRename: 'fs:rename',
  fsCopy: 'fs:copy',
  fsMove: 'fs:move',
  fsTrash: 'fs:trash',
  fsStat: 'fs:stat',
  fsChangeEvent: 'fs:change-event',
  runnerStart: 'runner:start',
  runnerStop: 'runner:stop',
  runnerRestart: 'runner:restart',
  runnerInput: 'runner:input',
  runnerState: 'runner:state',
  runnerStateEvent: 'runner:state-event',
  runnerLogEvent: 'runner:log-event',
  runnerOpenExternal: 'runner:open-external',
  previewShow: 'preview:show',
  previewHide: 'preview:hide',
  previewLoad: 'preview:load',
  unityUIConfigure: 'unity-ui:configure',
  unityUIRefreshPrefabs: 'unity-ui:refresh-prefabs',
  unityUIRebuildAssetIndex: 'unity-ui:rebuild-asset-index',
  unityUIPreview: 'unity-ui:preview',
  unityUIExportCurrent: 'unity-ui:export-current',
  unityUIShowPreview: 'unity-ui:show-preview',
  unityUIHidePreview: 'unity-ui:hide-preview',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  dialogSelectDirectory: 'dialog:select-directory',
  dialogSaveHtml: 'dialog:save-html',
  pluginsList: 'plugins:list',
  pluginsInstall: 'plugins:install',
  pluginsEnable: 'plugins:enable',
  pluginsReadResource: 'plugins:read-resource',
  clipboardWrite: 'clipboard:write',
  codeIntelligenceResolve: 'code-intelligence:resolve-phaser'
} as const
