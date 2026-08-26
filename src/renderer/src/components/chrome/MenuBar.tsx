import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { commandRegistry, shortcutMatches } from '../../lib/commands'
import { useEditorStore } from '../../store/editor-store'
import { useWorkspace } from '../Workspace'
import { useSceneStore } from '../../store/scene-store'
import { redoActiveAuthoringDocument, undoActiveAuthoringDocument } from '../../store/authoring-history-store'
import { commandContributionRegistry, panelContributionRegistry } from '../../lib/contribution-registry'

interface MenuItem {
  label: string
  command?: string
  separator?: boolean
  checked?: boolean
  panel?: string
}

const menus: Array<{ label: string; items: MenuItem[] }> = [
  { label: 'File', items: [
    { label: 'Open Project...', command: 'project.open' },
    { label: 'Close Project', command: 'project.close' },
    { label: '', separator: true },
    { label: 'Save', command: 'workspace.save' },
    { label: 'Save All', command: 'workspace.saveAll' }
  ] },
  { label: 'Edit', items: [
    { label: 'Undo', command: 'workspace.undo' },
    { label: 'Redo', command: 'workspace.redo' },
    { label: '', separator: true },
    { label: 'Find', command: 'workspace.find' },
    { label: 'Quick Open...', command: 'workspace.quickOpen' }
  ] },
  { label: 'View', items: [
    { label: 'Toggle Theme', command: 'view.theme' },
    { label: 'Reset Layout', command: 'view.resetLayout' },
    { label: '', separator: true },
    { label: 'Assets', command: 'view.assets' },
    { label: 'Hierarchy', command: 'view.hierarchy' },
    { label: 'Inspector', command: 'view.inspector' },
    { label: 'Console', command: 'view.console' },
    { label: 'Palette', command: 'view.palette' }
  ] },
  { label: 'Project', items: [
    { label: 'Refresh Assets', command: 'project.refresh' },
  ] },
  { label: 'Run', items: [
    { label: 'Start', command: 'run.start' },
    { label: 'Stop', command: 'run.stop' },
    { label: 'Restart', command: 'run.restart' },
    { label: 'Open in Browser', command: 'run.openExternal' }
  ] },
  { label: 'Tools', items: [
    { label: 'Unity UGUI Preview', command: 'tools.unityUI' },
    { label: '', separator: true },
    { label: 'Palette', command: 'view.palette' },
    { label: 'Plugins...', command: 'tools.plugins' }
  ] },
  { label: 'Help', items: [
    { label: 'Phaser Source Reference', command: 'help.source' },
    { label: 'About Phaser Editor', command: 'help.about' }
  ] }
]

