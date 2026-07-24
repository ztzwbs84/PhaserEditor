import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Brush,
  Copy,
  Eraser,
  Eye,
  EyeOff,
  Grid3X3,
  Lock,
  MousePointer2,
  Pipette,
  Plus,
  Save,
  SquareDashed,
  Trash2,
  Unlock
} from 'lucide-react'
import type { EditorDocument } from '@phaser-editor/contracts'
import {
  fillRect,
  findLayer,
  flattenLayers,
  getTile,
  parseTiled,
  serializeTiled,
  setTile,
  type TiledDocument,
  type TiledLayer,
  type TiledObject,
  type TiledTileset
} from '../../lib/tiled'
import { useEditorStore } from '../../store/editor-store'
import type Phaser from 'phaser'

type Tool = 'select' | 'brush' | 'erase' | 'rect' | 'eyedropper'
type PhaserMapLayer = Phaser.Tilemaps.TilemapLayer | Phaser.Tilemaps.TilemapGPULayer

export function TilemapEditor({ document }: { document: EditorDocument }): React.JSX.Element {
  const validation = useMemo(() => parseTiled(document.content), [document.content])
  const rawRef = useRef<TiledDocument | null>(validation.document ? structuredClone(validation.document) : null)
  const activeLayerRef = useRef(0)
  const toolRef = useRef<Tool>('select')
  const gidRef = useRef(1)
  const updateDocument = useEditorStore((state) => state.updateDocument)
  const saveDocument = useEditorStore((state) => state.saveDocument)
  const notify = useEditorStore((state) => state.notify)
  const [tool, setTool] = useState<Tool>('select')
  const [activeLayerId, setActiveLayerId] = useState(() => firstTileLayer(validation.document)?.id ?? 0)
  const [activeTileset, setActiveTileset] = useState(0)
  const [selectedGid, setSelectedGid] = useState(() => validation.document?.tilesets[0]?.firstgid ?? 1)
  const [runtimeDocument, setRuntimeDocument] = useState<TiledDocument | null>(validation.document)
  const [revision, setRevision] = useState(0)
  const [grid, setGrid] = useState(true)
  const [history, setHistory] = useState<string[]>([])
  const [future, setFuture] = useState<string[]>([])

  useEffect(() => { toolRef.current = tool }, [tool])
  useEffect(() => { activeLayerRef.current = activeLayerId }, [activeLayerId])
  useEffect(() => { gidRef.current = selectedGid }, [selectedGid])
  useEffect(() => {
    if (!validation.document) return
    rawRef.current = structuredClone(validation.document)
    void resolveExternalTilesets(validation.document, document.path).then(setRuntimeDocument)
  }, [document.path, revision])

  const commit = (mutator?: (map: TiledDocument) => void, structural = false): void => {
    const map = rawRef.current
    if (!map) return
    const before = serializeTiled(map)
    mutator?.(map)
    const next = serializeTiled(map)
    if (next === before) return
    setHistory((items) => [...items.slice(-99), before])
    setFuture([])
    updateDocument(document.path, next)
    if (structural) setRevision((value) => value + 1)
  }

  useEffect(() => {
    const handler = (event: Event): void => {
      const action = (event as CustomEvent<string>).detail
      if (action === 'undo' && history.length > 0) {
        const previous = history.at(-1)!
        setHistory((items) => items.slice(0, -1))
        setFuture((items) => [serializeTiled(rawRef.current!), ...items])
        updateDocument(document.path, previous)
        rawRef.current = JSON.parse(previous) as TiledDocument
        setRevision((value) => value + 1)
      }
      if (action === 'redo' && future.length > 0) {
        const next = future[0]!
        setFuture((items) => items.slice(1))
        setHistory((items) => [...items, serializeTiled(rawRef.current!)])
        updateDocument(document.path, next)
        rawRef.current = JSON.parse(next) as TiledDocument
        setRevision((value) => value + 1)
      }
    }
    window.addEventListener('phaser-editor:editor-action', handler)
    return () => window.removeEventListener('phaser-editor:editor-action', handler)
  }, [document.path, future, history, updateDocument])

  if (!validation.document || !rawRef.current) {
    return <div className="tilemap-error"><strong>Invalid Tiled map</strong>{validation.issues.map((issue) => <span key={issue}>{issue}</span>)}</div>
  }
  const map = rawRef.current
  const layers = flattenLayers(map.layers)
  const tileset = runtimeDocument?.tilesets[activeTileset]

  return <div className="tilemap-editor">
    <div className="tilemap-toolbar">
      <ToolButton tool="select" current={tool} title="Select" onClick={setTool}><MousePointer2 size={15} /></ToolButton>
      <ToolButton tool="brush" current={tool} title="Brush" onClick={setTool}><Brush size={15} /></ToolButton>
      <ToolButton tool="erase" current={tool} title="Eraser" onClick={setTool}><Eraser size={15} /></ToolButton>
      <ToolButton tool="rect" current={tool} title="Rectangle fill" onClick={setTool}><SquareDashed size={15} /></ToolButton>
      <ToolButton tool="eyedropper" current={tool} title="Pick tile" onClick={setTool}><Pipette size={15} /></ToolButton>
      <span className="toolbar-separator" />
      <button className={`icon-button compact${grid ? ' active' : ''}`} title="Toggle grid" onClick={() => setGrid((value) => !value)}><Grid3X3 size={15} /></button>
      <span className="selected-gid">GID {selectedGid}</span>
      <span className="toolbar-spacer" />
      {!validation.editable && <span className="read-only-badge">Read only · {validation.issues[0]}</span>}
      <button className="button small" disabled={!document.dirty || !validation.editable} onClick={async () => {
        const saved = await saveDocument(document.path)
        if (saved) notify('success', 'Tiled map saved and validated')
      }}><Save size={14} />Save map</button>
    </div>
    <div className="tilemap-body">
      <aside className="tileset-panel">
        <div className="tilemap-side-header"><strong>Tilesets</strong><select value={activeTileset} onChange={(event) => setActiveTileset(Number(event.target.value))}>{runtimeDocument?.tilesets.map((item, index) => <option value={index} key={`${item.firstgid}-${index}`}>{item.name ?? item.source ?? `Tileset ${index + 1}`}</option>)}</select></div>
        <TilesetPicker mapPath={document.path} tileset={tileset} selectedGid={selectedGid} onSelect={setSelectedGid} />
      </aside>
      <div className="tilemap-canvas-wrap">
        {runtimeDocument && <PhaserTilemapCanvas key={`${document.path}-${revision}`} mapPath={document.path} runtimeDocument={runtimeDocument} sourceDocument={rawRef} activeLayerRef={activeLayerRef} toolRef={toolRef} gidRef={gidRef} editable={validation.editable} showGrid={grid} onMutate={(mutation) => commit(mutation)} onPick={(gid) => { setSelectedGid(gid); setTool('brush') }} />}
      </div>
      <aside className="map-layers-panel">
        <div className="tilemap-side-header"><strong>Layers</strong><button className="icon-button compact" title="New tile layer" disabled={!validation.editable} onClick={() => commit((current) => {
          const id = Math.max(Number(current.nextlayerid ?? 1), ...flattenLayers(current.layers).map((layer) => layer.id + 1))
          current.layers.push({ id, name: `Tile Layer ${id}`, type: 'tilelayer', width: current.width, height: current.height, visible: true, opacity: 1, x: 0, y: 0, data: new Array(current.width * current.height).fill(0) })
          current.nextlayerid = id + 1
          setActiveLayerId(id)
        }, true)}><Plus size={14} /></button></div>
        <div className="map-layer-list">{layers.map((layer) => <button key={layer.id} className={activeLayerId === layer.id ? 'active' : ''} onClick={() => setActiveLayerId(layer.id)}>
          <span onClick={(event) => { event.stopPropagation(); commit((current) => { const target = findLayer(current.layers, layer.id); if (target) target.visible = target.visible === false }, true) }}>{layer.visible === false ? <EyeOff size={13} /> : <Eye size={13} />}</span>
          <span className="layer-name">{layer.displayName}</span><small>{layer.type}</small>
          <span onClick={(event) => { event.stopPropagation(); commit((current) => { const target = findLayer(current.layers, layer.id); if (target) target.locked = !target.locked }) }}>{layer.locked ? <Lock size={12} /> : <Unlock size={12} />}</span>
        </button>)}</div>
        {activeLayerId > 0 && <div className="layer-actions"><button className="icon-button compact" title="Rename layer" onClick={() => {
          const layer = findLayer(map.layers, activeLayerId)
          const name = layer && window.prompt('Layer name', layer.name)
          if (name) commit((current) => { const target = findLayer(current.layers, activeLayerId); if (target) target.name = name }, true)
        }}><Copy size={13} /></button><button className="icon-button compact danger" title="Delete layer" onClick={() => {
          const layer = findLayer(map.layers, activeLayerId)
          if (!layer || !window.confirm(`Delete layer ${layer.name}?`)) return
          commit((current) => { removeLayer(current.layers, activeLayerId) }, true)
          setActiveLayerId(firstTileLayer(map)?.id ?? 0)
        }}><Trash2 size={13} /></button></div>}
        <div className="map-properties"><h4>Map</h4><div><span>Size</span><strong>{map.width} × {map.height}</strong></div><div><span>Tile</span><strong>{map.tilewidth} × {map.tileheight}</strong></div><div><span>Pixels</span><strong>{map.width * map.tilewidth} × {map.height * map.tileheight}</strong></div><div><span>Orientation</span><strong>{map.orientation}</strong></div></div>
      </aside>
    </div>
  </div>
}

