import { useEffect, useState } from 'react'
import { AlertTriangle, LoaderCircle, RotateCcw } from 'lucide-react'
import type { EditorDocument } from '@phaser-editor/contracts'
import type { PluginSurfaceComponent } from '../../lib/plugin-runtime'

export function LazyPluginSurface({
  name,
  pluginId,
  contributionId,
  document,
  load
}: {
  name: string
  pluginId: string
  contributionId: string
  document?: EditorDocument
  load(retry: boolean): Promise<PluginSurfaceComponent>
}): React.JSX.Element {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ component?: PluginSurfaceComponent; error?: Error }>({})

  useEffect(() => {
    let current = true
    setState({})
    void load(attempt > 0).then(
      (component) => { if (current) setState({ component }) },
      (error) => { if (current) setState({ error: error instanceof Error ? error : new Error(String(error)) }) }
    )
    return () => { current = false }
  }, [attempt, contributionId, load, pluginId])

  if (state.error) return <div className="lazy-plugin-surface panel-error" role="alert">
    <AlertTriangle size={24} />
    <strong>{name} could not be loaded</strong>
    <span>{state.error.message}</span>
    <button className="button" onClick={() => setAttempt((value) => value + 1)}><RotateCcw size={15} />Retry</button>
  </div>
  if (!state.component) return <div className="lazy-plugin-surface editor-loading"><LoaderCircle className="spin" size={20} />Loading {name}...</div>
  const Surface = state.component
  return <div className="lazy-plugin-surface"><Surface pluginId={pluginId} contributionId={contributionId} document={document} /></div>
}
