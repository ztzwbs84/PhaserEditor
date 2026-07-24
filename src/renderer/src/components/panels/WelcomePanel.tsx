import { Box, Camera, ChevronDown, Grid3X3, Hand, Lightbulb, Maximize2, Move3d, RotateCw, Scaling } from 'lucide-react'
import { useEditorStore } from '../../store/editor-store'

export function WelcomePanel(): React.JSX.Element {
  const project = useEditorStore((state) => state.project)!
  return (
    <div className="scene-view">
      <div className="scene-toolbar">
        <div className="scene-tool-group" role="toolbar" aria-label="Scene transform tools">
          <button className="active" title="Pan"><Hand size={14} /></button>
          <button title="Move"><Move3d size={14} /></button>
          <button title="Rotate"><RotateCw size={14} /></button>
          <button title="Scale"><Scaling size={14} /></button>
          <button title="Rect"><Maximize2 size={14} /></button>
        </div>
        <button className="scene-select">Pivot <ChevronDown size={11} /></button>
        <button className="scene-select">Global <ChevronDown size={11} /></button>
        <span className="toolbar-spacer" />
        <button className="scene-toggle active">2D</button>
        <button className="scene-tool-button" title="Scene lighting"><Lightbulb size={14} /></button>
        <button className="scene-tool-button active" title="Grid"><Grid3X3 size={14} /></button>
        <button className="scene-select">Gizmos <ChevronDown size={11} /></button>
      </div>
      <div className="scene-canvas">
        <div className="scene-camera-frame" aria-label="Main camera frame">
          <div className="scene-camera-title"><Camera size={12} />Main Camera</div>
          <div className="scene-origin"><span className="axis-x" /><span className="axis-y" /><i /></div>
        </div>
        <div className="scene-object-label"><Box size={13} /><span>{project.name}</span></div>
        <div className="scene-gizmo" aria-hidden="true"><span className="gizmo-y">Y</span><span className="gizmo-x">X</span><i /></div>
        <div className="scene-footer"><span>Shaded</span><span>2D</span><span>{project.phaserVersion}</span></div>
      </div>
    </div>
  )
}