export function MenuBar(): React.JSX.Element {
  const panelRevision = useSyncExternalStore(panelContributionRegistry.subscribe.bind(panelContributionRegistry), panelContributionRegistry.getRevision.bind(panelContributionRegistry))
  const commandRevision = useSyncExternalStore(commandContributionRegistry.subscribe.bind(commandContributionRegistry), commandContributionRegistry.getRevision.bind(commandContributionRegistry))
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const workspace = useWorkspace()
  const project = useEditorStore((state) => state.project)
  const settings = useEditorStore((state) => state.settings)
  const runSession = useEditorStore((state) => state.runSession)
  const updateSettings = useEditorStore((state) => state.updateSettings)
  const notify = useEditorStore((state) => state.notify)
  const bindings = useMemo(() => ({ workspace, project, settings, runSession, updateSettings, notify }), [workspace, project, settings, runSession, updateSettings, notify])
  const visibleMenus = useMemo<Array<{ label: string; items: MenuItem[] }>>(() => menus.map((menu) => {
    if (menu.label === 'View') return {
      ...menu,
      items: [...menu.items, ...panelContributionRegistry.list().map<MenuItem>((entry) => ({ label: entry.value.title, panel: entry.id }))]
    }
    if (menu.label === 'Tools') return {
      ...menu,
      items: [...menu.items, ...commandContributionRegistry.list().map<MenuItem>((entry) => ({ label: entry.value.title, command: entry.id }))]
    }
    return menu
  }), [commandRevision, panelRevision])

  useEffect(() => registerCommands(bindings), [bindings])

  useEffect(() => {
    const keyHandler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && openMenu) {
        event.preventDefault()
        setOpenMenu(null)
        return
      }
      for (const command of commandRegistry.list()) {
        const configured = useEditorStore.getState().settings?.shortcuts[command.id] ?? command.shortcut
        if (configured && shortcutMatches(event, configured)) {
          event.preventDefault()
          void commandRegistry.execute(command.id)
          break
        }
      }
    }
    const pointerHandler = (event: PointerEvent): void => {
      if (!container.current?.contains(event.target as Node)) setOpenMenu(null)
    }
    window.addEventListener('keydown', keyHandler, true)
    window.addEventListener('pointerdown', pointerHandler)
    return () => {
      window.removeEventListener('keydown', keyHandler, true)
      window.removeEventListener('pointerdown', pointerHandler)
    }
  }, [openMenu])

  return (
    <div className="menu-bar" ref={container} role="menubar" aria-label="Application menu">
      {visibleMenus.map((menu) => (
        <div className="menu-root" key={menu.label}>
          <button role="menuitem" aria-haspopup="menu" aria-expanded={openMenu === menu.label} className={openMenu === menu.label ? 'menu-trigger active' : 'menu-trigger'} onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)} onPointerEnter={() => { if (openMenu) setOpenMenu(menu.label) }}>{menu.label}</button>
          {openMenu === menu.label && (
            <div className="menu-popup" role="menu" aria-label={menu.label}>
              {menu.items.map((item, index) => item.separator
                ? <div className="menu-separator" role="separator" key={`${menu.label}-${index}`} />
                : <button role="menuitem" key={item.label} className="menu-item" disabled={item.command ? commandRegistry.get(item.command)?.enabled?.() === false : false} onClick={() => {
                  setOpenMenu(null)
                  if (item.command) void commandRegistry.execute(item.command)
                  if (item.panel) window.dispatchEvent(new CustomEvent('phaser-editor:show-contributed-panel', { detail: item.panel }))
                }}>
                  <span className="menu-check">{item.checked && <Check size={13} />}</span>
                  <span>{item.label}</span>
                  <kbd>{item.command ? settings?.shortcuts[item.command] ?? commandRegistry.get(item.command)?.shortcut : ''}</kbd>
                  {item.label.endsWith('...') && <ChevronRight size={12} />}
                </button>)}
            </div>
          )}
        </div>
      ))}
      <div className="menu-spacer" />
      <div className="project-title">{project?.name}</div>
    </div>
  )
}

