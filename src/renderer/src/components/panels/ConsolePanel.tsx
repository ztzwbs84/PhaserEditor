import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Bug, Clipboard, CornerDownLeft, Eraser, Info, Search, TriangleAlert } from 'lucide-react'
import type { LogEntry } from '@phaser-editor/contracts'
import { useEditorStore } from '../../store/editor-store'
import { useWorkspace } from '../Workspace'

export function ConsolePanel(): React.JSX.Element {
  const logs = useEditorStore((state) => state.logs)
  const clearLogs = useEditorStore((state) => state.clearLogs)
  const runSession = useEditorStore((state) => state.runSession)
  const notify = useEditorStore((state) => state.notify)
  const [query, setQuery] = useState('')
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [levels, setLevels] = useState(new Set<LogEntry['level']>(['debug', 'info', 'warning', 'error']))
  const logList = useRef<HTMLDivElement>(null)
  const { openDocument } = useWorkspace()
  const filtered = useMemo(() => logs.filter((entry) => levels.has(entry.level) && entry.message.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [levels, logs, query])
  const toggle = (level: LogEntry['level']): void => {
    const next = new Set(levels)
    if (next.has(level)) next.delete(level); else next.add(level)
    setLevels(next)
  }
  useEffect(() => {
    const list = logList.current
    if (list) list.scrollTop = list.scrollHeight
  }, [filtered.length])

  const sendInput = async (): Promise<void> => {
    const value = input.trim()
    if (!value || sending) return
    setSending(true)
    const result = await window.editorApi.runner.sendInput(value)
    setSending(false)
    if (result.ok) setInput('')
    else notify('error', result.error.message)
  }

  const acceptsInput = runSession.status === 'starting' || runSession.status === 'running'
  return (
    <div className="panel console-panel">
      <div className="panel-toolbar console-toolbar">
        <button className="icon-button compact" title="Clear console" onClick={clearLogs}><Eraser size={14} /></button>
        <button className="icon-button compact" title="Copy visible logs" onClick={() => void window.editorApi.clipboard.writeText(filtered.map((entry) => `[${entry.timestamp}] ${entry.level.toUpperCase()} ${entry.message}`).join('\n'))}><Clipboard size={14} /></button>
        <div className="search-box compact-search"><Search size={13} /><input placeholder="Filter logs" aria-label="Filter logs" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <span className="toolbar-spacer" />
        <span className={`console-session status-${runSession.status}`} title={runSession.message ?? runSession.status}><span className="status-dot" />{runStatusLabel(runSession.status)}</span>
        {(['info', 'warning', 'error', 'debug'] as const).map((level) => <button key={level} className={`log-filter ${levels.has(level) ? 'active' : ''}`} title={`Toggle ${level} logs`} onClick={() => toggle(level)}>{logIcon(level)}<span>{logs.filter((entry) => entry.level === level).length}</span></button>)}
      </div>
      <div className="log-list" ref={logList}>
        {filtered.map((entry) => <button key={entry.id} className={`log-row log-${entry.level}`} onDoubleClick={() => { if (entry.file) void openDocument(entry.file) }}>
          <span className="log-icon">{logIcon(entry.level)}</span>
          <time>{new Date(entry.timestamp).toLocaleTimeString()}</time>
          <span className="log-source">{entry.source}</span>
          <span className="log-message">{entry.message}</span>
          {entry.file && <span className="log-location">{entry.file}:{entry.line}</span>}
        </button>)}
        {filtered.length === 0 && <div className="panel-empty"><Info size={18} /><span>{logs.length === 0 ? 'Run the project to stream process and preview logs' : 'No matching log entries'}</span></div>}
      </div>
      <form className="console-input" onSubmit={(event) => { event.preventDefault(); void sendInput() }}>
        <span>&gt;</span>
        <input aria-label="Process input" value={input} onChange={(event) => setInput(event.target.value)} disabled={!acceptsInput || sending} placeholder={acceptsInput ? 'Send input to the running process' : 'Process input is available while the project runs'} spellCheck={false} />
        <button className="icon-button compact" title="Send process input" disabled={!acceptsInput || !input.trim() || sending}><CornerDownLeft size={14} /></button>
      </form>
    </div>
  )
}

function runStatusLabel(status: ReturnType<typeof useEditorStore.getState>['runSession']['status']): string {
  return status === 'starting' ? 'Starting' : status === 'running' ? 'Running' : status === 'error' ? 'Failed' : status === 'stopped' ? 'Stopped' : 'Idle'
}

function logIcon(level: LogEntry['level']): React.JSX.Element {
  return level === 'error' ? <AlertCircle size={14} /> : level === 'warning' ? <TriangleAlert size={14} /> : level === 'debug' ? <Bug size={14} /> : <Info size={14} />
}
