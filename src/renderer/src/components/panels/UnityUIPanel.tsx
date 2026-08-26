import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Boxes,
  Database,
  Download,
  FileBox,
  Folder,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  Search,
  XCircle
} from 'lucide-react'
import type {
  UnityUIConfiguration,
  UnityUIDiagnostic,
  UnityUIPrefabEntry,
  UnityUIPreviewResult,
  UnityUIWorkspaceState
} from '@phaser-editor/contracts'
import { useEditorStore } from '../../store/editor-store'

type BusyState = 'configure' | 'refresh' | 'index' | 'preview' | 'export' | null
type DiagnosticFilter = 'all' | UnityUIDiagnostic['severity']

const emptyConfiguration: UnityUIConfiguration = {
  prefabRoot: '',
  uiRawRoot: '',
  referenceResolution: { x: 750, y: 1334 }
}

export function UnityUIPanel(): React.JSX.Element {
  const project = useEditorStore((state) => state.project)!
  const settings = useEditorStore((state) => state.settings)
  const updateSettings = useEditorStore((state) => state.updateSettings)
  const notify = useEditorStore((state) => state.notify)
  const savedConfiguration = settings?.unityUIConfigurations[project.path]
  const [configuration, setConfiguration] = useState<UnityUIConfiguration>(() => cloneConfiguration(savedConfiguration ?? emptyConfiguration))
  const [workspace, setWorkspace] = useState<UnityUIWorkspaceState | null>(null)
  const [selectedPath, setSelectedPath] = useState(savedConfiguration?.lastPrefabRelativePath ?? '')
  const [preview, setPreview] = useState<UnityUIPreviewResult | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<BusyState>(null)
  const [error, setError] = useState('')
  const [diagnosticFilter, setDiagnosticFilter] = useState<DiagnosticFilter>('all')
  const viewport = useRef<HTMLDivElement>(null)
  const latestRequest = useRef('')
  const autoConfigured = useRef(false)

  const persistConfiguration = useCallback(async (next: UnityUIConfiguration) => {
    await updateSettings({
      unityUIConfigurations: {
        ...(useEditorStore.getState().settings?.unityUIConfigurations ?? {}),
        [project.path]: cloneConfiguration(next)
      }
    })
  }, [project.path, updateSettings])

  const previewPrefab = useCallback(async (entry: UnityUIPrefabEntry, sourceConfiguration = configuration) => {
    const requestId = crypto.randomUUID()
    latestRequest.current = requestId
    setSelectedPath(entry.relativePath)
    setPreview(null)
    setError('')
    setBusy('preview')
    await window.editorApi.unityUI.hidePreview()
    const result = await window.editorApi.unityUI.preview({ relativePath: entry.relativePath, requestId })
    if (latestRequest.current !== requestId) return
    setBusy(null)
    if (!result.ok) {
      setError(result.error.message)
      notify('error', result.error.message)
      return
    }
    if (result.value.stale) return
    setPreview(result.value)
    const nextConfiguration = { ...sourceConfiguration, lastPrefabRelativePath: entry.relativePath }
    setConfiguration(nextConfiguration)
    void persistConfiguration(nextConfiguration)
  }, [configuration, notify, persistConfiguration])

  const configure = useCallback(async (source: UnityUIConfiguration, restoreSelection = true) => {
    latestRequest.current = ''
    setPreview(null)
    setError('')
    setBusy('configure')
    await window.editorApi.unityUI.hidePreview()
    const result = await window.editorApi.unityUI.configure(source)
    setBusy(null)
    if (!result.ok) {
      setWorkspace(null)
      setError(result.error.message)
      notify('error', result.error.message)
      return
    }
    const nextConfiguration = {
      ...result.value.configuration,
      lastPrefabRelativePath: source.lastPrefabRelativePath
    }
    setConfiguration(nextConfiguration)
    setWorkspace(result.value)
    await persistConfiguration(nextConfiguration)
    const restored = restoreSelection && source.lastPrefabRelativePath
      ? result.value.prefabs.find((entry) => entry.relativePath === source.lastPrefabRelativePath)
      : undefined
    if (restored) await previewPrefab(restored, nextConfiguration)
    else setSelectedPath('')
  }, [notify, persistConfiguration, previewPrefab])

  useEffect(() => {
    if (autoConfigured.current || !savedConfiguration?.prefabRoot || !savedConfiguration.uiRawRoot) return
    autoConfigured.current = true
    void configure(cloneConfiguration(savedConfiguration))
  }, [configure, savedConfiguration])

  useEffect(() => {
    const element = viewport.current
    if (!element || !preview) {
      void window.editorApi.unityUI.hidePreview()
      return
    }
    const update = (): void => {
      const bounds = element.getBoundingClientRect()
      if (bounds.width > 1 && bounds.height > 1 && element.offsetParent !== null) {
        void window.editorApi.unityUI.showPreview({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }).then((result) => {
          if (!result.ok) notify('error', result.error.message)
        })
      } else void window.editorApi.unityUI.hidePreview()
    }
    const observer = new ResizeObserver(update)
    observer.observe(element)
    window.addEventListener('resize', update)
    update()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
      void window.editorApi.unityUI.hidePreview().catch(() => undefined)
    }
  }, [notify, preview])

  const filteredPrefabs = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return normalized
      ? workspace?.prefabs.filter((entry) => entry.relativePath.toLocaleLowerCase().includes(normalized)) ?? []
      : workspace?.prefabs ?? []
  }, [query, workspace?.prefabs])
  const treeRows = useMemo(() => buildTreeRows(filteredPrefabs), [filteredPrefabs])
  const diagnostics = useMemo(() => preview?.diagnostics.filter((diagnostic) => diagnosticFilter === 'all' || diagnostic.severity === diagnosticFilter) ?? [], [diagnosticFilter, preview?.diagnostics])
  const selectedEntry = workspace?.prefabs.find((entry) => entry.relativePath === selectedPath)

  const chooseDirectory = async (field: 'prefabRoot' | 'uiRawRoot'): Promise<void> => {
    const result = await window.editorApi.dialogs.selectDirectory(configuration[field])
    if (result.ok) setConfiguration((current) => ({ ...current, [field]: result.value }))
    else if (result.error.code !== 'CANCELLED') notify('error', result.error.message)
  }

  const refreshPrefabs = async (): Promise<void> => {
    setBusy('refresh')
    const result = await window.editorApi.unityUI.refreshPrefabs()
    setBusy(null)
    if (!result.ok) return notify('error', result.error.message)
    setWorkspace(result.value)
    if (selectedPath && !result.value.prefabs.some((entry) => entry.relativePath === selectedPath)) {
      setSelectedPath('')
      setPreview(null)
      await window.editorApi.unityUI.hidePreview()
    }
  }

  const rebuildAssetIndex = async (): Promise<void> => {
    setBusy('index')
    const result = await window.editorApi.unityUI.rebuildAssetIndex()
    setBusy(null)
    if (!result.ok) return notify('error', result.error.message)
    setWorkspace(result.value)
    notify('success', `Indexed ${result.value.assetIndex.metaFileCount} Unity asset metadata files`)
  }

  const exportCurrent = async (): Promise<void> => {
    const directory = await window.editorApi.dialogs.selectDirectory(project.path)
    if (!directory.ok) {
      if (directory.error.code !== 'CANCELLED') notify('error', directory.error.message)
      return
    }
    setBusy('export')
    const result = await window.editorApi.unityUI.exportCurrent(directory.value)
    setBusy(null)
    if (!result.ok) return notify('error', result.error.message)
    notify('success', `Unity UI exported to ${result.value.outputDirectory}`)
  }

  return <div className="panel unity-ui-panel">
    <section className="unity-ui-config" aria-label="Unity UI source configuration">
      <PathField label="Prefab directory" value={configuration.prefabRoot} onChange={(value) => setConfiguration((current) => ({ ...current, prefabRoot: value }))} onBrowse={() => void chooseDirectory('prefabRoot')} />
      <PathField label="UIRaw directory" value={configuration.uiRawRoot} onChange={(value) => setConfiguration((current) => ({ ...current, uiRawRoot: value }))} onBrowse={() => void chooseDirectory('uiRawRoot')} />
      <button className="button primary unity-ui-load" disabled={busy !== null} onClick={() => void configure(configuration, false)}>{busy === 'configure' ? <LoaderCircle className="spin" size={14} /> : <Boxes size={14} />}Load</button>
      <details className="unity-ui-advanced">
        <summary>Reference resolution</summary>
        <label>W<input type="number" min="1" step="1" value={configuration.referenceResolution.x} onChange={(event) => setConfiguration((current) => ({ ...current, referenceResolution: { ...current.referenceResolution, x: Number(event.target.value) } }))} /></label>
        <label>H<input type="number" min="1" step="1" value={configuration.referenceResolution.y} onChange={(event) => setConfiguration((current) => ({ ...current, referenceResolution: { ...current.referenceResolution, y: Number(event.target.value) } }))} /></label>
      </details>
    </section>
    <div className="unity-ui-workspace">
      <aside className="unity-ui-prefabs">
        <header className="unity-ui-pane-header"><strong>Prefabs</strong><span>{workspace?.prefabs.length ?? 0}</span></header>
        <div className="unity-ui-list-toolbar">
          <label className="unity-ui-search"><Search size={13} /><input aria-label="Search Unity Prefabs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" /></label>
          <button className="icon-button compact" title="Refresh Prefab list" disabled={!workspace || busy !== null} onClick={() => void refreshPrefabs()}><RefreshCw size={14} /></button>
          <button className="icon-button compact" title="Rebuild Unity asset index" disabled={!workspace || busy !== null} onClick={() => void rebuildAssetIndex()}><Database size={14} /></button>
        </div>
        <div className="unity-ui-prefab-tree" role="listbox" aria-label="Unity Prefabs">
          {treeRows.map((row) => row.kind === 'folder'
            ? <div className="unity-ui-folder-row" key={row.key} style={{ paddingLeft: 8 + row.depth * 13 }}><Folder size={13} /><span>{row.label}</span></div>
            : <button role="option" aria-selected={selectedPath === row.entry.relativePath} className={selectedPath === row.entry.relativePath ? 'unity-ui-prefab-row selected' : 'unity-ui-prefab-row'} key={row.key} style={{ paddingLeft: 9 + row.depth * 13 }} disabled={busy === 'configure' || busy === 'index'} onClick={() => void previewPrefab(row.entry)}><FileBox size={13} /><span>{row.entry.name.replace(/\.prefab$/i, '')}</span></button>)}
          {workspace && treeRows.length === 0 && <div className="unity-ui-empty">No matching Prefabs</div>}
          {!workspace && <div className="unity-ui-empty">{busy === 'configure' ? 'Indexing Unity Assets and scanning Prefabs...' : 'Configure the Unity directories to load Prefabs.'}</div>}
        </div>
      </aside>
      <section className="unity-ui-preview-column">
        <header className="unity-ui-preview-toolbar">
          <span className="unity-ui-preview-title">{selectedEntry?.relativePath ?? 'Phaser preview'}</span>
          <span className="toolbar-spacer" />
          <button className="icon-button compact" title="Reconvert selected Prefab" disabled={!selectedEntry || busy !== null} onClick={() => { if (selectedEntry) void previewPrefab(selectedEntry) }}><RefreshCw size={14} /></button>
          <button className="icon-button compact" title="Export current conversion" disabled={!preview || busy !== null} onClick={() => void exportCurrent()}>{busy === 'export' ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />}</button>
        </header>
        <div ref={viewport} className="unity-ui-preview-viewport">
          <div className="unity-ui-preview-placeholder">
            {busy === 'preview' ? <><LoaderCircle className="spin" size={24} /><span>Converting {selectedEntry?.name ?? 'Prefab'}...</span></>
              : error ? <><XCircle size={24} /><span>{error}</span></>
                : preview ? <><Boxes size={24} /><span>Phaser preview ready</span></>
                  : <><FileBox size={24} /><span>Select a Prefab to preview it.</span></>}
          </div>
        </div>
      </section>
      <aside className="unity-ui-report">
        <header className="unity-ui-pane-header"><strong>Conversion</strong>{preview && <span>{preview.durationMs} ms</span>}</header>
        {preview ? <>
          <div className="unity-ui-stat-grid">
            <Stat label="Nodes" value={preview.statistics.nodeCount} />
            <Stat label="Resources" value={preview.statistics.resourceCount} />
            <Stat label="Nested" value={preview.statistics.nestedPrefabCount} />
            <Stat label="Copied" value={preview.copiedResources} />
            <Stat label="Warnings" value={preview.statistics.warningCount} tone="warning" />
            <Stat label="Errors" value={preview.statistics.errorCount} tone="error" />
          </div>
          <div className="unity-ui-component-summary">{Object.entries(preview.statistics.componentCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => <span key={name}>{name}<b>{count}</b></span>)}</div>
          <div className="unity-ui-diagnostic-tabs" role="tablist" aria-label="Diagnostic severity">
            {(['all', 'error', 'warning', 'info'] as const).map((filter) => <button role="tab" aria-selected={diagnosticFilter === filter} className={diagnosticFilter === filter ? 'active' : ''} key={filter} onClick={() => setDiagnosticFilter(filter)}>{filter}</button>)}
          </div>
          <div className="unity-ui-diagnostics">
            {diagnostics.map((diagnostic, index) => <article className={`unity-ui-diagnostic severity-${diagnostic.severity}`} key={`${diagnostic.code}-${index}`}>
              {diagnostic.severity === 'error' ? <XCircle size={13} /> : <AlertTriangle size={13} />}
              <div><strong>{diagnostic.code}</strong><p>{diagnostic.message}</p></div>
            </article>)}
            {diagnostics.length === 0 && <div className="unity-ui-empty">No diagnostics in this filter.</div>}
          </div>
        </> : <div className="unity-ui-project-summary">
          {workspace ? <><span>Unity {workspace.unityVersion ?? 'version unknown'}</span><span>{workspace.assetIndex.metaFileCount} asset metadata files</span><span>{workspace.assetsRoot}</span></> : <span>Conversion details appear after previewing a Prefab.</span>}
        </div>}
      </aside>
    </div>
  </div>
}

