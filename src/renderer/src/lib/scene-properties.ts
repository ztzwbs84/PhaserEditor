import { isProjectRelativeAssetPath, type SceneObject } from '@phaser-editor/contracts'

export type ScenePropertyValue = string | number | boolean
export type ScenePropertyKind = 'text' | 'number' | 'boolean' | 'multiline'

export interface ScenePropertyDescriptor {
  id: string
  group: 'Identity' | 'Transform' | 'Rendering' | 'Texture' | 'Animation' | 'Text'
  label: string
  kind: ScenePropertyKind
  min?: number
  max?: number
  step?: number
  supports(object: SceneObject): boolean
  read(object: SceneObject): ScenePropertyValue
  write(object: SceneObject, value: ScenePropertyValue): SceneObject
  validate?(value: ScenePropertyValue): string | null
}

const all = (): boolean => true
const textured = (object: SceneObject): boolean => object.type === 'image' || object.type === 'sprite'
const text = (object: SceneObject): boolean => object.type === 'text'
const sprite = (object: SceneObject): boolean => object.type === 'sprite'

export const coreScenePropertyDescriptors: ScenePropertyDescriptor[] = [
  descriptor('name', 'Identity', 'Name', 'text', all, (object) => object.name, (object, value) => ({ ...object, name: String(value).trim() }), {
    validate: (value) => String(value).trim() ? null : 'Name is required.'
  }),
  descriptor('x', 'Transform', 'Position X', 'number', all, (object) => object.transform.x, (object, value) => ({ ...object, transform: { ...object.transform, x: Number(value) } }), { step: 1 }),
  descriptor('y', 'Transform', 'Position Y', 'number', all, (object) => object.transform.y, (object, value) => ({ ...object, transform: { ...object.transform, y: Number(value) } }), { step: 1 }),
  descriptor('rotation', 'Transform', 'Rotation', 'number', all, (object) => radiansToDegrees(object.transform.rotation), (object, value) => ({ ...object, transform: { ...object.transform, rotation: degreesToRadians(Number(value)) } }), { step: 1 }),
  descriptor('scaleX', 'Transform', 'Scale X', 'number', all, (object) => object.transform.scaleX, (object, value) => ({ ...object, transform: { ...object.transform, scaleX: Number(value) } }), { step: 0.1 }),
  descriptor('scaleY', 'Transform', 'Scale Y', 'number', all, (object) => object.transform.scaleY, (object, value) => ({ ...object, transform: { ...object.transform, scaleY: Number(value) } }), { step: 0.1 }),
  descriptor('originX', 'Transform', 'Origin X', 'number', (object) => object.type !== 'container', (object) => object.transform.originX, (object, value) => ({ ...object, transform: { ...object.transform, originX: Number(value) } }), { min: 0, max: 1, step: 0.05 }),
  descriptor('originY', 'Transform', 'Origin Y', 'number', (object) => object.type !== 'container', (object) => object.transform.originY, (object, value) => ({ ...object, transform: { ...object.transform, originY: Number(value) } }), { min: 0, max: 1, step: 0.05 }),
  descriptor('visible', 'Rendering', 'Visible', 'boolean', all, (object) => object.visible, (object, value) => ({ ...object, visible: Boolean(value) })),
  descriptor('alpha', 'Rendering', 'Alpha', 'number', all, (object) => object.alpha, (object, value) => ({ ...object, alpha: Number(value) }), { min: 0, max: 1, step: 0.05 }),
  descriptor('asset.path', 'Texture', 'Asset', 'text', textured, (object) => object.type === 'image' || object.type === 'sprite' ? object.asset.path : '', (object, value) => object.type === 'image' || object.type === 'sprite' ? { ...object, asset: { ...object.asset, path: String(value) } } : object, {
    validate: (value) => isProjectRelativeAssetPath(String(value)) ? null : 'Use a project-relative asset path.'
  }),
  descriptor('asset.frame', 'Texture', 'Frame', 'text', textured, (object) => object.type === 'image' || object.type === 'sprite' ? String(object.asset.frame ?? '') : '', (object, value) => object.type === 'image' || object.type === 'sprite' ? { ...object, asset: { ...object.asset, frame: String(value).trim() || null } } : object),
  descriptor('animation.assetPath', 'Animation', 'Asset', 'text', sprite, (object) => object.type === 'sprite' ? object.animation?.assetPath ?? '' : '', (object, value) => object.type === 'sprite' ? { ...object, animation: { assetPath: String(value), clipKey: object.animation?.clipKey ?? 'animation', autoPlay: object.animation?.autoPlay ?? true } } : object, {
    validate: (value) => isProjectRelativeAssetPath(String(value)) ? null : 'Use a project-relative animation path.'
  }),
  descriptor('animation.clipKey', 'Animation', 'Clip', 'text', sprite, (object) => object.type === 'sprite' ? object.animation?.clipKey ?? '' : '', (object, value) => object.type === 'sprite' ? { ...object, animation: { assetPath: object.animation?.assetPath ?? 'assets/animations.phaser-animations.json', clipKey: String(value), autoPlay: object.animation?.autoPlay ?? true } } : object, {
    validate: (value) => String(value).trim() ? null : 'Animation clip is required.'
  }),
  descriptor('animation.autoPlay', 'Animation', 'Auto Play', 'boolean', sprite, (object) => object.type === 'sprite' ? object.animation?.autoPlay ?? false : false, (object, value) => object.type === 'sprite' && object.animation ? { ...object, animation: { ...object.animation, autoPlay: Boolean(value) } } : object),
  descriptor('text', 'Text', 'Content', 'multiline', text, (object) => object.type === 'text' ? object.text : '', (object, value) => object.type === 'text' ? { ...object, text: String(value) } : object),
  descriptor('style.fontFamily', 'Text', 'Font', 'text', text, (object) => object.type === 'text' ? object.style.fontFamily : '', (object, value) => object.type === 'text' ? { ...object, style: { ...object.style, fontFamily: String(value).trim() } } : object, {
    validate: (value) => String(value).trim() ? null : 'Font family is required.'
  }),
  descriptor('style.fontSize', 'Text', 'Font Size', 'number', text, (object) => object.type === 'text' ? object.style.fontSize : 32, (object, value) => object.type === 'text' ? { ...object, style: { ...object.style, fontSize: Number(value) } } : object, { min: 1, max: 512, step: 1 }),
  descriptor('style.color', 'Text', 'Color', 'text', text, (object) => object.type === 'text' ? object.style.color : '#ffffff', (object, value) => object.type === 'text' ? { ...object, style: { ...object.style, color: String(value) } } : object, {
    validate: (value) => /^#[0-9a-fA-F]{6}$/.test(String(value)) ? null : 'Use a six-digit hex color.'
  })
]

function descriptor(
  id: string,
  group: ScenePropertyDescriptor['group'],
  label: string,
  kind: ScenePropertyKind,
  supports: ScenePropertyDescriptor['supports'],
  read: ScenePropertyDescriptor['read'],
  write: ScenePropertyDescriptor['write'],
  options: Pick<ScenePropertyDescriptor, 'min' | 'max' | 'step' | 'validate'> = {}
): ScenePropertyDescriptor {
  return { id, group, label, kind, supports, read, write, ...options }
}

function radiansToDegrees(value: number): number {
  return Math.round(value * 180 / Math.PI * 1_000) / 1_000
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180
}
