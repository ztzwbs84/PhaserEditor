import { randomUUID } from 'node:crypto'
import { BrowserWindow, WebContentsView, shell } from 'electron'
import type { LogEntry } from '@phaser-editor/contracts'
import { AppError } from './domain'

export class PreviewService {
  private readonly view: WebContentsView
  private visible = false

  constructor(
    private readonly window: BrowserWindow,
    private readonly emitLog: (entry: LogEntry) => void
  ) {
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
    this.view.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url)
      return { action: 'deny' }
    })
    this.view.webContents.on('will-navigate', (event, url) => {
      if (!isAllowedPreviewUrl(url)) event.preventDefault()
    })
    this.view.webContents.on('console-message', (event, legacyLevel, legacyMessage, legacyLine, legacySourceId) => {
      const details = event as typeof event & { level?: LogEntry['level']; message?: string; lineNumber?: number; sourceId?: string }
      const message = details.message ?? legacyMessage
      if (!message) return
      this.emitPreviewLog(
        details.level ?? legacyConsoleLevel(legacyLevel),
        message,
        details.lineNumber ?? legacyLine,
        details.sourceId ?? legacySourceId
      )
    })
    this.view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) this.emitPreviewLog('error', `${errorDescription} (${validatedURL})`)
    })
  }

  async show(bounds: { x: number; y: number; width: number; height: number }): Promise<true> {
    const safeBounds = {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height))
    }
    this.view.setBounds(safeBounds)
    this.visible = safeBounds.width > 0 && safeBounds.height > 0
    return true
  }

  async hide(): Promise<true> {
    this.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    this.visible = false
    return true
  }

  async load(url: string): Promise<true> {
    if (!isAllowedPreviewUrl(url)) throw new AppError('ACCESS_DENIED', 'Preview URLs must use localhost or 127.0.0.1.')
    await this.view.webContents.loadURL(url)
    return true
  }

  destroy(): void {
    this.visible = false
    if (!this.window.isDestroyed()) {
      try { this.view.setBounds({ x: 0, y: 0, width: 0, height: 0 }) } catch { /* The view may already be detached. */ }
      try { this.window.contentView.removeChildView(this.view) } catch { /* The window may already be closing. */ }
    }
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close()
  }

  private emitPreviewLog(level: LogEntry['level'], message: string, line?: number, sourceId?: string): void {
    if (!message.trim()) return
    this.emitLog({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      source: 'preview',
      level,
      message,
      line,
      file: sourceId?.startsWith('file:') ? decodeURIComponent(new URL(sourceId).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1))) : undefined
    })
  }
}

function isAllowedPreviewUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)
  } catch {
    return false
  }
}

function legacyConsoleLevel(level: number): LogEntry['level'] {
  return level >= 3 ? 'error' : level === 2 ? 'warning' : level === 0 ? 'debug' : 'info'
}
