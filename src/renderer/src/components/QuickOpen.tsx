import { useEffect, useRef, useState } from 'react'
import { File, Search, X } from 'lucide-react'
import type { FileEntry } from '@phaser-editor/contracts'
import { useEditorStore } from '../store/editor-store'

export function QuickOpen(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FileEntry[]>([])
  const [selected, setSelected] = useState(0)
  const setOpen = useEditorStore((state) => state.setQuickOpen)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    const timer = window.setTimeout(async () => {
      const result = await window.editorApi.fileSystem.search(query)
      if (result.ok) setResults(result.value.filter((entry) => entry.kind === 'file').slice(0, 50))
    }, 120)
    return () => window.clearTimeout(timer)
  }, [query])

  const choose = (entry: FileEntry | undefined): void => {
    if (!entry) return
    setOpen(false)
    void useEditorStore.getState().openDocument(entry.path).then((document) => {
      if (document) window.dispatchEvent(new CustomEvent('phaser-editor:open-document-tab', { detail: entry.path }))
    })
  }

  return <div className="modal-backdrop quick-open-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
    <div className="quick-open" role="dialog" aria-modal="true">
      <div className="quick-search"><Search size={17} /><input ref={input} value={query} placeholder="Open file by name" onChange={(event) => { setQuery(event.target.value); setSelected(0) }} onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false)
        if (event.key === 'ArrowDown') setSelected((value) => Math.min(results.length - 1, value + 1))
        if (event.key === 'ArrowUp') setSelected((value) => Math.max(0, value - 1))
        if (event.key === 'Enter') choose(results[selected])
      }} /><button className="icon-button compact" onClick={() => setOpen(false)} title="Close quick open"><X size={14} /></button></div>
      <div className="quick-results">{results.map((entry, index) => <button key={entry.path} className={selected === index ? 'selected' : ''} onMouseEnter={() => setSelected(index)} onClick={() => choose(entry)}><File size={14} /><span>{entry.name}<small>{entry.relativePath}</small></span></button>)}</div>
    </div>
  </div>
}
