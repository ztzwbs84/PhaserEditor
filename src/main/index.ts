import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  net,
  protocol,
  shell
} from 'electron'
import { ipcChannels, projectCreateRequestSchema, type EditorSettings, type RunConfiguration } from '@phaser-editor/contracts'
import { asResult, AppError, normalizeForComparison } from './domain'
import { ConfigStore } from './config-store'
import { ProjectService } from './project-service'
import { FileService } from './file-service'
import { RunnerService } from './runner-service'
import { PreviewService } from './preview-service'
import { PluginService, pluginProtocolHeaders } from './plugin-service'
import { configureProjectPluginEsbuildBinary } from './project-plugin-compiler'
import { settleShutdownTasks } from './shutdown'
import { resolvePhaserDeclarations } from './code-intelligence-service'
import { resolveProjectAssetUrl } from '../shared/asset-url'
import { UnityUIService } from './unity-ui-service'
import { UnityUIPreviewService } from './unity-ui-preview-service'
import { resolveUnityUIPreviewUrl, UNITY_UI_PREVIEW_SCHEME } from '../shared/unity-ui-preview-url'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'phaser-asset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
  },
  { scheme: 'phaser-plugin', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: UNITY_UI_PREVIEW_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
])

if (process.env.PHASER_EDITOR_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.PHASER_EDITOR_USER_DATA))
}

let mainWindow: BrowserWindow | null = null
let previewService: PreviewService | null = null
let pluginService: PluginService | null = null
let fileService: FileService | null = null
let runnerService: RunnerService | null = null
let unityUIService: UnityUIService | null = null
let unityUIPreviewService: UnityUIPreviewService | null = null
let shuttingDown = false