function ToolButton({ tool, current, title, onClick, children }: { tool: Tool; current: Tool; title: string; onClick(tool: Tool): void; children: React.ReactNode }): React.JSX.Element {
  return <button className={`icon-button tile-tool${current === tool ? ' active' : ''}`} title={title} onClick={() => onClick(tool)}>{children}</button>
}

function TilesetPicker({ mapPath, tileset, selectedGid, onSelect }: { mapPath: string; tileset?: TiledTileset; selectedGid: number; onSelect(gid: number): void }): React.JSX.Element {
  if (!tileset?.image) return <div className="panel-empty">No image tileset available</div>
  const imagePath = resolveSibling(mapPath, tileset.image)
  return <div className="tileset-scroll"><div className="tileset-image-wrap"><img src={window.editorApi.fileSystem.assetUrl(imagePath)} alt={tileset.name ?? 'Tileset'} draggable={false} onClick={(event) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const naturalX = (event.clientX - bounds.left) / bounds.width * event.currentTarget.naturalWidth
    const naturalY = (event.clientY - bounds.top) / bounds.height * event.currentTarget.naturalHeight
    const tileWidth = tileset.tilewidth ?? 1
    const tileHeight = tileset.tileheight ?? 1
    const margin = tileset.margin ?? 0
    const spacing = tileset.spacing ?? 0
    const column = Math.floor((naturalX - margin) / (tileWidth + spacing))
    const row = Math.floor((naturalY - margin) / (tileHeight + spacing))
    const columns = tileset.columns ?? Math.floor((event.currentTarget.naturalWidth - margin * 2 + spacing) / (tileWidth + spacing))
    const gid = tileset.firstgid + row * columns + column
    if (gid >= tileset.firstgid && gid < tileset.firstgid + (tileset.tilecount ?? Number.MAX_SAFE_INTEGER)) onSelect(gid)
  }} /><div className="tile-selection-label">Selected {selectedGid}</div></div></div>
}

