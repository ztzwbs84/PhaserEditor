export interface WechatRuntimeOptions {
  width: number
  height: number
  orientation: 'portrait' | 'landscape'
  phaserVersion?: string
}

export interface WechatViewport {
  width: number
  height: number
  pixelRatio: number
  safeArea: { left: number; top: number; right: number; bottom: number }
}

export interface WechatRuntimeHost {
  canvas: HTMLCanvasElement
  viewport: WechatViewport
  onShow(callback: () => void): () => void
  onHide(callback: () => void): () => void
  onResize(callback: (viewport: WechatViewport) => void): () => void
}

type HostObject = Record<PropertyKey, any>
type HostListener = EventListenerOrEventListenerObject

interface RuntimeState {
  host: WechatRuntimeHost
}

const runtimeStates = new WeakMap<object, RuntimeState>()
const noop = () => undefined

export function installWechatRuntime(
  options: WechatRuntimeOptions,
  rootValue: HostObject = globalThis as HostObject
): WechatRuntimeHost {
  const existing = runtimeStates.get(rootValue)
  if (existing) return existing.host

  const gameGlobal = isObject(rootValue.GameGlobal) ? rootValue.GameGlobal as HostObject : rootValue
  const wx = resolveWechatApi(rootValue, gameGlobal)

  // This must be the first canvas allocated by the adapter and the exact object
  // later injected into every Phaser.Game config.
  const mainCanvas = wx.createCanvas()
  const viewport = readViewport(wx, mainCanvas)
  const canvases = new WeakSet<object>()
  const images = new WeakSet<object>()
  canvases.add(mainCanvas)

  const webglContext = getWebglContext(mainCanvas)
  installWebglCompatibility(webglContext)
  installGlobals({ root: rootValue, gameGlobal, wx, mainCanvas, webglContext, viewport, canvases, images })

  const showListeners = new Set<() => void>()
  const hideListeners = new Set<() => void>()
  const resizeListeners = new Set<(viewport: WechatViewport) => void>()
  const host: WechatRuntimeHost = {
    canvas: mainCanvas as HTMLCanvasElement,
    viewport,
    onShow(callback) {
      showListeners.add(callback)
      return () => showListeners.delete(callback)
    },
    onHide(callback) {
      hideListeners.add(callback)
      return () => hideListeners.delete(callback)
    },
    onResize(callback) {
      resizeListeners.add(callback)
      return () => resizeListeners.delete(callback)
    }
  }

  wx.onShow?.(() => {
    dispatchSimpleEvent(rootValue.window, 'focus')
    showListeners.forEach((callback) => callback())
  })
  wx.onHide?.(() => {
    dispatchSimpleEvent(rootValue.window, 'blur')
    hideListeners.forEach((callback) => callback())
  })
  wx.onWindowResize?.((event: HostObject) => {
    viewport.width = positiveNumber(event?.windowWidth, viewport.width)
    viewport.height = positiveNumber(event?.windowHeight, viewport.height)
    safeAssign(rootValue.window, 'innerWidth', viewport.width)
    safeAssign(rootValue.window, 'innerHeight', viewport.height)
    safeAssign(rootValue.screen, 'width', viewport.width)
    safeAssign(rootValue.screen, 'height', viewport.height)
    resizeListeners.forEach((callback) => callback(viewport))
    dispatchSimpleEvent(rootValue.window, 'resize')
  })

  const gameFactory = (GameConstructor: new (config: HostObject) => unknown, configValue?: HostObject) => {
    const source = isObject(configValue) ? configValue : {}
    const scale = isObject(source.scale) ? source.scale : {}
    const loader = isObject(source.loader) ? source.loader : {}
    const config = {
      ...source,
      type: 2,
      canvas: mainCanvas,
      parent: null,
      customEnvironment: false,
      width: options.width,
      height: options.height,
      scale: {
        ...scale,
        mode: 0,
        autoCenter: 0,
        width: options.width,
        height: options.height
      },
      loader: {
        ...loader,
        imageLoadType: 'HTMLImageElement'
      }
    }
    mainCanvas.width = options.width
    mainCanvas.height = options.height
    return new GameConstructor(config)
  }

  expose(rootValue, gameGlobal, '__PHASER_WECHAT_CREATE_GAME__', gameFactory)
  expose(rootValue, gameGlobal, '__PHASER_WECHAT_HOST__', host)
  expose(rootValue, gameGlobal, '__WXAPP_MAIN_CANVAS__', mainCanvas)
  expose(rootValue, gameGlobal, '__PHASER_WECHAT_VERSION__', options.phaserVersion ?? 'unknown')

  runtimeStates.set(rootValue, { host })
  return host
}

