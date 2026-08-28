import { useEffect, useState, useSyncExternalStore } from 'react'
import { AlertTriangle, Box, Download, FolderCode, Globe2, RefreshCw, ShieldAlert, ShieldCheck, X } from 'lucide-react'
import type { InstalledPlugin, PluginScope } from '@phaser-editor/contracts'
import { useEditorStore } from '../store/editor-store'
import { pluginContributionRuntime } from '../lib/plugin-runtime'

export function PluginManager(): React.JSX.Element {
  useSyncExternalStore(pluginContributionRuntime.subscribe.bind(pluginContributionRuntime), pluginContributionRuntime.getRevision.bind(pluginContributionRuntime))
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([])
  const [loading, setLoading] = useState(true)
  const project = useEditorStore((state) => state.project)
  const setOpen = useEditorStore((state) => state.setPluginsOpen)
  const notify = useEditorStore((state) => state.notify)
  const refreshProjectPlugins = useEditorStore((state) => state.refreshProjectPlugins)
  const load = async (): Promise<void> => {
    const result = await window.editorApi.plugins.list()
    if (result.ok) {
      setPlugins(result.value)
      await pluginContributionRuntime.synchronize(result.value)
    } else notify('error', result.error.message)
    setLoading(false)
  }
  useEffect(() => {
    void load()
    return window.editorApi.plugins.onChanged((next) => setPlugins(next))
  }, [])
  const diagnostics = pluginContributionRuntime.getDiagnostics()
  const globalPlugins = plugins.filter((plugin) => plugin.scope === 'global')
  const projectPlugins = plugins.filter((plugin) => plugin.scope === 'project')
  const setEnabled = async (plugin: InstalledPlugin, enabled: boolean): Promise<void> => {
    const result = await window.editorApi.plugins.setEnabled(plugin.instanceId, enabled, plugin.scope)
    if (result.ok) {
      setPlugins(result.value)
      await pluginContributionRuntime.synchronize(result.value)
    } else notify('error', result.error.message)
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
    <div className="dialog plugin-dialog" role="dialog" aria-modal="true">
      <div className="dialog-header"><div><h2>Plugins</h2><p>Global and project extensions</p></div><button className="icon-button" title="Close plugin manager" onClick={() => setOpen(false)}><X size={16} /></button></div>
      <div className="plugin-toolbar">
        <div className="plugin-toolbar-actions">
          <button className="button" onClick={async () => {
            const result = await window.editorApi.plugins.installFromDirectory()
            if (result.ok) { notify('success', `Installed ${result.value.manifest.name}`); await load() }
            else if (result.error.code !== 'CANCELLED') notify('error', result.error.message)
          }}><Download size={15} />Install</button>
          <button className="button" disabled={!project} onClick={async () => { if (await refreshProjectPlugins()) await load() }}><RefreshCw size={15} />Refresh project</button>
        </div>
        <span><ShieldCheck size={14} />Project extensions load only after trust</span>
      </div>
      <div className="plugin-list">
        {loading
          ? <div className="panel-empty">Loading plugins...</div>
          : plugins.length === 0
            ? <div className="panel-empty"><Box size={22} /><span>No plugins found</span></div>
            : <>
                <PluginSection title="Project" scope="project" plugins={projectPlugins} onEnabledChange={setEnabled} />
                <PluginSection title="Global" scope="global" plugins={globalPlugins} onEnabledChange={setEnabled} />
              </>}
      </div>
      {diagnostics.length > 0 && <div className="plugin-diagnostics" role="status">
        {diagnostics.map((diagnostic, index) => <div key={`${diagnostic.instanceId ?? diagnostic.pluginId}:${diagnostic.contributionId ?? diagnostic.category}:${index}`} data-severity={diagnostic.severity ?? 'error'}><AlertTriangle size={13} /><span>{diagnostic.message}</span></div>)}
      </div>}
      <div className="dialog-footer"><button className="button primary" onClick={() => setOpen(false)}>Done</button></div>
    </div>
  </div>
}

function PluginSection({ title, scope, plugins, onEnabledChange }: {
  title: string
  scope: PluginScope
  plugins: InstalledPlugin[]
  onEnabledChange(plugin: InstalledPlugin, enabled: boolean): Promise<void>
}): React.JSX.Element {
  const ScopeIcon = scope === 'project' ? FolderCode : Globe2
  return <section className="plugin-section">
    <header><ScopeIcon size={14} /><strong>{title}</strong><span>{plugins.length}</span></header>
    {plugins.length === 0
      ? <div className="plugin-section-empty">No {scope} plugins</div>
      : plugins.map((plugin) => <div className="plugin-row" key={plugin.instanceId}>
          <div className="plugin-icon"><ScopeIcon size={18} /></div>
          <div className="plugin-details">
            <strong>{plugin.manifest.name}<small className={`plugin-build-state state-${plugin.build.state}`}>{plugin.build.state}</small></strong>
            <span>{plugin.manifest.id} · {plugin.manifest.version}{plugin.revision ? ` · ${plugin.revision.slice(0, 8)}` : ''}</span>
            <small>{plugin.manifest.permissions.join(', ') || 'No elevated permissions'}</small>
            {plugin.error && <em>{plugin.error}</em>}
            {plugin.build.diagnostics.map((diagnostic, index) => <em key={`${diagnostic.message}:${index}`} className={`diagnostic-${diagnostic.severity}`}>
              {formatDiagnostic(diagnostic)}
            </em>)}
          </div>
          <label className="switch" title={`${plugin.enabled ? 'Disable' : 'Enable'} ${plugin.manifest.name}`}><input type="checkbox" checked={plugin.enabled} onChange={(event) => { void onEnabledChange(plugin, event.target.checked) }} /><span /></label>
        </div>)}
  </section>
}

export function ProjectPluginTrustDialog(): React.JSX.Element | null {
  const request = useEditorStore((state) => state.pluginTrustRequest)
  const respond = useEditorStore((state) => state.respondProjectPluginTrust)
  if (!request) return null
  return <div className="modal-backdrop plugin-trust-backdrop">
    <div className="dialog plugin-trust-dialog" role="alertdialog" aria-modal="true" aria-labelledby="plugin-trust-title">
      <div className="dialog-header">
        <div><h2 id="plugin-trust-title">Trust project plugins?</h2><p>{request.projectPath}</p></div>
        <ShieldAlert size={22} />
      </div>
      <div className="plugin-trust-copy">This project contains local editor code. Trusting it allows the listed plugins to run with their declared permissions.</div>
      <div className="plugin-trust-list">
        {request.plugins.map((plugin) => <div key={plugin.id}><FolderCode size={16} /><div><strong>{plugin.name}</strong><span>{plugin.id}</span><small>{plugin.permissions.join(', ') || 'No elevated permissions'}</small></div></div>)}
      </div>
      <div className="dialog-footer plugin-trust-actions">
        <button className="button danger" onClick={() => respond('cancel')}>Cancel opening</button>
        <button className="button" onClick={() => respond('skip')}>Open without plugins</button>
        <button className="button primary" onClick={() => respond('trust')}>Trust and load</button>
      </div>
    </div>
  </div>
}

function formatDiagnostic(diagnostic: InstalledPlugin['build']['diagnostics'][number]): string {
  const location = diagnostic.file
    ? `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}${diagnostic.column ? `:${diagnostic.column}` : ''}` : ''}: `
    : ''
  return `${location}${diagnostic.message}`
}
