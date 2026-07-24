import { useEffect, useRef, useState } from 'react'
import { Crosshair, Maximize, Minus, Move, Plus, Scan, ZoomIn } from 'lucide-react'
import type { EditorDocument, FileEntry } from '@phaser-editor/contracts'
import { rgbaToHex } from '../../lib/colors'

export function ImageViewer({ document }: { document: EditorDocument }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [drag, setDrag] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const [sampling, setSampling] = useState(false)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const [metadata, setMetadata] = useState<FileEntry | null>(null)
  const source = window.editorApi.fileSystem.assetUrl(document.path)

  useEffect(() => { void window.editorApi.fileSystem.stat(document.path).then((result) => { if (result.ok) setMetadata(result.value) }) }, [document.path])
  useEffect(() => {
    const handler = (): void => setSampling(true)
    window.addEventListener('phaser-editor:start-eyedropper', handler)
    return () => window.removeEventListener('phaser-editor:start-eyedropper', handler)
  }, [])

  const fit = (): void => {
    const container = containerRef.current
    if (!container || !dimensions.width || !dimensions.height) return
    setScale(Math.min((container.clientWidth - 80) / dimensions.width, (container.clientHeight - 80) / dimensions.height, 1))
    setOffset({ x: 0, y: 0 })
  }

  const pick = (event: React.MouseEvent<HTMLImageElement>): void => {
    if (!sampling || !imageRef.current) return
    const image = imageRef.current
    const bounds = image.getBoundingClientRect()
    const x = Math.max(0, Math.min(image.naturalWidth - 1, Math.floor((event.clientX - bounds.left) / bounds.width * image.naturalWidth)))
    const y = Math.max(0, Math.min(image.naturalHeight - 1, Math.floor((event.clientY - bounds.top) / bounds.height * image.naturalHeight)))
    const canvas = window.document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context?.drawImage(image, 0, 0)
    const pixel = context?.getImageData(x, y, 1, 1).data
    if (pixel) window.dispatchEvent(new CustomEvent('phaser-editor:color-picked', { detail: rgbaToHex(pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]!) }))
    setSampling(false)
  }

  return <div className={`image-viewer${sampling ? ' sampling' : ''}`}>
    <div className="editor-toolbar">
      <button className="icon-button compact" title="Zoom out" onClick={() => setScale((value) => Math.max(0.05, value / 1.2))}><Minus size={14} /></button>
      <span className="zoom-label">{Math.round(scale * 100)}%</span>
      <button className="icon-button compact" title="Zoom in" onClick={() => setScale((value) => Math.min(16, value * 1.2))}><Plus size={14} /></button>
      <button className="button small" onClick={fit}><Maximize size={14} />Fit</button>
      <button className="button small" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }) }}><Scan size={14} />1:1</button>
      <button className={`button small${sampling ? ' active' : ''}`} onClick={() => setSampling((value) => !value)}><Crosshair size={14} />Sample</button>
      <span className="toolbar-spacer" />
      <span className="asset-meta">{dimensions.width} × {dimensions.height} · {metadata ? formatBytes(metadata.size) : ''} · {metadata?.extension.toLocaleUpperCase()}</span>
    </div>
    <div ref={containerRef} className="image-canvas checkerboard" onWheel={(event) => { event.preventDefault(); setScale((value) => Math.max(0.05, Math.min(16, value * (event.deltaY < 0 ? 1.12 : 0.89)))) }} onPointerDown={(event) => { if (!sampling) { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); setDrag({ x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }) } }} onPointerMove={(event) => { if (drag) setOffset({ x: drag.ox + event.clientX - drag.x, y: drag.oy + event.clientY - drag.y }) }} onPointerUp={() => setDrag(null)}>
      <img ref={imageRef} src={source} alt={document.name} draggable={false} style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }} onLoad={(event) => { setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); window.setTimeout(fit) }} onClick={pick} />
      {!sampling && <span className="pan-hint"><Move size={13} />Drag to pan · <ZoomIn size={13} />Wheel to zoom</span>}
    </div>
  </div>
}

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
