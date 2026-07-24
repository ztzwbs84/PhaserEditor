import { FolderOpen, LayoutPanelTop, Play, Redo2, RefreshCw, RotateCw, Save, Search, Square, Undo2 } from 'lucide-react'
import { commandRegistry } from '../../lib/commands'
import { useEditorStore } from '../../store/editor-store'
import { useSceneStore } from '../../store/scene-store'
import { useAuthoringHistoryStore } from '../../store/authoring-history-store'

export function Toolbar(): React.JSX.Element {
  const run = useEditorStore((state) => state.runSession)
  const project = useEditorStore((state) => state.project)
  const running = run.status === 'running' || run.status === 'starting'
  const activeScenePath = useSceneStore((state) => state.activePath)
  const activeScene = useSceneStore((state) => activeScenePath ? state.scenes[activeScenePath] : undefined)
  const selectedPath = useEditorStore((state) => state.selectedPath)
  const selectedDocument = useEditorStore((state) => selectedPath ? state.documents[selectedPath] : undefined)
  const authoringHistory = useAuthoringHistoryStore((state) => selectedPath ? state.records[selectedPath] : undefined)
  const canUndo = selectedDocument?.kind === 'scene'
    ? activeScene?.status === 'editable' && activeScene.history.cursor > 0
    : authoringHistory ? authoringHistory.cursor > 0 : true
  const canRedo = selectedDocument?.kind === 'scene'
    ? activeScene?.status === 'editable' && activeScene.history.cursor < activeScene.history.entries.length
    : authoringHistory ? authoringHistory.cursor < authoringHistory.entries.length - 1 : true
  return (
    <div className="toolbar">
      <ToolButton title="Open project" command="project.open"><FolderOpen size={16} /></ToolButton>
      <ToolButton title="Save" command="workspace.save"><Save size={16} /></ToolButton>
      <span className="toolbar-separator" />
      <ToolButton title="Undo" command="workspace.undo" disabled={!canUndo}><Undo2 size={16} /></ToolButton>
      <ToolButton title="Redo" command="workspace.redo" disabled={!canRedo}><Redo2 size={16} /></ToolButton>
      <div className="run-controls">
        <ToolButton title="Run project" command="run.start" active={running} disabled={running}><Play size={17} fill="currentColor" /></ToolButton>
        <ToolButton title="Stop project" command="run.stop" disabled={!running}><Square size={15} fill="currentColor" /></ToolButton>
        <ToolButton title="Restart project" command="run.restart" disabled={!project}><RotateCw size={16} /></ToolButton>
      </div>
      <div className="toolbar-spacer" />
      <div className="unity-toolbar-right">
        <ToolButton title="Refresh assets" command="project.refresh"><RefreshCw size={14} /></ToolButton>
        <ToolButton title="Search project" command="workspace.search"><Search size={14} /></ToolButton>
        <ToolButton title="Reset layout" command="view.resetLayout"><LayoutPanelTop size={14} /></ToolButton>
      </div>
      <span className={`run-badge status-${run.status}`} title={statusLabel(run.status)}><span className="status-dot" /></span>
    </div>
  )
}

function ToolButton({ title, command, children, active, disabled }: { title: string; command: string; children: React.ReactNode; active?: boolean; disabled?: boolean }): React.JSX.Element {
  return <button className={`icon-button toolbar-button${active ? ' active' : ''}`} title={title} disabled={disabled} onClick={() => void commandRegistry.execute(command)}>{children}</button>
}

function statusLabel(status: string): string {
  return status === 'starting' ? 'Starting' : status === 'running' ? 'Running' : status === 'error' ? 'Error' : status === 'stopped' ? 'Stopped' : 'Not running'
}
