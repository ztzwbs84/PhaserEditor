import { useEffect, useRef } from 'react'
import { ExternalLink, LoaderCircle, Monitor, RefreshCw } from 'lucide-react'
import { useEditorStore } from '../../store/editor-store'

export function PreviewPanel(): React.JSX.Element {
  const run = useEditorStore((state) => state.runSession)
  const notify = useEditorStore((state) => state.notify)
  const viewport = useRef<HTMLDivElement>(null)
  const waiting = run.status === 'starting' || run.status === 'running'

  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const update = (): void => {
      const bounds = element.getBoundingClientRect()
      if (bounds.width > 1 && bounds.height > 1 && element.offsetParent !== null) {
        void window.editorApi.preview.show({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }).then((result) => {
          if (!result.ok) notify('error', result.error.message)
        })
      } else {
        void window.editorApi.preview.hide().then((result) => {
          if (!result.ok) notify('error', result.error.message)
        })
      }
    }
    const observer = new ResizeObserver(update)
    observer.observe(element)
    window.addEventListener('resize', update)
    update()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
      void window.editorApi.preview.hide().catch(() => undefined)
    }
  }, [notify])

  useEffect(() => {
    if (run.url) {
      void window.editorApi.preview.load(run.url).then((result) => {
        if (!result.ok) notify('error', result.error.message)
      })
    }
  }, [notify, run.url])

  return <div className="panel preview-panel">
    <div className="panel-toolbar preview-toolbar">
      <span className={`preview-state status-${run.status}`}><span className="status-dot" />{run.url ?? run.message ?? 'Preview offline'}</span>
      <span className="toolbar-spacer" />
      <button className="icon-button compact" title="Reload preview" disabled={!run.url} onClick={() => {
        if (run.url) void window.editorApi.preview.load(run.url).then((result) => { if (!result.ok) notify('error', result.error.message) })
      }}><RefreshCw size={14} /></button>
      <button className="icon-button compact" title="Open in external browser" disabled={!run.url} onClick={() => { if (run.url) void window.editorApi.runner.openExternal(run.url) }}><ExternalLink size={14} /></button>
    </div>
    <div ref={viewport} className="preview-viewport">
      {!run.url && <div className="preview-placeholder">{waiting ? <LoaderCircle className="spin" size={26} /> : <Monitor size={26} />}<span>{run.status === 'starting' ? 'Starting project...' : run.status === 'running' ? 'Waiting for preview server...' : 'No running project'}</span></div>}
    </div>
  </div>
}
