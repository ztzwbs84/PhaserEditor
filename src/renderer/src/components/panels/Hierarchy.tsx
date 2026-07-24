import { useMemo, useState } from 'react'
import { Box, ChevronDown, ChevronRight, ChevronUp, Container, Copy, Gamepad2, Layers3, PackagePlus, Plus, Search, Trash2, Type } from 'lucide-react'
import { createSceneTransform, serializePrefab, type SceneObject, type SceneObjectType } from '@phaser-editor/contracts'
import { useEditorStore } from '../../store/editor-store'
import { collectDescendantIds, createObjectsCommand, deleteObjectsCommand, duplicateObjectsCommand, replaceSceneDocumentCommand, updateObjectCommand, updateObjectsCommand } from '../../store/scene-commands'
import { useSceneStore } from '../../store/scene-store'
import { flattenLayers, parseTiled } from '../../lib/tiled'
import { createPrefabFromScene, instantiatePrefab } from '../../lib/prefabs'

export function Hierarchy(): React.JSX.Element {
  const activePath = useSceneStore((state) => state.activePath)
  const scene = useSceneStore((state) => activePath ? state.scenes[activePath] : undefined)
  if (activePath && scene?.status === 'editable') return <SceneHierarchy path={activePath} scene={scene} />
  return <DocumentHierarchy />
}

