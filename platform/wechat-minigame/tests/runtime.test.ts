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
      const image = { nativeImage: true }
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
  return { root, hostWindow, wx, canvases, images, touch, lifecycle, gl }
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

  it('does not call deprecated getSystemInfoSync when modern window info is unavailable', () => {
    const mock = createRuntimeMock()
    const getSystemInfoSync = vi.fn(() => ({ windowWidth: 1, windowHeight: 1 }))
    ;(mock.wx as any).getWindowInfo = () => { throw new Error('not ready') }
    ;(mock.wx as any).getDeviceInfo = () => ({ screenWidth: 390, screenHeight: 844, pixelRatio: 2 })
    ;(mock.wx as any).getSystemInfoSync = getSystemInfoSync

    const host = installWechatRuntime({ width: 720, height: 1280, orientation: 'portrait' }, mock.root)

    expect(getSystemInfoSync).not.toHaveBeenCalled()
    expect(host.viewport).toMatchObject({ width: 390, height: 844, pixelRatio: 2 })
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
