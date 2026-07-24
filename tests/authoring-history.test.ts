import { beforeEach, describe, expect, it } from 'vitest'
import type { EditorDocument } from '@phaser-editor/contracts'
import { useAuthoringHistoryStore } from '../src/renderer/src/store/authoring-history-store'
import { useEditorStore } from '../src/renderer/src/store/editor-store'

const path = 'browser-demo\\assets\\tiles.phaser-animations.json'

describe('authoring document history', () => {
  beforeEach(() => {
    const content = '{"version":1}'
    const document: EditorDocument = { id: crypto.randomUUID(), path, name: 'tiles.phaser-animations.json', kind: 'animation', language: 'json', content, savedContent: content, modifiedAt: 1, dirty: false }
    useEditorStore.setState({ documents: { [path]: document }, selectedPath: path })
    useAuthoringHistoryStore.setState({ records: {} })
    useAuthoringHistoryStore.getState().load(path, content)
  })

  it('undoes, redoes, truncates branches, and tracks the save point', () => {
    const history = useAuthoringHistoryStore.getState()
    expect(history.commit(path, '{"version":2}')).toBe(true)
    expect(useEditorStore.getState().documents[path]).toMatchObject({ content: '{"version":2}', dirty: true })
    expect(history.undo(path)).toBe(true)
    expect(useEditorStore.getState().documents[path]?.content).toBe('{"version":1}')
    expect(history.redo(path)).toBe(true)
    history.markSaved(path)
    expect(useAuthoringHistoryStore.getState().records[path]).toMatchObject({ cursor: 1, savePoint: 1 })

    history.undo(path)
    history.commit(path, '{"version":3}')
    expect(useAuthoringHistoryStore.getState().records[path]?.entries).toEqual(['{"version":1}', '{"version":3}'])
    expect(history.redo(path)).toBe(false)
  })
})