function SceneHierarchy({ path, scene }: { path: string; scene: Extract<ReturnType<typeof useSceneStore.getState>['scenes'][string], { status: 'editable' }> }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const select = useSceneStore((state) => state.select)
  const execute = useSceneStore((state) => state.execute)
  const project = useEditorStore((state) => state.project)!
  const notify = useEditorStore((state) => state.notify)
  const roots = useMemo(() => buildTree(scene.document.objects, query), [query, scene.document.objects])
  const primary = scene.document.objects.find((object) => object.id === scene.selection[0])

  const createObject = (type: Extract<SceneObjectType, 'container' | 'text'>): void => {
    const siblings = scene.document.objects.filter((object) => object.parentId === null)
    const shared = {
      id: crypto.randomUUID(),
      name: uniqueName(scene.document.objects, type === 'text' ? 'Text' : 'Container'),
      parentId: null,
      order: siblings.length,
      transform: createSceneTransform({ x: 160 + siblings.length * 18, y: 120 + siblings.length * 18 }),
      visible: true,
      alpha: 1,
      components: []
    }
    const object: SceneObject = type === 'text'
      ? { ...shared, type: 'text', text: 'New Text', style: { fontFamily: 'Arial', fontSize: 32, color: '#ffffff', align: 'left' } }
      : { ...shared, type: 'container' }
    execute(path, createObjectsCommand(scene.document, [object], `Create ${type}`, scene.selection))
    setCreateOpen(false)
  }

  const rename = (object: SceneObject): void => {
    const name = window.prompt('Object name', object.name)?.trim()
    if (!name || name === object.name) return
    execute(path, updateObjectCommand(object, { ...object, name }, scene.selection, 'Rename object'))
  }

  const remove = (): void => {
    if (scene.selection.length === 0) return
    const affected = collectDescendantIds(scene.document, scene.selection)
    if (affected.size > scene.selection.length && !window.confirm(`Delete ${affected.size} objects including descendants?`)) return
    execute(path, deleteObjectsCommand(scene.document, scene.selection, scene.selection))
  }

  const duplicate = (): void => {
    if (scene.selection.length) execute(path, duplicateObjectsCommand(scene.document, scene.selection, scene.selection))
  }

  const createPrefab = async (): Promise<void> => {
    if (!primary) return
    const requested = window.prompt('Prefab name', primary.name)?.trim().replace(/\.phaser-prefab\.json$/i, '')
    if (!requested) return
    const safeName = requested.replace(/[<>:"/\\|?*]/g, '-').trim()
    if (!safeName) { notify('warning', 'Prefab name is invalid.'); return }
    const prefab = createPrefabFromScene(scene.document, primary.id)
    const separator = project.path.includes('\\') ? '\\' : '/'
    const assetsPath = `${project.path.replace(/[\\/]+$/, '')}${separator}assets`
    const prefabsPath = `${assetsPath}${separator}Prefabs`
    const existing = await window.editorApi.fileSystem.stat(prefabsPath)
    if (!existing.ok) {
      const createdDirectory = await window.editorApi.fileSystem.createDirectory(assetsPath, 'Prefabs')
      if (!createdDirectory.ok && createdDirectory.error.code !== 'CONFLICT') { notify('error', createdDirectory.error.message); return }
    }
    const name = `${safeName}.phaser-prefab.json`
    const created = await window.editorApi.fileSystem.createFile(prefabsPath, name)
    if (!created.ok) { notify('error', created.error.message); return }
    const written = await window.editorApi.fileSystem.write(created.value.path, serializePrefab(prefab))
    if (!written.ok) { notify('error', written.error.message); return }

    const relativePath = `assets/Prefabs/${name}`
    const placement = { x: primary.transform.x, y: primary.transform.y, parentId: primary.parentId, order: primary.order }
    const instance = instantiatePrefab(relativePath, prefab, placement)
    const removed = collectDescendantIds(scene.document, [primary.id])
    const insertionIndex = scene.document.objects.findIndex((object) => object.id === primary.id)
    const objects = scene.document.objects.filter((object) => !removed.has(object.id))
    objects.splice(Math.max(0, insertionIndex), 0, ...instance.objects)
    const next = { ...scene.document, objects }
    const rootId = instance.metadata.objectMap[prefab.rootObjectId]!
    execute(path, replaceSceneDocumentCommand(scene.document, next, 'Create prefab instance', scene.selection, [rootId]))
    notify('success', `Created ${name}`)
  }

  const reorder = (direction: -1 | 1): void => {
    if (!primary) return
    const siblings = scene.document.objects.filter((object) => object.parentId === primary.parentId).sort(compareOrder)
    const index = siblings.findIndex((object) => object.id === primary.id)
    const targetIndex = index + direction
    if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) return
    const before = siblings.map((object) => structuredClone(object))
    const reordered = [...siblings]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(targetIndex, 0, moved!)
    const after = reordered.map((object, order) => ({ ...object, order }))
    execute(path, updateObjectsCommand(before, after, scene.selection, 'Reorder object'))
  }

  const reparent = (sourceId: string, parentId: string | null): void => {
    const source = scene.document.objects.find((object) => object.id === sourceId)
    if (!source || source.parentId === parentId) return
    const descendants = collectDescendantIds(scene.document, [sourceId])
    if (parentId && descendants.has(parentId)) return
    const parent = parentId ? scene.document.objects.find((object) => object.id === parentId) : null
    if (parentId && parent?.type !== 'container') return
    const before = scene.document.objects.map((object) => structuredClone(object))
    const changed = scene.document.objects.map((object) => object.id === sourceId
      ? { ...object, parentId, order: scene.document.objects.filter((candidate) => candidate.parentId === parentId).length }
      : structuredClone(object))
    const after = normalizeSiblingOrders(changed)
    execute(path, updateObjectsCommand(before, after, scene.selection, parentId ? 'Reparent object' : 'Move object to scene root'))
  }

  return <div className="panel hierarchy-panel scene-hierarchy">
    <div className="hierarchy-toolbar">
      <div className="hierarchy-create-wrap">
        <button className={`icon-button compact${createOpen ? ' active' : ''}`} title="Create object" onClick={() => setCreateOpen((open) => !open)}><Plus size={14} /><ChevronDown size={10} /></button>
        {createOpen && <div className="hierarchy-create-menu"><button onClick={() => createObject('container')}><Container size={14} />Container</button><button onClick={() => createObject('text')}><Type size={14} />Text</button></div>}
      </div>
      <div className="hierarchy-search"><Search size={12} /><input aria-label="Search hierarchy" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" /></div>
      <button className="icon-button compact" title="Move up" disabled={!primary} onClick={() => reorder(-1)}><ChevronUp size={14} /></button>
      <button className="icon-button compact" title="Move down" disabled={!primary} onClick={() => reorder(1)}><ChevronDown size={14} /></button>
      <button className="icon-button compact" title="Duplicate" disabled={!primary} onClick={duplicate}><Copy size={13} /></button>
      <button className="icon-button compact" title="Create prefab from selection" disabled={!primary} onClick={() => void createPrefab()}><PackagePlus size={13} /></button>
      <button className="icon-button compact" title="Delete" disabled={!primary} onClick={remove}><Trash2 size={13} /></button>
    </div>
    <div className="hierarchy-root" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); reparent(event.dataTransfer.getData('text/phaser-editor-scene-object'), null) }}><ChevronDown size={13} /><Gamepad2 size={15} /><strong>{scene.document.settings.key}</strong></div>
    <div className="scene-hierarchy-tree" role="tree" aria-label="Scene hierarchy">
      {roots.map((node) => <SceneTreeRow key={node.object.id} node={node} depth={0} selected={scene.selection} onSelect={(id, mode) => select(path, [id], mode)} onRename={rename} onReparent={reparent} />)}
      {roots.length === 0 && <div className="hierarchy-empty">{query ? 'No matching objects' : 'Scene has no objects'}</div>}
    </div>
  </div>
}

interface SceneTreeNode { object: SceneObject; children: SceneTreeNode[] }