interface InstallGlobalsContext {
  root: HostObject
  gameGlobal: HostObject
  wx: HostObject
  mainCanvas: HostObject
  webglContext?: HostObject
  viewport: WechatViewport
  canvases: WeakSet<object>
  images: WeakSet<object>
}

function installGlobals(context: InstallGlobalsContext): void {
  const { root, gameGlobal, wx, mainCanvas, viewport, canvases, images } = context
  assignIfMissing(root, 'GameGlobal', gameGlobal)

  const currentWindow = isObject(root.window)
    ? root.window as HostObject
    : isObject(gameGlobal.window) ? gameGlobal.window as HostObject : gameGlobal
  exposeIfMissing(root, gameGlobal, 'window', currentWindow)
  exposeIfMissing(root, gameGlobal, 'self', currentWindow)
  exposeIfMissing(root, gameGlobal, 'top', currentWindow)
  exposeIfMissing(root, gameGlobal, 'parent', currentWindow)
  exposeIfMissing(root, gameGlobal, 'global', currentWindow)

  const navigatorObject = isObject(currentWindow.navigator) ? currentWindow.navigator as HostObject : {}
  assignIfMissing(navigatorObject, 'userAgent', 'wechat-minigame')
  assignIfMissing(navigatorObject, 'appVersion', navigatorObject.userAgent)
  assignIfMissing(navigatorObject, 'platform', 'wechat-minigame')
  assignIfMissing(navigatorObject, 'language', 'zh-CN')
  assignIfMissing(navigatorObject, 'onLine', true)
  assignIfMissing(navigatorObject, 'maxTouchPoints', 10)
  assignIfMissing(currentWindow, 'navigator', navigatorObject)
  exposeIfMissing(root, gameGlobal, 'navigator', navigatorObject)

  safeAssign(currentWindow, 'innerWidth', viewport.width)
  safeAssign(currentWindow, 'innerHeight', viewport.height)
  safeAssign(currentWindow, 'devicePixelRatio', viewport.pixelRatio)
  exposeIfMissing(root, gameGlobal, 'devicePixelRatio', viewport.pixelRatio)
  installEventTarget(currentWindow)
  assignIfMissing(currentWindow, 'focus', noop)
  assignIfMissing(currentWindow, 'ontouchstart', null)
  assignIfMissing(currentWindow, 'setTimeout', root.setTimeout?.bind(root) ?? setTimeout)
  assignIfMissing(currentWindow, 'clearTimeout', root.clearTimeout?.bind(root) ?? clearTimeout)
  assignIfMissing(currentWindow, 'setInterval', root.setInterval?.bind(root) ?? setInterval)
  assignIfMissing(currentWindow, 'clearInterval', root.clearInterval?.bind(root) ?? clearInterval)

  const requestFrame = findHostMethod([currentWindow, gameGlobal, root], 'requestAnimationFrame')
    ?? (typeof mainCanvas.requestAnimationFrame === 'function'
      ? mainCanvas.requestAnimationFrame.bind(mainCanvas)
      : (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 16) as unknown as number)
  const cancelFrame = findHostMethod([currentWindow, gameGlobal, root], 'cancelAnimationFrame')
    ?? (typeof mainCanvas.cancelAnimationFrame === 'function'
      ? mainCanvas.cancelAnimationFrame.bind(mainCanvas)
      : (id: number) => clearTimeout(id))
  exposeIfMissing(root, gameGlobal, 'requestAnimationFrame', requestFrame)
  exposeIfMissing(root, gameGlobal, 'cancelAnimationFrame', cancelFrame)
  assignIfMissing(currentWindow, 'requestAnimationFrame', requestFrame)
  assignIfMissing(currentWindow, 'cancelAnimationFrame', cancelFrame)

  const performanceObject = isObject(currentWindow.performance) ? currentWindow.performance as HostObject : { now: () => Date.now() }
  assignIfMissing(performanceObject, 'now', () => Date.now())
  assignIfMissing(currentWindow, 'performance', performanceObject)
  exposeIfMissing(root, gameGlobal, 'performance', performanceObject)

  const URLSearchParamsConstructor = typeof currentWindow.URLSearchParams === 'function'
    ? currentWindow.URLSearchParams
    : typeof root.URLSearchParams === 'function' ? root.URLSearchParams : WechatURLSearchParams
  exposeIfMissing(root, gameGlobal, 'URLSearchParams', URLSearchParamsConstructor)

  const screenObject = isObject(root.screen) ? root.screen as HostObject : {}
  safeAssign(screenObject, 'width', viewport.width)
  safeAssign(screenObject, 'height', viewport.height)
  assignIfMissing(screenObject, 'orientation', {
    type: viewport.width > viewport.height ? 'landscape-primary' : 'portrait-primary',
    angle: 0,
    addEventListener: noop,
    removeEventListener: noop
  })
  assignIfMissing(screenObject, 'lockOrientation', undefined)
  exposeIfMissing(root, gameGlobal, 'screen', screenObject)

  const body = createElementStub(viewport)
  const documentElement = createElementStub(viewport)
  const head = createElementStub(viewport)
  const documentObject = isObject(root.document)
    ? root.document as HostObject
    : isObject(gameGlobal.document) ? gameGlobal.document as HostObject : {}
  const nativeCreateElement = bindHostMethod(documentObject, 'createElement')
  const nativeCreateElementNS = bindHostMethod(documentObject, 'createElementNS')
  patchElement(documentObject.body, viewport)
  patchElement(documentObject.documentElement, viewport)
  assignIfMissing(documentObject, 'readyState', 'complete')
  assignIfMissing(documentObject, 'baseURI', 'https://minigame.local/')
  assignIfMissing(documentObject, 'URL', 'https://minigame.local/game.js')
  assignIfMissing(documentObject, 'currentScript', { tagName: 'SCRIPT', src: 'game.js' })
  assignIfMissing(documentObject, 'body', body)
  assignIfMissing(documentObject, 'documentElement', documentElement)
  assignIfMissing(documentObject, 'head', head)
  patchElement(documentObject.body, viewport)
  patchElement(documentObject.documentElement, viewport)
  patchElement(documentObject.head, viewport)
  assignIfMissing(documentObject, 'fonts', { ready: Promise.resolve(), add: noop })
  installEventTarget(documentObject)
  assignIfMissing(documentObject, 'elementFromPoint', () => mainCanvas)
  assignIfMissing(documentObject, 'getElementById', () => null)
  assignIfMissing(documentObject, 'getElementsByTagName', (tagName: string) => {
    if (tagName.toLowerCase() === 'head') return [documentObject.head]
    if (tagName.toLowerCase() === 'body') return [documentObject.body]
    if (tagName.toLowerCase() === 'script') return [documentObject.currentScript]
    return []
  })
  assignIfMissing(documentObject, 'querySelectorAll', () => [])
  assignIfMissing(documentObject, 'querySelector', (selector: string) => {
    if (selector === 'head') return documentObject.head
    if (selector === 'body') return documentObject.body
    if (selector === 'html') return documentObject.documentElement
    return null
  })
  assignIfMissing(documentObject, 'createTextNode', (text: string) => ({ textContent: text }))
  safeAssign(documentObject, 'createElement', (tagName: string, ...args: unknown[]) => createNativeElement(
    tagName, wx, viewport, documentObject, documentObject.body, canvases, images,
    nativeCreateElement ? () => nativeCreateElement(tagName, ...args) : undefined
  ))
  safeAssign(documentObject, 'createElementNS', (namespace: string, tagName: string, ...args: unknown[]) => createNativeElement(
    tagName, wx, viewport, documentObject, documentObject.body, canvases, images,
    nativeCreateElementNS
      ? () => nativeCreateElementNS(namespace, tagName, ...args)
      : nativeCreateElement ? () => nativeCreateElement(tagName) : undefined
  ))
  exposeIfMissing(root, gameGlobal, 'document', documentObject)

  const createImage = () => {
    const image = wx.createImage()
    if (isObject(image)) images.add(image)
    return image
  }
  const ImageConstructor = makeHostConstructor('Image', (value) => isObject(value) && images.has(value), createImage)
  const CanvasConstructor = makeHostConstructor('HTMLCanvasElement', (value) => isObject(value) && canvases.has(value))
  expose(root, gameGlobal, 'Image', ImageConstructor)
  expose(root, gameGlobal, 'HTMLImageElement', ImageConstructor)
  expose(root, gameGlobal, 'HTMLCanvasElement', CanvasConstructor)
  expose(root, gameGlobal, 'HTMLElement', makeHostConstructor(
    'HTMLElement',
    (value) => isObject(value) && (value as HostObject).nodeType === 1
  ))
  expose(root, gameGlobal, 'HTMLVideoElement', makeHostConstructor('HTMLVideoElement', () => false))

  const locationObject = isObject(currentWindow.location) ? currentWindow.location as HostObject : {
    href: 'https://minigame.local/game.js',
    origin: 'https://minigame.local',
    protocol: 'https:',
    host: 'minigame.local',
    hostname: 'minigame.local',
    pathname: '/game.js',
    search: '',
    hash: ''
  }
  assignIfMissing(currentWindow, 'location', locationObject)
  exposeIfMissing(root, gameGlobal, 'location', locationObject)

  expose(root, gameGlobal, 'XMLHttpRequest', createWechatXMLHttpRequest(wx))
  expose(root, gameGlobal, 'localStorage', createLocalStorage(wx))
  decorateCanvas(mainCanvas, viewport, documentObject, documentObject.body, wx, true)
  installContextGlobals(context)
}

