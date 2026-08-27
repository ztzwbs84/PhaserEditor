import { describe, expect, it, vi } from 'vitest'
import { installWechatRuntime } from '../src/runtime/wechat-runtime.js'

class FakeWebGLContext {
  readonly extension = {
    createVertexArrayOES: () => ({ vao: true }),
    deleteVertexArrayOES: () => undefined,
    isVertexArrayOES: () => true,
    bindVertexArrayOES: () => undefined
  }

  getExtension(name: string) {
    return name === 'OES_vertex_array_object' ? this.extension : null
  }
}

class FakeWebGL2Context {}
class FakeCanvas2DContext {}

function createRuntimeMock(hostWindow: any = {}) {
  const canvases: any[] = []
  const images: any[] = []
  const imageSources: string[] = []
  const touch: Record<string, (event: any) => void> = {}
  const lifecycle: Record<string, (event?: any) => void> = {}
  const gl = new FakeWebGLContext()
  const gl2 = new FakeWebGL2Context()
  const wx = {
    createCanvas() {
      const index = canvases.length
      const canvas: any = {
        width: 360,
        height: 640,
        getContext(type: string) {
          if (index === 0 && (type === 'webgl' || type === 'experimental-webgl')) return gl
          if (type === '2d') return new FakeCanvas2DContext()
          if (type === 'webgl2') return gl2
          return null
        },
        requestAnimationFrame(callback: (time: number) => void) {
          callback(1)
          return 7
        },
        cancelAnimationFrame() {}
      }
      canvases.push(canvas)
      return canvas
    },
    createImage() {
      let src = ''
      const image = { nativeImage: true }
      Object.defineProperty(image, 'src', {
        configurable: true,
        enumerable: true,
        get: () => src,
        set(value: string) {
          src = value
          imageSources.push(value)
        }
      })
      images.push(image)
      return image
    },
    createInnerAudioContext: () => ({}),
    getWindowInfo: () => ({
      windowWidth: 360,
      windowHeight: 640,
      pixelRatio: 3,
      safeArea: { left: 2, top: 20, right: 358, bottom: 620 }
    }),
    onTouchStart: (callback: (event: any) => void) => { touch.start = callback },
    onTouchMove: (callback: (event: any) => void) => { touch.move = callback },
    onTouchEnd: (callback: (event: any) => void) => { touch.end = callback },
    onTouchCancel: (callback: (event: any) => void) => { touch.cancel = callback },
    onShow: (callback: () => void) => { lifecycle.show = callback },
    onHide: (callback: () => void) => { lifecycle.hide = callback },
    onWindowResize: (callback: (event: any) => void) => { lifecycle.resize = callback },
    getFileSystemManager: () => ({
      readFile({ filePath, success }: any) { success({ data: `read:${filePath}` }) }
    }),
    getStorageSync: () => '',
    setStorageSync: () => undefined,
    removeStorageSync: () => undefined
  }
  const root: any = { wx }
  Object.defineProperty(root, 'window', { configurable: false, get: () => hostWindow })
  return { root, hostWindow, wx, canvases, images, imageSources, touch, lifecycle, gl }
}

