import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useEditorStore } from './store/editor-store'
import { ProjectCenter } from './components/ProjectCenter'
import { Workspace } from './components/Workspace'
import { QuickOpen } from './components/QuickOpen'
import { PluginManager, ProjectPluginTrustDialog } from './components/PluginManager'
import { pluginContributionRuntime } from './lib/plugin-runtime'

export function App(): React.JSX.Element {
  const ready = useEditorStore((state) => state.ready)
  const project = useEditorStore((state) => state.project)
  const settings = useEditorStore((state) => state.settings)
  const notices = useEditorStore((state) => state.notices)
  const quickOpen = useEditorStore((state) => state.quickOpen)
  const pluginsOpen = useEditorStore((state) => state.pluginsOpen)
  const initialize = useEditorStore((state) => state.initialize)
  const addLog = useEditorStore((state) => state.addLog)
  const setRunSession = useEditorStore((state) => state.setRunSession)
  const handleFileChange = useEditorStore((state) => state.handleFileChange)
  const dismissNotice = useEditorStore((state) => state.dismissNotice)

  useEffect(() => {
    pluginContributionRuntime.setReporter((diagnostic) => useEditorStore.getState().notify(diagnostic.severity ?? 'error', diagnostic.message))
    void initialize().then(() => pluginContributionRuntime.refresh())
    const offLog = window.editorApi.runner.onLog(addLog)
    const offState = window.editorApi.runner.onState(setRunSession)
    const offFileChange = window.editorApi.fileSystem.onChange((event) => { void handleFileChange(event) })
    const offPluginsChanged = window.editorApi.plugins.onChanged((plugins) => { void pluginContributionRuntime.synchronize(plugins) })
    return () => {
      offLog()
      offState()
      offFileChange()
      offPluginsChanged()
    }
  }, [addLog, handleFileChange, initialize, setRunSession])

  useEffect(() => {
    document.documentElement.dataset.theme = settings?.theme ?? 'dark'
  }, [settings?.theme])

  if (!ready) {
    return <div className="boot-screen"><div className="brand-mark">P</div><span>Loading Phaser Editor...</span></div>
  }

  return (
    <div className="app-root">
      {project ? <Workspace /> : <ProjectCenter />}
      {quickOpen && <QuickOpen />}
      {pluginsOpen && <PluginManager />}
      <ProjectPluginTrustDialog />
      <div className="notice-stack" aria-live="polite">
        {notices.map((notice) => (
          <div key={notice.id} className={`notice notice-${notice.level}`}>
            <span>{notice.message}</span>
            <button className="icon-button compact" onClick={() => dismissNotice(notice.id)} title="Dismiss notification"><X size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}
