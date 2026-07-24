import { create } from 'zustand'
import { useEditorStore } from './editor-store'

interface AuthoringHistoryRecord {
  path: string
  entries: string[]
  cursor: number
  savePoint: number
}

interface AuthoringHistoryState {
  records: Record<string, AuthoringHistoryRecord>
  load(path: string, content: string): void
  close(path: string): void
  commit(path: string, content: string): boolean
  undo(path: string): boolean
  redo(path: string): boolean
  markSaved(path: string): void
}

export const useAuthoringHistoryStore = create<AuthoringHistoryState>((set, get) => ({
  records: {},
  load(path, content) {
    const existing = get().records[path]
    if (existing && existing.entries[existing.cursor] === content) return
    set((state) => ({ records: { ...state.records, [path]: { path, entries: [content], cursor: 0, savePoint: 0 } } }))
  },
  close(path) {
    set((state) => {
      const records = { ...state.records }
      delete records[path]
      return { records }
    })
  },
  commit(path, content) {
    const record = get().records[path]
    if (!record) return false
    if (record.entries[record.cursor] === content) return false
    const entries = [...record.entries.slice(0, record.cursor + 1), content]
    const savePoint = record.savePoint > record.cursor ? -1 : record.savePoint
    set((state) => ({ records: { ...state.records, [path]: { ...record, entries, cursor: entries.length - 1, savePoint } } }))
    useEditorStore.getState().updateDocument(path, content)
    return true
  },
  undo(path) {
    const record = get().records[path]
    if (!record || record.cursor === 0) return false
    const cursor = record.cursor - 1
    const content = record.entries[cursor]!
    set((state) => ({ records: { ...state.records, [path]: { ...record, cursor } } }))
    useEditorStore.getState().updateDocument(path, content)
    return true
  },
  redo(path) {
    const record = get().records[path]
    if (!record || record.cursor >= record.entries.length - 1) return false
    const cursor = record.cursor + 1
    const content = record.entries[cursor]!
    set((state) => ({ records: { ...state.records, [path]: { ...record, cursor } } }))
    useEditorStore.getState().updateDocument(path, content)
    return true
  },
  markSaved(path) {
    const record = get().records[path]
    if (!record) return
    set((state) => ({ records: { ...state.records, [path]: { ...record, savePoint: record.cursor } } }))
  }
}))

export function undoActiveAuthoringDocument(): boolean {
  const path = useEditorStore.getState().selectedPath
  if (!path) return false
  return useAuthoringHistoryStore.getState().undo(path)
}

export function redoActiveAuthoringDocument(): boolean {
  const path = useEditorStore.getState().selectedPath
  if (!path) return false
  return useAuthoringHistoryStore.getState().redo(path)
}
