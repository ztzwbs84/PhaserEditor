import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Braces,
  ChevronDown,
  ChevronRight,
  File,
  FileAudio,
  FileCode2,
  FileImage,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Map,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Trash2
} from 'lucide-react'
import type { FileEntry } from '@phaser-editor/contracts'
import { useEditorStore } from '../../store/editor-store'
import { useWorkspace } from '../Workspace'
import { SCENE_ASSET_MIME } from '../../lib/scene-assets'

interface ContextMenuState {
  x: number
  y: number
  entry: FileEntry | null
}

export function Explorer(): React.JSX.Element {
  const project = useEditorStore((state) => state.project)!
  const selectedPath = useEditorStore((state) => state.selectedPath)
  const selectPath = useEditorStore((state) => state.selectPath)
  const rebaseDocuments = useEditorStore((state) => state.rebaseDocuments)
  const handleFileChange = useEditorStore((state) => state.handleFileChange)
  const notify = useEditorStore((state) => state.notify)
  const createScene = useEditorStore((state) => state.createScene)
  const { openDocument } = useWorkspace()
  const [children, setChildren] = useState<Record<string, FileEntry[]>>({})
  const childrenRef = useRef(children)
  const [expanded, setExpanded] = useState<Set<string>>(new Set([project.path]))
  const [currentDirectory, setCurrentDirectory] = useState(project.path)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FileEntry[] | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [folderPaneWidth, setFolderPaneWidth] = useState(220)
  const searchTimer = useRef<number | undefined>(undefined)
  const searchInput = useRef<HTMLInputElement>(null)
  const splitBody = useRef<HTMLDivElement>(null)

  useEffect(() => { childrenRef.current = children }, [children])

  const loadDirectory = useCallback(async (directory: string, force = false): Promise<FileEntry[] | null> => {
    if (!force && childrenRef.current[directory]) return childrenRef.current[directory]!
    const result = await window.editorApi.fileSystem.list(directory)
    if (!result.ok) {
      notify('error', result.error.message)
      return null
    }
    setChildren((current) => ({ ...current, [directory]: result.value }))
    return result.value
  }, [notify])

  const refresh = useCallback(async () => {
    const directories = new Set([...expanded, currentDirectory, project.path])
    await Promise.all([...directories].map((directory) => loadDirectory(directory, true)))
  }, [currentDirectory, expanded, loadDirectory, project.path])

  useEffect(() => {
    setChildren({})
    setExpanded(new Set([project.path]))
    setCurrentDirectory(project.path)
    setQuery('')
    setSearchResults(null)
    void loadDirectory(project.path, true)
  }, [loadDirectory, project.path])

  useEffect(() => {
    const refreshHandler = (): void => { void refresh() }
    const focusHandler = (): void => { searchInput.current?.focus() }
    window.addEventListener('phaser-editor:refresh-assets', refreshHandler)
    window.addEventListener('phaser-editor:focus-project-search', focusHandler)
    const offChange = window.editorApi.fileSystem.onChange(() => { void refresh() })
    return () => {
      window.removeEventListener('phaser-editor:refresh-assets', refreshHandler)
      window.removeEventListener('phaser-editor:focus-project-search', focusHandler)
      offChange()
    }
  }, [refresh])

  useEffect(() => {
    window.clearTimeout(searchTimer.current)
    if (!query.trim()) {
      setSearchResults(null)
      return
    }
    searchTimer.current = window.setTimeout(async () => {
      const result = await window.editorApi.fileSystem.search(query)
      if (result.ok) setSearchResults(result.value.filter((entry) => entry.kind === 'file'))
      else notify('error', result.error.message)
    }, 160)
    return () => window.clearTimeout(searchTimer.current)
  }, [notify, query])

  const selectDirectory = useCallback(async (path: string) => {
    setCurrentDirectory(path)
    selectPath(path)
    await loadDirectory(path)
  }, [loadDirectory, selectPath])

  const toggleDirectory = useCallback(async (entry: FileEntry) => {
    const isExpanded = expanded.has(entry.path)
    if (!isExpanded) await loadDirectory(entry.path)
    setExpanded((current) => {
      const next = new Set(current)
      if (isExpanded) next.delete(entry.path); else next.add(entry.path)
      return next
    })
  }, [expanded, loadDirectory])

  const createItem = async (kind: 'file' | 'directory', parent: string): Promise<void> => {
    const name = window.prompt(kind === 'file' ? 'File name' : 'Folder name')
    if (!name) return
    const result = kind === 'file'
      ? await window.editorApi.fileSystem.createFile(parent, name)
      : await window.editorApi.fileSystem.createDirectory(parent, name)
    if (!result.ok) notify('error', result.error.message)
    else {
      await loadDirectory(parent, true)
      if (kind === 'directory') setExpanded((current) => new Set(current).add(parent))
    }
  }

  const createVisualScene = async (parent: string): Promise<void> => {
    const name = window.prompt('Scene name', 'MainScene')
    if (!name) return
    const document = await createScene(parent, name)
    if (document) await openDocument(document.path)
  }

  const rename = async (entry: FileEntry): Promise<void> => {
    const name = window.prompt('New name', entry.name)
    if (!name || name === entry.name) return
    const result = await window.editorApi.fileSystem.rename(entry.path, name)
    if (!result.ok) {
      notify('error', result.error.message)
      return
    }
    rebaseDocuments(entry.path, result.value.path)
    setCurrentDirectory((current) => rebasePath(current, entry.path, result.value.path))
    setExpanded((current) => new Set([...current].map((path) => rebasePath(path, entry.path, result.value.path))))
    selectPath(rebasePath(selectedPath ?? '', entry.path, result.value.path) || result.value.path)
    await refresh()
  }

  const move = async (source: string, directory: string): Promise<void> => {
    if (source === directory || isSameOrDescendant(directory, source)) return
    const result = await window.editorApi.fileSystem.move(source, directory)
    if (!result.ok) {
      notify('error', result.error.message)
      return
    }
    rebaseDocuments(source, result.value.path)
    setCurrentDirectory((current) => rebasePath(current, source, result.value.path))
    setExpanded((current) => new Set([...current].map((path) => rebasePath(path, source, result.value.path))))
    await refresh()
  }

  const trash = async (entry: FileEntry): Promise<void> => {
    if (!window.confirm(`Move ${entry.name} to the Recycle Bin?`)) return
    const result = await window.editorApi.fileSystem.trash(entry.path)
    if (!result.ok) {
      notify('error', result.error.message)
      return
    }
    await handleFileChange({ kind: entry.kind === 'directory' ? 'unlinkDir' : 'unlink', path: entry.path })
    if (isSameOrDescendant(currentDirectory, entry.path)) {
      const fallback = nearestProjectParent(parentPath(entry.path), project.path)
      setCurrentDirectory(fallback)
      selectPath(fallback)
    } else if (selectedPath && isSameOrDescendant(selectedPath, entry.path)) {
      selectPath(currentDirectory)
    }
    notify('success', `${entry.name} moved to the Recycle Bin`)
    await refresh()
  }

  const startResize = (event: React.PointerEvent): void => {
    event.preventDefault()
    const body = splitBody.current
    if (!body) return
    const bounds = body.getBoundingClientRect()
    const move = (pointer: PointerEvent): void => setFolderPaneWidth(Math.max(120, Math.min(bounds.width - 96, pointer.clientX - bounds.left)))
    const stop = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const directEntries = useMemo(() => children[currentDirectory] ?? [], [children, currentDirectory])
  const visibleEntries = searchResults ?? directEntries

  return <div className="panel project-browser" onPointerDown={() => setMenu(null)}>
    <div className="project-browser-toolbar">
      <button className="icon-button compact" title="Create" onClick={(event) => setMenu({ x: event.clientX, y: event.clientY, entry: null })}><Plus size={14} /><ChevronDown size={10} /></button>
      <div className="search-box project-search"><Search size={13} /><input ref={searchInput} aria-label="Search project files" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <button className="icon-button compact" title="Refresh Project" onClick={() => void refresh()}><RefreshCw size={13} /></button>
      <button className="icon-button compact" title="Project actions" onClick={(event) => setMenu({ x: event.clientX, y: event.clientY, entry: null })}><MoreVertical size={14} /></button>
    </div>
    <div className="project-browser-body" ref={splitBody}>
      <div className="project-folder-pane" data-testid="project-folder-pane" style={{ width: folderPaneWidth }} role="tree" aria-label="Project folders">
        <DirectoryNode
          entry={rootEntry(project.path, project.name)}
          depth={0}
          childrenMap={children}
          expanded={expanded}
          selectedPath={currentDirectory}
          onSelect={selectDirectory}
          onToggle={toggleDirectory}
          onContext={(event, entry) => setMenu({ x: event.clientX, y: event.clientY, entry })}
          onDrop={move}
        />
      </div>
      <div className="project-splitter" data-testid="project-splitter" role="separator" aria-orientation="vertical" onPointerDown={startResize} />
      <div className="project-file-pane" data-testid="project-file-pane" onContextMenu={(event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, entry: null }) }}>
        <Breadcrumb root={project.path} rootName={project.name} directory={currentDirectory} onSelect={(path) => void selectDirectory(path)} />
        <div className="project-file-list" role="listbox" aria-label={searchResults ? 'Project search results' : 'Files in selected folder'}>
          {visibleEntries.map((entry) => entry.kind === 'directory'
            ? <DirectoryRow
                key={entry.path}
                entry={entry}
                selected={selectedPath === entry.path}
                onSelect={() => selectPath(entry.path)}
                onOpen={() => void selectDirectory(entry.path)}
                onContext={(event) => setMenu({ x: event.clientX, y: event.clientY, entry })}
              />
            : <FileRow
                key={entry.path}
                entry={entry}
                selected={selectedPath === entry.path}
                showPath={Boolean(searchResults)}
                onSelect={() => selectPath(entry.path)}
                onOpen={() => void openDocument(entry.path)}
                onContext={(event) => setMenu({ x: event.clientX, y: event.clientY, entry })}
              />)}
          {visibleEntries.length === 0 && <div className="project-empty">{searchResults ? 'No matching files' : 'This folder is empty'}</div>}
        </div>
      </div>
    </div>
    {menu && <div className="context-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>
      <button onClick={() => { void createVisualScene(menu.entry?.kind === 'directory' ? menu.entry.path : currentDirectory); setMenu(null) }}><BoxIcon />New Scene</button>
      <button onClick={() => { void createItem('file', menu.entry?.kind === 'directory' ? menu.entry.path : currentDirectory); setMenu(null) }}><Plus size={14} />New File</button>
      <button onClick={() => { void createItem('directory', menu.entry?.kind === 'directory' ? menu.entry.path : currentDirectory); setMenu(null) }}><Folder size={14} />New Folder</button>
      {menu.entry && menu.entry.path !== project.path && <><div className="menu-separator" /><button onClick={() => { void rename(menu.entry!); setMenu(null) }}>Rename</button><button className="danger" onClick={() => { void trash(menu.entry!); setMenu(null) }}><Trash2 size={14} />Delete</button></>}
    </div>}
  </div>
}

