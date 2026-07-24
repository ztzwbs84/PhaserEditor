import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Box, Maximize, Minus, Pause, Play, Plus, Repeat2, RotateCcw } from 'lucide-react'
import {
  AnimationState,
  AnimationStateData,
  AtlasAttachmentLoader,
  GLTexture,
  Physics,
  SceneRenderer,
  Skeleton,
  SkeletonBinary,
  TextureAtlas,
  type TrackEntry
} from '@esotericsoftware/spine-webgl'
import type { EditorDocument } from '@phaser-editor/contracts'
import { directoryOf, findSpineAtlas, parseSpineAtlasPages, resolveSpineAtlasPage } from '../../lib/spine-assets'
import { centerSpinePreviewBounds, fitSpinePreviewBounds, panSpinePreview, type SpinePreviewBounds } from '../../lib/spine-preview-viewport'

interface SpineAssetSet {
  skeletonPath: string
  atlasPath: string
  pagePaths: string[]
}

interface SpineAnimationInfo {
  name: string
  duration: number
}

interface SpineRuntimeInfo {
  version: string
  animations: SpineAnimationInfo[]
  skins: string[]
  bones: number
  slots: number
}

interface SpinePreviewController {
  selectAnimation(name: string): void
  setPlaying(playing: boolean): void
  setLoop(loop: boolean): void
  setSpeed(speed: number): void
  restart(): void
  seek(seconds: number): void
  fit(): void
  zoom(factor: number): void
}

const DATA_KEY = 'spine-preview-skeleton'
const ATLAS_KEY = 'spine-preview-atlas'