function SceneTreeRow({ node, depth, selected, onSelect, onRename, onReparent }: {
  node: SceneTreeNode
  depth: number
  selected: string[]
  onSelect(id: string, mode: 'replace' | 'toggle'): void
  onRename(object: SceneObject): void
  onReparent(sourceId: string, parentId: string): void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(true)
  const hasChildren = node.children.length > 0
  return <>
    <div
      className={`hierarchy-item scene-object-row${selected.includes(node.object.id) ? ' selected' : ''}`}
      style={{ paddingLeft: 5 + depth * 14 }}
      role="treeitem"
      aria-selected={selected.includes(node.object.id)}
      draggable
      data-object-id={node.object.id}
      onDragStart={(event) => event.dataTransfer.setData('text/phaser-editor-scene-object', node.object.id)}
      onDragOver={(event) => { if (node.object.type === 'container') event.preventDefault() }}
      onDrop={(event) => { event.preventDefault(); onReparent(event.dataTransfer.getData('text/phaser-editor-scene-object'), node.object.id) }}
      onClick={(event) => onSelect(node.object.id, event.shiftKey || event.ctrlKey || event.metaKey ? 'toggle' : 'replace')}
      onDoubleClick={() => onRename(node.object)}
    >
      <button className="tree-chevron" title={expanded ? 'Collapse' : 'Expand'} onClick={(event) => { event.stopPropagation(); setExpanded((open) => !open) }} disabled={!hasChildren}>{hasChildren ? expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} /> : null}</button>
      <ObjectIcon type={node.object.type} />
      <span>{node.object.name}</span>
      <small>{node.object.type}</small>
    </div>
    {expanded && node.children.map((child) => <SceneTreeRow key={child.object.id} node={child} depth={depth + 1} selected={selected} onSelect={onSelect} onRename={onRename} onReparent={onReparent} />)}
  </>
}

function DocumentHierarchy(): React.JSX.Element {
  const project = useEditorStore((state) => state.project)!
  const selectedPath = useEditorStore((state) => state.selectedPath)
  const document = useEditorStore((state) => selectedPath ? state.documents[selectedPath] : undefined)
  const tiled = document?.kind === 'tilemap' ? parseTiled(document.content).document : null
  const [query, setQuery] = useState('')
  const layers = useMemo(() => tiled ? flattenLayers(tiled.layers).filter((layer) => layer.displayName.toLocaleLowerCase().includes(query.toLocaleLowerCase())) : [], [query, tiled])
  return <div className="panel hierarchy-panel">
    <div className="hierarchy-toolbar"><button className="icon-button compact" title="Create object" disabled><Plus size={14} /><ChevronDown size={10} /></button><div className="hierarchy-search"><Search size={12} /><input aria-label="Search hierarchy" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="All" /></div></div>
    <div className="hierarchy-root"><ChevronDown size={13} /><Gamepad2 size={15} /><strong>{project.name}</strong></div>
    {tiled ? layers.map((layer) => <div className="hierarchy-item" key={layer.id}><Layers3 size={14} /><span>{layer.displayName}</span><small>{layer.type}</small></div>) : <div className="hierarchy-item selected"><Box size={14} /><span>Main Scene</span><small>Phaser.Scene</small></div>}
  </div>
}

function buildTree(objects: SceneObject[], query: string): SceneTreeNode[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const children = new Map<string | null, SceneObject[]>()
  objects.forEach((object) => children.set(object.parentId, [...(children.get(object.parentId) ?? []), object]))
  const visit = (object: SceneObject): SceneTreeNode | null => {
    const descendants = (children.get(object.id) ?? []).sort(compareOrder).map(visit).filter((node): node is SceneTreeNode => Boolean(node))
    if (normalizedQuery && !object.name.toLocaleLowerCase().includes(normalizedQuery) && descendants.length === 0) return null
    return { object, children: descendants }
  }
  return (children.get(null) ?? []).sort(compareOrder).map(visit).filter((node): node is SceneTreeNode => Boolean(node))
}

function compareOrder(left: SceneObject, right: SceneObject): number { return left.order - right.order || left.name.localeCompare(right.name) }
function uniqueName(objects: SceneObject[], base: string): string { let name = base; let index = 1; while (objects.some((object) => object.name === name)) name = `${base} ${++index}`; return name }

function normalizeSiblingOrders(objects: SceneObject[]): SceneObject[] {
  const groups = new Map<string | null, SceneObject[]>()
  objects.forEach((object) => groups.set(object.parentId, [...(groups.get(object.parentId) ?? []), object]))
  const byId = new Map<string, SceneObject>()
  for (const siblings of groups.values()) siblings.sort(compareOrder).forEach((object, order) => byId.set(object.id, { ...object, order }))
  return objects.map((object) => byId.get(object.id)!)
}

function ObjectIcon({ type }: { type: SceneObjectType }): React.JSX.Element {
  return type === 'container' ? <Container size={13} /> : type === 'text' ? <Type size={13} /> : <Box size={13} />
}
