import { useEffect, useMemo, useState } from 'react'
import { Clock3, FolderOpen, Gamepad2, MoreHorizontal, Plus, Search, X } from 'lucide-react'
import { useEditorStore } from '../store/editor-store'

export function ProjectCenter(): React.JSX.Element {
  const recent = useEditorStore((state) => state.recentProjects)
  const openProject = useEditorStore((state) => state.openProject)
  const createProject = useEditorStore((state) => state.createProject)
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [openPath, setOpenPath] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const filtered = useMemo(() => recent.filter((project) => `${project.name} ${project.path}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [query, recent])

  return (
    <div className="project-center">
      <aside className="project-sidebar">
        <div className="project-brand"><div className="brand-mark small">P</div><span>Phaser Editor</span></div>
        <nav>
          <button className="nav-item active"><Gamepad2 size={17} />Projects</button>
        </nav>
        <div className="version-label">Phaser 4.2.1</div>
      </aside>
      <section className="project-content">
        <header className="project-header">
          <div><h1>Projects</h1><p>Open or create a Phaser workspace</p></div>
          <div className="header-actions">
            <button className="button" onClick={() => setOpenPath(selectedPath ?? '')}><FolderOpen size={16} />Open project</button>
            <button className="button primary" onClick={() => setCreateOpen(true)}><Plus size={16} />New project</button>
          </div>
        </header>
        <div className="project-filter">
          <Search size={16} />
          <input aria-label="Search projects" placeholder="Search projects" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="project-table" role="table" aria-label="Recent Phaser projects">
          <div className="project-row project-table-header" role="row">
            <span>Name</span><span>Modified</span><span>Editor version</span><span />
          </div>
          {filtered.map((project) => (
            <button key={project.path} className={`project-row${selectedPath === project.path ? ' selected' : ''}`} role="row" aria-selected={selectedPath === project.path} onDoubleClick={() => void openProject(project.path)} onClick={() => setSelectedPath(project.path)}>
              <span className="project-name"><span className="project-icon"><Gamepad2 size={18} /></span><span><strong>{project.name}</strong><small>{project.path}</small></span></span>
              <span className="muted"><Clock3 size={14} />{formatRelative(project.lastOpenedAt)}</span>
              <span>{project.phaserVersion ?? 'Unknown'}</span>
              <span><MoreHorizontal size={17} /></span>
            </button>
          ))}
          {filtered.length === 0 && <div className="empty-projects"><Gamepad2 size={28} /><span>No projects found</span></div>}
        </div>
      </section>
      {openPath !== null && <OpenProjectDialog initialPath={openPath} onClose={() => setOpenPath(null)} onOpen={async (path) => {
        const opened = await openProject(path)
        if (opened) setOpenPath(null)
      }} />}
      {createOpen && <CreateProjectDialog onClose={() => setCreateOpen(false)} onCreate={async (request) => {
        const created = await createProject(request)
        if (created) setCreateOpen(false)
      }} />}
    </div>
  )
}

function OpenProjectDialog({ initialPath, onClose, onOpen }: {
  initialPath: string
  onClose(): void
  onOpen(path: string): Promise<void>
}): React.JSX.Element {
  const [projectPath, setProjectPath] = useState(initialPath)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (!projectPath.trim() || busy) return
    setBusy(true)
    await onOpen(projectPath.trim())
    setBusy(false)
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <div className="dialog open-project-dialog" role="dialog" aria-modal="true" aria-labelledby="open-project-title">
        <div className="dialog-header">
          <div><h2 id="open-project-title">Open Phaser project</h2><p>Select a project root containing package.json</p></div>
          <button className="icon-button" title="Close" disabled={busy} onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <div className="form-grid">
            <label><span>Project folder</span><div className="input-with-button"><input aria-label="Project folder" value={projectPath} onChange={(event) => setProjectPath(event.target.value)} autoFocus spellCheck={false} /><button type="button" className="icon-button" title="Choose project folder" onClick={async () => {
              const result = await window.editorApi.dialogs.selectDirectory(projectPath)
              if (result.ok) setProjectPath(result.value)
            }}><FolderOpen size={16} /></button></div></label>
          </div>
          <div className="dialog-footer">
            <button type="button" className="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="button primary" disabled={busy || !projectPath.trim()}>{busy ? 'Opening...' : 'Open project'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function CreateProjectDialog({ onClose, onCreate }: {
  onClose(): void
  onCreate(request: { name: string; targetDirectory: string; installDependencies: boolean }): Promise<void>
}): React.JSX.Element {
  const [name, setName] = useState('My Phaser Game')
  const [parent, setParent] = useState('')
  const [target, setTarget] = useState('')
  const [install, setInstall] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (parent) setTarget(`${parent.replace(/[\\/]$/, '')}\\${name}`)
  }, [name, parent])

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="create-project-title">
        <div className="dialog-header"><div><h2 id="create-project-title">Create Phaser project</h2><p>Vite + TypeScript · Phaser 4.2.1</p></div></div>
        <div className="form-grid">
          <label><span>Project name</span><input value={name} onChange={(event) => setName(event.target.value)} autoFocus /></label>
          <label><span>Parent folder</span><div className="input-with-button"><input value={parent} onChange={(event) => setParent(event.target.value)} /><button className="icon-button" title="Choose parent folder" onClick={async () => {
            const result = await window.editorApi.dialogs.selectDirectory(parent)
            if (result.ok) setParent(result.value)
          }}><FolderOpen size={16} /></button></div></label>
          <label><span>Target directory</span><input value={target} onChange={(event) => setTarget(event.target.value)} /></label>
          <label className="check-row"><input type="checkbox" checked={install} onChange={(event) => setInstall(event.target.checked)} /><span>Install npm dependencies</span></label>
        </div>
        <div className="dialog-footer">
          <button className="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="button primary" disabled={busy || !name.trim() || !target.trim()} onClick={async () => {
            setBusy(true)
            await onCreate({ name, targetDirectory: target, installDependencies: install })
            setBusy(false)
          }}>{busy ? 'Creating...' : 'Create project'}</button>
        </div>
      </div>
    </div>
  )
}

function formatRelative(value: string): string {
  const milliseconds = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(milliseconds)) return 'Unknown'
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
