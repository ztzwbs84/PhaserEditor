import { useEffect, useState, useSyncExternalStore } from 'react'
import { AlertTriangle, Box, Download, ShieldCheck, X } from 'lucide-react'
import type { InstalledPlugin } from '@phaser-editor/contracts'
import { useEditorStore } from '../store/editor-store'
import { pluginContributionRuntime } from '../lib/plugin-runtime'

export function PluginManager(): React.JSX.Element {
  useSyncExternalStore(pluginContributionRuntime.subscribe.bind(pluginContributionRuntime), pluginContributionRuntime.getRevision.bind(pluginContributionRuntime))
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([])
  const [loading, setLoading] = useState(true)
  const setOpen = useEditorStore((state) => state.setPluginsOpen)
  const notify = useEditorStore((state) => state.notify)
  const load = async (): Promise<void> => {
    const result = await window.editorApi.plugins.list()
    if (result.ok) {
      setPlugins(result.value)
      await pluginContributionRuntime.synchronize(result.value)
    }
    else notify('error', result.error.message)
    setLoading(false)
  }
  useEffect(() => { void load() }, [])
  const diagnostics = pluginContributionRuntime.getDiagnostics()
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
    <div className="dialog plugin-dialog" role="dialog" aria-modal="true">
      <div className="dialog-header"><div><h2>Plugins</h2><p>Local trusted extensions</p></div><button className="icon-button" title="Close plugin manager" onClick={() => setOpen(false)}><X size={16} /></button></div>
      <div className="plugin-toolbar"><button className="button" onClick={async () => {
        const result = await window.editorApi.plugins.installFromDirectory()
        if (result.ok) { notify('success', `Installed ${result.value.manifest.name}`); await load() }
        else if (result.error.code !== 'CANCELLED') notify('error', result.error.message)
      }}><Download size={15} />Install from folder</button><span><ShieldCheck size={14} />Plugins run with declared local permissions</span></div>
      <div className="plugin-list">{loading ? <div className="panel-empty">Loading plugins...</div> : plugins.length === 0 ? <div className="panel-empty"><Box size={22} /><span>No plugins installed</span></div> : plugins.map((plugin) => <div className="plugin-row" key={plugin.manifest.id}><div className="plugin-icon"><Box size={18} /></div><div><strong>{plugin.manifest.name}</strong><span>{plugin.manifest.id} · {plugin.manifest.version}</span><small>{plugin.manifest.permissions.join(', ') || 'No elevated permissions'}</small>{plugin.error && <em>{plugin.error}</em>}</div><label className="switch"><input type="checkbox" checked={plugin.enabled} onChange={async (event) => {
        const result = await window.editorApi.plugins.setEnabled(plugin.manifest.id, event.target.checked)
        if (result.ok) {
          setPlugins(result.value)
          await pluginContributionRuntime.synchronize(result.value)
        } else notify('error', result.error.message)
      }} /><span /></label></div>)}</div>
      {diagnostics.length > 0 && <div className="plugin-diagnostics" role="status">
        {diagnostics.map((diagnostic, index) => <div key={`${diagnostic.pluginId}:${diagnostic.contributionId ?? diagnostic.category}:${index}`}><AlertTriangle size={13} /><span>{diagnostic.message}</span></div>)}
      </div>}
      <div className="dialog-footer"><button className="button primary" onClick={() => setOpen(false)}>Done</button></div>
    </div>
  </div>
}
