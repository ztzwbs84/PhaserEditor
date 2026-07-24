import { useEffect, useMemo, useState } from 'react'
import { Check, Clipboard, Pipette, Plus, Trash2 } from 'lucide-react'
import { convertColor } from '../../lib/colors'
import { useEditorStore } from '../../store/editor-store'

export function PalettePanel(): React.JSX.Element {
  const settings = useEditorStore((state) => state.settings)
  const updateSettings = useEditorStore((state) => state.updateSettings)
  const notify = useEditorStore((state) => state.notify)
  const [groupId, setGroupId] = useState(settings?.palettes[0]?.id ?? '')
  const [value, setValue] = useState('#39B54A')
  const [copied, setCopied] = useState<string | null>(null)
  const formats = useMemo(() => convertColor(value), [value])
  const group = settings?.palettes.find((item) => item.id === groupId) ?? settings?.palettes[0]

  useEffect(() => {
    const handler = (event: Event): void => {
      const color = (event as CustomEvent<string>).detail
      if (color) setValue(color)
    }
    window.addEventListener('phaser-editor:color-picked', handler)
    return () => window.removeEventListener('phaser-editor:color-picked', handler)
  }, [])

  const copy = async (format: string, text: string): Promise<void> => {
    await window.editorApi.clipboard.writeText(text)
    setCopied(format)
    window.setTimeout(() => setCopied(null), 1200)
  }

  const saveColor = async (): Promise<void> => {
    if (!formats || !group || !settings) return
    const palettes = settings.palettes.map((item) => item.id === group.id ? { ...item, colors: [...item.colors, { id: crypto.randomUUID(), name: formats.hex, hex: formats.hex }] } : item)
    await updateSettings({ palettes })
    notify('success', 'Color saved')
  }

  return <div className="panel palette-panel">
    <div className="palette-picker-row">
      <input type="color" aria-label="Choose color" value={formats?.hex.slice(0, 7) ?? '#000000'} onChange={(event) => setValue(event.target.value)} />
      <input className={formats ? '' : 'invalid'} aria-label="Color value" value={value} onChange={(event) => setValue(event.target.value)} />
      <button className="icon-button" title="Pick from active image" onClick={() => window.dispatchEvent(new CustomEvent('phaser-editor:start-eyedropper'))}><Pipette size={15} /></button>
    </div>
    {formats && <div className="color-formats">
      {Object.entries(formats).map(([name, text]) => <button key={name} onClick={() => void copy(name, text)}><span>{name.toUpperCase()}</span><code>{text}</code>{copied === name ? <Check size={13} /> : <Clipboard size={13} />}</button>)}
    </div>}
    <div className="palette-heading">
      <select value={group?.id ?? ''} onChange={(event) => setGroupId(event.target.value)}>{settings?.palettes.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
      <button className="icon-button compact" title="New color group" onClick={() => {
        const name = window.prompt('Color group name')
        if (!name || !settings) return
        const id = crypto.randomUUID()
        void updateSettings({ palettes: [...settings.palettes, { id, name, colors: [] }] })
        setGroupId(id)
      }}><Plus size={14} /></button>
      <button className="icon-button compact" title="Save current color" disabled={!formats} onClick={() => void saveColor()}><Check size={14} /></button>
    </div>
    <div className="swatch-grid">
      {group?.colors.map((color) => <button className="swatch" key={color.id} title={`${color.name} ${color.hex}`} style={{ backgroundColor: color.hex }} onClick={() => setValue(color.hex)} onDoubleClick={() => void copy('swatch', color.hex)}><span>{color.name}</span></button>)}
    </div>
    {group && group.id !== 'default' && <button className="button subtle danger full" onClick={() => {
      if (!settings || !window.confirm(`Delete color group ${group.name}?`)) return
      void updateSettings({ palettes: settings.palettes.filter((item) => item.id !== group.id) })
      setGroupId('default')
    }}><Trash2 size={14} />Delete group</button>}
  </div>
}
