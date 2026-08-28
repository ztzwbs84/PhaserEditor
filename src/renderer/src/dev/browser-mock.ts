import type {
  EditorApi,
  EditorSettings,
  ErrorCode,
  FileChangeEvent,
  FileEntry,
  FileSnapshot,
  LogEntry,
  ProjectCreateRequest,
  ProjectDescriptor,
  Result,
  RunSession,
  UnityUIWorkspaceState
} from '@phaser-editor/contracts'
import { ANIMATION_ASSET_FORMAT, CURRENT_ANIMATION_ASSET_VERSION, createSceneDocument, createSceneTransform, serializeAnimationAsset, serializeSceneDocument, type AnimationAsset, type SceneDocument } from '@phaser-editor/contracts'
import { toPackageName } from '../../../shared/project-name'

let root = 'browser-demo'
const now = Date.now()
let project: ProjectDescriptor = {
  name: 'browser-demo',
  path: root,
  phaserVersion: '4.2.1',
  packageManager: 'npm',
  scripts: { start: 'vite --host 127.0.0.1', build: 'tsc && vite build' },
  dependencies: { phaser: '4.2.1', vite: '^6.3.5', typescript: '^6.0.2' },
  folders: ['src', 'public', 'assets'],
  lastOpenedAt: new Date().toISOString(),
  valid: true
}
let recentProjects = [project]

let settings: EditorSettings = {
  theme: 'dark',
  layout: null,
  recentProjects: [project],
  runConfigurations: {},
  trustedProjects: [root],
  palettes: [{
    id: 'default',
    name: 'Phaser UI',
    colors: [
      { id: 'surface', name: 'Surface', hex: '#383838' },
      { id: 'selection', name: 'Selection', hex: '#315F7D' },
      { id: 'run', name: 'Run', hex: '#62A85B' },
      { id: 'warning', name: 'Warning', hex: '#D2A84D' }
    ]
  }],
  shortcuts: {
    'workspace.save': 'Ctrl+S',
    'workspace.undo': 'Ctrl+Z',
    'workspace.redo': 'Ctrl+Shift+Z',
    'workspace.find': 'Ctrl+F',
    'workspace.quickOpen': 'Ctrl+P'
  },
  enabledPlugins: [],
  disabledProjectPlugins: {},
  phaserSourceRoot: 'I:\\Phaser\\phaser',
  unityUIConfigurations: {}
}

let runSession: RunSession = { id: 'browser-acceptance', status: 'idle' }
let unityUIWorkspace: UnityUIWorkspaceState | null = null
const runListeners = new Set<(session: RunSession) => void>()
const logListeners = new Set<(entry: LogEntry) => void>()
const fileListeners = new Set<(event: FileChangeEvent) => void>()
const pluginListeners = new Set<Parameters<EditorApi['plugins']['onChanged']>[0]>()
let fileRecords = createBrowserFiles()