async function bootstrap(): Promise<void> {
  await app.whenReady()
  configureProjectPluginEsbuildBinary(app.isPackaged, process.resourcesPath)
  const store = new ConfigStore(app.getPath('userData'))
  await store.load()
  const templateRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'templates', 'vite-ts')
    : path.join(process.cwd(), 'resources', 'templates', 'vite-ts')
  const pluginHostPath = app.isPackaged
    ? path.join(process.resourcesPath, 'plugin-host.cjs')
    : path.join(process.cwd(), 'resources', 'plugin-host.cjs')
  const projectService = new ProjectService(store, templateRoot)
  const activeFileService = new FileService(
    () => projectService.activeProject?.path ?? null,
    (event) => mainWindow?.webContents.send(ipcChannels.fsChangeEvent, event)
  )
  fileService = activeFileService

  mainWindow = createWindow()
  const emitLog = (entry: import('@phaser-editor/contracts').LogEntry): void => {
    mainWindow?.webContents.send(ipcChannels.runnerLogEvent, entry)
  }
  previewService = new PreviewService(mainWindow, emitLog)
  unityUIPreviewService = new UnityUIPreviewService(mainWindow)
  const unityUIPreviewRoot = path.join(app.getPath('userData'), 'unity-ui-cache')
  unityUIService = new UnityUIService(unityUIPreviewRoot, (url) => unityUIPreviewService!.load(url))
  pluginService = new PluginService(store, path.join(app.getPath('userData'), 'plugins'), pluginHostPath, {
    editorVersion: app.getVersion(),
    onChanged: (plugins) => mainWindow?.webContents.send(ipcChannels.pluginsChangedEvent, plugins)
  })
  runnerService = new RunnerService(
    projectService,
    (session) => mainWindow?.webContents.send(ipcChannels.runnerStateEvent, session),
    emitLog
  )

  protocol.handle('phaser-asset', (request) => {
    const filePath = resolveProjectAssetUrl(request.url, path.sep)
    if (!filePath || !activeFileService.contains(filePath)) {
      return new Response('Forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })
  protocol.handle('phaser-plugin', async (request) => {
    try {
      const resource = await pluginService?.resolveProtocolResource(request.url)
      if (!resource) return new Response('Forbidden', { status: 403 })
      return new Response(new Uint8Array(resource.data), { headers: pluginProtocolHeaders(resource.contentType) })
    } catch (error) {
      return new Response((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'Not found' : 'Plugin resource could not be read', {
        status: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500
      })
    }
  })
  protocol.handle(UNITY_UI_PREVIEW_SCHEME, async (request) => {
    const filePath = resolveUnityUIPreviewUrl(request.url, unityUIPreviewRoot)
    if (!filePath) return new Response('Forbidden', { status: 403 })
    try {
      const content = await readFile(filePath)
      return new Response(new Uint8Array(content), { headers: { 'Content-Type': previewContentType(filePath) } })
    } catch (error) {
      return new Response((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'Not found' : 'Preview file could not be read', {
        status: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500
      })
    }
  })

  registerIpc({ store, projectService, fileService: activeFileService, runner: runnerService, plugins: pluginService, unityUI: unityUIService })
  await pluginService.activateEnabled()

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#1e1f22',
    show: false,
    title: 'Phaser Editor',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  window.setMenuBarVisibility(false)
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    previewService?.destroy()
    previewService = null
    unityUIPreviewService?.destroy()
    unityUIPreviewService = null
    unityUIService = null
    mainWindow = null
  })
  return window
}

function registerIpc(services: {
  store: ConfigStore
  projectService: ProjectService
  fileService: FileService
  runner: RunnerService
  plugins: PluginService
  unityUI: UnityUIService
}): void {
  const { store, projectService, fileService, runner, plugins, unityUI } = services

  ipcMain.handle(ipcChannels.projectListRecent, () => asResult(async () => projectService.listRecent()))
  ipcMain.handle(ipcChannels.projectRemoveRecent, (_event, projectPath: string) => asResult(() => projectService.removeRecent(projectPath)))
  ipcMain.handle(ipcChannels.projectOpen, (_event, requestedPath?: string) => asResult(async () => {
    let projectPath = requestedPath
    if (!projectPath) {
      const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory'],
        title: 'Open Phaser Project',
        defaultPath: app.getPath('documents')
      })
      if (result.canceled || !result.filePaths[0]) throw new AppError('CANCELLED', 'Open project was cancelled.')
      projectPath = result.filePaths[0]
    }
    const project = await projectService.open(projectPath)
    await fileService.watchProject(project.path)
    return project
  }))
  ipcMain.handle(ipcChannels.projectCreate, (_event, request: unknown) => asResult(async () => {
    const project = await projectService.create(projectCreateRequestSchema.parse(request))
    await fileService.watchProject(project.path)
    return project
  }))
  ipcMain.handle(ipcChannels.projectClose, () => asResult(async () => {
    await plugins.detachProject()
    await fileService.dispose()
    return projectService.close()
  }))

  ipcMain.handle(ipcChannels.fsList, (_event, requestedPath?: string) => asResult(() => fileService.list(requestedPath)))
  ipcMain.handle(ipcChannels.fsSearch, (_event, query: string) => asResult(() => fileService.search(query)))
  ipcMain.handle(ipcChannels.fsRead, (_event, filePath: string) => asResult(() => fileService.read(filePath)))
  ipcMain.handle(ipcChannels.fsWrite, (_event, filePath: string, content: string, expected?: number) => asResult(() => fileService.write(filePath, content, expected)))
  ipcMain.handle(ipcChannels.fsCreateFile, (_event, parent: string, name: string) => asResult(() => fileService.createFile(parent, name)))
  ipcMain.handle(ipcChannels.fsCreateDirectory, (_event, parent: string, name: string) => asResult(() => fileService.createDirectory(parent, name)))
  ipcMain.handle(ipcChannels.fsRename, (_event, source: string, name: string) => asResult(() => fileService.rename(source, name)))
  ipcMain.handle(ipcChannels.fsCopy, (_event, source: string, destination: string) => asResult(() => fileService.copy(source, destination)))
  ipcMain.handle(ipcChannels.fsMove, (_event, source: string, destination: string) => asResult(() => fileService.move(source, destination)))
  ipcMain.handle(ipcChannels.fsTrash, (_event, filePath: string) => asResult(() => fileService.trash(filePath)))
  ipcMain.handle(ipcChannels.fsStat, (_event, filePath: string) => asResult(() => fileService.stat(filePath)))

  ipcMain.handle(ipcChannels.runnerStart, (_event, config?: RunConfiguration) => asResult(() => runner.start(config)))
  ipcMain.handle(ipcChannels.runnerStop, () => asResult(() => runner.stop()))
  ipcMain.handle(ipcChannels.runnerRestart, (_event, config?: RunConfiguration) => asResult(() => runner.restart(config)))
  ipcMain.handle(ipcChannels.runnerInput, (_event, input: string) => asResult(() => runner.sendInput(input)))
  ipcMain.handle(ipcChannels.runnerState, () => asResult(async () => runner.getState()))
  ipcMain.handle(ipcChannels.runnerOpenExternal, (_event, url: string) => asResult(async () => {
    await shell.openExternal(url)
    return true as const
  }))

  ipcMain.handle(ipcChannels.previewShow, (_event, bounds) => asResult(() => previewService!.show(bounds)))
  ipcMain.handle(ipcChannels.previewHide, () => asResult(() => previewService!.hide()))
  ipcMain.handle(ipcChannels.previewLoad, (_event, url: string) => asResult(() => previewService!.load(url)))

  ipcMain.handle(ipcChannels.unityUIConfigure, (_event, configuration) => asResult(() => unityUI.configure(configuration)))
  ipcMain.handle(ipcChannels.unityUIRefreshPrefabs, () => asResult(() => unityUI.refreshPrefabs()))
  ipcMain.handle(ipcChannels.unityUIRebuildAssetIndex, () => asResult(() => unityUI.rebuildAssetIndex()))
  ipcMain.handle(ipcChannels.unityUIPreview, (_event, request) => asResult(() => unityUI.preview(request)))
  ipcMain.handle(ipcChannels.unityUIExportCurrent, (_event, outputRoot: string) => asResult(() => unityUI.exportCurrent(outputRoot)))
  ipcMain.handle(ipcChannels.unityUIShowPreview, (_event, bounds) => asResult(() => unityUIPreviewService!.show(bounds)))
  ipcMain.handle(ipcChannels.unityUIHidePreview, () => asResult(() => unityUIPreviewService!.hide()))

  ipcMain.handle(ipcChannels.settingsGet, () => asResult(async () => store.get()))
  ipcMain.handle(ipcChannels.settingsUpdate, (_event, patch: Partial<EditorSettings>) => asResult(() => store.update(patch)))
  ipcMain.handle(ipcChannels.dialogSelectDirectory, (_event, requestedDefaultPath?: string) => asResult(async () => {
    const defaultPath = requestedDefaultPath?.trim()
      ? path.resolve(requestedDefaultPath)
      : app.getPath('documents')
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Folder',
      defaultPath
    })
    if (result.canceled || !result.filePaths[0]) throw new AppError('CANCELLED', 'Folder selection was cancelled.')
    return result.filePaths[0]
  }))
  ipcMain.handle(ipcChannels.dialogSaveHtml, (_event, defaultName: string, html: string) => asResult(async () => {
    const result = await dialog.showSaveDialog(mainWindow!, { defaultPath: defaultName, filters: [{ name: 'HTML', extensions: ['html'] }] })
    if (result.canceled || !result.filePath) throw new AppError('CANCELLED', 'Export was cancelled.')
    const { promises: fs } = await import('node:fs')
    await fs.writeFile(result.filePath, html, 'utf8')
    return result.filePath
  }))

  ipcMain.handle(ipcChannels.pluginsList, () => asResult(() => plugins.list()))
  ipcMain.handle(ipcChannels.pluginsInstall, () => asResult(async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'], title: 'Install Phaser Editor Plugin' })
    if (result.canceled || !result.filePaths[0]) throw new AppError('CANCELLED', 'Plugin installation was cancelled.')
    return plugins.install(result.filePaths[0])
  }))
  ipcMain.handle(ipcChannels.pluginsEnable, (_event, id: string, enabled: boolean, scope?: 'global' | 'project') => asResult(() => plugins.setEnabled(id, enabled, scope)))
  ipcMain.handle(ipcChannels.pluginsAttachProject, (_event, projectPath: string) => asResult(async () => {
    assertActiveProjectPath(projectService, projectPath)
    return plugins.attachProject(projectPath)
  }))
  ipcMain.handle(ipcChannels.pluginsDetachProject, () => asResult(() => plugins.detachProject()))
  ipcMain.handle(ipcChannels.pluginsRefreshProject, () => asResult(() => plugins.refreshProject()))
  ipcMain.handle(ipcChannels.pluginsTrustProject, (_event, projectPath: string, decision: 'trust' | 'skip') => asResult(async () => {
    assertActiveProjectPath(projectService, projectPath)
    return plugins.trustProjectPlugins(projectPath, decision)
  }))
  ipcMain.handle(ipcChannels.pluginsReadResource, (_event, id: string, relativePath: string) => asResult(() => plugins.readResource(id, relativePath)))
  ipcMain.handle(ipcChannels.codeIntelligenceResolve, () => asResult(() => resolvePhaserDeclarations(projectService.activeProject?.path ?? null, process.cwd())))
  ipcMain.handle(ipcChannels.clipboardWrite, (_event, text: string) => asResult(async () => {
    clipboard.writeText(text)
    return true as const
  }))
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (shuttingDown) return
  shuttingDown = true
  try { previewService?.destroy() } catch { /* Shutdown must continue if a view is already destroyed. */ }
  previewService = null
  try { unityUIPreviewService?.destroy() } catch { /* Shutdown must continue if a view is already destroyed. */ }
  unityUIPreviewService = null
  unityUIService = null
  try { pluginService?.deactivateAll() } catch { /* Shutdown must continue if a plugin host already exited. */ }
  void fileService?.dispose()
  if (!runnerService?.hasActiveProcess()) {
    setImmediate(() => app.exit(0))
    return
  }
  event.preventDefault()
  void settleShutdownTasks([() => runnerService?.stop()]).finally(() => app.exit(0))
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void bootstrap()
})

void bootstrap()

function previewContentType(filePath: string): string {
  const extension = path.extname(filePath).toLocaleLowerCase()
  return ({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
  } as Record<string, string>)[extension] ?? 'application/octet-stream'
}

function assertActiveProjectPath(projectService: ProjectService, requestedPath: string): void {
  const activePath = projectService.activeProject?.path
  if (!activePath || normalizeForComparison(activePath) !== normalizeForComparison(requestedPath)) {
    throw new AppError('ACCESS_DENIED', 'Project plugin operations are limited to the active project.')
  }
}