export function SpineViewer({ document }: { document: EditorDocument }): React.JSX.Element {
  const controllerRef = useRef<SpinePreviewController | null>(null)
  const [revision, setRevision] = useState(0)
  const [assets, setAssets] = useState<SpineAssetSet | null>(null)
  const [info, setInfo] = useState<SpineRuntimeInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedAnimation, setSelectedAnimation] = useState<string | null>(null)
  const [playing, setPlaying] = useState(true)
  const [loop, setLoop] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setAssets(null)
    setInfo(null)
    controllerRef.current = null
    void resolveSpineAssets(document.path).then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setError(result.message)
        setLoading(false)
        return
      }
      setAssets(result.assets)
    })
    return () => { cancelled = true }
  }, [document.modifiedAt, document.path, revision])

  useEffect(() => window.editorApi.fileSystem.onChange((event) => {
    const watched = [document.path, assets?.atlasPath, ...(assets?.pagePaths ?? [])].filter(Boolean) as string[]
    if (watched.some((filePath) => samePath(filePath, event.path))) setRevision((value) => value + 1)
  }), [assets, document.path])

  useEffect(() => { controllerRef.current?.setPlaying(playing) }, [playing])
  useEffect(() => { controllerRef.current?.setLoop(loop) }, [loop])
  useEffect(() => { controllerRef.current?.setSpeed(speed) }, [speed])
  useEffect(() => {
    if (!selectedAnimation) return
    setProgress(0)
    controllerRef.current?.selectAnimation(selectedAnimation)
  }, [selectedAnimation])

  const currentAnimation = info?.animations.find((animation) => animation.name === selectedAnimation) ?? null
  const runtimeReady = Boolean(info && controllerRef.current)

  const onReady = useCallback((controller: SpinePreviewController, runtimeInfo: SpineRuntimeInfo, initialAnimation: string | null) => {
    controllerRef.current = controller
    setInfo(runtimeInfo)
    setSelectedAnimation(initialAnimation)
    setLoading(false)
  }, [])

  const onRuntimeError = useCallback((message: string) => {
    controllerRef.current = null
    setError(message)
    setLoading(false)
  }, [])

  return <div className="spine-viewer">
    <div className="editor-toolbar spine-toolbar">
      <button className="icon-button compact" title={playing ? 'Pause animation' : 'Play animation'} disabled={!runtimeReady || !selectedAnimation} onClick={() => setPlaying((value) => !value)}>
        {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
      </button>
      <button className="icon-button compact" title="Restart animation" disabled={!runtimeReady || !selectedAnimation} onClick={() => { setProgress(0); setPlaying(true); controllerRef.current?.restart() }}><RotateCcw size={14} /></button>
      <button className={`icon-button compact${loop ? ' active' : ''}`} title="Loop animation" disabled={!runtimeReady || !selectedAnimation} onClick={() => setLoop((value) => !value)}><Repeat2 size={14} /></button>
      <span className="spine-toolbar-divider" />
      <button className="icon-button compact" title="Zoom out" disabled={!runtimeReady} onClick={() => controllerRef.current?.zoom(0.85)}><Minus size={14} /></button>
      <button className="icon-button compact" title="Zoom in" disabled={!runtimeReady} onClick={() => controllerRef.current?.zoom(1.18)}><Plus size={14} /></button>
      <button className="icon-button compact" title="Fit animation" disabled={!runtimeReady} onClick={() => controllerRef.current?.fit()}><Maximize size={14} /></button>
      <span className="spine-toolbar-divider" />
      <label className="spine-speed-control"><span>Speed</span><select aria-label="Playback speed" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
        {[0.25, 0.5, 0.75, 1, 1.5, 2].map((value) => <option value={value} key={value}>{value}x</option>)}
      </select></label>
      <span className="toolbar-spacer" />
      {info && <span className="asset-meta">Spine {info.version} · {info.animations.length} animations</span>}
    </div>

    <div className="spine-workspace">
      <aside className="spine-animation-list" role="listbox" aria-label="Spine animations">
        <div className="spine-pane-heading"><strong>Animations</strong><span>{info?.animations.length ?? 0}</span></div>
        <div className="spine-animation-scroll">
          {info?.animations.map((animation) => <button
            key={animation.name}
            className={animation.name === selectedAnimation ? 'selected' : ''}
            aria-selected={animation.name === selectedAnimation}
            role="option"
            onClick={() => { setPlaying(true); setSelectedAnimation(animation.name) }}
          ><span>{animation.name}</span><small>{formatDuration(animation.duration)}</small></button>)}
          {info && info.animations.length === 0 && <div className="spine-empty">Setup pose only</div>}
        </div>
      </aside>

      <main className="spine-preview-column">
        <div className="spine-canvas checkerboard" data-testid="spine-preview-canvas">
          {assets && <SpineRuntimeCanvas
            key={`${assets.skeletonPath}-${assets.atlasPath}-${revision}`}
            assets={assets}
            initialPlaying={playing}
            initialLoop={loop}
            initialSpeed={speed}
            onReady={onReady}
            onProgress={setProgress}
            onEnded={() => setPlaying(false)}
            onError={onRuntimeError}
          />}
          {loading && <div className="spine-runtime-state"><span className="spine-loading-ring" />Loading Spine preview...</div>}
          {error && <div className="spine-runtime-state error" role="alert"><AlertTriangle size={22} /><strong>Unable to preview {document.name}</strong><span>{error}</span><button className="button small" onClick={() => setRevision((value) => value + 1)}><RotateCcw size={13} />Retry</button></div>}
        </div>
        <div className="spine-timeline">
          <span>{formatClock(progress)}</span>
          <input
            aria-label="Animation time"
            type="range"
            min={0}
            max={Math.max(0.001, currentAnimation?.duration ?? 0.001)}
            step={0.001}
            disabled={!currentAnimation}
            value={Math.min(progress, currentAnimation?.duration ?? 0)}
            onChange={(event) => {
              const value = Number(event.target.value)
              setPlaying(false)
              setProgress(value)
              controllerRef.current?.seek(value)
            }}
          />
          <span>{formatClock(currentAnimation?.duration ?? 0)}</span>
        </div>
      </main>

      <aside className="spine-inspector">
        <div className="spine-pane-heading"><strong>Skeleton</strong><Box size={14} /></div>
        <dl className="spine-metadata">
          <div><dt>Version</dt><dd>{info?.version ?? '—'}</dd></div>
          <div><dt>Bones</dt><dd>{info?.bones ?? '—'}</dd></div>
          <div><dt>Slots</dt><dd>{info?.slots ?? '—'}</dd></div>
          <div><dt>Skins</dt><dd>{info?.skins.length ?? '—'}</dd></div>
          <div className="wide"><dt>Atlas</dt><dd title={assets?.atlasPath}>{assets?.atlasPath.split(/[\\/]/).pop() ?? '—'}</dd></div>
          <div className="wide"><dt>Texture pages</dt><dd>{assets?.pagePaths.length ?? '—'}</dd></div>
        </dl>
        {info && <section className="spine-skin-section"><h3>Skins</h3>{info.skins.map((skin) => <span key={skin}>{skin}</span>)}</section>}
      </aside>
    </div>
  </div>
}