export function installBrowserMock(): void {
  const api: EditorApi = {
    project: {
      listRecent: async () => success(recentProjects),
      open: async (projectPath) => {
        if (!projectPath?.trim()) return failure('CANCELLED', 'Open project was cancelled.')
        const opened = createBrowserProject(projectPath)
        activateProject(opened)
        return success(opened)
      },
      create: async (request) => {
        const created = createBrowserProject(request.targetDirectory, request)
        activateProject(created)
        return success(created)
      },
      close: async () => success(true),
      removeRecent: async (projectPath) => {
        recentProjects = recentProjects.filter((item) => item.path !== projectPath)
        settings = { ...settings, recentProjects }
        return success(recentProjects)
      }
    },
    fileSystem: {
      list: async (path) => success(entriesIn(path ?? root)),
      search: async (query) => success([...fileRecords.values()].map((record) => record.entry).filter((entry) => entry.kind === 'file' && entry.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))),
      read: async (path) => {
        const record = fileRecords.get(path)
        return record?.entry.kind === 'file' ? success(snapshot(record)) : failure('NOT_FOUND', 'The file no longer exists.')
      },
      write: async (path, content, expectedModifiedAt) => {
        const record = fileRecords.get(path)
        if (!record || record.entry.kind !== 'file') return failure('NOT_FOUND', 'The file no longer exists.')
        if (expectedModifiedAt !== undefined && expectedModifiedAt !== record.entry.modifiedAt) return failure('CONFLICT', 'The file changed on disk. Reload it or overwrite it.')
        record.content = content
        record.entry = { ...record.entry, size: content.length, modifiedAt: Date.now() }
        return success(snapshot(record))
      },
      createFile: async (parent, name) => {
        const target = joinPath(parent, name)
        if (fileRecords.has(target)) return failure('CONFLICT', `${name} already exists.`)
        const entry = makeEntry(target, 'file', 0)
        fileRecords.set(target, { entry, content: '' })
        emitFileChange({ kind: 'add', path: target })
        return success(entry)
      },
      createDirectory: async (parent, name) => {
        const target = joinPath(parent, name)
        if (fileRecords.has(target)) return failure('CONFLICT', `${name} already exists.`)
        const entry = makeEntry(target, 'directory')
        fileRecords.set(target, { entry, content: '' })
        emitFileChange({ kind: 'addDir', path: target })
        return success(entry)
      },
      rename: async (source, name) => {
        const record = fileRecords.get(source)
        if (!record) return failure('NOT_FOUND', 'The item no longer exists.')
        const target = joinPath(parentPath(source), name)
        if (fileRecords.has(target)) return failure('CONFLICT', `${name} already exists.`)
        rebaseRecords(source, target)
        emitFileChange({ kind: record.entry.kind === 'directory' ? 'unlinkDir' : 'unlink', path: source })
        emitFileChange({ kind: record.entry.kind === 'directory' ? 'addDir' : 'add', path: target })
        return success(fileRecords.get(target)!.entry)
      },
      copy: async (source, destination) => {
        const record = fileRecords.get(source)
        if (!record) return failure('NOT_FOUND', 'The item no longer exists.')
        const target = joinPath(destination, record.entry.name)
        if (fileRecords.has(target)) return failure('CONFLICT', `${record.entry.name} already exists.`)
        const entry = makeEntry(target, record.entry.kind, record.entry.size)
        fileRecords.set(target, { entry, content: record.content })
        emitFileChange({ kind: entry.kind === 'directory' ? 'addDir' : 'add', path: target })
        return success(entry)
      },
      move: async (source, destination) => {
        const record = fileRecords.get(source)
        if (!record) return failure('NOT_FOUND', 'The item no longer exists.')
        const target = joinPath(destination, record.entry.name)
        if (fileRecords.has(target)) return failure('CONFLICT', `${record.entry.name} already exists.`)
        rebaseRecords(source, target)
        emitFileChange({ kind: record.entry.kind === 'directory' ? 'unlinkDir' : 'unlink', path: source })
        emitFileChange({ kind: record.entry.kind === 'directory' ? 'addDir' : 'add', path: target })
        return success(fileRecords.get(target)!.entry)
      },
      trash: async (path) => {
        const record = fileRecords.get(path)
        if (!record) return failure('NOT_FOUND', 'The item no longer exists.')
        removeRecords(path)
        emitFileChange({ kind: record.entry.kind === 'directory' ? 'unlinkDir' : 'unlink', path })
        return success(true)
      },
      stat: async (path) => {
        const entry = fileRecords.get(path)?.entry
        return entry ? success(entry) : failure('NOT_FOUND', 'The item no longer exists.')
      },
      assetUrl: (path) => path.toLocaleLowerCase().endsWith('.wav') ? createWavDataUrl() : createTilesetDataUrl(),
      onChange: (listener) => { fileListeners.add(listener); return () => fileListeners.delete(listener) }
    },
    runner: {
      start: async () => {
        runSession = { id: 'browser-acceptance', status: 'running', url: 'http://127.0.0.1:5173/' }
        runListeners.forEach((listener) => listener(runSession))
        const timestamp = new Date().toISOString()
        logListeners.forEach((listener) => listener({ id: crypto.randomUUID(), timestamp, source: 'project', level: 'info', message: 'Local: http://127.0.0.1:5173/' }))
        logListeners.forEach((listener) => listener({ id: crypto.randomUUID(), timestamp, source: 'preview', level: 'info', message: 'Phaser 4 examples ready' }))
        return success(runSession)
      },
      stop: async () => {
        runSession = { ...runSession, status: 'stopped', stoppedAt: new Date().toISOString() }
        runListeners.forEach((listener) => listener(runSession))
        return success(runSession)
      },
      restart: async () => success(runSession),
      sendInput: async (input) => {
        logListeners.forEach((listener) => listener({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), source: 'project', level: 'debug', message: `> ${input}` }))
        return success(true)
      },
      getState: async () => success(runSession),
      openExternal: async () => success(true),
      onState: (listener) => { runListeners.add(listener); return () => runListeners.delete(listener) },
      onLog: (listener) => { logListeners.add(listener); return () => logListeners.delete(listener) }
    },
    preview: {
      show: async () => success(true),
      hide: async () => success(true),
      load: async () => success(true)
    },
    unityUI: {
      configure: async (configuration) => {
        if (!configuration.prefabRoot.trim() || !configuration.uiRawRoot.trim()) return failure('INVALID_INPUT', 'Unity UI source directories are required.')
        unityUIWorkspace = {
          configuration,
          unityProjectRoot: 'G:\\MockUnity',
          assetsRoot: 'G:\\MockUnity\\Assets',
          unityVersion: '2022.3.20f1',
          prefabs: [
            { name: 'Inventory.prefab', relativePath: 'BackPack/Inventory.prefab', size: 2048, modifiedAt: now },
            { name: 'MainUI.prefab', relativePath: 'MainUI.prefab', size: 1024, modifiedAt: now }
          ],
          assetIndex: { assetsRoot: 'G:\\MockUnity\\Assets', metaFileCount: 32, uniqueGuidCount: 30, duplicateGuidCount: 0 }
        }
        return success(unityUIWorkspace)
      },
      refreshPrefabs: async () => unityUIWorkspace ? success(unityUIWorkspace) : failure('INVALID_INPUT', 'Configure the Unity UI source directories first.'),
      rebuildAssetIndex: async () => unityUIWorkspace ? success(unityUIWorkspace) : failure('INVALID_INPUT', 'Configure the Unity UI source directories first.'),
      preview: async (request) => success({
        requestId: request.requestId,
        stale: false,
        prefab: { name: request.relativePath.split('/').pop() ?? request.relativePath, relativePath: request.relativePath, size: 1024, modifiedAt: now },
        previewUrl: 'unity-ui-preview://local/mock/phaser.html?embedded=1',
        outputDirectory: 'browser-mock\\unity-ui',
        durationMs: 24,
        copiedResources: 3,
        statistics: { nodeCount: 12, resourceCount: 3, componentCounts: { image: 4, text: 2, button: 1 }, warningCount: 0, errorCount: 0, nestedPrefabCount: 1 },
        diagnostics: []
      }),
      exportCurrent: async (outputRoot) => success({
        outputDirectory: `${outputRoot}\\MainUI-unity-ui`,
        previewHtml: `${outputRoot}\\MainUI-unity-ui\\preview.html`,
        phaserHtml: `${outputRoot}\\MainUI-unity-ui\\phaser.html`,
        documentJson: `${outputRoot}\\MainUI-unity-ui\\ui.json`,
        reportJson: `${outputRoot}\\MainUI-unity-ui\\conversion-report.json`
      }),
      showPreview: async () => success(true),
      hidePreview: async () => success(true)
    },
    settings: {
      get: async () => success(settings),
      update: async (patch) => { settings = { ...settings, ...patch }; return success(settings) }
    },
    dialogs: {
      selectDirectory: async (defaultPath) => defaultPath?.trim()
        ? success(defaultPath)
        : failure('CANCELLED', 'Folder selection is unavailable in browser acceptance mode.'),
      saveHtml: async () => failure('CANCELLED', 'Browser acceptance mode does not write exported files.')
    },
    plugins: {
      list: async () => success([]),
      installFromDirectory: async () => failure('CANCELLED', 'Browser acceptance mode does not install plugins.'),
      setEnabled: async () => success([]),
      attachProject: async (path) => success({ projectPath: path, plugins: [], trustRequired: false, loaded: true }),
      detachProject: async () => success([]),
      refreshProject: async () => success([]),
      trustProjectPlugins: async (path) => success({ projectPath: path, plugins: [], trustRequired: false, loaded: true }),
      readResource: async () => failure('NOT_FOUND', 'Plugin resources are unavailable in browser acceptance mode.'),
      resourceUrl: (path) => path,
      onChanged: (listener) => { pluginListeners.add(listener); return () => pluginListeners.delete(listener) }
    },
    codeIntelligence: {
      resolvePhaserDeclarations: async () => success({
        source: 'fallback',
        version: '4.2.1',
        declarationPath: 'node_modules/phaser/types/phaser.d.ts',
        content: 'declare namespace Phaser { class Scene { add: { image(x: number, y: number, texture: string, frame?: string | number): GameObjects.Image }; cameras: { main: Cameras.Scene2D.Camera } } namespace GameObjects { class Image { x: number; y: number; setAlpha(value: number): this } } namespace Cameras.Scene2D { class Camera { setZoom(value: number): this } } } export = Phaser; export as namespace Phaser;'
      })
    },
    clipboard: { writeText: async () => success(true) }
  }
  window.editorApi = api
}