function PathField({ label, value, onChange, onBrowse }: { label: string; value: string; onChange(value: string): void; onBrowse(): void }): React.JSX.Element {
  return <label className="unity-ui-path-field"><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} /><button type="button" className="icon-button compact" title={`Select ${label}`} onClick={onBrowse}><FolderOpen size={14} /></button></label>
}

function Stat({ label, value, tone = '' }: { label: string; value: number; tone?: 'warning' | 'error' | '' }): React.JSX.Element {
  return <div className={`unity-ui-stat ${tone}`}><span>{label}</span><strong>{value}</strong></div>
}

type TreeRow =
  | { kind: 'folder'; key: string; label: string; depth: number }
  | { kind: 'prefab'; key: string; depth: number; entry: UnityUIPrefabEntry }

function buildTreeRows(entries: UnityUIPrefabEntry[]): TreeRow[] {
  const rows: TreeRow[] = []
  const folders = new Set<string>()
  for (const entry of entries) {
    const parts = entry.relativePath.split('/')
    for (let index = 0; index < parts.length - 1; index += 1) {
      const folder = parts.slice(0, index + 1).join('/')
      if (!folders.has(folder)) {
        folders.add(folder)
        rows.push({ kind: 'folder', key: `folder:${folder}`, label: parts[index]!, depth: index })
      }
    }
    rows.push({ kind: 'prefab', key: `prefab:${entry.relativePath}`, depth: parts.length - 1, entry })
  }
  return rows
}

function cloneConfiguration(configuration: UnityUIConfiguration): UnityUIConfiguration {
  return { ...configuration, referenceResolution: { ...configuration.referenceResolution } }
}