function createNativeElement(
  tagName: string,
  wx: HostObject,
  viewport: WechatViewport,
  documentObject: HostObject,
  parent: HostObject,
  canvases: WeakSet<object>,
  images: WeakSet<object>,
  fallback?: () => unknown
): HostObject {
  const tag = tagName.toLowerCase()
  if (tag === 'canvas') {
    const canvas = wx.createCanvas()
    if (isObject(canvas)) canvases.add(canvas)
    decorateCanvas(canvas, viewport, documentObject, parent, wx, false)
    return canvas
  }
  if (tag === 'img' || tag === 'image') {
    const image = wx.createImage()
    if (isObject(image)) images.add(image)
    return image
  }
  if (tag === 'audio' || tag === 'video') {
    const media = createElementStub(viewport)
    media.canPlayType = () => ''
    media.load = noop
    media.play = () => Promise.resolve()
    media.pause = noop
    return media
  }
  const nativeElement = fallback?.()
  if (isObject(nativeElement)) return nativeElement as HostObject
  return createElementStub(viewport)
}

function decorateCanvas(
  canvas: HostObject,
  viewport: WechatViewport,
  documentObject: HostObject,
  parent: HostObject,
  wx: HostObject,
  bridgeTouch: boolean
): void {
  assignIfMissing(canvas, 'style', {})
  assignIfMissing(canvas, 'parentNode', parent)
  assignIfMissing(canvas, 'parentElement', parent)
  assignIfMissing(canvas, 'ownerDocument', documentObject)
  assignIfMissing(canvas, 'ontouchstart', null)
  assignIfMissing(canvas, 'setAttribute', noop)
  assignIfMissing(canvas, 'focus', noop)
  assignIfMissing(canvas, 'getBoundingClientRect', () => ({
    left: 0,
    top: 0,
    right: viewport.width,
    bottom: viewport.height,
    width: viewport.width,
    height: viewport.height,
    x: 0,
    y: 0,
    toJSON: () => ({})
  }))
  if (typeof canvas.addEventListener !== 'function') {
    if (bridgeTouch) installCanvasTouchFallback(canvas, wx)
    else installEventTarget(canvas)
  }
}