function SpineRuntimeCanvas({
  assets,
  initialPlaying,
  initialLoop,
  initialSpeed,
  onReady,
  onProgress,
  onEnded,
  onError
}: {
  assets: SpineAssetSet
  initialPlaying: boolean
  initialLoop: boolean
  initialSpeed: number
  onReady(controller: SpinePreviewController, info: SpineRuntimeInfo, initialAnimation: string | null): void
  onProgress(seconds: number): void
  onEnded(): void
  onError(message: string): void
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const callbacks = useRef({ onReady, onProgress, onEnded, onError })
  const initialPlayback = useRef({ playing: initialPlaying, loop: initialLoop, speed: initialSpeed })
  callbacks.current = { onReady, onProgress, onEnded, onError }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let disposed = false
    let controller: WebGLSpinePreviewController | null = null
    const resizeTarget = canvas.parentElement ?? canvas
    const resize = new ResizeObserver(() => controller?.resize())
    resize.observe(resizeTarget)

    void WebGLSpinePreviewController.create(canvas, resizeTarget, assets, {
      playing: initialPlayback.current.playing,
      loop: initialPlayback.current.loop,
      speed: initialPlayback.current.speed,
      onProgress: (seconds) => callbacks.current.onProgress(seconds),
      onEnded: () => callbacks.current.onEnded()
    }).then((preview) => {
      if (disposed) {
        preview.destroy()
        return
      }
      controller = preview
      const firstAnimation = preview.animations.find((animation) => /(^|[_-])idle([_-]|$)/i.test(animation.name))
        ?? preview.animations[0]
        ?? null
      if (firstAnimation) preview.selectAnimation(firstAnimation.name)
      else preview.fit()
      callbacks.current.onReady(preview, preview.info, firstAnimation?.name ?? null)
    }).catch((cause: unknown) => {
      if (!disposed) callbacks.current.onError(spineRuntimeError(cause))
    })

    return () => {
      disposed = true
      resize.disconnect()
      controller?.destroy()
    }
  }, [assets])

  return <div className="spine-phaser-host"><canvas ref={canvasRef} /></div>
}

