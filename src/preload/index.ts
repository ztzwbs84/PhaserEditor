import { contextBridge, ipcRenderer } from 'electron'
import { ipcChannels, type EditorApi, type FileChangeEvent, type LogEntry, type RunSession } from '@phaser-editor/contracts'
import { createProjectAssetUrl } from '../shared/asset-url'

const api: EditorApi = {
  project: {
    listRecent: () => ipcRenderer.invoke(ipcChannels.projectListRecent),
    open: (path) => ipcRenderer.invoke(ipcChannels.projectOpen, path),
    create: (request) => ipcRenderer.invoke(ipcChannels.projectCreate, request),
    close: () => ipcRenderer.invoke(ipcChannels.projectClose),
    removeRecent: (path) => ipcRenderer.invoke(ipcChannels.projectRemoveRecent, path)
  },
  fileSystem: {
    list: (path) => ipcRenderer.invoke(ipcChannels.fsList, path),
    search: (query) => ipcRenderer.invoke(ipcChannels.fsSearch, query),
    read: (path) => ipcRenderer.invoke(ipcChannels.fsRead, path),
    write: (path, content, expectedModifiedAt) => ipcRenderer.invoke(ipcChannels.fsWrite, path, content, expectedModifiedAt),
    createFile: (parent, name) => ipcRenderer.invoke(ipcChannels.fsCreateFile, parent, name),
    createDirectory: (parent, name) => ipcRenderer.invoke(ipcChannels.fsCreateDirectory, parent, name),
    rename: (path, name) => ipcRenderer.invoke(ipcChannels.fsRename, path, name),
    copy: (source, destination) => ipcRenderer.invoke(ipcChannels.fsCopy, source, destination),
    move: (source, destination) => ipcRenderer.invoke(ipcChannels.fsMove, source, destination),
    trash: (path) => ipcRenderer.invoke(ipcChannels.fsTrash, path),
    stat: (path) => ipcRenderer.invoke(ipcChannels.fsStat, path),
    assetUrl: createProjectAssetUrl,
    onChange: (listener) => listen<FileChangeEvent>(ipcChannels.fsChangeEvent, listener)
  },
  runner: {
    start: (config) => ipcRenderer.invoke(ipcChannels.runnerStart, config),
    stop: () => ipcRenderer.invoke(ipcChannels.runnerStop),
    restart: (config) => ipcRenderer.invoke(ipcChannels.runnerRestart, config),
    sendInput: (input) => ipcRenderer.invoke(ipcChannels.runnerInput, input),
    getState: () => ipcRenderer.invoke(ipcChannels.runnerState),
    openExternal: (url) => ipcRenderer.invoke(ipcChannels.runnerOpenExternal, url),
    onState: (listener) => listen<RunSession>(ipcChannels.runnerStateEvent, listener),
    onLog: (listener) => listen<LogEntry>(ipcChannels.runnerLogEvent, listener)
  },
  preview: {
    show: (bounds) => ipcRenderer.invoke(ipcChannels.previewShow, bounds),
    hide: () => ipcRenderer.invoke(ipcChannels.previewHide),
    load: (url) => ipcRenderer.invoke(ipcChannels.previewLoad, url)
  },
  unityUI: {
    configure: (configuration) => ipcRenderer.invoke(ipcChannels.unityUIConfigure, configuration),
    refreshPrefabs: () => ipcRenderer.invoke(ipcChannels.unityUIRefreshPrefabs),
    rebuildAssetIndex: () => ipcRenderer.invoke(ipcChannels.unityUIRebuildAssetIndex),
    preview: (request) => ipcRenderer.invoke(ipcChannels.unityUIPreview, request),
    exportCurrent: (outputRoot) => ipcRenderer.invoke(ipcChannels.unityUIExportCurrent, outputRoot),
    showPreview: (bounds) => ipcRenderer.invoke(ipcChannels.unityUIShowPreview, bounds),
    hidePreview: () => ipcRenderer.invoke(ipcChannels.unityUIHidePreview)
  },
  settings: {
    get: () => ipcRenderer.invoke(ipcChannels.settingsGet),
    update: (patch) => ipcRenderer.invoke(ipcChannels.settingsUpdate, patch)
  },
  dialogs: {
    selectDirectory: (defaultPath) => ipcRenderer.invoke(ipcChannels.dialogSelectDirectory, defaultPath),
    saveHtml: (defaultName, html) => ipcRenderer.invoke(ipcChannels.dialogSaveHtml, defaultName, html)
  },
  plugins: {
    list: () => ipcRenderer.invoke(ipcChannels.pluginsList),
    installFromDirectory: () => ipcRenderer.invoke(ipcChannels.pluginsInstall),
    setEnabled: (id, enabled) => ipcRenderer.invoke(ipcChannels.pluginsEnable, id, enabled),
    readResource: (id, relativePath) => ipcRenderer.invoke(ipcChannels.pluginsReadResource, id, relativePath),
    resourceUrl: (path) => `phaser-plugin://local/?path=${encodeURIComponent(path)}`
  },
  codeIntelligence: {
    resolvePhaserDeclarations: () => ipcRenderer.invoke(ipcChannels.codeIntelligenceResolve)
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke(ipcChannels.clipboardWrite, text)
  }
}

function listen<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, value: T): void => listener(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('editorApi', api)