function installCanvasTouchFallback(canvas: HostObject, wx: HostObject): void {
  if (canvas.__phaserWechatTouchFallback === true || typeof canvas.addEventListener === 'function') return
  const target = createEventTarget()
  safeAssign(canvas, 'addEventListener', target.addEventListener)
  safeAssign(canvas, 'removeEventListener', target.removeEventListener)
  safeAssign(canvas, 'dispatchEvent', target.dispatchEvent)
  safeAssign(canvas, '__phaserWechatTouchFallback', true)

  const forward = (type: string, source: HostObject) => {
    const event = createTouchEvent(type, source, canvas)
    target.dispatchEvent(event as Event)
  }
  wx.onTouchStart?.((event: HostObject) => forward('touchstart', event))
  wx.onTouchMove?.((event: HostObject) => forward('touchmove', event))
  wx.onTouchEnd?.((event: HostObject) => forward('touchend', event))
  wx.onTouchCancel?.((event: HostObject) => forward('touchcancel', event))
}

function createTouchEvent(type: string, source: HostObject, canvas: HostObject): HostObject {
  const normalizeTouches = (touches: unknown) => Array.isArray(touches) ? touches.map((touch, index) => {
    const value = isObject(touch) ? touch as HostObject : {}
    const x = finiteNumber(value.clientX ?? value.pageX ?? value.x, 0)
    const y = finiteNumber(value.clientY ?? value.pageY ?? value.y, 0)
    const identifier = finiteNumber(value.identifier ?? value.id, index)
    return {
      ...value,
      identifier,
      pointerId: identifier,
      clientX: x,
      clientY: y,
      pageX: x,
      pageY: y,
      screenX: finiteNumber(value.screenX, x),
      screenY: finiteNumber(value.screenY, y),
      target: canvas
    }
  }) : []
  return {
    type,
    target: canvas,
    currentTarget: canvas,
    timeStamp: finiteNumber(source.timeStamp, Date.now()),
    touches: normalizeTouches(source.touches),
    targetTouches: normalizeTouches(source.touches),
    changedTouches: normalizeTouches(source.changedTouches),
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true },
    stopPropagation: noop
  }
}

