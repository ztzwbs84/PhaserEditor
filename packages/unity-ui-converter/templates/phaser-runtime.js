import { loadUnityFonts, PhaserUnityUIRenderer, preloadUnityUI } from './phaser-renderer.js'

const documentData = window.__UNITY_UI_PREVIEW__.documents[0]
const query = new URLSearchParams(window.location.search)
const renderWidth = Math.max(1, Number(query.get('width')) || documentData.canvas.referenceResolution.x)
const renderHeight = Math.max(1, Number(query.get('height')) || documentData.canvas.referenceResolution.y)
if (query.has('embedded')) document.querySelector('a[href="preview.html"]')?.remove()
await loadUnityFonts(documentData)

class UnityUIPreviewScene extends Phaser.Scene {
  constructor() { super('UnityUIPreview') }
  preload() { preloadUnityUI(this, documentData) }
  create() {
    this.cameras.main.setBackgroundColor('#232629')
    const renderer = new PhaserUnityUIRenderer(this, documentData, {
      onWarning: (message, details) => console.warn(message, details),
      onButton: (node) => console.info(`Clicked ${node.name}`)
    })
    renderer.create(renderWidth, renderHeight)
    window.__UNITY_UI_RENDERER__ = renderer
    document.documentElement.dataset.unityLayout = JSON.stringify(Object.fromEntries(documentData.nodes.map((node) => [node.id, renderer.getResolvedRect(node.id)])))
    document.documentElement.dataset.unityRendererReady = 'true'
  }
}

window.__UNITY_UI_GAME__ = new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game',
  backgroundColor: '#17191b',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: renderWidth,
    height: renderHeight
  },
  scene: [UnityUIPreviewScene]
})
