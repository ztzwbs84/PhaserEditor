import { useEffect, useMemo, useState } from 'react'
import { Clock3, FolderMinus, FolderOpen, Gamepad2, MoreHorizontal, Plus, Search, X } from 'lucide-react'
import type { ProjectDescriptor } from '@phaser-editor/contracts'
import { useEditorStore } from '../store/editor-store'

interface ProjectMenuState {
  project: ProjectDescriptor
  x: number
  y: number
}

export function ProjectCenter(): React.JSX.Element {
  const recent = useEditorStore((state) => state.recentProjects)
  const openProject = useEditorStore((state) => state.openProject)
  const createProject = useEditorStore((state) => state.createProject)
  const removeRecentProject = useEditorStore((state) => state.removeRecentProject)
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [openPath, setOpenPath] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [projectMenu, setProjectMenu] = useState<ProjectMenuState | null>(null)
  const [removeTarget, setRemoveTarget] = useState<ProjectDescriptor | null>(null)
  const filtered = useMemo(() => recent.filter((project) => `${project.name} ${project.path}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [query, recent])

  useEffect(() => {
    if (!projectMenu) return
    const closeMenu = (): void => setProjectMenu(null)
    const closeMenuOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeMenu()
    }
    window.addEventListener('pointerdown', closeMenu)
    window.addEventListener('keydown', closeMenuOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeMenu)
      window.removeEventListener('keydown', closeMenuOnEscape)
    }
  }, [projectMenu])

  const showProjectMenu = (project: ProjectDescriptor, x: number, y: number): void => {
    const menuWidth = 230
    const menuHeight = 42
    setProjectMenu({
      project,
      x: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8))
    })
  }

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
        <div className="project-table" role="grid" aria-label="Recent Phaser projects">
          <div className="project-row project-table-header" role="row">
            <span role="columnheader">Name</span><span role="columnheader">Modified</span><span role="columnheader">Editor version</span><span role="columnheader" aria-label="Actions" />
          </div>
          {filtered.map((project) => (
            <div
              key={project.path}
              className={`project-row${selectedPath === project.path ? ' selected' : ''}`}
              role="row"
              aria-selected={selectedPath === project.path}
              tabIndex={0}
              onDoubleClick={(event) => { if (event.target === event.currentTarget || !(event.target as HTMLElement).closest('.project-menu-trigger')) void openProject(project.path) }}
              onClick={() => setSelectedPath(project.path)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return
                if (event.key === 'Enter') void openProject(project.path)
                if (event.key === ' ') {
                  event.preventDefault()
                  setSelectedPath(project.path)
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                setSelectedPath(project.path)
                showProjectMenu(project, event.clientX, event.clientY)
              }}
            >
              <span className="project-name" role="cell"><span className="project-icon"><Gamepad2 size={18} /></span><span><strong>{project.name}</strong><small>{project.path}</small></span></span>
              <span className="muted" role="cell"><Clock3 size={14} />{formatRelative(project.lastOpenedAt)}</span>
              <span role="cell">{project.phaserVersion ?? 'Unknown'}</span>
              <span className="project-actions-cell" role="cell">
                <button
                  type="button"
                  className={`icon-button compact project-menu-trigger${projectMenu?.project.path === project.path ? ' active' : ''}`}
                  title={`Project actions for ${project.name}`}
                  aria-label={`Project actions for ${project.name}`}
                  aria-haspopup="menu"
                  aria-expanded={projectMenu?.project.path === project.path}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    setSelectedPath(project.path)
                    const bounds = event.currentTarget.getBoundingClientRect()
                    showProjectMenu(project, bounds.right - 230, bounds.bottom + 4)
                  }}
                ><MoreHorizontal size={17} /></button>
              </span>
            </div>
          ))}
          {filtered.length === 0 && <div className="empty-projects"><Gamepad2 size={28} /><span>No projects found</span></div>}
        </div>
      </section>
      {projectMenu && <div
        className="context-menu project-center-menu"
        role="menu"
        aria-label={`Actions for ${projectMenu.project.name}`}
        style={{ left: projectMenu.x, top: projectMenu.y }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button role="menuitem" className="danger" autoFocus onClick={() => {
          setRemoveTarget(projectMenu.project)
          setProjectMenu(null)
        }}><FolderMinus size={14} />Remove from recent projects</button>
      </div>}
      {openPath !== null && <OpenProjectDialog initialPath={openPath} onClose={() => setOpenPath(null)} onOpen={async (path) => {
        const opened = await openProject(path)
        if (opened) setOpenPath(null)
      }} />}
      {createOpen && <CreateProjectDialog onClose={() => setCreateOpen(false)} onCreate={async (request) => {
        const created = await createProject(request)
        if (created) setCreateOpen(false)
      }} />}
      {removeTarget && <RemoveProjectDialog project={removeTarget} onClose={() => setRemoveTarget(null)} onRemove={async () => {
        const removed = await removeRecentProject(removeTarget.path)
        if (removed && selectedPath === removeTarget.path) setSelectedPath(null)
        return removed
      }} />}
    </div>
  )
}

function RemoveProjectDialog({ project, onClose, onRemove }: {
  project: ProjectDescriptor
  onClose(): void
  onRemove(): Promise<boolean>
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)

  const remove = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    if (await onRemove()) onClose()
    else setBusy(false)
  }

  return (
    <div className="modal-backdrop" role="presentation" onKeyDown={(event) => { if (event.key === 'Escape' && !busy) onClose() }} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <div className="dialog remove-project-dialog" role="dialog" aria-modal="true" aria-labelledby="remove-project-title" aria-describedby="remove-project-description">
        <div className="dialog-header">
          <div><h2 id="remove-project-title">Remove project?</h2><p>{project.name}</p></div>
          <button className="icon-button" title="Close" disabled={busy} onClick={onClose}><X size={16} /></button>
        </div>
        <div className="remove-project-copy" id="remove-project-description">
          <p>This only removes the project from the Projects list. Files on disk will not be deleted.</p>
          <small title={project.path}>{project.path}</small>
        </div>
        <div className="dialog-footer">
          <button className="button" autoFocus disabled={busy} onClick={onClose}>Cancel</button>
          <button className="button danger-action" disabled={busy} onClick={() => void remove()}><FolderMinus size={15} />{busy ? 'Removing...' : 'Remove project'}</button>
        </div>
      </div>
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
        </div>
        <div className="dialog-footer">
          <button className="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="button primary" disabled={busy || !name.trim() || !target.trim()} onClick={async () => {
            setBusy(true)
            await onCreate({ name, targetDirectory: target, installDependencies: true })
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