function installWebglCompatibility(gl: HostObject | undefined): void {
  try {
    if (!gl) return
    if (typeof gl.bindVertexArray !== 'function') {
      const vao = gl.getExtension?.('OES_vertex_array_object')
      if (vao) {
        gl.createVertexArray = vao.createVertexArrayOES.bind(vao)
        gl.deleteVertexArray = vao.deleteVertexArrayOES.bind(vao)
        gl.isVertexArray = vao.isVertexArrayOES.bind(vao)
        gl.bindVertexArray = vao.bindVertexArrayOES.bind(vao)
      }
    }
  } catch {
    // Phaser will surface the renderer error with its own context.
  }
}

function installContextConstructors(root: HostObject, gameGlobal: HostObject, gl: HostObject | undefined, wx: HostObject): void {
  try {
    const glConstructor = gl && Object.getPrototypeOf(gl)?.constructor
    if (typeof glConstructor === 'function') expose(root, gameGlobal, 'WebGLRenderingContext', glConstructor)
    else expose(root, gameGlobal, 'WebGLRenderingContext', function WebGLRenderingContext() {})
  } catch {
    expose(root, gameGlobal, 'WebGLRenderingContext', function WebGLRenderingContext() {})
  }

  try {
    const probe2d = wx.createCanvas()
    const context2d = probe2d.getContext?.('2d')
    const context2dConstructor = context2d && Object.getPrototypeOf(context2d)?.constructor
    if (typeof context2dConstructor === 'function') expose(root, gameGlobal, 'CanvasRenderingContext2D', context2dConstructor)
    else expose(root, gameGlobal, 'CanvasRenderingContext2D', function CanvasRenderingContext2D() {})
  } catch {
    expose(root, gameGlobal, 'CanvasRenderingContext2D', function CanvasRenderingContext2D() {})
  }

  try {
    const gl2Constructor = gl && typeof gl.texStorage2D === 'function'
      ? Object.getPrototypeOf(gl)?.constructor
      : undefined
    if (typeof gl2Constructor === 'function') expose(root, gameGlobal, 'WebGL2RenderingContext', gl2Constructor)
    else expose(root, gameGlobal, 'WebGL2RenderingContext', function WebGL2RenderingContext() {})
  } catch {
    expose(root, gameGlobal, 'WebGL2RenderingContext', function WebGL2RenderingContext() {})
  }
}

