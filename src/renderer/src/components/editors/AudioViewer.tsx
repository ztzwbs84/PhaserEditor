import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { Pause, Play, Repeat2, Square, Volume2 } from 'lucide-react'
import type { EditorDocument, FileEntry } from '@phaser-editor/contracts'
import { useEditorStore } from '../../store/editor-store'

export function AudioViewer({ document }: { document: EditorDocument }): React.JSX.Element {
  const notify = useEditorStore((state) => state.notify)
  const waveformRef = useRef<HTMLDivElement>(null)
  const waveRef = useRef<WaveSurfer | null>(null)
  const loopRef = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(false)
  const [volume, setVolume] = useState(0.8)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [metadata, setMetadata] = useState<FileEntry | null>(null)

  useEffect(() => { loopRef.current = loop }, [loop])
  useEffect(() => { void window.editorApi.fileSystem.stat(document.path).then((result) => { if (result.ok) setMetadata(result.value) }) }, [document.path])
  useEffect(() => {
    if (!waveformRef.current) return
    const wave = WaveSurfer.create({
      container: waveformRef.current,
      url: window.editorApi.fileSystem.assetUrl(document.path),
      height: 108,
      waveColor: '#62748e',
      progressColor: '#38a3d1',
      cursorColor: '#e5e7eb',
      cursorWidth: 1,
      normalize: true,
      barWidth: 2,
      barGap: 1,
      barRadius: 1
    })
    waveRef.current = wave
    wave.setVolume(volume)
    wave.on('ready', () => setDuration(wave.getDuration()))
    wave.on('timeupdate', setCurrent)
    wave.on('play', () => setPlaying(true))
    wave.on('pause', () => setPlaying(false))
    wave.on('error', (error) => notify('error', `Unable to decode ${document.name}: ${formatMediaError(error)}`))
    wave.on('finish', () => {
      if (loopRef.current) void wave.play(0).catch((error: unknown) => notify('error', formatMediaError(error)))
      else setPlaying(false)
    })
    return () => { wave.destroy(); waveRef.current = null }
  }, [document.name, document.path, notify])

  return <div className="audio-viewer">
    <div className="audio-heading"><div className="audio-disc"><Volume2 size={28} /></div><div><h2>{document.name}</h2><p>{metadata?.path}</p></div></div>
    <div className="waveform" ref={waveformRef} />
    <div className="audio-time"><span>{formatTime(current)}</span><span>{formatTime(duration)}</span></div>
    <div className="audio-controls">
      <button className="icon-button transport" title={playing ? 'Pause' : 'Play'} onClick={() => {
        void waveRef.current?.playPause().catch((error: unknown) => notify('error', formatMediaError(error)))
      }}>{playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</button>
      <button className="icon-button transport" title="Stop" onClick={() => { waveRef.current?.stop(); setPlaying(false) }}><Square size={16} fill="currentColor" /></button>
      <button className={`icon-button transport${loop ? ' active' : ''}`} title="Loop" onClick={() => setLoop((value) => !value)}><Repeat2 size={18} /></button>
      <span className="toolbar-spacer" />
      <Volume2 size={16} /><input className="volume-slider" aria-label="Volume" type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => { const next = Number(event.target.value); setVolume(next); waveRef.current?.setVolume(next) }} />
    </div>
    <div className="audio-metadata"><span><small>Format</small><strong>{metadata?.extension.toLocaleUpperCase()}</strong></span><span><small>Duration</small><strong>{formatTime(duration)}</strong></span><span><small>Size</small><strong>{metadata ? `${(metadata.size / 1024).toFixed(1)} KB` : ''}</strong></span></div>
  </div>
}

function formatMediaError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error instanceof Event) return `${error.type} event`
  return String(error)
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00'
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
}