function PhaserTilemapCanvas(props: {
  mapPath: string
  runtimeDocument: TiledDocument
  sourceDocument: React.MutableRefObject<TiledDocument | null>
  activeLayerRef: React.MutableRefObject<number>
  toolRef: React.MutableRefObject<Tool>
  gidRef: React.MutableRefObject<number>
  editable: boolean
  showGrid: boolean
  onMutate(mutator: (map: TiledDocument) => void): void
  onPick(gid: number): void
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let disposed = false
    let game: Phaser.Game | null = null
    void import('phaser').then(({ default: PhaserRuntime }) => {
      if (disposed || !hostRef.current) return
      const layersById = new Map<number, PhaserMapLayer>()
      const runtime = structuredClone(props.runtimeDocument)
      const gridColor = 0x6f7782
      class EditorScene extends PhaserRuntime.Scene {
        private pan: { x: number; y: number; scrollX: number; scrollY: number } | null = null
        private rectStart: { x: number; y: number } | null = null
        private selection!: Phaser.GameObjects.Graphics

        preload(): void {
          runtime.tilesets.forEach((tileset, index) => {
            if (tileset.image) this.load.image(`tileset-${index}`, window.editorApi.fileSystem.assetUrl(resolveSibling(props.mapPath, tileset.image)))
          })
        }

        create(): void {
          const tilemap = this.make.tilemap({
            width: runtime.width,
            height: runtime.height,
            tileWidth: runtime.tilewidth,
            tileHeight: runtime.tileheight,
            insertNull: false
          })
          const linked = runtime.tilesets.map((tileset, index) => tilemap.addTilesetImage(
            tileset.name ?? `tileset-${index}`,
            `tileset-${index}`,
            tileset.tilewidth ?? runtime.tilewidth,
            tileset.tileheight ?? runtime.tileheight,
            tileset.margin ?? 0,
            tileset.spacing ?? 0,
            tileset.firstgid
          )).filter(Boolean)
          for (const layer of flattenLayers(runtime.layers)) {
            if (layer.type !== 'tilelayer') continue
            const layerWidth = layer.width ?? runtime.width
            const layerHeight = layer.height ?? runtime.height
            const display = tilemap.createBlankLayer(
              layer.displayName,
              linked as Phaser.Tilemaps.Tileset[],
              0,
              0,
              layerWidth,
              layerHeight,
              runtime.tilewidth,
              runtime.tileheight
            )
            if (display) {
              const rows = Array.from({ length: layerHeight }, (_, row) =>
                Array.from({ length: layerWidth }, (_, column) => normalizeGid(layer.data?.[row * layerWidth + column] ?? 0))
              )
              display.putTilesAt(rows, 0, 0)
              display.setVisible(layer.visible !== false)
              layersById.set(layer.id, display)
            }
          }
          this.selection = this.add.graphics().setDepth(10_000)
          this.renderObjects(runtime.layers)
          const worldWidth = runtime.width * runtime.tilewidth
          const worldHeight = runtime.height * runtime.tileheight
          const camera = this.cameras.main
          camera.setBounds(0, 0, worldWidth, worldHeight)
          camera.setZoom(PhaserRuntime.Math.Clamp(Math.min(
            Math.max(1, camera.width - 64) / Math.max(1, worldWidth),
            Math.max(1, camera.height - 64) / Math.max(1, worldHeight)
          ), 0.15, 6))
          camera.centerOn(worldWidth / 2, worldHeight / 2)
          this.input.mouse?.disableContextMenu()
          this.input.on('wheel', (_pointer: unknown, _over: unknown, _dx: number, dy: number) => {
            const camera = this.cameras.main
            camera.setZoom(PhaserRuntime.Math.Clamp(camera.zoom * (dy < 0 ? 1.1 : 0.9), 0.15, 6))
          })
          this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.pointerDown(pointer))
          this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.pointerMove(pointer))
          this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => this.pointerUp(pointer))
        }

        private renderObjects(layers: TiledLayer[]): void {
          for (const layer of flattenLayers(layers)) {
            if (layer.type !== 'objectgroup' || layer.visible === false) continue
            for (const object of layer.objects ?? []) {
              const width = object.width ?? 10
              const height = object.height ?? 10
              const rectangle = this.add.rectangle(object.x + width / 2, object.y + height / 2, Math.max(4, width), Math.max(4, height), 0x38a3d1, 0.18).setStrokeStyle(1, 0x7dd3fc).setDepth(9000)
              if (!layer.locked && props.editable) {
                rectangle.setInteractive({ draggable: true, useHandCursor: true })
                this.input.setDraggable(rectangle)
                rectangle.on('drag', (_pointer: unknown, x: number, y: number) => { rectangle.setPosition(x, y) })
                rectangle.on('dragend', () => props.onMutate((map) => {
                  const target = findObject(map.layers, object.id)
                  if (target) { target.x = rectangle.x - width / 2; target.y = rectangle.y - height / 2 }
                }))
              }
            }
          }
        }

        private tilePoint(pointer: Phaser.Input.Pointer, layer: PhaserMapLayer): { x: number; y: number } {
          const world = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2
          const point = layer.worldToTileXY(world.x, world.y, true)
          return { x: point?.x ?? -1, y: point?.y ?? -1 }
        }

        private pointerDown(pointer: Phaser.Input.Pointer): void {
          if (pointer.middleButtonDown() || pointer.rightButtonDown()) {
            this.pan = { x: pointer.x, y: pointer.y, scrollX: this.cameras.main.scrollX, scrollY: this.cameras.main.scrollY }
            return
          }
          const layer = layersById.get(props.activeLayerRef.current)
          const sourceLayer = props.sourceDocument.current && findLayer(props.sourceDocument.current.layers, props.activeLayerRef.current)
          if (!layer || !sourceLayer || sourceLayer.locked || !props.editable) return
          const point = this.tilePoint(pointer, layer)
          if (props.toolRef.current === 'eyedropper') {
            props.onPick(props.sourceDocument.current ? getTile(props.sourceDocument.current, props.activeLayerRef.current, point.x, point.y) : 0)
          } else if (props.toolRef.current === 'rect' || props.toolRef.current === 'select') {
            this.rectStart = point
            this.drawSelection(point, point)
          } else {
            this.paint(point.x, point.y, layer)
          }
        }

        private pointerMove(pointer: Phaser.Input.Pointer): void {
          if (this.pan) {
            const camera = this.cameras.main
            camera.scrollX = this.pan.scrollX - (pointer.x - this.pan.x) / camera.zoom
            camera.scrollY = this.pan.scrollY - (pointer.y - this.pan.y) / camera.zoom
            return
          }
          const layer = layersById.get(props.activeLayerRef.current)
          if (!layer) return
          const point = this.tilePoint(pointer, layer)
          if (this.rectStart) this.drawSelection(this.rectStart, point)
          else if (pointer.isDown && ['brush', 'erase'].includes(props.toolRef.current)) this.paint(point.x, point.y, layer)
        }

        private pointerUp(pointer: Phaser.Input.Pointer): void {
          this.pan = null
          const layer = layersById.get(props.activeLayerRef.current)
          if (!layer || !this.rectStart) return
          const end = this.tilePoint(pointer, layer)
          if (props.toolRef.current === 'rect') {
            const start = this.rectStart
            const gid = props.gidRef.current
            props.onMutate((map) => fillRect(map, props.activeLayerRef.current, start.x, start.y, end.x, end.y, gid))
            layer.fill(gid, Math.min(start.x, end.x), Math.min(start.y, end.y), Math.abs(end.x - start.x) + 1, Math.abs(end.y - start.y) + 1)
          }
          this.rectStart = null
        }

        private paint(x: number, y: number, layer: PhaserMapLayer): void {
          const gid = props.toolRef.current === 'erase' ? 0 : props.gidRef.current
          const current = props.sourceDocument.current && getTile(props.sourceDocument.current, props.activeLayerRef.current, x, y)
          if (current === gid) return
          props.onMutate((map) => { setTile(map, props.activeLayerRef.current, x, y, gid) })
          if (gid === 0) layer.removeTileAt(x, y)
          else layer.putTileAt(gid, x, y)
        }

        private drawSelection(start: { x: number; y: number }, end: { x: number; y: number }): void {
          this.selection.clear()
          this.selection.lineStyle(1 / this.cameras.main.zoom, gridColor, 1)
          const x = Math.min(start.x, end.x) * runtime.tilewidth
          const y = Math.min(start.y, end.y) * runtime.tileheight
          const width = (Math.abs(end.x - start.x) + 1) * runtime.tilewidth
          const height = (Math.abs(end.y - start.y) + 1) * runtime.tileheight
          this.selection.strokeRect(x, y, width, height)
        }
      }

      game = new PhaserRuntime.Game({
        type: PhaserRuntime.AUTO,
        parent: hostRef.current!,
        backgroundColor: '#17191c',
        pixelArt: true,
        disableContextMenu: true,
        scale: { mode: PhaserRuntime.Scale.RESIZE, width: '100%', height: '100%' },
        input: { keyboard: true, mouse: true, touch: false },
        scene: EditorScene
      })
    })
    return () => { disposed = true; game?.destroy(true) }
  }, [props.mapPath, props.runtimeDocument, props.showGrid])

  return <div ref={hostRef} className={`phaser-map-host${props.showGrid ? ' show-grid' : ''}`} />
}