export function createBrowserProject(projectPath: string, request?: ProjectCreateRequest): ProjectDescriptor {
  const normalizedPath = projectPath.trim().replace(/[\\/]+$/, '') || projectPath.trim()
  const folderName = normalizedPath.split(/[\\/]/).pop() || 'phaser-project'
  return {
    name: request ? toPackageName(request.name) : folderName,
    path: normalizedPath,
    phaserVersion: '4.2.1',
    packageManager: 'npm',
    scripts: { start: 'vite --host 127.0.0.1', build: 'tsc && vite build' },
    dependencies: { phaser: '4.2.1', vite: '^6.3.5', typescript: '^6.0.2' },
    folders: ['src', 'public', 'assets'],
    lastOpenedAt: new Date().toISOString(),
    valid: true
  }
}

function activateProject(nextProject: ProjectDescriptor): void {
  root = nextProject.path
  project = nextProject
  recentProjects = [nextProject, ...recentProjects.filter((item) => item.path !== nextProject.path)].slice(0, 30)
  settings = { ...settings, recentProjects }
  fileRecords = createBrowserFiles()
}

interface BrowserFileRecord { entry: FileEntry; content: string }

function createBrowserFiles(): Map<string, BrowserFileRecord> {
  const records = new Map<string, BrowserFileRecord>()
  const add = (relativePath: string, kind: FileEntry['kind'], content = ''): void => {
    const path = joinPath(root, relativePath)
    const entry = makeEntry(path, kind, content.length)
    records.set(path, { entry, content })
  }
  ;['assets', 'assets\\Animations', 'assets\\Effects', 'assets\\Fonts', 'assets\\Materials', 'assets\\Scenes', 'assets\\UI', 'assets\\UI\\Raw', 'assets\\UI\\Raw\\Atlas', 'assets\\GameScripts', 'assets\\GameScripts\\Core', 'assets\\GameScripts\\Procedure', 'public', 'src'].forEach((path) => add(path, 'directory'))
  add('index.html', 'file', '<div id="game"></div>\n')
  add('package.json', 'file', `${JSON.stringify({ name: project.name, scripts: project.scripts, dependencies: { phaser: '4.2.1' } }, null, 2)}\n`)
  add('README.md', 'file', '# Neon Runner\n\nPhaser project workspace.\n')
  add('tsconfig.json', 'file', `${JSON.stringify({ compilerOptions: { strict: true } }, null, 2)}\n`)
  add('assets\\tiles.png', 'file', 'PNG')
  add('assets\\tiles.phaser-atlas.json', 'file', createAtlasJson())
  add('assets\\tiles.phaser-spritesheet.json', 'file', `${JSON.stringify({ image: 'tiles.png', imageWidth: 64, imageHeight: 64, frameWidth: 32, frameHeight: 32, margin: 0, spacing: 0, startFrame: 0, endFrame: 3 }, null, 2)}\n`)
  add('assets\\Animations\\tiles.phaser-animations.json', 'file', createAnimationFixture())
  add('assets\\tone.wav', 'file', 'WAV')
  add('assets\\scene-map.json', 'file', createMapJson())
  add('assets\\Scenes\\MainScene.phaser-scene.json', 'file', createSceneFixture())
  ;['ProcedureBase.ts', 'ProcedureClearCache.ts', 'ProcedureCreateDownloader.ts', 'ProcedureDownloadFile.ts', 'ProcedureLaunch.ts', 'ProcedurePreload.ts', 'ProcedureStartGame.ts'].forEach((name) => add(`assets\\GameScripts\\Procedure\\${name}`, 'file', `export class ${name.replace('.ts', '')} {}\n`))
  return records
}

