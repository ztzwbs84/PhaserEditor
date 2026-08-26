import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { EditorSettings } from '@phaser-editor/contracts'

const defaultSettings: EditorSettings = {
  theme: 'dark',
  layout: null,
  recentProjects: [],
  runConfigurations: {},
  trustedProjects: [],
  palettes: [
    {
      id: 'default',
      name: 'Phaser UI',
      colors: [
        { id: 'midnight', name: 'Midnight', hex: '#1E1F22' },
        { id: 'surface', name: 'Surface', hex: '#2B2D30' },
        { id: 'selection', name: 'Selection', hex: '#3574F0' },
        { id: 'run', name: 'Run', hex: '#39B54A' },
        { id: 'warning', name: 'Warning', hex: '#E6A23C' }
      ]
    }
  ],
  shortcuts: {
    'workspace.save': 'Ctrl+S',
    'workspace.undo': 'Ctrl+Z',
    'workspace.redo': 'Ctrl+Shift+Z',
    'workspace.find': 'Ctrl+F',
    'workspace.quickOpen': 'Ctrl+P',
    'run.start': 'F6',
    'run.stop': 'Shift+F6'
  },
  enabledPlugins: [],
  phaserSourceRoot: process.env.PHASER_SOURCE_ROOT ?? 'I:\\Phaser\\phaser',
  unityUIConfigurations: {}
}

export class ConfigStore {
  private settings: EditorSettings = structuredClone(defaultSettings)
  private readonly filePath: string

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'settings.json')
  }

  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(content) as Partial<EditorSettings>
      this.settings = {
        ...structuredClone(defaultSettings),
        ...parsed,
        runConfigurations: { ...defaultSettings.runConfigurations, ...parsed.runConfigurations },
        shortcuts: { ...defaultSettings.shortcuts, ...parsed.shortcuts },
        unityUIConfigurations: { ...defaultSettings.unityUIConfigurations, ...parsed.unityUIConfigurations }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        const backup = `${this.filePath}.invalid-${Date.now()}`
        await fs.rename(this.filePath, backup).catch(() => undefined)
      }
      await this.persist()
    }
  }

  get(): EditorSettings {
    return structuredClone(this.settings)
  }

  async update(patch: Partial<EditorSettings>): Promise<EditorSettings> {
    this.settings = { ...this.settings, ...patch }
    await this.persist()
    return this.get()
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.${randomUUID()}.tmp`
    await fs.writeFile(tempPath, `${JSON.stringify(this.settings, null, 2)}\n`, 'utf8')
    await fs.rename(tempPath, this.filePath)
  }
}