function BoxIcon(): React.JSX.Element {
  return <span className="scene-file-icon" aria-hidden="true">S</span>
}

function DirectoryNode(props: {
  entry: FileEntry
  depth: number
  childrenMap: Record<string, FileEntry[]>
  expanded: Set<string>
  selectedPath: string
  onSelect(path: string): Promise<void>
  onToggle(entry: FileEntry): Promise<void>
  onContext(event: React.MouseEvent, entry: FileEntry): void
  onDrop(source: string, directory: string): Promise<void>
}): React.JSX.Element {
  const open = props.expanded.has(props.entry.path)
  const directories = (props.childrenMap[props.entry.path] ?? []).filter((entry) => entry.kind === 'directory')
  return <>
    <div
      className={`project-folder-row${props.selectedPath === props.entry.path ? ' selected' : ''}`}
      style={{ paddingLeft: 5 + props.depth * 15 }}
      role="treeitem"
      aria-selected={props.selectedPath === props.entry.path}
      aria-expanded={open}
      data-kind="directory"
      onClick={() => void props.onSelect(props.entry.path)}
      onDoubleClick={() => void props.onToggle(props.entry)}
      onContextMenu={(event) => { event.preventDefault(); props.onContext(event, props.entry) }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => { event.preventDefault(); const source = event.dataTransfer.getData('text/phaser-editor-path'); if (source) void props.onDrop(source, props.entry.path) }}
    >
      <button className="tree-chevron" tabIndex={-1} title={open ? 'Collapse folder' : 'Expand folder'} onClick={(event) => { event.stopPropagation(); void props.onToggle(props.entry) }}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>
      {open ? <FolderOpen className="file-icon folder" size={14} /> : <Folder className="file-icon folder" size={14} />}
      <span>{props.entry.name}</span>
    </div>
    {open && directories.map((entry) => <DirectoryNode key={entry.path} {...props} entry={entry} depth={props.depth + 1} />)}
  </>
}