function createWechatXMLHttpRequest(wx: HostObject): new () => HostObject {
  return class WechatXMLHttpRequest {
    readyState = 0
    status = 0
    statusText = ''
    response: unknown = null
    responseText = ''
    responseType = ''
    responseURL = ''
    timeout = 0
    withCredentials = false
    onload: ((event: HostObject) => void) | null = null
    onerror: ((event: HostObject) => void) | null = null
    onprogress: ((event: HostObject) => void) | null = null
    ontimeout: ((event: HostObject) => void) | null = null
    onreadystatechange: ((event: HostObject) => void) | null = null
    upload = createEventTarget()
    private method = 'GET'
    private url = ''
    private headers: Record<string, string> = {}
    private aborted = false
    private events = createEventTarget()

    open(method: string, url: string): void {
      this.method = method
      this.url = normalizeRequestUrl(url)
      this.readyState = 1
      this.emitReadyState()
    }

    setRequestHeader(name: string, value: string): void {
      this.headers[name] = value
    }

    overrideMimeType(): void {}
    getAllResponseHeaders(): string { return '' }
    getResponseHeader(): string | null { return null }
    addEventListener(type: string, listener: HostListener): void { this.events.addEventListener(type, listener) }
    removeEventListener(type: string, listener: HostListener): void { this.events.removeEventListener(type, listener) }

    abort(): void {
      this.aborted = true
      this.readyState = 0
    }

    send(data?: unknown): void {
      this.aborted = false
      if (/^(?:https?:)?\/\//i.test(this.url)) {
        wx.request?.({
          url: this.url,
          method: this.method,
          data,
          header: this.headers,
          timeout: this.timeout || undefined,
          responseType: this.responseType === 'arraybuffer' ? 'arraybuffer' : 'text',
          success: (result: HostObject) => {
            const ok = result.statusCode >= 200 && result.statusCode < 300
            this.finish(ok, result.data, result.statusCode)
          },
          fail: (error: HostObject) => {
            if (String(error?.errMsg ?? '').includes('timeout')) this.timeoutFailure()
            else this.finish(false, null, 0)
          }
        })
        return
      }

      const fileSystem = wx.getFileSystemManager?.()
      if (!fileSystem) {
        this.finish(false, null, 0)
        return
      }
      fileSystem.readFile({
        filePath: this.url,
        encoding: this.responseType === 'arraybuffer' ? undefined : 'utf8',
        success: (result: HostObject) => this.finish(true, result.data, 200),
        fail: () => this.finish(false, null, 404)
      })
    }

    private finish(ok: boolean, data: unknown, status: number): void {
      if (this.aborted) return
      this.readyState = 4
      this.status = status
      this.statusText = ok ? 'OK' : 'Error'
      this.responseURL = this.url
      if (this.responseType === 'json' && typeof data === 'string') {
        try { this.response = JSON.parse(data) } catch { this.response = null }
      } else {
        this.response = data
      }
      this.responseText = typeof data === 'string' ? data : ''
      this.emitReadyState()
      const event = { type: ok ? 'load' : 'error', target: this, currentTarget: this }
      if (ok) this.onload?.(event)
      else this.onerror?.(event)
      this.events.dispatchEvent(event as unknown as Event)
    }

    private timeoutFailure(): void {
      if (this.aborted) return
      this.readyState = 4
      this.status = 0
      this.emitReadyState()
      const event = { type: 'timeout', target: this, currentTarget: this }
      this.ontimeout?.(event)
      this.events.dispatchEvent(event as unknown as Event)
    }

    private emitReadyState(): void {
      const event = { type: 'readystatechange', target: this, currentTarget: this }
      this.onreadystatechange?.(event)
      this.events.dispatchEvent(event as unknown as Event)
    }
  }
}

function createLocalStorage(wx: HostObject): HostObject {
  return {
    getItem(key: string) {
      const value = wx.getStorageSync?.(key)
      return value === '' || value === undefined || value === null ? null : String(value)
    },
    setItem(key: string, value: unknown) { wx.setStorageSync?.(key, String(value)) },
    removeItem(key: string) { wx.removeStorageSync?.(key) },
    clear() { wx.clearStorageSync?.() }
  }
}

function readViewport(wx: HostObject, mainCanvas: HostObject): WechatViewport {
  let info: HostObject = {}
  let deviceInfo: HostObject = {}
  try {
    if (typeof wx.getWindowInfo === 'function') info = wx.getWindowInfo() ?? {}
  } catch {}
  try {
    if (typeof wx.getDeviceInfo === 'function') deviceInfo = wx.getDeviceInfo() ?? {}
  } catch {}
  const width = positiveNumber(info.windowWidth ?? info.screenWidth ?? deviceInfo.screenWidth ?? mainCanvas.width, 720)
  const height = positiveNumber(info.windowHeight ?? info.screenHeight ?? deviceInfo.screenHeight ?? mainCanvas.height, 1280)
  const safe = isObject(info.safeArea) ? info.safeArea as HostObject : {}
  return {
    width,
    height,
    pixelRatio: positiveNumber(info.pixelRatio ?? deviceInfo.pixelRatio, 1),
    safeArea: {
      left: finiteNumber(safe.left, 0),
      top: finiteNumber(safe.top, 0),
      right: finiteNumber(safe.right, width),
      bottom: finiteNumber(safe.bottom, height)
    }
  }
}

function resolveWechatApi(root: HostObject, gameGlobal: HostObject): HostObject {
  const wx = root.wx ?? gameGlobal.wx
  if (
    !isObject(wx)
    || typeof (wx as HostObject).createCanvas !== 'function'
    || typeof (wx as HostObject).createImage !== 'function'
  ) {
    throw new Error('Wechat Mini Game API is unavailable: wx.createCanvas/createImage are required.')
  }
  return wx as HostObject
}

function createElementStub(viewport: WechatViewport): HostObject {
  const element: HostObject = {
    nodeType: 1,
    style: {},
    ontouchstart: null,
    clientWidth: viewport.width,
    clientHeight: viewport.height,
    offsetWidth: viewport.width,
    offsetHeight: viewport.height,
    firstChild: null,
    parentNode: null,
    parentElement: null,
    setAttribute: noop,
    getAttribute: () => null,
    focus: noop,
    getContext: () => null,
    getBoundingClientRect: () => ({
      left: 0, top: 0, right: viewport.width, bottom: viewport.height,
      width: viewport.width, height: viewport.height, x: 0, y: 0,
      toJSON: () => ({})
    })
  }
  installEventTarget(element)
  patchElement(element, viewport)
  return element
}