class WebGLSpinePreviewController implements SpinePreviewController {
  readonly info: SpineRuntimeInfo
  readonly animations: SpineAnimationInfo[]
  private currentAnimation: string | null = null
  private playing: boolean
  private loop: boolean
  private speed: number
  private readonly gl: WebGLRenderingContext
  private readonly renderer: SceneRenderer
  private readonly atlas: TextureAtlas
  private readonly skeleton: Skeleton
  private readonly animationState: AnimationState
  private contentBounds: SpinePreviewBounds
  private scale = 1
  private panX = 0
  private panY = 0
  private pointer: { x: number; y: number } | null = null
  private animationFrame: number | null = null
  private previousFrameTime = 0
  private lastProgressUpdate = 0

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly resizeTarget: HTMLElement,
    gl: WebGLRenderingContext,
    renderer: SceneRenderer,
    atlas: TextureAtlas,
    skeleton: Skeleton,
    animationState: AnimationState,
    private readonly options: { playing: boolean; loop: boolean; speed: number; onProgress(seconds: number): void; onEnded(): void }
  ) {
    this.gl = gl
    this.renderer = renderer
    this.atlas = atlas
    this.skeleton = skeleton
    this.animationState = animationState
    this.playing = options.playing
    this.loop = options.loop
    this.speed = options.speed
    this.animationState.data.defaultMix = 0.12
    this.animationState.addListener({
      complete: (entry: TrackEntry) => {
        if (!entry.loop) options.onEnded()
      }
    })
    this.animations = skeleton.data.animations.map((animation) => ({ name: animation.name, duration: animation.duration }))
    this.info = {
      version: skeleton.data.version ?? 'unknown',
      animations: this.animations,
      skins: skeleton.data.skins.map((skin) => skin.name),
      bones: skeleton.data.bones.length,
      slots: skeleton.data.slots.length
    }
    this.contentBounds = this.measureContentBounds()
    this.canvas.addEventListener('pointerdown', this.pointerDown)
    this.canvas.addEventListener('pointermove', this.pointerMove)
    this.canvas.addEventListener('pointerup', this.pointerUp)
    this.canvas.addEventListener('pointercancel', this.pointerUp)
    this.canvas.addEventListener('wheel', this.pointerWheel, { passive: false })
    this.resize()
    this.animationFrame = requestAnimationFrame(this.renderFrame)
  }

  static async create(
    canvas: HTMLCanvasElement,
    resizeTarget: HTMLElement,
    assets: SpineAssetSet,
    options: { playing: boolean; loop: boolean; speed: number; onProgress(seconds: number): void; onEnded(): void }
  ): Promise<WebGLSpinePreviewController> {
    const gl = canvas.getContext('webgl', { alpha: false, antialias: true })
    if (!gl) throw new Error('WebGL is unavailable in this environment.')
    const [skeletonResponse, atlasResponse] = await Promise.all([
      fetch(window.editorApi.fileSystem.assetUrl(assets.skeletonPath)),
      fetch(window.editorApi.fileSystem.assetUrl(assets.atlasPath))
    ])
    if (!skeletonResponse.ok) throw new Error(`Could not load ${assets.skeletonPath}.`)
    if (!atlasResponse.ok) throw new Error(`Could not load ${assets.atlasPath}.`)
    const [skeletonBinary, atlasText] = await Promise.all([skeletonResponse.arrayBuffer(), atlasResponse.text()])
    const atlas = new TextureAtlas(atlasText)
    if (atlas.pages.length !== assets.pagePaths.length) throw new Error('Atlas texture pages could not be resolved.')
    const images = await Promise.all(assets.pagePaths.map((pagePath) => loadSpineImage(window.editorApi.fileSystem.assetUrl(pagePath))))
    atlas.pages.forEach((page, index) => page.setTexture(new GLTexture(gl, images[index]!)))
    Skeleton.yDown = true
    const skeletonData = new SkeletonBinary(new AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(skeletonBinary))
    const skeleton = new Skeleton(skeletonData)
    skeleton.updateWorldTransform(Physics.update)
    return new WebGLSpinePreviewController(
      canvas,
      resizeTarget,
      gl,
      new SceneRenderer(canvas, gl, true),
      atlas,
      skeleton,
      new AnimationState(new AnimationStateData(skeletonData)),
      options
    )
  }

  selectAnimation(name: string): void {
    if (name === this.currentAnimation) return
    const animation = this.skeleton.data.findAnimation(name)
    if (!animation) return
    this.currentAnimation = name
    this.animationState.setAnimation(0, name, this.loop)
    this.fit()
  }

  setPlaying(playing: boolean): void {
    this.playing = playing
  }

  setLoop(loop: boolean): void {
    this.loop = loop
    const entry = this.animationState.getCurrent(0)
    if (entry) entry.loop = loop
  }

  setSpeed(speed: number): void {
    this.speed = speed
  }

  restart(): void {
    if (!this.currentAnimation) return
    this.playing = true
    this.animationState.setAnimation(0, this.currentAnimation, this.loop)
    this.updatePose(0)
  }

  seek(seconds: number): void {
    const entry = this.animationState.getCurrent(0)
    if (!entry) return
    entry.trackTime = Math.max(0, Math.min(seconds, entry.animationEnd))
    this.updatePose(0)
  }

  fit(): void {
    this.updatePose(0)
    this.contentBounds = this.measureContentBounds()
    this.scale = fitSpinePreviewBounds(this.canvas.width, this.canvas.height, this.contentBounds)
    this.panX = 0
    this.panY = 0
    this.updatePose(0)
  }

  zoom(factor: number): void {
    this.scale = Math.max(0.05, Math.min(12, this.scale * factor))
    this.updatePose(0)
  }

  destroy(): void {
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame)
    this.canvas.removeEventListener('pointerdown', this.pointerDown)
    this.canvas.removeEventListener('pointermove', this.pointerMove)
    this.canvas.removeEventListener('pointerup', this.pointerUp)
    this.canvas.removeEventListener('pointercancel', this.pointerUp)
    this.canvas.removeEventListener('wheel', this.pointerWheel)
    this.atlas.dispose()
    this.renderer.dispose()
  }

  resize(): void {
    const bounds = this.resizeTarget.getBoundingClientRect()
    const width = Math.max(1, Math.floor(bounds.width))
    const height = Math.max(1, Math.floor(bounds.height))
    if (this.canvas.width === width && this.canvas.height === height) return
    this.canvas.width = width
    this.canvas.height = height
    this.renderer.camera.position.x = width / 2
    this.renderer.camera.position.y = height / 2
    this.renderer.camera.setViewport(width, height)
    this.renderer.camera.update()
    this.fit()
  }

  private updatePose(delta: number): void {
    this.animationState.update(this.playing ? delta * this.speed : 0)
    this.animationState.apply(this.skeleton)
    this.skeleton.scaleX = this.scale
    this.skeleton.scaleY = -this.scale
    const position = centerSpinePreviewBounds(
      this.canvas.width,
      this.canvas.height,
      this.contentBounds,
      this.scale,
      this.panX,
      this.panY
    )
    this.skeleton.x = position.x
    this.skeleton.y = position.y
    this.skeleton.update(delta)
    this.skeleton.updateWorldTransform(Physics.update)
  }

  private measureContentBounds(): SpinePreviewBounds {
    const previous = {
      x: this.skeleton.x,
      y: this.skeleton.y,
      scaleX: this.skeleton.scaleX,
      scaleY: this.skeleton.scaleY
    }
    this.skeleton.x = 0
    this.skeleton.y = 0
    this.skeleton.scaleX = 1
    this.skeleton.scaleY = -1
    this.skeleton.updateWorldTransform(Physics.update)
    const bounds = this.skeleton.getBoundsRect()
    this.skeleton.x = previous.x
    this.skeleton.y = previous.y
    this.skeleton.scaleX = previous.scaleX
    this.skeleton.scaleY = previous.scaleY
    return bounds
  }

  private renderFrame = (time: number): void => {
    const delta = this.previousFrameTime === 0 ? 0 : Math.min((time - this.previousFrameTime) / 1000, 0.1)
    this.previousFrameTime = time
    this.updatePose(delta)
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    this.gl.clearColor(0.145, 0.153, 0.169, 1)
    this.gl.clear(this.gl.COLOR_BUFFER_BIT)
    this.renderer.begin()
    this.renderer.drawSkeleton(this.skeleton, false)
    this.renderer.end()
    if (time - this.lastProgressUpdate >= 50) {
      this.lastProgressUpdate = time
      this.options.onProgress(this.animationState.getCurrent(0)?.getAnimationTime() ?? 0)
    }
    this.animationFrame = requestAnimationFrame(this.renderFrame)
  }

  private pointerDown = (event: PointerEvent): void => {
    this.pointer = { x: event.clientX, y: event.clientY }
    this.canvas.setPointerCapture(event.pointerId)
  }

  private pointerMove = (event: PointerEvent): void => {
    if (!this.pointer) return
    const pan = panSpinePreview(
      this.panX,
      this.panY,
      event.clientX - this.pointer.x,
      event.clientY - this.pointer.y
    )
    this.panX = pan.x
    this.panY = pan.y
    this.pointer = { x: event.clientX, y: event.clientY }
    this.updatePose(0)
  }

  private pointerUp = (): void => {
    this.pointer = null
  }

  private pointerWheel = (event: WheelEvent): void => {
    event.preventDefault()
    this.zoom(event.deltaY < 0 ? 1.1 : 0.9)
  }
}