function entriesIn(directory: string): FileEntry[] {
  return [...fileRecords.values()].map((record) => record.entry)
    .filter((entry) => parentPath(entry.path) === directory)
    .sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name))
}

function snapshot(record: BrowserFileRecord): FileSnapshot {
  return { path: record.entry.path, content: record.content, modifiedAt: record.entry.modifiedAt, size: record.content.length, encoding: 'utf8' }
}

function makeEntry(path: string, kind: FileEntry['kind'], size = 0): FileEntry {
  const name = path.split('\\').pop() ?? path
  return { name, path, relativePath: path === root ? '' : path.slice(root.length + 1), kind, size, modifiedAt: now, extension: kind === 'file' ? name.split('.').pop()?.toLocaleLowerCase() ?? '' : '' }
}

function joinPath(parent: string, child: string): string {
  return `${parent.replace(/[\\/]+$/, '')}\\${child.replace(/^[\\/]+/, '')}`
}

function parentPath(path: string): string {
  const index = path.lastIndexOf('\\')
  return index < 0 ? '' : path.slice(0, index)
}

function rebaseRecords(source: string, target: string): void {
  const affected = [...fileRecords.entries()].filter(([path]) => path === source || path.startsWith(`${source}\\`))
  affected.forEach(([path]) => fileRecords.delete(path))
  affected.forEach(([path, record]) => {
    const nextPath = `${target}${path.slice(source.length)}`
    fileRecords.set(nextPath, { ...record, entry: makeEntry(nextPath, record.entry.kind, record.entry.size) })
  })
}