function patchElement(value: unknown, viewport: WechatViewport): void {
  if (!isObject(value)) return
  const element = value as HostObject
  assignIfMissing(element, 'style', {})
  assignIfMissing(element, 'ontouchstart', null)
  assignIfMissing(element, 'clientWidth', viewport.width)
  assignIfMissing(element, 'clientHeight', viewport.height)
  assignIfMissing(element, 'appendChild', (child: HostObject) => child)
  assignIfMissing(element, 'removeChild', (child: HostObject) => child)
  assignIfMissing(element, 'insertBefore', (child: HostObject) => child)
  assignIfMissing(element, 'getBoundingClientRect', () => ({
    left: 0, top: 0, right: viewport.width, bottom: viewport.height,
    width: viewport.width, height: viewport.height, x: 0, y: 0,
    toJSON: () => ({})
  }))
  installEventTarget(element)
}

function createEventTarget(): {
  addEventListener(type: string, listener: HostListener): void
  removeEventListener(type: string, listener: HostListener): void
  dispatchEvent(event: Event): boolean
} {
  const listeners = new Map<string, Set<HostListener>>()
  return {
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set<HostListener>()
      set.add(listener)
      listeners.set(type, set)
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) ?? []) {
        if (typeof listener === 'function') listener.call(this, event)
        else listener.handleEvent(event)
      }
      return !(event as Event).defaultPrevented
    }
  }
}

function installEventTarget(target: HostObject): void {
  if (typeof target.addEventListener === 'function') return
  const events = createEventTarget()
  safeAssign(target, 'addEventListener', events.addEventListener)
  safeAssign(target, 'removeEventListener', events.removeEventListener)
  safeAssign(target, 'dispatchEvent', events.dispatchEvent)
}

function dispatchSimpleEvent(target: HostObject, type: string): void {
  if (typeof target?.dispatchEvent !== 'function') return
  const EventConstructor = typeof target.Event === 'function'
    ? target.Event
    : typeof globalThis.Event === 'function' ? globalThis.Event : undefined
  if (EventConstructor) {
    try {
      target.dispatchEvent(new EventConstructor(type))
      return
    } catch {}
  }
  try {
    target.dispatchEvent({ type, target, currentTarget: target })
  } catch {
    // Native EventTarget implementations reject plain event-shaped objects.
  }
}

class WechatURLSearchParams {
  private pairs: Array<[string, string]> = []

  constructor(init: unknown = '') {
    if (typeof init === 'string') {
      this.readString(init)
      return
    }
    if (!isObject(init)) return
    const iterator = (init as HostObject)[Symbol.iterator]
    if (typeof iterator === 'function') {
      for (const pair of init as Iterable<unknown>) {
        if (!Array.isArray(pair) || pair.length < 2) continue
        this.append(String(pair[0]), String(pair[1]))
      }
      return
    }
    for (const [key, value] of Object.entries(init)) this.append(key, String(value))
  }

  get size(): number { return this.pairs.length }

  append(name: string, value: string): void {
    this.pairs.push([String(name), String(value)])
  }

  delete(name: string, value?: string): void {
    const key = String(name)
    this.pairs = this.pairs.filter(([pairName, pairValue]) => (
      pairName !== key || (value !== undefined && pairValue !== String(value))
    ))
  }

  get(name: string): string | null {
    const key = String(name)
    return this.pairs.find(([pairName]) => pairName === key)?.[1] ?? null
  }

  getAll(name: string): string[] {
    const key = String(name)
    return this.pairs.filter(([pairName]) => pairName === key).map(([, value]) => value)
  }

  has(name: string, value?: string): boolean {
    const key = String(name)
    return this.pairs.some(([pairName, pairValue]) => (
      pairName === key && (value === undefined || pairValue === String(value))
    ))
  }

  set(name: string, value: string): void {
    const key = String(name)
    const nextValue = String(value)
    const index = this.pairs.findIndex(([pairName]) => pairName === key)
    if (index === -1) {
      this.pairs.push([key, nextValue])
      return
    }
    this.pairs[index] = [key, nextValue]
    this.pairs = this.pairs.filter(([pairName], pairIndex) => pairName !== key || pairIndex === index)
  }

  sort(): void {
    this.pairs = this.pairs
      .map((pair, index) => ({ index, pair }))
      .sort((left, right) => left.pair[0].localeCompare(right.pair[0]) || left.index - right.index)
      .map(({ pair }) => pair)
  }