function FileRow({ entry, selected, showPath, onSelect, onOpen, onContext }: {
  entry: FileEntry
  selected: boolean
  showPath: boolean
  onSelect(): void
  onOpen(): void
  onContext(event: React.MouseEvent): void
}): React.JSX.Element {
  return <div
    className={`project-file-row${selected ? ' selected' : ''}`}
    role="option"
    aria-selected={selected}
    data-kind="file"
    draggable
    onDragStart={(event) => {
      event.dataTransfer.setData('text/phaser-editor-path', entry.path)
      event.dataTransfer.setData(SCENE_ASSET_MIME, JSON.stringify({ kind: 'asset', path: entry.path, relativePath: entry.relativePath.replaceAll('\\', '/'), extension: entry.extension }))
      event.dataTransfer.effectAllowed = 'copyMove'
    }}
    onClick={onSelect}
    onDoubleClick={onOpen}
    onContextMenu={(event) => { event.preventDefault(); onContext(event) }}
  >
    <FileIcon entry={entry} />
    <span>{entry.name}</span>
    {showPath && <small>{parentPath(entry.relativePath)}</small>}
  </div>
}

function DirectoryRow({ entry, selected, onSelect, onOpen, onContext }: {
  entry: FileEntry
  selected: boolean
  onSelect(): void
  onOpen(): void
  onContext(event: React.MouseEvent): void
}): React.JSX.Element {
  return <div
    className={`project-file-row project-directory-row${selected ? ' selected' : ''}`}
    role="option"
    aria-selected={selected}
    data-kind="directory"
    draggable
    onDragStart={(event) => {
      event.dataTransfer.setData('text/phaser-editor-path', entry.path)
      event.dataTransfer.effectAllowed = 'copyMove'
    }}
    onClick={onSelect}
    onDoubleClick={onOpen}
    onContextMenu={(event) => { event.preventDefault(); onContext(event) }}
  >
    <Folder className="file-icon folder" size={14} />
    <span>{entry.name}</span>
  </div>
}