describe('installWechatRuntime', () => {
  it('uses the first native canvas, native images, and real WebGL constructors', () => {
    const mock = createRuntimeMock()
    const host = installWechatRuntime({ width: 720, height: 1280, orientation: 'portrait', phaserVersion: '4.2.1' }, mock.root)

    expect(host.canvas).toBe(mock.canvases[0])
    expect(mock.root.__WXAPP_MAIN_CANVAS__).toBe(mock.canvases[0])
    expect(mock.root.WebGLRenderingContext).toBe(FakeWebGLContext)
    expect(mock.root.CanvasRenderingContext2D).toBe(FakeCanvas2DContext)
    expect(typeof (mock.gl as any).bindVertexArray).toBe('function')
    const image = new mock.root.Image()
    expect(image).toBe(mock.images[0])
    expect(image instanceof mock.root.HTMLImageElement).toBe(true)
    image.src = './assets/ruby/player.png?cache=1'
    expect(mock.imageSources).toEqual(['assets/ruby/player.png'])
    expect(image.src).toBe('assets/ruby/player.png')
    const documentImage = mock.root.document.createElement('img')
    documentImage.src = '/assets/ruby/enemy.png#frame'
    expect(documentImage).toBe(mock.images[1])
    expect(mock.imageSources).toEqual(['assets/ruby/player.png', 'assets/ruby/enemy.png'])
    expect(mock.canvases[0] instanceof mock.root.HTMLCanvasElement).toBe(true)
    expect(typeof mock.root.document.documentElement.appendChild).toBe('function')
  })

  it('patches GameConfig with WebGL, fixed dimensions, and no DOM scale dependency', () => {
    const mock = createRuntimeMock()
    installWechatRuntime({ width: 960, height: 540, orientation: 'landscape' }, mock.root)
    let received: any
    class Game {
      constructor(config: any) { received = config }
    }

    mock.root.__PHASER_WECHAT_CREATE_GAME__(Game, {
      type: 0,
      parent: 'game',
      scale: { mode: 5 },
      loader: { maxParallelDownloads: 8 }
    })

    expect(received).toMatchObject({
      type: 2,
      parent: null,
      customEnvironment: false,
      width: 960,
      height: 540,
      canvas: mock.canvases[0],
      scale: { mode: 0, autoCenter: 0, width: 960, height: 540 },
      loader: { imageLoadType: 'HTMLImageElement', maxParallelDownloads: 8 }
    })
  })

  it('materializes packaged images into USER_DATA_PATH before native loading', async () => {
    const mock = createRuntimeMock()
    const bytes = new Uint8Array([1, 2, 3]).buffer
    const readFile = vi.fn(({ success }: any) => success({ data: bytes }))
    const writeFile = vi.fn(({ success }: any) => success())
    ;(mock.wx as any).env = { USER_DATA_PATH: 'wxfile://usr' }
    ;(mock.wx as any).getFileSystemManager = () => ({ readFile, writeFile })

    installWechatRuntime({ width: 720, height: 1280, orientation: 'portrait' }, mock.root)
    const image = new mock.root.Image()
    image.src = './assets/ruby/player.png?cache=1'
    await Promise.resolve()

    expect(readFile).toHaveBeenCalledWith(expect.objectContaining({
      filePath: 'assets/ruby/player.png'
    }))
    expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({
      filePath: expect.stringMatching(/^wxfile:\/\/usr\/phaser-wechat-[0-9a-f]{8}\.png$/),
      data: bytes
    }))
    expect(mock.imageSources).toEqual([
      expect.stringMatching(/^wxfile:\/\/usr\/phaser-wechat-[0-9a-f]{8}\.png$/)
    ])
    expect(image).toBe(mock.images[0])
  })

  it('synchronously resolves Phaser loader URLs before native image assignment', () => {
    const mock = createRuntimeMock()
    const bytes = new Uint8Array([4, 5, 6]).buffer
    const readFileSync = vi.fn(() => bytes)
    const writeFileSync = vi.fn()
    ;(mock.wx as any).env = { USER_DATA_PATH: 'wxfile://usr' }
    ;(mock.wx as any).getFileSystemManager = () => ({ readFileSync, writeFileSync })

    installWechatRuntime({ width: 720, height: 1280, orientation: 'portrait' }, mock.root)
    const resolved = mock.root.__PHASER_WECHAT_RESOLVE_ASSET_URL__(
      './assets/ruby/ui/title-ruby-logo.png?cache=1'
    )

    expect(readFileSync).toHaveBeenCalledWith('assets/ruby/ui/title-ruby-logo.png')
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/^wxfile:\/\/usr\/phaser-wechat-[0-9a-f]{8}\.png$/),
      bytes
    )
    expect(resolved).toMatch(/^wxfile:\/\/usr\/phaser-wechat-[0-9a-f]{8}\.png$/)
    expect(mock.root.__PHASER_WECHAT_RESOLVE_ASSET_URL__(
      './assets/ruby/ui/title-ruby-logo.png'
    )).toBe(resolved)
    expect(readFileSync).toHaveBeenCalledTimes(1)
  })

  it('preserves source logical dimensions instead of forcing converter defaults', () => {
    const mock = createRuntimeMock()
    installWechatRuntime({ width: 720, height: 1280, orientation: 'portrait' }, mock.root)
    let received: any
    class Game {
      constructor(config: any) { received = config }
    }

    mock.root.__PHASER_WECHAT_CREATE_GAME__(Game, {
      width: 750,
      height: 1624,
      scale: { width: 750, height: 1624, mode: 3 }
    })

    expect(received).toMatchObject({
      width: 750,
      height: 1624,
      scale: { width: 750, height: 1624, mode: 0 }
    })
    expect(mock.canvases[0]).toMatchObject({ width: 750, height: 1624 })
  })

  it('loads packaged fonts and implements the document font loading contract', async () => {
    const mock = createRuntimeMock()
    const loadFont = vi.fn(() => 'WXFont-1')
    ;(mock.wx as any).loadFont = loadFont

    installWechatRuntime({
      width: 750,
      height: 1624,
      orientation: 'portrait',
      fonts: [{ family: 'Fusion Pixel SC', path: '/assets/fonts/fusion-pixel.woff2' }]
    }, mock.root)

    expect(loadFont).toHaveBeenCalledWith('assets/fonts/fusion-pixel.woff2')
    expect(mock.root.__PHASER_WECHAT_RESOLVE_FONT_FAMILY__(
      '"Fusion Pixel SC", sans-serif'
    )).toBe('"WXFont-1", sans-serif')
    await expect(mock.root.document.fonts.load('12px "Fusion Pixel SC"')).resolves.toMatchObject([
      { family: 'WXFont-1', status: 'loaded' }
    ])
    expect(mock.root.document.fonts.check('12px "Fusion Pixel SC"')).toBe(true)
    await expect(mock.root.document.fonts.ready).resolves.toBeUndefined()
  })

  it('continues with the system font when a device rejects the packaged font', async () => {
    const mock = createRuntimeMock()
    ;(mock.wx as any).loadFont = vi.fn(() => '')

    installWechatRuntime({
      width: 750,
      height: 1624,
      orientation: 'portrait',
      fonts: [{ family: 'Fusion Pixel SC', path: 'assets/fonts/fusion-pixel.woff2' }]
    }, mock.root)

    await expect(mock.root.document.fonts.load('12px "Fusion Pixel SC"')).resolves.toEqual([])
    await expect(mock.root.document.fonts.ready).resolves.toBeUndefined()
    expect(mock.root.document.fonts.check('12px "Fusion Pixel SC"')).toBe(false)
    expect(mock.root.__PHASER_WECHAT_RESOLVE_FONT_FAMILY__(
      '"Fusion Pixel SC", sans-serif'
    )).toBe('"Fusion Pixel SC", sans-serif')
  })

  it('preserves the native window animation frame functions', () => {
    const requestAnimationFrame = vi.fn(() => 42)
    const cancelAnimationFrame = vi.fn()
    const nativeWindow = { requestAnimationFrame, cancelAnimationFrame }
    const mock = createRuntimeMock(nativeWindow)

    installWechatRuntime({ width: 720, height: 1280, orientation: 'portrait' }, mock.root)

    expect(nativeWindow.requestAnimationFrame).toBe(requestAnimationFrame)
    expect(nativeWindow.cancelAnimationFrame).toBe(cancelAnimationFrame)
    expect(mock.root.requestAnimationFrame).toBeTypeOf('function')
    expect(mock.root.requestAnimationFrame(() => undefined)).toBe(42)
    expect(requestAnimationFrame).toHaveBeenCalledOnce()
  })

  it('normalizes fallback touch events and supports lifecycle unsubscribe', () => {
    const mock = createRuntimeMock()
    const host = installWechatRuntime({ width: 720, height: 1280, orientation: 'portrait' }, mock.root)
    const events: any[] = []
    mock.canvases[0].addEventListener('touchstart', (event: any) => events.push(event))
    mock.touch.start?.({ touches: [{ id: 9, x: 12, y: 34 }], changedTouches: [{ id: 9, x: 12, y: 34 }] })
    expect(events[0].changedTouches[0]).toMatchObject({ identifier: 9, pointerId: 9, clientX: 12, clientY: 34 })

    let shows = 0
    const unsubscribe = host.onShow(() => { shows++ })
    mock.lifecycle.show?.()
    unsubscribe()
    mock.lifecycle.show?.()
    expect(shows).toBe(1)
  })

  it('loads local XHR files through the WeChat file system', async () => {
    const mock = createRuntimeMock()
    installWechatRuntime({ width: 720, height: 1280, orientation: 'portrait' }, mock.root)
    const xhr = new mock.root.XMLHttpRequest()
    const loaded = new Promise<void>((resolve) => { xhr.onload = resolve })
    xhr.open('GET', '/assets/data/config.json?cache=1')
    xhr.send()
    await loaded
    expect(xhr.status).toBe(200)
    expect(xhr.responseText).toBe('read:assets/data/config.json')
  })

  it('loads packaged JSON through fetch without using wx.request', async () => {
    const mock = createRuntimeMock()
    const readFile = vi.fn(({ filePath, success }: any) => {
      success({ data: '{"schemaVersion":1,"packId":"base-ruby"}' })
    })
    const request = vi.fn()
    ;(mock.wx as any).getFileSystemManager = () => ({ readFile })
    ;(mock.wx as any).request = request
    installWechatRuntime({ width: 720, height: 1280, orientation: 'portrait' }, mock.root)

    const response = await mock.root.fetch('./content/packs/base-ruby/content-index.json?cache=1', {
      cache: 'no-cache'
    })

    expect(response).toMatchObject({ ok: true, status: 200 })
    expect(await response.json()).toEqual({ schemaVersion: 1, packId: 'base-ruby' })
    expect(readFile).toHaveBeenCalledWith(expect.objectContaining({
      filePath: 'content/packs/base-ruby/content-index.json',
      encoding: 'utf8'
    }))
    expect(request).not.toHaveBeenCalled()
  })

  it('preserves native document APIs and only intercepts Phaser render elements', () => {
    const mock = createRuntimeMock()
    const nativeCreateElement = vi.fn((tagName: string) => ({
      dataset: {},
      nativeTag: tagName,
      style: {}
    }))
    const nativeCreateElementNS = vi.fn((namespace: string, tagName: string) => ({
      namespace,
      nativeTag: tagName
    }))
    const getElementById = vi.fn(() => ({ native: true }))
    const getElementsByTagName = vi.fn(() => [])
    const querySelector = vi.fn(() => null)
    const querySelectorAll = vi.fn(() => [])
    mock.root.document = {
      body: { appendChild: vi.fn() },
      documentElement: { appendChild: vi.fn() },
      head: { appendChild: vi.fn() },
      createElement: nativeCreateElement,
      createElementNS: nativeCreateElementNS,
      getElementById,
      getElementsByTagName,
      querySelector,
      querySelectorAll
    }

    installWechatRuntime({ width: 720, height: 1280, orientation: 'portrait' }, mock.root)

    const frame = mock.root.document.createElement('iframe')
    expect(frame).toMatchObject({ nativeTag: 'iframe', dataset: {}, style: {} })
    expect(nativeCreateElement).toHaveBeenCalledWith('iframe')
    expect(mock.root.document.getElementById).toBe(getElementById)
    expect(mock.root.document.getElementsByTagName).toBe(getElementsByTagName)
    expect(mock.root.document.querySelector).toBe(querySelector)
    expect(mock.root.document.querySelectorAll).toBe(querySelectorAll)

    const canvas = mock.root.document.createElement('canvas')
    const image = mock.root.document.createElement('img')
    expect(canvas).toBe(mock.canvases.at(-1))
    expect(image).toBe(mock.images.at(-1))
    expect(nativeCreateElement).not.toHaveBeenCalledWith('canvas')
    expect(nativeCreateElement).not.toHaveBeenCalledWith('img')

    expect(mock.root.document.createElementNS('http://www.w3.org/2000/svg', 'svg')).toMatchObject({
      namespace: 'http://www.w3.org/2000/svg',
      nativeTag: 'svg'
    })
  })

  it('provides persistent virtual elements for browser-only ID selectors', () => {
    const mock = createRuntimeMock()
    installWechatRuntime({ width: 720, height: 1280, orientation: 'portrait' }, mock.root)

    const pauseButton = mock.root.document.querySelector('#pause-button')
    const sameButton = mock.root.document.getElementById('pause-button')

    expect(pauseButton).toBe(sameButton)
    expect(mock.root.document.querySelectorAll('#pause-button')).toEqual([pauseButton])
    expect(mock.root.document.querySelector('.missing')).toBeNull()
    expect(pauseButton.dataset).toEqual({})
    pauseButton.textContent = 'Pause'
    pauseButton.setAttribute('aria-pressed', 'false')
    expect(sameButton.textContent).toBe('Pause')
    expect(sameButton.getAttribute('aria-pressed')).toBe('false')

    mock.root.document.documentElement.dataset.gameState = 'ready'
    expect(mock.root.document.documentElement.dataset.gameState).toBe('ready')
  })

  it('defers viewport APIs until the Mini Game bridge is ready', () => {
    vi.useFakeTimers()
    try {
      const mock = createRuntimeMock()
      const getWindowInfo = vi.fn(() => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 2 }))
      const getDeviceInfo = vi.fn(() => ({ screenWidth: 390, screenHeight: 844, pixelRatio: 2 }))
      const getSystemInfoSync = vi.fn(() => ({ windowWidth: 1, windowHeight: 1 }))
      ;(mock.wx as any).getWindowInfo = getWindowInfo
      ;(mock.wx as any).getDeviceInfo = getDeviceInfo
      ;(mock.wx as any).getSystemInfoSync = getSystemInfoSync

      const host = installWechatRuntime({ width: 720, height: 1280, orientation: 'portrait' }, mock.root)

      expect(getWindowInfo).not.toHaveBeenCalled()
      expect(getDeviceInfo).not.toHaveBeenCalled()
      expect(host.viewport).toMatchObject({ width: 360, height: 640, pixelRatio: 1 })

      vi.advanceTimersByTime(200)

      expect(getWindowInfo).toHaveBeenCalledTimes(1)
      expect(getDeviceInfo).toHaveBeenCalledTimes(1)
      expect(getSystemInfoSync).not.toHaveBeenCalled()
      expect(host.viewport).toMatchObject({ width: 390, height: 844, pixelRatio: 2 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('provides URLSearchParams when the Mini Game runtime does not define it', () => {
    const mock = createRuntimeMock()
    installWechatRuntime({ width: 720, height: 1280, orientation: 'portrait' }, mock.root)

    const params = new mock.root.URLSearchParams('?map=main&name=first+hero&name=second')
    expect(params.get('map')).toBe('main')
    expect(params.get('missing')).toBeNull()
    expect(params.getAll('name')).toEqual(['first hero', 'second'])
    params.set('map', 'mine')
    params.append('空 格', '值')
    expect(params.toString()).toContain('map=mine')
    expect(params.toString()).toContain('%E7%A9%BA+%E6%A0%BC=%E5%80%BC')
  })

  it('provides structuredClone when the Mini Game runtime does not define it', () => {
    const mock = createRuntimeMock()
    installWechatRuntime({ width: 720, height: 1280, orientation: 'portrait' }, mock.root)
    const source: any = {
      party: [{ hp: 20 }],
      createdAt: new Date('2026-08-27T00:00:00.000Z'),
      flags: new Set(['started']),
      metadata: new Map([['area', { id: 'route-1' }]]),
      bytes: new Uint8Array([1, 2, 3])
    }
    source.self = source

    const clone = mock.root.structuredClone(source)

    expect(clone).not.toBe(source)
    expect(clone.party).toEqual(source.party)
    expect(clone.party).not.toBe(source.party)
    expect(clone.self).toBe(clone)
    expect(clone.createdAt).toEqual(source.createdAt)
    expect(clone.flags).toEqual(source.flags)
    expect(clone.metadata).toEqual(source.metadata)
    expect([...clone.bytes]).toEqual([1, 2, 3])
    expect(clone.bytes).not.toBe(source.bytes)
    expect(mock.hostWindow.structuredClone).toBe(mock.root.structuredClone)
  })

  it('provides DOMParser for Phaser XML and bitmap-font loaders', () => {
    const mock = createRuntimeMock()
    installWechatRuntime({ width: 720, height: 1280, orientation: 'portrait' }, mock.root)

    const xml = new mock.root.DOMParser().parseFromString(`
      <font>
        <info face="Fusion Pixel SC" size="12" />
        <common lineHeight="16" />
        <chars><char id="65" x="1" y="2" /></chars>
      </font>
    `, 'text/xml')

    expect(xml.documentElement.tagName).toBe('font')
    expect(xml.getElementsByTagName('parsererror')).toHaveLength(0)
    expect(xml.getElementsByTagName('info')[0].getAttribute('face')).toBe('Fusion Pixel SC')
    expect(xml.getElementsByTagName('char')[0].getAttribute('id')).toBe('65')
  })

  it('maps window.location.reload to wx.restartMiniProgram', () => {
    const mock = createRuntimeMock()
    const restartMiniProgram = vi.fn()
    ;(mock.wx as any).restartMiniProgram = restartMiniProgram
    installWechatRuntime({ width: 720, height: 1280, orientation: 'portrait' }, mock.root)

    mock.root.window.location.reload()

    expect(restartMiniProgram).toHaveBeenCalledWith({})
  })

  it('preserves a native structuredClone implementation', () => {
    const nativeStructuredClone = vi.fn((value: unknown) => ({ native: value }))
    const mock = createRuntimeMock({ structuredClone: nativeStructuredClone })

    installWechatRuntime({ width: 720, height: 1280, orientation: 'portrait' }, mock.root)

    expect(mock.hostWindow.structuredClone).toBe(nativeStructuredClone)
    expect(mock.root.structuredClone('save')).toEqual({ native: 'save' })
    expect(nativeStructuredClone).toHaveBeenCalledWith('save')
  })

  it('dispatches native Event instances for lifecycle events', () => {
    const nativeWindow = new EventTarget() as EventTarget & Record<string, any>
    const mock = createRuntimeMock(nativeWindow)
    installWechatRuntime({ width: 720, height: 1280, orientation: 'portrait' }, mock.root)
    let focused = 0
    nativeWindow.addEventListener('focus', () => { focused++ })

    expect(() => mock.lifecycle.show?.()).not.toThrow()
    expect(focused).toBe(1)
  })
})