async function loadSpineImage(url: string): Promise<ImageBitmap> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load atlas texture ${url}.`)
  return createImageBitmap(await response.blob())
}

async function resolveSpineAssets(skeletonPath: string): Promise<{ ok: true; assets: SpineAssetSet } | { ok: false; message: string }> {
  const directory = directoryOf(skeletonPath)
  const listed = await window.editorApi.fileSystem.list(directory)
  if (!listed.ok) return { ok: false, message: listed.error.message }
  const atlas = findSpineAtlas(skeletonPath, listed.value)
  if (!atlas.ok) return atlas
  const atlasSnapshot = await window.editorApi.fileSystem.read(atlas.atlas.path)
  if (!atlasSnapshot.ok) return { ok: false, message: atlasSnapshot.error.message }
  const pages = parseSpineAtlasPages(atlasSnapshot.value.content)
  if (pages.length === 0) return { ok: false, message: `${atlas.atlas.name} does not declare a texture page.` }
  const pagePaths = pages.map((page) => resolveSpineAtlasPage(atlas.atlas.path, page))
  const pageStats = await Promise.all(pagePaths.map((pagePath) => window.editorApi.fileSystem.stat(pagePath)))
  const missing = pageStats.flatMap((result, index) => result.ok ? [] : [pages[index]!])
  if (missing.length) return { ok: false, message: `Missing atlas texture ${missing.join(', ')}.` }
  return { ok: true, assets: { skeletonPath, atlasPath: atlas.atlas.path, pagePaths } }
}

function spineRuntimeError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  if (/version/i.test(message)) return `${message} Re-export the skeleton with Spine 4.2.`
  return message
}

function formatDuration(seconds: number): string {
  return `${seconds.toFixed(seconds < 1 ? 2 : 1)}s`
}

function formatClock(seconds: number): string {
  return `${Math.max(0, seconds).toFixed(2)}s`
}

function samePath(left: string, right: string): boolean {
  return left.replaceAll('\\', '/').toLocaleLowerCase() === right.replaceAll('\\', '/').toLocaleLowerCase()
}