async function resolveExternalTilesets(document: TiledDocument, mapPath: string): Promise<TiledDocument> {
  const clone = structuredClone(document)
  clone.tilesets = await Promise.all(clone.tilesets.map(async (tileset) => {
    if (!tileset.source) return tileset
    if (!tileset.source.toLocaleLowerCase().endsWith('.json') && !tileset.source.toLocaleLowerCase().endsWith('.tsj')) return tileset
    const externalPath = resolveSibling(mapPath, tileset.source)
    const result = await window.editorApi.fileSystem.read(externalPath)
    if (!result.ok) return tileset
    try {
      const external = JSON.parse(result.value.content) as TiledTileset
      return { ...external, firstgid: tileset.firstgid, image: external.image ? resolveRelative(directoryOf(externalPath), external.image) : undefined }
    } catch {
      return tileset
    }
  }))
  return clone
}

function firstTileLayer(document: TiledDocument | null | undefined): TiledLayer | undefined {
  return document ? flattenLayers(document.layers).find((layer) => layer.type === 'tilelayer') : undefined
}

function removeLayer(layers: TiledLayer[], id: number): boolean {
  const index = layers.findIndex((layer) => layer.id === id)
  if (index >= 0) { layers.splice(index, 1); return true }
  return layers.some((layer) => layer.layers ? removeLayer(layer.layers, id) : false)
}

function findObject(layers: TiledLayer[], id: number): TiledObject | null {
  for (const layer of layers) {
    const object = layer.objects?.find((item) => item.id === id)
    if (object) return object
    if (layer.layers) { const nested = findObject(layer.layers, id); if (nested) return nested }
  }
  return null
}

function directoryOf(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/')
  return normalized.slice(0, normalized.lastIndexOf('/'))
}

function resolveSibling(filePath: string, relative: string): string {
  if (/^[A-Za-z]:[\\/]/.test(relative)) return relative
  return resolveRelative(directoryOf(filePath), relative)
}

function resolveRelative(directory: string, relative: string): string {
  const value = `${directory}/${relative}`.replaceAll('\\', '/')
  const drive = /^[A-Za-z]:/.exec(value)?.[0] ?? ''
  const parts: string[] = []
  for (const part of value.replace(/^[A-Za-z]:/, '').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop(); else parts.push(part)
  }
  return `${drive}\\${parts.join('\\')}`
}

function normalizeGid(gid: number): number {
  return gid === 0 ? -1 : gid & 0x0fffffff
}
