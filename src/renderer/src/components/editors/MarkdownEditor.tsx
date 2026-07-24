import { useEffect, useMemo, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import { Columns2, Copy, Download, Eye, FileCode2, Save, Search } from 'lucide-react'
import type { EditorDocument } from '@phaser-editor/contracts'
import { useEditorStore } from '../../store/editor-store'

type Mode = 'source' | 'split' | 'preview'

export function MarkdownEditor({ document }: { document: EditorDocument }): React.JSX.Element {
  const updateDocument = useEditorStore((state) => state.updateDocument)
  const saveDocument = useEditorStore((state) => state.saveDocument)
  const theme = useEditorStore((state) => state.settings?.theme ?? 'dark')
  const [mode, setMode] = useState<Mode>('split')
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const html = useMemo(() => renderMarkdown(document.content, document.path), [document.content, document.path])

  const onMount: OnMount = (instance) => {
    editorRef.current = instance
    instance.onDidScrollChange(() => {
      const preview = previewRef.current
      if (!preview) return
      const maxSource = instance.getScrollHeight() - instance.getLayoutInfo().height
      const ratio = maxSource > 0 ? instance.getScrollTop() / maxSource : 0
      preview.scrollTop = ratio * Math.max(0, preview.scrollHeight - preview.clientHeight)
    })
  }

  useEffect(() => {
    const handler = (event: Event): void => {
      const action = (event as CustomEvent<string>).detail
      if (action === 'undo') editorRef.current?.trigger('toolbar', 'undo', null)
      if (action === 'redo') editorRef.current?.trigger('toolbar', 'redo', null)
      if (action === 'find') editorRef.current?.getAction('actions.find')?.run()
    }
    window.addEventListener('phaser-editor:editor-action', handler)
    return () => window.removeEventListener('phaser-editor:editor-action', handler)
  }, [])

  return <div className="document-editor markdown-editor">
    <div className="editor-toolbar">
      <div className="segmented-control">
        <button title="Source" className={mode === 'source' ? 'active' : ''} onClick={() => setMode('source')}><FileCode2 size={14} /></button>
        <button title="Split source and preview" className={mode === 'split' ? 'active' : ''} onClick={() => setMode('split')}><Columns2 size={14} /></button>
        <button title="Preview" className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}><Eye size={14} /></button>
      </div>
      <span className="document-path">{document.path}</span>
      <button className="icon-button compact" title="Find" onClick={() => void editorRef.current?.getAction('actions.find')?.run()}><Search size={14} /></button>
      <button className="icon-button compact" title="Copy rendered text" onClick={() => void window.editorApi.clipboard.writeText(previewRef.current?.innerText ?? '')}><Copy size={14} /></button>
      <button className="icon-button compact" title="Export HTML" onClick={() => void window.editorApi.dialogs.saveHtml(document.name.replace(/\.md$/i, '.html'), createHtmlDocument(document.name, html))}><Download size={14} /></button>
      <button className="icon-button compact" title="Save" disabled={!document.dirty || document.readOnly || document.conflict} onClick={() => void saveDocument(document.path)}><Save size={14} /></button>
    </div>
    <div className={`markdown-layout mode-${mode}`}>
      {mode !== 'preview' && <div className="markdown-source"><Editor path={document.path} language="markdown" value={document.content} theme={theme === 'dark' ? 'vs-dark' : 'light'} onMount={onMount} onChange={(value) => updateDocument(document.path, value ?? '')} options={{ automaticLayout: true, fontFamily: "'JetBrains Mono', Consolas, monospace", fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: 'on', readOnly: document.readOnly }} /></div>}
      {mode !== 'source' && <div ref={previewRef} className="markdown-preview" dangerouslySetInnerHTML={{ __html: html }} onClick={(event) => {
        const anchor = (event.target as HTMLElement).closest('a')
        if (anchor?.href) { event.preventDefault(); void window.editorApi.runner.openExternal(anchor.href) }
      }} />}
    </div>
  </div>
}

function renderMarkdown(content: string, filePath: string): string {
  const markdown = new MarkdownIt({ html: false, linkify: true, typographer: true })
  const defaultImage = markdown.renderer.rules.image!
  markdown.renderer.rules.image = (tokens, index, options, env, self) => {
    const sourceIndex = tokens[index]?.attrIndex('src') ?? -1
    if (sourceIndex >= 0) {
      const source = tokens[index]?.attrs?.[sourceIndex]?.[1]
      if (source && !/^(https?:|data:|phaser-asset:)/i.test(source)) {
        const normalized = filePath.replaceAll('\\', '/')
        const directory = normalized.slice(0, normalized.lastIndexOf('/'))
        const resolved = resolveRelativePath(`${directory}/${source}`)
        tokens[index]!.attrs![sourceIndex]![1] = window.editorApi.fileSystem.assetUrl(resolved)
      }
    }
    return defaultImage(tokens, index, options, env, self)
  }
  return DOMPurify.sanitize(markdown.render(content), { USE_PROFILES: { html: true } })
}

function resolveRelativePath(value: string): string {
  const prefix = /^[A-Za-z]:/.exec(value)?.[0] ?? ''
  const parts: string[] = []
  for (const part of value.replace(/^[A-Za-z]:/, '').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop(); else parts.push(part)
  }
  return `${prefix}\\${parts.join('\\')}`
}

function createHtmlDocument(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{max-width:900px;margin:40px auto;padding:0 24px;font:16px/1.65 system-ui;color:#202124}pre{padding:16px;background:#f4f4f5;overflow:auto}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #d4d4d8;padding:6px 10px}</style></head><body>${body}</body></html>`
}
