import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Actions, DockLocation, Layout, Model, type Action, type IJsonModel, type TabNode } from 'flexlayout-react'
import { useEditorStore } from '../store/editor-store'
import { basename } from '../lib/file-types'
import { MenuBar } from './chrome/MenuBar'
import { Toolbar } from './chrome/Toolbar'
import { StatusBar } from './chrome/StatusBar'
import { Explorer } from './panels/Explorer'
import { Hierarchy } from './panels/Hierarchy'
import { Inspector } from './panels/Inspector'
import { ConsolePanel } from './panels/ConsolePanel'
import { PalettePanel } from './panels/PalettePanel'
import { DocumentHost } from './editors/DocumentHost'
import { WelcomePanel } from './panels/WelcomePanel'
import { PreviewPanel } from './panels/PreviewPanel'
import { ErrorBoundary } from './common/ErrorBoundary'
import { LazyPluginSurface } from './common/LazyPluginSurface'
import { panelContributionRegistry } from '../lib/contribution-registry'
import { pluginContributionRuntime } from '../lib/plugin-runtime'

interface WorkspaceContextValue {
  openDocument(path: string): Promise<void>
  resetLayout(): void
  showPanel(component: string, name: string, location?: 'left' | 'right' | 'bottom' | 'center'): void
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error('Workspace context is unavailable.')
  return context
}

const defaultLayout: IJsonModel = {
  global: {
    tabEnableRename: false,
    tabSetEnableMaximize: true,
    tabSetEnableTabStrip: true
  },
  borders: [],
  layout: {
    type: 'row',
    weight: 100,
    children: [
      {
        type: 'row',
        weight: 30,
        minWidth: 220,
        children: [
          { type: 'tabset', weight: 38, children: [{ type: 'tab', id: 'hierarchy', name: 'Hierarchy', component: 'hierarchy', enableClose: false }] },
          { type: 'tabset', weight: 62, children: [{ type: 'tab', id: 'assets', name: 'Project', component: 'assets', enableClose: false }] }
        ]
      },
      {
        type: 'row',
        weight: 50,
        children: [
          {
            type: 'tabset',
            id: 'workspace',
            weight: 73,
            selected: 0,
            children: [
              { type: 'tab', id: 'welcome', name: 'Scene', component: 'welcome', enableClose: false },
              { type: 'tab', id: 'preview', name: 'Game', component: 'preview', enableClose: false }
            ]
          },
          { type: 'tabset', weight: 27, children: [{ type: 'tab', id: 'console', name: 'Console', component: 'console', enableClose: false }] }
        ]
      },
      {
        type: 'row',
        weight: 20,
        minWidth: 230,
        children: [
          { type: 'tabset', weight: 62, children: [{ type: 'tab', id: 'inspector', name: 'Inspector', component: 'inspector', enableClose: false }] },
          { type: 'tabset', weight: 38, children: [{ type: 'tab', id: 'palette', name: 'Palette', component: 'palette', enableClose: false }] }
        ]
      }
    ]
  }
}

