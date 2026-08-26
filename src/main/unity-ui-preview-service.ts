import { BrowserWindow, WebContentsView } from 'electron'
import { AppError } from './domain'
import { UNITY_UI_PREVIEW_SCHEME } from '../shared/unity-ui-preview-url'

export class UnityUIPreviewService {
  private readonly view: WebContentsView

  constructor(private readonly window: BrowserWindow) {
    this.view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        autoplayPolicy: 'user-gesture-required'
      }
    })
    this.view.setBackgroundColor('#111214')
    this.window.contentView.addChildView(this.view)
    this.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    this.view.webContents.on('will-navigate', (event, url) => {
      if (!isAllowedUrl(url)) event.preventDefault()
    })
  }

  async show(bounds: { x: number; y: number; width: number; height: number }): Promise<true> {
    this.view.setBounds({
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height))
    })
    return true
  }

  async hide(): Promise<true> {
    this.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    return true
  }

  async load(url: string): Promise<true> {
    if (!isAllowedUrl(url)) throw new AppError('ACCESS_DENIED', 'Unity UI previews must use the managed preview protocol.')
    await this.view.webContents.loadURL(url)
    return true
  }

  destroy(): void {
    if (!this.window.isDestroyed()) {
      try { this.view.setBounds({ x: 0, y: 0, width: 0, height: 0 }) } catch { /* The view may already be detached. */ }
      try { this.window.contentView.removeChildView(this.view) } catch { /* The window may already be closing. */ }
    }
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close()
  }
}

function isAllowedUrl(value: string): boolean {
  try {
    return new URL(value).protocol === `${UNITY_UI_PREVIEW_SCHEME}:`
  } catch {
    return false
  }
}
