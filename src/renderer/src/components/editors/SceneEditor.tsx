import { useCallback, useEffect, useRef } from 'react'
import { AlertTriangle, Grid3X3, Hand, MousePointer2, Move, RotateCw, Scaling } from 'lucide-react'
import { createSceneTransform, parsePrefab, type EditorDocument, type SceneObject, type SceneTransform } from '@phaser-editor/contracts'
import { useEditorStore } from '../../store/editor-store'
import { createObjectsCommand } from '../../store/scene-commands'
import { useSceneStore, type SceneTool } from '../../store/scene-store'
import { SceneViewport, type SceneViewportController } from './SceneViewport'
import { parseSceneAssetDragPayload, SCENE_ASSET_MIME, validateSceneAssetDrop } from '../../lib/scene-assets'
import { instantiatePrefab } from '../../lib/prefabs'

interface ActiveGesture {
  pointerId: number
  tool: Extract<SceneTool, 'move' | 'rotate' | 'scale'>
  startWorld: { x: number; y: number }
  objects: Record<string, {
    transform: SceneTransform
    startLocal: { x: number; y: number }
    center: { x: number; y: number }
    startAngle: number
    startDistance: number
  }>
}

export function SceneEditor({ document }: { document: EditorDocument }): React.JSX.Element {
  const project = useEditorStore((state) => state.project)!
  const notify = useEditorStore((state) => state.notify)
  const scene = useSceneStore((state) => state.scenes[document.path])
  const load = useSceneStore((state) => state.load)
  const activate = useSceneStore((state) => state.activate)
  const close = useSceneStore((state) => state.close)
  const select = useSceneStore((state) => state.select)
  const setTool = useSceneStore((state) => state.setTool)
  const controller = useRef<SceneViewportController | null>(null)
  const gesture = useRef<ActiveGesture | null>(null)

  useEffect(() => {
    load(document.path, document.savedContent)
    activate(document.path)
    return () => close(document.path)
  }, [activate, close, document.path, document.savedContent, load])

  useEffect(() => {
    const cancel = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !gesture.current) return
      useSceneStore.getState().cancelTransformGesture(document.path)
      gesture.current = null
    }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [document.path])

  const setController = useCallback((value: SceneViewportController | null) => { controller.current = value }, [])
  const showAssetError = useCallback((message: string) => notify('warning', message), [notify])

  if (!scene) return <div className="editor-loading">Loading scene...</div>
  if (scene.status === 'readonly') {
    return <div className="scene-readonly">
      <div className="scene-readonly-message"><AlertTriangle size={18} /><div><strong>Read-only scene</strong><span>{scene.message}</span></div></div>
      <pre>{scene.raw}</pre>
    </div>
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !controller.current) return
    const hit = controller.current.hitTest(event.clientX, event.clientY)
    if (scene.tool === 'select') {
      if (hit) select(document.path, [hit], event.shiftKey || event.ctrlKey || event.metaKey ? 'toggle' : 'replace')
      else if (!event.shiftKey && !event.ctrlKey && !event.metaKey) select(document.path, [])
      return
    }
    if (scene.tool === 'pan') return
    let selection = scene.selection
    if (hit && !selection.includes(hit)) {
      selection = [hit]
      select(document.path, selection)
    }
    if (selection.length === 0) return
    const startWorld = controller.current.screenToWorld(event.clientX, event.clientY)
    const objects: ActiveGesture['objects'] = {}
    for (const id of selection) {
      const object = scene.document.objects.find((candidate) => candidate.id === id)
      if (!object) continue
      const center = controller.current.getObjectWorldCenter(id)
      objects[id] = {
        transform: structuredClone(object.transform),
        startLocal: controller.current.worldToParentLocal(id, startWorld),
        center,
        startAngle: Math.atan2(startWorld.y - center.y, startWorld.x - center.x),
        startDistance: Math.max(1, Math.hypot(startWorld.x - center.x, startWorld.y - center.y))
      }
    }
    if (!useSceneStore.getState().beginTransformGesture(document.path, selection, scene.tool === 'move' ? 'Move objects' : scene.tool === 'rotate' ? 'Rotate objects' : 'Scale objects')) return
    gesture.current = { pointerId: event.pointerId, tool: scene.tool, startWorld, objects }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const active = gesture.current
    if (!active || active.pointerId !== event.pointerId || !controller.current) return
    const world = controller.current.screenToWorld(event.clientX, event.clientY)
    const transforms: Record<string, SceneTransform> = {}
    for (const [id, start] of Object.entries(active.objects)) {
      if (active.tool === 'move') {
        const local = controller.current.worldToParentLocal(id, world)
        transforms[id] = { ...start.transform, x: start.transform.x + local.x - start.startLocal.x, y: start.transform.y + local.y - start.startLocal.y }
      } else if (active.tool === 'rotate') {
        const angle = Math.atan2(world.y - start.center.y, world.x - start.center.x)
        transforms[id] = { ...start.transform, rotation: start.transform.rotation + angle - start.startAngle }
      } else {
        const distance = Math.max(1, Math.hypot(world.x - start.center.x, world.y - start.center.y))
        const ratio = distance / start.startDistance
        transforms[id] = { ...start.transform, scaleX: start.transform.scaleX * ratio, scaleY: start.transform.scaleY * ratio }
      }
    }
    useSceneStore.getState().previewTransforms(document.path, transforms)
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!gesture.current || gesture.current.pointerId !== event.pointerId) return
    useSceneStore.getState().commitTransformGesture(document.path)
    gesture.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>): Promise<void> => {
    event.preventDefault()
    if (!controller.current) return
    const payload = parseSceneAssetDragPayload(event.dataTransfer.getData(SCENE_ASSET_MIME), event.dataTransfer.getData('text/phaser-editor-path'))
    if (!payload) { notify('warning', 'The dropped item is not a project asset.'); return }
    const validation = validateSceneAssetDrop(project.path, payload, event.altKey)
    if (!validation.ok) { notify('warning', validation.message); return }
    const { relativePath, objectType } = validation
    const point = controller.current.screenToWorld(event.clientX, event.clientY)
    if (objectType === 'prefab') {
      const result = await window.editorApi.fileSystem.read(payload.path)
      if (!result.ok) { notify('warning', result.error.message); return }
      try {
        const prefab = parsePrefab(result.value.content)
        const instance = instantiatePrefab(relativePath, prefab, {
          x: Math.round(point.x),
          y: Math.round(point.y),
          order: scene.document.objects.filter((candidate) => candidate.parentId === null).length
        })
        useSceneStore.getState().execute(document.path, createObjectsCommand(scene.document, instance.objects, 'Place prefab instance', scene.selection))
        if (instance.diagnostics.length) notify('warning', `${instance.diagnostics.length} prefab overrides need repair.`)
      } catch (error) {
        notify('warning', error instanceof Error ? error.message : 'The prefab is invalid.')
      }
      return
    }
    const shared = {
      id: crypto.randomUUID(),
      name: baseName(relativePath).replace(/\.[^.]+$/, ''),
      parentId: null,
      order: scene.document.objects.filter((candidate) => candidate.parentId === null).length,
      transform: createSceneTransform({ x: Math.round(point.x), y: Math.round(point.y) }),
      visible: true,
      alpha: 1,
      components: [],
      asset: { path: relativePath, frame: null }
    }
    const object: SceneObject = objectType === 'sprite'
      ? { ...shared, type: 'sprite', animation: null }
      : { ...shared, type: 'image' }
    useSceneStore.getState().execute(document.path, createObjectsCommand(scene.document, [object], 'Create object from asset', scene.selection))
  }

  return <div className="scene-editor">
    <div className="scene-editor-toolbar" role="toolbar" aria-label="Scene tools">
      <SceneToolButton tool="select" current={scene.tool} title="Select" onSelect={(tool) => setTool(document.path, tool)}><MousePointer2 size={15} /></SceneToolButton>
      <SceneToolButton tool="move" current={scene.tool} title="Move" onSelect={(tool) => setTool(document.path, tool)}><Move size={15} /></SceneToolButton>
      <SceneToolButton tool="rotate" current={scene.tool} title="Rotate" onSelect={(tool) => setTool(document.path, tool)}><RotateCw size={15} /></SceneToolButton>
      <SceneToolButton tool="scale" current={scene.tool} title="Scale" onSelect={(tool) => setTool(document.path, tool)}><Scaling size={15} /></SceneToolButton>
      <span className="scene-toolbar-divider" />
      <SceneToolButton tool="pan" current={scene.tool} title="Pan" onSelect={(tool) => setTool(document.path, tool)}><Hand size={15} /></SceneToolButton>
      <span className="scene-toolbar-spacer" />
      <span className="scene-grid-indicator"><Grid3X3 size={14} />32 px</span>
      <span className="scene-coordinate-mode">Local</span>
    </div>
    <div
      className={`scene-viewport-input tool-${scene.tool}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
      onDrop={(event) => { void handleDrop(event) }}
    >
      <SceneViewport document={scene.document} selection={scene.selection} projectRoot={project.path} onReady={setController} onAssetError={showAssetError} />
      <div className="scene-input-layer" data-testid="scene-input-layer" />
      <div className="scene-viewport-status"><span>{scene.document.settings.key}</span><span>{scene.document.settings.width} x {scene.document.settings.height}</span><span>{scene.selection.length} selected</span></div>
    </div>
  </div>
}

function SceneToolButton({ tool, current, title, onSelect, children }: {
  tool: SceneTool
  current: SceneTool
  title: string
  onSelect(tool: SceneTool): void
  children: React.ReactNode
}): React.JSX.Element {
  return <button className={current === tool ? 'active' : ''} title={title} aria-pressed={current === tool} onClick={() => onSelect(tool)}>{children}</button>
}

function baseName(path: string): string {
  return path.split('/').pop() ?? 'Image'
}