function removeRecords(source: string): void {
  for (const path of fileRecords.keys()) if (path === source || path.startsWith(`${source}\\`)) fileRecords.delete(path)
}

function emitFileChange(event: FileChangeEvent): void {
  fileListeners.forEach((listener) => listener(event))
}

export function simulateBrowserFileChange(event: FileChangeEvent, content?: string): void {
  const record = fileRecords.get(event.path)
  if (event.kind === 'change' && record && content !== undefined) {
    record.content = content
    record.entry = { ...record.entry, size: content.length, modifiedAt: Date.now() }
  }
  if ((event.kind === 'unlink' || event.kind === 'unlinkDir') && record) removeRecords(event.path)
  emitFileChange(event)
}

function createMapJson(): string {
  const width = 24
  const height = 16
  const map = {
    compressionlevel: -1,
    height,
    width,
    infinite: false,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    tileheight: 32,
    tilewidth: 32,
    type: 'map',
    version: '1.10',
    tiledversion: '1.11.2',
    nextlayerid: 3,
    nextobjectid: 2,
    layers: [
      { id: 1, name: 'Ground', type: 'tilelayer', width, height, x: 0, y: 0, opacity: 1, visible: true, data: Array.from({ length: width * height }, (_, index) => (index + Math.floor(index / width)) % 4 + 1) },
      { id: 2, name: 'Spawn Points', type: 'objectgroup', opacity: 1, visible: true, objects: [{ id: 1, name: 'Player', type: 'spawn', x: 288, y: 192, width: 32, height: 32 }] }
    ],
    tilesets: [{ columns: 2, firstgid: 1, image: 'tiles.png', imageheight: 64, imagewidth: 64, margin: 0, name: 'Unity Grid', spacing: 0, tilecount: 4, tileheight: 32, tilewidth: 32 }]
  }
  return `${JSON.stringify(map, null, 2)}\n`
}