function registerCommands(context: {
  workspace: ReturnType<typeof useWorkspace>
  project: ReturnType<typeof useEditorStore.getState>['project']
  settings: ReturnType<typeof useEditorStore.getState>['settings']
  runSession: ReturnType<typeof useEditorStore.getState>['runSession']
  updateSettings: ReturnType<typeof useEditorStore.getState>['updateSettings']
  notify: ReturnType<typeof useEditorStore.getState>['notify']
}): () => void {
  const registrations = [
    commandRegistry.register({ id: 'project.open', title: 'Open Project', execute: async () => { await useEditorStore.getState().openProject() } }),
    commandRegistry.register({ id: 'project.close', title: 'Close Project', enabled: () => Boolean(useEditorStore.getState().project), execute: async () => { await useEditorStore.getState().closeProject() } }),
    commandRegistry.register({ id: 'workspace.save', title: 'Save', shortcut: 'Ctrl+S', execute: async () => { await useEditorStore.getState().saveDocument() } }),
    commandRegistry.register({ id: 'workspace.saveAll', title: 'Save All', shortcut: 'Ctrl+Alt+S', execute: async () => {
      for (const document of Object.values(useEditorStore.getState().documents)) await useEditorStore.getState().saveDocument(document.path)
    } }),
    commandRegistry.register({ id: 'workspace.undo', title: 'Undo', shortcut: 'Ctrl+Z', execute: () => {
      const selected = useEditorStore.getState().selectedPath
      const document = selected ? useEditorStore.getState().documents[selected] : undefined
      if (document?.kind === 'scene' && selected ? !useSceneStore.getState().undo(selected) : !undoActiveAuthoringDocument()) emitEditorAction('undo')
    } }),
    commandRegistry.register({ id: 'workspace.redo', title: 'Redo', shortcut: 'Ctrl+Shift+Z', execute: () => {
      const selected = useEditorStore.getState().selectedPath
      const document = selected ? useEditorStore.getState().documents[selected] : undefined
      if (document?.kind === 'scene' && selected ? !useSceneStore.getState().redo(selected) : !redoActiveAuthoringDocument()) emitEditorAction('redo')
    } }),
    commandRegistry.register({ id: 'workspace.find', title: 'Find', shortcut: 'Ctrl+F', execute: () => emitEditorAction('find') }),
    commandRegistry.register({ id: 'workspace.quickOpen', title: 'Quick Open', shortcut: 'Ctrl+P', execute: () => useEditorStore.getState().setQuickOpen(true) }),
    commandRegistry.register({ id: 'workspace.search', title: 'Search Project', execute: () => {
      context.workspace.showPanel('assets', 'Project', 'left')
      window.setTimeout(() => window.dispatchEvent(new CustomEvent('phaser-editor:focus-project-search')), 0)
    } }),
    commandRegistry.register({ id: 'view.theme', title: 'Toggle Theme', execute: () => {
      const theme = useEditorStore.getState().settings?.theme === 'light' ? 'dark' : 'light'
      void useEditorStore.getState().updateSettings({ theme })
    } }),
    commandRegistry.register({ id: 'view.resetLayout', title: 'Reset Layout', execute: context.workspace.resetLayout }),
    commandRegistry.register({ id: 'view.assets', title: 'Assets', execute: () => context.workspace.showPanel('assets', 'Assets', 'left') }),
    commandRegistry.register({ id: 'view.hierarchy', title: 'Hierarchy', execute: () => context.workspace.showPanel('hierarchy', 'Hierarchy', 'left') }),
    commandRegistry.register({ id: 'view.inspector', title: 'Inspector', execute: () => context.workspace.showPanel('inspector', 'Inspector', 'right') }),
    commandRegistry.register({ id: 'view.console', title: 'Console', execute: () => context.workspace.showPanel('console', 'Console', 'bottom') }),
    commandRegistry.register({ id: 'view.palette', title: 'Palette', execute: () => context.workspace.showPanel('palette', 'Palette', 'right') }),
    commandRegistry.register({ id: 'project.refresh', title: 'Refresh Assets', shortcut: 'Ctrl+R', execute: () => { window.dispatchEvent(new CustomEvent('phaser-editor:refresh-assets')) } }),
    commandRegistry.register({ id: 'run.start', title: 'Start Project', shortcut: 'F6', enabled: () => !['starting', 'running'].includes(useEditorStore.getState().runSession.status), execute: startProject }),
    commandRegistry.register({ id: 'run.stop', title: 'Stop Project', shortcut: 'Shift+F6', enabled: () => ['starting', 'running'].includes(useEditorStore.getState().runSession.status), execute: async () => { await window.editorApi.runner.stop() } }),
    commandRegistry.register({ id: 'run.restart', title: 'Restart Project', shortcut: 'Ctrl+F6', enabled: () => Boolean(useEditorStore.getState().project), execute: async () => {
      const project = useEditorStore.getState().project
      if (!project) return
      const config = useEditorStore.getState().settings?.runConfigurations[project.path]
      const result = await window.editorApi.runner.restart(config)
      if (!result.ok) context.notify('error', result.error.message)
    } }),
    commandRegistry.register({ id: 'run.openExternal', title: 'Open in Browser', enabled: () => Boolean(useEditorStore.getState().runSession.url), execute: async () => {
      const url = useEditorStore.getState().runSession.url
      if (url) await window.editorApi.runner.openExternal(url)
    } }),
    commandRegistry.register({ id: 'tools.plugins', title: 'Plugins', execute: () => useEditorStore.getState().setPluginsOpen(true) }),
    commandRegistry.register({ id: 'tools.unityUI', title: 'Unity UGUI Preview', execute: () => context.workspace.showPanel('unity-ui', 'Unity UGUI', 'center') }),
    commandRegistry.register({ id: 'help.source', title: 'Phaser Source Reference', execute: () => context.notify('info', `Phaser source: ${useEditorStore.getState().settings?.phaserSourceRoot}`) }),
    commandRegistry.register({ id: 'help.about', title: 'About', execute: () => context.notify('info', 'Phaser Editor 0.1.0 · Phaser 4.2.1') })
  ]
  return () => registrations.forEach((dispose) => dispose())
}

async function startProject(): Promise<void> {
  const state = useEditorStore.getState()
  const project = state.project
  if (!project) return
  const trusted = state.settings?.trustedProjects.includes(project.path) ?? false
  if (!trusted) {
    const confirmed = window.confirm(`Run scripts from ${project.path}? Project scripts can execute code on this computer.`)
    if (!confirmed) return
    await state.updateSettings({ trustedProjects: [...(state.settings?.trustedProjects ?? []), project.path] })
  }
  const config = useEditorStore.getState().settings?.runConfigurations[project.path]
  const result = await window.editorApi.runner.start(config)
  if (!result.ok) state.notify('error', result.error.message)
}

function emitEditorAction(action: string): void {
  window.dispatchEvent(new CustomEvent('phaser-editor:editor-action', { detail: action }))
}
