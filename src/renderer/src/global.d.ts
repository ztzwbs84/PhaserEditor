import type { EditorApi } from '@phaser-editor/contracts'

declare global {
  interface Window {
    editorApi: EditorApi
  }
}

export {}
