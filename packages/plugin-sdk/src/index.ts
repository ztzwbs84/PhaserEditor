export type {
  CommandContribution,
  ComponentProviderContribution,
  FileHandlerContribution,
  PanelContribution,
  PluginManifest,
  SchemaContribution
} from '@phaser-editor/contracts'

export interface PluginContext {
  pluginPath: string
  subscriptions: Array<{ dispose(): void }>
  postMessage(message: unknown): void
}

export interface PhaserEditorPlugin {
  activate(context: PluginContext): void | Promise<void>
  deactivate?(): void | Promise<void>
}