  forEach(callback: (value: string, key: string, params: WechatURLSearchParams) => void, thisArg?: unknown): void {
    for (const [key, value] of this.pairs) callback.call(thisArg, value, key, this)
  }

  *entries(): IterableIterator<[string, string]> {
    for (const pair of this.pairs) yield [...pair] as [string, string]
  }

  *keys(): IterableIterator<string> {
    for (const [key] of this.pairs) yield key
  }

  *values(): IterableIterator<string> {
    for (const [, value] of this.pairs) yield value
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries()
  }

  toString(): string {
    return this.pairs.map(([key, value]) => `${encodeQueryPart(key)}=${encodeQueryPart(value)}`).join('&')
  }

  private readString(source: string): void {
    const query = source.startsWith('?') ? source.slice(1) : source
    if (!query) return
    for (const part of query.split('&')) {
      if (!part) continue
      const separator = part.indexOf('=')
      const key = separator === -1 ? part : part.slice(0, separator)
      const value = separator === -1 ? '' : part.slice(separator + 1)
      this.append(decodeQueryPart(key), decodeQueryPart(value))
    }
  }
}

function decodeQueryPart(value: string): string {
  const normalized = value.replace(/\+/g, ' ')
  try { return decodeURIComponent(normalized) } catch { return normalized }
}

function encodeQueryPart(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, '+')
}

function makeHostConstructor(
  name: string,
  hasInstance: (value: unknown) => boolean,
  factory?: () => unknown
): HostObject {
  const constructor = function (this: unknown) { return factory ? factory() : this }
  try { Object.defineProperty(constructor, 'name', { value: name }) } catch {}
  try { Object.defineProperty(constructor, Symbol.hasInstance, { value: hasInstance }) } catch {}
  return constructor as unknown as HostObject
}

function normalizeRequestUrl(urlValue: string): string {
  let url = String(urlValue).replace(/\\/g, '/')
  if (url.startsWith('https://minigame.local/')) url = url.slice('https://minigame.local/'.length)
  if (/^https?:\/\//i.test(url) || /^\/\//.test(url)) return url
  url = url.split(/[?#]/, 1)[0]!
  return url.replace(/^\.\//, '').replace(/^\//, '')
}

function installContextGlobals(context: InstallGlobalsContext): void {
  installContextConstructors(context.root, context.gameGlobal, context.webglContext, context.wx)
}

function expose(root: HostObject, gameGlobal: HostObject, key: PropertyKey, value: unknown): void {
  safeAssign(gameGlobal, key, value)
  if (root !== gameGlobal) safeAssign(root, key, gameGlobal[key] ?? value)
  if (isObject(root.window)) safeAssign(root.window as HostObject, key, root[key] ?? gameGlobal[key] ?? value)
}

function exposeIfMissing(root: HostObject, gameGlobal: HostObject, key: PropertyKey, value: unknown): void {
  assignIfMissing(gameGlobal, key, value)
  if (root !== gameGlobal) assignIfMissing(root, key, gameGlobal[key] ?? value)
  if (isObject(root.window)) assignIfMissing(root.window as HostObject, key, root[key] ?? gameGlobal[key] ?? value)
}

function bindHostMethod(target: HostObject, key: PropertyKey): ((...args: unknown[]) => unknown) | undefined {
  const method = target[key]
  return typeof method === 'function' ? method.bind(target) : undefined
}

function findHostMethod(targets: HostObject[], key: PropertyKey): ((...args: any[]) => any) | undefined {
  for (const target of targets) {
    const method = target?.[key]
    if (typeof method === 'function') return (...args: any[]) => Reflect.apply(method, target, args)
  }
  return undefined
}

function getWebglContext(canvas: HostObject): HostObject | undefined {
  try {
    return canvas.getContext?.('webgl') ?? canvas.getContext?.('experimental-webgl') ?? undefined
  } catch {
    return undefined
  }
}

function assignIfMissing(target: HostObject, key: PropertyKey, value: unknown): void {
  if (target[key] === undefined) safeAssign(target, key, value)
}

function safeAssign(target: HostObject, key: PropertyKey, value: unknown): void {
  if (!isObject(target)) return
  try {
    const descriptor = Object.getOwnPropertyDescriptor(target, key)
    if (descriptor?.configurable === false) {
      if (descriptor.writable === false && !descriptor.set) return
      target[key] = value
      return
    }
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value
    })
  } catch {
    // WeChat exposes several immutable browser-like accessors.
  }
}

function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

function positiveNumber(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function finiteNumber(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}