function createSceneFixture(): string {
  const document: SceneDocument = {
    ...createSceneDocument('MainScene'),
    settings: { ...createSceneDocument('MainScene').settings, width: 960, height: 540, backgroundColor: '#1f242a' },
    objects: [
      {
        id: 'aa8739a0-b28f-4b00-9164-2f98242ea420',
        type: 'container',
        name: 'World',
        parentId: null,
        order: 0,
        transform: createSceneTransform(),
        visible: true,
        alpha: 1,
        components: []
      },
      {
        id: '65b7df36-6b2c-4dfc-84d2-a489393e9699',
        type: 'sprite',
        name: 'Tiles Preview',
        parentId: 'aa8739a0-b28f-4b00-9164-2f98242ea420',
        order: 0,
        transform: createSceneTransform({ x: 240, y: 200, scaleX: 2, scaleY: 2 }),
        visible: true,
        alpha: 1,
        components: [],
        asset: { path: 'assets/tiles.png', frame: null },
        animation: { assetPath: 'assets/Animations/tiles.phaser-animations.json', clipKey: 'tiles-cycle', autoPlay: true }
      },
      {
        id: '73dbca2f-3ac0-4a27-9a14-1b84aad07345',
        type: 'text',
        name: 'Title',
        parentId: null,
        order: 1,
        transform: createSceneTransform({ x: 360, y: 110, originX: 0.5, originY: 0.5 }),
        visible: true,
        alpha: 1,
        components: [],
        text: 'PHASER EDITOR',
        style: { fontFamily: 'Arial', fontSize: 36, color: '#8fd3ff', align: 'center' }
      }
    ]
  }
  return serializeSceneDocument(document)
}

function createTilesetDataUrl(): string {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" shape-rendering="crispEdges"><rect width="32" height="32" fill="#4f8fb8"/><rect x="32" width="32" height="32" fill="#65a85d"/><rect y="32" width="32" height="32" fill="#d5a13d"/><rect x="32" y="32" width="32" height="32" fill="#a65a75"/><path d="M0 32h64M32 0v64" stroke="#202428" stroke-width="2"/></svg>'
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function createAtlasJson(): string {
  return `${JSON.stringify({
    frames: {
      blue: { frame: { x: 0, y: 0, w: 32, h: 32 }, rotated: false, trimmed: false },
      green: { frame: { x: 32, y: 0, w: 32, h: 32 }, rotated: false, trimmed: false },
      gold: { frame: { x: 0, y: 32, w: 32, h: 32 }, rotated: false, trimmed: false },
      rose: { frame: { x: 32, y: 32, w: 32, h: 32 }, rotated: false, trimmed: false }
    },
    meta: { image: 'tiles.png', size: { w: 64, h: 64 }, scale: 1 }
  }, null, 2)}\n`
}

function createAnimationFixture(): string {
  const source = 'assets/tiles.phaser-atlas.json'
  const asset: AnimationAsset = {
    format: ANIMATION_ASSET_FORMAT,
    version: CURRENT_ANIMATION_ASSET_VERSION,
    clips: [{
      id: '1be77e0e-dd11-45f0-8088-780e78057331',
      key: 'tiles-cycle',
      frames: ['blue', 'green', 'gold', 'rose'].map((frame) => ({ source, frame })),
      frameRate: 4,
      duration: null,
      delay: 0,
      repeat: -1,
      repeatDelay: 0,
      yoyo: true,
      skipMissedFrames: true
    }]
  }
  return serializeAnimationAsset(asset)
}

function createWavDataUrl(): string {
  const sampleRate = 8_000
  const sampleCount = 2_000
  const bytes = new Uint8Array(44 + sampleCount * 2)
  const view = new DataView(bytes.buffer)
  writeAscii(bytes, 0, 'RIFF')
  view.setUint32(4, 36 + sampleCount * 2, true)
  writeAscii(bytes, 8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(bytes, 36, 'data')
  view.setUint32(40, sampleCount * 2, true)
  for (let index = 0; index < sampleCount; index += 1) view.setInt16(44 + index * 2, Math.sin(2 * Math.PI * 440 * index / sampleRate) * 8_000, true)
  let binary = ''
  bytes.forEach((value) => { binary += String.fromCharCode(value) })
  return `data:audio/wav;base64,${btoa(binary)}`
}

function writeAscii(target: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) target[offset + index] = value.charCodeAt(index)
}

function success<T>(value: T): Result<T> {
  return { ok: true, value }
}

function failure<T>(code: ErrorCode, message: string): Result<T> {
  return { ok: false, error: { code, message } }
}