function Breadcrumb({ root, rootName, directory, onSelect }: { root: string; rootName: string; directory: string; onSelect(path: string): void }): React.JSX.Element {
  const relative = directory.slice(root.length).replace(/^[\\/]+/, '')
  const parts = relative ? relative.split(/[\\/]+/) : []
  let path = root
  const segments = [{ name: rootName, path: root }, ...parts.map((name) => ({ name, path: path = joinPath(path, name) }))]
  return <nav className="project-breadcrumb" aria-label="Current project folder">
    {segments.map((segment, index) => <span key={segment.path}>
      {index > 0 && <ChevronRight size={12} />}
      <button className={index === segments.length - 1 ? 'current' : ''} onClick={() => onSelect(segment.path)}>{segment.name}</button>
    </span>)}
  </nav>
}

function FileIcon({ entry }: { entry: FileEntry }): React.JSX.Element {
  if (['ts', 'tsx', 'js', 'jsx'].includes(entry.extension)) return <FileCode2 className="file-icon code" size={14} />
  if (entry.extension === 'json') return <FileJson className="file-icon json" size={14} />
  if (entry.extension === 'md') return <FileText className="file-icon markdown" size={14} />
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(entry.extension)) return <FileImage className="file-icon image" size={14} />
  if (['mp3', 'wav', 'ogg'].includes(entry.extension)) return <FileAudio className="file-icon audio" size={14} />
  if (entry.extension === 'tmx') return <Map className="file-icon map" size={14} />
  if (['glsl', 'frag', 'vert'].includes(entry.extension)) return <Braces className="file-icon shader" size={14} />
  return <File className="file-icon" size={14} />
}

function rootEntry(path: string, name: string): FileEntry {
  return { path, name, relativePath: '', kind: 'directory', size: 0, modifiedAt: 0, extension: '' }
}

function parentPath(path: string): string {
  const normalized = path.replaceAll('/', '\\')
  const index = normalized.lastIndexOf('\\')
  return index < 0 ? '' : normalized.slice(0, index)
}

function joinPath(parent: string, child: string): string {
  const separator = parent.includes('\\') ? '\\' : '/'
  return `${parent.replace(/[\\/]+$/, '')}${separator}${child}`
}

function isSameOrDescendant(candidate: string, parent: string): boolean {
  const left = candidate.replaceAll('\\', '/').toLocaleLowerCase()
  const right = parent.replaceAll('\\', '/').replace(/\/$/, '').toLocaleLowerCase()
  return left === right || left.startsWith(`${right}/`)
}

function rebasePath(candidate: string, source: string, target: string): string {
  return isSameOrDescendant(candidate, source) ? `${target}${candidate.slice(source.length)}` : candidate
}

function nearestProjectParent(candidate: string, root: string): string {
  return isSameOrDescendant(candidate, root) ? candidate : root
}