export function Workspace(): React.JSX.Element {
  const panelRevision = useSyncExternalStore(panelContributionRegistry.subscribe.bind(panelContributionRegistry), panelContributionRegistry.getRevision.bind(panelContributionRegistry))
  const settings = useEditorStore((state) => state.settings)
  const openStoreDocument = useEditorStore((state) => state.openDocument)
  const documents = useEditorStore((state) => state.documents)
  const closeDocument = useEditorStore((state) => state.closeDocument)
  const updateSettings = useEditorStore((state) => state.updateSettings)
  const [model, setModel] = useState(() => createLayoutModel(settings?.layout))

  const openDocument = useCallback(async (path: string) => {
    const document = await openStoreDocument(path)
    if (!document) return
    const id = `document:${document.id}`
    const existing = model.getNodeById(id)
    if (existing) {
      model.doAction(Actions.selectTab(id))
      return
    }
    model.doAction(Actions.addNode({
      type: 'tab',
      id,
      name: `${document.dirty ? '* ' : ''}${basename(path)}`,
      component: 'document',
      config: { path },
      enableClose: true
    }, 'workspace', DockLocation.CENTER, -1))
  }, [model, openStoreDocument])

  useEffect(() => {
    const byId = new Map(Object.values(documents).map((document) => [document.id, document]))
    const documentTabs: TabNode[] = []
    model.visitNodes((node) => {
      if (node.getType() === 'tab' && (node as TabNode).getComponent() === 'document') documentTabs.push(node as TabNode)
    })
    for (const tab of documentTabs) {
      const document = byId.get(tab.getId().slice('document:'.length))
      if (!document) {
        model.doAction(Actions.deleteTab(tab.getId()))
        continue
      }
      const marker = document.missing ? '! ' : document.conflict ? '! ' : document.dirty ? '* ' : ''
      const name = `${marker}${basename(document.path)}`
      if (tab.getName() !== name) model.doAction(Actions.renameTab(tab.getId(), name))
      const config = tab.getConfig() as { path?: string }
      if (config.path !== document.path) model.doAction(Actions.updateNodeAttributes(tab.getId(), { config: { path: document.path } }))
    }
  }, [documents, model])

  const resetLayout = useCallback(() => {
    const next = Model.fromJson(defaultLayout)
    setModel(next)
    void updateSettings({ layout: next.toJson() })
  }, [updateSettings])

  const showPanel = useCallback((component: string, name: string, location = 'center') => {
    const existing = model.getNodeById(component)
    if (existing) {
      model.doAction(Actions.selectTab(component))
      return
    }
    const target = location === 'left' ? 'assets' : location === 'right' ? 'inspector' : location === 'bottom' ? 'console' : 'workspace'
    model.doAction(Actions.addNode({ type: 'tab', id: component, name, component }, target, DockLocation.CENTER, -1))
  }, [model])

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent): void => {
      const dirty = Object.values(useEditorStore.getState().documents).some((document) => document.dirty)
      if (dirty) event.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  useEffect(() => {
    const handler = (event: Event): void => { void openDocument((event as CustomEvent<string>).detail) }
    window.addEventListener('phaser-editor:open-document-tab', handler)
    return () => window.removeEventListener('phaser-editor:open-document-tab', handler)
  }, [openDocument])

  useEffect(() => {
    const handler = (event: Event): void => {
      const id = (event as CustomEvent<string>).detail
      const contribution = panelContributionRegistry.get(id)
      if (contribution) showPanel(`plugin-panel:${id}`, contribution.value.title, contribution.value.location ?? 'center')
    }
    window.addEventListener('phaser-editor:show-contributed-panel', handler)
    return () => window.removeEventListener('phaser-editor:show-contributed-panel', handler)
  }, [showPanel])

  useEffect(() => {
    const stale: string[] = []
    model.visitNodes((node) => {
      if (node.getType() !== 'tab') return
      const component = (node as TabNode).getComponent() ?? ''
      if (component.startsWith('plugin-panel:') && !panelContributionRegistry.get(component.slice('plugin-panel:'.length))) stale.push(node.getId())
    })
    stale.forEach((id) => model.doAction(Actions.deleteTab(id)))
  }, [model, panelRevision])

  const contextValue = useMemo(() => ({ openDocument, resetLayout, showPanel }), [openDocument, resetLayout, showPanel])

  const onAction = useCallback((action: Action): Action | undefined => {
    const nodeId = typeof action.data.node === 'string' ? action.data.node : ''
    if (!nodeId.startsWith('document:')) return action
    const document = Object.values(useEditorStore.getState().documents).find((item) => `document:${item.id}` === nodeId)
    if (action.type === Actions.DELETE_TAB) return !document || closeDocument(document.path) ? action : undefined
    if (action.type === Actions.SELECT_TAB && document) useEditorStore.getState().selectPath(document.path)
    return action
  }, [closeDocument])

  const factory = useCallback((node: TabNode): React.ReactNode => {
    const component = node.getComponent() ?? ''
    const config = node.getConfig() as { path?: string }
    const pluginPanelId = component.startsWith('plugin-panel:') ? component.slice('plugin-panel:'.length) : null
    const pluginPanel = pluginPanelId ? panelContributionRegistry.get(pluginPanelId) : undefined
    const content = component === 'assets' ? <Explorer />
      : component === 'hierarchy' ? <Hierarchy />
        : component === 'inspector' ? <Inspector />
          : component === 'console' ? <ConsolePanel />
            : component === 'palette' ? <PalettePanel />
              : component === 'preview' ? <PreviewPanel />
                : component === 'document' && config.path ? <DocumentHost path={config.path} />
                  : pluginPanelId && pluginPanel
                    ? <LazyPluginSurface name={pluginPanel.value.title} pluginId={pluginPanel.owner} contributionId={pluginPanelId} load={(retry) => pluginContributionRuntime.loadPanel(pluginPanelId, retry)} />
                    : <WelcomePanel />
    return <ErrorBoundary name={node.getName()}>{content}</ErrorBoundary>
  }, [panelRevision])

  return (
    <WorkspaceContext.Provider value={contextValue}>
      <div className="workspace-shell">
        <MenuBar />
        <Toolbar />
        <main className="dock-host" aria-label="Editor workspace">
          <Layout
            model={model}
            factory={factory}
            realtimeResize
            onAction={onAction}
            onModelChange={(changedModel) => {
              window.clearTimeout((window as unknown as { layoutTimer?: number }).layoutTimer)
              ;(window as unknown as { layoutTimer?: number }).layoutTimer = window.setTimeout(() => {
                void updateSettings({ layout: changedModel.toJson() })
              }, 300)
            }}
          />
        </main>
        <StatusBar />
      </div>
    </WorkspaceContext.Provider>
  )
}

function createLayoutModel(saved: unknown): Model {
  try {
    const layout = structuredClone((saved ?? defaultLayout) as IJsonModel)
    migrateUnityTabNames(layout)
    return Model.fromJson(layout)
  } catch {
    return Model.fromJson(defaultLayout)
  }
}

function migrateUnityTabNames(value: unknown): void {
  if (!value || typeof value !== 'object') return
  const node = value as { id?: string; name?: string; children?: unknown[]; layout?: unknown }
  if (node.id === 'welcome') node.name = 'Scene'
  if (node.id === 'preview') node.name = 'Game'
  if (node.id === 'assets') node.name = 'Project'
  node.children?.forEach(migrateUnityTabNames)
  migrateUnityTabNames(node.layout)
}
